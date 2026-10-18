import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderChildren } from 'claude-code'

import type { Compaction, Row, Snapshot } from '../types'

const snapshot = atom({ plugin: 'context-band', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'context-band', key: 'isHidden' } as const, false)
const history = atom({ plugin: 'context-band', key: 'history' } as const, [])
const turnCount = atom({ plugin: 'context-band', key: 'turnCount' } as const, 0)
const lastCompact = atom({ plugin: 'context-band', key: 'lastCompact' } as const, null)
const isWarned = atom({ plugin: 'context-band', key: 'isWarned' } as const, false)

const HISTORY = 8
const SPARK = '▁▂▃▄▅▆▇█'

// Each data point the band can show: its `/context-band <item>` name, the
// userConfig field that holds it, and whether it is on out of the box.
export const ITEMS = [
  { item: 'bar', field: 'showBar', isDefault: true },
  { item: 'percent', field: 'showPercent', isDefault: true },
  { item: 'growth', field: 'showGrowth', isDefault: true },
  { item: 'trend', field: 'showTrend', isDefault: true },
  { item: 'turns-left', field: 'showTurnsLeft', isDefault: true },
  { item: 'room-left', field: 'showRoomLeft', isDefault: false },
  { item: 'overhead', field: 'showOverhead', isDefault: true },
  { item: 'mcp', field: 'showMcp', isDefault: true },
  { item: 'legend', field: 'showLegend', isDefault: true },
  { item: 'turn-count', field: 'showTurnCount', isDefault: false },
  { item: 'last-compact', field: 'showLastCompact', isDefault: true },
  { item: 'cache', field: 'showCacheHit', isDefault: false },
  { item: 'cost', field: 'showCost', isDefault: false },
  { item: 'limits', field: 'showRateLimits', isDefault: false },
  { item: 'hint', field: 'showHint', isDefault: true },
  { item: 'toast', field: 'toastOnWarn', isDefault: true },
] as const

export type Item = (typeof ITEMS)[number]['item']
export type Settings = Record<Item, boolean> & {
  warnPercent: number
  dangerPercent: number
  warnTokens: number
}

export function settingsFrom(options: PluginOptions): Settings {
  const num = (key: string, fallback: number) =>
    typeof options[key] === 'number' ? (options[key] as number) : fallback
  const flags = Object.fromEntries(
    ITEMS.map(({ item, field, isDefault }) => [
      item,
      typeof options[field] === 'boolean' ? (options[field] as boolean) : isDefault,
    ]),
  ) as Record<Item, boolean>

  return {
    ...flags,
    warnPercent: num('warnPercent', 60),
    dangerPercent: num('dangerPercent', 80),
    warnTokens: num('warnTokens', 0),
  }
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export type Segment = { color: string; cells: number; kind: Row['kind'] }

// Splits `width` cells among the rows in proportion to their tokens, the
// largest remainders taking the leftover cells, so the widths sum to `width`.
export function barSegments(rows: readonly Row[], max: number, width: number): Segment[] {
  const shown = rows.filter(row => row.kind !== 'deferred' && row.tokens > 0)
  if (width <= 0 || max <= 0 || shown.length === 0) return []
  const exact = shown.map(row => (row.tokens / max) * width)
  const cells = exact.map(Math.floor)
  let left = width - cells.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem)
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) {
    const at = order[k]!.i
    cells[at] = cells[at]! + 1
  }
  while (left < 0) {
    const at = cells.indexOf(Math.max(...cells))
    cells[at] = cells[at]! - 1
    left++
  }
  return shown
    .map((row, i) => ({ color: row.color, cells: cells[i]!, kind: row.kind }))
    .filter(seg => seg.cells > 0)
}

