import { expect, test } from 'claude-code/testing'

// Stands in for the shell and for git. `staged`: what `git diff --cached` reports;
// `adds`: what `git add --dry-run` would stage.
function fakeHost(on: any, opts: { staged?: string[]; diff?: string; adds?: string[] } = {}) {
  on('tool.call', () => ({ result: {} }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.slice(1).join(' ')
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (a.startsWith('add --dry-run')) return out((opts.adds ?? []).map(p => `add '${p}'\n`).join(''))
    if (a === 'diff --cached --name-only') return out((opts.staged ?? []).join('\n'))
    if (a.startsWith('diff --cached -U0')) return out(opts.diff ?? '')
    return out('')
  })
}

// Map each command to the deny text (or null), so a failure names the command.
async function denials($: any, cmds: string[]) {
  return Object.fromEntries(await Promise.all(cmds.map(async (command: string) => {
    const ran = await $.tool.call({ tool: 'Bash', command })
    return [command, ran.deny ?? null] as const
  })))
}

test('AI trailers, bad subjects and force pushes are denied; good commands run', async ($, on) => {
  fakeHost(on)
  const BLOCKED = [
    `git commit -m "fix: thing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`,
    `git commit --amend -m "chore: y\n\nCo-authored-by: Copilot <copilot@github.com>"`,
    'git commit -m "Fixed the thing"',
    'git commit -m "feature: add pane"',
    'git commit -m "feat(repo-context): add a pane that shows every branch"',
    `git commit -F - <<'EOF'\nupdate stuff\nEOF`,
    'git push --force',
    'git push -f origin main',
    'git push -uf origin main',
    'git push --force-with-lease',
    'git push origin +main',
    'cd x && git push --force && echo done',
  ]
  const ALLOWED = [
    'git commit -m "fix: plain message"',
    `git commit -F - <<'EOF'\nfeat(readme-keeper): check GitHub page\n\nBody text here.\nEOF`,
    'git commit -m "feat!: drop node 18"',
    'git commit -m "Merge branch \'main\' into feat/x"',
    'git commit --amend --no-edit',
    'git commit',
    'git log --grep "Co-Authored-By"',
    'git push',
    'git push -u origin feat/pane',
    'git push origin main && git status -f',
    'ls -f',
  ]

  const blocked = await denials($, BLOCKED)
  for (const c of BLOCKED) expect([c, blocked[c]]).not.toEqual([c, null])
  const allowed = await denials($, ALLOWED)
  for (const c of ALLOWED) expect([c, allowed[c]]).toEqual([c, null])
  expect(blocked['git commit -m "Fixed the thing"']).toMatch(/not `type\(scope\): description`/)
  expect(blocked['git commit -m "feat(repo-context): add a pane that shows every branch"']).toMatch(/54 characters/)
})

test('adding a secret file is denied; examples pass', async ($, on) => {
  fakeHost(on, { adds: ['src/app.ts', '.env', 'certs/server.pem', '.env.example'] })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git add .' })
  expect(ran.deny).toMatch(/- \.env \(secret file\)\n- certs\/server\.pem \(secret file\)\n/)
  expect(ran.deny).not.toMatch(/example/)
})

test('committing a staged key is denied; a clean commit runs', async ($, on) => {
  // A made-up AWS-shaped key, built in two parts so secret scanners pass this file.
  const fakeKey = 'AKIA' + 'ABCDEFGHIJKLMNOP'
  fakeHost(on, {
    staged: ['src/config.ts'],
    diff: `+++ b/src/config.ts\n@@ -1,0 +2 @@\n+const key = "${fakeKey}"\n`,
  })
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: config"' })).deny).toMatch(/src\/config\.ts \(key: AKIAABCD…\)/)
})

test('a clean add and commit run', async ($, on) => {
  fakeHost(on, { adds: ['src/app.ts'], staged: ['src/app.ts'], diff: '+++ b/src/app.ts\n+const x = 1\n' })
  expect(await denials($, ['git add src/app.ts', 'git commit -m "fix: x"'])).toEqual({
    'git add src/app.ts': null,
    'git commit -m "fix: x"': null,
  })
})
