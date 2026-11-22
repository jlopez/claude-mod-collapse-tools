# Claude Fold: architecture

How the `collapse-tools` mod ("Claude Fold") works, end to end, as the base for changing it. Read top to bottom. Every claim about runtime behavior is tagged **observed** (run or traced in a live session or under `claude plugin test`) or **inferred** (read from code or the API declarations).

Sources: the mod's source under `.claude/skills/collapse-tools/`, the vendored API declarations `vendor/claude-code/claude-code.d.ts` (written by Claude Code 2.1.295), the `plugin-authoring` skill bundled with Claude Code 2.1.309 (`SKILL.md` and `reference.md`, which cover function hooks, `ui.render`, `$.state`, `$.store`, hot reload and installation), the upstream git history, and the install registry under `~/.claude/plugins/`.

## 1. What it does for the user

The transcript draws two rows per tool call: a `ToolUse` row (`Bash(npm run check)` with a spinner while running) and a `ToolResult` block under it (stdout, a diff, a file listing). The mod replaces the first with a one-line clickable button and hides the second. Nothing is sent to the model and nothing about the call is changed; this is a display-only mod.

It also folds the message rows other parties send: a subagent's hand-back report, a teammate's message, another session's message. These are long model-written texts that the engine draws in full; the mod draws each as one line, `[+] Message from <name>  <summary>` with a right-aligned line count (see "Message rows" below). And it draws each [squawk](https://github.com/ewasserman/squawk) message, received or sent, as one line naming who, the direction and the message's first line (see "squawk rows" below).

Collapsed rows (**inferred** from `collapsedSegments` and the segment tests; the exact strings below are asserted by `register.test.ts`):

```
[+] Bash  Show git status head and last commit
[+] Agent  Audit the auth flow
[+] Read  /src/auth.ts
[+] github:create_issue  Fix the login redirect                          running
[+] Edit  /src/app.ts                                                      error
```

- `[+]` is dim. The tool name is in the done color (default `white`, not bold) for a finished call; `warning` bold while running, `error` bold on failure, `inactive` bold when interrupted. These are theme keys, so they follow the user's theme (**inferred**: `ThemeKey` in the declarations lists them; the README admits they were never checked in every theme).
- The argument is dim. With summaries on (default) and the tool one of `Bash`, `Agent`, `Task`, `Monitor`, it is the call's own `description` input, cleaned but not cut; the row builder truncates it to the room left before the right-aligned status word. Otherwise it is the first non-empty string among `command`, `file_path`, `path`, `pattern`, `description`, `title`, `op`, else the first string field at all.
- A status word (`running`, `error`, `interrupted`) is right-aligned in the status color. A done call shows none.
- The row is cut to terminal width minus 4 columns (100 when the width is unknown) with `...`.
- MCP tool names `mcp__server__tool` read `server:tool`.

Expanded row, after a click (**inferred**, asserted in tests):

```
[-] Bash  Run the full gate
    command: npm run check
    timeout: 120000
```

The header is the collapsed row with `[-]` for `[+]` (same text, width budget and status word), except that a multi-line picked argument shows its first line only; so a click grows the row downward without changing its first line. Under it, one line per input field, indented 4: the `key:` label in the `suggestion` theme key, padded to the widest label (capped at 16 columns), then the value dim (a `Bash`/`Monitor` command laid out one clause per line is highlighted instead; see the decision note in section 3). `ARG_FIELDS` come first, then the input's own order. The field the header drew whole is left out (here `description`, drawn as the summary, which counts as whole only when cleaning left the raw description unchanged); a cut, multi-line or cleaned one stays. Strings keep their line breaks and every line's indentation, the first line's included (continuation lines are indented to the value column; leading and trailing blank lines, trailing spaces and control characters other than tab are dropped, and a lone CR breaks the line), objects and arrays are compact JSON, empty strings are skipped, and nothing is cut: a long line wraps at the terminal edge. Below the list the engine's normal `ToolResult` block is drawn. For `Agent`, `Task`, `AskUserQuestion`, `TodoWrite`, `ExitPlanMode` the field list is replaced by the engine's own `ToolUse` row, because those rows carry more than `Name(arg)` (a judgment from the types, not a live check, per the README).

Message rows (**inferred** from `message.ts` and the mount tests; the exact lines are asserted by `message.test.ts` and `register.test.ts`):

```
[+] Message from general-purpose  Widget throughput: results         4 lines
[-] Message from general-purpose  Widget throughput: results         4 lines
    (the engine's own row follows)
```

