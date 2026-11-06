"use strict";

// 2026 Easter event progress, owned by this plugin and saved as one packed integer.
// The native easter26_* varbits only drive what the client shows (the note table and
// which hunt scenery holds Archibald); the step numbering itself is server-side state
// that no client script reads, so it is not a captured Jagex value.
const PROGRESS_ATTRIBUTE = "easter-events:2026-progress";
const NOTE_MASK = 0xf;        // notes found so far, 0..8
const READ_BIT = 1 << 4;      // the latest note has been read
const BOX_SHIFT = 5;          // 0 none, 1 locked egg box held, 2 decoy egg held
const BOX_MASK = 0x3 << BOX_SHIFT;
const CAUGHT_BIT = 1 << 7;
const STARTED_BIT = 1 << 8;
const COMPLETE_BIT = 1 << 9;
const LAST_NOTE = 8;
const BOX = Object.freeze({ NONE: 0, LOCKED: 1, DECOY: 2 });
// Each hunt location n is searched once note n has been read. Two of them hand out an
// egg box first instead of the next note; the church wall and the final catch are their own
// steps. Index 0 is unused.
const HUNT_SCENERY = Object.freeze([null,
  "fai_varrock_chemisty_shelves1_easter26",
  "fai_varrock_stepladders_easter26",
  "fai_varrock_castle_battlement_easter26",
  "fai_varrock_sword_table_easter26",
  "fai_varrock_posh_chair2_easter26",
  "fai_varrock_single_bed_easter26",
  "fai_varrock_suitofarmour_easter26",
]);

function unpack(value) {
  const packed = Number.isInteger(value) && value >= 0 ? value : 0;
  return {
    note: Math.min(packed & NOTE_MASK, LAST_NOTE),
    read: (packed & READ_BIT) !== 0,
    box: (packed & BOX_MASK) >> BOX_SHIFT,
    caught: (packed & CAUGHT_BIT) !== 0,
    started: (packed & STARTED_BIT) !== 0,
    complete: (packed & COMPLETE_BIT) !== 0,
  };
}

function pack(state) {
  return (state.note & NOTE_MASK) | (state.read ? READ_BIT : 0) | ((state.box & 0x3) << BOX_SHIFT) |
    (state.caught ? CAUGHT_BIT : 0) | (state.started ? STARTED_BIT : 0) | (state.complete ? COMPLETE_BIT : 0);
}

function read(player) {
  return unpack(player.getAttribute(PROGRESS_ATTRIBUTE));
}

function write(api, player, state) {
  player.setAttribute(PROGRESS_ATTRIBUTE, pack(state));
  api.emitCustomEvent("easter-events:changed", { player });
}

/** The hunt location (1..8) that holds Archibald for this player, or 0. */
function target(state) {
  if (!state.started || state.complete || state.caught || !state.read || state.box !== BOX.NONE) return 0;
  return state.note >= 1 && state.note <= LAST_NOTE ? state.note : 0;
}

function sync(api, player, active) {
  const cache = api.core.CacheDefinitions, sender = player.getPacketSender(), state = read(player);
  const at = active ? target(state) : 0;
  sender.sendVarbit(cache.getVarbitId("easter26_first_clue_picked"), active && state.note >= 1 ? 1 : 0);
  for (let location = 1; location <= LAST_NOTE; location++) {
    sender.sendVarbit(cache.getVarbitId("easter26_hunt_loc" + location), at === location ? 1 : 0);
  }
}

module.exports = {
  PROGRESS_ATTRIBUTE, BOX, LAST_NOTE, HUNT_SCENERY,
  read, write, target, sync, pack, unpack,
};
