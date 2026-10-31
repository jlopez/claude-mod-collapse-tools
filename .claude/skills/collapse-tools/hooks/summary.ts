import { DEFAULT_SYNTAX_PALETTE, formatShell, isShellTool, styleTokens, tokenize } from './shell'
import type { SyntaxPalette } from './shell'

export const DEFAULT_COLUMNS = 100
// Columns kept free at the right of a collapsed row (the engine's gutter and a cursor cell).
export const MARGIN = 4
// Two spaces between the parts of a row.
const GAP = 2
// An arg shorter than this is not worth drawing beside the name.
const MIN_ARG = 4
// Each field line of an expanded row starts this far in.
export const FIELD_INDENT = 4
// A `key:` label is padded to the widest label of the row, but not past this many columns.
export const MAX_KEY_WIDTH = 16
// Theme key the `key:` labels of an expanded row are drawn in.
export const KEY_COLOR = 'suggestion'

export const MARKER_CLOSED = '[+]'
export const MARKER_OPEN = '[-]'

// Shown once per session at start, so the clickable rows are discoverable.
export const HINT_TEXT = 'click a [+] row to expand, /collapse-tools to toggle all'

// Input fields that name what a call works on, most telling first.
const ARG_FIELDS = ['command', 'file_path', 'path', 'pattern', 'description', 'title', 'op'] as const

// Tools whose engine ToolUse row may carry more than `Name(arg)`: the expanded view keeps the
// header and then the engine's own row for them. Edit and Write are not here: their diff
// (structuredPatch) is in the tool's output, which is drawn by the ToolResult.
const KEEP_ENGINE_ROW: ReadonlySet<string> = new Set(['Agent', 'Task', 'AskUserQuestion', 'TodoWrite', 'ExitPlanMode'])

export type CallStatus = 'running' | 'error' | 'interrupted' | 'done'

// Theme keys, so the colors follow the person's theme: success green, error red, warning yellow,
// inactive gray.
export const DEFAULT_DONE_COLOR = 'white'

export const STATUS_COLOR: Readonly<Record<CallStatus, string>> = {
  done: DEFAULT_DONE_COLOR,
  error: 'error',
  running: 'warning',
  interrupted: 'inactive',
}

export type CallView = {
  tool: string
  // unknown: mirrors RenderPropsOf.ToolUse.input, which the engine types declare as unknown.
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

// One styled run of text in a row; the render hook maps it to a Text.
export type Segment = {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
}

// `mcp__server__tool` reads `server:tool`; any other name is kept.
export function formatToolName(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool
  const rest = tool.slice('mcp__'.length)
  const split = rest.indexOf('__')
  if (split <= 0 || split + 2 >= rest.length) return tool
  return `${rest.slice(0, split)}:${rest.slice(split + 2)}`
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

const length = (text: string): number => Array.from(text).length

const segmentsLength = (segments: readonly Segment[]): number =>
  segments.reduce((sum, segment) => sum + length(segment.text), 0)

export const segmentsText = (segments: readonly Segment[]): string => segments.map(segment => segment.text).join('')

export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= max) return text
  if (max <= 3) return chars.slice(0, max).join('')
  return `${chars.slice(0, max - 3).join('')}...`
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

// `raw` is the value as the model sent it; `value` the same with whitespace collapsed.
type ArgField = { key: string; value: string; raw: string }

// The most telling string field of the input, in full; null when none.
function pickArgField(input: unknown): ArgField | null {
  const record = asRecord(input)
  if (record === null) return null
  for (const key of ARG_FIELDS) {
    const value = record[key]
    if (typeof value === 'string' && squash(value) !== '') return { key, value: squash(value), raw: value }
  }
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && squash(value) !== '') return { key, value: squash(value), raw: value }
  }
  return null
}

// The most telling string field of the input, whitespace collapsed; '' when none.
export function pickArg(input: unknown): string {
  return pickArgField(input)?.value ?? ''
}

// An abort wins over an error, an error over running.
export function statusOf(call: Pick<CallView, 'isRunning' | 'isErrored' | 'isInterrupted'>): CallStatus {
  if (call.isInterrupted) return 'interrupted'
  if (call.isErrored) return 'error'
  if (call.isRunning) return 'running'
  return 'done'
}

// A finished call says nothing: its green name is the status.
// Problems stay bold so they stand out; a finished call is plain.
const isBold = (status: CallStatus): boolean => status !== 'done'

const colorOf = (status: CallStatus, doneColor: string): string =>
  status === 'done' ? doneColor : STATUS_COLOR[status]

