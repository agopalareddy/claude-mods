// A `remind:` line that is due: its date (YYYY-MM-DD), its text, and the
// memory note it came from (file name only).
export type MemoryReminder = { date: string; text: string; file: string }

declare module 'claude-code' {
  interface PluginState {
    'memory-reminders': { due: MemoryReminder[]; isHidden: boolean }
  }
}
