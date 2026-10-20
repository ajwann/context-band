import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { barSegments, compose, formatCount, settingsFrom, sparkline, turnsToCompact } from './register'
import type { Extra } from './register'
import type { Row, Snapshot } from '../types'

const ROWS: Row[] = [
  { name: 'System prompt', tokens: 3_000, color: 'promptBorder', kind: 'used' },
  { name: 'MCP tools', tokens: 12_000, color: 'claude', kind: 'used' },
  { name: 'Messages', tokens: 29_000, color: 'permission', kind: 'used' },
  { name: 'Free space', tokens: 123_000, color: 'inactive', kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer' },
  { name: 'MCP tools (deferred)', tokens: 9_000, color: 'inactive', kind: 'deferred' },
]

const USAGE: SessionUsage = {
  startedAt: 0,
  rateLimits: [{ kind: 'five_hour', percentUsed: 34 }],
  cost: { usd: 1.5 },
  context: {
    tokens: 44_000,
    window: 200_000,
    percent: 22,
    breakdown: {
      categories: ROWS.map(row => ({ ...row, isDeferred: row.kind === 'deferred' })),
      totalTokens: 44_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autocompactSource: 'auto',
      percentage: 22,
      gridRows: [],
      model: 'claude-opus-5-5',
      memoryFiles: [],
      mcpTools: [
        { name: 'mcp__github__a', serverName: 'github', tokens: 8_000, isLoaded: true },
        { name: 'mcp__linear__a', serverName: 'linear', tokens: 4_000, isLoaded: true },
        { name: 'mcp__slack__a', serverName: 'slack', tokens: 9_000, isLoaded: false },
      ],
      agents: [],
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      apiUsage: { input_tokens: 4_000, output_tokens: 500, cache_read_input_tokens: 36_000, cache_creation_input_tokens: 4_000 },
    },
  },
}

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const SNAP: Snapshot = {
  tokens: 100_000,
  window: 200_000,
  max: 200_000,
  rows: [],
  compactAt: 160_000,
  isAutoCompact: true,
  overhead: 20_000,
  mcpSize: 0,
  limits: [],
}

const EXTRA: Extra = { deltas: [], turns: 0, compaction: null, isWorking: false }
const text = (lines: ReturnType<typeof compose>) =>
  lines.map(line => line.map(chunk => chunk.map(part => part.text).join('')).join(' · ')).join('\n')
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

test('formatCount shortens counts', async () => {
  expect(formatCount(950)).toBe('950')
  expect(formatCount(1234)).toBe('1.2k')
  expect(formatCount(84_100)).toBe('84k')
  expect(formatCount(1_000_000)).toBe('1.0M')
})

test('bar segments fill the width exactly, deferred rows left out', async () => {
  for (const width of [10, 17, 33, 40]) {
    const segments = barSegments(ROWS, 200_000, width)
    expect(segments.reduce((sum, seg) => sum + seg.cells, 0)).toBe(width)
  }
  expect(barSegments([], 200_000, 20)).toEqual([])
})

test('turnsToCompact projects from the recent average growth', async () => {
  expect(turnsToCompact(SNAP, [10_000, 20_000])).toBe(4)
  expect(turnsToCompact(SNAP, [])).toBe(null)
  expect(turnsToCompact(SNAP, [0])).toBe(null)
  expect(turnsToCompact({ ...SNAP, tokens: 170_000 }, [5_000])).toBe(0)
  expect(turnsToCompact({ ...SNAP, compactAt: undefined }, [5_000])).toBe(null)
  expect(turnsToCompact({ ...SNAP, isAutoCompact: false }, [5_000])).toBe('off')
})

test('sparkline scales to the largest turn', async () => {
  expect(sparkline([0, 5_000, 10_000])).toBe('▁▄█')
})

test('settings fall back to defaults and honour each option', async () => {
  const defaults = settingsFrom({})
  expect(defaults.bar).toBe(true)
  expect(defaults.cost).toBe(false)
  expect(defaults.warnPercent).toBe(60)
  const custom = settingsFrom({ showBar: false, showCost: true, warnPercent: 50 })
  expect(custom.bar).toBe(false)
  expect(custom.cost).toBe(true)
  expect(custom.warnPercent).toBe(50)
})

test('compose shows only what is switched on', async () => {
  const all = settingsFrom({ showCost: true, showTurnCount: true, showRoomLeft: true })
  const snap = { ...SNAP, percent: 50, costUsd: 2.25 }
  const extra = { ...EXTRA, deltas: [10_000, 20_000], turns: 2, compaction: { before: 168_000, after: 22_000 } }
  const shown = text(compose(snap, extra, all))
  expect(shown).toMatch(/50% · 100k \/ 200k/)
  expect(shown).toMatch(/\+20k last turn/)
  expect(shown).toMatch(/~4 turns to compact/)
  expect(shown).toMatch(/60k until compact/)
  expect(shown).toMatch(/Overhead 20k \(10%\)/)
  expect(shown).toMatch(/turn 2 since compact/)
  expect(shown).toMatch(/last compact 168k → 22k/)
  expect(shown).toMatch(/2\.25/)

  const off = ['showPercent', 'showGrowth', 'showTrend', 'showTurnsLeft', 'showOverhead', 'showLastCompact', 'showHint']
  const none = settingsFrom(Object.fromEntries(off.map(key => [key, false])))
  expect(text(compose(snap, extra, none))).toBe('')
})

test('the warning hint follows the thresholds', async () => {
  const hint = /quality can slip/
  expect(text(compose({ ...SNAP, percent: 40, tokens: 80_000 }, EXTRA, settingsFrom({})))).not.toMatch(hint)
  expect(text(compose({ ...SNAP, percent: 65 }, EXTRA, settingsFrom({})))).toMatch(hint)
  expect(text(compose({ ...SNAP, percent: 30, tokens: 300_000 }, EXTRA, settingsFrom({ warnSize: 250_000 })))).toMatch(hint)
  expect(text(compose({ ...SNAP, percent: 65 }, EXTRA, settingsFrom({ showHint: false })))).not.toMatch(hint)
})

test('the band shows the live figures and hides on command', async ($, on) => {
  let tokens = 40_000
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, tokens } } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['SIBLING'] }))

  const before = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await before.find({ type: 'Text', text: /SIBLING/ })).toBeDefined()
  expect(await before.find({ type: 'Text', text: /200k/ })).toBeUndefined()
  await before.unmount()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  tokens = 44_000
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'next-context', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /22% · 44k \/ 200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+4\.0k last turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /~30 turns to compact/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Overhead 15k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MCP 12k \(github 8\.0k\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages 29k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\.50/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /SIBLING/ })).toBeDefined()
    await ui.unmount()

    const survey = await $.ui.mount({
      plugin: 'next-context',
      surface,
      component: 'AbovePrompt',
      props: { ...PROPS, hasSurvey: true },
    })
    expect(await survey.find({ type: 'Text', text: /200k/ })).toBeUndefined()
    expect(await survey.find({ type: 'Text', text: /SIBLING/ })).toBeDefined()
    await survey.unmount()
  }

  const listed = await $.command.run({ command: 'next-context', args: 'list', ...RUN })
  expect(JSON.stringify(listed)).toMatch(/○ cost/)

  await $.command.run({ command: 'next-context', args: '', ...RUN })
  const hidden = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await hidden.find({ type: 'Text', text: /200k/ })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: /SIBLING/ })).toBeDefined()
  await hidden.unmount()
})

