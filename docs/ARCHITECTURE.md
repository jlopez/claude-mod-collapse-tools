# Claude Fold: architecture

How the `collapse-tools` mod ("Claude Fold") works, end to end, as the base for changing it. Read top to bottom. Every claim about runtime behavior is tagged **observed** (run or traced in a live session or under `claude plugin test`) or **inferred** (read from code or the API declarations).

Sources: the mod's source under `.claude/skills/collapse-tools/`, the vendored API declarations `vendor/claude-code/claude-code.d.ts` (written by Claude Code 2.1.295), the `plugin-authoring` skill bundled with Claude Code 2.1.309 (`SKILL.md` and `reference.md`, which cover function hooks, `ui.render`, `$.state`, `$.store`, hot reload and installation), the upstream git history, and the install registry under `~/.claude/plugins/`.

## 1. What it does for the user

The transcript draws two rows per tool call: a `ToolUse` row (`Bash(npm run check)` with a spinner while running) and a `ToolResult` block under it (stdout, a diff, a file listing). The mod replaces the first with a one-line clickable button and hides the second. Nothing is sent to the model and nothing about the call is changed; this is a display-only mod.

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

The header is the collapsed row with `[-]` for `[+]` (same text, width budget and status word), except that a multi-line picked argument shows its first line only; so a click grows the row downward without changing its first line. Under it, one line per input field, indented 4: the `key:` label in the `suggestion` theme key, padded to the widest label (capped at 16 columns), then the value dim. `ARG_FIELDS` come first, then the input's own order. The field the header drew whole is left out (here `description`, drawn as the summary, which counts as whole only when cleaning left the raw description unchanged); a cut, multi-line or cleaned one stays. Strings keep their line breaks and every line's indentation, the first line's included (continuation lines are indented to the value column; leading and trailing blank lines, trailing spaces and control characters other than tab are dropped, and a lone CR breaks the line), objects and arrays are compact JSON, empty strings are skipped, and nothing is cut: a long line wraps at the terminal edge. Below the list the engine's normal `ToolResult` block is drawn. For `Agent`, `Task`, `AskUserQuestion`, `TodoWrite`, `ExitPlanMode` the field list is replaced by the engine's own `ToolUse` row, because those rows carry more than `Name(arg)` (a judgment from the types, not a live check, per the README).

Controls:

| Control | Effect | Persisted |
|---|---|---|
| click a row | toggles that call against the current default | no (session state) |
| `/collapse-tools` | flips the default for all calls, clears every per-call toggle | yes, store key `collapsed` |
| `/collapse-tools color <name\|#hex\|reset>` | sets the done color | yes, store key `doneColor` |
| `/collapse-tools summary on\|off` | row summaries | yes, store key `summaries` |
| `/config` rows "Completed call color", "Row summaries" | plugin options, the fallback when nothing is saved | yes, `pluginConfigs` in settings |

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
| `ui.render` with `{ component: 'ToolUse' }` | when the engine is about to draw a tool row; once per input value (props, viewport width), on plugin load, on `$.ui.invalidate`, and when a `$.state` value it read changes | the engine's own drawing | the one-line row |
| `ui.render` with `{ component: 'ToolResult' }` | same, for the result block | the engine's result drawing | hide or show the result |

`ui.render` is one event for every component with a render site. The input is discriminated by `component`; `e.requestId` is the instance (the `tool_use_id` for tool rows), `e.viewport` carries `columns` and `rows` when the surface has measured. A tree the hook returns is validated; an invalid tree or a throw while drawing falls back to the engine's own drawing, with a line in the debug log (and in the transcript while the folder is hot-reloaded).

### Where state lives

Three tiers, each with a different lifetime:

