import { expect, test } from 'claude-code/testing'

const REMARK = '/h/.cache/readme-keeper/node_modules/.bin/remark'
const LINT_OUT = [
  '../../repo/README.md',
  '           warning Missing required `License` section     require-sections    standard-readme',
  '28:1-28:11 warning Unexpected header section after extra sections no-unknown-sections standard-readme',
  '',
  '⚠ 2 warnings',
].join('\n')

// A fake host: git answers for one repo whose README is `behind` commits old.
// `gh`: what `gh repo view` reports (absent: not on GitHub); `tag`: newest tag and commits since.
function fakeHost(on: any, opts: { behind: number; hasReadme?: boolean; hasLinter?: boolean; gh?: object; tag?: [string, number] }) {
  const runs: string[][] = []
  on('env.get', () => ({ value: '/h' }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: e.path === REMARK ? opts.hasLinter !== false : opts.hasReadme !== false,
  }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    runs.push([...e.argv])
    const a = e.argv.join(' ')
    const out = (stdout: string, stderr = '') => ({ value: { exitCode: 0, stdout, stderr } })
    if (e.argv[0] === REMARK) return out('', LINT_OUT)
    if (e.argv[0] === 'gh') return opts.gh ? out(JSON.stringify(opts.gh)) : { value: { exitCode: 1, stdout: '', stderr: 'no git remotes found' } }
    if (a.includes('describe --tags')) return out(opts.tag ? `${opts.tag[0]}\n` : '')
    if (opts.tag && a.includes(`${opts.tag[0]}..HEAD`)) return out(`${opts.tag[1]}\n`)
    if (a.includes('--show-toplevel')) return out('/repo\n')
    if (a.includes('--format=%H')) return out('abc123\n')
    if (a.includes('rev-list')) return out(`${opts.behind}\n`)
    if (a.includes('--format=- %s')) return out('- feat: add sync\n- fix: crash on start\n')
    return out('')
  })
  on('tool.call', () => ({ result: {} }))
  return runs
}

const contextOf = (ran: { context?: readonly string[] }) => (ran.context ?? []).join('\n')

test('a commit in a stale repo asks once for a README update with lint findings', async ($, on) => {
  fakeHost(on, { behind: 7 })

  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
  const note = contextOf(ran)
  expect(note).toMatch(/README\.md has not changed in the last 7 commits/)
  expect(note).toMatch(/- feat: add sync/)
  expect(note).toMatch(/- warning Missing required `License` section$/m) // rule name trimmed
  expect(note).toMatch(/- 28:1-28:11 warning Unexpected header section/)
  expect(note).not.toMatch(/⚠/)

  // Same repo again this session: no second nudge.
  expect(contextOf(await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: y"' }))).toBe('')
})

test('a fresh README, or a non-commit command, adds nothing', async ($, on) => {
  fakeHost(on, { behind: 2 })
  expect(contextOf(await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: y"' }))).toBe('')
  expect(contextOf(await $.tool.call({ tool: 'Bash', command: 'git log -3' }))).toBe('')
})

test('a blank GitHub page or a stale tag asks for repo page updates, even with a fresh README', async ($, on) => {
  fakeHost(on, {
    behind: 1,
    gh: { description: '', homepageUrl: '', repositoryTopics: null, url: 'https://github.com/me/repo' },
    tag: ['v1.2.0', 9],
  })
  const note = contextOf(await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' }))
  expect(note).not.toMatch(/README\.md has not changed/)
  expect(note).toMatch(/repo page \(https:\/\/github\.com\/me\/repo\) may be out of date/)
  expect(note).toMatch(/- No description\.\n- No topics\.\n- 9 commits since the newest tag, v1\.2\.0\./)
  expect(note).toMatch(/only after they agree/)
})

test('a filled-in GitHub page with a recent tag adds nothing', async ($, on) => {
  fakeHost(on, {
    behind: 1,
    gh: { description: 'Mods', homepageUrl: '', repositoryTopics: [{ name: 'claude-code' }], url: 'https://github.com/me/repo' },
    tag: ['v1.2.0', 2],
  })
  expect(contextOf(await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' }))).toBe('')
})

test('editing a README lints it; other files are not linted', async ($, on) => {
  const runs = fakeHost(on, { behind: 0 })
  const edit = (file_path: string) =>
    $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' })

  expect(contextOf(await edit('/repo/README.md'))).toMatch(/standard-readme lint .*\n- warning Missing required `License`/)
  expect(contextOf(await edit('/repo/src/app.ts'))).toBe('')
  expect(runs.filter(r => r[0] === REMARK)).toHaveLength(1)
})

test('without the linter installed, the note says how to install it', async ($, on) => {
  fakeHost(on, { behind: 0, hasLinter: false })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '# x' })
  expect(contextOf(ran)).toMatch(/npm i --prefix ~\/\.cache\/readme-keeper remark-cli@12 standard-readme-preset/)
})
