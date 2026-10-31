import { expect, test } from 'claude-code/testing'
import {
  DEFAULT_DONE_COLOR,
  MARGIN,
  STATUS_COLOR,
  collapsedSegments,
  expandedRows,
  formatToolName,
  isExpanded,
  keepsEngineRow,
  pickArg,
  segmentsText,
  statusOf,
  truncate,
} from './summary'
import { describe } from './summarize'

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
  expect(nameOf(expandedRows(call, 80, 'cyan').header)?.color).toBe('cyan')
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

const lines = (rows: ReturnType<typeof expandedRows>['fields']) => rows.map(segmentsText)

test('the expanded header is the collapsed row with the [-] marker, status word included', () => {
  const inputs = [{ command: 'ls -la' }, { command: 'x'.repeat(300), timeout: 5 }, { command: 'a  b' }]
  for (const input of inputs) {
    for (const flags of [{}, { isRunning: true }, { isErrored: true }]) {
      const c = { ...call, ...flags, input }
      expect(segmentsText(expandedRows(c, 80).header)).toBe(segmentsText(collapsedSegments(c, 80)).replace('[+]', '[-]'))
      const summary = 'Run the full gate'
      expect(segmentsText(expandedRows(c, 80, undefined, summary).header)).toBe(
        segmentsText(collapsedSegments(c, 80, undefined, summary)).replace('[+]', '[-]'),
      )
    }
  }
})

test('with a summary the description is left out and the command leads the field list', () => {
  const input = { timeout: 120000, description: 'Run the full gate', command: 'npm run check' }
  const open = expandedRows({ ...call, input }, 80, undefined, 'Run the full gate')
  expect(segmentsText(open.header)).toBe('[-] Bash  Run the full gate')
  expect(lines(open.fields)).toEqual(['    command: npm run check', '    timeout: 120000'])
  expect(open.fields[0]).toEqual([
    { text: '    ' },
    { text: 'command: ', color: 'suggestion' },
    { text: 'npm run check', dim: true },
  ])
})

test('without a summary the picked arg is left out when drawn whole and kept when cut', () => {
  const input = { command: 'npm run check', description: 'Run the full gate' }
  const whole = expandedRows({ ...call, input }, 80)
  expect(segmentsText(whole.header)).toBe('[-] Bash  npm run check')
  expect(lines(whole.fields)).toEqual(['    description: Run the full gate'])

  const cmd = 'y'.repeat(150)
  const cut = expandedRows({ ...call, input: { command: cmd, timeout: 5000 } }, 80)
  expect(segmentsText(cut.header).endsWith('...')).toBe(true)
  expect(lines(cut.fields)).toEqual([`    command: ${cmd}`, '    timeout: 5000'])

  // A cut summary keeps the description; whitespace the header collapsed keeps the field too.
  const longSummary = 'd'.repeat(200)
  const kept = expandedRows({ ...call, input: { command: 'ls', description: longSummary } }, 80, undefined, longSummary)
  expect(lines(kept.fields)).toEqual(['    command:     ls', `    description: ${longSummary}`])
  const spaced = expandedRows({ ...call, input: { command: 'a  b' } }, 80)
  expect(lines(spaced.fields)).toEqual(['    command: a  b'])
})

test('a multi-line command shows its first line in the header and every line in the list', () => {
  const command = 'cat <<EOF > out.txt\n  indented  line\nlast   \nEOF\n'
  const open = expandedRows({ ...call, input: { command, timeout: 5 } }, 80)
  expect(segmentsText(open.header)).toBe('[-] Bash  cat <<EOF > out.txt')
  expect(lines(open.fields)).toEqual([
    '    command: cat <<EOF > out.txt',
    '               indented  line',
    '             last',
    '             EOF',
    '    timeout: 5',
  ])
  expect(open.fields[1]).toEqual([{ text: ' '.repeat(13) }, { text: '  indented  line', dim: true }])
})

