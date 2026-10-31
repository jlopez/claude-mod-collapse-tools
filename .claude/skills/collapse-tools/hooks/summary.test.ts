import { expect, test } from 'claude-code/testing'
import {
  DEFAULT_DONE_COLOR,
  EXPANDED_LINES,
  MARGIN,
  STATUS_COLOR,
  collapsedSegments,
  expandedSegments,
  formatToolName,
  isExpanded,
  keepsEngineRow,
  pickArg,
  segmentsText,
  statusOf,
  truncate,
} from './summary'

const call = { tool: 'Bash', input: { command: 'ls -la' }, isRunning: false, isErrored: false, isInterrupted: false }
const nameOf = (segments: ReturnType<typeof collapsedSegments>) => segments[1]

test('MCP tool names read server:tool; others are kept', () => {
  expect(formatToolName('mcp__github__create_issue')).toBe('github:create_issue')
  expect(formatToolName('Bash')).toBe('Bash')
})

test('the arg is the most telling field, with whitespace collapsed', () => {
  expect(pickArg({ command: 'ls\n  -la', description: 'list' })).toBe('ls -la')
  expect(pickArg({ file_path: '/a/b.ts', offset: 3 })).toBe('/a/b.ts')
  expect(pickArg({ count: 2, other: 'first string' })).toBe('first string')
  expect(pickArg(null)).toBe('')
})

test('truncate handles tiny widths and never splits a surrogate pair', () => {
  expect(truncate('abcdefghij', 6)).toBe('abc...')
  expect(truncate('abcdef', 3)).toBe('abc')
  expect(truncate('abcdef', 0)).toBe('')
  expect(truncate('\u{1F600}\u{1F600}\u{1F600}', 2)).toBe('\u{1F600}\u{1F600}')
  expect(truncate('\u{1F600}abcdefgh', 6)).toBe('\u{1F600}ab...')
})

test('status precedence is interrupted, error, running, done', () => {
  expect(statusOf({ isRunning: true, isErrored: true, isInterrupted: true })).toBe('interrupted')
  expect(statusOf({ isRunning: true, isErrored: true, isInterrupted: false })).toBe('error')
  expect(statusOf({ isRunning: true, isErrored: false, isInterrupted: false })).toBe('running')
  expect(statusOf(call)).toBe('done')
})

test('the default done color is white and not bold; problems stay bold and colored', () => {
  expect(DEFAULT_DONE_COLOR).toBe('white')
  expect(STATUS_COLOR).toEqual({ done: 'white', error: 'error', running: 'warning', interrupted: 'inactive' })
  expect(nameOf(collapsedSegments(call, 80))).toEqual({ text: 'Bash', color: 'white', bold: false })
  expect(nameOf(collapsedSegments({ ...call, isErrored: true }, 80))).toEqual({ text: 'Bash', color: 'error', bold: true })
  expect(nameOf(collapsedSegments({ ...call, isRunning: true }, 80))).toEqual({ text: 'Bash', color: 'warning', bold: true })
  expect(nameOf(collapsedSegments({ ...call, isInterrupted: true }, 80))?.color).toBe('inactive')
})

test('a chosen done color replaces the default in collapsed and expanded rows, not the problem colors', () => {
  expect(nameOf(collapsedSegments(call, 80, 'cyan'))?.color).toBe('cyan')
  expect(nameOf(expandedSegments(call, 80, 'cyan'))?.color).toBe('cyan')
  expect(nameOf(collapsedSegments({ ...call, isErrored: true }, 80, 'cyan'))?.color).toBe('error')
})

test('a done row shows no status word; other statuses end the row in their color', () => {
  expect(segmentsText(collapsedSegments(call, 80))).toBe('[+] Bash  ls -la')
  const running = collapsedSegments({ ...call, isRunning: true }, 80)
  expect(segmentsText(running).endsWith('running')).toBe(true)
  expect(running[running.length - 1]).toMatchObject({ color: 'warning' })
  // Right-aligned to the width less the margin.
  expect(segmentsText(running)).toHaveLength(76)
})

test('a long summary fills the row up to the margin, before the right-aligned status word', () => {
  const summary = 'w'.repeat(200)
  const done = segmentsText(collapsedSegments(call, 80, undefined, summary))
  expect(done).toHaveLength(80 - MARGIN)
  expect(done.endsWith('...')).toBe(true)
  const running = collapsedSegments({ ...call, isRunning: true }, 80, undefined, summary)
  expect(segmentsText(running)).toHaveLength(80 - MARGIN)
  expect(segmentsText(running).endsWith('running')).toBe(true)
  expect(running[2]?.text.endsWith('...')).toBe(true)
})

test('the collapsed row is one line: the arg is cut to fit and the width falls back to 100', () => {
  const long = { ...call, input: { command: 'x'.repeat(300) } }
  expect(segmentsText(collapsedSegments(long, 50))).toHaveLength(46)
  expect(segmentsText(collapsedSegments(long, undefined))).toHaveLength(96)
  expect(segmentsText(collapsedSegments(long, 0))).toHaveLength(96)
  expect(segmentsText(collapsedSegments({ ...long, isErrored: true }, 50))).toHaveLength(46)
  expect(segmentsText(collapsedSegments(long, 6)).length).toBeLessThanOrEqual(2)
})

test('the expanded header shows the full input, then the other fields dim, capped at the limit', () => {
  const cmd = 'y'.repeat(150)
  const open = expandedSegments({ ...call, input: { command: cmd, timeout: 5000 } }, 80)
  expect(segmentsText(open)).toBe(`[-] Bash  ${cmd}  timeout: 5000`)
  expect(open[open.length - 1]).toMatchObject({ dim: true })

  const huge = expandedSegments({ ...call, input: { command: 'z'.repeat(5000), description: 'd'.repeat(500) } }, 80)
  expect(segmentsText(huge).length).toBeLessThanOrEqual(80 * EXPANDED_LINES)
  expect(segmentsText(huge).endsWith('...')).toBe(true)
})

test('the expanded header skips array and object fields and shows scalar extras', () => {
  const input = { title: 'plan', op: 'set', nodes: [{ title: 'a' }], meta: { k: 1 } }
  const text = segmentsText(expandedSegments({ ...call, input }, 80))
  expect(text).toBe('[-] Bash  plan  op: set')
  expect(text).not.toContain('nodes')
  expect(text).not.toContain('meta')
})

test('a long string extra is single-line and cut at 40 code points', () => {
  const text = segmentsText(expandedSegments({ ...call, input: { command: 'ls', note: `a\n${'b'.repeat(100)}` } }, 80))
  expect(text).toBe(`[-] Bash  ls  note: a ${'b'.repeat(35)}...`)
})

test('only the tools whose engine row may carry more keep it', () => {
  for (const tool of ['Agent', 'AskUserQuestion', 'TodoWrite', 'ExitPlanMode']) expect(keepsEngineRow(tool)).toBe(true)
  for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'mcp__a__b']) expect(keepsEngineRow(tool)).toBe(false)
})

test('a per-call override beats the global default', () => {
  expect(isExpanded(true, undefined)).toBe(false)
  expect(isExpanded(true, true)).toBe(true)
  expect(isExpanded(false, undefined)).toBe(true)
  expect(isExpanded(false, false)).toBe(false)
})
