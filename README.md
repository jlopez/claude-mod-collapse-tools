<div align="center">
  <img src=".claude/skills/collapse-tools/.claude-plugin/icon.png" alt="Claude Fold icon" width="120" height="120">
  <h1>Claude Fold for Claude Code</h1>
  <p>Every tool-call row in the transcript as one line.</p>

  [![CI](https://github.com/0xnicholasy/claude-mod-collapse-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/0xnicholasy/claude-mod-collapse-tools/actions/workflows/ci.yml) ![Version](https://img.shields.io/github/package-json/v/0xnicholasy/claude-mod-collapse-tools?filename=.claude%2Fskills%2Fcollapse-tools%2F.claude-plugin%2Fplugin.json&label=version) [![License](https://img.shields.io/github/license/0xnicholasy/claude-mod-collapse-tools)](LICENSE) [![Stars](https://img.shields.io/github/stars/0xnicholasy/claude-mod-collapse-tools?style=flat)](https://github.com/0xnicholasy/claude-mod-collapse-tools/stargazers)

  <a href="#installation">Install</a> · <a href="#usage">Usage</a> · <a href="#how-it-works">How it works</a>
</div>

Claude Fold is a Claude Code plugin that draws each tool-call row in the transcript as one line, `[+] Name  arg`, to save screen rows. Click a row to expand it into a `[-]` header, one line per input field and the normal output, or run `/collapse-tools` to toggle all calls at once. The plugin id and command are still `collapse-tools`. A toast at session start (once) tells you how. The tool name of a finished call is white by default, and you can change that color.

## What it looks like

Collapsed rows: done, running and error (the `[+]` is dim, the argument is dim, a problem name is bold):

```
[+] Bash  npm run check
[+] github:create_issue  Fix the login redirect                          running
[+] Edit  /src/app.ts                                                      error
```

With row summaries on (the default), a call whose input carries a `description` shows that description in place of the argument:

```
[+] Bash  Show git status head and last commit
[+] Agent  Audit the auth flow
[+] Read  /src/auth.ts
```

The same row expanded (the header keeps the collapsed text, the input fields follow one per line, and the result is drawn as usual below them):

```
[-] Bash  Run the full gate
    command: npm run check
    timeout: 120000
```

## Features

- One-line rows. Each call reads `[+] Name  arg`. The name of a done call is white (not bold) by default and you can change it; a running call is yellow, an error red and an interrupted call gray, all three bold. A status word (`running`, `error`, `interrupted`) is right-aligned at the end of the row, in the same color; a done call shows none.
- Row summaries. A collapsed row shows the description the model wrote for the call (Bash, Agent and Monitor inputs carry one) in place of the raw argument. The plugin makes no model or network calls: the text is read from the call's own input. On by default; `/collapse-tools summary on|off` or the `summaries` option. The expanded row keeps the summary as its header and lists the raw input below it.
- Readable names. An MCP tool `mcp__server__tool` shows as `server:tool`.
- Click hint. `[+]` marks a row you can click. Once per session, on start, a toast says "click a [+] row to expand, /collapse-tools to toggle all".
- Click to expand. Clicking a row grows it downward: the header keeps its text with a `[-]` marker, and every input field follows on its own line, uncut. Clicking the header collapses it again.
- `/collapse-tools` command. Switches the default for all calls and clears per-call toggles. The choice is saved across sessions.
- Pickable completed-call color (the color of a call that completed successfully; running is yellow, error red, interrupted gray). `/collapse-tools color <name|#hex|reset>` or the `doneColor` option.
- Collapsed results. The result block of a collapsed call is not drawn.
- Tool groups such as `Read 3 files` are left to the engine.

## Installation

Install from the parent marketplace:

```
/plugin marketplace add 0xnicholasy/claude-mods
/plugin install collapse-tools@claude-mods
```

The same works from the shell as `claude plugin marketplace add 0xnicholasy/claude-mods` and `claude plugin install collapse-tools@claude-mods`. Add `-s project` to install for one project only (scopes: `user`, `project`, `local`; default `user`).

To run from a checkout instead:

```
git clone https://github.com/0xnicholasy/claude-mod-collapse-tools.git
cd claude-mod-collapse-tools
claude --plugin-dir .claude/skills/collapse-tools
```

Run it from the repo root, or pass the absolute path to `.claude/skills/collapse-tools`. An installed plugin takes precedence over a local copy with the same name, so uninstall it while developing. If `/collapse-tools` is not offered, run `claude plugin list` to check that the plugin is loaded and enabled.

Update (restart required):

```
claude plugin marketplace update claude-mods
claude plugin update collapse-tools@claude-mods
```

Uninstall with `claude plugin uninstall collapse-tools@claude-mods`.

## Usage

Tool calls are collapsed by default. These controls change that:

| Control | Effect |
|---|---|
| `/collapse-tools color <name\|#hex\|reset>` | Sets the color of the tool name of finished calls and saves it for future sessions. `reset` clears the saved color. An unknown color is rejected with a message; any other argument prints a usage line. |
| `/collapse-tools summary on\|off` | Turns row summaries on or off and saves the choice for future sessions. Any other argument prints a usage line. |
| `/collapse-tools` | Flips the default for all calls (collapsed to expanded, or back) and clears every per-call toggle. Replies "Tool calls collapsed to one line." or "Tool calls expanded." The new default is saved. |
| Click a line | Toggles that one call against the current default. Not saved across sessions. |

Completed-call color (marks a call that completed successfully; running is yellow, error red, interrupted gray): `<name>` is black, red, green, yellow, blue, magenta, cyan, white, gray (or grey), `claude`, or a `...Bright` variant of the basic names; `#rrggbb` also works. The color in effect is the one saved by `/collapse-tools color`, else the `doneColor` plugin option (Completed call color; default `white`), else `white`. An invalid option value falls back to the default.

Row summaries: the setting in effect is the one saved by `/collapse-tools summary on|off`, else the `summaries` plugin option (Row summaries; default on), else on. When on, a collapsed row for `Bash`, `Agent` or `Monitor` shows `[+] Name  <description>` in place of the argument, where `<description>` is the call's own `description` input, cleaned of quotes, control characters and trailing punctuation and cut to the width left on the row (the status word stays right-aligned). These are the built-in tools whose `description` field is documented as a short statement of what the call is for; MCP tools and other tools are excluded because their `description` means something else. A call with no description, or an empty one, shows the raw argument. An expanded row keeps the summary as its header and lists the raw `command` (and the other fields) below it. With summaries off, rows show the raw argument.

A per-call toggle beats the default until the next `/collapse-tools`. The status is `interrupted` if the call was aborted, otherwise `error` if it failed, otherwise `running` while it runs, otherwise `done`.

The collapsed argument is the first non-empty string among the call's `command`, `file_path`, `path`, `pattern`, `description`, `title` and `op` fields. If none is present, the first string field of the input is used. Whitespace is collapsed and the argument is cut with `...` so the row fits the terminal width less 4 columns (100 columns when the width is unknown).

The expanded header is the collapsed row with `[-]` in place of `[+]`: same text, same width, same right-aligned status word. One exception: when the picked argument spans several lines, the header shows only its first line.

Below the header, each input field gets its own line, indented 4 columns: the `key:` label in the theme's `suggestion` color, padded so the values line up (to the widest label, at most 16 columns; a longer label is followed by one space), then the value dim. The fields `command`, `file_path`, `path`, `pattern`, `description`, `title` and `op` come first, in that order, then the rest in the input's own order. The field the header shows is left out, but only when the header shows it whole (single line, not cut, no whitespace collapsed); with summaries on, a `Bash` row's header is its description, so the list starts with `command`. Empty strings are skipped; numbers and booleans are shown as text, objects and arrays as compact JSON, `null` as `null`. A multi-line value keeps its line breaks, each further line indented to the value column. Nothing in the list is cut: a long line wraps at the terminal edge.

Tools that keep the engine's row: for `Agent`, `Task`, `AskUserQuestion`, `TodoWrite` and `ExitPlanMode` the expanded view is the header followed by the engine's own row, because that row may carry more than `Name(arg)`. These show no field list. Every other tool, including `Edit` and `Write` (their diff is part of the tool's output, which the result block draws), shows the header and the field list.

## How it works

The plugin registers five hooks in `.claude/skills/collapse-tools/hooks/register.tsx`. The pure logic (argument picking, status, row building, expand rule) is in `hooks/summary.ts`; the summary logic (the allowlist, `describe`, text cleaning, setting precedence) is in `hooks/summarize.ts`.

| Hook | What it does |
|---|---|
| `session.start` | Loads the saved default, done color and summaries setting from the plugin store, registers the `/collapse-tools` command and, once per session, shows the click-hint toast. |
| `turn.start` | Reloads the saved default and, when unset, the done color and the summaries setting. `/clear` resets the atoms and no `session.start` follows, so this restores the choice on the next turn. |
| `command.run` (`collapse-tools`) | With `color ...`, sets or resets the done color; with `summary on\|off`, sets the summaries setting. Otherwise flips the default, increments the epoch (which invalidates per-call toggles), saves the default to the store and returns the reply text. |
| `ui.render` (`ToolUse`) | Replaces the call row with a button line. Collapsed it is the `[+]` row, showing the call's `description` when summaries are on and the tool has one; expanded it is the `[-]` header, followed by one line per input field (or by the engine's own row for the tools listed above). |
| `ui.render` (`ToolResult`) | Draws the engine's result when the call is expanded. Otherwise returns a `Box` with `display="none"`. |

State atoms (declared in `types/index.d.ts` under `collapse-tools`):

| Atom | Type | Purpose |
|---|---|---|
| `collapsed` | boolean | The default for all calls. Starts `true`. |
| `epoch` | number | Counter bumped by `/collapse-tools`. A toggle written under an older epoch counts as no toggle. |
| `hinted` | boolean | True once the startup toast was shown. Starts `false`. |
| `doneColorOverride` | string or null | The color saved by `/collapse-tools color`; null defers to the `doneColor` option. |
| `summariesOn` | boolean or null | The setting saved by `/collapse-tools summary`; null defers to the `summaries` option. |
| `overrides` | family of `{ epoch, open }` | Per-call toggle, keyed by `tool_use_id`. A click redraws only that call. |

`collapsed`, the done color and the summaries setting are persisted, under the plugin store keys `collapsed`, `doneColor` and `summaries`. If a store read or write fails, the error goes to the debug log and the in-session value is kept. Render hooks never write state; writes happen in the click handler and in `command.run`.

## Data and privacy

- The plugin makes no model calls and no network calls. A row summary is the `description` the model already wrote in the call's input, read at draw time.
- The only persisted data is the default choice, the done color and the summaries setting, stored under three plugin store keys (`collapsed`, `doneColor`, `summaries`) when you run `/collapse-tools`, `/collapse-tools color` or `/collapse-tools summary`.
- Per-call toggles and the epoch live in session state and are not written to disk by the plugin.
- Tool-call inputs are used only to build the one-line row on screen. The plugin does not store them or log them.
- It reads no credentials or environment variables, and does not read or write files or run processes.

## Requirements

- Claude Code 2.1.295 or later, the version the API types were taken from, with plugin hooks.
- A surface that draws the transcript with the engine's `ToolUse` and `ToolResult` components and delivers clicks. Only the terminal surface is assumed; other surfaces are untested.

## Development

```
npm install
npm run check
```

`npm run check` runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the `claude` CLI and run locally only; CI runs typecheck.

- Mod path: `.claude/skills/collapse-tools/` (manifest `.claude-plugin/plugin.json`, hooks in `hooks/`, state contract in `types/index.d.ts`). Bump the version in `plugin.json` for releases.
- Hot reload: saving a file in the mod reloads the module in a running session. The default and per-call toggles survive because state lives in `$.state` atoms and not in module variables.
- Under the RTK shell hook, run the check as `rtk proxy npm run check`.

## Known limitations

- Clicking a row needs a fullscreen terminal or the desktop app; elsewhere use `/collapse-tools`.
- ctrl+o does not unfold these rows.
- Some spacing may remain between consecutive collapsed rows (a transcript margin a plugin cannot change).
- `Agent`, `Task`, `AskUserQuestion`, `TodoWrite` and `ExitPlanMode` keep the engine's row under the header when expanded.
- Not verified in a live session: how the rows look, whether a click lands on the row on every surface, and whether the theme keys used for status colors (`success`, `error`, `warning`, `inactive`) read as green, red, yellow and gray in every theme.
- A collapsed result is a Box with `display="none"`, the only draw-nothing option the API documents (a hook must return an element; it cannot return null). A margin the engine puts around each transcript message cannot be changed from a plugin, so some spacing between consecutive collapsed rows may remain.
- Which tools keep the engine's row is a judgment from the API types, not from a live check. A tool not listed whose engine row carries extra detail loses that detail when expanded.
- A very large input (a long file written with `Write`, a big JSON field) is drawn in full when expanded, so it can take many screen rows.
- Only tools whose input carries a `description` get a summary: `Bash`, `Agent` and `Monitor`. Every other row shows the raw argument.
- A summary is the model's own words about the call, not a check of it, so it can differ from what the call does. Open the row (`[-]`) to see the real input.
- With summaries on, the expanded header still shows the summary; the raw input is in the field list below it.
- Colors and the toast need a surface that draws them; only the terminal surface is assumed.

## License

MIT. See [LICENSE](LICENSE).