// How many more turns of the recent average growth fit before auto-compaction:
// 'off' when it is disabled, null when there is nothing to project from.
export function turnsToCompact(snap: Snapshot, deltas: readonly number[]): number | 'off' | null {
  if (!snap.isAutoCompact) return 'off'
  if (snap.compactAt === undefined || snap.tokens === undefined || deltas.length === 0) return null
  const average = deltas.reduce((a, b) => a + b, 0) / deltas.length
  if (average <= 0) return null
  return Math.max(0, Math.floor((snap.compactAt - snap.tokens) / average))
}

export function sparkline(deltas: readonly number[]): string {
  const top = Math.max(...deltas, 1)
  return deltas.map(d => SPARK[Math.min(SPARK.length - 1, Math.floor((d / top) * (SPARK.length - 1)))]).join('')
}

export function percentOf(snap: Snapshot): number {
  return snap.percent ?? Math.round(((snap.tokens ?? 0) / snap.max) * 100)
}

export function level(snap: Snapshot, settings: Settings): 'ok' | 'warn' | 'danger' {
  const percent = percentOf(snap)
  if (percent >= settings.dangerPercent) return 'danger'
  const isOverTokens = settings.warnTokens > 0 && (snap.tokens ?? 0) >= settings.warnTokens
  return percent >= settings.warnPercent || isOverTokens ? 'warn' : 'ok'
}

export type Part = { text: string; color?: string; isDim?: boolean }
// One data point: parts that stay together when a line wraps.
export type Chunk = Part[]
export type Extra = {
  deltas: readonly number[]
  turns: number
  compaction: Compaction | null
  isWorking: boolean
}

// The band's data points, line by line, from what is switched on. Each line
// wraps between its chunks; the bar is drawn as the first line's first chunk
// by the render hook.
export function compose(snap: Snapshot, extra: Extra, settings: Settings): Chunk[][] {
  const status = level(snap, settings)
  const tone = status === 'danger' ? 'error' : status === 'warn' ? 'warning' : undefined
  const solo = (parts: Part[]): Chunk[] => parts.map(part => [part])

  const core: Part[] = []
  if (settings.percent) {
    core.push({
      text: `${percentOf(snap)}% · ${fmtTokens(snap.tokens ?? 0)} / ${fmtTokens(snap.window)}${extra.isWorking ? ' ↻' : ''}`,
      color: tone,
    })
  }
  const last = extra.deltas[extra.deltas.length - 1]
  if (settings.growth && last !== undefined) core.push({ text: `+${fmtTokens(last)} last turn`, isDim: true })
  if (settings.trend && extra.deltas.length > 1) core.push({ text: sparkline(extra.deltas), isDim: true })
  if (settings['turns-left']) {
    const turns = turnsToCompact(snap, extra.deltas)
    if (turns === 'off') core.push({ text: 'auto-compact off', isDim: true })
    else if (turns !== null) {
      const text = turns === 0 ? 'compacts next turn' : `~${turns} turn${turns === 1 ? '' : 's'} to compact`
      core.push(turns <= 3 ? { text, color: 'warning' } : { text, isDim: true })
    }
  }
  if (settings['room-left'] && snap.isAutoCompact && snap.compactAt !== undefined && snap.tokens !== undefined) {
    core.push({ text: `${fmtTokens(Math.max(0, snap.compactAt - snap.tokens))} until compact`, isDim: true })
  }

  const makeup: Part[] = []
  if (settings.overhead && snap.overhead > 0) {
    makeup.push({ text: `Overhead ${fmtTokens(snap.overhead)} (${Math.round((snap.overhead / snap.max) * 100)}%)`, isDim: true })
  }
  if (settings.mcp && snap.mcpTokens > 0) {
    const top = snap.topMcp ? ` (${snap.topMcp.name} ${fmtTokens(snap.topMcp.tokens)})` : ''
    makeup.push({ text: `MCP ${fmtTokens(snap.mcpTokens)}${top}`, isDim: true })
  }
  const legend: Chunk[] = []
  if (settings.legend) {
    const used = snap.rows.filter(row => row.kind === 'used' && row.tokens > 0).sort((a, b) => b.tokens - a.tokens)
    const free = snap.rows.find(row => row.kind === 'free')
    for (const row of [...used, ...(free ? [free] : [])]) {
      legend.push([
        { text: '■ ', color: row.kind === 'free' ? 'inactive' : row.color },
        { text: `${row.name} ${fmtTokens(row.tokens)}`, isDim: true },
      ])
    }
  }

  const session: Part[] = []
  if (settings.hint && status !== 'ok') {
    session.push({ text: '⚠ quality can slip as context fills: /compact at a break point, or /clear', color: tone })
  }
  if (settings['turn-count']) session.push({ text: `turn ${extra.turns} since compact`, isDim: true })
  if (settings['last-compact'] && extra.compaction) {
    session.push({ text: `last compact ${fmtTokens(extra.compaction.before)} → ${fmtTokens(extra.compaction.after)}`, isDim: true })
  }
  if (settings.cache && snap.cacheHit !== undefined) session.push({ text: `cache ${snap.cacheHit}% hit`, isDim: true })
  if (settings.cost && snap.costUsd !== undefined) session.push({ text: `$${snap.costUsd.toFixed(2)}`, isDim: true })
  if (settings.limits) {
    for (const limit of snap.limits) {
      const label = limit.kind === 'five_hour' ? '5h' : limit.kind === 'seven_day' ? '7d' : 'spend'
      session.push({ text: `${label} ${limit.percentUsed}%`, color: limit.percentUsed >= 80 ? 'warning' : undefined, isDim: limit.percentUsed < 80 })
    }
  }

  return [solo(core), [...solo(makeup), ...legend], solo(session)].filter(line => line.length > 0)
}