test(
  'options switch items on in the live band',
  { options: { showCost: true, showCacheHit: true, showRateLimits: true, showLegend: false } },
  async ($, on) => {
    on('session.usage', () => ({ value: USAGE }))
    on('turn.complete', () => ({ text: 'ok' }))
    on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const ui = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ type: 'Text', text: /1\.50/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache 82% hit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 34%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages 29k/ })).toBeUndefined()
    await ui.unmount()
  },
)

test('rows wrap whole data points rather than truncating on a narrow terminal', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 40 } })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toMatch(/"flexWrap":"wrap"/)
  expect(drawn).not.toMatch(/truncate/)
  expect(await ui.find({ type: 'Text', text: /Free space 123k/ })).toBeDefined()
  await ui.unmount()
})

test('/next-context <item> on|off switches an item for this session', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const done = await $.command.run({ command: 'next-context', args: 'cost on', ...RUN })
  expect(JSON.stringify(done)).toMatch(/cost on for this session/)
  await $.command.run({ command: 'next-context', args: 'legend off', ...RUN })

  const ui = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /1\.50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Messages 29k/ })).toBeUndefined()
  await ui.unmount()

  const listed = await $.command.run({ command: 'next-context', args: 'list', ...RUN })
  expect(JSON.stringify(listed)).toMatch(/● cost/)
  expect(JSON.stringify(listed)).toMatch(/○ legend/)

  const bad = await $.command.run({ command: 'next-context', args: 'cost maybe', ...RUN })
  expect(JSON.stringify(bad)).toMatch(/Usage: \/next-context cost on\|off/)
  const unknown = await $.command.run({ command: 'next-context', args: 'nonsense', ...RUN })
  expect(JSON.stringify(unknown)).toMatch(/Unknown item/)
})

test('a compaction shows its before and after, and growth starts over', async ($, on) => {
  let tokens = 40_000
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, tokens } } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary, tokensBefore: 168_000, tokensAfter: 22_000 }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  tokens = 44_000
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.session.compact({ trigger: 'auto', messages: summary })

  const ui = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /last compact 168k → 22k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
  await ui.unmount()
})

test('the session\'s first turn counts, though it has no growth to show', { options: { showTurnCount: true } }, async ($, on) => {
  let tokens: number | undefined
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, tokens } } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  const turn = async (id: string, after: number) => {
    await $.turn.start({ text: 'hi', turnId: id })
    tokens = after
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
  }
  await turn('t1', 40_000)
  await turn('t2', 46_000)
  await turn('t3', 52_000)

  const ui = await $.ui.mount({ plugin: 'next-context', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /turn 3 since compact/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+6\.0k last turn/ })).toBeDefined()
  await ui.unmount()
})
