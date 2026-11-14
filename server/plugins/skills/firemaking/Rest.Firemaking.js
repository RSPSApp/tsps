/**
 * Forester's Campfire "Rest" (op3): the player sits down by the fire.
 *
 * rsprox captures (local recording 1001336, rev 240, ticks 365 and 456): two ticks after the
 * click the server sends "You rest by the welcoming fire." (gamemessage) and the player plays
 * forestry_sitting_tea (10083); thirteen ticks later it switches to forestry_sitting_tea_loop
 * (10084), which runs until the player's next click resets the sequence (-1). Run energy kept
 * its normal regeneration throughout. OSRS Wiki, Forester's Campfire: resting is "a strictly
 * visual effect" and is not possible where PvP is enabled.
 */
const SIT_DELAY_TICKS = 2;
const LOOP_DELAY_TICKS = 13;
const SIT_SEQ = 10083; // forestry_sitting_tea
const LOOP_SEQ = 10084; // forestry_sitting_tea_loop
const REST_MESSAGE = "You rest by the welcoming fire.";

/** player -> { ticks since the rest click, whether the sitting sequence has started } */
const resting = new Map();
let Animation, Wilderness;

function rest({ player }) {
  // Ours: live's refusal line in PvP areas isn't captured, so the click does nothing there.
  if (Wilderness?.isPvpArea?.(player.getLocation?.())) return true;
  resting.set(player, { ticks: 0, sat: false });
  return true;
}

/** Any new click or walk ends the rest; a started sit is reset as live does. */
function stopResting({ player }) {
  const state = resting.get(player);
  if (!state) return;
  resting.delete(player);
  if (state.sat) player.performAnimation(new Animation(-1));
}

/** Runs once per tick from Logs.Firemaking.js's firemaking task. */
function tick() {
  for (const [player, state] of resting) {
    if (player.isRegistered?.() === false) {
      resting.delete(player);
      continue;
    }
    state.ticks++;
    if (state.ticks === SIT_DELAY_TICKS) {
      state.sat = true;
      player.sendMessage(REST_MESSAGE);
      player.performAnimation(new Animation(SIT_SEQ));
    } else if (state.ticks === SIT_DELAY_TICKS + LOOP_DELAY_TICKS) {
      player.performAnimation(new Animation(LOOP_SEQ));
    }
  }
}

function attach(api) {
  ({ Animation, Wilderness } = api.core);
  resting.clear();
  api.onCustomEvent("player:world-input", stopResting);
}

/** Logout drops the rest (called from Logs.Firemaking.js's disconnect hook). */
function forget(player) {
  resting.delete(player);
}

module.exports = { attach, rest, forget, tick, isResting: (player) => resting.has(player) };