- Which rows fold: every `UserMessage` whose `from` is present. A row with no `from` (the person's own prompts, task notifications) passes through to the engine. `isExpanded` is not consulted (see the observed facts below).
- `[+] ` is dim. `Message from <name>` is in the done color, not bold. The summary is dim and the line count (`N lines`, `1 line`) dim and right-aligned where tool rows put the status word. The width budget is the tool rows': viewport columns less 4 (100 when unknown), cut with `...`.
- Summary: for a hand-back (text starts with `[Subagent hand-back]` and holds `The report follows:` followed by a line break) the first non-empty line of the report after the marker, else the first non-empty line of the text. Leading markdown heading marks (`## `) are stripped, list and quote marks stay, control characters are dropped, whitespace collapsed. Nothing left means no summary.
- Line count: the lines of the body being summarised (the report for a hand-back, the whole text otherwise), less trailing blank lines.
- Expanded (after a click): the `[-]` header, same text, in a column Box over `await next(e)`, the engine's own row untouched.
- The toggle uses the same `overrides` family (keyed by `e.requestId`), `collapsed` default and `epoch` as tool rows, so a click flips that one row and `/collapse-tools` flips message rows with the tool rows. No new setting, atom or store key. The command's reply texts are unchanged ("Tool calls collapsed to one line." / "Tool calls expanded.").

squawk rows (**inferred** from `squawk.ts` and the mount tests, the exact lines asserted by `squawk.test.ts` and `register.test.ts`; the three collapsed shapes and an expanded one of each kind **observed** in a live session 2026-11-22 on 2.1.309, with a stub `squawk` for the outgoing ones):

```
[+] Squawk from Bob  Hi, this is Bob's assistant.                    5 lines
[-] Squawk from Bob  Hi, this is Bob's assistant.                    5 lines
    Hi, this is Bob's assistant.
    Quick question about the deploy:
    ...
[+] Squawk reply  Second fixture reply.                              running
[+] Squawk to Bob  Second fixture reply.                             2 lines
[-] Squawk to Bob  Staging is green.                                 3 lines
    command:     squawk reply 38385976-2238-4481-aa18-49f20db6fc8a - <<'EOF'
                 Staging is green.

                 We can ship after lunch.
                 EOF
    description: Send squawk reply with staging status
```

- Incoming. A `UserMessage` row folds when its text is squawk's delivery text, whether or not it has a `from` (it has none, observed below): squawk's header `squawk: <kind> from <sender>, another person's assistant ...` must be the first non-empty line, or the second when the first is the engine's `Another Claude session sent a message:`. The body is between the first `----- begin <marker> -----` line after the header and the last `----- end <marker> -----` line of the same marker (to the end of the text when there is none); no begin line, no squawk message. A squawk message's label beats a `from` label. The row is the message row's (`messageRow`): `Squawk from <sender>` in the done color, the body's first non-empty line cleaned as `summaryOf` cleans, the body's line count. Expanded: the `[-]` header, then the body only, one `Text` per line indented 4 (`FIELD_INDENT`), not dim, each line cleaned as `stringLines` cleans a field (indentation kept, blank lines inside kept as rows of bare indent, which draw a blank row: observed); the engine's row is not drawn.
- Outgoing. A `Bash` `ToolUse` row whose command, after leading whitespace, starts with `squawk send` or `squawk reply` and whitespace. Label `Squawk to <names>`: the names from every `Sent to <name> and delivered ...`/`Sent to <name>: queued ...` line of the output's stdout (in order, each once), else the contact a `send` names, else `Squawk reply` (or `Squawk send` when even the contact could not be read); it takes a tool name's color and bold rule. The first line is the message's: the text positional (quotes removed, escapes undone), else the first clause's heredoc, replaced by the text squawk reports after ` Your user edited the text before sending; what was sent is:` when the output reports exactly one message sent. It is drawn whatever the summaries setting. The tail is the status word while the call is not done, else the dim line count of the message. Expanded: the header, then every input field as `expandedRows` draws them, none skipped.
- The toggle is the same `overrides` family (keyed by message id or `tool_use_id`), `collapsed` default and `epoch`. No new setting, atom or store key.

Controls:

| Control | Effect | Persisted |
|---|---|---|
| click a row | toggles that call or message against the current default | no (session state) |
| `/collapse-tools` | flips the default for all calls and message rows, clears every per-call toggle | yes, store key `collapsed` |
| `/collapse-tools color <name\|#hex\|reset>` | sets the done color | yes, store key `doneColor` |
| `/collapse-tools summary on\|off` | row summaries | yes, store key `summaries` |
| `/collapse-tools highlight <weight\|status\|off\|reset>` | shell command highlighting palette | yes, store key `syntaxPalette` |
| `/config` rows "Completed call color", "Row summaries", "Shell command highlighting" | plugin options, the fallback when nothing is saved | yes, `pluginConfigs` in settings |

`userConfig` fields: `doneColor` (string, default `white`), `summaries` (boolean, default `true`), `syntaxPalette` (string with `options: ["weight", "status", "off"]`, so `/config` draws it as a choice row; default `weight`; `resolveSyntaxPalette` still validates it, case-insensitively, falling back to `weight`).

Once per session, at start, an 8-second toast reads `click a [+] row to expand, /collapse-tools to toggle all` (**inferred**; a test asserts the text and the once-per-session guard).

**Observed** in this machine's install: the store file `~/.claude/plugins/store/collapse-tools_claude-mods-590fc706b233.json` holds `{"collapsed": true}` and nothing else, so neither color nor summaries has been set from the command line here; the `/config` defaults (white, on) apply.

## 2. How a Claude Code mod is wired

A mod is a plugin of *function hooks*, as opposed to the older command hooks (shell commands in `settings.json`). The harness docs call it a "mod". Three files make one:

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | manifest: `name`, `version`, `description`, optional `userConfig` (options the `/config` menu draws and `register` receives), optional `types` pointing at the state contract |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }`, exactly one hooks module |
| `hooks/register.tsx` | `export const register: Register = (on, options) => { ... }` |

A fourth file, `types/index.d.ts`, declares the plugin's `$.state` keys by merging into `interface PluginState` of the `claude-code` module. `claude plugin validate` checks every `$.state` reference in the module against it.

### The hook model

`on(event, matcher?, hook)` registers a hook. Every hook has the shape `($, e, next)`:

- `$` is the engine interface, spelled noun then method: `$.ui.toast`, `$.store.get`, `$.command.register`, `$.state.get`.
- `e` is the event's input, a frozen plain value.
- `next(e)` runs the plugins beneath and then the engine's own behavior and resolves to the event's result. Returning without calling `next` answers the event in place of the engine. `next({ ...e, x })` rewrites what the rest sees.

The module runs in its own environment: no DOM, no Node, no `require`, no timers (`$.clock` instead), no dynamic `import()`. JSX compiles against a global `h` (classic runtime; `tsconfig.json` sets `jsxFactory: "h"`). Elements are not globals; `const { Box, Text, Button } = $.ui.resolve(e)` hands out the drawing surface's table (`terminal`, `desktop`, `vscode`, `mobile` have different tables).

### The events this mod uses

| Event | Fires | What `next(e)` yields | Used here for |
|---|---|---|---|
| `session.start` | once per fresh load of the plugin, never on `/clear`; also on a hot reload | `{ cwd }` | load saved settings, register the command, toast |
| `turn.start` | when a model turn begins, before its first model call | `{ turnId }`, observe only | re-load settings after `/clear` reset the atoms |
| `command.run` with `{ command: 'collapse-tools' }` | when the person types `/collapse-tools ...` | nothing (a registered command has no core) | the command |
| `ui.render` with `{ component: 'ToolUse' }` | when the engine is about to draw a tool row; once per input value (props, viewport width), on plugin load, on `$.ui.invalidate`, and when a `$.state` value it read changes | the engine's own drawing | the one-line row, a squawk send/reply call's included |
| `ui.render` with `{ component: 'ToolResult' }` | same, for the result block | the engine's result drawing | hide or show the result |
| `ui.render` with `{ component: 'UserMessage' }` | same, for a transcript row carrying a message (the person's prompt, a notification, another party's message) | the engine's own row | fold a row sent by another party, or a squawk message, into one line |

`ui.render` is one event for every component with a render site. The input is discriminated by `component`; `e.requestId` is the instance (the `tool_use_id` for tool rows, the message id for `UserMessage`), `e.viewport` carries `columns` and `rows` when the surface has measured. A tree the hook returns is validated; an invalid tree or a throw while drawing falls back to the engine's own drawing, with a line in the debug log (and in the transcript while the folder is hot-reloaded).

### Where state lives

Three tiers, each with a different lifetime:

| Tier | API | Lifetime | Used here |
|---|---|---|---|
| module variables | plain `const` | until the next hot reload | only immutable constants and the `configColor` and `configPalette` computed from `options` |
| session state | `$.state.get/set`, or the `atom`/`read`/`update` helpers from `'claude-code'` | the session; reset by `/clear`; survives hot reload | `collapsed`, `epoch`, `hinted`, `doneColorOverride`, `summariesOn`, `syntaxPaletteOverride`, `overrides` family |
| plugin store | `$.store.get/set/delete/keys` | across sessions; a JSON file under `~/.claude/plugins/store/` | `collapsed`, `doneColor`, `summaries`, `syntaxPalette` |

Session state is the reactive layer. A `$.state.get` (or `read`) made *while a `ui.render` hook draws* subscribes that instance; a later `set` redraws exactly the readers. Writes are refused while drawing; they go in an `onPress` closure or another event. `update($, atom, fn)` reads, applies `fn`, writes with `ifVersion` and retries on a miss, so two presses before a redraw both land. A `StateFamily<T>` key holds one value per `id`; a reference `{ plugin, key, id }` addresses a member and a write to it redraws only that member's readers. `plugin` and `key` must be source literals so `claude plugin validate` can list them; only a family member's `id` may be computed.

The plugin store is a key-value JSON file, 4 MiB cap, values round-tripped through `JSON.stringify`. **Observed**: the file for this install is `~/.claude/plugins/store/collapse-tools_claude-mods-590fc706b233.json`, named `<plugin>_<marketplace>-<hash>.json`. The nursery notes record that it survived `claude plugin uninstall` and the marketplace switch, so the hash is not keyed on the marketplace source URL (**inferred** from that survival; what it hashes is undocumented).

Plugin options (`userConfig`) are a fourth, read-only input: `register(on, options)` receives the values stored in `settings.json` under `pluginConfigs[<plugin>].options` with defaults filled in. A change in `/config` reloads the module with the new `options` (per `reference.md`).

### Drawing primitives this mod uses

- `Button` with `plain` (no `[ ]` chrome), a stable `key`, string and `Text` children (anything else refused), `onPress`. A press raises `ui.press` and then the button's own closure, in the plugin's environment. The terminal reports clicks only in fullscreen mode or the desktop app (README limitation).
- `Text` with `color`, `bold`, `dimColor`.
- `Box` with `flexDirection="column"` to stack the header over the engine's row, and `Box display="none"` as the only documented draw-nothing answer (a hook must return an element, not `null`).
- `$.ui.toast(text, { timeoutMs })`, `$.ui.log(text, { to: 'debug' })`, `$.command.register({ name, description, argumentHint })`.

## 3. This mod's data flow

### Files

| File | Lines | Role |
|---|---|---|
| `.claude-plugin/plugin.json` | 41 | manifest, version `0.7.0`, three `userConfig` fields (`doneColor` string default `white`, `summaries` boolean default `true`, `syntaxPalette` choice default `weight`), `types` pointer |
| `.claude-plugin/icon.png` | | marketplace icon |
| `hooks/hooks.json` | 1 | names `./register.tsx` |
| `hooks/register.tsx` | 351 | all `$` access: atoms, store I/O, the six hooks, JSX |
| `hooks/summary.ts` | 358 | pure: arg picking, status, segment building for the collapsed row and the expanded header and field lines, `fitRow` (the row budgeting every row kind shares), `statusLabel`, `stringLines`, `allFields`, truncation, the keep-engine-row set, `isExpanded` |
| `hooks/message.ts` | 84 | pure: `foldsMessage`, the hand-back body, `firstLineOf`, `countOf`, `summaryOf`, `lineCount`, `messageBody`, `messageRow` (the row every message row is built by), `messageSegments` |
| `hooks/squawk.ts` | 277 | pure: `parseSquawkMessage`, `squawkMessageRow`, `bodyRows` (incoming); `parseSquawkSend` and its clause word reader, `sentTo`, `editedText`, `squawkSend`, `squawkSendSegments` (outgoing) |
| `hooks/shell.ts` | 376 | pure: `SHELL_TOOLS`, `isShellTool`, the one shell lexer (`scanShell`) and its two consumers: `formatShell` (one clause per line at top-level `&&`, `||`, `|`, `|&`, `;`) and `tokenize` (a clause line into `command`, `operator`, `string`, `variable`, `plain` runs); the palette tables, `styleTokens`, `resolveSyntaxPalette` |
| `hooks/summarize.ts` | 38 | pure: the described-tools allowlist, `cleanSummary`, `describe`, `resolveSummaries` |
| `hooks/accent.ts` | 21 | pure: color validation (`#rrggbb`, named, `...Bright`, `claude`), `resolveDoneColor` |
| `hooks/*.test.ts` | 1505 | 121 tests across 7 files under `claude plugin test` |
| `types/index.d.ts` | 13 | the state contract |
| `README.md` (plugin folder) | | what the plugin directory review asks for: a per-hook description |

