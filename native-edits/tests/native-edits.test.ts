import { expect, test } from 'claude-code/testing'

const WRITES = [
  `sed -i 's/a/b/' src/app.ts`,
  `sed -Ei 's/a/b/' src/app.ts`,
  `perl -pi -e 's/a/b/' src/app.ts`,
  `echo hi > src/app.ts`,
  `cat <<'EOF' >> src/app.ts\nx\nEOF`,
  `printf x | tee -a src/app.ts`,
  `python -c "open('src/app.ts','w').write('x')"`,
]

const READS = [
  'ls -la',
  'cat src/app.ts',
  'npm test 2>&1 | tail -5',
  'make >/dev/null 2>&1',
  `git commit -m "fix: a > b"`,
  `grep -n "x >> y" src/app.ts`,
  `sed -n 1,20p src/app.ts`,
  'echo done | tee /dev/null',
]

test('Bash writes are refused, reads run', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  const refused = async (cmds: string[]) =>
    Object.fromEntries(await Promise.all(cmds.map(async command => {
      const ran = await $.tool.call({ tool: 'Bash', command })
      return [command, ran.deny !== undefined || ran.isError === true] as const
    })))

  expect(await refused(WRITES)).toEqual(Object.fromEntries(WRITES.map(c => [c, true])))
  expect(await refused(READS)).toEqual(Object.fromEntries(READS.map(c => [c, false])))
})

test('two failed Edits on a file open Bash edits for that file only; a success closes them', async ($, on) => {
  let editFails = true
  on('tool.call', (_, e) =>
    e.tool === 'Edit' && editFails ? { result: {}, isError: true } : { result: {} })

  const edit = { tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } as const
  const sedApp = { tool: 'Bash', command: `sed -i 's/a/b/' src/app.ts` } as const
  const sedOther = { tool: 'Bash', command: `sed -i 's/a/b/' src/other.ts` } as const
  const isRefused = async (call: typeof sedApp | typeof sedOther) => {
    const ran = await $.tool.call(call)
    return ran.deny !== undefined || ran.isError === true
  }

  await $.tool.call(edit)
  expect(await isRefused(sedApp)).toBe(true) // one failure is not enough

  await $.tool.call(edit)
  expect(await isRefused(sedApp)).toBe(false) // two failures open app.ts
  expect(await isRefused(sedOther)).toBe(true) // other files stay closed

  editFails = false
  await $.tool.call(edit)
  expect(await isRefused(sedApp)).toBe(true) // a working Edit closes it again
})