test('a multi-line value keeps the indentation of its first line, so code stays aligned', () => {
  const input = { file_path: 'a.ts', old_string: '\n    if (x) {\n      y()\n    }\n\n' }
  const open = expandedRows({ ...call, tool: 'Edit', input }, 80)
  expect(segmentsText(open.header)).toBe('[-] Edit  a.ts')
  expect(lines(open.fields)).toEqual([
    '    old_string:     if (x) {',
    `${' '.repeat(16)}      y()`,
    `${' '.repeat(16)}    }`,
  ])
  expect(open.fields[0]?.[2]).toEqual({ text: '    if (x) {', dim: true })
})

test('a lone carriage return breaks the line and other control characters but tab are dropped', () => {
  const input = { command: "printf 'a\rb'", description: 'x\u001by\tz', blank: '\u0001 ' }
  const open = expandedRows({ ...call, input }, 80)
  expect(segmentsText(open.header)).toBe("[-] Bash  printf 'a")
  expect(lines(open.fields)).toEqual(["    command:     printf 'a", `${' '.repeat(17)}b'`, '    description: xy\tz'])
  expect(lines(open.fields).some(line => /[\r\u0000-\u0008\u000b-\u001f]/.test(line))).toBe(false)
})

test('a summary the cleaning changed does not stand for the description, which stays in the list', () => {
  const input = { command: 'npm test', description: 'Run `npm test`\nthen lint.' }
  const open = expandedRows({ ...call, input }, 80, undefined, describe('Bash', input) ?? undefined)
  expect(segmentsText(open.header)).toBe('[-] Bash  Run npm test then lint')
  expect(lines(open.fields)).toEqual([
    '    command:     npm test',
    '    description: Run `npm test`',
    `${' '.repeat(17)}then lint.`,
  ])
})

test('labels pad to the widest key, capped at 16 columns; a longer key gets one space', () => {
  const input = { command: 'z'.repeat(200), a: 1, a_very_long_key_name: 'v' }
  expect(lines(expandedRows({ ...call, input }, 80).fields)).toEqual([
    `    command:         ${'z'.repeat(200)}`,
    '    a:               1',
    '    a_very_long_key_name: v',
  ])
})

test('the list orders the arg fields first, shows JSON, null and scalars, and skips empty strings', () => {
  const input = { nodes: [{ title: 'a' }], meta: { k: 1 }, gone: null, blank: '  ', flag: true, op: 'set', title: 'plan' }
  const open = expandedRows({ ...call, input }, 80)
  expect(segmentsText(open.header)).toBe('[-] Bash  plan')
  expect(lines(open.fields)).toEqual([
    '    op:    set',
    '    nodes: [{"title":"a"}]',
    '    meta:  {"k":1}',
    '    gone:  null',
    '    flag:  true',
  ])
})

