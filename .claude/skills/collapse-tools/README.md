# Claude Fold

Claude Fold is a Claude Code plugin that draws each tool-call row in the transcript as one line, `[+] Name  arg`, to save screen rows. Click a row to expand it into a `[-]` header, one line per input field and the normal output, or run `/collapse-tools` to toggle all calls at once. The plugin id and command are `collapse-tools`. A toast at session start (once) tells you how.

## Install

Install from the parent marketplace:

```
/plugin marketplace add 0xnicholasy/claude-mods
/plugin install collapse-tools@claude-mods
```

The same works from the shell as `claude plugin marketplace add 0xnicholasy/claude-mods` and `claude plugin install collapse-tools@claude-mods`. Add `-s project` to install for one project only (scopes: `user`, `project`, `local`; default `user`).

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
| `/collapse-tools` | Flips the default for all calls (collapsed to expanded, or back) and clears every per-call toggle. The new default is saved. |
| `/collapse-tools color <name\|#hex\|reset>` | Sets the color of the tool name of finished calls and saves it for future sessions. `reset` clears the saved color. |
| `/collapse-tools summary on\|off` | Turns row summaries on or off and saves the choice for future sessions. |
| Click a line | Toggles that one call against the current default. Not saved across sessions. |

With row summaries on (the default), a collapsed row for `Bash`, `Agent` or `Monitor` shows the call's own `description` input in place of the argument. With summaries off, rows show the raw argument.

## What the hooks do

The plugin registers five hooks in `hooks/register.tsx`. The pure logic (argument picking, status, row building, expand rule) is in `hooks/summary.ts`; the summary logic (the allowlist, `describe`, text cleaning, setting precedence) is in `hooks/summarize.ts`.

| Hook | What it does |
|---|---|
| `session.start` | Loads the saved default, done color and summaries setting from the plugin store, registers the `/collapse-tools` command and, once per session, shows the click-hint toast. |
| `turn.start` | Reloads the saved default and, when unset, the done color and the summaries setting. `/clear` resets the atoms and no `session.start` follows, so this restores the choice on the next turn. |
| `command.run` (`collapse-tools`) | With `color ...`, sets or resets the done color; with `summary on\|off`, sets the summaries setting. Otherwise flips the default, increments the epoch (which invalidates per-call toggles), saves the default to the store and returns the reply text. |
| `ui.render` (`ToolUse`) | Replaces the call row with a button line. Collapsed it is the `[+]` row, showing the call's `description` when summaries are on and the tool has one; expanded it is the `[-]` header, followed by one line per input field, or by the engine's own row for Agent, Task, AskUserQuestion, TodoWrite and ExitPlanMode. |
| `ui.render` (`ToolResult`) | Draws the engine's result when the call is expanded. Otherwise returns a `Box` with `display="none"`. |

## Data and privacy

- The plugin makes no model calls and no network calls. A row summary is the `description` the model already wrote in the call's input, read at draw time.
- The only persisted data is the default choice, the done color and the summaries setting, stored under three plugin store keys (`collapsed`, `doneColor`, `summaries`) when you run `/collapse-tools`, `/collapse-tools color` or `/collapse-tools summary`.
- Per-call toggles and the epoch live in session state and are not written to disk by the plugin.
- Tool-call inputs are used only to build the one-line row on screen. The plugin does not store them or log them.
- It reads no credentials or environment variables, and does not read or write files or run processes.

Full docs: https://github.com/0xnicholasy/claude-mod-collapse-tools#readme

## License

MIT
