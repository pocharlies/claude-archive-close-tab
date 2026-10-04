'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// Activation with a simulated `vscode` module, sqlite3 missing on purpose: the
// editor-width feature must still work (it is registered before that check).
function setup(settings = {}) {
  const calls = [];
  let groupListener;
  const groups = [{ tabs: [] }, { tabs: [] }];
  const disposable = { dispose() {} };
  const vscode = {
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      tabGroups: {
        get all() {
          return groups;
        },
        onDidChangeTabs: () => disposable,
        onDidChangeTabGroups: (fn) => {
          groupListener = fn;
          return disposable;
        },
      },
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, dflt) => (key === 'sqlitePath' ? '/nonexistent/sqlite3' : key in settings ? settings[key] : dflt),
      }),
      onDidChangeConfiguration: () => disposable,
    },
    commands: {
      registerCommand: () => disposable,
      executeCommand: (...args) => {
        calls.push(args);
        return Promise.resolve();
      },
    },
    TabInputWebview: class {},
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? vscode : origLoad.call(this, request, ...rest);
  };
  const file = path.join(__dirname, '..', 'extension.js');
  delete require.cache[file];
  const ext = require(file);
  Module._load = origLoad;
  const subscriptions = [];
  ext.activate({ subscriptions, extension: { id: 'x' }, globalStorageUri: { fsPath: '/tmp/x/y' }, storageUri: undefined });
  return { calls, groups, fire: (e) => groupListener(e), dispose: () => subscriptions.forEach((s) => s.dispose()) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('activation: even widths work without sqlite3, one call per burst, none for changed-only', async () => {
  const t = setup();
  assert.equal(typeof t.fire, 'function');
  await wait(200); // startup pass: 2 groups
  assert.equal(t.calls.length, 1);
  t.calls.length = 0;

  t.fire({ opened: [], closed: [], changed: [t.groups[0]] });
  await wait(200);
  assert.equal(t.calls.length, 0);

  t.fire({ opened: [], closed: [t.groups[1]], changed: [] });
  t.fire({ opened: [], closed: [t.groups[1]], changed: [] });
  await wait(200);
  assert.deepEqual(t.calls, [['workbench.action.evenEditorWidths']]);
  t.dispose();
});

test('activation: setting off -> never evens out', async () => {
  const t = setup({ evenEditorWidths: false });
  t.fire({ opened: [{}], closed: [], changed: [] });
  await wait(200);
  assert.equal(t.calls.length, 0);
  t.dispose();
});
