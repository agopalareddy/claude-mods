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

// Stands in for git: `repo` decides whether rev-parse succeeds.
function fakeGit(on: any, cwd: string, repo: { branch: string; dirty: boolean } | null) {
  const statusLine: { text?: string } = {}
  on('session.cwd', () => ({ value: cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    const isRevParse = e.argv[1] === 'rev-parse'
    if (repo === null) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } }
    const stdout = isRevParse ? `${repo.branch}\n` : repo.dirty ? ' M file.ts\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    statusLine.text = e.text
    return { value: undefined }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  // Stands for the engine's own (empty) band when the mod passes with next(e).
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return statusLine
}

test('outside a repo: band shows the folder, status line is cleared', async ($, on) => {
  const statusLine = fakeGit(on, '/home/me', null)
  await $.session.start({ cwd: '/home/me', surface: 'terminal', isInteractive: true })

  expect(statusLine.text).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Not in a git repo: \/home\/me/ }))?.text).toBeDefined()
    await ui.unmount()
  }
})

test('inside a dirty repo: status shows branch with *, no band', async ($, on) => {
  const statusLine = fakeGit(on, '/home/me/proj', { branch: 'main', dirty: true })
  await $.session.start({ cwd: '/home/me/proj', surface: 'terminal', isInteractive: true })

  expect(statusLine.text).toBe('git: main*')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Not in a git repo/ })).toBeUndefined()
  await ui.unmount()
})
