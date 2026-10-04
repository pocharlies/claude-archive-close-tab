'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { LabelHistory, pickTab } = require('./lib/matching');
const { evenWidthsReason } = require('./lib/evenWidths');

const CONFIG_SECTION = 'claudeArchiveCloseTab';
const CLAUDE_KEY = 'Anthropic.claude-code';
const WATCH_DEBOUNCE_MS = 200;
const EVEN_WIDTHS_DEBOUNCE_MS = 100;
const SQLITE_BUSY_RETRIES = 3;
const SQLITE_BUSY_BACKOFF_MS = 50;
// An absolute path, not a PATH lookup, so a Homebrew/pyenv-shimmed `sqlite3`
// is never picked up by accident. Read once on activation (setting
// claudeArchiveCloseTab.sqlitePath); changing it needs a window reload.
const DEFAULT_SQLITE_BIN = '/usr/bin/sqlite3';
let sqliteBin = DEFAULT_SQLITE_BIN;

let output;

function log(msg) {
  const ts = new Date().toISOString();
  output.appendLine(`[${ts}] ${msg}`);
}

function warn(msg) {
  const ts = new Date().toISOString();
  if (typeof output.warn === 'function') {
    output.warn(msg);
  } else {
    output.appendLine(`[${ts}] WARNING: ${msg}`);
  }
}

function isEnabled() {
  return config().get('enabled', true);
}

function evenEditorWidthsEnabled() {
  return config().get('evenEditorWidths', true);
}

function safetyNetSeconds() {
  return config().get('safetyNetSeconds', 60);
}

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

// How long a tab's previous label still counts as "this tab showed that
// session": the archive can reach state.vscdb up to one safety-net interval
// after the tab already swapped to another session, so the window is never
// shorter than safetyNetSeconds + 30. 0 turns the fallback off.
function labelMemoryMs() {
  const seconds = config().get('recentLabelSeconds', 90);
  if (!(seconds > 0)) {
    return 0;
  }
  return Math.max(seconds, safetyNetSeconds() + 30) * 1000;
}

function skipPinnedTabs() {
  return config().get('skipPinnedTabs', false);
}

