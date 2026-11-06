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
}

export type RepoCommit = { hash: string; subject: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'repo-context': {
      info: Shaped<RepoInfo | null>
      // The git action running from the pane ("pull", "push", "switch"), or null.
      busy: string | null
    }
  }
}
