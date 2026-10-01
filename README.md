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
- If an archived session's title matches more than one currently open tab,
  the extension closes **nothing** for that event and logs a warning instead
  of guessing and possibly closing the wrong tab.

### Breakage risk

This extension was verified against official `claude-code` extension version
**2.1.274**. It depends entirely on private VS Code state (database paths,
table/key names, and JSON field names) that Anthropic does not document or
guarantee. **Any update to the official extension can silently break this
one** — there is no compatibility contract to rely on.

## Install

Clone this repository directly into your VS Code extensions folder:

```bash
git clone https://github.com/pocharlies/claude-archive-close-tab.git \
  ~/.vscode/extensions/claude-archive-close-tab
```

Then reload VS Code:

```
Cmd+Shift+P -> Developer: Reload Window
```

No build step and no dependencies to install — it's plain CommonJS.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `claudeArchiveCloseTab.enabled` | boolean | `true` | Automatically close the editor tab for a Claude Code session when it is archived. |
| `claudeArchiveCloseTab.safetyNetSeconds` | number | `60` | Interval, in seconds, for a safety-net poll of the archived session list (in case `fs.watch` drops an event). Set to `0` to disable the timer. |

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

**macOS only, currently.** The state file paths themselves
(`context.globalStorageUri` / `context.storageUri`) are portable, but the
extension shells out to the fixed path `/usr/bin/sqlite3`, which only exists
on macOS. Supporting other platforms would need a configurable or
auto-detected `sqlite3` binary path.

## Status

This has been verified by direct inspection of the state databases and by
reasoning through the code paths, not by an end-to-end run inside a live VS
Code window. Use at your own risk, and check the Output channel after
installing to confirm it behaves as expected in your environment.

## License

MIT — see [LICENSE](LICENSE).
