export type TuiKitExamplePicked = number

declare module 'claude-code' {
  interface PluginState {
    'tui-kit-example': { picked: TuiKitExamplePicked }
  }
}