| Tier | API | Lifetime | Used here |
|---|---|---|---|
| module variables | plain `const` | until the next hot reload | only immutable constants and the `configColor` computed from `options` |
| session state | `$.state.get/set`, or the `atom`/`read`/`update` helpers from `'claude-code'` | the session; reset by `/clear`; survives hot reload | `collapsed`, `epoch`, `hinted`, `doneColorOverride`, `summariesOn`, `overrides` family |
| plugin store | `$.store.get/set/delete/keys` | across sessions; a JSON file under `~/.claude/plugins/store/` | `collapsed`, `doneColor`, `summaries` |

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
| `.claude-plugin/plugin.json` | 34 | manifest, version `0.4.0`, two `userConfig` fields (`doneColor` string default `white`, `summaries` boolean default `true`), `types` pointer |
| `.claude-plugin/icon.png` | | marketplace icon |
| `hooks/hooks.json` | 1 | names `./register.tsx` |
| `hooks/register.tsx` | 225 | all `$` access: atoms, store I/O, the five hooks, JSX |
| `hooks/summary.ts` | 322 | pure: arg picking, status, segment building for the collapsed row and the expanded header and field lines, truncation, the keep-engine-row set, `isExpanded` |
| `hooks/shell.ts` | 91 | pure: `SHELL_TOOLS`, `isShellTool`, `formatShell` (one clause per line at top-level `&&`, `||`, `|`, `|&`, `;`) |
| `hooks/summarize.ts` | 46 | pure: the described-tools allowlist, `cleanSummary`, `describe`, `resolveSummaries` |
| `hooks/accent.ts` | 21 | pure: color validation (`#rrggbb`, named, `...Bright`, `claude`), `resolveDoneColor` |
| `hooks/*.test.ts` | 641 | 56 tests under `claude plugin test` |
| `types/index.d.ts` | 12 | the state contract |
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
  overrides: StateFamily<{ epoch: number; open: boolean }>  // per tool_use_id
}
```

### Session start

```
session.start
  ├─ loadSaved:          store.get('collapsed')  → update(collapsed) if boolean and different
  ├─ loadSavedColor:     store.get('doneColor')  → validColor → update(doneColorOverride)
  ├─ loadSavedSummaries: store.get('summaries')  → update(summariesOn) if boolean
  ├─ command.register('collapse-tools')
  └─ if e.isInteractive && !hinted: update(hinted, true); ui.toast(HINT_TEXT, 8000ms)
```

Every store failure is caught and logged to the debug log; the in-session value stands. `configColor = resolveDoneColor(null, options.doneColor)` is computed once in `register`, outside any hook; it is the fallback when `doneColorOverride` is null.

### Turn start, the `/clear` path

`/clear` resets `$.state` but raises no `session.start`. So `turn.start` calls `loadSaved` on every turn and, when the color or summaries atom is null, reloads those too. Cost: one to three store reads per turn (**inferred**). A test covers the summaries case by mounting a row, firing `turn.start` with a mocked store, and checking the row changed.

### Draw a tool row

```
ui.render { component: 'ToolUse', requestId: tool_use_id, props: { tool, input, isRunning, isErrored, isInterrupted, output? }, viewport? }
  │
  ├─ read collapsed, epoch, overrides[id], doneColorOverride, summariesOn   (5 subscriptions)
  ├─ open = overrides[id].epoch === epoch ? overrides[id].open : !collapsed
  ├─ summary = resolveSummaries(summariesOn, options.summaries) ? describe(tool, input) : null
  ├─ button(segments) = <Button key=`collapse-tools:${id}` plain onPress={toggle}> {segments → <Text/>} </Button>
  │
  ├─ if !open:               return button(collapsedSegments(..., summary))       (engine row replaced, next() never called)
  ├─ { header, fields } = expandedRows(..., summary)
  ├─ if keepsEngineRow(tool): return <Box column> {button(header)} {await next(e)} </Box>
  └─ else:                    return <Box column> {button(header)} {fields → <Text>{segments → <Text/>}</Text>} </Box>
```

The epoch trick: `/collapse-tools` does not clear the `overrides` family. It increments `epoch`, and `openOf` treats a member written under an older epoch as absent. Upstream commit `c513b46` introduced this: the first version kept one `Record<string, boolean>` atom, so any click redrew every row and a global toggle had to rewrite the map. A family member per `tool_use_id` plus an epoch makes a click redraw one row and a global toggle O(1) in writes (the readers of `epoch` and `collapsed`, all rows, redraw anyway).

`toggle` re-reads `collapsed` and `epoch` at press time, not from the draw-time closure, then writes `{ epoch, open: !isExpanded(g, openOf(cur, ep)) }` to the member. This is the documented pattern: never write from a value captured at draw time.

Inside `expandedRows`, `fieldRows` receives the tool: for a shell tool (`isShellTool`: `Bash`, `Monitor`) whose `command` is a string with no line break, `formatShell` splits it at top-level `&&`, `||`, `|`, `|&` and `;` and the operator leads each continuation line; if it yields one line, or the command has a line break, or the lexer ends inside a quote or bracket, the plain `stringLines` path runs. This is display-only and conservative (**inferred** from `shell.test.ts` and `summary.test.ts`; not checked in a live session). The collapsed row and the header are unchanged, including the "drawn whole" skip rule.

The field lines sit outside the Button, as siblings in the column Box, because a Button's children must be strings or Text; only the header is clickable. When the engine row is replaced (`!open`, or an expanded tool outside the keep set), `next(e)` is never called, so no plugin beneath this one and none of the engine's own `ToolUse` drawing runs for that row.

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
  ├─ anything else    → { text: USAGE }
  └─ ''               → next = !collapsed; update(collapsed); update(epoch, n+1); store.set('collapsed'); { text }
```

