import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoInfo } from '../types'

const PANE = 'repo-context'
// Change the tag when RepoInfo's fields change: a value stored by an older
// version is then read as null and refreshed, not drawn with missing fields.
const info = atom({ plugin: 'repo-context', key: 'info' } as const, null, { shape: 'info-4' })
const busy = atom({ plugin: 'repo-context', key: 'busy' } as const, null)

// `## main...origin/main [ahead 1, behind 2]`, the first line of `status -b`.
export function parseBranchLine(line: string): Pick<RepoInfo, 'upstream' | 'ahead' | 'behind'> {
  const upstream = /\.\.\.(\S+)/.exec(line)?.[1] ?? null
  const ahead = Number(/ahead (\d+)/.exec(line)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(line)?.[1] ?? 0)
  return { upstream, ahead, behind }
}

// A remote URL as its web page: `git@github.com:o/r.git`, `ssh://git@github.com/o/r`
// and `https://github.com/o/r.git` all give `https://github.com/o/r`. Null for a
// local path. ponytail: assumes the host serves `/commit/<hash>` (GitHub, GitLab, Codeberg).
export function webUrl(remote: string): string | null {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](?:\d+\/)?(.+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m && m[1]!.includes('.') ? `https://${m[1]}/${m[2]}` : null
}

// Reads the repo, then updates the status line and the value the band and pane draw from.
// ponytail: refreshed at session start, after each turn and after a pane action; a `cd` mid-turn shows next turn.
async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const git = (...args: string[]) => $.process.run(['git', ...args], { cwd })
  // Two lines: the repository's top folder, then the branch.
  const head = await git('rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD')

  let next: RepoInfo
  if (head.exitCode !== 0) {
    next = { cwd, name: null, web: null, branch: null, isDirty: false, upstream: null, ahead: 0, behind: 0, branches: [], files: [], commits: [] }
  } else {
    const [top = '', branch = ''] = head.stdout.trim().split('\n')
    const [branchLine = '', ...files] = (await git('status', '--porcelain', '-b')).stdout.split('\n').filter(Boolean)
    const branches = (await git('branch', '--format=%(refname:short)')).stdout.split('\n').filter(Boolean)
    const commits = (await git('log', '-5', '--format=%h%x09%ct%x09%s')).stdout.split('\n').filter(Boolean).map(line => {
      const [hash = '', at = '0', ...subject] = line.split('\t')
      return { hash, at: Number(at) * 1000, subject: subject.join('\t') }
    })
    const name = top.split('/').filter(Boolean).at(-1) ?? top
    const sync = parseBranchLine(branchLine)
    // The tracked branch's remote (`origin` of `origin/main`), else origin.
    const remote = await git('remote', 'get-url', sync.upstream?.split('/')[0] ?? 'origin')
    const web = remote.exitCode === 0 ? webUrl(remote.stdout) : null
    next = { cwd, name, web, branch, isDirty: files.length > 0, ...sync, branches, files, commits }
  }

  await update($, info, () => next)
  $.ui.status(next.branch === null ? undefined : `git: ${next.branch}${next.isDirty ? '*' : ''}`)
}

// Runs one git action from the pane, says how it went in a toast, then refreshes.
async function act($: EngineInterface, name: string, args: string[]): Promise<void> {
  if ((await read($, busy)) !== null) return
  await update($, busy, () => name)
  try {
    const ran = await $.process.run(['git', ...args], { cwd: await $.session.cwd(), timeoutMs: 120_000 })
    // git's last line says how it ended ("Already up to date.", "error: failed to push some refs").
    const output = (ran.exitCode === 0 ? ran.stdout || ran.stderr : ran.stderr || ran.stdout).trim()
    const last = output.split('\n').at(-1)
    $.ui.toast(`git ${name}: ${ran.exitCode === 0 ? 'done' : 'failed'}${last ? ` (${last})` : ''}`)
  } catch (err) {
    $.ui.toast(`git ${name}: could not run (${String(err)})`)
  } finally {
    await update($, busy, () => null)
    await refresh($)
  }
}

// Color for a two-letter `git status --porcelain` code.
function statusColor(code: string): 'green' | 'yellow' | 'red' | 'cyan' {
  if (code === '??' || code.includes('A')) return 'green'
  if (code.includes('D')) return 'red'
  if (code.includes('R')) return 'cyan'
  return 'yellow'
}

