"use strict";

/**
 * Giants' Foundry: shared ids, the player's foundry state and the small helpers every unit uses.
 *
 * The cache owns the whole client side: the HUD (754), mould setup (718) and reward shop (753)
 * draw themselves from the varbits below, so the server's job is to keep those varbits right.
 * Every one of them lives in the player's persisted state and is re-sent at login, as live
 * OSRS does (rsprox captures: all foundry varbits and varp 3436 arrive with the login burst).
 *
 * Wiki: https://oldschool.runescape.wiki/w/Giants%27_Foundry
 * docs/giants-foundry.md records the live captures these ids and timings come from.
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

/** Everything the minigame remembers about a player, keyed by varbit id plus a few extras. */
const STATE_ATTRIBUTE = "giants-foundry:state";
/** Foundry Reputation (varp 3436), the reward shop's currency. */
const REPUTATION_ATTRIBUTE = "giants-foundry:reputation";

const QUEST_KEY = "sleeping_giants";

/** Map square (52, 179), the foundry cave under the Giants' Plateau. */
const ROOM = { minX: 3328, maxX: 3391, minY: 11456, maxY: 11519, z: 0 };

const VARP = {
  /** giants_foundry_reward_shop_selected_item */
  SHOP_SELECTED: 3435,
  /** giants_foundry_reward_shop_points */
  REPUTATION: 3436,
};

const VARBIT = {
  /** sleeping_giants: the quest stage; 30 is complete (cache NPC 11560 shows the full Kovac). */
  QUEST: 13902,
  /** sleeping_giants_tutorial: the quest's sword-making steps, 0-65 in fives. */
  TUTORIAL: 13903,
  COMMISSION_WORD_1: 13907,
  COMMISSION_WORD_2: 13908,
  /** 0 forte, 1 blade, 2 tip. */
  MOULD_TAB: 13909,
  /** giants_foundry_mould_selected_ricasso: the forte. */
  MOULD_FORTE: 13910,
  MOULD_BLADE: 13911,
  MOULD_TIP: 13912,
  /** giants_foundry_mould_alloy_dificulty: the poured metal's score. */
  ALLOY_DIFFICULTY: 13913,
  /** The jig (multiloc 44777): 0 empty, 1 set up, 2 poured, 3 cooled. */
  MOULD_STATE: 13914,
  SHOP_FILTER: 13915,
  /** unlocked_mould_ricasso_7..11, blade_7..11, tip_7..11: one varbit per bought mould. */
  UNLOCK_FORTE_FIRST: 13916,
  UNLOCK_BLADE_FIRST: 13921,
  UNLOCK_TIP_FIRST: 13926,
  /** bronze, iron, steel, mithril, adamant, rune counts: 13931-13936, 5 bits each. */
  METAL_COUNT_FIRST: 13931,
  /** The crucible (multiloc 44776): 0 empty, 1 partly full, 2 full. */
  CRUCIBLE_STATE: 13937,
  PREFORM_DIFFICULTY: 13938,
  PREFORM_QUALITY: 13939,
  /** seed_1..6: the tool each stage after the first needs (0 hammer, 1 grind, 2 polish). */
  SEED_FIRST: 13940,
  /** Preform storage (multiloc 44778): 0 empty, 1 holding the preform. */
  PREFORM_STORED: 13947,
  /** 0-1000. */
  TEMPERATURE: 13948,
  /** 0-1000. */
  COMPLETION: 13949,
  PREFORM_START_QUALITY: 13950,
  /** collection_minigames_giantsfoundry_completed */
  CLOG_COMPLETED: 13957,
};

/** Every minigame varbit the login burst re-sends (the quest's own varbits are its business). */
const SYNCED_VARBITS = [
  VARBIT.COMMISSION_WORD_1, VARBIT.COMMISSION_WORD_2, VARBIT.MOULD_TAB,
  VARBIT.MOULD_FORTE, VARBIT.MOULD_BLADE, VARBIT.MOULD_TIP, VARBIT.ALLOY_DIFFICULTY,
  VARBIT.MOULD_STATE, VARBIT.SHOP_FILTER,
  ...range(VARBIT.UNLOCK_FORTE_FIRST, 15),
  ...range(VARBIT.METAL_COUNT_FIRST, 6),
  VARBIT.CRUCIBLE_STATE, VARBIT.PREFORM_DIFFICULTY, VARBIT.PREFORM_QUALITY,
  ...range(VARBIT.SEED_FIRST, 6),
  VARBIT.PREFORM_STORED, VARBIT.TEMPERATURE, VARBIT.COMPLETION, VARBIT.PREFORM_START_QUALITY,
  VARBIT.CLOG_COMPLETED,
];