export const statusWord = (status: CallStatus): string => (status === 'done' ? '' : status)

const validColumns = (columns: number | undefined): number =>
  columns !== undefined && columns > 0 ? columns : DEFAULT_COLUMNS

// Cuts the runs to `width` characters in total, ending with `...` where it cut.
function clipSegments(segments: readonly Segment[], width: number): Segment[] {
  if (segmentsLength(segments) <= width) return [...segments]
  const clipped: Segment[] = []
  let left = Math.max(width, 0)
  for (const segment of segments) {
    if (left <= 0) break
    const size = length(segment.text)
    if (size <= left) {
      clipped.push(segment)
      left -= size
      continue
    }
    clipped.push({ ...segment, text: truncate(segment.text, left) })
    break
  }
  return clipped
}

// The value a header draws after the name: its text and the input field it stands for (null when
// it stands for none). `whole` says the text is that field in full, single line, as sent.
type MainValue = { text: string; key: string | null; whole: boolean }

// `marker Name  arg            status`, cut to `columns` less the margin. `shown` is the key of the
// field the row drew whole, or null when it drew none that way.
function headerRow(
  call: CallView,
  columns: number | undefined,
  doneColor: string,
  marker: string,
  main: MainValue | null,
): { segments: Segment[]; shown: string | null } {
  const width = Math.max(validColumns(columns) - MARGIN, 1)
  const status = statusOf(call)
  const color = colorOf(status, doneColor)
  const word = statusWord(status)
  const segments: Segment[] = [
    { text: `${marker} `, dim: true },
    { text: formatToolName(call.tool), color, bold: isBold(status) },
  ]
  const wordRoom = word === '' ? 0 : GAP + length(word)
  const argRoom = width - segmentsLength(segments) - GAP - wordRoom
  let shown: string | null = null
  if (main !== null && main.text !== '' && argRoom >= MIN_ARG) {
    const text = truncate(main.text, argRoom)
    segments.push({ text: ' '.repeat(GAP) + text, dim: true })
    if (main.whole && text === main.text) shown = main.key
  }
  if (word !== '') {
    const pad = Math.max(GAP, width - segmentsLength(segments) - length(word))
    segments.push({ text: ' '.repeat(pad) + word, color })
  }
  const clipped = clipSegments(segments, width)
  // A clip past the status word may have cut into the value too: then it was not drawn whole.
  if (segmentsLength(clipped) < segmentsLength(segments)) shown = null

  return { segments: clipped, shown }
}

// A non-empty `summary` (the model-written description) is drawn where the arg would be; it stands
// for the `description` field (see describe in summarize.ts). It counts as that field whole only when
// it is the raw description itself: cleaning (quotes, backticks, line breaks, end punctuation) did
// not change it.
function summaryValue(summary: string | undefined, input: unknown): MainValue | null {
  if (summary === undefined || squash(summary) === '') return null
  const text = squash(summary)
  const raw = asRecord(input)?.['description']

  return { text, key: 'description', whole: typeof raw === 'string' && raw.trim() === text }
}

// `[+] Name  arg            status`: the marker dim, the name bold in the status color, the arg dim
// and cut to fit, the status word right-aligned and only when the call is not done. A non-empty
// `summary` (the model-written description) is drawn where the arg would be.
export function collapsedSegments(
  call: CallView,
  columns: number | undefined,
  doneColor: string = DEFAULT_DONE_COLOR,
  summary?: string,
): Segment[] {
  const field = pickArgField(call.input)
  const main = summaryValue(summary, call.input) ?? (field === null ? null : { text: field.value, key: field.key, whole: false })

  return headerRow(call, columns, doneColor, MARKER_CLOSED, main).segments
}

// Any line break: CRLF, a lone LF, or a lone CR (which a terminal would draw as a return to column 0).
const LINE_BREAK = /\r\n|\r|\n/

// The picked arg as an expanded header draws it: a multi-line value shows its first line only.
// It counts as whole when that line is the full value, as sent, with no whitespace to collapse.
function expandedArg(field: ArgField): MainValue {
  const trimmed = field.raw.trim()
  const lines = trimmed.split(LINE_BREAK)
  const text = squash(lines[0] ?? '')

  return { text, key: field.key, whole: lines.length === 1 && text === trimmed }
}

// Control characters a Text may not carry once lines are split: all but tab.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

