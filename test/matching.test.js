'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { titlesMatch, LabelHistory, pickTab } = require('../lib/matching');

// Plain objects stand in for vscode.Tab: VS Code keeps the same object while
// a tab is open and mutates its label, which is what these tests do.
const tab = (label) => ({ label });

test('titlesMatch: exact and ellipsis-truncated titles', () => {
  assert.equal(titlesMatch('Lista de tickets del CTO', 'Lista de tickets del CTO'), true);
  assert.equal(titlesMatch('Épicas en marcha y bloqu…', 'Épicas en marcha y bloqueos'), true);
  assert.equal(titlesMatch('Épicas en marcha y bloqu…', 'Épicas en marcha y bloqu…'), true);
  assert.equal(titlesMatch('CRIT-7645', 'CRIT-7646'), false);
  assert.equal(titlesMatch(undefined, 'Claude Code'), false);
});

test('pickTab: a tab still showing the title wins', () => {
  const a = tab('CRIT-7645');
  const b = tab('Claude Code');
  const r = pickTab('CRIT-7645', [a, b], new LabelHistory(90_000), 0);
  assert.equal(r.tab, a);
  assert.equal(r.reason, 'current label');
});

test('pickTab: finds the tab that swapped away from the archived session', () => {
  const history = new LabelHistory(90_000);
  const archivedIn = tab('Tareas de secretaria en …');
  const other = tab('Token usage discrepancy …');
  history.observe([archivedIn, other], 1_000);

  // Archiving makes the official extension swap the tab to a fresh session.
  archivedIn.label = 'Claude Code';
  history.observe([archivedIn, other], 2_000);

  // The archive reaches state.vscdb a few seconds later.
  const r = pickTab('Tareas de secretaria en …', [archivedIn, other], history, 5_000);
  assert.equal(r.tab, archivedIn);
  assert.equal(r.reason, 'recent label');
});

test('pickTab: an old label change does not count', () => {
  const history = new LabelHistory(90_000);
  const t = tab('Selector del despacho');
  history.observe([t], 0);
  t.label = 'Otra conversación';
  history.observe([t], 1_000);

  const r = pickTab('Selector del despacho', [t], history, 1_000 + 91_000);
  assert.equal(r.tab, undefined);
  assert.equal(r.reason, 'no match');
});

test('pickTab: two tabs with the same title close nothing', () => {
  const r = pickTab('Claude Code', [tab('Claude Code'), tab('Claude Code')], new LabelHistory(90_000), 0);
  assert.equal(r.tab, undefined);
  assert.equal(r.reason, 'ambiguous current label');
  assert.equal(r.candidates.length, 2);
});

test('pickTab: two tabs that both left the title recently close nothing', () => {
  const history = new LabelHistory(90_000);
  const a = tab('Petición en vuelo');
  const b = tab('Petición en vuelo');
  history.observe([a, b], 0);
  a.label = 'Claude Code';
  b.label = 'Otra';
  history.observe([a, b], 1_000);

  const r = pickTab('Petición en vuelo', [a, b], history, 2_000);
  assert.equal(r.tab, undefined);
  assert.equal(r.reason, 'ambiguous recent label');
});

test('LabelHistory: a tab never seen before has no history', () => {
  const history = new LabelHistory(90_000);
  assert.equal(history.recentlyHad(tab('x'), 'x', 0), false);
});

test('LabelHistory: a window of 0 turns the recent-label fallback off', () => {
  const history = new LabelHistory(0);
  const t = tab('Selector del despacho');
  history.observe([t], 0);
  t.label = 'Claude Code';
  history.observe([t], 0);
  assert.equal(history.recentlyHad(t, 'Selector del despacho', 0), false);
  assert.equal(pickTab('Selector del despacho', [t], history, 0).reason, 'no match');
});
