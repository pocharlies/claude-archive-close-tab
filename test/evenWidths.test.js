'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evenWidthsReason } = require('../lib/evenWidths');

// Plain objects stand in for vscode.TabGroup.
const group = {};

test('evenWidthsReason: setting off -> no', () => {
  assert.equal(evenWidthsReason({ enabled: false, groupCount: 3, event: { opened: [group], closed: [], changed: [] } }), undefined);
});

test('evenWidthsReason: fewer than 2 groups -> no', () => {
  assert.equal(evenWidthsReason({ enabled: true, groupCount: 1, event: { opened: [], closed: [group], changed: [] } }), undefined);
  assert.equal(evenWidthsReason({ enabled: true, groupCount: 0, event: { opened: [], closed: [group], changed: [] } }), undefined);
});

test('evenWidthsReason: a group opened -> yes', () => {
  assert.equal(evenWidthsReason({ enabled: true, groupCount: 2, event: { opened: [group], closed: [], changed: [] } }), 'opened');
});

test('evenWidthsReason: a group closed -> yes', () => {
  assert.equal(evenWidthsReason({ enabled: true, groupCount: 2, event: { opened: [], closed: [group], changed: [] } }), 'closed');
});

test('evenWidthsReason: changed only (focus, active tab) -> no', () => {
  assert.equal(evenWidthsReason({ enabled: true, groupCount: 3, event: { opened: [], closed: [], changed: [group] } }), undefined);
});
