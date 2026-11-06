// What the mod knows about the session's directory. `branch` is null when the
// directory is not inside a git repository.
export type RepoInfo = {
  cwd: string
  branch: string | null
  isDirty: boolean
  // Tracking branch (`origin/main`), or null when the branch has none.
  upstream: string | null
  ahead: number
  behind: number
  branches: string[]
  // `git status --porcelain` lines: two status letters, a space, the path.
  files: string[]
  // Newest first; `at` is the commit time in ms since the epoch.
  commits: RepoCommit[]
  // The repository folder's name (`claude-mods`), or null outside a repo.
  name: string | null
  // The remote's web page (`https://github.com/owner/repo`), or null when it has none.
  web: string | null
  // The user's open pull requests on GitHub; empty when none or gh cannot tell.
  prs: RepoPr[]
}

export type RepoCommit = { hash: string; subject: string; at: number }

export type RepoPr = {
  number: number
  title: string
  url: string
  isDraft: boolean
  ci: 'pass' | 'fail' | 'pending' | 'none'
  review: 'approved' | 'changes' | 'waiting' | 'none'
}

// Which list a changed file sits in; a file staged and changed again is in both.
export type ChangeGroup = 'staged' | 'unstaged' | 'untracked'

// The diff open under a file row in the pane.
export type OpenDiff = { group: ChangeGroup; path: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'repo-context': {
      info: Shaped<RepoInfo | null>
      // The git action running from the pane ("pull", "push", "switch"), or null.
      busy: string | null
      diff: Shaped<OpenDiff | null>
    }
  }
}
