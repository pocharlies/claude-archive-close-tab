# Claude Archive Close Tab

A small VS Code companion extension for the official Anthropic `claude-code`
extension.

## Problem

The official `claude-code` extension lets you archive a Claude Code session,
but it leaves that session's editor tab open. This extension detects the
archive and closes the corresponding tab automatically.

## How it works

The official extension exposes no public API — `activate()` returns nothing,
and there is no "archive" command to hook into. This extension instead reads
the private, **undocumented** state that VS Code itself persists:

- Archiving a session writes to VS Code's `globalState`, stored in
  `~/Library/Application Support/Code/User/globalStorage/state.vscdb`
  (a SQLite database, `journal_mode=delete`), table `ItemTable`, key
  `Anthropic.claude-code`, JSON field `hiddenSessionIds`.
- The mapping from open tabs to session ids lives in `workspaceState`, in
  `.../workspaceStorage/<hash>/state.vscdb` (same key), JSON field
  `panelTabSessions` — an array of `{sessionId, title}`, where `title` is the
  tab label truncated with `…`.
- Session tabs are identified as webviews whose `viewType` contains
  `claudeVSCodePanel`.
- The extension reads these databases with the system `/usr/bin/sqlite3`
  binary in `-readonly` mode — no native SQLite module, so there is no
  Electron ABI mismatch to worry about.
- Detection is event-driven, not polling: an `fs.watch` on the globalStorage
  *directory* (debounced 200 ms), combined with VS Code's `onDidChangeTabs`
  event. A 60-second safety-net interval also runs, only because `fs.watch`
  is known to drop events on macOS — 30 seconds of sampling with VS Code
  active produced zero writes to `state.vscdb`, confirming this path is
  genuinely idle most of the time.
- On activation, it seeds the set of already-archived session ids, so it
  never mass-closes tabs for sessions that were archived before the
  extension started.
- Archiving the session a tab is showing makes the official extension swap
  that same tab to another session (or a fresh one labelled "Claude Code")
  immediately — usually before the archive reaches `state.vscdb`. So the
  extension remembers, for each Claude tab, the label it had until a moment
  ago (`max(90, safetyNetSeconds + 30)` seconds) and the `panelTabSessions`
  titles it has seen, since the swapped session also drops out of that list.
  A tab still showing the archived title wins; otherwise the tab that showed
  it until a moment ago is closed.
- If an archived session's title matches more than one currently open tab,
  the extension closes **nothing** for that event and logs a warning instead
  of guessing and possibly closing the wrong tab.

### Even column widths

Closing a session's tab can empty a column; VS Code then closes that editor
group and the neighbour takes all its space. With
`claudeArchiveCloseTab.evenEditorWidths` on (the default), whenever a group
opens or closes (`tabGroups.onDidChangeTabGroups`, ignoring changes that
only move focus) and at least two remain, the extension runs
*View: Reset Editor Group Sizes* (`workbench.action.evenEditorWidths`),
debounced 100 ms so a burst of changes makes one call. It also runs once on
activation and when you turn the setting on. It does not depend on `enabled`
or on `sqlite3`.

Limitation: VS Code has no event for a manual drag-resize, so columns you
resize by hand stay as they are until the next column opens or closes.

### Breakage risk

This extension was verified against official `claude-code` extension version
**2.1.286**. It depends entirely on private VS Code state (database paths,
table/key names, and JSON field names) that Anthropic does not document or
guarantee. **Any update to the official extension can silently break this
one** — there is no compatibility contract to rely on.

## Install

Every new version is published as a GitHub release with its `.vsix`. Install
it on the machine whose VS Code window you use (for Remote SSH, the client
Mac — see below):

```bash
gh release download --repo pocharlies/claude-archive-close-tab --pattern '*.vsix'
code --install-extension claude-archive-close-tab-*.vsix --force
```

Then reload VS Code:

```
Cmd+Shift+P -> Developer: Reload Window
```

No build step and no runtime dependencies — it's plain CommonJS.

## Development

