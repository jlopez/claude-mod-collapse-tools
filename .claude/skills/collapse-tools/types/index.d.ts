declare module 'claude-code' {
  interface PluginState {
    'collapse-tools': {
      collapsed: boolean
      epoch: number
      hinted: boolean
      doneColorOverride: string | null
      summariesOn: boolean | null
      syntaxPaletteOverride: string | null
      overrides: StateFamily<{ epoch: number; open: boolean }>
    }
  }
}
