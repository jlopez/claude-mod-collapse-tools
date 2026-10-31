import type { Segment } from './summary'

// The built-in tools whose input `command` is a shell command (Monitor's is optional).
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Monitor'])

export const isShellTool = (tool: string): boolean => SHELL_TOOLS.has(tool)

// Any line break: CRLF, a lone LF, or a lone CR.
const LINE_BREAK = /\r\n|\r|\n/

const WHITESPACE = /\s/

// One open quote or bracket: the text that opened it and the text that closes it (a quote closes
// with itself; `$(` and `(` both close with `)`, `${` and `{` with `}`).
type Frame = { opener: string; closer: string }

// One step of the scan: a frame opening or closing (its opener or closer, `width` characters at `at`),
// a backslash escape (the backslash and the character it escapes), or any other single character.
type Step =
  | { kind: 'open'; at: number; width: number }
  | { kind: 'close'; at: number; width: number }
  | { kind: 'escape'; at: number; width: number }
  | { kind: 'char'; at: number }

// The one shell lexer, shared by formatShell and tokenize. It walks `text` and hands each step to
// `onStep` with the frames the step's characters are inside, innermost last (an opener or closer
// counts as inside its own frame). For a `char` step, `onStep` returns how many of the characters
// after it it consumed as part of the same token (0 for none); those are skipped.
//
// Frames are single and double quotes, backticks, `$(...)`, `${...}`, `(...)`, `{ ... }` and
// `[[ ... ]]`. Inside single quotes nothing is special but the closing quote; elsewhere a backslash
// escapes the next character. Inside double quotes only `"`, a backtick, `$(` and `${` are special.
// `{` and `[[` open only when followed by whitespace.
//
// Returns true when the text ends with every frame closed.
function scanShell(text: string, onStep: (step: Step, frames: readonly Frame[]) => number): boolean {
  const frames: Frame[] = []
  // Reads the step at `i` and returns how many characters it took.
  const stepAt = (i: number): number => {
    const char = text[i] ?? ''
    const pair = text.slice(i, i + 2)
    const top = frames[frames.length - 1]?.closer
    const open = (opener: string, closer: string): number => {
      frames.push({ opener, closer })
      onStep({ kind: 'open', at: i, width: opener.length }, frames)
      return opener.length
    }
    const close = (width: number): number => {
      onStep({ kind: 'close', at: i, width }, frames)
      frames.pop()
      return width
    }
    const plain = (): number => 1 + Math.max(onStep({ kind: 'char', at: i }, frames), 0)
    if (top === "'") return char === "'" ? close(1) : plain()
    if (char === '\\') {
      const width = Math.min(2, text.length - i)
      onStep({ kind: 'escape', at: i, width }, frames)
      return width
    }
    if ((top === '"' && char === '"') || (top === '`' && char === '`')) return close(1)
    if (char === "'" && top !== '"') return open("'", "'")
    if (char === '"') return open('"', '"')
    if (char === '`') return open('`', '`')
    if (pair === '$(') return open('$(', ')')
    if (pair === '${') return open('${', '}')
    if (top === '"') return plain()
    if (char === '(') return open('(', ')')
    if (char === '{' && WHITESPACE.test(text[i + 1] ?? '')) return open('{', '}')
    if (pair === '[[' && WHITESPACE.test(text[i + 2] ?? '')) return open('[[', ']]')
    if (pair === ']]' && top === ']]') return close(2)
    if ((char === ')' && top === ')') || (char === '}' && top === '}')) return close(1)

    return plain()
  }
  let i = 0
  while (i < text.length) i += stepAt(i)

  return frames.length === 0
}

