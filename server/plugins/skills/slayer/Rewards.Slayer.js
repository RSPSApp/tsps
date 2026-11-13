"use strict";

/**
 * The Slayer Rewards interface (slayer_rewards, 426), opened by a master's Rewards option.
 * The cache's scripts draw every tab from the Slayer varps; the server answers the clicks:
 *
 * - confirm_button (426:11), one dynamic child per choice, its slot saying which (cache
 *   scripts 414, 423 and 426):
 *   - 0-66: an unlock's bit (slayer_unlock). Locked: unlock it for its cost. Unlocked: lock it
 *     again, no refund; bits 35, 43 and 53 (superiors, fossil wyverns, revenants) turn their
 *     toggle varbit instead.
 *   - 67 cancel the task, 68 block it, 75 extend everything, 76 store or swap and 77 unstore
 *     (Storage.Slayer.js).
 *   - 69-73 and 78 unblock block slots 1-5 and 6; 74 the diary slot.
 * - view_tasks (426:36): the master's task list (slayer_rewards_task_list, 924). Its rows are the
 *   master's slayer_master_task rows in cache order; clicking one offers to block that task.
 * - buy_items (426:25): enum 840's items, 841 the amount per purchase, 842 the price;
 *   ops 2-5 buy 1/5/10/50.
 *
 * Opening (rsprox captures): slayer_master_in_focus = the master; varps if1/if2/if3 = the
 * task's count, id and boss id, if4/if5/if6 the stored task's (the Tasks tab reads them); if_setevents on confirm_button,
 * view_tasks and buy_items. Costs: block per master and cancel 30 (100 Mortimer) from cache
 * scripts 823 and 9741; block slots need 50-300 quest points (script 9738) or the Lumbridge &
 * Draynor elite diary (varbit 4538) for the seventh.
 */
const Data = require("./Data.Slayer");
const State = require("./State.Slayer");
const Tasks = require("./Tasks.Slayer");
const Storage = require("./Storage.Slayer");

const REWARDS = 426;
const TASK_LIST = 924;
/** popupoverlay, the host of script 4212's Yes/No popup. */
const POPUP_OVERLAY = 289;
const uid = (group, child) => (group << 16) | child;
const POPUP = uid(REWARDS, 5);
const CONFIRM_BUTTON = uid(REWARDS, 11);
const BUY_ITEMS = uid(REWARDS, 25);
const VIEW_TASKS = uid(REWARDS, 36);
const TASK_LIST_CLICKABLE = uid(TASK_LIST, 9);
const TASK_LIST_INIT_SCRIPT = 8059;
const POPUP_SCRIPT = 4212;
const op = (n) => 1 << n;

const SLOT = { CANCEL: 67, BLOCK: 68, EXTEND_ALL: 75, STORE: 76, UNSTORE: 77, DIARY: 74 };
/** Unblock slots by block slot (1-6), then the diary slot. */
const UNBLOCK_SLOTS = new Map([[69, "1"], [70, "2"], [71, "3"], [72, "4"], [73, "5"], [78, "6"], [74, "diary"]]);
const BLOCK_SLOTS = ["1", "2", "3", "4", "5", "6", "diary"];
const SLOT_QUEST_POINTS = { 1: 50, 2: 100, 3: 150, 4: 200, 5: 250, 6: 300 };
const QUEST_POINTS_VARP = 101;
const LUMBRIDGE_ELITE_VARBIT = 4538;

/** Unlocks whose confirm, once bought, turns a toggle instead of locking them (script 414). */
const TOGGLES = Tasks.TOGGLES;

/** Buy tab enums: items, amounts per purchase, prices. */
const BUY_ITEMS_ENUM = 840;
const BUY_AMOUNTS_ENUM = 841;
const BUY_PRICES_ENUM = 842;
const BUY_COUNTS = { 2: 1, 3: 5, 4: 10, 5: 50 };

const CANCEL_COST = { default: 30, 10: 100 };

const NOT_ENOUGH = "You need {cost} points to {what}.";
const NO_FREE_SLOT = "You do not have any available slots in which to block this task.";
const LIST_TASK_BLOCKED = "This task is currently blocked.";
const LIST_TASK_UNAVAILABLE = "This master cannot currently assign you this task.";
const LIST_MENU_TITLE = "Select an option";
const LIST_DONT_BLOCK = "Don't Block";
const LIST_BLOCKED = "<col=ef1020>{name}</col> has been blocked.";

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function points(player) {
  return State.varbit(player, "slayer_points");
}