The split is deliberate: `register.tsx` is the only file that touches `$`, the pure modules take data and return data, so they are unit-tested without an engine and `register.tsx` is tested through `$.ui.mount`.

### State contract

```ts
'collapse-tools': {
  collapsed: boolean                                  // default for all calls, starts true
  epoch: number                                       // bumped by /collapse-tools
  hinted: boolean                                     // startup toast shown
  doneColorOverride: string | null                    // null defers to options.doneColor
  summariesOn: boolean | null                         // null defers to options.summaries
  syntaxPaletteOverride: string | null                // null defers to options.syntaxPalette
  overrides: StateFamily<{ epoch: number; open: boolean }>  // per tool_use_id, or message id for message rows
}
```

### Session start

```
session.start
  ├─ loadSaved:          store.get('collapsed')  → update(collapsed) if boolean and different
  ├─ loadSavedColor:     store.get('doneColor')  → validColor → update(doneColorOverride)
  ├─ loadSavedSummaries: store.get('summaries')  → update(summariesOn) if boolean
  ├─ loadSavedPalette:   store.get('syntaxPalette') → validSyntaxPalette → update(syntaxPaletteOverride)
  ├─ command.register('collapse-tools')
  └─ if e.isInteractive && !hinted: update(hinted, true); ui.toast(HINT_TEXT, 8000ms)
```

Every store failure is caught and logged to the debug log; the in-session value stands. `configColor = resolveDoneColor(null, options.doneColor)` and `configPalette = resolveSyntaxPalette(null, options.syntaxPalette)` are computed once in `register`, outside any hook; they are the fallbacks when `doneColorOverride` or `syntaxPaletteOverride` is null.

### Turn start, the `/clear` path

