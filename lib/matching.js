'use strict';

/**
 * Pure tab-matching logic, kept free of the vscode module so it can be unit
 * tested with plain objects standing in for vscode.Tab.
 */

/**
 * Tolerant title matcher: exact match first, then prefix match if the stored
 * title was truncated with a trailing ellipsis (U+2026).
 */
function titlesMatch(storedTitle, tabLabel) {
  if (typeof storedTitle !== 'string' || typeof tabLabel !== 'string') {
    return false;
  }
  if (storedTitle === tabLabel) {
    return true;
  }
  if (storedTitle.endsWith('…')) {
    const prefix = storedTitle.slice(0, -1);
    if (tabLabel.slice(0, prefix.length) === prefix) {
      return true;
    }
  }
  return false;
}

/**
 * Remembers, per tab, the labels it had until recently.
 *
 * Archiving the session a tab is showing makes the official extension swap
 * that same tab to another session (or a fresh "Claude Code" one) right away,
 * usually before the archive reaches state.vscdb. By the time we see the
 * archived id, the tab no longer carries the archived title, so we also look
 * at what each tab was labelled a moment ago.
 *
 * Keyed by the vscode.Tab object: VS Code keeps the same object while a tab
 * is open and only updates its fields, so a WeakMap follows the tab across
 * label changes and forgets it once it is closed.
 */
class LabelHistory {
  constructor(memoryMs) {
    this.memoryMs = memoryMs;
    this.current = new WeakMap();
    this.previous = new WeakMap();
  }

  /** Record the current label of each tab, keeping the label it replaced. */
  observe(tabs, now) {
    for (const tab of tabs) {
      const last = this.current.get(tab);
      if (last !== undefined && last !== tab.label) {
        const kept = (this.previous.get(tab) || []).filter((e) => now - e.until <= this.memoryMs);
        kept.push({ label: last, until: now });
        this.previous.set(tab, kept);
      }
      this.current.set(tab, tab.label);
    }
  }

  /** True if the tab stopped showing a label matching `title` within memoryMs. */
  recentlyHad(tab, title, now) {
    const entries = this.previous.get(tab) || [];
    return entries.some((e) => now - e.until <= this.memoryMs && titlesMatch(title, e.label));
  }
}

/**
 * Decide which tab to close for an archived session title.
 *
 * A tab still showing the title wins. Only when none does, fall back to the
 * tab that showed it until recently. More than one candidate at either step
 * is ambiguous: return them all and let the caller close nothing.
 *
 * @returns {{tab: object|undefined, reason: string, candidates: object[]}}
 */
function pickTab(title, tabs, history, now) {
  const current = tabs.filter((t) => titlesMatch(title, t.label));
  if (current.length === 1) {
    return { tab: current[0], reason: 'current label', candidates: current };
  }
  if (current.length > 1) {
    return { tab: undefined, reason: 'ambiguous current label', candidates: current };
  }
  const recent = history ? tabs.filter((t) => history.recentlyHad(t, title, now)) : [];
  if (recent.length === 1) {
    return { tab: recent[0], reason: 'recent label', candidates: recent };
  }
  if (recent.length > 1) {
    return { tab: undefined, reason: 'ambiguous recent label', candidates: recent };
  }
  return { tab: undefined, reason: 'no match', candidates: [] };
}

module.exports = { titlesMatch, LabelHistory, pickTab };
