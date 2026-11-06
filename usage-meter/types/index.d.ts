// Token counts of a set of API requests:
// [requests, input, output, cache reads, 5-minute cache writes, 1-hour cache writes].
export type Counts = [number, number, number, number, number, number]

// What scripts/scan.mjs found in the transcripts: counts per local day
// ('YYYY-MM-DD') and model, the cache lifetime of the newest request in minutes,
// and today's date where the scan ran.
export type History = {
  days: Record<string, Record<string, Counts>>
  ttl: number
  today: string
}

// This session's own turns, from `turn.complete`.
export type SessionUse = {
  model: string | null
  counts: Counts
  // Input of the last turn's last request: what a cold cache would write again.
  context: number
  lastTurnAt: number
}

// /keepwarm while on: pings the cache shortly before it would lapse, until `until`.
export type Warm = {
  until: number
  ttl: number
  pings: number
  lastPingAt: number
  spentUsd: number
  // Why the last ping failed, or null.
  error: string | null
}

export type RangeKey = 'day' | 'week' | 'month' | 'year' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      history: Shaped<History | null>
      session: Shaped<SessionUse>
      warm: Shaped<Warm | null>
      range: RangeKey
    }
  }
}
