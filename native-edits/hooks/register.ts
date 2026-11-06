import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { NativeEditsFailures } from '../types'

// Failed Edit/Write calls on a file before Bash may edit it.
const UNLOCK_AFTER = 2

const failures = atom({ plugin: 'native-edits', key: 'failures' } as const, {} as NativeEditsFailures)

// Quoted strings are blanked first, so `git commit -m "a > b"` is not a redirect.
// ponytail: regex over the command text, no shell parser; add a pattern when a write slips through.
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g
const SHELL_WRITES = [
  /\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i/, // in-place edit: sed -i, sed -Ei, perl -pi
  /(^|[^0-9&<>])>>?\s*(?!&|\/dev\/null\b)[^\s&|;]/, // > file, >> file (not 2>, >&2, >/dev/null)
  /\btee\b(\s+-\w+)*\s+(?!\/dev\/null\b)[^\s|;&-]/, // tee file
]
const SCRIPT_WRITES = /open\([^)]*['"][wax]b?\+?['"]|\.write_text\(|\.write_bytes\(|writeFileSync\(/

export function writesFiles(command: string): boolean {
  const bare = command.replace(QUOTED, "''")
  return SHELL_WRITES.some(re => re.test(bare)) || SCRIPT_WRITES.test(command)
}

// A command may edit through Bash when it names a file Edit/Write is stuck on,
// by its absolute path or its file name.
export function namesStuckFile(command: string, stuck: NativeEditsFailures): boolean {
  return Object.entries(stuck).some(([path, count]) =>
    count >= UNLOCK_AFTER
    && (command.includes(path) || command.includes(path.slice(path.lastIndexOf('/') + 1))))
}

// Counts a failed Edit/Write on `path`; a success resets the count.
// A call another plugin refused never ran, so it counts neither way.
async function track($: EngineInterface, path: string, ran: ToolCallResult): Promise<ToolCallResult> {
  if (ran.deny === undefined) {
    await update($, failures, all => ({ ...all, [path]: ran.isError ? (all[path] ?? 0) + 1 : 0 }))
  }
  return ran
}

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => track($, e.file_path, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => track($, e.file_path, await next(e)))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!writesFiles(e.command) || namesStuckFile(e.command, await read($, failures))) {
      return next(e)
    }
    return {
      deny: `${$.plugin.name}: edit files with the Edit or Write tool, not Bash. `
        + `Bash edits open for a file after Edit/Write fails on it ${UNLOCK_AFTER} times.`,
    }
  }).catch(($, e, next) =>
    // A broken check lets the command run instead of blocking all Bash.
    next(e),
  )
}
