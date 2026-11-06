import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderNode } from 'claude-code'
import type { Counts, History, RangeKey, SessionUse, Warm } from '../types'

const PANE = 'usage-meter'
const history = atom({ plugin: 'usage-meter', key: 'history' } as const, null, { shape: 'history-1' })
const session = atom({ plugin: 'usage-meter', key: 'session' } as const,
  { model: null, counts: [0, 0, 0, 0, 0, 0], context: 0, lastTurnAt: 0 }, { shape: 'session-1' })
const warm = atom({ plugin: 'usage-meter', key: 'warm' } as const, null, { shape: 'warm-1' })
const range = atom({ plugin: 'usage-meter', key: 'range' } as const, 'month')

// $/MTok: input, output, cache read. First prefix the model id starts with wins, so
// longer ids come first. Cache writes are 1.25x input (5 minutes) and 2x (1 hour).
// ponytail: list prices from the claude-api skill on 2026-11-06; Haiku 5.5 above 100K-token prompts costs 5x and is priced as below it.
const PRICES: [string, number, number, number][] = [
  ['claude-opus-5-5:fast', 8, 40, 0.4],
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1],
  ['claude-mythos-5', 10, 50, 1],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4-8', 5, 25, 0.5],
  ['claude-opus-4-7', 5, 25, 0.5],
  ['claude-opus-4-6', 5, 25, 0.5],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet-4', 3, 15, 0.3],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01],
  ['claude-haiku-4-5', 1, 5, 0.1],
]

const price = (model: string) => PRICES.find(([prefix]) => model.startsWith(prefix))

// What the counts cost, what cache reads saved against paying full input, and the
// extra paid to write the cache. Null for a model with no price.
export function money(model: string, c: Counts) {
  const p = price(model)
  if (!p) return null
  const [, inp, out, hit] = p
  return {
    usd: (c[1] * inp + c[2] * out + c[3] * hit + c[4] * inp * 1.25 + c[5] * inp * 2) / 1e6,
    saved: (c[3] * (inp - hit)) / 1e6,
    premium: (c[4] * inp * 0.25 + c[5] * inp) / 1e6,
  }
}

const RANGES: [RangeKey, string, number][] = [
  ['day', 'Today', 1],
  ['week', '7 days', 7],
  ['month', '30 days', 30],
  ['year', '365 days', 365],
  ['all', 'All time', Infinity],
]

// Days `n` back from `today` (both 'YYYY-MM-DD'), counted in UTC so the plugin's own
// time zone does not matter.
const dayBefore = (today: string, n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10)

// Counts per model over the last `days` days, newest day being the scan's today.
export function totals(h: History, days: number) {
  const from = days === Infinity ? '' : dayBefore(h.today, days - 1)
  const byModel: Record<string, Counts> = {}
  for (const [day, models] of Object.entries(h.days)) {
    if (day < from) continue
    for (const [model, c] of Object.entries(models)) {
      const t = (byModel[model] ??= [0, 0, 0, 0, 0, 0])
      c.forEach((v, i) => { t[i]! += v })
    }
  }
  return byModel
}

