import { countLabel, countOf, firstLineOf } from './message'
import {
  CONTROL,
  DEFAULT_DONE_COLOR,
  FIELD_INDENT,
  LINE_BREAK,
  MARKER_CLOSED,
  MARKER_OPEN,
  fitRow,
  squash,
  statusLabel,
  statusOf,
  statusWord,
  stringLines,
} from './summary'
import type { CallView, Segment } from './summary'

// squawk (https://github.com/ewasserman/squawk) carries messages between people's Claude Code sessions.
// An incoming one is a UserMessage row whose text is squawk's delivery text, the engine's own first line
// before it on the transcript row; an outgoing one is a Bash call that runs `squawk send` or `squawk reply`.

// The engine's first line of a message another session posted.
const ENGINE_LINE = 'Another Claude session sent a message:'

// squawk's first line: `squawk: <kind> from <sender>, another person's assistant (information, ...)`.
const HEADER = /^squawk: (\S+) from (.+?), another person's assistant\b/

// The line that opens the body; its marker is a nonce, so the body cannot hold the matching end line.
const BEGIN = /^----- begin (\S+) -----$/

export type SquawkMessage = { sender: string; kind: string; body: string }

// The sender, kind and body of an incoming squawk message; null when the text is not one. The header
// must be the first non-empty line, or the second when the first is the engine's: a message that only
// quotes a header deeper down does not match. The body runs from the first begin line after the header
// to the last end line with the same marker (to the end of the text when there is none); no begin line
// means null.
export function parseSquawkMessage(text: string): SquawkMessage | null {
  const lines = text.split(LINE_BREAK)
  const filled = lines.map((line, index) => ({ line: line.trim(), index })).filter(({ line }) => line !== '')
  const [first, second] = filled
  const head = first?.line === ENGINE_LINE ? second : first
  const header = head === undefined ? null : HEADER.exec(head.line)
  if (head === undefined || header === null) return null
  const begin = lines.findIndex((line, index) => index > head.index && BEGIN.test(line.trim()))
  const marker = BEGIN.exec(lines[begin]?.trim() ?? '')?.[1]
  if (marker === undefined) return null
  const endLine = `----- end ${marker} -----`
  const end = lines.findLastIndex((line, index) => index > begin && line.trim() === endLine)
  const body = lines.slice(begin + 1, end === -1 ? lines.length : end).join('\n')

  return { sender: squash((header[2] ?? '').replace(CONTROL, '')), kind: header[1] ?? '', body }
}

// The label and body of an incoming squawk message's row.
export const squawkMessageRow = (message: SquawkMessage): { label: string; body: string } => ({
  label: `Squawk from ${message.sender}`,
  body: message.body,
})

// A message body as drawn lines under an expanded row: indented to the field column, each line cleaned
// as an input field's (see stringLines in summary.ts), not dim. A blank line inside is the bare indent.
export const bodyRows = (body: string): Segment[][] =>
  stringLines(body).map(line => [{ text: ' '.repeat(FIELD_INDENT) + line }])

// The command start that makes a Bash call a squawk message: the command must begin with it.
const SEND_START = /^\s*squawk[ \t]+(send|reply)\s/

// The `send` options that take a value as the next word (`--opt=value` is one word).
const VALUE_OPTIONS: ReadonlySet<string> = new Set(['--session', '--kind', '--thread', '--reply-to', '-s', '-k', '-t', '-r'])

// Inside double quotes a backslash escapes only these; before anything else it stays.
const QUOTED_ESCAPES = new Set(['"', '\\', '$', '`'])

type Heredoc = { delimiter: string; stripTabs: boolean }

