// What the mod knows about the session's directory. `branch` is null when the
// directory is not inside a git repository.
export type RepoInfo = { cwd: string; branch: string | null; isDirty: boolean }

declare module 'claude-code' {
  interface PluginState {
    'repo-context': { info: RepoInfo | null }
  }
}