`/clear` resets `$.state` but raises no `session.start`. So `turn.start` calls `loadSaved` on every turn and, when the color, summaries or palette atom is null, reloads those too. Cost: one to four store reads per turn (**inferred**). Tests cover the summaries and palette cases by mounting a row, firing `turn.start` with a mocked store, and checking the row changed.

### Draw a tool row

```
ui.render { component: 'ToolUse', requestId: tool_use_id, props: { tool, input, isRunning, isErrored, isInterrupted, output? }, viewport? }
  │
  ├─ read collapsed, epoch, overrides[id], doneColorOverride, summariesOn, syntaxPaletteOverride   (6 subscriptions)
  ├─ open = overrides[id].epoch === epoch ? overrides[id].open : !collapsed
  ├─ summary = resolveSummaries(summariesOn, options.summaries) ? describe(tool, input) : null
  ├─ palette = resolveSyntaxPalette(syntaxPaletteOverride, configPalette)
  ├─ button(segments) = <Button key=`collapse-tools:${id}` plain onPress={toggle}> {segments → <Text/>} </Button>
  ├─ sent = squawkSend(tool, input, output)                                      (null unless Bash running squawk send/reply first)
  ├─ if sent && !open:       return button(squawkSendSegments(call, sent, ..., false))
  ├─ if sent:                return <Box column> {button(squawkSendSegments(..., true))} {allFields(call) → <Text/>} </Box>
  │
  ├─ if !open:               return button(collapsedSegments(..., summary))       (engine row replaced, next() never called)
  ├─ { header, fields } = expandedRows(..., summary, palette)
  ├─ if keepsEngineRow(tool): return <Box column> {button(header)} {await next(e)} </Box>
  └─ else:                    return <Box column> {button(header)} {fields → <Text>{segments → <Text/>}</Text>} </Box>
```

The epoch trick: `/collapse-tools` does not clear the `overrides` family. It increments `epoch`, and `openOf` treats a member written under an older epoch as absent. Upstream commit `c513b46` introduced this: the first version kept one `Record<string, boolean>` atom, so any click redrew every row and a global toggle had to rewrite the map. A family member per `tool_use_id` plus an epoch makes a click redraw one row and a global toggle O(1) in writes (the readers of `epoch` and `collapsed`, all rows, redraw anyway).

`toggle` re-reads `collapsed` and `epoch` at press time, not from the draw-time closure, then writes `{ epoch, open: !isExpanded(g, openOf(cur, ep)) }` to the member. This is the documented pattern: never write from a value captured at draw time.

Inside `expandedRows`, `fieldRows` receives the tool: for a shell tool (`isShellTool`: `Bash`, `Monitor`) whose `command` is a string with no line break, `formatShell` splits it at top-level `&&`, `||`, `|`, `|&` and `;` and the operator leads each continuation line; if it yields one line, or the command has a line break, or the lexer ends inside a quote or bracket, the plain `stringLines` path runs. This is display-only and conservative (**inferred** from `shell.test.ts` and `summary.test.ts`; not checked in a live session). The collapsed row and the header are unchanged, including the "drawn whole" skip rule.

`expandedRows` also takes the palette and passes it, with the done color, down to `fieldLines`: each clause line of a split command becomes `styleTokens(tokenize(line), palette, doneColor)`, several styled runs in place of the one dim run. `tokenize` reads the line with the same lexer as `formatShell` (`scanShell`, one character walker that reports frame opens and closes, escapes and plain characters to a callback), so the two cannot disagree about where a quote or substitution ends; its runs always join back to the line, so the drawn text is byte-identical to the unhighlighted layout. The label column, the indents and every other path (a single clause, a line break, an unterminated quote, any non-shell field) are unchanged: one dim run per line. Under `off`, `styleTokens` merges every run into one dim run, the pre-highlighting look.

### Decision note: the `weight` highlighting palette

Decided with the user before implementation; recorded here so the next room does not relitigate it.

- **Chosen: `weight` (the default).** Weight plus one accent: the command word bold, the connecting operator in the `suggestion` theme key (the accent the `key:` labels already use), strings and variables at full brightness, everything else dim. It uses none of the status theme keys `success`, `warning`, `error`; a test in `shell.test.ts` asserts it.
- **Rejected as the default, kept selectable: `status`.** Status colors for syntax: strings `success` (green), variables `warning` (yellow), the command word in the done color, operators accented. Two status theme keys in all; `error` is never used.
- **Why.** These rows right-align a status word in a status color (`running` in `warning`, `error` in `error`), and the tool name carries the done color. Coloring strings green (`success`, which reads as "done") or variables yellow (the same `warning` key as `running`) makes syntax and status speak the same language within one row, so a reader cannot tell at a glance whether a yellow run is a variable or a running call. Status hues also degrade badly on light themes (yellow on white) and for colour-blind readers (green against red), while bold and dim survive both. So the semantic/status palette is reserved for the row's status word only, never for syntax.
- `off` keeps the all-dim look from before highlighting for anyone who wants none.

The field lines sit outside the Button, as siblings in the column Box, because a Button's children must be strings or Text; only the header is clickable. When the engine row is replaced (`!open`, or an expanded tool outside the keep set), `next(e)` is never called, so no plugin beneath this one and none of the engine's own `ToolUse` drawing runs for that row.

### Draw a message row

```
ui.render { component: 'UserMessage', requestId: message id, props: { text, origin, isExpanded, task?, from?, onScreen? }, viewport? }
  │
  ├─ squawk = parseSquawkMessage(text)
  ├─ row = squawk ? squawkMessageRow(squawk) : from ? messageBody(text, from.name) : null      ({ label, body })
  ├─ if row is null:  return next(e)                            (the person's prompts, notifications; before any read, so no subscription)
  ├─ read collapsed, epoch, overrides[requestId], doneColorOverride                      (4 subscriptions)
  ├─ open = overrides[id].epoch === epoch ? overrides[id].open : !collapsed
  ├─ button = <Button key=`collapse-tools:${requestId}` plain onPress={toggle}> {messageRow(row.label, row.body, columns, open, doneColor) → <Text/>} </Button>
  │
  ├─ if !open:   return button                                                         (engine row replaced, next() never called)
  ├─ if squawk:  return <Box column> {button} {bodyRows(row.body) → <Text/>} </Box>   (the body only; next() never called)
  └─ else:       return <Box column> {button} {await next(e)} </Box>
```

`messageSegments` uses the same row builder as the tool rows (`fitRow` in `summary.ts`, which `headerRow` now calls too): marker, name segment, dim arg, right-aligned tail. For a tool row the tail is the status word (none when done), for a message row the dim line count. `toggle` is the tool row's, on the message's family member. The `runs` helper that turns segments into `Text` is shared by both hooks.

