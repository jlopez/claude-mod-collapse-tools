import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HINT_TEXT } from './summary'

const props = {
  tool_use_id: 'toolu_1',
  tool: 'Bash',
  input: { command: 'ls' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}
const result = { tool_use_id: 'toolu_1', tool: 'Bash', output: { stdout: 'x' }, isErrored: false }
const RUN: CommandRunInput = {
  command: 'collapse-tools',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
}
const viewport = { columns: 80, rows: 24 }

const mountTool = ($: Engine, tool: string, id: string) =>
  Promise.all([
    $.ui.mount({ plugin: 'collapse-tools', surface: 'terminal', component: 'ToolUse', props: { ...props, tool, tool_use_id: id }, requestId: id, viewport }),
    $.ui.mount({ plugin: 'collapse-tools', surface: 'terminal', component: 'ToolResult', props: { ...result, tool, tool_use_id: id }, requestId: id, viewport }),
  ])

test('collapsed draws one Button and a result that draws nothing; press swaps in the header only; /collapse-tools expands all', async ($, on) => {
  // Stand-ins for the engine's own rows and the plugin store, beneath the plugin.
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: e.component === 'ToolResult' ? 'stdout' : 'engine row' }))
  const saved: Array<{ key: string; value: unknown }> = []
  on('store.set', async (_$, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  const [use, res] = await mountTool($, 'Bash', 'toolu_1')
  expect(await use.findAll({ type: 'Button' })).toHaveLength(1)
  expect(await use.find({ text: '[+] Bash  ls' })).toBeDefined()
  expect(JSON.stringify(await use.drawn())).not.toContain('engine row')
  // The result is a Box with display none: no text and no row.
  expect(JSON.stringify(await res.drawn())).toContain('"display":"none"')
  expect(JSON.stringify(await res.drawn())).not.toContain('stdout')

  await use.press({ key: 'collapse-tools:toolu_1' })
  expect(await use.find({ text: '[-] Bash  ls' })).toBeDefined()
  expect(await use.find({ text: '[+] Bash  ls' })).toBeUndefined()
  expect(JSON.stringify(await use.drawn())).not.toContain('engine row')
  expect(JSON.stringify(await res.drawn())).toContain('stdout')

  const out = await $.command.run(RUN)
  expect(out.text).toBe('Tool calls expanded.')
  expect(saved).toContainEqual({ key: 'collapsed', value: false })
  expect(await use.find({ text: '[-] Bash  ls' })).toBeDefined()
  expect(JSON.stringify(await res.drawn())).toContain('stdout')

  await use.press({ key: 'collapse-tools:toolu_1' })
  expect(await use.find({ text: '[+] Bash  ls' })).toBeDefined()
  expect(JSON.stringify(await res.drawn())).not.toContain('stdout')
})

test('an expanded Agent row keeps the engine row under the header; the status word and color are drawn', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const [use] = await mountTool($, 'Agent', 'toolu_2')
  await use.press({ key: 'collapse-tools:toolu_2' })
  expect((await use.find({ type: 'Button' }))?.text).toBe('[-] Agent  ls')
  expect(JSON.stringify(await use.drawn())).toContain('engine row')
  expect(JSON.stringify(await use.drawn())).not.toContain('command:')
  expect(JSON.stringify(await use.drawn())).toContain('"color":"white"')
})

test('the startup hint toasts once per session, and only for an interactive session', async ($, on) => {
  const toasts: string[] = []
  // Stand-ins for what the engine answers beneath the plugin at start.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: { command: 'collapse-tools' } }))
  on('store.get', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const start = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
  await $.session.start({ ...start, isInteractive: false })
  expect(toasts).toEqual([])
  await $.session.start(start)
  await $.session.start(start)
  expect(toasts).toEqual(['click a [+] row to expand, /collapse-tools to toggle all'])
  expect(HINT_TEXT.startsWith('collapse-tools')).toBe(false)
})

test('done color: saved beats the option, and the done row renders with it', { options: { doneColor: 'cyan' } }, async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: { command: 'collapse-tools' } }))
  on('store.get', async (_$, e) => ({ value: e.key === 'doneColor' ? 'magenta' : undefined }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  const [use] = await mountTool($, 'Bash', 'toolu_3')
  expect(JSON.stringify(await use.drawn())).toContain('"color":"magenta"')
})

test('done color: the plugin option applies when nothing is saved', { options: { doneColor: 'cyan' } }, async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const [use] = await mountTool($, 'Bash', 'toolu_4')
  expect(JSON.stringify(await use.drawn())).toContain('"color":"cyan"')
})