/** Tell the user, per claudeArchiveCloseTab.notifications ("off" | "statusBar" | "notification"). */
function notify(kind, message) {
  const mode = config().get('notifications', 'off');
  if (mode === 'off') {
    return;
  }
  if (kind === 'warning') {
    vscode.window.showWarningMessage(message, 'Show Log').then((choice) => {
      if (choice) {
        output.show(true);
      }
    });
    return;
  }
  if (mode === 'statusBar') {
    vscode.window.setStatusBarMessage(`$(archive) ${message}`, 5000);
  } else {
    vscode.window.showInformationMessage(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads a single key's JSON value out of a VS Code state.vscdb (ItemTable) via
 * the sqlite3 CLI, read-only. Retries on SQLITE_BUSY.
 * Returns the parsed JSON value, or undefined if the key/db is missing.
 */
async function readStateKey(dbPath, key) {
  const sql = `select value from ItemTable where key='${key}';`;
  let lastErr;
  for (let attempt = 1; attempt <= SQLITE_BUSY_RETRIES; attempt++) {
    try {
      const raw = await new Promise((resolve, reject) => {
        execFile(sqliteBin, ['-readonly', dbPath, sql], { encoding: 'utf8' }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          resolve(stdout);
        });
      });
      const trimmed = raw.trim();
      if (!trimmed) {
        return undefined;
      }
      return JSON.parse(trimmed);
    } catch (err) {
      lastErr = err;
      if (/SQLITE_BUSY|database is locked/i.test(err.message) && attempt < SQLITE_BUSY_RETRIES) {
        log(`readStateKey busy on ${dbPath} (attempt ${attempt}/${SQLITE_BUSY_RETRIES}), backing off ${SQLITE_BUSY_BACKOFF_MS}ms`);
        await sleep(SQLITE_BUSY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function isClaudeWebviewTab(tab) {
  return (
    tab.input instanceof vscode.TabInputWebview &&
    typeof tab.input.viewType === 'string' &&
    tab.input.viewType.includes('claudeVSCodePanel')
  );
}

function allTabs() {
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      tabs.push(tab);
    }
  }
  return tabs;
}

function activate(context) {
  output = vscode.window.createOutputChannel('Claude Archive Close Tab', { log: true });
  context.subscriptions.push(output);
  log('activating');

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeArchiveCloseTab.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)
    ),
    vscode.commands.registerCommand('claudeArchiveCloseTab.showLog', () => output.show(true))
  );

  // Independent of `enabled` and of sqlite3: keeps the editor columns the same
  // width. Archiving a session closes its tab; if that was the last tab of a
  // column VS Code closes the empty group and the neighbour takes its space.
  // There is no event for a manual drag-resize, so this only reacts to a
  // column opening or closing.
  let evenTimer;
  context.subscriptions.push({
    dispose: () => {
      if (evenTimer) {
        clearTimeout(evenTimer);
      }
    },
  });
  // Debounced so several group changes in a row (e.g. Join All Groups) make one call.
  const scheduleEvenWidths = (reason) => {
    if (evenTimer) {
      clearTimeout(evenTimer);
    }
    evenTimer = setTimeout(() => {
      evenTimer = undefined;
      const count = vscode.window.tabGroups.all.length;
      Promise.resolve(vscode.commands.executeCommand('workbench.action.evenEditorWidths')).then(
        () => log(`evened editor widths (${count} groups, reason: ${reason})`),
        (err) => log(`failed to even editor widths: ${err && err.message}`)
      );
    }, EVEN_WIDTHS_DEBOUNCE_MS);
  };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups((e) => {
      const reason = evenWidthsReason({
        enabled: evenEditorWidthsEnabled(),
        groupCount: vscode.window.tabGroups.all.length,
        event: e,
      });
      if (reason) {
        scheduleEvenWidths(reason);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(`${CONFIG_SECTION}.evenEditorWidths`) &&
        evenEditorWidthsEnabled() &&
        vscode.window.tabGroups.all.length >= 2
      ) {
        scheduleEvenWidths('setting');
      }
    })
  );
  if (evenEditorWidthsEnabled() && vscode.window.tabGroups.all.length >= 2) {
    scheduleEvenWidths('startup');
  }

  sqliteBin = config().get('sqlitePath', DEFAULT_SQLITE_BIN) || DEFAULT_SQLITE_BIN;
  if (!fs.existsSync(sqliteBin)) {
    warn(
      `sqlite3 binary not found at ${sqliteBin} — Claude Archive Close Tab is disabled (no watchers/timers set up). ` +
        `Set claudeArchiveCloseTab.sqlitePath and reload the window.`
    );
    return;
  }

  const globalStorageDir = path.dirname(context.globalStorageUri.fsPath);
  const globalDbPath = path.join(globalStorageDir, 'state.vscdb');
  const workspaceDbPath = context.storageUri
    ? path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb')
    : undefined;

  log(`globalStorageDir=${globalStorageDir}`);
  log(`globalDbPath=${globalDbPath}`);
  log(`workspaceDbPath=${workspaceDbPath || '<none: no folder open>'}`);

  const seenIds = new Set();
  // sessionId -> tab title, accumulated from panelTabSessions on every check.
  // When the official extension swaps a tab away from an archived session it
  // also drops that session from panelTabSessions, so the title has to be
  // remembered from before the archive.
  const knownTitles = new Map();
  const history = new LabelHistory(labelMemoryMs());
  let seeded = false;
  let checking = false;

  function claudeTabs() {
    return allTabs().filter(isClaudeWebviewTab);
  }

  async function seedIfNeeded() {
    if (seeded) {
      return;
    }
    try {
      const hidden = (await readStateKey(globalDbPath, CLAUDE_KEY))?.hiddenSessionIds || [];
      for (const id of hidden) {
        seenIds.add(id);
      }
      seeded = true;
      log(`seeded ${seenIds.size} already-archived session ids on activation`);
    } catch (err) {
      log(`seed failed: ${err.message}`);
    }
  }

  async function refreshKnownTitles() {
    if (!workspaceDbPath) {
      return;
    }
    let wsValue;
    try {
      wsValue = await readStateKey(workspaceDbPath, CLAUDE_KEY);
    } catch (err) {
      log(`failed to read workspace storage db: ${err.message}`);
      return;
    }
    for (const entry of wsValue?.panelTabSessions || []) {
      if (entry && entry.sessionId && entry.title) {
        knownTitles.set(entry.sessionId, entry.title);
      }
    }
  }

  async function checkForArchived() {
    if (!isEnabled()) {
      return;
    }
    if (checking) {
      return;
    }
    checking = true;
    try {
      await seedIfNeeded();
      await refreshKnownTitles();

      let value;
      try {
        value = await readStateKey(globalDbPath, CLAUDE_KEY);
      } catch (err) {
        log(`failed to read globalStorage db: ${err.message}`);
        return;
      }
      const hidden = value?.hiddenSessionIds || [];

      const newIds = hidden.filter((id) => !seenIds.has(id));
      if (newIds.length === 0) {
        return;
      }

      for (const id of newIds) {
        seenIds.add(id);
        log(`new archived session observed: ${id}`);
      }

      if (!workspaceDbPath) {
        log('no workspace storage db (no folder open) — cannot map session ids to tabs');
        return;
      }

      const titleById = new Map();
      for (const id of newIds) {
        if (knownTitles.has(id)) {
          titleById.set(id, knownTitles.get(id));
        }
      }

      if (titleById.size === 0) {
        log('none of the newly archived session ids have a known tab title in this workspace — nothing to close here');
        return;
      }

      const now = Date.now();
      const candidateTabs = claudeTabs();
      history.observe(candidateTabs, now);
      log(
        `scanning ${candidateTabs.length} claudeVSCodePanel tab(s) against ${titleById.size} newly archived title(s): ` +
          candidateTabs.map((t) => `"${t.label}"`).join(', ')
      );

      for (const [sessionId, title] of titleById) {
        const { tab, reason, candidates } = pickTab(title, candidateTabs, history, now);
        if (!tab && candidates.length === 0) {
          log(`no open tab showed archived session ${sessionId} (title="${title}"), now or in the last ${history.memoryMs / 1000}s`);
          continue;
        }
        if (!tab) {
          warn(
            `${reason} for archived session ${sessionId} (title="${title}") — ` +
              `${candidates.length} candidate tabs: ${candidates.map((t) => `"${t.label}"`).join(', ')}. ` +
              `Not closing any tab to avoid closing the wrong one.`
          );
          notify('warning', `Archived "${title}" but ${candidates.length} tabs match it, so none was closed.`);
          continue;
        }
        if (tab.isPinned && skipPinnedTabs()) {
          log(`kept pinned tab "${tab.label}" for archived session ${sessionId} (skipPinnedTabs is on)`);
          continue;
        }
        try {
          await vscode.window.tabGroups.close(tab);
          log(`closed tab for archived session ${sessionId} (title="${title}", matched by ${reason}, tab now "${tab.label}")`);
          notify('info', `Closed the tab of archived session "${title}"`);
        } catch (err) {
          log(`failed to close tab for session ${sessionId}: ${err.message}`);
        }
      }
    } finally {
      checking = false;
    }
  }

  // Trigger 1: fs.watch on the globalStorage directory (not the file — the
  // file gets replaced on macOS with journal_mode=delete, which breaks a
  // watch on the file itself).
  let debounceTimer;
  context.subscriptions.push({
    dispose: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  });
  const scheduleCheck = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      checkForArchived().catch((err) => log(`checkForArchived error: ${err.message}`));
    }, WATCH_DEBOUNCE_MS);
  };

  let watcher;
  try {
    watcher = fs.watch(globalStorageDir, { persistent: false }, () => {
      scheduleCheck();
    });
    context.subscriptions.push({
      dispose: () => {
        try {
          watcher.close();
        } catch (err) {
          // ignore
        }
      },
    });
    log(`watching directory: ${globalStorageDir}`);
  } catch (err) {
    log(`failed to watch ${globalStorageDir}: ${err.message}`);
  }

  // Trigger 2: native tab change events (free).
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      history.observe(claudeTabs(), Date.now());
      scheduleCheck();
    })
  );

  // Trigger 3: safety-net interval, since fs.watch can drop events on macOS.
  // Reconfigurable so changing claudeArchiveCloseTab.safetyNetSeconds does not
  // require a window reload.
  let intervalHandle;
  const configureSafetyNet = () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = undefined;
    }
    const seconds = safetyNetSeconds();
    if (seconds > 0) {
      intervalHandle = setInterval(() => {
        checkForArchived().catch((err) => log(`checkForArchived error: ${err.message}`));
      }, seconds * 1000);
      log(`safety-net interval set to every ${seconds}s`);
    } else {
      log('safety-net interval disabled (safetyNetSeconds=0)');
    }
  };
  configureSafetyNet();
  context.subscriptions.push({
    dispose: () => {
      if (intervalHandle) {
        clearInterval(intervalHandle);
      }
    },
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.safetyNetSeconds`)) {
        configureSafetyNet();
      }
      if (
        e.affectsConfiguration(`${CONFIG_SECTION}.safetyNetSeconds`) ||
        e.affectsConfiguration(`${CONFIG_SECTION}.recentLabelSeconds`)
      ) {
        history.memoryMs = labelMemoryMs();
        log(`recent-label window set to ${history.memoryMs / 1000}s`);
      }
    })
  );

  // Seed immediately on activation so the very first real check has a
  // populated seen-set, rather than racing the first trigger.
  history.observe(claudeTabs(), Date.now());
  seedIfNeeded()
    .then(refreshKnownTitles)
    .catch((err) => log(`initial seed error: ${err.message}`));
}

function deactivate() {}

module.exports = { activate, deactivate };