`npm test` runs the tab-matching, even-widths and activation tests (`node:test`, no dependencies);
`npm run package` builds the `.vsix`. CI runs both on every pull request. A
merge to `main` that bumps `version` in `package.json` releases it: the VSIX
build and the changelog run in parallel, and the changelog is written from
each merged pull request's title and description plus the commits since the
previous tag (`scripts/changelog.sh`), so **the pull request description is
the changelog** — write it for the reader of the release notes.

## Settings

Open them with **Claude Archive Close Tab: Open Settings** from the Command
Palette, or search `@ext:local.claude-archive-close-tab` in Settings. The
descriptions are translated to Spanish when VS Code runs in Spanish.

| Setting | Type | Default | Description |
|---|---|---|---|
| `claudeArchiveCloseTab.enabled` | boolean | `true` | Close the editor tab of a Claude Code session when it is archived. |
| `claudeArchiveCloseTab.evenEditorWidths` | boolean | `true` | Keep all editor columns the same width: when a column opens or closes, the remaining ones are resized evenly. Independent of `enabled`. |
| `claudeArchiveCloseTab.notifications` | `off` \| `statusBar` \| `notification` | `off` | Tell you when a tab is closed. With anything but `off`, an ambiguous archive (several tabs match, none closed) shows a warning with a **Show Log** button. |
| `claudeArchiveCloseTab.skipPinnedTabs` | boolean | `false` | Keep pinned tabs open even when their session is archived. |
| `claudeArchiveCloseTab.recentLabelSeconds` | number | `90` | How long a tab that swapped away from the archived session still counts as its tab. Never shorter than `safetyNetSeconds + 30`; `0` turns the fallback off. |
| `claudeArchiveCloseTab.safetyNetSeconds` | number | `60` | Interval, in seconds, for a safety-net poll of the archived session list (in case `fs.watch` drops an event). `0` disables the timer. |
| `claudeArchiveCloseTab.sqlitePath` | string | `/usr/bin/sqlite3` | Absolute path of the `sqlite3` binary (machine setting). Reload the window after changing it. |

## Commands

- **Claude Archive Close Tab: Open Settings** — the settings above.
- **Claude Archive Close Tab: Show Log** — the Output channel with every decision.

## Confirming it's active

Open the Output panel (`View -> Output`) and select **"Claude Archive Close
Tab"** from the channel dropdown. Activation and every detected
archive/close event are logged there.

## Remote SSH windows

Works over Remote SSH, but only when the extension runs in the **client**
extension host, which is what `"extensionKind": ["ui"]` declares — deliberately
with no `"workspace"` fallback: on the server the databases it reads are empty,
so a server-side run would activate, fail with `no such table` and log forever
without ever closing a tab. With `ui` only, VS Code instead tells you the
extension is missing locally and offers to install it.

The reason is where the state lives, not where the session runs: for a remote
window the `claude-code` extension writes its `globalState` into the
**machine you connected from** — `~/Library/Application Support/Code/User/globalStorage/state.vscdb`
on the local Mac — together with the tab map in
`.../workspaceStorage/<hash>/state.vscdb`. The remote host's own
`~/.vscode-server/data/User/globalStorage/state.vscdb` stays empty (no
`ItemTable` at all), so a copy of this extension installed on the server can
never see an archive. Closing a tab is a client-side operation anyway
(`vscode.window.tabGroups.close`).

Install it on the **client** Mac (`code --install-extension` from a local
window, not from inside the remote one). Installing it on the server does
nothing.

## Platform support

Built and used on macOS. The state file paths themselves
(`context.globalStorageUri` / `context.storageUri`) are portable; on Linux or
Windows point `claudeArchiveCloseTab.sqlitePath` at a `sqlite3` binary
(untested there).

## Status

This has been verified by direct inspection of the state databases and by
reasoning through the code paths, not by an end-to-end run inside a live VS
Code window. Use at your own risk, and check the Output channel after
installing to confirm it behaves as expected in your environment.

## License

MIT — see [LICENSE](LICENSE).
