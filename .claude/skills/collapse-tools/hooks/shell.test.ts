import { expect, test } from 'claude-code/testing'
import {
  SHELL_TOOLS,
  SYNTAX_PALETTES,
  SYNTAX_PALETTE_STORE_KEY,
  formatShell,
  isShellTool,
  paletteStyles,
  resolveSyntaxPalette,
  styleTokens,
  tokenize,
} from './shell'
import type { Token } from './shell'

test('only Bash and Monitor are shell tools', () => {
  expect([...SHELL_TOOLS].sort()).toEqual(['Bash', 'Monitor'])
  expect(isShellTool('Bash')).toBe(true)
  expect(isShellTool('mcp__x__y')).toBe(false)
})

test('each top-level clause goes on its own line with the operator leading', () => {
  expect(formatShell(`jq '.plugins["x"]' ~/f.json && git remote -v && git log --oneline main..HEAD; ls ~/.in_use 2>/dev/null | head`)).toEqual([
    `jq '.plugins["x"]' ~/f.json`,
    '&& git remote -v',
    '&& git log --oneline main..HEAD',
    '; ls ~/.in_use 2>/dev/null',
    '| head',
  ])
})

test('|| splits and |& is a pipe', () => {
  expect(formatShell('a || b |& c')).toEqual(['a', '|| b', '|& c'])
})

test('quoted operators do not split, escaped quotes included', () => {
  expect(formatShell(`echo 'a && b; c | d' && echo "x || y; z"`)).toEqual([`echo 'a && b; c | d'`, `&& echo "x || y; z"`])
  expect(formatShell(`echo "a \\" && b" && c`)).toEqual([`echo "a \\" && b"`, '&& c'])
  expect(formatShell('echo a\\; b && c')).toEqual(['echo a\\; b', '&& c'])
})

test('substitutions, subshells, groups and tests are not split inside', () => {
  expect(formatShell('echo $(a && b) && c')).toEqual(['echo $(a && b)', '&& c'])
  expect(formatShell('echo `a && b` | c')).toEqual(['echo `a && b`', '| c'])
  expect(formatShell('( a; b ) && c')).toEqual(['( a; b )', '&& c'])
  expect(formatShell('{ a; b; } && c')).toEqual(['{ a; b; }', '&& c'])
  expect(formatShell('echo ${x:-a|b} && c')).toEqual(['echo ${x:-a|b}', '&& c'])
  expect(formatShell('echo "$(a && b)" && c')).toEqual(['echo "$(a && b)"', '&& c'])
  expect(formatShell('[[ -n $a || -n $b ]] && c')).toEqual(['[[ -n $a || -n $b ]]', '&& c'])
})

test('a redirection is not a separator: 2>&1 | tee splits at the pipe only', () => {
  expect(formatShell('make 2>&1 | tee log')).toEqual(['make 2>&1', '| tee log'])
  expect(formatShell('a >| f && b')).toEqual(['a >| f', '&& b'])
})

test('; ;; and trailing ; or & stay with their clause; empty clauses are dropped', () => {
  expect(formatShell('case x in a) b;; esac')).toEqual(['case x in a) b;; esac'])
  expect(formatShell('a; b;')).toEqual(['a', '; b;'])
  expect(formatShell('a &')).toEqual(['a &'])
  expect(formatShell('a & b')).toEqual(['a & b'])
  expect(formatShell('a; ; b')).toEqual(['a', '; b'])
  expect(formatShell('&& a')).toEqual(['a'])
})

test('an unterminated quote or bracket returns the command whole', () => {
  expect(formatShell(`echo 'a && b`)).toEqual([`echo 'a && b`])
  expect(formatShell('echo "a && b')).toEqual(['echo "a && b'])
  expect(formatShell('echo $(a && b')).toEqual(['echo $(a && b'])
})

test('a single clause is trimmed; a command with a line break is returned as is', () => {
  expect(formatShell('  ls -la  ')).toEqual(['ls -la'])
  expect(formatShell('a && b\nc')).toEqual(['a && b\nc'])
})

// `kind:text` per token, so a case reads as the runs it draws.
const runsOf = (line: string): string[] => tokenize(line).map(token => `${token.kind}:${token.text}`)
const textOf = (tokens: readonly Token[]): string => tokens.map(token => token.text).join('')

test('tokenize: a leading connecting operator is an operator and the first word after it the command', () => {
  expect(runsOf('&& git log -1')).toEqual(['operator:&&', 'plain: ', 'command:git', 'plain: log -1'])
  expect(runsOf('|| b')).toEqual(['operator:||', 'plain: ', 'command:b'])
  expect(runsOf('|& tee log')).toEqual(['operator:|&', 'plain: ', 'command:tee', 'plain: log'])
  expect(runsOf('| head')).toEqual(['operator:|', 'plain: ', 'command:head'])
  expect(runsOf('; ls')).toEqual(['operator:;', 'plain: ', 'command:ls'])
  expect(runsOf('ls -la')).toEqual(['command:ls', 'plain: -la'])
})