const INTERFACE = {
  MOULD: 718,
  REWARD_SHOP: 753,
  HUD: 754,
  COMBAT_TAB: 593,
};

/** toplevel overlay_hud, where Wintertodt, the Gauntlet and ToA mount their HUDs too. */
const OVERLAY_HUD_UID = (161 << 16) | 8;

const OBJECT = {
  TRIP_HAMMER: "Trip hammer",
  GRINDSTONE: "Grindstone",
  POLISHING_WHEEL: "Polishing wheel",
  LAVA_POOL: "Lava pool",
  WATERFALL: "Waterfall",
  PREFORM_STORAGE: "Preform storage",
  CRUCIBLE: ["Crucible (empty)", "Crucible (partially full)", "Crucible (full)"],
  MOULD_JIG: ["Mould jig (Empty)", "Mould jig (Setup)", "Mould jig (Poured metal)", "Mould jig (Cooled metal)"],
  /** The multilocs the map places in the room (dump:loc). */
  CRUCIBLE_MULTI: 44776,
  MOULD_JIG_MULTI: 44777,
  PREFORM_STORAGE_MULTI: 44778,
};

const NPC = {
  /** kovac_multi: 11470 (Talk-to) until the quest varbit reads 30, then 11472. */
  KOVAC_MULTI: 11560,
  /** giants_foundry_kovac, with Hand-in, Commission and Shop. */
  KOVAC: 11472,
  KOVAC_NAME: "Kovac",
};

const ITEM = {
  PREFORM: 27010,
  SMITHS_TUNIC: 27023,
  SMITHS_TROUSERS: 27025,
  SMITHS_BOOTS: 27027,
  SMITHS_GLOVES: 27029,
  ICE_GLOVES: 1580,
  SMITHS_GLOVES_I: 27031,
  BUCKET_OF_WATER: 1929,
  BUCKET: 1925,
};

/**
 * The trip hammer's fall, every fifth tick. The room plays it (Area) and the hammer's work tick
 * rides the same cycle (Tools), so progress lands on the tick the hammer comes down.
 */
const HAMMER_PERIOD = 5;

/** The room's machinery, heard and seen by everyone inside (rsprox captures). */
const AMBIENT = {
  /** Every second tick. */
  SHORT: [
    { sound: 5602, x: 3364, y: 11485, radius: 12 },
    { sound: 5600, x: 3363, y: 11492, radius: 12 },
  ],
  /** Every fifth tick: the trip hammer's big hammer falls. */
  HAMMER_SOUND: { sound: 5603, x: 3367, y: 11497, radius: 15 },
  HAMMER_ANIM: 9446,
};

/** What the player is doing with the preform right now (a machine, the lava, the waterfall). */
const work = new WeakMap();

function workOf(player) {
  return work.get(player) ?? null;
}

function setWork(player, value) {
  if (value) work.set(player, value);
  else work.delete(player);
}

/** Units that work the preform each tick, and stop when the player leaves or stores it. */
const tickHandlers = [];
const stopHandlers = [];

function onTick(handler) {
  tickHandlers.push(handler);
}

function onStopWork(handler) {
  stopHandlers.push(handler);
}

function runTick(player, now) {
  for (const handler of tickHandlers) handler(player, now);
}

function stopWork(player) {
  for (const handler of stopHandlers) handler(player);
  work.delete(player);
}

function range(first, count) {
  return Array.from({ length: count }, (_, index) => first + index);
}

// ============================================================================
// State
// ============================================================================

function stateOf(player) {
  let value = player.getAttribute(STATE_ATTRIBUTE);
  if (!value || typeof value !== "object") {
    value = { vars: {} };
    player.setAttribute(STATE_ATTRIBUTE, value);
  }
  if (!value.vars || typeof value.vars !== "object") value.vars = {};
  return value;
}

function get(player, varbit) {
  return Number(stateOf(player).vars[varbit]) || 0;
}

