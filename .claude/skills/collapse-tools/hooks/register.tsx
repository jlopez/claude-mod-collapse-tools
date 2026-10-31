import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { DONE_COLOR_STORE_KEY, resolveDoneColor, validColor } from './accent'
import { HINT_TEXT, collapsedSegments, expandedRows, isExpanded, keepsEngineRow } from './summary'
import type { Segment } from './summary'
import { SUMMARIES_STORE_KEY, describe, resolveSummaries } from './summarize'

const collapsed = atom({ plugin: 'collapse-tools', key: 'collapsed' } as const, true as boolean)
const epoch = atom({ plugin: 'collapse-tools', key: 'epoch' } as const, 0)
// True once the startup hint toast was shown, so it appears once per session.
const hinted = atom({ plugin: 'collapse-tools', key: 'hinted' } as const, false as boolean)
// The color set by `/collapse-tools color`, loaded from the plugin store at session start; null
// defers to the plugin option `doneColor`.
const doneColorOverride = atom({ plugin: 'collapse-tools', key: 'doneColorOverride' } as const, null as string | null)
// The setting saved by `/collapse-tools summary on|off`, loaded from the plugin store; null defers to
// the plugin option `summaries`.
const summariesOn = atom({ plugin: 'collapse-tools', key: 'summariesOn' } as const, null as boolean | null)
// Per-call override family: each member is addressed by tool_use_id, so a click redraws only that call.
const overrideRef = { plugin: 'collapse-tools', key: 'overrides' } as const

type Override = { epoch: number; open: boolean }

// A member written under an older epoch was reset by /collapse-tools and counts as no override.
const openOf = (entry: Override | undefined, current: number): boolean | undefined =>
  entry !== undefined && entry.epoch === current ? entry.open : undefined

const STORE_KEY = 'collapsed'
const USAGE =
  'Usage: /collapse-tools (toggle all) | /collapse-tools color <name|#hex|reset> | /collapse-tools summary on|off'
const SUMMARY_USAGE = 'Usage: /collapse-tools summary on|off'
const unknownColorText = (value: string): string =>
  `Unknown color "${value}". Use a name (red, green, yellow, blue, magenta, cyan, white, gray, claude, or a ...Bright variant) or #rrggbb.`

async function loadSavedColor($: EngineInterface): Promise<void> {
  try {
    const saved = validColor(await $.store.get(DONE_COLOR_STORE_KEY))
    if (saved !== null) await update($, doneColorOverride, () => saved)
  } catch (error) {
    $.ui.log(`collapse-tools: color load failed ${String(error)}`, { to: 'debug' })
  }
}

async function runColorCommand($: EngineInterface, value: string): Promise<{ text: string }> {
  if (value.toLowerCase() === 'reset') {
    await update($, doneColorOverride, () => null)
    try {
      await $.store.delete(DONE_COLOR_STORE_KEY)
    } catch (error) {
      $.ui.log(`collapse-tools: color store delete failed ${String(error)}`, { to: 'debug' })

      return { text: 'Completed-call color reset for this session only; the saved color could not be cleared.' }
    }

    return { text: 'Completed-call color reset. The saved color is cleared for future sessions.' }
  }
  if (value === '') return { text: USAGE }
  const color = validColor(value)
  if (color === null) return { text: unknownColorText(value) }
  await update($, doneColorOverride, () => color)
  try {
    await $.store.set(DONE_COLOR_STORE_KEY, color)
  } catch (error) {
    $.ui.log(`collapse-tools: color store write failed ${String(error)}`, { to: 'debug' })

    return { text: `Completed-call color set to ${color} for this session only; it could not be saved.` }
  }

  return { text: `Completed-call color set to ${color}. Saved for future sessions.` }
}

async function loadSavedSummaries($: EngineInterface): Promise<void> {
  try {
    const saved = await $.store.get(SUMMARIES_STORE_KEY)
    if (typeof saved === 'boolean') await update($, summariesOn, () => saved)
  } catch (error) {
    $.ui.log(`collapse-tools: summaries load failed ${String(error)}`, { to: 'debug' })
  }
}

async function runSummaryCommand($: EngineInterface, value: string): Promise<{ text: string }> {
  const word = value.toLowerCase()
  if (word !== 'on' && word !== 'off') return { text: SUMMARY_USAGE }
  const enabled = word === 'on'
  await update($, summariesOn, () => enabled)
  const label = enabled ? 'on' : 'off'
  try {
    await $.store.set(SUMMARIES_STORE_KEY, enabled)
  } catch (error) {
    $.ui.log(`collapse-tools: summaries store write failed ${String(error)}`, { to: 'debug' })

    return { text: `Row summaries ${label} for this session only; the choice could not be saved.` }
  }

  return { text: `Row summaries ${label}. Saved for future sessions.` }
}

