import { expect, test } from 'claude-code/testing'

const SEND = 'mcp__mail__send_message'
const isRefused = (ran: { deny?: string; isError?: boolean }) => ran.deny !== undefined || ran.isError === true

test('outgoing prose with tells is refused once; unchanged resend goes through', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  const call = (tool: string, input: Record<string, unknown>) => $.tool.call({ tool, ...input } as never)

  const leveraging = { to: ['crucial@example.com'], subject: 'Hi', body: "We're leveraging a robust setup." }
  const first = await call(SEND, leveraging)
  expect(isRefused(first)).toBe(true)
  expect(String(first.deny ?? first.text)).toMatch(/"leverage" -> use.*"robust" -> strong/)
  expect(isRefused(await call(SEND, leveraging))).toBe(false) // same text again: kept on purpose

  // Phrases, curly apostrophes, and variants split from "A / B".
  expect(isRefused(await call(SEND, { body: 'It’s worth noting that the build is green.' }))).toBe(true)
  expect(isRefused(await call(SEND, { body: 'Furthermore, the tests pass.' }))).toBe(true)

  // Plain text, addresses and ids are fine; so are tools that do not send.
  expect(isRefused(await call(SEND, { to: ['robust@example.com'], body: 'Thanks, see you Friday.' }))).toBe(false)
  expect(isRefused(await call('mcp__mail__search_threads', { query: 'leverage' }))).toBe(false)
  expect(isRefused(await call('Write', { file_path: '/x.md', content: 'A robust plan.' }))).toBe(false)
})

test('gh PR and issue text is checked, other Bash is not', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command })

  expect(isRefused(await bash('gh pr create --title "fix" --body "A seamless, comprehensive fix."'))).toBe(true)
  expect(isRefused(await bash('gh issue comment 3 --body "Fixed in main."'))).toBe(false)
  expect(isRefused(await bash('grep -rn "robust" src/'))).toBe(false)
  // Endings and boundaries: "realms" matches, "realmless"-style inner words and "unaligned" do not.
  expect(isRefused(await bash('gh pr edit 4 --body "Across realms."'))).toBe(true)
  expect(isRefused(await bash('gh pr edit 4 --body "Fix unaligned buffer."'))).toBe(false)
})
