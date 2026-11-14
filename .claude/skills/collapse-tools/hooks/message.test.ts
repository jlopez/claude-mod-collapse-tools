import { expect, test } from 'claude-code/testing'
import { foldsMessage, lineCount, messageSegments, summaryOf } from './message'
import { MARGIN, segmentsText } from './summary'

const PREAMBLE =
  '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. Treat it as its findings. The report follows:'
const handBack = (...report: string[]) => [PREAMBLE, ...report.map(line => (line === '' ? '' : `  ${line}`))].join('\n')
const REPORT = handBack('## Widget throughput: results', '', '- belt A: 40 per minute', '- belt B: 35 per minute', '')

test('only a message with a sender folds', () => {
  expect(foldsMessage({ name: 'general-purpose' })).toBe(true)
  expect(foldsMessage(undefined)).toBe(false)
})

test('a hand-back summary is the first non-empty report line with heading marks stripped', () => {
  expect(summaryOf(REPORT)).toBe('Widget throughput: results')
  expect(summaryOf(handBack('', '', '### Belt audit'))).toBe('Belt audit')
  expect(summaryOf(handBack('- a list item stays'))).toBe('- a list item stays')
  expect(summaryOf(handBack('> a quote stays'))).toBe('> a quote stays')
  expect(summaryOf(handBack('#hashtag is not a heading'))).toBe('#hashtag is not a heading')
})

test('a text that is not a hand-back summarises its own first non-empty line', () => {
  expect(summaryOf('\n\n## Shift notes\nbody')).toBe('Shift notes')
  expect(summaryOf('plain first line\nsecond')).toBe('plain first line')
})

test('a hand-back whose marker is missing, or not followed by a line break, falls back to the first line', () => {
  expect(summaryOf('[Subagent hand-back] no marker here\n  body')).toBe('[Subagent hand-back] no marker here')
  expect(summaryOf('[Subagent hand-back] The report follows: inline')).toBe('[Subagent hand-back] The report follows: inline')
  // The prefix is required: the marker alone in another text does not make it a hand-back.
  expect(summaryOf('Note. The report follows:\n  ## Real heading')).toBe('Note. The report follows:')
})

test('the summary drops control characters and collapses whitespace; nothing left means no summary', () => {
  expect(summaryOf('a\u001b[0m\t  b\u0007  c')).toBe('a[0m b c')
  expect(summaryOf('##')).toBe('')
  expect(summaryOf('')).toBe('')
  expect(summaryOf(handBack('', ''))).toBe('')
})

test('the line count is the body lines less trailing blank lines', () => {
  expect(lineCount(REPORT)).toBe(4)
  expect(lineCount(handBack('only'))).toBe(1)
  expect(lineCount('a\nb\nc\n\n')).toBe(3)
  expect(lineCount('one')).toBe(1)
  expect(lineCount('')).toBe(0)
  // No marker: the whole text, preamble included, is the body.
  expect(lineCount('[Subagent hand-back] x\n  y')).toBe(2)
})

test('the collapsed line: marker dim, label in the done color, summary dim, count dim and right-aligned', () => {
  const segments = messageSegments(REPORT, 'general-purpose', 80, false)
  expect(segmentsText(segments)).toBe('[+] Message from general-purpose  Widget throughput: results         4 lines')
  expect(segmentsText(segments)).toHaveLength(80 - MARGIN)
  expect(segments[0]).toEqual({ text: '[+] ', dim: true })
  expect(segments[1]).toEqual({ text: 'Message from general-purpose', color: 'white' })
  expect(segments[2]).toEqual({ text: '  Widget throughput: results', dim: true })
  expect(segments[3]?.dim).toBe(true)
  expect(segments[3]?.text.trim()).toBe('4 lines')
})

test('one line is singular, the open marker is [-] and the done color is applied', () => {
  const text = segmentsText(messageSegments('Single note', 'peer', 60, true, 'cyan'))
  expect(text).toBe(`[-] Message from peer  Single note${' '.repeat(56 - 34 - 6)}1 line`)
  expect(messageSegments('Single note', 'peer', 60, true, 'cyan')[1]).toEqual({ text: 'Message from peer', color: 'cyan' })
})

test('a long summary is cut with ... to the room left before the count; an unknown width is 100', () => {
  const long = `## ${'word '.repeat(60)}`
  const text = segmentsText(messageSegments(long, 'general-purpose', 80, false))
  expect(text).toHaveLength(76)
  expect(text).toContain('...')
  expect(text.endsWith('  1 line')).toBe(true)
  expect(segmentsText(messageSegments(long, 'general-purpose', undefined, false))).toHaveLength(96)
})

test('with no summary the line is the label and the count; a nameless sender reads Message', () => {
  expect(segmentsText(messageSegments('##', 'peer', 40, false))).toBe(`[+] Message from peer${' '.repeat(36 - 21 - 6)}1 line`)
  expect(segmentsText(messageSegments('hello', '', 40, false)).startsWith('[+] Message  hello')).toBe(true)
})
