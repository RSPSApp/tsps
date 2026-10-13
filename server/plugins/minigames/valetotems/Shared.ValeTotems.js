"use strict";

/**
 * What every Vale Totems unit shares: the data file, ids by cache gameval, sounds and
 * animations from the captures, and one repeated action per player (decorating, rummaging).
 */
const DATA = require("../data/vale-totems.json");

const state = { api: null, core: null };

/** Animations and sounds, by the gamevals and ids the captures print. */
const SEQ = { BUILD: "human_pickupfloor", CARVE: "human_pickuptable_walkmerge", DECORATE: "human_pickuptable_walkmerge", CLAIM: "human_pickupfloor" };
const SOUND = { BUILD: 1739, CARVE: 10384, DECORATE: 2739, CLAIM: 2582, RUMMAGE: 1412 };
const SOUND_DELAY = { CARVE: 15, DECORATE: 20 };

/** The house's location varbit; 0 means no house (Construction). */
const VARBIT_HOUSE_LOCATION = 2187;

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

const ids = new Map();

function init(api) {
  state.api = api;
  state.core = api.core;
}

function api() {
  return state.api;
}

function core() {
  return state.core;
}

function gamevalId(kind, name) {
  const key = `${kind}:${name}`;
  if (ids.has(key)) return ids.get(key);
  const lookup = { loc: "getLocId", npc: "getNpcId", obj: "getObjId", seq: "getSeqId" }[kind];
  const id = core().CacheDefinitions[lookup](name);
  if (id == null) throw new Error(`ValeTotems: no ${kind} named ${name}`);
  ids.set(key, id);
  return id;
}

function obj(name) {
  return gamevalId("obj", name);
}

function loc(name) {
  return gamevalId("loc", name);
}

function npc(name) {
  return gamevalId("npc", name);
}

function animate(player, seqName) {
  const { Animation } = core();
  player.performAnimation(new Animation(seqName == null ? -1 : gamevalId("seq", seqName)));
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

function face(player, tile) {
  player.setPositionToFace(new (core().Location)(tile.x, tile.y, 0));
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core().Skill[skill]);
}

function addXp(player, skill, amount) {
  if (amount > 0) player.getSkillManager().addExperiences(core().Skill[skill], amount);
}

function ownsHouse(player) {
  return player.getPacketSender().getVarbit(VARBIT_HOUSE_LOCATION) !== 0;
}

function itemName(id) {
  return core().ItemDefinition.forId(id)?.getName?.() ?? "item";
}

/** "ten" up to twenty, digits above (the captures only show small piles). */
function numberWord(n) {
  return NUMBER_WORDS[n] ?? n.toLocaleString("en-US");
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function itemStatement(player, itemId, text) {
  const { DialogueChainBuilder, ItemStatementDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
}

/** Room for `amount` of an item: one slot (or its stack) if it stacks, a slot each if not. */
function hasRoomFor(player, itemId, amount = 1) {
  const inventory = player.getInventory();
  if (core().ItemDefinition.forId(itemId)?.isStackable?.() === true) return inventory.contains(itemId) || inventory.getFreeSlots() > 0;
  return inventory.getFreeSlots() >= amount;
}

function later(ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), null, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

/**
 * One repeated action per player: `step(tick)` runs on the tick it starts (tick 0) and every
 * tick after until it returns false. Moving, or starting another, ends it.
 */
function startAction(player, step) {
  stopAction(player);
  const { Task, TaskManager } = core();
  const origin = player.getLocation();
  let tick = 0;
  const action = new (class extends Task {
    constructor() {
      super(1, player, true);
    }
    execute() {
      if (player.__valeTotemsAction !== this || !player.getLocation().equals(origin) || step(tick++) === false) {
        this.stop();
        if (player.__valeTotemsAction === this) player.__valeTotemsAction = null;
      }
    }
  })();
  player.__valeTotemsAction = action;
  TaskManager.submit(action);
}

function stopAction(player) {
  const action = player.__valeTotemsAction;
  if (!action) return;
  player.__valeTotemsAction = null;
  action.stop();
}

module.exports = {
  DATA, SEQ, SOUND, SOUND_DELAY,
  init, api, core, obj, loc, npc, animate, sound, face, level, addXp, ownsHouse, itemName, numberWord,
  statement, itemStatement, hasRoomFor, later, startAction, stopAction,
};
