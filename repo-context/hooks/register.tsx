import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RepoInfo } from '../types'

const info = atom({ plugin: 'repo-context', key: 'info' } as const, null)

// Reads the branch and whether the work tree has changes, then updates the
// status line and the value the band draws from.
// ponytail: refreshed at session start and after each turn only; a `cd` mid-turn shows next turn.
async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  const isRepo = head.exitCode === 0
  const branch = isRepo ? head.stdout.trim() : null
  const isDirty = isRepo
    && (await $.process.run(['git', 'status', '--porcelain'], { cwd })).stdout.trim() !== ''

  const next: RepoInfo = { cwd, branch, isDirty }
  await update($, info, () => next)
  $.ui.status(branch === null ? undefined : `git: ${branch}${isDirty ? '*' : ''}`)
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
    const repo = await read($, info)

    if (e.props.hasSurvey || repo === null || repo.branch !== null) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return (
      <Text color="yellow">
        Not in a git repo: {repo.cwd}
      </Text>
    )
  })
}