const MESSAGES = /^messages$/i

async function refresh($: EngineInterface): Promise<Snapshot | null> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const { context } = usage
    const breakdown = context.breakdown
    const rows: Row[] = (breakdown?.categories ?? []).map(({ name, tokens, color, kind }) => ({ name, tokens, color, kind }))
    const servers = new Map<string, number>()
    for (const tool of breakdown?.mcpTools ?? []) {
      if (tool.isLoaded) servers.set(tool.serverName, (servers.get(tool.serverName) ?? 0) + tool.tokens)
    }
    const top = [...servers].sort((a, b) => b[1] - a[1])[0]
    const api = breakdown?.apiUsage
    const input = api ? api.input_tokens + api.cache_read_input_tokens + api.cache_creation_input_tokens : 0
    const next: Snapshot = {
      percent: context.percent ?? breakdown?.percentage,
      tokens: context.tokens ?? breakdown?.totalTokens,
      window: context.window,
      max: breakdown?.rawMaxTokens ?? context.window,
      rows,
      compactAt: breakdown?.autoCompactThreshold,
      isAutoCompact: breakdown?.isAutoCompactEnabled ?? true,
      overhead: rows.filter(row => row.kind === 'used' && !MESSAGES.test(row.name)).reduce((a, row) => a + row.tokens, 0),
      mcpTokens: [...servers.values()].reduce((a, b) => a + b, 0),
      topMcp: top ? { name: top[0], tokens: top[1] } : undefined,
      cacheHit: api && input > 0 ? Math.round((api.cache_read_input_tokens / input) * 100) : undefined,
      costUsd: usage.cost?.usd,
      limits: usage.rateLimits.map(({ kind, percentUsed }) => ({ kind, percentUsed })),
    }
    return await update($, snapshot, () => next)
  } catch {
    // Stats are a nicety: a failed read leaves the last snapshot standing.
    return null
  }
}

