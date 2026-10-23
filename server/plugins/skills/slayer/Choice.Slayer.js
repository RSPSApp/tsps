"use strict";

/**
 * Mortimer's task choice (rsprox captures; Wiki: Mortimer). Instead of assigning, he rolls two
 * tasks (three after 50 of his tasks), each with one modifier, into the slayer_choose_* varbits
 * and opens slayer_task_choice, which the cache's own script draws from them. Closing it keeps
 * the roll: he offers the same tasks until one is picked. Picking sets the task with its
 * modifier (Tasks.assignChosen), clears the roll and has Mortimer say the task
 * ("slayer:task-chosen", answered by Masters.Slayer.js).
 *
 * - Tasks: his slayer_master_task rows the player could get (Tasks.eligible), by weight, no
 *   task twice in one roll.
 * - Modifiers: one of the row's (slayer_master_task.modifier) that the player has done enough
 *   Mortimer tasks for (slayer_modifiers.requirement), its value a multiple of 5 in the row's
 *   range (Wiki). Which modifier is ours: uniform; no capture shows how live picks.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");

const CHOICES = 3;
/** Each choice's slot on slayer_task_choice:content (0, 10, 20). */
const SLOT_STEP = 10;
const VALUE_STEP = 5;
/** if_setevents on each offered slot: PAUSEBUTTON and OP1, as live sends. */
const PICK_EVENTS = (1 << 0) | (1 << 1);
/** The Mortimer NPC the player clicked, so the line after the pick comes from him (not saved). */
const NPC_ATTRIBUTE = "slayer:choice-npc";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const component = (name) => core.CacheDefinitions.getComponentId(`slayer_task_choice:${name}`);
const varbit = (n, field) => `slayer_choose_task_${n}${field ? `_${field}` : ""}`;

function completed(player) {
  return State.varp(player, "slayer_mortimer_tasks_completed");
}

/** Whether a roll is waiting for the player to pick. */
function pending(player) {
  return State.varbit(player, "slayer_choose_rolled_master") !== 0;
}

/** A multiple of 5 in min..max (the range itself when none fits). */
function steppedValue({ min, max }, random) {
  const low = Math.ceil(min / VALUE_STEP) * VALUE_STEP;
  const high = Math.floor(max / VALUE_STEP) * VALUE_STEP;
  if (low > high) return min;
  return low + VALUE_STEP * Math.floor(random() * ((high - low) / VALUE_STEP + 1));
}

/** One of the row's modifiers the player has unlocked, with its value; null when none is. */
function rollModifier(player, entry, random = Math.random) {
  const done = completed(player);
  const unlocked = entry.modifiers.filter((range) => (Data.get().modifiers.get(range.id)?.requirement ?? 0) <= done);
  if (unlocked.length === 0) return null;
  const range = unlocked[Math.floor(random() * unlocked.length)];
  return { id: range.id, value: steppedValue(range, random), negative: range.negative };
}

/** Rolls the master's choices into the varbits; returns how many it could offer. */
function roll(player, master, random = Math.random) {
  const blocked = Tasks.blockedTaskIds(player, master);
  const pool = master.tasks.filter((entry) => Tasks.eligible(player, master, entry, blocked));
  const count = completed(player) >= Data.THIRD_CHOICE_TASKS ? CHOICES : CHOICES - 1;
  const choices = [];
  while (choices.length < count && pool.length > 0) {
    const entry = Tasks.weightedPick(pool, random);
    pool.splice(pool.indexOf(entry), 1);
    const bossId = entry.task.id === Data.BOSS_TASK_ID ? Tasks.rollBoss(player, random) : 0;
    choices.push({ entry, bossId, modifier: rollModifier(player, entry, random) });
  }
  if (choices.length === 0) return 0;
  const varbits = {};
  for (let n = 1; n <= CHOICES; n++) {
    const choice = choices[n - 1];
    varbits[varbit(n)] = choice?.entry.task.id ?? 0;
    varbits[varbit(n, "boss_id")] = choice?.bossId ?? 0;
    varbits[varbit(n, "modifier_id")] = choice?.modifier?.id ?? 0;
    varbits[varbit(n, "modifier_value")] = choice?.modifier?.value ?? 0;
    varbits[varbit(n, "modifier_negative")] = choice?.modifier?.negative ? 1 : 0;
  }
  varbits.slayer_choose_rolled_master = master.id;
  State.update(player, varbits);
  return choices.length;
}

/** The rolled choice n (1-3), or null. */
function choice(player, n) {
  const taskId = State.varbit(player, varbit(n));
  if (!taskId) return null;
  const modifierId = State.varbit(player, varbit(n, "modifier_id"));
  return {
    taskId,
    bossId: State.varbit(player, varbit(n, "boss_id")),
    modifier: modifierId
      ? { id: modifierId, value: State.varbit(player, varbit(n, "modifier_value")), negative: State.varbit(player, varbit(n, "modifier_negative")) === 1 }
      : null,
  };
}

function clearRoll(player) {
  const varbits = { slayer_choose_rolled_master: 0 };
  for (let n = 1; n <= CHOICES; n++) {
    for (const field of [null, "boss_id", "modifier_id", "modifier_value", "modifier_negative"]) varbits[varbit(n, field)] = 0;
  }
  State.update(player, varbits);
}

/**
 * Opens the choice for a player without a task: the waiting roll, or a new one. Returns false
 * when the master has nothing to offer.
 */
function open(player, master, npcId = null) {
  if (!pending(player) && roll(player, master) === 0) return false;
  if (npcId != null) player.setAttribute(NPC_ATTRIBUTE, npcId);
  const content = component("content");
  const sender = player.getPacketSender();
  sender.sendInterface(content >>> 16);
  for (let n = 1; n <= CHOICES; n++) {
    if (!choice(player, n)) continue;
    const slot = (n - 1) * SLOT_STEP;
    sender.sendInterfaceFlagsRange(content, slot, slot, PICK_EVENTS);
  }
  return true;
}

/** A click on an offered task (resume_pausebutton, its slot 0/10/20). */
function pick(event) {
  const player = event.player;
  const slot = Number(event.slot ?? event.action);
  if (!player || !Number.isInteger(slot) || slot % SLOT_STEP !== 0) return;
  const chosen = choice(player, slot / SLOT_STEP + 1);
  const master = Data.get().masters.get(State.varbit(player, "slayer_choose_rolled_master"));
  const entry = chosen && master?.tasks.find((row) => row.task.id === chosen.taskId);
  if (!entry || Tasks.current(player)) return;
  Tasks.assignChosen(player, master, entry, chosen.bossId, chosen.modifier);
  clearRoll(player);
  player.getPacketSender().sendInterfaceRemoval();
  api.emitCustomEvent("slayer:task-chosen", { player, master: master.id, npcId: player.getAttribute(NPC_ATTRIBUTE) });
}

function close({ player }) {
  player?.getPacketSender().sendInterfaceRemoval();
}

function attach(pluginApi) {
  pluginApi.onInterfaceActionButton(component("content"), pick);
  pluginApi.onInterfaceActionButton(component("close_button"), close);
}

module.exports = { init, attach, open, pick, roll, rollModifier, choice, pending, clearRoll, steppedValue };