/**
 * What a reward costs this player: content may lower it ("slayer:reward-cost" { player, kind, cost,
 * ... }, a league relic's free rewards); `kind` is "unlock" (with `bit`), "extend", "cancel",
 * "block" or "buy" (with `itemId`). Never below 0.
 */
function costOf(player, kind, cost, detail = {}) {
  const request = { player, kind, cost, ...detail };
  api.emitCustomEvent("slayer:reward-cost", request);
  return Number.isSafeInteger(request.cost) && request.cost >= 0 ? request.cost : cost;
}

function spend(player, cost, what) {
  if (points(player) < cost) {
    player.sendMessage(NOT_ENOUGH.replace("{cost}", String(cost)).replace("{what}", what));
    return false;
  }
  State.setVarbit(player, "slayer_points", points(player) - cost);
  return true;
}

function focusMaster(player) {
  return Data.get().masters.get(State.varbit(player, "slayer_master_in_focus")) ?? null;
}

// --- Opening

function open({ player, master }) {
  if (!player) return;
  const sender = player.getPacketSender();
  State.setVarbit(player, "slayer_master_in_focus", master);
  refreshTask(player);
  sender.sendInterface(REWARDS);
  sender.sendInterfaceFlagsRange(CONFIRM_BUTTON, 0, 78, op(1));
  sender.sendInterfaceFlagsRange(VIEW_TASKS, 0, 1, op(1));
  sender.sendInterfaceFlagsRange(BUY_ITEMS, 0, 5, op(2) | op(3) | op(4) | op(5) | op(10));
}

/** The Tasks tab's current task (if1-if3) and stored task (if4-if6): count, task id, boss id. */
function refreshTask(player) {
  const task = Tasks.current(player);
  const stored = Storage.stored(player);
  const sender = player.getPacketSender();
  const send = (name, value) => sender.sendConfig(core.CacheDefinitions.getVarpId(name), value);
  send("if1", task?.count ?? 0);
  send("if2", task?.taskId ?? 0);
  send("if3", task?.bossId ?? 0);
  send("if4", stored?.count ?? 0);
  send("if5", stored ? stored.target : 0);
  send("if6", stored ? State.varbit(player, "slayer_target_bossid_stored") : 0);
}

// --- Unlocks

const UNLOCK_VARPS = ["slayer_rewards_unlocks", "slayer_rewards_unlocks1", "slayer_rewards_unlocks2"];

function setUnlockBit(player, bit, on) {
  const name = UNLOCK_VARPS[bit >> 5];
  const mask = 1 << (bit & 31);
  const value = State.varp(player, name);
  State.setVarp(player, name, on ? (value | mask) : (value & ~mask));
}

function unlock(player, bit) {
  const entry = Data.get().unlockByBit.get(bit);
  if (!entry) return;
  if (Tasks.hasUnlockBit(player, bit)) {
    const toggle = TOGGLES.get(bit);
    if (toggle) {
      State.setVarbit(player, toggle, State.varbit(player, toggle) === 1 ? 0 : 1);
      return;
    }
    setUnlockBit(player, bit, false);
    return;
  }
  if (!spend(player, costOf(player, "unlock", entry.cost, { bit, name: entry.name }), "unlock this")) return;
  setUnlockBit(player, bit, true);
  api.emitCustomEvent("slayer:unlocked", { player, bit, name: entry.name });
}

/** Every extension (the Extend tab's unlocks) still locked, paid for at once. */
function extendAll(player) {
  const locked = [...Data.get().unlocks.values()].filter((entry) => entry.tab === 1 && !Tasks.hasUnlockBit(player, entry.bit));
  if (locked.length === 0) return;
  const cost = locked.reduce((sum, entry) => sum + costOf(player, "extend", entry.cost, { bit: entry.bit, name: entry.name }), 0);
  if (!spend(player, cost, "extend everything")) return;
  for (const entry of locked) setUnlockBit(player, entry.bit, true);
}

// --- Cancelling and blocking

function cancelCost(player) {
  return CANCEL_COST[State.varbit(player, "slayer_master")] ?? CANCEL_COST.default;
}

/** What cancelling the current task costs this player now. */
function cancelPrice(player) {
  return costOf(player, "cancel", cancelCost(player));
}