The returned `{ text }` is drawn as the command's output row and read by the model. Every write to the color or summaries atom redraws every row, since every row reads both.

### The pure functions

- `collapsedSegments(call, columns, doneColor, summary?)`: a thin wrapper over the private `headerRow` with the `[+]` marker. `headerRow` builds the marker, the name, then budgets `width - name - GAP - wordRoom` for the argument. The argument is drawn only if at least 4 columns remain. The status word is padded to the right edge. A final `clipSegments` guarantees the total fits. It also reports which field it drew whole (the summary stands for `description`, whole only when it equals the trimmed raw `input.description`).
- `expandedRows(call, columns, doneColor, summary?)`: returns `{ header, fields }`. `header` is `headerRow` with `[-]`; without a summary the picked arg goes through `expandedArg`, which keeps the first line of a multi-line value and counts it whole only when that line equals the trimmed raw value. `fields` (from `fieldRows`) is one `Segment[]` per drawn line: `{ text: '    ' }`, `{ text: 'key:' + pad, color: 'suggestion' }`, `{ text: value, dim: true }`, and `[{ indent }, { line, dim }]` for each continuation line. Order is `ARG_FIELDS` then insertion order; the field `headerRow` drew whole is skipped; values are uncut. String values go through `stringLines`: split on CRLF, LF or a lone CR, control characters but tab dropped, each line `trimEnd`ed, leading and trailing blank lines dropped, leading indentation kept.
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

**Observed** on this branch: all three pass, 34 tests across 4 files in about half a second.

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
   entry: name collapse-tools, source git-subdir, url jlopez/claude-mod-collapse-tools.git, path .claude/skills/collapse-tools, version 0.4.0
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
- **Shell command layout.** `formatShell` and `SHELL_TOOLS` in `shell.ts`: add a tool whose `command` is a shell command to `SHELL_TOOLS`; the separators and the bracket/quote handling are in the one lexer loop, tested in `shell.test.ts`. The wiring is `shellLines` in `summary.ts`; dropping the no-line-break rule is a one-line change there.
- **Which tools get a summary.** `DESCRIBED_TOOLS` in `summarize.ts`. Note that for `Agent` the summary path changes little: `description` is already in `ARG_FIELDS` and `Agent` input has no `command`/`file_path`, so with summaries off the same text shows, uncleaned. The summary setting really only affects `Bash` (whose `command` wins otherwise) and `Monitor`.
- **Which tools keep the engine row when expanded.** `KEEP_ENGINE_ROW` in `summary.ts`.
- **ctrl+o and `--verbose`.** `ToolUse` and `ToolResult` props carry `isExpanded?: boolean` as of 2.1.309 (absent in the vendored 2.1.295 types). The documented pattern is: a hook that draws a compact row returns `next(e)` when `isExpanded` is true. One guard at the top of each render hook removes the "ctrl+o does not unfold these rows" limitation. It needs the vendored types regenerated, and a decision about whether to keep the fold inside the ctrl+o view too.
- **Tool groups.** The engine folds runs of reads and searches into a `ToolGroup` row (`Read 3 files`) that this mod does not hook. A `ToolGroup` hook can set `isExpanded` to unfold a group; the rows it unfolds into are `ToolUse` instances this mod's hook then sees. In fullscreen mode no `ToolGroup` is drawn at all.
- **Result content.** `e.props.output` is available on both `ToolUse` and `ToolResult` and unused. A collapsed row could show an exit code, a line count or a diff stat without expanding.
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
- **`register` reads `options.doneColor` once.** Correct because a `/config` change reloads the module, but a reader of the code may expect it inside a hook.
- **Author metadata** still names upstream; the top-level README's badges and install lines point at `0xnicholasy/claude-mods`, while the marketplace that actually installs it is `jlopez/claude-mods` (nursery notes list this as a pending doc fix).
- **CI triggers** cover `main` and `feat/**` only; a `docs/**` or `fix/**` branch push runs nothing, though a PR against `main` still does.

## Ideas

Improvement ideas voiced by Jesus, each a candidate future room. None are implemented here.

- (none yet)