// A string value as drawn lines: its leading and trailing blank lines dropped, each line kept as sent
// (indentation included, so code stays aligned) but for trailing whitespace and stray control characters.
function stringLines(value: string): string[] {
  const lines = value.split(LINE_BREAK).map(line => line.replace(CONTROL, '').trimEnd())
  const first = lines.findIndex(line => line.trim() !== '')
  if (first === -1) return []
  const last = lines.length - 1 - [...lines].reverse().findIndex(line => line.trim() !== '')

  return lines.slice(first, last + 1)
}

// A shell tool's `command` with no line break, laid out one clause per line; null when it stays as sent.
function shellLines(tool: string, key: string, value: unknown): string[] | null {
  if (key !== 'command' || !isShellTool(tool) || typeof value !== 'string' || LINE_BREAK.test(value)) return null
  const lines = formatShell(value)

  return lines.length > 1 ? lines : null
}

// How row lines are drawn: the shell palette and the done color it may take.
type LineStyle = { palette: SyntaxPalette; doneColor: string }

const dimLine = (line: string): Segment[] => [{ text: line, dim: true }]

// A field's drawn lines, each as its runs. A shell tool's one-line command laid out one clause per line
// is highlighted under the palette (see styleTokens in shell.ts); every other line is one dim run.
// unknown: the values of a tool input are whatever JSON the model sent.
function fieldLines(tool: string, key: string, value: unknown, style: LineStyle): Segment[][] {
  const shell = shellLines(tool, key, value)
  if (shell !== null) return shell.map(line => styleTokens(tokenize(line), style.palette, style.doneColor))
  if (typeof value === 'string') return stringLines(value).map(dimLine)
  if (value === null) return [dimLine('null')]
  if (typeof value === 'number' || typeof value === 'boolean') return [dimLine(String(value))]
  if (typeof value === 'object') return [dimLine(JSON.stringify(value))]

  return []
}

// The ARG_FIELDS first, in that order, then the rest of the input in its own order.
function orderedKeys(record: Record<string, unknown>): string[] {
  const keys = Object.keys(record)
  const first: string[] = ARG_FIELDS.filter(key => keys.includes(key))

  return [...first, ...keys.filter(key => !first.includes(key))]
}

// One row of segments per drawn line: `    key:   value`, the label in KEY_COLOR padded so the values
// line up, the value dim; each further line of a multi-line value is indented to the value column.
// A shell tool's one-line `command` is laid out one clause per line and highlighted (see shell.ts).
// `skip` is the field the header already drew whole.
function fieldRows(tool: string, input: unknown, skip: string | null, style: LineStyle): Segment[][] {
  const record = asRecord(input)
  if (record === null) return []
  const fields = orderedKeys(record)
    .filter(key => key !== skip)
    .map(key => ({ label: `${key}:`, lines: fieldLines(tool, key, record[key], style) }))
    .filter(field => field.lines.length > 0)
  const labelWidth = Math.min(Math.max(0, ...fields.map(field => length(field.label))), MAX_KEY_WIDTH)
  const indent = ' '.repeat(FIELD_INDENT)
  const rows: Segment[][] = []
  for (const { label, lines } of fields) {
    const key = label + ' '.repeat(Math.max(labelWidth - length(label), 0) + 1)
    const [first = dimLine(''), ...rest] = lines
    rows.push([{ text: indent }, { text: key, color: KEY_COLOR }, ...first])
    const continuation = ' '.repeat(FIELD_INDENT + length(key))
    for (const line of rest) rows.push([{ text: continuation }, ...line])
  }

  return rows
}

// The expanded row: `header` is the collapsed row with the `[-]` marker (a multi-line value shows its
// first line), and `fields` one line per input field under it, uncut. The field the header drew whole
// is left out of the list. `palette` is how a shell command's clauses are highlighted.
export function expandedRows(
  call: CallView,
  columns: number | undefined,
  doneColor: string = DEFAULT_DONE_COLOR,
  summary?: string,
  palette: SyntaxPalette = DEFAULT_SYNTAX_PALETTE,
): { header: Segment[]; fields: Segment[][] } {
  const field = pickArgField(call.input)
  const main = summaryValue(summary, call.input) ?? (field === null ? null : expandedArg(field))
  const { segments, shown } = headerRow(call, columns, doneColor, MARKER_OPEN, main)

  return { header: segments, fields: fieldRows(call.tool, call.input, shown, { palette, doneColor }) }
}

// For these tools the expanded view also draws the engine's own ToolUse row under the header.
export const keepsEngineRow = (tool: string): boolean => KEEP_ENGINE_ROW.has(tool)

// A per-call toggle beats the global default.
export function isExpanded(collapsed: boolean, override: boolean | undefined): boolean {
  return override ?? !collapsed
}