/** Cancels the task for its price; `quiet` leaves the line to the master who says it. */
function cancel(player, { quiet = false } = {}) {
  if (!Tasks.current(player)) return false;
  if (!spend(player, cancelPrice(player), "cancel your task")) return false;
  Tasks.clear(player);
  refreshTask(player);
  if (!quiet) player.sendMessage("Your task has been cancelled.");
  return true;
}

/**
 * "slayer:cancel-task" { player, quiet? }: a master's "Can I cancel that task?"; sets
 * `cancelled` on the request.
 */
function cancelEvent(request) {
  if (request?.player) request.cancelled = cancel(request.player, { quiet: request.quiet === true });
}

function slotOpen(player, slot) {
  if (slot === "diary") return player.getPacketSender().getVarbit(LUMBRIDGE_ELITE_VARBIT) === 1;
  return player.getPacketSender().getVarp(QUEST_POINTS_VARP) >= SLOT_QUEST_POINTS[slot];
}

function blockVarbit(master, slot) {
  return `slayer_blocked_${master.blocks}_${slot}`;
}

function hasVarbit(name) {
  return core.CacheDefinitions.getVarbitId(name) != null;
}

/** Blocks the current task with the master in focus: confirm first if the master doesn't give it. */
function block(player) {
  const master = focusMaster(player);
  const task = Tasks.current(player);
  if (!master || !task) return;
  const offered = master.tasks.some((entry) => entry.task.id === task.taskId);
  if (offered) {
    blockNow(player, master, task);
    return;
  }
  confirm(player, "Task Blocking|This master doesn't offer this task.<br>Are you sure you want to block it?|Yes|No",
    () => blockNow(player, master, task));
}

function blockNow(player, master, task) {
  // The confirm's Yes can come after the task changed (finished, cancelled, a new one): block only the one still held.
  const held = Tasks.current(player);
  if (!held || held.taskId !== task.taskId) return;
  if (isBlocked(player, master, task.taskId)) {
    player.sendMessage("You have already blocked this task with this master.");
    return;
  }
  if (!fillBlockSlot(player, master, task.taskId)) return;
  Tasks.clear(player);
  refreshTask(player);
}

function isBlocked(player, master, taskId) {
  return BLOCK_SLOTS.some((slot) => hasVarbit(blockVarbit(master, slot)) && State.varbit(player, blockVarbit(master, slot)) === taskId);
}

/** Pays for a block and puts the task in the master's first free open slot; false (having said why) when it can't. */
function fillBlockSlot(player, master, taskId) {
  const slot = BLOCK_SLOTS.find((candidate) => hasVarbit(blockVarbit(master, candidate))
    && slotOpen(player, candidate) && State.varbit(player, blockVarbit(master, candidate)) === 0);
  if (!slot) {
    player.sendMessage(NO_FREE_SLOT);
    return false;
  }
  if (!spend(player, costOf(player, "block", master.blockCost), "block your task")) return false;
  State.setVarbit(player, blockVarbit(master, slot), taskId);
  return true;
}

// --- The task list (View List)

/**
 * A click on a row of the master's task list. A task already blocked with the master, or one the master can't give
 * the player now (locked, switched off, requirements not met), is refused. Otherwise the rewards close for a
 * Block/Don't Block menu, and either answer opens them again.
 */
function listClick({ player, slot }) {
  const master = focusMaster(player);
  const entry = Number.isInteger(slot) ? master?.tasks[slot] : null;
  if (!entry) return true;
  if (isBlocked(player, master, entry.task.id)) {
    player.sendMessage(LIST_TASK_BLOCKED);
    return true;
  }
  if (!Tasks.eligible(player, master, entry, new Set())) {
    player.sendMessage(LIST_TASK_UNAVAILABLE);
    return true;
  }
  const cost = costOf(player, "block", master.blockCost);
  player.getPacketSender().sendInterfaceRemoval();
  api.sendMultiChatboxPrompt(player, LIST_MENU_TITLE,
    `Block ${entry.task.displayName} (${cost} points)`, () => blockFromList(player, master, entry),
    LIST_DONT_BLOCK, () => open({ player, master: master.id }));
  return true;
}

/**
 * The list's Block: the task takes a block slot. Ours: blocking the current task this way also ends it, as the
 * Tasks tab's Block does.
 */
function blockFromList(player, master, entry) {
  const taskId = entry.task.id;
  if (!isBlocked(player, master, taskId) && fillBlockSlot(player, master, taskId)) {
    player.sendMessage(LIST_BLOCKED.replace("{name}", entry.task.displayName));
    if (Tasks.current(player)?.taskId === taskId) Tasks.clear(player);
  }
  open({ player, master: master.id });
}

