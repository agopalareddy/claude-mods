import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-meter',
  component: 'Pane',
  requestId: 'usage-meter',
  props: {
    title: 'Usage',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// What scripts/scan.mjs prints. Today on Opus 5.5: $1.04, reads saved $3.80,
// 1-hour writes cost $0.40 extra. 17 days back on Sonnet 5.5: $10. A model with no
// price two years back.
const HISTORY = {
  today: '2026-11-06',
  ttl: 60,
  days: {
    '2026-11-06': { 'claude-opus-5-5': [2, 1000, 2000, 1_000_000, 0, 100_000] },
    '2026-10-20': { 'claude-sonnet-5-5': [1, 0, 1_000_000, 0, 0, 0] },
    '2024-11-01': { 'mystery-model': [1, 1, 1, 1, 1, 1] },
  },
}

function fakeHost(on: any) {
  const seen = { status: undefined as string | undefined, scans: [] as string[][] }
  on('env.get', () => ({ value: '/home/me' }))
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    seen.scans.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(HISTORY), stderr: '' } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_: unknown, e: { text: string | undefined }) => {
    seen.status = e.text
    return { value: undefined }
  })
  return seen
}

// Runs a slash command as typed at the prompt.
const run = ($: any, command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('pane shows spend per range, by model and cache savings', async ($, on) => {
  const seen = fakeHost(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await run($, 'meter')
  expect(seen.scans.at(-1)?.slice(-1)).toEqual(['/home/me/.cache/usage-meter/usage.json'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'range:day' }))?.text).toMatch(/Today\s*\$1\.04\s*1\.1M\s*\$3\.40/)
  expect((await ui.find({ key: 'range:month' }))?.text).toMatch(/▸ 30 days\s*\$11\s*2\.1M/)
  expect((await ui.find({ key: 'model:claude-sonnet-5-5' }))?.text).toMatch(/1\s*\$10/)
  expect(await ui.find({ type: 'Text', text: /Reads saved \$3\.80; writes cost \$0\.40 extra; net \$3\.40/ })).toBeDefined()

  await ui.press({ key: 'pick:all' })
  expect((await ui.find({ key: 'model:mystery-model' }))?.text).toMatch(/\?/)
  expect(await ui.find({ type: 'Text', text: /no price/ })).toBeDefined()
  await ui.unmount()
})

test('/keepwarm turns on for a time, shows it, and turns off', async ($, on) => {
  const seen = fakeHost(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await run($, 'meter')

  const on90 = await run($, 'keepwarm', '90')
  expect(on90.text).toMatch(/on for 90 minutes: pings the cache after 59 idle minutes/)
  expect(seen.status).toMatch(/^warm 90m left · 0 pings \$0\.00/)

  const bad = await run($, 'keepwarm', 'soon')
  expect(bad.text).toMatch(/^Usage:/)

  const off = await run($, 'keepwarm')
  expect(off.text).toMatch(/^Keep warm off: 0 pings/)
  expect(seen.status).toBeUndefined()

  const h2 = await run($, 'keepwarm', '2h')
  expect(h2.text).toMatch(/on for 120 minutes/)
})
// ponytail: the ping itself runs from a timer, where the test host refuses $.model.fork; check it live.
