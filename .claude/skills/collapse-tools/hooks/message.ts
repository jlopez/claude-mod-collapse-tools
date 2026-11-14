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

// The lines of the body, its trailing blank lines dropped.
function bodyLines(text: string): string[] {
  const lines = bodyOf(text).split(LINE_BREAK)
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()

  return lines
}

// The first non-empty line of the body, as a summary: heading marks stripped (list and quote marks
// stay), control characters dropped, whitespace collapsed; '' when nothing is left.
export function summaryOf(text: string): string {
  const first = bodyLines(text).find(line => line.trim() !== '')
  if (first === undefined) return ''

  return squash(first.trim().replace(HEADING_MARK, '').replace(CONTROL, ''))
}

export function lineCount(text: string): number {
  return bodyLines(text).length
}

const countLabel = (count: number): string => `${count} ${count === 1 ? 'line' : 'lines'}`

// `[+] Message from name  summary            214 lines`: the marker dim, the label in the done color, the
// summary dim and cut to fit, the line count dim and right-aligned. `open` draws the `[-]` marker.
export function messageSegments(
  text: string,
  name: string,
  columns: number | undefined,
  open: boolean,
  doneColor: string = DEFAULT_DONE_COLOR,
): Segment[] {
  const label: Segment = { text: name === '' ? 'Message' : `Message from ${name}`, color: doneColor }
  const summary = summaryOf(text)
  const main = summary === '' ? null : { text: summary, key: null, whole: false }
  const tail: Segment = { text: countLabel(lineCount(text)), dim: true }

  return fitRow(columns, open ? MARKER_OPEN : MARKER_CLOSED, label, main, tail).segments
}

// A row folds when another party sent its message; the person's own prompts and task notifications
// carry no sender.
export const foldsMessage = (from: { name: string } | undefined): from is { name: string } => from !== undefined
