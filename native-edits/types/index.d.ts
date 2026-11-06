// Failed Edit/Write calls per absolute file path since the last success.
export type NativeEditsFailures = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'native-edits': { failures: NativeEditsFailures }
  }
}
