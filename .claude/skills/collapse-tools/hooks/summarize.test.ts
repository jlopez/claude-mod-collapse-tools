import { expect, test } from 'claude-code/testing'
import { cleanSummary, describe, resolveSummaries } from './summarize'

test('cleanSummary strips quotes and trailing punctuation, collapses whitespace and keeps the text in full', () => {
  expect(cleanSummary('  "Check repo\n status and fetch origin."  ')).toBe('Check repo status and fetch origin')
  expect(cleanSummary("'Load the auth middleware'!")).toBe('Load the auth middleware')
  expect(cleanSummary('...')).toBe('')
  // Control and format characters become spaces, so no escape code or bidi override reaches the row.
  expect(cleanSummary('\u001b[31mCheck\u202e repo\u0007 status\u200b')).toBe('[31mCheck repo status')
  expect(cleanSummary('\u001b\u202e\u0007')).toBe('')
  expect(cleanSummary('Che\u200bck re\u202epo')).toBe('Check repo')
  expect(cleanSummary('a\u0007b')).toBe('a b')
  expect(cleanSummary('x'.repeat(200))).toHaveLength(200)
  expect(cleanSummary(`${'x'.repeat(58)}, tail`)).toBe(`${'x'.repeat(58)}, tail`)
  const long = cleanSummary('word '.repeat(40))
  expect(long).toBe('word '.repeat(40).trim())
  expect(Array.from(cleanSummary('\u{1F600}'.repeat(100)))).toHaveLength(100)
})

test('summaries setting: saved beats the option, which beats the default of on', () => {
  expect(resolveSummaries(false, true)).toBe(false)
  expect(resolveSummaries(true, false)).toBe(true)
  expect(resolveSummaries(undefined, false)).toBe(false)
  expect(resolveSummaries(null, undefined)).toBe(true)
  expect(resolveSummaries('off', 'no')).toBe(true)
})

test('describe returns the cleaned description for Bash, Agent and Monitor', () => {
  expect(describe('Bash', { command: 'git status', description: '"Show git status head."' })).toBe('Show git status head')
  expect(describe('Agent', { prompt: 'long task body', description: '  Audit\nthe auth flow ' })).toBe('Audit the auth flow')
  expect(describe('Monitor', { command: 'tail -f x', description: 'Watch build output' })).toBe('Watch build output')
  expect(describe('Task', { prompt: 'p', description: 'Audit the auth flow' })).toBe('Audit the auth flow')
  expect(describe('Bash', { description: 'x'.repeat(200) })).toHaveLength(200)
})

test('describe is null for a tool off the allowlist even when its input has a description', () => {
  expect(describe('mcp__linear__save_issue', { description: 'Issue body text' })).toBeNull()
  expect(describe('TaskCreate', { subject: 's', description: 'What needs to be done' })).toBeNull()
  expect(describe('Read', { file_path: '/a.ts', description: 'ignored' })).toBeNull()
})

test('describe is null for a missing, empty, blank, punctuation-only or non-string description and a non-object input', () => {
  expect(describe('Bash', { command: 'ls' })).toBeNull()
  expect(describe('Bash', { command: 'ls', description: '' })).toBeNull()
  expect(describe('Bash', { command: 'ls', description: '   ' })).toBeNull()
  expect(describe('Bash', { command: 'ls', description: '..."' })).toBeNull()
  expect(describe('Bash', { command: 'ls', description: 7 })).toBeNull()
  expect(describe('Bash', 'ls')).toBeNull()
  expect(describe('Bash', null)).toBeNull()
  expect(describe('Bash', ['description'])).toBeNull()
})