// Lays a one-line shell command out one clause per line, the connecting operator leading the
// continuation line: `a && b | c` gives `a`, `&& b`, `| c`.
//
// It splits at the top-level `&&`, `||`, `|`, `|&` and `;`. Top level means outside every frame of
// scanShell: single and double quotes, backticks, `$(...)`, `(...)`, `{ ... }`, `${...}` and
// `[[ ... ]]`; a backslash outside single quotes escapes the next character. Not separators: `&`
// (background), `;;` (a case terminator), `>&` and `>|` (redirections). A trailing `;` or `&` stays on
// the last clause. Clauses are trimmed and empty ones dropped.
//
// It is conservative, because the result is only drawn: a command with a line break, or one that ends
// while still inside a quote or bracket, comes back whole as one line. Compound commands such as
// `for ...; do ...; done` split at their `;` with no indentation, and comments are not recognized.
export function formatShell(command: string): string[] {
  if (LINE_BREAK.test(command)) return [command]
  const clauses: Array<{ op: string; text: string }> = []
  let op = ''
  let start = 0
  const cut = (end: number, next: string, resume: number): void => {
    const text = command.slice(start, end).trim()
    if (text !== '') clauses.push({ op, text })
    // The operator before a clause leads it; of several in a row (an empty clause between) the last wins.
    op = next
    start = resume
  }
  const balanced = scanShell(command, (step, frames) => {
    if (step.kind !== 'char' || frames.length > 0) return 0
    const i = step.at
    const pair = command.slice(i, i + 2)
    if (pair === '&&' || pair === '||' || pair === '|&') {
      cut(i, pair, i + 2)
      return 1
    }
    if (pair === ';;') return 1
    const char = command[i]
    if (char === '|' && command[i - 1] !== '>') cut(i, '|', i + 1)
    else if (char === ';' && command.slice(i + 1).trim() !== '') cut(i, ';', i + 1)

    return 0
  })
  if (!balanced) return [command.trim()]
  cut(command.length, '', command.length)
  const lines = clauses.map(({ op: lead, text }, index) => (index === 0 || lead === '' ? text : `${lead} ${text}`))

  return lines.length === 0 ? [command.trim()] : lines
}

// What a run of a shell line is, for highlighting. `#` comments and redirections have no kind of their
// own yet: they are `plain`.
export type TokenKind = 'command' | 'operator' | 'string' | 'variable' | 'plain'

export type Token = { text: string; kind: TokenKind }

// The connecting operator a formatShell continuation line starts with.
const LEADING_OPERATOR = /^(?:&&|\|\||\|&|\||;(?!;))/

// `$name`, a positional `$1`, or a special parameter (`$?`, `$#`, `$@`, `$*`, `$!`, `$-`, `$$`). None of
// the characters after the `$` is special to scanShell, so a match is consumed as one token; `$$` is
// left alone when a `(` or `{` follows, since scanShell reads that second `$` as opening a substitution.
const PARAMETER = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9?#@*!-]|\$(?![({]))/

// A shell variable assignment that may lead a simple command (`FOO=1 make`): not the command word.
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/

// The frames that classify a character: groups (`(`, `{`, `[[`) are transparent.
const isGroup = (frame: Frame): boolean => frame.opener === '(' || frame.opener === '{' || frame.opener === '[['

// The kind of a character inside `frames`, by the outermost quote or substitution around it. Single
// quotes are a string. Double quotes are a string, but a substitution inside them is a variable.
// `$(...)`, `${...}` and backticks are a variable whatever they hold: a backtick span is the old form
// of command substitution, so it reads as `$(...)` does.
function kindIn(frames: readonly Frame[]): TokenKind {
  const spans = frames.filter(frame => !isGroup(frame))
  const outer = spans[0]
  if (outer === undefined) return 'plain'
  if (outer.opener === "'") return 'string'
  if (outer.opener === '"') return spans.length > 1 ? 'variable' : 'string'

  return 'variable'
}