function sum(byModel: Record<string, Counts>) {
  let usd = 0, saved = 0, premium = 0, tokens = 0, requests = 0, unpriced = false
  for (const [model, c] of Object.entries(byModel)) {
    const m = money(model, c)
    if (m) { usd += m.usd; saved += m.saved; premium += m.premium } else unpriced = true
    tokens += c[1] + c[2] + c[3] + c[4] + c[5]
    requests += c[0]
  }
  return { usd, saved, premium, tokens, requests, unpriced }
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`
const tok = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)

async function scan($: EngineInterface) {
  const cache = `${await $.env.get('HOME')}/.cache/usage-meter/usage.json`
  const ran = await $.process.run(['node', `${$.plugin.root}/scripts/scan.mjs`, cache], { timeoutMs: 120_000 })
  if (ran.exitCode !== 0) return
  const h = JSON.parse(ran.stdout) as History
  await update($, history, () => h)
}

// Minutes the cache lives: the newest request's, as the transcripts show it.
const ttlOf = async ($: EngineInterface) => (await read($, history))?.ttl ?? 5

// ---- keep warm ----

let timer: { cancel: () => void } | null = null

// Pings one minute before the cache would lapse; a ping is a fork over the session's
// own transcript, so it reads the cached prefix and resets its lifetime.
async function tick($: EngineInterface) {
  const w = await read($, warm)
  const now = await $.clock.now()
  if (!w) return stopTimer()
  if (now >= w.until) {
    await update($, warm, () => null)
    stopTimer()
    $.ui.status(undefined)
    $.ui.toast(`Keep warm off: ${w.pings} pings, ${usd(w.spentUsd)}`)
    return
  }
  const s = await read($, session)
  const idle = now - Math.max(s.lastTurnAt, w.lastPingAt)
  if (!running.size && idle >= (w.ttl - 1) * 60_000) {
    const r = await $.model.fork({ prompt: 'Keep-alive ping. Reply with only: OK' })
    const cost = 'usage' in r && r.usage ? money(s.model ?? await $.session.model(), toCounts(r.usage))?.usd ?? 0 : 0
    await update($, warm, v => v && {
      ...v, pings: v.pings + 1, lastPingAt: now, spentUsd: v.spentUsd + cost,
      error: r.isAnswered ? null : r.reason,
    })
  }
  await showStatus($)
}

function stopTimer() {
  timer?.cancel()
  timer = null
}

function startTimer($: EngineInterface) {
  if (!timer) timer = $.clock.every(30_000, () => void tick($))
}

async function showStatus($: EngineInterface) {
  const w = await read($, warm)
  if (!w) return $.ui.status(undefined)
  const left = Math.max(0, Math.round((w.until - await $.clock.now()) / 60_000))
  $.ui.status(`warm ${left}m left · ${w.pings} pings ${usd(w.spentUsd)}${w.error ? ` · last ping: ${w.error}` : ''}`)
}

// "" toggles (on for 60 minutes), "off", "90", "90m" or "2h".
export function parseKeepWarm(args: string, isOn: boolean): number | 'off' | null {
  const a = args.trim().toLowerCase()
  if (a === '') return isOn ? 'off' : 60
  if (a === 'off' || a === 'stop') return 'off'
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|hr)?$/.exec(a)
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2]?.startsWith('h') ? 60 : 1))
}

async function keepWarm($: EngineInterface, minutes: number | 'off') {
  if (minutes === 'off') {
    const w = await read($, warm)
    await update($, warm, () => null)
    stopTimer()
    $.ui.status(undefined)
    return w ? `Keep warm off: ${w.pings} pings, ${usd(w.spentUsd)}.` : 'Keep warm was off.'
  }
  const now = await $.clock.now()
  const ttl = await ttlOf($)
  await update($, warm, v => ({
    until: now + minutes * 60_000, ttl, pings: v?.pings ?? 0, lastPingAt: v?.lastPingAt ?? 0,
    spentUsd: v?.spentUsd ?? 0, error: null,
  }))
  startTimer($)
  await showStatus($)
  return `Keep warm on for ${minutes} minutes: pings the cache after ${ttl - 1} idle minutes (cache lifetime ${ttl} minutes).`
}

const toCounts = (u: ModelUsage): Counts =>
  [1, u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens, 0]

// Main-loop turns now running, by turn id; subagent turns are left out.
const running = new Set<string>()

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Usage' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'meter', description: 'Open the usage pane: cost and cache savings by day, week, month, year' })
    await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm while idle: /keepwarm [minutes|2h|off]' })
    if (await read($, warm)) startTimer($)
    void scan($)
    return started
  })

  on('command.run', { command: 'meter' }, async $ => {
    await scan($)
    await openPane($)
    return { text: 'Usage pane opened.' }
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const minutes = parseKeepWarm(e.args, (await read($, warm)) !== null)
    if (minutes === null) return { text: 'Usage: /keepwarm, /keepwarm 90, /keepwarm 2h, /keepwarm off' }
    return { text: await keepWarm($, minutes) }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) running.add(e.turnId)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!running.delete(e.turnId)) return done
    const u = done.usage
    const now = await $.clock.now()
    await update($, session, s => ({
      model: u?.model ?? s.model,
      counts: u ? s.counts.map((v, i) => v + toCounts(u)[i]!) as Counts : s.counts,
      context: u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : s.context,
      lastTurnAt: now,
    }))
    void scan($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // Not `h`: that name is the JSX factory.
    const hist = await read($, history)
    const picked = await read($, range)
    const s = await read($, session)
    const w = await read($, warm)
    const now = await $.clock.now()
    const ttl = hist?.ttl ?? 5
    const section = (title: string) => <Text dimColor size="caption" weight="semibold">{title.toUpperCase()}</Text>
    // A table row: the first cell takes the room left, the others are right-aligned
    // at their width. `first` replaces the first cell's text (a Button).
    const row = (cells: [string, number?][], key?: string, dim?: boolean, first?: RenderNode) => (
      <Box key={key} flexDirection="row">
        {first !== undefined && <Box flexGrow={1} width={0}>{first}</Box>}
        {cells.map(([text, width], i) => (i === 0 && first !== undefined) ? null : (
          <Box key={String(i)} width={width ?? 0} flexGrow={width ? 0 : 1} justifyContent={i ? 'flex-end' : 'flex-start'}>
            <Text dimColor={dim} wrap="truncate-end">{text}</Text>
          </Box>
        ))}
      </Box>
    )

    if (!hist) return <Text dimColor>Reading transcripts…</Text>

    const label = RANGES.find(r => r[0] === picked)?.[1] ?? ''
    const byModel = totals(hist,RANGES.find(r => r[0] === picked)?.[2] ?? 30)
    const t = sum(byModel)
    const models = Object.entries(byModel)
      .map(([model, c]) => ({ model, c, m: money(model, c) }))
      .sort((a, b) => (b.m?.usd ?? 0) - (a.m?.usd ?? 0))

    // This session: what a lapsed cache would cost to write again, against a ping.
    const sm = s.model ? money(s.model, s.counts) : null
    const sp = s.model ? price(s.model) : undefined
    const coldUsd = sp ? (s.context * sp[1] * (ttl >= 60 ? 2 : 1.25)) / 1e6 : null
    const pingUsd = sp ? (s.context * sp[3] + 20 * sp[2]) / 1e6 : null
    const hitRate = s.counts[3] / Math.max(1, s.counts[1] + s.counts[3] + s.counts[4] + s.counts[5])

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {section('Spend at API list prices')}
          {row([['', 0], ['Cost', 10], ['Tokens', 9], ['Cache net', 11]], 'head', true)}
          {RANGES.map(([key, name, days]) => {
            const r = sum(totals(hist, days))
            const pick = (
              <Button key={`pick:${key}`} plain label={`${key === picked ? '▸' : ' '} ${name}`}
                onPress={() => update($, range, () => key)} />
            )
            return row([[''], [usd(r.usd), 10], [tok(r.tokens), 9], [usd(r.saved - r.premium), 11]], `range:${key}`, false, pick)
          })}
          {t.unpriced && <Text dimColor>Models with no price are left out of costs.</Text>}
        </Box>

        <Box flexDirection="column">
          {section(`By model · ${label}`)}
          {row([['Model'], ['Requests', 9], ['Cost', 10]], 'mhead', true)}
          {models.map(({ model, c, m }) => row([[model], [String(c[0]), 9], [m ? usd(m.usd) : '?', 10]], `model:${model}`))}
        </Box>

        <Box flexDirection="column">
          {section(`Cache · ${label}`)}
          <Text>Reads saved {usd(t.saved)}; writes cost {usd(t.premium)} extra; net {usd(t.saved - t.premium)}.</Text>
          <Text dimColor>Without caching, this range would have cost {usd(t.usd + t.saved - t.premium)} instead of {usd(t.usd)}.</Text>
        </Box>

        <Box flexDirection="column">
          {section('This session')}
          {s.counts[0] === 0
            ? <Text dimColor>No turns since the mod loaded.</Text>
            : <Text>{s.counts[0]} turns · {sm ? usd(sm.usd) : '?'} · cache hits {Math.round(hitRate * 100)}%</Text>}
          {coldUsd !== null && pingUsd !== null && s.context > 0 && (
            <Text dimColor>
              Context {tok(s.context)} tokens: a lapsed cache costs {usd(coldUsd)} to write again; a ping costs about {usd(pingUsd)}. Cache lives {ttl} min.
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          {section('Keep warm')}
          <Text color={w ? 'green' : undefined}>
            {w
              ? `On, ${Math.max(0, Math.round((w.until - now) / 60_000))}m left · ${w.pings} pings · ${usd(w.spentUsd)}${w.error ? ` · last ping: ${w.error}` : ''}`
              : 'Off'}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="warm-1h" label={w ? 'Extend 1h' : 'Keep warm 1h'} onPress={() => void keepWarm($, 60)} />
            {w && <Button key="warm-off" label="Turn off" onPress={() => void keepWarm($, 'off')} />}
            <Button key="rescan" label="Refresh" plain onPress={() => void scan($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
