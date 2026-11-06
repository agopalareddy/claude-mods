import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'repo-context',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'repo-context',
  component: 'Pane',
  requestId: 'repo-context',
  props: {
    title: 'Git',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOW = 1_800_000_000_000

type Repo ={ branch: string; dirty: boolean; branchLine?: string }

// Stands in for git and the engine. `repo` null: not a git repository.
function fakeHost(on: any, cwd: string, repo: Repo | null) {
  const seen = { status: undefined as string | undefined, toasts: [] as string[], runs: [] as string[], opened: 0 }
  on('session.cwd', () => ({ value: cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const a = e.argv.slice(1).join(' ')
    seen.runs.push(a)
    const out = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr } })
    if (repo === null) return out('', 128, 'fatal: not a git repository')
    if (a.startsWith('rev-parse')) return out(`${cwd}\n${repo.branch}\n`)
    if (a.startsWith('status')) {
      return out(`${repo.branchLine ?? `## ${repo.branch}...origin/${repo.branch} [ahead 1, behind 2]`}\n${repo.dirty ? ' M src/app.ts\n?? notes.md\n' : ''}`)
    }
    if (a.startsWith('branch')) return out('main\nfeat/pane\n')
    // Committed 2 hours and 3 days before NOW, in seconds as `%ct` gives them.
    if (a.startsWith('log')) return out(`abc1234\t${NOW / 1000 - 7200}\tfeat: add pane\ndef5678\t${NOW / 1000 - 3 * 86400}\tfix: crash\n`)
    if (a.startsWith('switch')) {
      repo.branch = e.argv[2] ?? repo.branch
      return out('', 0, `Switched to branch '${repo.branch}'`)
    }
    if (a.startsWith('push')) return out('', 1, 'error: failed to push some refs')
    return out('Already up to date.\n')
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    seen.status = e.text
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: { text: string }) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => {
    seen.opened += 1
    return { value: { isPlaced: true } }
  })
  on('command.register', () => ({ value: { command: 'git' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  // Stands for the engine's own (empty) band when the mod passes with next(e).
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return seen
}

test('outside a repo: band shows the folder, status cleared, no pane opened', async ($, on) => {
  const seen = fakeHost(on, '/home/me', null)
  await $.session.start({ cwd: '/home/me', surface: 'terminal', isInteractive: true })

  expect(seen.status).toBeUndefined()
  expect(seen.opened).toBe(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Not in a git repo: \/home\/me/ })).toBeDefined()
    await ui.unmount()
  }
})

test('inside a repo: status line, pane opens with branch, sync, changes and commits', async ($, on) => {
  const seen = fakeHost(on, '/home/me/proj', { branch: 'main', dirty: true })
  await $.session.start({ cwd: '/home/me/proj', surface: 'terminal', isInteractive: true })

  expect(seen.status).toBe('git: main*')
  expect(seen.opened).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'proj' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● 2 to pull, 1 to push/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'origin/main' })).toBeDefined()
    expect((await ui.find({ key: 'pull' }))?.text).toBe('Pull ↓2')
    expect((await ui.find({ key: 'push' }))?.text).toBe('Push ↑1')
    expect(await ui.find({ type: 'Text', text: /CHANGES {2}2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '·M' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'src/app.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'abc1234' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'feat: add pane' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3d' })).toBeDefined()
    await ui.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Not in a git repo/ })).toBeUndefined()
  await band.unmount()
})

test('pane actions: switch branch, pull, push failure, each toasted and refreshed', async ($, on) => {
  const seen = fakeHost(on, '/p', { branch: 'main', dirty: false, branchLine: '## main' })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /● No upstream/ })).toBeDefined()
  expect((await ui.find({ key: 'pull' }))?.text).toBe('Pull')
  expect(await ui.find({ type: 'Text', text: /CHANGES {2}clean/ })).toBeDefined()

  await ui.press({ key: 'fetch' })
  expect(seen.runs).toContain('fetch --prune')

  await ui.select({ key: 'branch', value: 'feat/pane' })
  expect(seen.runs).toContain('switch feat/pane')
  expect(seen.status).toBe('git: feat/pane')

  await ui.press({ key: 'pull' })
  expect(seen.runs).toContain('pull --ff-only')
  expect(seen.toasts.at(-1)).toBe('git pull: done (Already up to date.)')

  await ui.press({ key: 'push' })
  expect(seen.toasts.at(-1)).toBe('git push: failed (error: failed to push some refs)')
  await ui.unmount()
})
