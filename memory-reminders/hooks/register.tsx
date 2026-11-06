import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MemoryReminder } from '../types'

const due = atom({ plugin: 'memory-reminders', key: 'due' } as const, [] as MemoryReminder[])
const isHidden = atom({ plugin: 'memory-reminders', key: 'isHidden' } as const, false)

// One reminder per line: `remind: 2026-11-01 Reapply for production`, with an
// optional list marker in front.
const REMIND = /^\s*(?:[-*]\s+)?remind:\s*(\d{4}-\d{2}-\d{2})\s+(.+?)\s*$/gim

export function dueReminders(file: string, text: string, today: string): MemoryReminder[] {
  return [...text.matchAll(REMIND)]
    .map(([, date = '', line = '']) => ({ date, text: line, file }))
    .filter(r => r.date <= today)
}

// Today as YYYY-MM-DD in the mod's own time zone.
// ponytail: whatever zone the mod runs in (likely UTC); pass the offset in if reminders flip a day early.
function isoDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Reads every project's memory notes: ~/.claude/projects/*/memory/*.md.
async function refresh($: EngineInterface): Promise<void> {
  const projects = `${await $.env.get('HOME')}/.claude/projects`
  const today = isoDay(await $.clock.now())
  const found: MemoryReminder[] = []

  for (const project of await $.fs.list(projects).catch(() => [])) {
    if (project.kind !== 'dir') continue
    const dir = `${projects}/${project.name}/memory`
    for (const note of await $.fs.list(dir).catch(() => [])) {
      if (note.kind !== 'file' || !note.name.endsWith('.md')) continue
      const text = await $.fs.read(`${dir}/${note.name}`).catch(() => '')
      found.push(...dueReminders(note.name, text, today))
    }
  }

  found.sort((a, b) => a.date.localeCompare(b.date))
  await update($, due, () => found)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reminders = await read($, due)

    if (e.props.hasSurvey || reminders.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {reminders.map(r => (
          <Text color="yellow">
            Due {r.date}: {r.text} <Text dimColor>({r.file})</Text>
          </Text>
        ))}
        <Button key="hide" label="Hide for this session" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