test('color subcommand: an invalid color is rejected without saving; a valid one is saved; reset clears the store', async ($, on) => {
  const sets: Array<{ key: string; value: unknown }> = []
  const deleted: string[] = []
  on('store.set', async (_$, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on('store.delete', async (_$, e) => {
    deleted.push(e.key)
    return { value: undefined }
  })
  const bad = await $.command.run({ ...RUN, args: 'color orange' })
  expect(bad.text).toContain('Unknown color "orange"')
  expect(sets).toEqual([])
  const ok = await $.command.run({ ...RUN, args: 'color #AABBCC' })
  expect(ok.text).toBe('Completed-call color set to #AABBCC. Saved for future sessions.')
  expect(sets).toEqual([{ key: 'doneColor', value: '#AABBCC' }])
  const reset = await $.command.run({ ...RUN, args: 'color reset' })
  expect(reset.text).toContain('Completed-call color reset')
  expect(deleted).toEqual(['doneColor'])
  expect((await $.command.run({ ...RUN, args: 'bogus' })).text).toContain('Usage: /collapse-tools')
})

// Mounts one call of `tool` with an explicit input, as the engine would draw it.
const mountCall = ($: Engine, tool: string, id: string, input: Record<string, unknown>) =>
  $.ui.mount({
    plugin: 'collapse-tools',
    surface: 'terminal',
    component: 'ToolUse',
    props: { ...props, tool, tool_use_id: id, input },
    requestId: id,
    viewport,
  })

const GIT_CALL = { command: 'git status && git log -1', description: 'Show git status head and last commit' }

test('a collapsed Bash row shows the model description; expanding keeps it as the header and lists the fields', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const use = await mountCall($, 'Bash', 'toolu_5', { ...GIT_CALL, timeout: 5000 })
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeDefined()
  expect(JSON.stringify(await use.drawn())).not.toContain('git status &&')
  await use.press({ key: 'collapse-tools:toolu_5' })
  expect((await use.find({ type: 'Button' }))?.text).toBe('[-] Bash  Show git status head and last commit')
  const texts = (await use.findAll({ type: 'Text' })).map(node => node.text)
  expect(texts).toContain('    command: git status && git log -1')
  expect(texts).toContain('    timeout: 5000')
  expect(texts.some(text => text.includes('description:'))).toBe(false)
  expect(JSON.stringify(await use.drawn())).toContain('"color":"suggestion"')
  expect(JSON.stringify(await use.drawn())).not.toContain('engine row')
  await use.press({ key: 'collapse-tools:toolu_5' })
  expect((await use.find({ type: 'Button' }))?.text).toBe('[+] Bash  Show git status head and last commit')
  expect(JSON.stringify(await use.drawn())).not.toContain('command:')
})

test('an expanded multi-line command draws each line under the header', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  on('store.set', async () => ({ value: undefined }))
  await $.command.run({ ...RUN, args: 'summary off' })
  const use = await mountCall($, 'Bash', 'toolu_14', { command: 'echo one\necho two', description: 'Echo twice' })
  await use.press({ key: 'collapse-tools:toolu_14' })
  expect((await use.find({ type: 'Button' }))?.text).toBe('[-] Bash  echo one')
  const texts = (await use.findAll({ type: 'Text' })).map(node => node.text)
  expect(texts).toContain('    command:     echo one')
  expect(texts).toContain(`${' '.repeat(17)}echo two`)
  expect(texts).toContain('    description: Echo twice')
})

test('a collapsed Agent row shows its description', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const use = await mountCall($, 'Agent', 'toolu_6', { prompt: 'Read every file and report', description: 'Audit the auth flow' })
  expect(await use.find({ text: '[+] Agent  Audit the auth flow' })).toBeDefined()
})

test('rows without a usable description keep the raw arg: no description, an off-list tool, a blank description', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const bare = await mountCall($, 'Bash', 'toolu_7', { command: 'ls -la' })
  expect(await bare.find({ text: '[+] Bash  ls -la' })).toBeDefined()
  const mcp = await mountCall($, 'mcp__linear__save_issue', 'toolu_8', { command: 'deploy now', description: 'Long issue body' })
  expect(await mcp.find({ text: '[+] linear:save_issue  deploy now' })).toBeDefined()
  const blank = await mountCall($, 'Bash', 'toolu_9', { command: 'pwd', description: '  ' })
  expect(await blank.find({ text: '[+] Bash  pwd' })).toBeDefined()
})

test('summary off is saved and the same row shows the raw command; on restores the description', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  const saved: Array<{ key: string; value: unknown }> = []
  on('store.set', async (_$, e) => {
    saved.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  const use = await mountCall($, 'Bash', 'toolu_10', GIT_CALL)
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeDefined()

  const off = await $.command.run({ ...RUN, args: 'summary off' })
  expect(off.text).toBe('Row summaries off. Saved for future sessions.')
  expect(saved).toContainEqual({ key: 'summaries', value: false })
  expect(await use.find({ text: '[+] Bash  git status && git log -1' })).toBeDefined()

  await $.command.run({ ...RUN, args: 'summary on' })
  expect(saved).toContainEqual({ key: 'summaries', value: true })
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeDefined()
  expect((await $.command.run({ ...RUN, args: 'summary maybe' })).text).toBe('Usage: /collapse-tools summary on|off')
})

test('the summaries option off shows the raw command until the saved value says on', { options: { summaries: false } }, async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  on('store.set', async () => ({ value: undefined }))
  const use = await mountCall($, 'Bash', 'toolu_11', GIT_CALL)
  expect(await use.find({ text: '[+] Bash  git status && git log -1' })).toBeDefined()
  await $.command.run({ ...RUN, args: 'summary on' })
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeDefined()
})

test('a saved summaries=false is loaded at session.start and the collapsed row shows the raw command', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: { command: 'collapse-tools' } }))
  on('store.get', async (_$, e) => ({ value: e.key === 'summaries' ? false : undefined }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  const use = await mountCall($, 'Bash', 'toolu_12', GIT_CALL)
  expect(await use.find({ text: '[+] Bash  git status && git log -1' })).toBeDefined()
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeUndefined()
})

test('a saved summaries=false is reloaded at turn.start when session.start did not run (the /clear path)', async ($, on) => {
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'engine row' }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('store.get', async (_$, e) => ({ value: e.key === 'summaries' ? false : undefined }))
  const use = await mountCall($, 'Bash', 'toolu_13', GIT_CALL)
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeDefined()
  await $.turn.start({ text: 'hello', turnId: 'turn_1' })
  expect(await use.find({ text: '[+] Bash  git status && git log -1' })).toBeDefined()
  expect(await use.find({ text: '[+] Bash  Show git status head and last commit' })).toBeUndefined()
})