// "now", "5m", "3h", "2d", "6w": short enough for a dim column beside the subject.
export function age(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  if (min < 60 * 24) return `${Math.floor(min / 60)}h`
  if (min < 60 * 24 * 14) return `${Math.floor(min / (60 * 24))}d`
  return `${Math.floor(min / (60 * 24 * 7))}w`
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Git' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'git', description: 'Open the git pane' })
    await refresh($)
    if ((await read($, info))?.branch != null) void openPane($)
    return started
  })

  on('command.run', { command: 'git' }, async $ => {
    await refresh($)
    await openPane($)
    return { text: 'Git pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const repo = await read($, info)

    if (e.props.hasSurvey || repo === null || repo.branch !== null) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return <Text color="yellow">Not in a git repo: {repo.cwd}</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Link, Text } = table
    // The mobile surface has no Select; it gets the pane without the branch picker.
    const Select = 'Select' in table ? table.Select : undefined
    const repo = await read($, info)
    const running = await read($, busy)

    if (repo === null || repo.branch === null) {
      return <Text dimColor>Not in a git repo{repo ? `: ${repo.cwd}` : ''}.</Text>
    }

    // One explicit sync status: what the buttons below would move.
    const [syncText, syncColor] = repo.upstream === null
      ? ['No upstream', 'yellow']
      : repo.ahead || repo.behind
        ? [[repo.behind && `${repo.behind} to pull`, repo.ahead && `${repo.ahead} to push`].filter(Boolean).join(', '), 'yellow']
        : ['In sync', 'green']
    const fileRoom = Math.max(3, (e.viewport?.rows ?? 24) - 18)
    const now = await $.clock.now()
    const section = (title: string, note: string) => (
      <Text dimColor size="caption" weight="semibold">{title.toUpperCase()}  {note}</Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {/* Where you are and whether it matches the remote, in one row. */}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text bold>{repo.name}</Text>
          {Select
            ? (
              <Select
                key="branch"
                value={repo.branch}
                options={repo.branches.map(b => ({ value: b }))}
                onSelect={(b: string) => (b === repo.branch ? undefined : void act($, 'switch', ['switch', b]))}
              />
            )
            : <Text>{repo.branch}</Text>}
          <Box flexGrow={1} />
          <Text color={syncColor}>● {syncText}</Text>
          {repo.upstream && <Text dimColor>{repo.upstream}</Text>}
        </Box>

        {/* Pull and Push stand out only when they would move commits. */}
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button
            key="pull"
            hotkey="p"
            label={repo.behind ? `Pull ↓${repo.behind}` : 'Pull'}
            variant={repo.behind ? 'primary' : 'secondary'}
            dimColor={!repo.behind}
            onPress={() => act($, 'pull', ['pull', '--ff-only'])}
          />
          <Button
            key="push"
            hotkey="u"
            label={repo.ahead ? `Push ↑${repo.ahead}` : 'Push'}
            variant={repo.ahead ? 'primary' : 'secondary'}
            dimColor={!repo.ahead && repo.upstream !== null}
            onPress={() => act($, 'push', ['push'])}
          />
          <Button key="fetch" hotkey="f" label="Fetch" variant="secondary" onPress={() => act($, 'fetch', ['fetch', '--prune'])} />
          <Button key="refresh" hotkey="r" label="Refresh" variant="secondary" onPress={() => refresh($)} />
          {running && <Text color="yellow">git {running}…</Text>}
        </Box>

        <Box flexDirection="column">
          {section('Changes', repo.files.length === 0 ? 'clean' : String(repo.files.length))}
          {repo.files.slice(0, fileRoom).map(f => (
            <Box flexDirection="row" gap={1}>
              <Text mono color={statusColor(f.slice(0, 2))}>{f.slice(0, 2).replace(/ /g, '·')}</Text>
              <Text wrap="truncate-middle">{f.slice(3)}</Text>
            </Box>
          ))}
          {repo.files.length > fileRoom && <Text dimColor>+{repo.files.length - fileRoom} more</Text>}
        </Box>

        <Box flexDirection="column">
          {section('Commits', `last ${repo.commits.length}`)}
          {repo.commits.map(c => (
            // Hash and age keep their width; the subject takes the rest and wraps.
            <Box flexDirection="row" gap={1} alignItems="flex-start">
              <Box flexShrink={0}><Text mono dimColor>{c.hash}</Text></Box>
              <Box flexGrow={1} flexShrink={1} width={0}>
                <Text wrap="wrap">
                  {repo.web ? <Link href={`${repo.web}/commit/${c.hash}`}>{c.subject}</Link> : c.subject}
                </Text>
              </Box>
              <Box flexShrink={0}><Text mono dimColor>{age(c.at, now)}</Text></Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
