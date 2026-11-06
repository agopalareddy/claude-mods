import type { Register } from 'claude-code'

// True when `command` is a commit (or amend) whose message would carry an
// AI co-author trailer. Only sees the command text: a message passed with
// `-F file` is not read.
// ponytail: command-text match only; read the -F file via $.fs if that path ever matters.
export function hasAiTrailer(command: string): boolean {
  return COMMIT.test(command) && AI_TRAILER.test(command)
}

// `git commit`, also with global options before it (`git -C path commit`).
const COMMIT = /\bgit\b(\s+-[cC]\s+\S+)*\s+commit\b/
// A co-author line naming a known AI tool; human co-authors pass.
// ponytail: fixed name list, add a name when a new tool slips through.
const AI_TRAILER = /co-authored-by:[^\n]*\b(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini|aider|devin)\b/i

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    hasAiTrailer(e.command)
      ? { deny: `${$.plugin.name}: commit message has an AI co-author trailer. Remove it and commit again.` }
      : next(e),
  ).catch(($, e, next) =>
    // If the check itself throws, let the command run instead of blocking all Bash.
    next(e),
  )
}