// Loads the saved global choice; a store error or a non-boolean keeps the default (collapsed).
async function loadSaved($: EngineInterface): Promise<void> {
  try {
    const saved = await $.store.get(STORE_KEY)
    if (typeof saved !== 'boolean') return
    const current = await read($, collapsed)
    if (saved !== current) await update($, collapsed, () => saved)
  } catch (error) {
    $.ui.log(`collapse-tools: store read failed ${String(error)}`, { to: 'debug' })
  }
}

export const register: Register = (on, options) => {
  // Effective color = saved `/collapse-tools color` (doneColorOverride) ?? plugin option ?? default.
  const configColor = resolveDoneColor(null, options.doneColor)

  on('session.start', async ($, e, next) => {
    await loadSaved($)
    await loadSavedColor($)
    await loadSavedSummaries($)
    await $.command.register({
      name: 'collapse-tools',
      description: 'Toggle between one-line and full tool-call rows, or set the done color',
      argumentHint: 'color <name|#hex|reset> | summary on|off',
    })
    if (e.isInteractive && !(await read($, hinted))) {
      await update($, hinted, () => true)
      $.ui.toast(HINT_TEXT, { timeoutMs: 8000 })
    }

    return next(e)
  })

  // The atoms reset on /clear and no session.start follows, so reload the saved choice on the next turn.
  on('turn.start', async ($, e, next) => {
    await loadSaved($)
    // Atoms reset on /clear without a session.start, so reload the color when it is unset.
    if ((await read($, doneColorOverride)) === null) await loadSavedColor($)
    if ((await read($, summariesOn)) === null) await loadSavedSummaries($)

    return next(e)
  })

  on('command.run', { command: 'collapse-tools' }, async ($, e) => {
    const raw = e.args.trim()
    const word = raw.toLowerCase()
    if (word === 'color' || word.startsWith('color ')) return runColorCommand($, raw.slice('color'.length).trim())
    if (word === 'summary' || word.startsWith('summary ')) return runSummaryCommand($, raw.slice('summary'.length).trim())
    if (raw !== '') return { text: USAGE }
    const next = !(await read($, collapsed))
    await update($, collapsed, () => next)
    await update($, epoch, n => n + 1)
    try {
      await $.store.set(STORE_KEY, next)
    } catch (error) {
      $.ui.log(`collapse-tools: store write failed ${String(error)}`, { to: 'debug' })
    }

    return { text: next ? 'Tool calls collapsed to one line.' : 'Tool calls expanded.' }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    const member = { ...overrideRef, id }
    const [global, current, entry, override, summariesFlag] = await Promise.all([
      read($, collapsed),
      read($, epoch),
      read($, member),
      read($, doneColorOverride),
      read($, summariesOn),
    ])
    const doneColor = override ?? configColor
    const open = isExpanded(global, openOf(entry, current))
    const toggle = async () => {
      const [g, ep] = await Promise.all([read($, collapsed), read($, epoch)])
      await update($, member, cur => ({ epoch: ep, open: !isExpanded(g, openOf(cur, ep)) }))
    }
    const call = e.props
    const summary = resolveSummaries(summariesFlag, options.summaries) ? (describe(call.tool, call.input) ?? undefined) : undefined
    const columns = e.viewport?.columns
    const runs = (segments: readonly Segment[]) =>
      segments.map(segment => (
        <Text color={segment.color} bold={segment.bold} dimColor={segment.dim}>
          {segment.text}
        </Text>
      ))
    const button = (segments: readonly Segment[]) => (
      <Button key={`collapse-tools:${id}`} plain onPress={toggle}>
        {runs(segments)}
      </Button>
    )
    if (!open) return button(collapsedSegments(call, columns, doneColor, summary))

    // Expanded: the header (a Button, so a click folds it back) replaces the engine's row, and the
    // input fields follow one per line. Tools whose own row may carry more keep that row instead.
    const { header, fields } = expandedRows(call, columns, doneColor, summary)
    if (keepsEngineRow(call.tool)) {
      return (
        <Box flexDirection="column">
          {button(header)}
          {await next(e)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {button(header)}
        {fields.map(line => (
          <Text>{runs(line)}</Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    const [global, current, entry] = await Promise.all([
      read($, collapsed),
      read($, epoch),
      read($, { ...overrideRef, id }),
    ])
    if (isExpanded(global, openOf(entry, current))) return next(e)

    return <Box display="none" />
  })
}
