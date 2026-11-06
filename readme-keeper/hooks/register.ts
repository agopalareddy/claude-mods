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

async function afterCommit($: EngineInterface): Promise<string> {
  const git = (...args: string[]) => $.process.run(['git', ...args])
  const top = (await git('rev-parse', '--show-toplevel')).stdout.trim()
  if (top === '' || nudged.has(top)) return ''
  const readme = `${top}/README.md`

  if (!(await $.fs.exists(readme))) {
    nudged.add(top)
    return `${top} has no README.md. Offer the user one that follows standard-readme (${SPEC}).`
  }

  const last = (await git('-C', top, 'log', '-1', '--format=%H', '--', 'README.md')).stdout.trim()
  const behind = Number((await git('-C', top, 'rev-list', '--count', last === '' ? 'HEAD' : `${last}..HEAD`)).stdout.trim()) || 0
  if (behind < STALE_AFTER) return ''

  nudged.add(top)
  const changes = (await git('-C', top, 'log', '--format=- %s', `-${Math.min(behind, 20)}`)).stdout.trim()
  return [
    `${readme} has not changed in the last ${behind} commits:`,
    changes,
    'Update README.md for these changes, following standard-readme, in its own docs commit. '
      + 'Keep its existing content and voice; add or fix sections only where the changes call for it.',
    lintNote(await lint($, readme)),
  ].filter(Boolean).join('\n')
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
