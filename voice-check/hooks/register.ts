import type { Register } from 'claude-code'

import { BLACKLIST } from './blacklist'

type Rule = { term: string; instead: string; re: RegExp }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One rule per variant. A single word also matches its common endings
// (leverage, leverages, leveraged, leveraging); a phrase matches as written,
// any run of spaces and either apostrophe.
const RULES: Rule[] = BLACKLIST.flatMap(([entry, instead]) =>
  entry.replace(/\(.*?\)/g, '').split(' / ').map(variant => {
    const term = variant.trim()
    const isWord = /^[\w-]+$/.test(term)
    const body = isWord
      ? `${escape(term.replace(/e$/, ''))}${term.endsWith('e') ? 'e?' : ''}(?:s|es|d|ed|ing|ly|ment|ments)?`
      : escape(term).replace(/\s+/g, '\\s+').replace(/'/g, "['\u2019]")
    const end = /\w$/.test(term) ? '(?![\\w-])' : ''
    return { term, instead, re: new RegExp(`(?<![\\w-])${body}${end}`, 'i') }
  }))

export function findTells(text: string): Rule[] {
  return RULES.filter(rule => rule.re.test(text))
}

// Outgoing prose: mail/chat MCP tools by their action, and gh PR/issue text.
const SENDS = /__(create_draft|update_draft|send_message|reply|forward)$/
const GH_PROSE = /\bgh\s+(pr|issue)\s+(create|edit|comment|review)\b/
// Input fields that hold addresses or ids, not prose.
const NOT_PROSE = /(^|_)(id|ids|to|cc|bcc|from|email|address|label|labels)$/i

function proseOf(input: unknown, key = ''): string {
  if (typeof input === 'string') return NOT_PROSE.test(key) ? '' : input
  if (Array.isArray(input)) return input.map(v => proseOf(v, key)).join('\n')
  if (input && typeof input === 'object') {
    return Object.entries(input).map(([k, v]) => proseOf(v, k)).join('\n')
  }
  return ''
}

// The last text refused, per tool: sending it again unchanged goes through,
// so a word that fits on purpose is never a dead end.
// ponytail: module memory, a reload forgets it and refuses once more.
const refused = new Map<string, string>()

export const register: Register = on => {
  on('tool.call', ($, e, next) => {
    const text = e.tool === 'Bash'
      ? (GH_PROSE.test(e.command) ? e.command : '')
      : SENDS.test(e.tool) ? proseOf(e) : ''
    const tells = text === '' ? [] : findTells(text)

    if (tells.length === 0 || refused.get(e.tool) === text) {
      refused.delete(e.tool)
      return next(e)
    }

    refused.set(e.tool, text)
    const list = tells.map(t => `"${t.term}" -> ${t.instead}`).join('; ')
    return {
      deny: `${$.plugin.name}: AI-writing tells in outgoing text: ${list}. `
        + 'Rewrite in plainer words. If a word is right here, send the same text again unchanged and it goes through.',
    }
  }).catch(($, e, next) =>
    // A broken check lets the message go instead of blocking every send.
    next(e),
  )
}