test('no field list line is cut, however long', () => {
  const note = 'n'.repeat(5000)
  const open = expandedRows({ ...call, input: { command: 'ls', note } }, 80)
  expect(lines(open.fields)).toEqual([`    note: ${note}`])
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

test('a Bash or Monitor command with no line break is laid out one clause per line; other tools and multi-line commands are not', () => {
  const texts = (tool: string, command: string) =>
    expandedRows({ ...call, tool, input: { command } }, 80, undefined, 'Do it').fields.map(row => segmentsText(row))
  expect(texts('Bash', 'a && b')).toEqual(['    command: a', '             && b'])
  expect(texts('Monitor', 'a && b')).toEqual(['    command: a', '             && b'])
  expect(texts('mcp__x__y', 'a && b')).toEqual(['    command: a && b'])
  expect(texts('Bash', 'a && b\nc')).toEqual(['    command: a && b', '             c'])
})

test('an expanded multi-clause shell command is highlighted under weight; label and indents are unchanged', () => {
  const input = { command: 'git status && git log -1 "$REF"', description: 'Show git' }
  const open = expandedRows({ ...call, input }, 80, undefined, 'Show git')
  expect(lines(open.fields)).toEqual(['    command: git status', '             && git log -1 "$REF"'])
  expect(open.fields[0]).toEqual([
    { text: '    ' },
    { text: 'command: ', color: 'suggestion' },
    { text: 'git', bold: true },
    { text: ' status', dim: true },
  ])
  expect(open.fields[1]).toEqual([
    { text: ' '.repeat(13) },
    { text: '&&', color: 'suggestion' },
    { text: ' ', dim: true },
    { text: 'git', bold: true },
    { text: ' log -1 ', dim: true },
    { text: '"$REF"' },
  ])
  // Monitor commands take the same path.
  expect(expandedRows({ ...call, tool: 'Monitor', input }, 80, undefined, 'Show git').fields[1]?.[1]).toEqual({
    text: '&&',
    color: 'suggestion',
  })
})

test('the single-clause, multi-line and unterminated commands and non-shell fields stay one dim run per line', () => {
  const dimRuns = (rows: ReturnType<typeof expandedRows>['fields']) => rows.map(row => row.slice(-1))
  const single = expandedRows({ ...call, input: { command: 'git status' } }, 80, undefined, 'Do it')
  expect(single.fields[0]?.[2]).toEqual({ text: 'git status', dim: true })
  const multi = expandedRows({ ...call, input: { command: 'a && b\nc' } }, 80, undefined, 'Do it')
  expect(dimRuns(multi.fields)).toEqual([[{ text: 'a && b', dim: true }], [{ text: 'c', dim: true }]])
  const open = expandedRows({ ...call, input: { command: "echo 'a && b" } }, 80, undefined, 'Do it')
  expect(open.fields[0]?.[2]).toEqual({ text: "echo 'a && b", dim: true })
  const other = expandedRows({ ...call, tool: 'mcp__x__y', input: { command: 'a && b' } }, 80, undefined, 'Do it')
  expect(other.fields).toEqual([[{ text: '    ' }, { text: 'command: ', color: 'suggestion' }, { text: 'a && b', dim: true }]])
  const field = expandedRows({ ...call, input: { command: 'ls', note: 'x && y' } }, 80)
  expect(field.fields).toEqual([[{ text: '    ' }, { text: 'note: ', color: 'suggestion' }, { text: 'x && y', dim: true }]])
})

test('the palette threads from expandedRows: off is all dim, status takes the done color; the header is unchanged', () => {
  const input = { command: 'a && b "s"' }
  const c = { ...call, input }
  const off = expandedRows(c, 80, 'cyan', 'Do it', 'off')
  expect(off.fields).toEqual([
    [{ text: '    ' }, { text: 'command: ', color: 'suggestion' }, { text: 'a', dim: true }],
    [{ text: ' '.repeat(13) }, { text: '&& b "s"', dim: true }],
  ])
  const status = expandedRows(c, 80, 'cyan', 'Do it', 'status')
  expect(status.fields[1]).toEqual([
    { text: ' '.repeat(13) },
    { text: '&&', color: 'suggestion' },
    { text: ' ', dim: true },
    { text: 'b', bold: true, color: 'cyan' },
    { text: ' ', dim: true },
    { text: '"s"', color: 'success' },
  ])
  // The default is weight.
  expect(expandedRows(c, 80, 'cyan', 'Do it').fields).toEqual(expandedRows(c, 80, 'cyan', 'Do it', 'weight').fields)
  for (const palette of ['weight', 'status', 'off'] as const) {
    expect(expandedRows(c, 80, 'cyan', 'Do it', palette).header).toEqual(expandedRows(c, 80, 'cyan', 'Do it').header)
    expect(lines(expandedRows(c, 80, 'cyan', 'Do it', palette).fields)).toEqual(['    command: a', '             && b "s"'])
  }
})