### Decision note: every `from` row folds

Decided with the user before implementation.

- **Chosen: fold every `UserMessage` that has a `from`.** Hand-backs, teammates and other sessions alike.
- **Why not hand-backs only.** The transcript's `handback` flag is not in the props (**observed**, below), so a hand-back is recognised only by its text prefix, which is the engine's wording and may change. The prefix is therefore used only to pick a nicer summary line (the report's first line instead of the preamble), never to decide whether to fold; a missing prefix falls back to the first line of the text.
- **Shared toggle.** Message rows share the `overrides` family, `collapsed` and `epoch` with the tool rows, so `/collapse-tools` flips them together, by the user's choice. There is no separate setting.

### Observed facts about `UserMessage`

**Observed** 2026-11-14 with a probe on Claude Code 2.1.309:

- A subagent hand-back row arrives with `origin: { kind: 'peer' }`, `from: { name: 'general-purpose' }` (the subagent's name, else its type), no `task`, and `isExpanded: true` in the normal fullscreen view. The `handback` flag in the transcript file is not in the props.
- `text` includes the engine's preamble. It begins `[Subagent hand-back] The text below is the final report of a subagent this session delegated to. ...` as one long line that ends with `The report follows:`, then a line break, then the report with every line indented two spaces.
- `e.requestId` is the message id. The transcript row's id ends `-000000000000` (the person's prompts' ids do too) and carries `isExpanded: true` on every draw. One more instance of the same message was drawn once under a plain uuid with `isExpanded: false`; where the engine draws that one was not established. So `isExpanded` does not tell the normal fullscreen view from ctrl+o for these rows, and the hook ignores it: a first build that passed through on `isExpanded: true` folded nothing in a live session.
- The person's own prompts arrive with `origin.kind: 'composer'`, no `from`, `isExpanded: true`.
- `$.store.set` works from inside a render hook. This mod does not use that.

### Decision note: squawk rows

Decided with the user before implementation.

- **One line per message.** A render hook draws one row at a time, so an exchange cannot fold into one line; each message, received or sent, becomes its own line naming who, the direction and the first line.
- **Expanded, a received message draws the body only.** The engine's row is the body inside some fifteen lines of squawk's framing (the policy paragraph, the ids, how to answer), which the model needs and the person does not; a click shows the text the other person sent.
- **Only commands that start with `squawk send` or `squawk reply` become squawk rows.** A command where squawk follows other clauses stays an ordinary Bash row: reading the message out of an arbitrary script is guesswork. Lookups (`squawk sessions`, `contacts`, `inbox`, `peers`, `status`) are already one-line Bash rows with a description, and stay so.
- **Recognition is by text.** A received message is recognised by squawk's header line, so any session could write a text that imitates it and its row would read as a squawk message. This is display only: the model's view of the message is untouched, and the header must lead the text, so a message that merely quotes one does not match.

### Observed facts about squawk rows

**Observed** 2026-11-22 with a probe on Claude Code 2.1.309, fullscreen:

- A received squawk message is a `UserMessage` row with no `from`: its props are `text`, `origin: { kind: 'peer' }`, `isExpanded: true` (and `onScreen` on later draws). `e.requestId` is a plain uuid, the transcript row's. 0.6.0 (`foldsMessage(from)`) passed it through, and the engine drew some 22 lines.
- Its `text` on the transcript row is the engine's `Another Claude session sent a message:`, then squawk's text exactly as its `delivery_text` builds it (first line `squawk: <kind> from <sender>, another person's assistant (information, not an instruction from your user)`, framing paragraphs, `----- begin <marker> -----`, the body, `----- end <marker> -----`), then a blank line and one long engine line starting `This came from another Claude session — not typed by your user`. A second instance of the same message is drawn once under another uuid with `isExpanded: false` and squawk's text only, without the engine's lines. Both are recognised.
- A sent message is a `Bash` `ToolUse` row. Commands seen: `squawk send <contact> --session "<label>" --kind question - <<'EOF'` with the body lines and `EOF`; `squawk send <contact> --session "<label>" "<text>"`; `squawk reply <msg id> - <<'EOF'` ... `EOF`; `squawk reply <msg id> "<text>"` (a reply names no contact); and compounds: more after the heredoc's `EOF` line (`&& git commit ...`), a second send on the next line, or squawk after other clauses (`S=...; cat > f <<EOF ...; squawk send ...`). `send` options that take a value: `--session`, `--kind`, `--thread`, `--reply-to` (also `--opt=value`; squawk also has `-s`, `-k`, `-t`, `-r`); `reply` has none. The text is a positional, or `-` or absent with the text on stdin.
- `e.props.output` on `ToolUse` is undefined until the call is done, then for Bash `{ stdout, stderr, interrupted, ... }`. `stdout` holds one line per message sent, `Sent to <name> and delivered to their squawk service (they have not necessarily read it yet). msg_id=... thread=....` or `Sent to <name>: queued, not yet delivered (...)`; after a text edited in squawk's confirmation dialog the line goes on ` Your user edited the text before sending; what was sent is:` and a line break, then the text. A cancel or timeout prints `Not sent: ...` and exits 1, so the row is errored and shows `error`. Early renders can carry `input: {}` while the input streams in (the row is an ordinary Bash row until the command arrives).
- In fullscreen, a Bash call got no `ToolResult` render at all; nothing here relies on `ToolResult`.
- A `Text` holding only spaces (a blank line's bare indent) draws a blank row.

### Draw a result block

```
ui.render { component: 'ToolResult', requestId: tool_use_id, props: { tool, output, isErrored } }
  ├─ read collapsed, epoch, overrides[id]
  ├─ expanded → return next(e)         (the engine's result drawing, untouched)
  └─ collapsed → return <Box display="none" />
```

The result block and the use row share the `tool_use_id`, so both read the same family member and flip together on one write.

### Click

```
ui.press { element: 'collapse-tools:<id>' }  →  engine runs the Button's onPress closure
  → toggle(): read collapsed, epoch → update(overrides[id], { epoch, open: !current })
  → the two subscribed instances (ToolUse, ToolResult of that id) redraw
```

### Command

```
command.run { command: 'collapse-tools', args }
  ├─ 'color <x>'      → validColor; update(doneColorOverride); store.set('doneColor') | 'reset' → null; store.delete
  ├─ 'summary on|off' → update(summariesOn); store.set('summaries')
  ├─ 'highlight <p>'  → validSyntaxPalette; update(syntaxPaletteOverride); store.set('syntaxPalette') | 'reset' → null; store.delete | invalid → HIGHLIGHT_USAGE
  ├─ anything else    → { text: USAGE }
  └─ ''               → (tool and message rows alike) next = !collapsed; update(collapsed); update(epoch, n+1); store.set('collapsed'); { text }
```

The returned `{ text }` is drawn as the command's output row and read by the model. Every write to the color, summaries or palette atom redraws every row, since every row reads all three.

### The pure functions

- `messageRow(label, body, columns, open, doneColor)`: `[+]`/`[-]`, the label in the done color, the body's first line dim (`firstLineOf`: heading marks stripped, control characters dropped, whitespace collapsed), the dim line count (`countOf`, trailing blank lines dropped) right-aligned, all through `fitRow`; every message row, squawk's included, is built by it. `messageSegments(text, name, ...)` is `messageRow` over `messageBody(text, name)`: `Message from <name>` and the body (`bodyOf`: a hand-back's report, else the whole text). `summaryOf` and `lineCount` are `firstLineOf` and `countOf` of that body; `foldsMessage(from)` is true when a sender is present.
- `parseSquawkMessage(text)`: `{ sender, kind, body }` or null, by the header and marker rules in section 1; lines split on any line break, CRLF tolerated. `bodyRows(body)`: `stringLines(body)`, each line one `Segment` with the 4-column indent prepended.
- `parseSquawkSend(command)`: `{ verb, to, body }` or null. A small word reader takes the first clause (to the line's end or a top-level `;`, `&`, `|`), removing single and double quotes, undoing backslash escapes (inside double quotes only `\"`, `\\`, `\$`, a backtick and a line continuation), dropping redirections with their target and a `#` comment, and taking a `<<`, `<<-`, `<<'EOF'` or `<<"EOF"` delimiter out of the words. Options are skipped (`send`'s value options with their value), `--` ends them, `-` is a positional. `to` is `send`'s first positional; `body` the second positional unless `-`, else the heredoc's lines (from the next line up to the delimiter line, tabs stripped for `<<-`), else ''. An unterminated quote gives an empty body; it never throws.
- `sentTo(output)`, `editedText(output)`: stdout is the output's string `stdout`, or the output when it is a string; the sent lines are read before the edited marker only, so an edited text cannot add recipients. `squawkSend(tool, input, output)` combines them into `{ label, body }` for a Bash call, null otherwise; `squawkSendSegments` builds the row through `fitRow` with `statusLabel` for the name.
- `allFields(call, doneColor, palette)`: `fieldRows` with nothing skipped. `statusLabel(text, status, doneColor)`: the name segment in the status color, bold unless done, which `headerRow` uses too.
- `fitRow(columns, marker, name, main, tail)`: the budgeting both row kinds share (width less margin, the arg drawn only if 4 columns remain, the tail right-aligned, a final clip). `headerRow` is a thin wrapper that supplies the tool name and status word.
- `collapsedSegments(call, columns, doneColor, summary?)`: a thin wrapper over the private `headerRow` with the `[+]` marker. `headerRow` builds the marker, the name, then budgets `width - name - GAP - wordRoom` for the argument. The argument is drawn only if at least 4 columns remain. The status word is padded to the right edge. A final `clipSegments` guarantees the total fits. It also reports which field it drew whole (the summary stands for `description`, whole only when it equals the trimmed raw `input.description`).
- `expandedRows(call, columns, doneColor, summary?, palette = 'weight')`: returns `{ header, fields }`. `header` is `headerRow` with `[-]`; without a summary the picked arg goes through `expandedArg`, which keeps the first line of a multi-line value and counts it whole only when that line equals the trimmed raw value. `fields` (from `fieldRows`) is one `Segment[]` per drawn line: `{ text: '    ' }`, `{ text: 'key:' + pad, color: 'suggestion' }`, `{ text: value, dim: true }`, and `[{ indent }, { line, dim }]` for each continuation line. Order is `ARG_FIELDS` then insertion order; the field `headerRow` drew whole is skipped; values are uncut. String values go through `stringLines`: split on CRLF, LF or a lone CR, control characters but tab dropped, each line `trimEnd`ed, leading and trailing blank lines dropped, leading indentation kept. A shell command split into clauses replaces the one `{ value, dim }` run of each line with the styled runs of `styleTokens`.
- `tokenize(line)`: `Token[]` of kinds `command`, `operator`, `string`, `variable`, `plain`; the texts join to the line. A leading `&&`/`||`/`|&`/`|`/`;` is the operator; the first word wholly outside every frame that is not an assignment (words split at unescaped whitespace, so `my\ tool` is one word) is the command, unless it starts with `;&|<>` or holds an unescaped `<` or `>` (`2>/dev/null`, `ls>out`: a redirection, so no command is marked); single quotes are a string, and so is an ANSI-C `$'...'` with its `$`; double quotes a string with `$name`/`${...}`/`$(...)`/backtick spans split out as variables; a backtick span is a variable (old-style command substitution); groups `( )`, `{ }`, `[[ ]]` are transparent. Redirections are plain (parked); so is a `#` comment, from a top-level unescaped `#` that starts a word to the end of the line, variables inside it included (a `comment` kind is parked). A line that ends inside a frame is one plain token.
- `styleTokens(tokens, palette, doneColor)`: maps each kind through `paletteStyles(palette, doneColor)` to a `Segment`, merging neighbours of the same style.
- `statusOf`: interrupted > error > running > done.
- `describe(tool, input)`: null unless the tool is in `DESCRIBED_TOOLS` and `input.description` is a string that survives `cleanSummary` (control chars to spaces, format chars dropped, double quotes and backticks dropped, whitespace collapsed, leading and trailing quotes and punctuation stripped; the result is not cut, the row builder truncates it to the room left before the right-aligned status word).
- `truncate` works on code points (`Array.from`), so a surrogate pair is never split; it does not account for East Asian wide characters or grapheme clusters, so a row of CJK or emoji can still overflow by display width (**inferred**).

## 4. Build and release path

### Repo layout and the gate

The mod lives at `.claude/skills/collapse-tools/` inside a thin npm repo. The repo root exists only for tooling: `package.json` (TypeScript as the one dev dependency), `tsconfig.json`, `vendor/`, CI, docs.

```
npm run check  =  claude plugin validate .claude/skills/collapse-tools
               && tsc -p tsconfig.json
               && claude plugin test .claude/skills/collapse-tools
```

**Observed** on this branch: all three pass, 121 tests across 7 files in about a second.

- `validate` parses the manifest and the module source the way the engine will, and lists every event hooked, every `$` call and every `$.state` key against the contract.
- `tsc` type-checks against `vendor/claude-code/claude-code.d.ts`. `tsconfig.json` sets `types: []` (no `@types/node`; the module has no Node), `jsx: react` with `jsxFactory: h`, `moduleResolution: bundler`, strict plus `noUncheckedIndexedAccess`, and includes the vendor file, `hooks/`, `types/` and the tests.
- `test` runs the `*.test.ts` files in an environment like a hooks module's, the plugin loaded by the engine's own host. `$.ui.mount({ plugin, surface, component, props })` draws a component through the plugin and hands back a drawing to `find`, `press` and inspect. Test hooks registered with the test's `on` sit *beneath* the plugin and stand in for the engine and the store (`on('store.get', ...)`, `on('ui.render', ...)` returning `engine row`).

CI (`.github/workflows/ci.yml`) runs `npm ci && npm run typecheck` on push to `main` and `feat/**` and on pull requests against them. Validate and test need the `claude` CLI, so they run locally only.

### The vendored types

`vendor/claude-code/claude-code.d.ts` (21,451 lines) is the API declaration file Claude Code 2.1.295 wrote. It is checked in so CI can type-check without a `claude` binary. `CLAUDE.md` forbids editing it; regeneration means loading the `plugin-authoring` skill (which writes this build's file into the skill's folder) and copying.

When the engine hot-reloads a mod from a folder it watches, it also writes the same declarations beside the mod at `.claude-plugin/types/` (API, built-in tool inputs, connected MCP tools, a `tsconfig.json`). `.gitignore` excludes that folder. An installed plugin's folder is never written into.

**Observed** drift: the 2.1.309 declarations are 22,552 lines. For the props this mod uses, `ToolUse` and `ToolResult` each gained one field, `isExpanded?: boolean`, "whether the view draws the row in full: the ctrl+o transcript, `--verbose`, or a `ToolGroup` that a hook unfolded into rows", with the note "a hook that draws a compact row of its own passes when true, so ctrl+o shows all". `ThemeKey` is unchanged. See Levers.

### How the installed copy relates to the source

```
GitHub jlopez/claude-mods  (.claude-plugin/marketplace.json)
   entry: name collapse-tools, source git-subdir, url jlopez/claude-mod-collapse-tools.git, path .claude/skills/collapse-tools, version 0.7.0
        │  claude plugin marketplace add jlopez/claude-mods
        ▼
~/.claude/plugins/marketplaces/claude-mods/            clone of the marketplace repo
~/.claude/plugins/known_marketplaces.json              { "claude-mods": { source: github jlopez/claude-mods } }
        │  claude plugin install collapse-tools@claude-mods
        ▼
~/.claude/plugins/cache/claude-mods/collapse-tools/0.3.0/   the plugin subdir, copied from the fork at commit 4516736
~/.claude/plugins/installed_plugins.json               { "collapse-tools@claude-mods": [{ scope: user, installPath, version, gitCommitSha }] }
~/.claude/settings.json                                enabledPlugins["collapse-tools@claude-mods"] = true
~/.claude/plugins/store/collapse-tools_claude-mods-<hash>.json   the plugin store, survives uninstall
```

**Observed**: `diff -r` between the cache folder and the worktree's `.claude/skills/collapse-tools` shows no difference (excluding `.in_use`). The cache is a byte-for-byte copy of the plugin subdir at the recorded commit, tests included. `installed_plugins.json` records `gitCommitSha` `4516736…`, the fork's head.

**Observed**: `0.3.0/.in_use/71949` holds `{"pid":71949,"procStart":"Sat Oct 31 00:12:36 2026"}`. **Inferred**: a per-process lock so an update does not remove a version a running session loaded.

Release cycle for a change (from the nursery notes, matching `reference.md`):

1. Edit, `npm run check`, bump `version` in `plugin.json`, commit, PR, merge, push to the fork.
2. Mirror `version` in the marketplace repo's `marketplace.json`, push.
3. `claude plugin marketplace update claude-mods && claude plugin update collapse-tools@claude-mods`, then a new session.

Testing a PR before release (**observed** 2026-10-30, 0.3.0 cache, Claude Code 2.1.309): copy the worktree's `.claude/skills/collapse-tools/` over the installed cache folder named by `installPath` in `~/.claude/plugins/installed_plugins.json`, keeping its `.in_use/` lock (`rsync -a --exclude=.in_use`), then `/reload-plugins` in the running session. The session picks up the new module without a restart, so a reviewer verifies the behavior in place. Back the cache folder up first; the next `claude plugin update` after a version bump replaces it anyway. This beats `--plugin-dir` because an installed plugin of the same name takes precedence over a `--plugin-dir` copy.

Every installed plugin from a git or GitHub source "runs the copy made when it was installed"; edits reach a session only through a new version and `claude plugin update` then `/reload-plugins`. The exception the docs name is a marketplace that is a local folder with a relative-path entry, which is read in place and re-read on `/reload-plugins`. For development the shorter road is `claude --plugin-dir <abs path to .claude/skills/collapse-tools>`: the folder is watched and a save reloads the module when the folder goes quiet (or, when the model itself edits it, when the turn ends). An installed plugin of the same name takes precedence over a `--plugin-dir` copy, so uninstall while developing.

A hot reload runs `register` and `session.start` again in a fresh environment. `$.state` and `$.store` survive, module variables do not, which is why `CLAUDE.md` forbids state in module variables. `hinted` is session state, so the toast does not repeat on reload (**inferred**).

## 5. What upstream decided and why

All 16 upstream commits are by 0xnicholasy, 15 of them on 2026-10-09, with Claude as co-author. Bodies are terse; the reasoning below is read from the diffs and the README.

| Commit | Decision | Evidence |
|---|---|---|
| `c48a1d2` | Scaffold: mod inside `.claude/skills/`, vendored types, pure logic split from wiring, `claude plugin test` as the test runner | initial tree, `tasks/todo.md` |
| `c513b46` | Per-call state as a `StateFamily` keyed by `tool_use_id` plus an epoch counter, replacing one map atom | diff: "so a click redraws only that call"; `Box height={0}` replaced by `display="none"` |
| `8e5bd95` | `[+]`/`[-]` markers, status word right-aligned, single-line expanded header, startup toast | README "Click hint" |
| `d972b55`, `4ae998e`, `77cd9e0` | User-pickable done color via command and option; default moved from a muted color to `white`; renamed "completed-call color" | three commits in a row show the default was contested |
| `bb02ed3` | Expanded header shows scalar fields only; toast text without the plugin-name prefix (the toast box already names the plugin) | diff |
| `a67550c` | Haiku summaries: a `tool.call` hook ran a side model call per tool call, cached by FNV-1a of the compact input, with a system prompt asking for an 8-word label | `summarize.ts` at that commit: `SYSTEM`, `cacheKey`, `awaitBoth` |
| `826199a` | Sanitize labels, treat tool input as untrusted in the prompt | commit title |
| `893ad96` | **Reverted the model calls the same day.** Summaries now come from the `description` field the model already wrote, for an allowlist of tools whose `description` is documented as a purpose line. 383 lines deleted. | diff; README "Data and privacy" section appears |
| `19e70e7` | Display name "Claude Fold"; plugin id and command unchanged so installs and the store key survive | commit body |
| `169fb51` | Plugin-folder README with a per-hook table, because "the plugin directory validates the folder and asks the plugin's own README to say what each hook does" | commit body |
| `4516736` (fork) | `homepage` and `repository` point at the fork; author unchanged | nursery notes: minimal change |

The reversal in `893ad96` is the most instructive one. A per-call model request adds latency and cost to every tool call and puts untrusted tool input into a prompt; the field the model already fills for `Bash`, `Agent` and `Monitor` gives most of the value for free. The allowlist exists because `description` means a task body for `TaskCreate`/`TaskUpdate` and arbitrary things for MCP tools.

The judgment calls the README itself flags as unverified live: how the rows look, whether clicks land on every surface, whether the four theme keys read as the intended colors in every theme, and which tools' engine rows carry more than `Name(arg)`.

## 6. Levers

Places a change plugs in, and rough edges seen while tracing.

### Plug-in points

- **Row text.** `collapsedSegments` and `expandedRows` in `summary.ts` are pure and return `Segment[]` (one per line for the field list); any change to what a row says is a change there plus a test in `summary.test.ts`. `ARG_FIELDS` order and `MIN_ARG`, `MARGIN`, `FIELD_INDENT`, `MAX_KEY_WIDTH`, `KEY_COLOR` are the knobs.
- **Shell command layout.** `formatShell` and `SHELL_TOOLS` in `shell.ts`: add a tool whose `command` is a shell command to `SHELL_TOOLS`; the bracket/quote handling is in the one lexer, `scanShell`, and the separators in its `formatShell` consumer, tested in `shell.test.ts`. The wiring is `shellLines` in `summary.ts`; dropping the no-line-break rule is a one-line change there.
- **Shell highlighting.** The `PALETTES` table in `shell.ts` is the switch point: one `TokenKind → TokenStyle` table per palette (`status` a function of the done color). A new look is a new entry plus its name in `SyntaxPalette`, `SYNTAX_PALETTES` and the `options` of the `syntaxPalette` field in `plugin.json`. What counts as which kind is `tokenize`; the parked follow-ups are a `comment` kind for `#` and a redirection kind, both `plain` today. Keep `weight` free of `success`/`warning`/`error` (see the decision note in section 3).
- **Which tools get a summary.** `DESCRIBED_TOOLS` in `summarize.ts`. Note that for `Agent` the summary path changes little: `description` is already in `ARG_FIELDS` and `Agent` input has no `command`/`file_path`, so with summaries off the same text shows, uncleaned. The summary setting really only affects `Bash` (whose `command` wins otherwise) and `Monitor`.
- **Which tools keep the engine row when expanded.** `KEEP_ENGINE_ROW` in `summary.ts`.
- **ctrl+o and `--verbose`.** `ToolUse` and `ToolResult` props carry `isExpanded?: boolean` as of 2.1.309 (absent in the vendored 2.1.295 types). The documented pattern is: a hook that draws a compact row returns `next(e)` when `isExpanded` is true. One guard at the top of each render hook removes the "ctrl+o does not unfold these rows" limitation. It needs the vendored types regenerated, and a decision about whether to keep the fold inside the ctrl+o view too.
- **Tool groups.** The engine folds runs of reads and searches into a `ToolGroup` row (`Read 3 files`) that this mod does not hook. A `ToolGroup` hook can set `isExpanded` to unfold a group; the rows it unfolds into are `ToolUse` instances this mod's hook then sees. In fullscreen mode no `ToolGroup` is drawn at all.
- **Result content.** `e.props.output` is available on both `ToolUse` and `ToolResult`; only a squawk send/reply row reads it (the recipients). A collapsed row could show an exit code, a line count or a diff stat without expanding.
- **Status.** The fallback color and bold rule live in `STATUS_COLOR`, `isBold`, `colorOf`. A spinner glyph on running rows would be a `Text` segment; nothing animates without `$.clock` and an invalidate, which `ui.render` docs allow ("a clock invalidates").
- **Per-call persistence.** Clicks are session state by design. Persisting them means writing the family member to `$.store` too, keyed by `tool_use_id`; a store is capped at 4 MiB.
- **Keyboard.** `Button` takes a `hotkey` (one digit or lowercase letter) that works while the plugin's site holds focus, and an `action` naming an engine keybinding whose chord presses it from the prompt. Neither is used; the mod is mouse-only outside `/collapse-tools`.
- **A command.describe or CommandOutput hook** could draw the command's reply as a tree instead of a text row.

### Rough edges

- **`turn.start` reads the store every turn** to recover from `/clear`. Cheap, but a `session.start` fires on reload and not on `/clear`, so there is no event that says "atoms were just reset". A sentinel atom (`loaded: boolean`, reset by `/clear`) would turn the per-turn read into a one-time read.
- **`overrides` is never pruned.** One family member per clicked call for the session's life. Harmless at session scale, worth knowing.
- **Width is in code points, not display cells.** `truncate` and the budget arithmetic count `Array.from(text).length`; wide glyphs overflow the row.
- **`Box display="none"` leaves the transcript's inter-message margin.** The README calls this out; it is engine-side.
- **The `done` default of `white`** is not a theme key, so on a light theme the name of a finished call is white on light (**inferred**; the README's "not verified in every theme" admission).
- **The vendored types lag the running build** (2.1.295 vs 2.1.309). The gap is small today and the mod loads and tests fine under 2.1.309 (**observed**), but any lever that uses a new prop needs the regeneration step first.
- **`register` reads `options.doneColor` and `options.syntaxPalette` once.** Correct because a `/config` change reloads the module, but a reader of the code may expect it inside a hook.
- **Author metadata** still names upstream; the top-level README's badges and install lines point at `0xnicholasy/claude-mods`, while the marketplace that actually installs it is `jlopez/claude-mods` (nursery notes list this as a pending doc fix).
- **CI triggers** cover `main` and `feat/**` only; a `docs/**` or `fix/**` branch push runs nothing, though a PR against `main` still does.

## Ideas

Improvement ideas voiced by Jesus, each a candidate future room. None are implemented here.

- (none yet)
