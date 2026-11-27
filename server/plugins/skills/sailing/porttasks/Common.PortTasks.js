// Port tasks: what the board, ledger table, cargo hold and port master share. Task data is
// plugins/skills/sailing/data/port-tasks.json (cache table 197 and the OSRS Wiki's XP); the flow, varbits
// and messages follow the rsprox.net recordings (docs/port-tasks.md).
const DATA = require("../data/port-tasks.json");
const { content } = require("../SailingContent.Sailing");

/** A player's task slots (persisted): `{ id, taken, delivered }` or null, slot 0 first. */
const SLOTS_ATTRIBUTE = "port-tasks:slots";
/** Each notice board's eight tasks for the player (persisted): board dock id -> task rows. */
const BOARDS_ATTRIBUTE = "port-tasks:boards";
/** Rewards earned with no inventory space, for a port master's Claim-rewards (persisted). */
const UNCLAIMED_ATTRIBUTE = "port-tasks:unclaimed";
const COMPLETED_ATTRIBUTE = "port-tasks:completed";
/**
 * Crates crewmates carry for the player, per task slot (not saved): `{ crate, amount, boatSlot }`,
 * `boatSlot` when they took them out of that boat's hold to deliver (crew/Courier.Crew.js).
 */
const CREW_CARGO_ATTRIBUTE = "port-tasks:crew-cargo";
/** Saved task slot owning the physical crate in the player's weapon slot. */
const CARRIED_SLOT_ATTRIBUTE = "port-tasks:carried-slot";

const MAX_SLOTS = 5;
/** Tasks a player may hold: 1, and one more at Sailing 7, 28, 56 and 84 (Wiki; not boostable). */
const SLOT_LEVELS = [1, 7, 28, 56, 84];
const BOARD_SIZE = 8;

const VARBIT = Object.freeze({
  SLOT0_ID: 19574, // port_task_slot_n_id; _cargo_taken and _cargo_delivered follow, 3 a slot
  EXTRA_SLOTS_UNLOCKED: 19589,
  LAST_CARGO_TAKEN: 19590, // the slot (+1) whose crate is in the player's hands
  COMPLETED_TODAY: 19591,
  CARRYING_CARGO: 19134, // sailing_carrying_cargo: the ledger table and cargo hold switch on it
});
const VARP_TASKS_COMPLETED = 5207;
/** sailing_crew_held_cargo_n (varp, the crate) and _amount (varbit), per task slot; the hold they came from (rsprox). */
const VARP_CREW_CARGO0 = 5174;
const VARBIT_CREW_CARGO0_AMOUNT = 19473;
const VARP_CREW_CARGO_HOLD = 5179;

const tasksById = new Map(DATA.tasks.map((task) => [task.id, task]));
const tasksByRow = new Map(DATA.tasks.map((task) => [task.row, task]));
const boardLocs = new Set(DATA.boardLocs);
const crates = new Set(DATA.tasks.map((task) => task.crate).filter((crate) => crate !== undefined));

let core;

function init(api) {
  core = api.core;
}

function taskById(id) {
  return tasksById.get(id);
}

function taskByRow(row) {
  return tasksByRow.get(row);
}