function unblock(player, slot) {
  const master = focusMaster(player);
  if (!master || !hasVarbit(blockVarbit(master, slot))) return;
  State.setVarbit(player, blockVarbit(master, slot), 0);
}

/** The cache's Yes/No popup (script 4212); the answer comes back as a count, 1 = Yes. */
function confirm(player, text, onYes) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(POPUP, POPUP_OVERLAY, 1);
  sender.sendClientScript(POPUP_SCRIPT, text, POPUP);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(answer) {
      sender.closeSubInterface(POPUP);
      if (answer === 1) onYes();
    },
  });
}

// --- Clicks

/**
 * The rewards' buttons answer only while the rewards are open (a master's Rewards option): a click on them with the
 * interface closed bought, unlocked, cancelled and blocked tasks anywhere, with no master there.
 */
function whileOpen(handler) {
  return function openRewardsOnly(event) {
    if (event?.player?.getInterfaceId?.() !== REWARDS) return true;
    return handler(event);
  };
}

function confirmClick({ player, slot }) {
  if (!Number.isInteger(slot)) return true;
  if (slot === SLOT.CANCEL) cancel(player);
  else if (slot === SLOT.BLOCK) block(player);
  else if (slot === SLOT.EXTEND_ALL) extendAll(player);
  else if (UNBLOCK_SLOTS.has(slot)) unblock(player, UNBLOCK_SLOTS.get(slot));
  else if (slot === SLOT.STORE) { if (Storage.store(player)) refreshTask(player); }
  else if (slot === SLOT.UNSTORE) { if (Storage.unstore(player)) refreshTask(player); }
  else if (Data.get().unlockByBit.has(slot)) unlock(player, slot);
  return true;
}

function viewTasks({ player, slot }) {
  if (slot !== 0) return true;
  const sender = player.getPacketSender();
  sender.sendSubInterface(POPUP, TASK_LIST, 1);
  sender.sendInterfaceFlagsRange(TASK_LIST_CLICKABLE, 0, 37, op(1));
  sender.sendClientScript(TASK_LIST_INIT_SCRIPT, POPUP, 5, 9);
  return true;
}

function buy({ player, slot, opId, action }) {
  const count = BUY_COUNTS[Number(opId ?? action)];
  if (!count || !Number.isInteger(slot)) return true;
  const item = core.CacheDefinitions.getEnumValues(BUY_ITEMS_ENUM).get(slot);
  if (typeof item !== "number" || item < 0) return true;
  const each = Number(core.CacheDefinitions.getEnumValues(BUY_AMOUNTS_ENUM).get(item)) || 1;
  const price = costOf(player, "buy", Number(core.CacheDefinitions.getEnumValues(BUY_PRICES_ENUM).get(item)) || 0, { itemId: item });
  const inventory = player.getInventory();
  const stackable = core.ItemDefinition.forId(item)?.isStackable?.() === true;
  let bought = 0;
  for (; bought < count; bought++) {
    if (points(player) < price) break;
    const room = stackable ? inventory.getFreeSlots() > 0 || inventory.contains(item) : inventory.getFreeSlots() > 0;
    if (!room) break;
    State.setVarbit(player, "slayer_points", points(player) - price);
    inventory.adds(item, each);
  }
  if (bought === 0) {
    player.sendMessage(points(player) < price ? `You need ${price} points to buy that.` : "You don't have enough inventory space.");
  }
  return true;
}

function attach(pluginApi) {
  pluginApi.onCustomEvent("slayer:open-rewards", open);
  pluginApi.onCustomEvent("slayer:cancel-task", cancelEvent);
  pluginApi.onInterfaceActionButton(CONFIRM_BUTTON, whileOpen(confirmClick));
  pluginApi.onInterfaceActionButton(VIEW_TASKS, whileOpen(viewTasks));
  pluginApi.onInterfaceActionButton(TASK_LIST_CLICKABLE, whileOpen(listClick));
  pluginApi.onInterfaceActionButton(BUY_ITEMS, whileOpen(buy));
}

module.exports = {
  init,
  attach,
  open,
  unlock,
  extendAll,
  cancel,
  cancelPrice,
  block,
  blockNow,
  unblock,
  listClick,
  buy,
  confirmClick,
  setUnlockBit,
  SLOT,
};
