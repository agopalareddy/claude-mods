import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'memory-reminders',
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

const NOTES: Record<string, string> = {
  '/h/.claude/projects/p1/memory/umm.md':
    'Merged 2026-10-07 (a past event, no reminder)\n- remind: 2026-11-01 Reapply for Play production\n',
  '/h/.claude/projects/p1/memory/later.md': 'remind: 2026-12-24 Buy gifts\n',
  '/h/.claude/projects/p2/memory/today.md': '* REMIND: 2026-11-06   Renew domain  \n',
}

test('due reminders show in the band, future ones and past events do not', async ($, on) => {
  on('env.get', () => ({ value: '/h' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 6, 12).getTime() }))
  on('fs.list', (_: unknown, e: { path?: string }) => {
    const dir = `${e.path}/`
    const names = new Set<string>()
    for (const path of Object.keys(NOTES)) {
      if (path.startsWith(dir)) names.add(path.slice(dir.length).split('/')[0] ?? '')
    }
    const value = [...names].map(name => ({
      name,
      kind: name.endsWith('.md') ? ('file' as const) : ('dir' as const),
      size: 0,
      mtimeMs: 0,
      isLink: false,
    }))
    return { value }
  })
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: NOTES[e.path] ?? '' }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/h', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Due 2026-11-01: Reapply for Play production/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Due 2026-11-06: Renew domain/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Buy gifts/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /2026-10-07/ })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /Reapply/ })).toBeUndefined()
  await ui.unmount()
})
