'use strict';

/**
 * Decides whether the editor columns (groups) should be evened out after a
 * TabGroupChangeEvent. Pure on purpose: no vscode import, so it is unit-tested.
 *
 * Only a group that opened or closed changes the number of columns; `changed`
 * alone (focus moved, active tab switched) never does, so it is ignored.
 *
 * @param {{enabled: boolean, groupCount: number, event: {opened?: unknown[], closed?: unknown[]}}} input
 * @returns {'opened' | 'closed' | undefined} why to even out, or undefined for "do nothing"
 */
function evenWidthsReason({ enabled, groupCount, event }) {
  if (!enabled || !(groupCount >= 2) || !event) {
    return undefined;
  }
  if (event.opened && event.opened.length > 0) {
    return 'opened';
  }
  if (event.closed && event.closed.length > 0) {
    return 'closed';
  }
  return undefined;
}

module.exports = { evenWidthsReason };