// The words of the command's first clause, read as the shell would split them: quotes removed, escapes
// undone, a heredoc operator's delimiter taken out of the words, a redirection and its target dropped.
// The clause ends at the end of the line or at `;`, `&` or `|`. `rest` is where the next line starts
// (a heredoc's body); `complete` is false when a quote never closed (the words read so far are kept).
function readClause(text: string): { words: string[]; heredoc: Heredoc | null; rest: number; complete: boolean } {
  const words: string[] = []
  let heredoc: Heredoc | null = null
  // The word being read; null between words, so an empty quoted word still counts.
  let word: string | null = null
  // What the next word is: a heredoc delimiter (and whether `<<-` strips tabs), or a redirection target.
  let pending: 'heredoc' | 'heredoc-tabs' | 'target' | null = null
  let complete = true
  const finish = (): void => {
    if (word === null) return
    if (pending === 'heredoc' || pending === 'heredoc-tabs') heredoc = { delimiter: word, stripTabs: pending === 'heredoc-tabs' }
    else if (pending === null) words.push(word)
    pending = null
    word = null
  }
  let i = 0
  while (i < text.length) {
    const char = text[i] ?? ''
    if (char === '\n' || char === ';' || char === '&' || char === '|') break
    if (char === ' ' || char === '\t' || char === '\r') {
      finish()
      i++
    } else if (char === '\\') {
      // A backslash before a line break joins the lines; before anything else it is that character.
      if (text[i + 1] !== '\n') word = (word ?? '') + (text[i + 1] ?? '')
      i += 2
    } else if (char === "'") {
      const close = text.indexOf("'", i + 1)
      if (close === -1) {
        complete = false
        break
      }
      word = (word ?? '') + text.slice(i + 1, close)
      i = close + 1
    } else if (char === '"') {
      let j = i + 1
      let out = ''
      while (j < text.length && text[j] !== '"') {
        const next = text[j + 1] ?? ''
        if (text[j] === '\\' && (QUOTED_ESCAPES.has(next) || next === '\n')) {
          if (next !== '\n') out += next
          j += 2
        } else {
          out += text[j]
          j++
        }
      }
      if (j >= text.length) {
        complete = false
        break
      }
      word = (word ?? '') + out
      i = j + 1
    } else if (char === '#' && word === null) {
      break
    } else if (char === '<' || char === '>') {
      // A file descriptor number before the operator (`2>`) belongs to the redirection.
      if (word !== null && /^\d+$/.test(word)) word = null
      finish()
      if (text.startsWith('<<<', i)) {
        pending = 'target'
        i += 3
      } else if (text.startsWith('<<', i)) {
        pending = text[i + 2] === '-' ? 'heredoc-tabs' : 'heredoc'
        i += pending === 'heredoc-tabs' ? 3 : 2
      } else {
        pending = 'target'
        while (i < text.length && '<>&|'.includes(text[i] ?? '')) i++
      }
    } else {
      word = (word ?? '') + char
      i++
    }
  }
  if (complete) finish()
  const lineEnd = text.indexOf('\n', i)

  return { words, heredoc, rest: lineEnd === -1 ? text.length : lineEnd + 1, complete }
}

// A heredoc's lines up to the line that is exactly its delimiter (to the end when there is none).
function heredocBody(text: string, heredoc: Heredoc): string {
  const lines: string[] = []
  for (const raw of text.split(LINE_BREAK)) {
    const line = heredoc.stripTabs ? raw.replace(/^\t+/, '') : raw
    if (line === heredoc.delimiter) break
    lines.push(line)
  }

  return lines.join('\n')
}

export type SquawkSend = { verb: 'send' | 'reply'; to: string | null; body: string }

// The message a `squawk send` or `squawk reply` command sends; null unless the command, after leading
// whitespace, starts with one of them. `to` is the contact `send` names (a reply names none in the
// command). `body` is the text positional, else the clause's heredoc, else '' (also when a quote never
// closed). Only the first clause is read; whatever follows it (`&& git commit`, a second send) is not.
export function parseSquawkSend(command: string): SquawkSend | null {
  const start = SEND_START.exec(command)
  if (start === null) return null
  const verb = start[1] === 'send' ? 'send' : 'reply'
  const clause = readClause(command)
  const positionals: string[] = []
  let options = true
  for (let k = 2; k < clause.words.length; k++) {
    const word = clause.words[k] ?? ''
    // `--` ends the options; a value option skips its value; any other option word (`--opt=value`) is
    // skipped alone; `-` is the stdin text positional.
    if (options && word === '--') options = false
    else if (options && verb === 'send' && VALUE_OPTIONS.has(word)) k++
    else if (!options || !word.startsWith('-') || word === '-') positionals.push(word)
  }
  const to = verb === 'send' ? (positionals[0] ?? null) : null
  const text = positionals[1]
  let body = ''
  if (clause.complete && text !== undefined && text !== '-') body = text
  else if (clause.complete && clause.heredoc !== null) body = heredocBody(command.slice(clause.rest), clause.heredoc)

  return { verb, to, body }
}

