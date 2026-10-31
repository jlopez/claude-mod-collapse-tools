// The built-in tools whose input `command` is a shell command (Monitor's is optional).
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Monitor'])

export const isShellTool = (tool: string): boolean => SHELL_TOOLS.has(tool)

// Any line break: CRLF, a lone LF, or a lone CR.
const LINE_BREAK = /\r\n|\r|\n/

const WHITESPACE = /\s/

// Lays a one-line shell command out one clause per line, the connecting operator leading the
// continuation line: `a && b | c` gives `a`, `&& b`, `| c`.
//
// It splits at the top-level `&&`, `||`, `|`, `|&` and `;`. Top level means outside single and double
// quotes, backticks, `$(...)`, `(...)`, `{ ... }`, `${...}` and `[[ ... ]]`; a backslash outside single
// quotes escapes the next character. Not separators: `&` (background), `;;` (a case terminator), `>&`
// and `>|` (redirections). A trailing `;` or `&` stays on the last clause. Clauses are trimmed and empty
// ones dropped.
//
// It is conservative, because the result is only drawn: a command with a line break, or one that ends
// while still inside a quote or bracket, comes back whole as one line. Compound commands such as
// `for ...; do ...; done` split at their `;` with no indentation, and comments are not recognized.
export function formatShell(command: string): string[] {
  if (LINE_BREAK.test(command)) return [command]
  const clauses: Array<{ op: string; text: string }> = []
  // The closers still awaited, innermost last; a quote closes with itself.
  const open: string[] = []
  let op = ''
  let start = 0
  const cut = (end: number, next: string, resume: number): void => {
    const text = command.slice(start, end).trim()
    if (text !== '') clauses.push({ op, text })
    // The operator before a clause leads it; of several in a row (an empty clause between) the last wins.
    op = next
    start = resume
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? ''
    const pair = command.slice(i, i + 2)
    const top = open[open.length - 1]
    if (top === "'") {
      if (char === "'") open.pop()
      continue
    }
    if (char === '\\') {
      i++
      continue
    }
    if (top === '"' && char === '"') {
      open.pop()
      continue
    }
    if (top === '`' && char === '`') {
      open.pop()
      continue
    }
    if (char === "'" && top !== '"') open.push("'")
    else if (char === '"') open.push('"')
    else if (char === '`') open.push('`')
    else if (pair === '$(') {
      open.push(')')
      i++
    } else if (pair === '${') {
      open.push('}')
      i++
    } else if (top === '"') continue
    else if (char === '(') open.push(')')
    else if (char === '{' && WHITESPACE.test(command[i + 1] ?? '')) open.push('}')
    else if (pair === '[[' && WHITESPACE.test(command[i + 2] ?? '')) {
      open.push(']]')
      i++
    } else if (pair === ']]' && top === ']]') {
      open.pop()
      i++
    } else if ((char === ')' && top === ')') || (char === '}' && top === '}')) open.pop()
    else if (open.length === 0) {
      const rest = command.slice(i + 1)
      if (pair === '&&' || pair === '||' || pair === '|&') {
        cut(i, pair, i + 2)
        i++
      } else if (pair === ';;') i++
      else if (char === '|' && command[i - 1] !== '>') cut(i, '|', i + 1)
      else if (char === ';' && rest.trim() !== '') cut(i, ';', i + 1)
    }
  }
  if (open.length > 0) return [command.trim()]
  cut(command.length, '', command.length)
  const lines = clauses.map(({ op: lead, text }, index) => (index === 0 || lead === '' ? text : `${lead} ${text}`))

  return lines.length === 0 ? [command.trim()] : lines
}