test('tokenize: assignments are skipped; a group, quote, substitution or operator first means no command', () => {
  expect(runsOf('FOO=1 BAR=2 npm test')).toEqual(['plain:FOO=1 BAR=2 ', 'command:npm', 'plain: test'])
  expect(runsOf('( a; b )')).toEqual(['plain:( a; b )'])
  expect(runsOf('{ a; b; }')).toEqual(['plain:{ a; b; }'])
  expect(runsOf('"./run me" --flag')).toEqual(['string:"./run me"', 'plain: --flag'])
  expect(runsOf('$EDITOR file')).toEqual(['variable:$EDITOR', 'plain: file'])
  expect(runsOf('; ;; foo')).toEqual(['operator:;', 'plain: ;; foo'])
  expect(runsOf('\\ls -la')).toEqual(['command:\\ls', 'plain: -la'])
})

test('tokenize: single quotes are one string with nothing expanded; double quotes split out their expansions', () => {
  expect(runsOf("echo 'no $x or $(y) here'")).toEqual(['command:echo', 'plain: ', "string:'no $x or $(y) here'"])
  expect(runsOf('echo "home $HOME, ${USER:-x} and $(whoami)"')).toEqual([
    'command:echo',
    'plain: ',
    'string:"home ',
    'variable:$HOME',
    'string:, ',
    'variable:${USER:-x}',
    'string: and ',
    'variable:$(whoami)',
    'string:"',
  ])
  // A quote inside a substitution inside a quote belongs to the substitution.
  expect(runsOf('echo "$(echo "in $y")"')).toEqual(['command:echo', 'plain: ', 'string:"', 'variable:$(echo "in $y")', 'string:"'])
  // An escaped quote does not end the string.
  expect(runsOf('echo "a \\" b"')).toEqual(['command:echo', 'plain: ', 'string:"a \\" b"'])
})

test('tokenize: $name, special parameters, ${...}, $(...) and backtick spans outside quotes are variables', () => {
  expect(runsOf('echo $HOME ${x:-a|b} $(date)')).toEqual([
    'command:echo',
    'plain: ',
    'variable:$HOME',
    'plain: ',
    'variable:${x:-a|b}',
    'plain: ',
    'variable:$(date)',
  ])
  expect(runsOf('echo $1 $? $$ $#')).toEqual([
    'command:echo',
    'plain: ',
    'variable:$1',
    'plain: ',
    'variable:$?',
    'plain: ',
    'variable:$$',
    'plain: ',
    'variable:$#',
  ])
  // A backtick span is the old form of command substitution.
  expect(runsOf('echo `date +%s` x')).toEqual(['command:echo', 'plain: ', 'variable:`date +%s`', 'plain: x'])
  expect(runsOf('[[ -n $a ]]')).toEqual(['plain:[[ -n ', 'variable:$a', 'plain: ]]'])
  // A lone `$` and an escaped one are plain.
  expect(runsOf('echo $ \\$x')).toEqual(['command:echo', 'plain: $ \\$x'])
})

test('tokenize: redirections and # comments stay plain; an unclean line is one plain run', () => {
  expect(runsOf('ls 2>/dev/null >out # note')).toEqual(['command:ls', 'plain: 2>/dev/null >out # note'])
  expect(runsOf("echo 'open")).toEqual(["plain:echo 'open"])
  expect(runsOf('echo $(open')).toEqual(['plain:echo $(open'])
  expect(runsOf('a\nb')).toEqual(['plain:a\nb'])
  expect(tokenize('')).toEqual([])
})

test('tokenize: an escaped space does not end the command word', () => {
  expect(runsOf('my\\ tool x')).toEqual(['command:my\\ tool', 'plain: x'])
  const [first] = formatShell('/Applications/My\\ App.app/Contents/MacOS/tool --v | head')
  expect(runsOf(first ?? '')).toEqual(['command:/Applications/My\\ App.app/Contents/MacOS/tool', 'plain: --v'])
})

test('tokenize: a redirection before the command or attached to its word is not the command', () => {
  expect(runsOf('&& 2>/dev/null rm -rf out')).toEqual(['operator:&&', 'plain: 2>/dev/null rm -rf out'])
  expect(runsOf('ls>files.txt')).toEqual(['plain:ls>files.txt'])
  expect(runsOf('<in sort')).toEqual(['plain:<in sort'])
  // An escaped `>` is part of the word, not a redirection.
  expect(runsOf('a\\>b c')).toEqual(['command:a\\>b', 'plain: c'])
})

