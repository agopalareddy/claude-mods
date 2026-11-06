import { expect, test } from 'claude-code/testing'

const BLOCKED = [
  `git commit -m "fix: thing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`,
  `git commit -m "$(cat <<'EOF'\nfeat: x\n\nco-authored-by: Claude <noreply@anthropic.com>\nEOF\n)"`,
  `git commit --amend -m "chore: y\n\nCo-authored-by: Copilot <copilot@github.com>"`,
]

const ALLOWED = [
  'git commit -m "fix: plain message"',
  'git log --grep "Co-Authored-By"',
  'grep -r "Co-Authored-By: Claude" docs/',
  'ls',
]

test('commits with an AI trailer are denied, everything else runs', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  // Map each command to whether it was denied, so a failure names the command.
  const denied = async (cmds: string[]) =>
    Object.fromEntries(
      await Promise.all(cmds.map(async command => {
        const ran = await $.tool.call({ tool: 'Bash', command })
        return [command, ran.deny !== undefined || ran.isError === true] as const
      })),
    )

  expect(await denied(BLOCKED)).toEqual(Object.fromEntries(BLOCKED.map(c => [c, true])))
  expect(await denied(ALLOWED)).toEqual(Object.fromEntries(ALLOWED.map(c => [c, false])))
})
