"use strict";

/**
 * Group storage unlocks (Wiki, Group Ironman Mode: Shared storage; Update:Group Ironman
 * Improvements, 2 March 2022). The group storage starts with 80 spaces; each task a member has done
 * adds its spaces, up to 200, once that member opens the storage after doing it. A group can't
 * unlock any until 5 weeks after it was formed.
 *
 * The tasks are the cache's (enum 4216: each struct's bit, spaces and text); what each one asks
 * for is data/group-ironman-unlocks.json, by bit: a worn item, a 99, quest points, combat level,
 * total level, every diary or combat achievement task of a tier. GroupStorage asks for the
 * group's spaces at each opening ("group-storage:capacity"), and its Storage Unlocks button, like
 * the group settings' one, shows them on gim_shared_bank_unlocks (743) in a popup slot, with
 * %if1/%if2 the done bits, %if3 the spaces, %if4 the most there can be, %if5 the weeks to wait.
 */

const fs = require("fs");
const path = require("path");
const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");
const Wealth = require("./Wealth.GroupIronman");

const UNLOCKS_SCRIPT = 3127; // gim_shared_bank_unlocks
const BITS_PER_VARP = 32;

let data = null;
let tasks = null;
/** player -> the popup slot the unlocks are open in. */
const hosts = new WeakMap();

const defs = () => Common.api.core.CacheDefinitions;
const uid = (name) => defs().getComponentId(name);
const varp = (name) => defs().getVarpId(name);

function rules() {
  data ??= JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "group-ironman-unlocks.json"), "utf8"));
  return data;
}

/** The cache's tasks, in its order: { bit, slots, text, condition }. */
function taskList() {
  if (tasks) return tasks;
  const { params, conditions } = rules();
  tasks = [...defs().getEnumValues(rules().enum).values()].map((struct) => {
    const values = defs().getStructParams(Number(struct));
    const bit = Number(values.get(params.bit));
    return { bit, slots: Number(values.get(params.slots)) || 0, text: String(values.get(params.text) ?? ""), condition: conditions[bit] ?? null };
  }).filter((task) => Number.isInteger(task.bit) && task.bit >= 0);
  return tasks;
}

function ask(event, request) {
  Common.api.emitCustomEvent(event, request);
  return request;
}

/** Whether the player meets a task's condition now. */
function met(player, condition) {
  if (!condition) return false;
  const { Skill, ItemIdentifiers } = Common.api.core;
  const skills = player.getSkillManager();
  if (condition.equipped) return condition.equipped.some((name) => player.getEquipment().contains(ItemIdentifiers[name]));
  if (condition.level99Any) return condition.level99Any.some((name) => skills.getMaxLevel(Skill[name]) >= 99);
  if (condition.questPoints) return (Number(player.getAttribute(rules().questPointsAttribute)) || 0) >= condition.questPoints;
  if (condition.combatLevel) return skills.getCombatLevel() >= condition.combatLevel;
  if (condition.totalLevel) return skills.getTotalLevel() >= condition.totalLevel;
  if (condition.diaryTier) {
    return rules().diaries.every((diary) => ask("diary:is-complete", { player, diary, tier: condition.diaryTier, complete: false }).complete === true);
  }
  if (condition.combatAchievementTier) {
    return ask("combat-achievements:tier", { player, tier: condition.combatAchievementTier, allTasksDone: false }).allTasksDone === true;
  }
  return false;
}

/** Whole weeks until the group may unlock spaces (0: now). A group still forming waits them all. */
function weeksToWait(record, now = Date.now()) {
  if (!record?.formed) return rules().eligibleWeeks;
  return Math.max(0, Math.ceil((record.formed + rules().eligibleWeeks * Wealth.WEEK_MS - now) / Wealth.WEEK_MS));
}

function spaces(record) {
  const done = new Set(record?.unlocks ?? []);
  const extra = taskList().filter((task) => done.has(task.bit)).reduce((sum, task) => sum + task.slots, 0);
  return Math.min(rules().max, rules().base + extra);
}

/** Records every task the player has done that the group hadn't; returns the spaces they add. */
function unlock(player, record, now = Date.now()) {
  if (weeksToWait(record, now) > 0) return 0;
  const done = new Set(record.unlocks ?? []);
  const fresh = taskList().filter((task) => !done.has(task.bit) && met(player, task.condition));
  if (!fresh.length) return 0;
  record.unlocks = [...done, ...fresh.map((task) => task.bit)].sort((a, b) => a - b);
  Store.update(record);
  return fresh.reduce((sum, task) => sum + task.slots, 0);
}

/** "group-storage:capacity" { player, groupId, capacity }: the group's spaces, after this opening's unlocks. */
function capacity(request) {
  const record = Store.get(request.groupId);
  if (!record) return;
  const before = spaces(record);
  if (unlock(request.player, record) > 0) {
    const { group } = Common.groupOf(request.player);
    Common.tellGroup(group, "storageUnlocked", { slots: spaces(record) - before, total: spaces(record) });
  }
  request.capacity = spaces(record);
}

/** The done bits as the two varps the cache reads (%if1 bits 0-31, %if2 bits 32-63). */
function bitWords(record) {
  const words = [0, 0];
  for (const bit of record?.unlocks ?? []) {
    if (bit >= 0 && bit < BITS_PER_VARP * 2) words[Math.floor(bit / BITS_PER_VARP)] |= 1 << (bit % BITS_PER_VARP);
  }
  return words;
}

/** Shows the group's unlocks in `popup` (shared_bank:popup or gim_settings:popup). */
function show(player, record, popup) {
  const sender = player.getPacketSender();
  const [low, high] = bitWords(record);
  const values = { if1: low, if2: high, if3: spaces(record), if4: rules().max, if5: weeksToWait(record) };
  for (const [name, value] of Object.entries(values)) sender.sendConfig(varp(name), value);
  sender.sendSubInterface(popup, defs().getInterfaceId("gim_shared_bank_unlocks"), 0);
  sender.sendClientScript(UNLOCKS_SCRIPT, uid("gim_shared_bank_unlocks:universe"), popup, 0);
  hosts.set(player, popup);
}

/** "group-storage:unlocks" { player, groupId, popup, handled }: the storage's Storage Unlocks button. */
function storageButton(request) {
  const record = Store.get(request.groupId);
  if (!record) return;
  request.handled = true;
  show(request.player, record, request.popup);
}

/** The group settings' Storage button: the player's own group's unlocks. */
function fromSettings(player) {
  const { group } = Common.groupOf(player);
  const record = group?.ironman ? Store.get(group.id) : null;
  if (record) show(player, record, uid("gim_settings:popup"));
}

/** onInterfaceActionClick: the unlocks' Close; the storage under it gets its own varps back. */
function click(event) {
  const { player, buttonId } = event;
  if (buttonId >>> 16 !== defs().getInterfaceId("gim_shared_bank_unlocks")) return;
  event.handled = true;
  if (buttonId !== uid("gim_shared_bank_unlocks:exit")) return;
  const popup = hosts.get(player);
  if (popup === undefined) return;
  hosts.delete(player);
  player.getPacketSender().closeSubInterface(popup);
  if (popup === uid("shared_bank:popup")) Common.api.emitCustomEvent("group-storage:popup-closed", { player });
}

module.exports = { taskList, met, weeksToWait, spaces, unlock, capacity, bitWords, show, storageButton, fromSettings, click };