test('tokenize: a # comment is plain to the end of the line; a # inside a word is not a comment', () => {
  expect(runsOf('; # set X')).toEqual(['operator:;', 'plain: # set X'])
  expect(runsOf(';# set X')).toEqual(['operator:;', 'plain:# set X'])
  expect(runsOf('| wc -l # count $PWD "files"')).toEqual(['operator:|', 'plain: ', 'command:wc', 'plain: -l # count $PWD "files"'])
  expect(runsOf('echo a#b $x \\# $y')).toEqual(['command:echo', 'plain: a#b ', 'variable:$x', 'plain: \\# ', 'variable:$y'])
  expect(runsOf('echo $# "#" x')).toEqual(['command:echo', 'plain: ', 'variable:$#', 'plain: ', 'string:"#"', 'plain: x'])
})

test("tokenize: an ANSI-C $'...' string takes its $ along", () => {
  expect(runsOf("echo $'it' x")).toEqual(['command:echo', 'plain: ', "string:$'it'", 'plain: x'])
  // Inside double quotes `$'` is not ANSI-C.
  expect(runsOf("echo \"$'x\"")).toEqual(['command:echo', 'plain: ', "string:\"$'x\""])
})

test('tokenize: the tokens join back to the line exactly, for every line of real commands', () => {
  const commands = [
    `jq '.plugins["x"]' ~/f.json && git remote -v && git log --oneline main..HEAD; ls ~/.in_use 2>/dev/null | head`,
    'echo "a \\" && b" && c',
    'echo $(a && b) && echo `a && b` | c ${x:-a|b}',
    'FOO="a b" make -j$(nproc) 2>&1 | tee build.log; echo "done: $?"',
    '[[ -n $a || -n $b ]] && { a; b; } || ( c; d )',
    "rsync -a --exclude '.in_use' ./ ~/.claude/plugins/cache/x/ && echo \u{1F600} ok",
    'case x in a) b;; esac',
    "cd build && 2>/dev/null rm -rf out; ls>f.txt && wc -l f.txt # count $PWD && echo $'it' | my\\ tool",
  ]
  for (const command of commands) {
    for (const line of formatShell(command)) expect(textOf(tokenize(line))).toBe(line)
  }
})

const STATUS_COLORS = ['success', 'warning', 'error']

test('styleTokens: weight is bold command, accented operator, plain dim, and uses no status color', () => {
  const tokens = tokenize('&& git log "$x" $y')
  expect(styleTokens(tokens, 'weight', 'white')).toEqual([
    { text: '&&', color: 'suggestion' },
    { text: ' ', dim: true },
    { text: 'git', bold: true },
    { text: ' log ', dim: true },
    { text: '"$x"' },
    { text: ' ', dim: true },
    { text: '$y' },
  ])
  const weight = Object.values(paletteStyles('weight', 'white'))
  expect(weight.some(style => style.color !== undefined && STATUS_COLORS.includes(style.color))).toBe(false)
  // The done color does not leak into weight either.
  expect(Object.values(paletteStyles('weight', 'magenta')).some(style => style.color === 'magenta')).toBe(false)
})

test('styleTokens: status colors strings and variables, the command in the done color', () => {
  expect(styleTokens(tokenize('| grep "x" $y'), 'status', 'cyan')).toEqual([
    { text: '|', color: 'suggestion' },
    { text: ' ', dim: true },
    { text: 'grep', bold: true, color: 'cyan' },
    { text: ' ', dim: true },
    { text: '"x"', color: 'success' },
    { text: ' ', dim: true },
    { text: '$y', color: 'warning' },
  ])
})

test('styleTokens: off is one dim run, as before highlighting; every palette keeps the text', () => {
  const line = '&& echo "a $b" `c` | d'
  expect(styleTokens(tokenize(line), 'off', 'white')).toEqual([{ text: line, dim: true }])
  for (const palette of SYNTAX_PALETTES) {
    expect(styleTokens(tokenize(line), palette, 'white').map(segment => segment.text).join('')).toBe(line)
  }
})

test('resolveSyntaxPalette: a valid saved value, then a valid option, then weight; case-insensitive', () => {
  expect(SYNTAX_PALETTE_STORE_KEY).toBe('syntaxPalette')
  expect(resolveSyntaxPalette(null, undefined)).toBe('weight')
  expect(resolveSyntaxPalette(undefined, 'status')).toBe('status')
  expect(resolveSyntaxPalette('off', 'status')).toBe('off')
  expect(resolveSyntaxPalette('STATUS', 'off')).toBe('status')
  expect(resolveSyntaxPalette('rainbow', 'Off')).toBe('off')
  expect(resolveSyntaxPalette(42, 'rainbow')).toBe('weight')
  expect(resolveSyntaxPalette(true, ['status'])).toBe('weight')
})