// Classifies one line as formatShell lays it out (one clause, maybe led by its connecting operator)
// into runs whose texts join back to the line exactly. It reads the line with the same lexer as
// formatShell (scanShell):
// - a leading `&&`, `||`, `|&`, `|` or `;` is an `operator`;
// - the first word that is wholly outside every frame and is not a variable assignment is the `command`
//   (a clause that starts with a group, a quote, a substitution, an operator, a redirection or a
//   comment has none, and neither does a word with a redirection attached, such as `ls>out`);
// - a single-quoted span, quotes included, is a `string` with nothing expanded inside; so is an
//   ANSI-C `$'...'` span, its `$` included;
// - a double-quoted span is a `string` but for the `$name`, `${...}`, `$(...)` and backtick spans
//   inside it, which are `variable`;
// - `$name`, `${...}`, `$(...)` and backtick spans outside quotes are `variable`;
// - everything else, whitespace and redirections included, is `plain`, and so is a `#` comment: from a
//   top-level `#` that starts a word to the end of the line, whatever it holds.
// A line that has a line break or does not scan cleanly (it ends inside a frame) is one `plain` run.
export function tokenize(line: string): Token[] {
  if (line === '') return []
  const whole: Token[] = [{ text: line, kind: 'plain' }]
  if (LINE_BREAK.test(line)) return whole
  const kinds: TokenKind[] = Array.from({ length: line.length }, () => 'plain')
  // True for each character outside every frame (an escape included).
  const top: boolean[] = Array.from({ length: line.length }, () => false)
  // True for each character a backslash escapes: never a word break, an operator or a comment.
  const escaped: boolean[] = Array.from({ length: line.length }, () => false)
  const mark = (at: number, width: number, kind: TokenKind, bare: boolean): void => {
    for (let i = at; i < at + width && i < line.length; i++) {
      kinds[i] = kind
      top[i] = bare
    }
  }
  const balanced = scanShell(line, (step, frames) => {
    const kind = kindIn(frames)
    const bare = frames.length === 0
    if (step.kind !== 'char') {
      mark(step.at, step.width, kind, bare && step.kind === 'escape')
      if (step.kind === 'escape' && step.width === 2) escaped[step.at + 1] = true
      return 0
    }
    if (kind !== 'variable' && frames[frames.length - 1]?.opener !== "'" && line[step.at] === '$') {
      const parameter = PARAMETER.exec(line.slice(step.at))?.[0]
      if (parameter !== undefined) {
        mark(step.at, parameter.length, 'variable', false)
        return parameter.length - 1
      }
      // `$'...'` outside quotes is an ANSI-C string: its `$` belongs to the string that follows.
      if (kind === 'plain' && line[step.at + 1] === "'") {
        mark(step.at, 1, 'string', false)
        return 0
      }
    }
    mark(step.at, 1, kind, bare)

    return 0
  })
  if (!balanced) return whole
  const isGap = (i: number): boolean => top[i] === true && escaped[i] !== true && WHITESPACE.test(line[i] ?? '')
  const operator = LEADING_OPERATOR.exec(line)?.[0] ?? ''
  for (let i = 0; i < operator.length; i++) kinds[i] = 'operator'
  const end = commentStart(line, operator.length, kinds, top, escaped, isGap)
  for (let i = end; i < line.length; i++) kinds[i] = 'plain'
  markCommand(line, operator.length, end, kinds, top, escaped, isGap)

  return runs(line, kinds)
}

// Where a `#` comment starts (the line's length when there is none): the first `#` outside every frame,
// not escaped, that starts a word (at the line's start, right after the leading operator, or after a
// word break).
function commentStart(
  line: string,
  from: number,
  kinds: readonly TokenKind[],
  top: readonly boolean[],
  escaped: readonly boolean[],
  isGap: (i: number) => boolean,
): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] !== '#' || top[i] !== true || escaped[i] === true || kinds[i] !== 'plain') continue
    if (i === from || isGap(i - 1)) return i
  }

  return line.length
}

// A word that starts with one of these is an operator (`;;`, `&`) or a redirection, not a command.
const NOT_A_COMMAND = /^[;&|<>]/

// A redirection character; a command word with one in it (outside every frame, not escaped), such as
// `2>/dev/null` or `ls>out`, is a redirection or carries one, so it is not marked.
const REDIRECTION = /[<>]/

// Marks the command word: the first word in `[from, end)` (words split at unescaped whitespace outside
// every frame) that is not an assignment, when every character of it is plain and outside every frame,
// it does not start with an operator or redirection character and holds no bare redirection character.
function markCommand(
  line: string,
  from: number,
  end: number,
  kinds: TokenKind[],
  top: readonly boolean[],
  escaped: readonly boolean[],
  isGap: (i: number) => boolean,
): void {
  let i = from
  while (i < end) {
    while (i < end && isGap(i)) i++
    const start = i
    while (i < end && !isGap(i)) i++
    if (start === i) return
    const word = line.slice(start, i)
    if (ASSIGNMENT.test(word)) continue
    if (NOT_A_COMMAND.test(word)) return
    for (let j = start; j < i; j++) {
      if (top[j] !== true || kinds[j] !== 'plain') return
      if (escaped[j] !== true && REDIRECTION.test(line[j] ?? '')) return
    }
    for (let j = start; j < i; j++) kinds[j] = 'command'
    return
  }
}