/** The dock (sailing-ports.json) whose gangplank or landing is nearest a tile, within `range`. */
function dockAt(x, y, range = 48) {
  let best;
  let bestDistance = range + 1;
  for (const dock of content().docks) {
    for (const tile of [dock.gangplank, dock.landing]) {
      if (!tile) continue;
      const distance = Math.max(Math.abs(tile.x - x), Math.abs(tile.y - y));
      if (distance < bestDistance) {
        best = dock;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function slotLimit(player) {
  const level = player.getSkillManager().getMaxLevel(core.Skill.SAILING);
  return SLOT_LEVELS.filter((required) => level >= required).length;
}

function slots(player) {
  const saved = player.getAttribute(SLOTS_ATTRIBUTE);
  return Array.from({ length: MAX_SLOTS }, (_, i) => (Array.isArray(saved) && saved[i]) || null);
}

function setSlots(player, value) {
  player.setAttribute(SLOTS_ATTRIBUTE, value);
  sendSlots(player);
  core.PluginManager.emitCustomEvent("port-tasks:slots-changed", { player });
}

/**
 * Gives back everything a task still has out: the slot keeps what was delivered, nothing more.
 * For a task a quest hands out, which has nothing left to hand in once the quest is reset.
 */
function releaseTask(player, taskId) {
  const current = slots(player);
  let changed = false;
  for (const [index, slot] of current.entries()) {
    if (slot?.id !== taskId || slot.taken <= slot.delivered) continue;
    current[index] = { ...slot, taken: slot.delivered };
    changed = true;
  }
  if (changed) setSlots(player, current);
}

/** Every slot's id, cargo taken and cargo delivered varbits, and the unlocked extra slots. */
function sendSlots(player) {
  const sender = player.getPacketSender();
  slots(player).forEach((slot, i) => {
    sender.sendVarbit(VARBIT.SLOT0_ID + 3 * i, slot?.id ?? 0);
    sender.sendVarbit(VARBIT.SLOT0_ID + 3 * i + 1, slot?.taken ?? 0);
    sender.sendVarbit(VARBIT.SLOT0_ID + 3 * i + 2, slot?.delivered ?? 0);
  });
  sender.sendVarbit(VARBIT.EXTRA_SLOTS_UNLOCKED, Math.max(0, slotLimit(player) - 1));
  sendCrewCargo(player);
}

function crewCargo(player) {
  const saved = player.getAttribute(CREW_CARGO_ATTRIBUTE);
  return Array.from({ length: MAX_SLOTS }, (_, i) => (Array.isArray(saved) && saved[i]) || null);
}

/** Crates the crew carry for a task slot. */
function crewAmount(player, index) {
  return crewCargo(player)[index]?.amount ?? 0;
}

function setCrewCargo(player, index, entry) {
  const held = crewCargo(player);
  held[index] = entry;
  player.setAttribute(CREW_CARGO_ATTRIBUTE, held);
  sendCrewCargo(player);
}

/**
 * The crew's crates, as live sends them: the crate and how many per task slot, and while they
 * carry a delivery out of a hold, that hold's inventory (-1 otherwise).
 */
function sendCrewCargo(player, holdInventory = -1) {
  const sender = player.getPacketSender();
  crewCargo(player).forEach((entry, i) => {
    sender.sendConfig(VARP_CREW_CARGO0 + i, entry?.crate ?? -1);
    sender.sendVarbit(VARBIT_CREW_CARGO0_AMOUNT + i, entry?.amount ?? 0);
  });
  const fromHold = crewCargo(player).find((entry) => entry?.holdInventory !== undefined);
  sender.sendConfig(VARP_CREW_CARGO_HOLD, fromHold?.holdInventory ?? holdInventory);
}

/** The crate in the player's hands (weapon slot), or undefined. */
function heldCrate(player) {
  const item = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return item && item.getId() > 0 && isCrate(item.getId()) ? item.getId() : undefined;
}

function isCrate(itemId) {
  return crates.has(itemId);
}

/** Both hands must be free to carry a crate (Wiki). */
function handsFree(player) {
  const items = player.getEquipment().getItems();
  const empty = (slot) => !items[slot] || items[slot].getId() <= 0;
  return empty(core.Equipment.WEAPON_SLOT) && empty(core.Equipment.SHIELD_SLOT);
}

function refreshEquipment(player) {
  const equipment = player.getEquipment();
  core.WeaponInterfaceManager.assign(player);
  equipment.refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** Puts a crate in the player's hands, for the slot (0-4) it belongs to. */
function carry(player, crate, slot) {
  player.setAttribute(CARRIED_SLOT_ATTRIBUTE, slot);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(crate, 1));
  refreshEquipment(player);
  player.getPacketSender().sendVarbit(VARBIT.LAST_CARGO_TAKEN, slot + 1);
  player.getPacketSender().sendVarbit(VARBIT.CARRYING_CARGO, 1);
  core.PluginManager.emitCustomEvent("port-tasks:cargo-carried", { player, crate, slot });
}

/** Takes the crate out of the player's hands. */
function putDown(player) {
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  refreshEquipment(player);
  clearCarrying(player);
}

/** Clear only hand-cargo bookkeeping after another shared owner removed the equipment. */
function clearCarrying(player) {
  player.setAttribute(CARRIED_SLOT_ATTRIBUTE, -1);
  player.getPacketSender().sendVarbit(VARBIT.LAST_CARGO_TAKEN, 0);
  player.getPacketSender().sendVarbit(VARBIT.CARRYING_CARGO, 0);
  core.PluginManager.emitCustomEvent("port-tasks:cargo-released", { player });
}

/** "crate of jewellery", from the crate's name. */
function crateName(itemId) {
  return (core.CacheDefinitions.getItem(itemId)?.name ?? "crate").toLowerCase();
}

/** The task name in the game's blue, as the messages show it. */
function blue(text) {
  return `<col=0090bc>${text}</col>`;
}

module.exports = {
  DATA,
  SLOTS_ATTRIBUTE,
  BOARDS_ATTRIBUTE,
  UNCLAIMED_ATTRIBUTE,
  COMPLETED_ATTRIBUTE,
  CREW_CARGO_ATTRIBUTE,
  CARRIED_SLOT_ATTRIBUTE,
  BOARD_SIZE,
  VARBIT,
  VARP_TASKS_COMPLETED,
  boardLocs,
  init,
  taskById,
  taskByRow,
  dockAt,
  slotLimit,
  slots,
  setSlots,
  releaseTask,
  sendSlots,
  crewCargo,
  crewAmount,
  setCrewCargo,
  heldCrate,
  isCrate,
  handsFree,
  carry,
  putDown,
  clearCarrying,
  crateName,
  blue,
  core: () => core,
};
