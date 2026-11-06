"use strict";

// 2025 Halloween event (Spook-a-thon) progression. Stage numbers are server-owned:
// no client script reads hw25_main, so only hw25_loc_decoration has a client effect
// (the decoration multilocs at Fred's farm). See server/docs/halloween-2025-source.md.
const PROGRESS_ATTRIBUTE = "halloween-2025:progress";
const STAGE = Object.freeze({ NEW: 0, STARTED: 1, COLLECTING: 2, DECORATED: 3, LANTERN: 4, JUDGED: 5, COMPLETE: 6 });
const FLAGS = Object.freeze(["deathIntro", "sarahIntro", "sarahEmote", "picture", "chair", "scarecrow", "lamp",
  "diangoIntro", "briefed", "tradeableClaimed"]);
const QUIZ_QUESTIONS = 5;
const DECORATIONS = Object.freeze({
  picture: "hw25_spooky_painting", chair: "hw25_chair_obj_reward", scarecrow: "hw25_spooky_scarecrow", lamp: "hw25_spooky_wall_lamp",
});
const LANTERN = "hw25_pumpkin_lantern_reward";
const BUNDLE = "halloween-2025";

function initial() {
  const state = { version: 1, revision: 0, stage: STAGE.NEW, quiz: 0 };
  for (const flag of FLAGS) state[flag] = false;
  return state;
}

function read(player) {
  const raw = player.getAttribute(PROGRESS_ATTRIBUTE);
  if (raw === undefined || raw === null) return initial();
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
    !Number.isInteger(raw.stage) || raw.stage < STAGE.NEW || raw.stage > STAGE.COMPLETE ||
    !Number.isInteger(raw.quiz) || raw.quiz < 0 || raw.quiz >= 1 << QUIZ_QUESTIONS) {
    throw new Error("Invalid Halloween 2025 progress");
  }
  const state = { ...initial(), ...raw };
  for (const flag of FLAGS) state[flag] = state[flag] === true;
  return state;
}

function save(api, player, state) {
  state.revision++;
  player.setAttribute(PROGRESS_ATTRIBUTE, state);
  api.emitCustomEvent("halloween-2025:changed", { player });
  return true;
}

/** Applies one named transition when its precondition still holds; false otherwise. */
function update(api, player, change) {
  const state = read(player);
  if (change(state) !== true) return false;
  return save(api, player, state);
}

function itemId(api, symbol) {
  // Restored retired items resolve through the archive, live rewards through the cache.
  const archived = api.core.CacheDefinitions.getArchivedId(BUNDLE, "obj", symbol);
  return archived ?? api.core.CacheDefinitions.getObjId(symbol);
}

function inInventory(api, player, symbol) {
  const id = itemId(api, symbol);
  return id !== null && player.getInventory().getAmount(id) > 0;
}

/** Owned anywhere a player keeps items: inventory, worn or any bank tab. */
function owns(api, player, symbol) {
  const id = itemId(api, symbol);
  if (id === null) return false;
  const banks = player.getBanks().slice(0, api.core.Bank.BANK_SEARCH_TAB_INDEX);
  return [player.getInventory(), player.getEquipment(), ...banks].some(container => container && container.getAmount(id) > 0);
}

function acquiredAll(state) {
  return Object.keys(DECORATIONS).every(key => state[key]);
}

function quizComplete(state) {
  return state.quiz === (1 << QUIZ_QUESTIONS) - 1;
}

/** Native varbit values for this player's progress (layouts checked by the importer). */
function varbits(state) {
  const values = {
    hw25_main: state.stage,
    hw25_death_intro_done: state.deathIntro ? 1 : 0,
    hw25_sarah_intro_done: state.sarahIntro ? 1 : 0,
    hw25_sarah_emote_done: state.sarahEmote ? 1 : 0,
    hw25_sarah_scarecrow_given: state.scarecrow ? 1 : 0,
    hw25_death_lamp_given: state.lamp ? 1 : 0,
    hw25_loc_decoration: state.stage >= STAGE.DECORATED ? 1 : 0,
  };
  for (let question = 0; question < QUIZ_QUESTIONS; question++) {
    values[`hw25_death_q${question + 1}_done`] = (state.quiz >> question) & 1;
  }
  return values;
}

module.exports = {
  PROGRESS_ATTRIBUTE, STAGE, FLAGS, QUIZ_QUESTIONS, DECORATIONS, LANTERN, BUNDLE,
  initial, read, save, update, itemId, inInventory, owns, acquiredAll, quizComplete, varbits,
};
