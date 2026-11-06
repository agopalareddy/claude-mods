// Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) and prints token
// totals per local day and model as JSON. Transcripts are append-only, so each file
// is read from where the last run stopped; totals live in the cache file, which also
// keeps days whose transcripts Claude Code has since deleted.
//
// usage: node scan.mjs <cache.json> [projects dir]
import { mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const cachePath = process.argv[2]
const root = process.argv[3] ?? join(homedir(), '.claude', 'projects')

// files: path -> bytes read; seen: message key -> output tokens counted;
// days: 'YYYY-MM-DD' -> model -> [requests, input, output, cacheRead, write5m, write1h].
let cache = { files: {}, seen: {}, days: {}, last: null }
try { cache = JSON.parse(readFileSync(cachePath, 'utf8')) } catch {}

function* jsonlFiles(dir) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* jsonlFiles(p)
    else if (e.name.endsWith('.jsonl')) yield p
  }
}

const localDay = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function add(line) {
  if (!line.includes('"usage"')) return
  let o
  try { o = JSON.parse(line) } catch { return }
  const m = o.message
  const u = m?.usage
  if (o.type !== 'assistant' || !u || !m.model || m.model === '<synthetic>') return
  const key = `${m.id}:${o.requestId}`
  const out = u.output_tokens ?? 0
  const at = Date.parse(o.timestamp)
  const model = u.speed === 'fast' ? `${m.model}:fast` : m.model
  const row = ((cache.days[localDay(at)] ??= {})[model] ??= [0, 0, 0, 0, 0, 0])
  // One API message is written as one line per content block, each repeating the
  // usage; count its input once and its output at the largest value seen.
  if (key in cache.seen) {
    if (out > cache.seen[key]) { row[2] += out - cache.seen[key]; cache.seen[key] = out }
    return
  }
  cache.seen[key] = out
  const w = u.cache_creation
  const w1h = w?.ephemeral_1h_input_tokens ?? 0
  const w5m = w ? (w.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0)
  row[0] += 1
  row[1] += u.input_tokens ?? 0
  row[2] += out
  row[3] += u.cache_read_input_tokens ?? 0
  row[4] += w5m
  row[5] += w1h
  if (!cache.last || at > cache.last.at) cache.last = { at, ttl: w1h > 0 ? 60 : w5m > 0 ? 5 : cache.last?.ttl ?? 5 }
}

for (const path of jsonlFiles(root)) {
  const size = statSync(path).size
  let from = cache.files[path] ?? 0
  if (size < from) from = 0 // ponytail: a rewritten file is read again; its keys are already in `seen`
  if (size === from) continue
  const buf = Buffer.alloc(size - from)
  const fd = openSync(path, 'r')
  readSync(fd, buf, 0, buf.length, from)
  closeSync(fd)
  // Stop at the last newline: a line still being written is read next time.
  const end = buf.lastIndexOf(10) + 1
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) add(line)
  cache.files[path] = from + end
}

mkdirSync(dirname(cachePath), { recursive: true })
writeFileSync(cachePath, JSON.stringify(cache))
process.stdout.write(JSON.stringify({ days: cache.days, ttl: cache.last?.ttl ?? 5, today: localDay(Date.now()) }))
