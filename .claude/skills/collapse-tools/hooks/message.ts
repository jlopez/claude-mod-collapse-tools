import { CONTROL, DEFAULT_DONE_COLOR, LINE_BREAK, MARKER_CLOSED, MARKER_OPEN, fitRow, squash } from './summary'
import type { Segment } from './summary'

// How the engine opens the text of a subagent's final report, and where the report itself starts.
const HANDBACK_PREFIX = '[Subagent hand-back]'
const REPORT_MARKER = /The report follows:(?:\r\n|\r|\n)/

// A markdown heading mark at the start of a line: `## `.
const HEADING_MARK = /^#{1,6}(?:\s+|$)/

// The part of the text a row summarises: a hand-back's report, else the whole text.
function bodyOf(text: string): string {
  if (!text.startsWith(HANDBACK_PREFIX)) return text
  const marker = REPORT_MARKER.exec(text)

  return marker === null ? text : text.slice(marker.index + marker[0].length)
}

// The lines of a body, its trailing blank lines dropped.
function linesOf(body: string): string[] {
  const lines = body.split(LINE_BREAK)
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()

  return lines
}

// The first non-empty line of a body, as a summary: heading marks stripped (list and quote marks
// stay), control characters dropped, whitespace collapsed; '' when nothing is left.
export function firstLineOf(body: string): string {
  const first = linesOf(body).find(line => line.trim() !== '')
  if (first === undefined) return ''

  return squash(first.trim().replace(HEADING_MARK, '').replace(CONTROL, ''))
}

// The lines of a body less its trailing blank lines.
export const countOf = (body: string): number => linesOf(body).length

export const summaryOf = (text: string): string => firstLineOf(bodyOf(text))

export const lineCount = (text: string): number => countOf(bodyOf(text))

export const countLabel = (count: number): string => `${count} ${count === 1 ? 'line' : 'lines'}`

// `[+] label  summary            214 lines`: the marker dim, the label in the done color, the first line
// of `body` dim and cut to fit, its line count dim and right-aligned. `open` draws the `[-]` marker. The
// row builder every message row shares, whatever its label.
export function messageRow(
  label: string,
  body: string,
  columns: number | undefined,
  open: boolean,
  doneColor: string = DEFAULT_DONE_COLOR,
): Segment[] {
  const summary = firstLineOf(body)
  const main = summary === '' ? null : { text: summary, key: null, whole: false }
  const tail: Segment = { text: countLabel(countOf(body)), dim: true }

  return fitRow(columns, open ? MARKER_OPEN : MARKER_CLOSED, { text: label, color: doneColor }, main, tail).segments
}

// The label and body of a message row from `name`: `Message from name` over the text (a hand-back's
// report only).
export const messageBody = (text: string, name: string): { label: string; body: string } => ({
  label: name === '' ? 'Message' : `Message from ${name}`,
  body: bodyOf(text),
})

// `[+] Message from name  summary            214 lines`, see messageRow.
export function messageSegments(
  text: string,
  name: string,
  columns: number | undefined,
  open: boolean,
  doneColor: string = DEFAULT_DONE_COLOR,
): Segment[] {
  const { label, body } = messageBody(text, name)

  return messageRow(label, body, columns, open, doneColor)
}

// A row folds when another party sent its message; the person's own prompts and task notifications
// carry no sender.
export const foldsMessage = (from: { name: string } | undefined): from is { name: string } => from !== undefined
