import { expect, test } from 'claude-code/testing'
import { SHELL_TOOLS, formatShell, isShellTool } from './shell'

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