function itemsText(settings: Settings): string {
  return ITEMS.map(({ item }) => `${settings[item] ? '●' : '○'} ${item}`).join('   ')
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)
  // Input tokens of the last request before the running main turn began.
  let startTokens: number | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-band',
      description: 'Live context band: toggle it, or `list` / `<item> on|off` to choose what it shows',
    })
    const result = await next(e)
    await refresh($)

    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      startTokens = await $.session
        .usage()
        .then(usage => usage.context.tokens)
        .catch(() => undefined)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) void refresh($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const snap = await refresh($)
    const before = startTokens
    startTokens = undefined
    if (snap?.tokens !== undefined && before !== undefined) {
      if (snap.tokens >= before) {
        const delta = snap.tokens - before
        await update($, history, list => [...list, delta].slice(-HISTORY))
        await update($, turnCount, n => n + 1)
      } else {
        // The context shrank (a compaction or /clear): growth starts over.
        await update($, history, () => [])
        await update($, turnCount, () => 0)
      }
    }
    if (snap) {
      const status = level(snap, settings)
      const wasWarned = await read($, isWarned)
      if (status !== 'ok' && !wasWarned && settings.toast) {
        $.ui.toast(`Context at ${percentOf(snap)}%: a good time to /compact or /clear`)
      }
      await update($, isWarned, () => status !== 'ok')
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || result.skip !== undefined) return result

    const snap = await refresh($)
    const before = result.tokensBefore
    const after = result.tokensAfter ?? snap?.tokens
    if (before !== undefined && after !== undefined) {
      await update($, lastCompact, () => ({ before, after }))
    }
    await update($, history, () => [])
    await update($, turnCount, () => 0)

    return result
  })

  on('command.run', { command: 'context-band' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'list') {
      return { text: `Context band items (● on, ○ off):\n${itemsText(settings)}\nChange one with /context-band <item> on|off, or in /config.` }
    }
    const entry = ITEMS.find(({ item }) => item === word)
    if (entry) {
      if (value !== 'on' && value !== 'off') return { text: `Usage: /context-band ${entry.item} on|off` }
      const { deny } = await $.config.set({ key: `context-band.${entry.field}`, value: value === 'on' })
      return { text: deny ? `Could not change ${entry.item}: ${deny}` : `Context band: ${entry.item} ${value}.` }
    }
    if (word !== '' && word !== 'show' && word !== 'hide') {
      return { text: `Unknown item "${word}". /context-band list shows them all.` }
    }
    const hidden = await update($, isHidden, was => (word === '' ? !was : word === 'hide'))
    await refresh($)

    return { text: hidden ? 'Context band hidden.' : 'Context band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const lines = compose(
      snap,
      {
        deltas: await read($, history),
        turns: await read($, turnCount),
        compaction: await read($, lastCompact),
        isWorking: e.props.isWorking,
      },
      settings,
    ).slice(0, Math.max(1, e.props.maxRows))
    const barWidth = Math.max(10, Math.min(30, Math.floor(e.props.bodyColumns / 4)))
    const segments = settings.bar ? barSegments(snap.rows, snap.max, barWidth) : []
    if (lines.length === 0 && segments.length === 0) return next(e)

    // Each chunk is one Text in a wrapping row: a narrow terminal moves whole
    // data points to the next row, and a chunk wider than the row wraps itself.
    const drawLine = (line: Chunk[], n: number, lead?: RenderChildren) => (
      <Box key={`line-${n}`} flexDirection="row" flexWrap="wrap">
        {lead}
        {line.map((chunk, i) => (
          <Text key={`chunk-${n}-${i}`} wrap="wrap">
            {i > 0 || lead ? <Text dimColor> · </Text> : ''}
            {chunk.map((part, k) => (
              <Text key={`part-${n}-${i}-${k}`} color={part.color} dimColor={part.isDim}>
                {part.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
    const bar = (
      <Text key="bar">
        <Text dimColor>Context </Text>
        {segments.map((seg, i) => (
          <Text key={`seg-${i}`} color={seg.kind === 'used' ? seg.color : 'inactive'}>
            {(seg.kind === 'free' ? '░' : seg.kind === 'buffer' ? '▒' : '█').repeat(seg.cells)}
          </Text>
        ))}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {drawLine(lines[0] ?? [], 0, segments.length > 0 ? bar : undefined)}
        {lines.slice(1).map((line, n) => drawLine(line, n + 1))}
      </Box>
    )
  })
}