/** Stores a minigame varbit and sends it when it changed (live sends a varbit only on change). */
function set(player, varbit, value) {
  const vars = stateOf(player).vars;
  const next = value | 0;
  const previous = Number(vars[varbit]) || 0;
  if (next === 0) delete vars[varbit];
  else vars[varbit] = next;
  if (previous !== next || player.getPacketSender().getVarbit(varbit) !== next) {
    player.getPacketSender().sendVarbit(varbit, next);
  }
}

/** A non-varbit field of the state (commission start, records, transient work). */
function field(player, key, fallback = null) {
  const value = stateOf(player)[key];
  return value === undefined ? fallback : value;
}

function setField(player, key, value) {
  const current = stateOf(player);
  if (value === null || value === undefined) delete current[key];
  else current[key] = value;
}

function reputation(player) {
  return Number(player.getAttribute(REPUTATION_ATTRIBUTE)) || 0;
}

function setReputation(player, value) {
  const next = Math.max(0, value | 0);
  player.setAttribute(REPUTATION_ATTRIBUTE, next);
  player.getPacketSender().sendConfig(VARP.REPUTATION, next);
}

/** Re-sends every minigame varbit and the reputation varp (login). */
function sync(player) {
  const sender = player.getPacketSender();
  for (const varbit of SYNCED_VARBITS) sender.sendVarbit(varbit, get(player, varbit));
  sender.sendConfig(VARP.REPUTATION, reputation(player));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sleeping Giants unlocks the minigame; during the quest's tutorial sword the quest lets the
 * player in too (it answers "giants-foundry:access").
 */
function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api().emitCustomEvent("quest:is-complete", request);
  if (request.complete === true) return true;
  const access = { player, allowed: false };
  api().emitCustomEvent("giants-foundry:access", access);
  return access.allowed === true;
}

/** Tells the quest (or anyone) how the sword is coming along. */
function step(player, name) {
  api().emitCustomEvent("giants-foundry:step", { player, step: name });
}

function inRoom(location) {
  const x = location.getX();
  const y = location.getY();
  return x >= ROOM.minX && x <= ROOM.maxX && y >= ROOM.minY && y <= ROOM.maxY && location.getZ() === ROOM.z;
}

function tick() {
  return core().World.getProcessCycle();
}

function level(player, skill) {
  return player.getSkillManager().getMaxLevel(core().Skill[skill]);
}

function currentLevel(player, skill) {
  return player.getSkillManager().getCurrentLevel(core().Skill[skill]);
}

function addXp(player, skill, amount) {
  player.getSkillManager().addExperiences(core().Skill[skill], amount);
}

function animate(player, id) {
  player.performAnimation(new (core().Animation)(id));
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 0, 0);
}

function areaSound(player, spec) {
  player.getPacketSender().sendAreaSound(spec.sound, spec.x, spec.y, ROOM.z, 1, 0, spec.radius);
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

function playerSays(player, text) {
  const { DialogueChainBuilder, PlayerDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new PlayerDialogue(0, text),
    new EndDialogue(1),
  ));
}

function kovacSays(player, text, then = null) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue, ActionDialogue } = core();
  const chain = new DialogueChainBuilder().add(new NpcDialogue(0, NPC.KOVAC, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  else chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

/** A chatbox choice: options(player, "Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), "giants-foundry", false);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function itemName(itemId) {
  return core().ItemDefinition.forId(itemId)?.getName?.() ?? "";
}

function wornPreform(player) {
  const weapon = player.getEquipment().get(core().Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === ITEM.PREFORM;
}

module.exports = {
  bind, core, api,
  STATE_ATTRIBUTE, REPUTATION_ATTRIBUTE, QUEST_KEY, ROOM, VARP, VARBIT, SYNCED_VARBITS,
  INTERFACE, OVERLAY_HUD_UID, OBJECT, NPC, ITEM, AMBIENT, HAMMER_PERIOD,
  stateOf, get, set, field, setField, reputation, setReputation, sync,
  workOf, setWork, onTick, onStopWork, runTick, stopWork,
  questComplete, step, inRoom, tick, level, currentLevel, addXp, animate, sound, areaSound,
  statement, playerSays, kovacSays, options, later, itemName, wornPreform,
};
