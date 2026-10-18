export type Row = {
  name: string
  tokens: number
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type Snapshot = {
  percent?: number
  tokens?: number
  window: number
  max: number
  rows: Row[]
  compactAt?: number
  isAutoCompact: boolean
  overhead: number
  mcpTokens: number
  topMcp?: { name: string; tokens: number }
  cacheHit?: number
  costUsd?: number
  limits: { kind: string; percentUsed: number }[]
}

export type Compaction = { before: number; after: number }

declare module 'claude-code' {
  interface PluginState {
    'context-band': {
      snapshot: Snapshot | null
      isHidden: boolean
      history: number[]
      turnCount: number
      lastCompact: Compaction | null
      isWarned: boolean
    }
  }
}
