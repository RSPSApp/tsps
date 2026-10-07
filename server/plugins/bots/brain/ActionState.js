"use strict";

// A compiled activity action is shared by every bot running that activity, so
// per-bot data (current target, click cooldown, last production sample) must be
// keyed by player or bots overwrite each other's state.
const STATE_BY_ACTION = new WeakMap();

function playerState(action, player, create) {
  let byPlayer = STATE_BY_ACTION.get(action);
  if (!byPlayer) {
    byPlayer = new WeakMap();
    STATE_BY_ACTION.set(action, byPlayer);
  }
  let state = byPlayer.get(player);
  if (!state) {
    state = create();
    byPlayer.set(player, state);
  }
  return state;
}

module.exports = {
  playerState,
};
