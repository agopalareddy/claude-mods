import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

// Commits since README.md last changed before Claude is asked to update it.
const STALE_AFTER = 5
const SPEC = 'https://github.com/RichardLitt/standard-readme/blob/main/spec.md'
// Where remark-cli and standard-readme-preset are installed (see README).
const TOOL_DIR = '.cache/readme-keeper'
const INSTALL = `npm i --prefix ~/${TOOL_DIR} remark-cli@12 standard-readme-preset`

const GIT_COMMIT = /\bgit\b(\s+-[cC]\s+\S+)*\s+commit\b/
const README = /(^|\/)README\.md$/i

// standard-readme lint messages for one file, or null when the linter is not installed.
// A message line looks like `28:1-28:11  warning  Unexpected header ...  rule  standard-readme`.
export function lintMessages(output: string): string[] {
  return output.split('\n')
    .filter(line => /\b(warning|error)\b/.test(line) && !/^\s*[⚠✖]/.test(line))
    .map(line => line.replace(/\s{2,}/g, ' ').replace(/\s*\S+\s+standard-readme\s*$/, '').trim())
}

async function lint($: EngineInterface, file: string): Promise<string[] | null> {
  const home = await $.env.get('HOME')
  const remark = `${home}/${TOOL_DIR}/node_modules/.bin/remark`
  if (!(await $.fs.exists(remark))) return null
  const ran = await $.process.run(
    [remark, '--no-stdout', '--no-color', '--use', 'standard-readme-preset', file],
    { cwd: `${home}/${TOOL_DIR}` },
  )
  return lintMessages(ran.stderr)
}

const lintNote = (issues: string[] | null) =>
  issues === null
    ? `standard-readme lint is not installed; to enable it run: ${INSTALL}`
    : issues.length > 0
      ? `standard-readme lint (${SPEC}):\n${issues.map(i => `- ${i}`).join('\n')}`
      : ''

const withContext = (ran: ToolCallResult, note: string): ToolCallResult =>
  note === '' || ran.deny !== undefined ? ran : { ...ran, context: [...(ran.context ?? []), `[readme-keeper] ${note}`] }

// Repos already nudged this session, by top-level path, so one stale README asks once.
// ponytail: module memory; a reload may nudge again once.
const nudged = new Set<string>()

type GhRepo = { description: string; homepageUrl: string; repositoryTopics: { name: string }[] | null; url: string }

// What `gh repo view` says about the repo's GitHub page, or null when the repo is
// not on GitHub or gh is missing or signed out.
async function ghRepo($: EngineInterface, top: string): Promise<GhRepo | null> {
  try {
    const ran = await $.process.run(['gh', 'repo', 'view', '--json', 'description,homepageUrl,repositoryTopics,url'], { cwd: top, timeoutMs: 15_000 })
    return ran.exitCode === 0 ? (JSON.parse(ran.stdout) as GhRepo) : null
  } catch {
    return null
  }
}

// The README part of the nudge: '' when README.md is fresh.
async function readmeNote($: EngineInterface, top: string): Promise<string> {
  const git = (...args: string[]) => $.process.run(['git', '-C', top, ...args])
  const readme = `${top}/README.md`
  if (!(await $.fs.exists(readme))) return `${top} has no README.md. Offer the user one that follows standard-readme (${SPEC}).`

  const last = (await git('log', '-1', '--format=%H', '--', 'README.md')).stdout.trim()
  const behind = Number((await git('rev-list', '--count', last === '' ? 'HEAD' : `${last}..HEAD`)).stdout.trim()) || 0
  if (behind < STALE_AFTER) return ''

  const changes = (await git('log', '--format=- %s', `-${Math.min(behind, 20)}`)).stdout.trim()
  return [
    `${readme} has not changed in the last ${behind} commits:`,
    changes,
    'Update README.md for these changes, following standard-readme, in its own docs commit. '
      + 'Keep its existing content and voice; add or fix sections only where the changes call for it.',
    lintNote(await lint($, readme)),
  ].filter(Boolean).join('\n')
}

// The repo page part of the nudge: what is blank on GitHub, and how far HEAD is past
// the newest tag. '' when nothing is blank or behind.
async function repoPageNote($: EngineInterface, top: string): Promise<string> {
  const git = (...args: string[]) => $.process.run(['git', '-C', top, ...args])
  const gaps: string[] = []

  const gh = await ghRepo($, top)
  if (gh !== null) {
    if (gh.description.trim() === '') gaps.push('- No description.')
    if ((gh.repositoryTopics ?? []).length === 0) gaps.push('- No topics.')
  }
  const tag = (await git('describe', '--tags', '--abbrev=0')).stdout.trim()
  if (tag !== '') {
    const since = Number((await git('rev-list', '--count', `${tag}..HEAD`)).stdout.trim()) || 0
    if (since >= STALE_AFTER) gaps.push(`- ${since} commits since the newest tag, ${tag}.`)
  }
  if (gaps.length === 0) return ''

  const topics = (gh?.repositoryTopics ?? []).map(t => t.name).join(', ') || 'none'
  return [
    `The repo page${gh ? ` (${gh.url})` : ''} may be out of date:`,
    ...gaps,
    gh ? `Now: description "${gh.description}", website ${gh.homepageUrl || 'none'}, topics ${topics}.` : '',
    'Check what this project needs, and skip what it does not: a one-line description, topics, '
      + 'a website only if it has a site, docs or store page, a new version tag or release only if '
      + 'it ships versions, and published packages (npm, PyPI, AUR, GitHub Packages) at the new version. '
      + 'Propose the changes to the user; change GitHub (gh repo edit, gh release create, git push --tags) '
      + 'only after they agree.',
  ].filter(Boolean).join('\n')
}

async function afterCommit($: EngineInterface): Promise<string> {
  const top = (await $.process.run(['git', 'rev-parse', '--show-toplevel'])).stdout.trim()
  if (top === '' || nudged.has(top)) return ''
  const note = [await readmeNote($, top), await repoPageNote($, top)].filter(Boolean).join('\n\n')
  if (note !== '') nudged.add(top)
  return note
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!GIT_COMMIT.test(e.command) || ran.isError) return ran
    return withContext(ran, await afterCommit($))
  })

  // Lint right after Claude edits a README, so fixes land before the commit.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    return README.test(e.file_path) && !ran.isError ? withContext(ran, lintNote(await lint($, e.file_path))) : ran
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    return README.test(e.file_path) && !ran.isError ? withContext(ran, lintNote(await lint($, e.file_path))) : ran
  })
}