// Joins neighbouring characters of the same kind into one token each.
function runs(line: string, kinds: readonly TokenKind[]): Token[] {
  const tokens: Token[] = []
  let start = 0
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && kinds[i] === kinds[start]) continue
    tokens.push({ text: line.slice(start, i), kind: kinds[start] ?? 'plain' })
    start = i
  }

  return tokens
}

// How the expanded row draws a shell command's clauses.
// - `weight` (the default): weight and one accent only. The command word bold, the connecting operator
//   in the accent, strings and variables at full brightness, the rest dim.
// - `status`: status colors: strings green, variables yellow, the command word in the done color,
//   operators in the accent.
// - `off`: no highlighting, every run dim (how a clause looked before highlighting).
// See the decision note in docs/ARCHITECTURE.md for why `weight` keeps the status colors out.
export type SyntaxPalette = 'weight' | 'status' | 'off'

export const SYNTAX_PALETTES: readonly SyntaxPalette[] = ['weight', 'status', 'off']

export const DEFAULT_SYNTAX_PALETTE: SyntaxPalette = 'weight'

export const SYNTAX_PALETTE_STORE_KEY = 'syntaxPalette'

// The style of one token kind; the same shape as a Segment without its text.
export type TokenStyle = { color?: string; bold?: boolean; dim?: boolean }

// Theme key the connecting operators are drawn in (the accent; the same as the `key:` labels).
const OPERATOR_COLOR = 'suggestion'

const ALL_DIM: Readonly<Record<TokenKind, TokenStyle>> = {
  command: { dim: true },
  operator: { dim: true },
  string: { dim: true },
  variable: { dim: true },
  plain: { dim: true },
}

// The switch point for how highlighting looks: one style table per palette. `status` takes the done
// color for its command word, so each palette is a function of it.
const PALETTES: Readonly<Record<SyntaxPalette, (doneColor: string) => Readonly<Record<TokenKind, TokenStyle>>>> = {
  weight: () => ({
    command: { bold: true },
    operator: { color: OPERATOR_COLOR },
    string: {},
    variable: {},
    plain: { dim: true },
  }),
  status: doneColor => ({
    command: { bold: true, color: doneColor },
    operator: { color: OPERATOR_COLOR },
    string: { color: 'success' },
    variable: { color: 'warning' },
    plain: { dim: true },
  }),
  off: () => ALL_DIM,
}

export const paletteStyles = (palette: SyntaxPalette, doneColor: string): Readonly<Record<TokenKind, TokenStyle>> =>
  PALETTES[palette](doneColor)

const sameStyle = (a: TokenStyle, b: TokenStyle): boolean => a.color === b.color && a.bold === b.bold && a.dim === b.dim

// The tokens as styled runs under `palette`, neighbours of the same style joined; their texts join to
// the tokens' texts.
export function styleTokens(tokens: readonly Token[], palette: SyntaxPalette, doneColor: string): Segment[] {
  const styles = paletteStyles(palette, doneColor)
  const segments: Segment[] = []
  for (const token of tokens) {
    if (token.text === '') continue
    const style = styles[token.kind]
    const last = segments[segments.length - 1]
    if (last !== undefined && sameStyle(last, style)) last.text += token.text
    else segments.push({ text: token.text, ...style })
  }

  return segments
}

// `value` is unknown: it is an unvalidated store read or a plugin-option value; narrowed here.
export function validSyntaxPalette(value: unknown): SyntaxPalette | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()

  return SYNTAX_PALETTES.find(palette => palette === name) ?? null
}

// unknown: `saved` is an unvalidated store read and `option` a plugin-option union, both narrowed by
// validSyntaxPalette. A valid saved value wins, then a valid option, then the default.
export const resolveSyntaxPalette = (saved: unknown, option: unknown): SyntaxPalette =>
  validSyntaxPalette(saved) ?? validSyntaxPalette(option) ?? DEFAULT_SYNTAX_PALETTE