// squawk's report of one sent message, a line each: delivered, or queued for a later delivery.
const SENT_LINE = /^Sent to (.+?)(?: and delivered to their squawk service|: queued)/

// What squawk appends when the person changed the text in its confirmation dialog; the sent text follows.
const EDITED_MARKER = ' Your user edited the text before sending; what was sent is:\n'

// unknown: `output` is the ToolUse row's `output` prop, which the engine types declare as unknown (for
// Bash an object with a string `stdout`); narrowed here. A string stands for the stdout itself.
function stdoutOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (typeof output !== 'object' || output === null) return ''
  const stdout = (output as Record<string, unknown>)['stdout']

  return typeof stdout === 'string' ? stdout : ''
}

// The names of every sent line before the edited text (which may hold anything), in order, repeats kept.
function sentLines(stdout: string): string[] {
  const at = stdout.indexOf(EDITED_MARKER)
  const report = at === -1 ? stdout : stdout.slice(0, at)

  return report.split(LINE_BREAK).flatMap(line => {
    const name = SENT_LINE.exec(line)?.[1]
    return name === undefined ? [] : [name]
  })
}

// unknown: see stdoutOf. The contacts the command's output says it sent to, in order, each once.
export const sentTo = (output: unknown): string[] => [...new Set(sentLines(stdoutOf(output)))]

// unknown: see stdoutOf. The text the person edited in squawk's dialog and sent, when the output says
// one message was sent that way; null otherwise.
export function editedText(output: unknown): string | null {
  const stdout = stdoutOf(output)
  const at = stdout.indexOf(EDITED_MARKER)
  if (at === -1 || sentLines(stdout).length !== 1) return null

  return stdout.slice(at + EDITED_MARKER.length).replace(/\r?\n$/, '')
}

// unknown: `input` and `output` are the ToolUse row's props, declared unknown by the engine types. The
// label and body of a Bash call that sends a squawk message; null for any other call. The label names
// the recipients the output reports, else the contact the command names, else the verb (a reply that
// is still running or failed). An edited text replaces the command's.
export function squawkSend(tool: string, input: unknown, output: unknown): { label: string; body: string } | null {
  if (tool !== 'Bash' || typeof input !== 'object' || input === null) return null
  const command = (input as Record<string, unknown>)['command']
  const send = typeof command === 'string' ? parseSquawkSend(command) : null
  if (send === null) return null
  const names = sentTo(output)
  const to = names.length > 0 ? names.join(', ') : send.to
  const body = editedText(output) ?? send.body

  return { label: to === null ? `Squawk ${send.verb}` : `Squawk to ${to}`, body }
}

// `[+] Squawk to Bob  first line            3 lines`: the marker dim, the label in the status color and
// bold unless done (as a tool name), the body's first line dim and cut to fit, then the status word
// while the call is not done, else the body's line count dim, right-aligned. `open` draws `[-]`.
export function squawkSendSegments(
  call: Pick<CallView, 'isRunning' | 'isErrored' | 'isInterrupted'>,
  row: { label: string; body: string },
  columns: number | undefined,
  open: boolean,
  doneColor: string = DEFAULT_DONE_COLOR,
): Segment[] {
  const status = statusOf(call)
  const word = statusWord(status)
  const name = statusLabel(row.label, status, doneColor)
  const summary = firstLineOf(row.body)
  const main = summary === '' ? null : { text: summary, key: null, whole: false }
  const tail: Segment = word === '' ? { text: countLabel(countOf(row.body)), dim: true } : { text: word, color: name.color }

  return fitRow(columns, open ? MARKER_OPEN : MARKER_CLOSED, name, main, tail).segments
}
