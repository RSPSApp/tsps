"use strict";

// Event items: the worn-Halloween-items rule, Fred's hand-in, the Draynor Manor
// chair pickup and the Spooky chair item's Drop/Spin.
const Progress = require("./Progress.HalloweenEvents");
const scene = require("./data/halloween-2025-scene.json");
const { STAGE } = Progress;
// Cache dbtable "synth", row synth_halloween2025: its hw25_chair_spin_* sounds.
const SYNTH_ROW = "synth_halloween2025", CHAIR_SPIN_PREFIX = "hw25_chair_spin_";
// Wiki Spooky chair: a dropped chair returns after 20 ticks.
const CHAIR_RETURN_TICKS = 20;
const CHAIR_FOLLOWER = "hw25_chair_npc_reward";
const followers = new Map();
let qualifying, spinSounds;

function chairSpinSounds(api) {
  if (spinSounds) return spinSounds;
  const cache = api.core.CacheDefinitions, table = cache.getDbTableId("synth"), row = cache.getDbRow(cache.getDbRowId(SYNTH_ROW));
  const values = row?.column(cache.getDbColumn(table, "synth")) ?? [];
  spinSounds = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    if (String(values[index]).startsWith(CHAIR_SPIN_PREFIX) && Number.isInteger(values[index + 1])) spinSounds.push(values[index + 1]);
  }
  return spinSounds;
}

function ids(api, symbols) {
  return symbols.map(symbol => api.core.CacheDefinitions.getObjId(symbol)).filter(id => id !== null);
}

/**
 * Halloween items for the contest: every Halloween event reward Diango returns
 * (Wiki Event rewards, Halloween section) except the 2024 cosmetics, which the
 * Wiki says did not count, plus the original halloween masks and this year's
 * outfit. The spooky pumpkin lantern is its own requirement and never counts.
 */
function qualifyingIds(api) {
  if (qualifying) return qualifying;
  const excluded = new Set(scene.excludedFromContest);
  qualifying = new Set(ids(api, [
    ...scene.previousRewards.filter(symbol => !excluded.has(symbol)),
    ...scene.eventRewards.filter(symbol => symbol !== Progress.LANTERN),
    ...scene.extraHalloweenItems,
  ]));
  return qualifying;
}

function wornHalloweenItems(api, player) {
  const allowed = qualifyingIds(api), lantern = Progress.itemId(api, Progress.LANTERN);
  return player.getEquipment().getItems().filter(item => item && item.getId() !== lantern && allowed.has(item.getId())).length;
}

function lanternEquipped(api, player) {
  const id = Progress.itemId(api, Progress.LANTERN);
  return id !== null && player.getEquipment().getAmount(id) > 0;
}

/** Fred takes the four decorations in one step, or nothing changes. */
function handOver(api, player) {
  const state = Progress.read(player), inventory = player.getInventory();
  if (state.stage !== STAGE.COLLECTING || !Progress.acquiredAll(state)) return false;
  const slots = Object.values(Progress.DECORATIONS).map(symbol => inventory.getSlotForItemId(Progress.itemId(api, symbol)));
  if (slots.some(slot => slot < 0)) return false;
  for (const slot of slots) inventory.deleteAtSlot(slot, 1);
  inventory.refreshItems();
  return Progress.update(api, player, next => next.stage === STAGE.COLLECTING && (next.stage = STAGE.DECORATED, true));
}

function message(Dialogue, player, stepId) { player.sendMessage(Dialogue.messageText(stepId)); }

/** Pick-up on a Draynor Manor event chair (transcript "spooky-chair-picking-up-the-chair"). */
function pickUpChair(api, Dialogue, player) {
  const state = Progress.read(player);
  if (state.stage < STAGE.STARTED || state.stage >= STAGE.DECORATED) return message(Dialogue, player, "2hz1NR");
  const chair = Progress.DECORATIONS.chair;
  if (Progress.owns(api, player, chair)) {
    const query = { player, mode: "none" };
    api.emitCustomEvent("ironman:mode", query);
    return message(Dialogue, player, query.mode === "none" ? "s8niQE" : "9h2mgV");
  }
  const id = Progress.itemId(api, chair), item = new api.core.Item(id, 1);
  if (player.getInventory().getAddableAmount(item) !== 1) return message(Dialogue, player, "KqGSGn");
  player.getInventory().add(item);
  Progress.update(api, player, next => (next.chair = true));
  if (Progress.acquiredAll(Progress.read(player))) message(Dialogue, player, "F3cqXu");
  message(Dialogue, player, "hbku16");
}

/** While the event runs, Fred still needs the chair: Drop and Spin are refused. */
function chairLocked(Dialogue, player) {
  if (!Dialogue.active() || Progress.read(player).stage >= STAGE.COMPLETE) return false;
  message(Dialogue, player, "Xi5-AB");
  return true;
}

function spinChair(api, Dialogue, { player }) {
  if (chairLocked(Dialogue, player)) return;
  const sounds = chairSpinSounds(api);
  if (sounds.length) player.getPacketSender().sendSound(sounds[Math.floor(Math.random() * sounds.length)], 1, 0);
}

function returnChair(api, player) {
  const record = followers.get(player);
  if (!record) return;
  followers.delete(player);
  api.core.TaskManager.cancelTasks(record);
  if (record.npc.isRegistered()) api.removeNpc(record.npc);
  if (!player.isRegistered()) return;
  // Diango may have handed out another chair meanwhile: one chair, as the Wiki says
  // a player keeps when dropping several.
  if (Progress.owns(api, player, Progress.DECORATIONS.chair)) return;
  const item = new api.core.Item(record.itemId, 1);
  if (player.getInventory().getAddableAmount(item) === 1) {
    player.getInventory().add(item);
    player.sendMessage("The spooky chair makes its way back to you.");
  } else {
    // Wiki: it goes back to Diango; keep it retrievable there.
    api.emitCustomEvent("holiday-rewards:unlock", { player, items: [Progress.DECORATIONS.chair] });
    player.sendMessage("The spooky chair doesn't feel wanted and returns to Diango in Draynor Village.");
  }
}

/** Drop sends the chair after its owner as a follower, then back to the inventory. */
function dropChair(api, Dialogue, event) {
  const { player } = event;
  event.handled = true;
  if (chairLocked(Dialogue, player) || followers.has(player)) return;
  const c = api.core, itemId = Progress.itemId(api, Progress.DECORATIONS.chair), slot = event.slot ?? player.getInventory().getSlotForItemId(itemId);
  const npcId = c.CacheDefinitions.getNpcId(CHAIR_FOLLOWER);
  if (npcId === null || slot < 0 || player.getInventory().getItems()[slot]?.getId() !== itemId) return;
  const at = player.getLocation();
  const npc = api.spawnNpc({ id: npcId, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, owner: player });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  player.getInventory().deleteAtSlot(slot, 1);
  player.getInventory().refreshItems();
  npc.setFollowing(player);
  const record = { npc, itemId };
  followers.set(player, record);
  c.TaskManager.submit(new (class ChairReturn extends c.Task {
    constructor() { super(CHAIR_RETURN_TICKS, record, false); }
    execute() { this.stop(); returnChair(api, player); }
  })());
}

function logout(api, { player }) {
  // A logged-out owner keeps the chair: put it straight back without a follower.
  const record = followers.get(player);
  if (!record) return;
  followers.delete(player);
  api.core.TaskManager.cancelTasks(record);
  if (record.npc.isRegistered()) api.removeNpc(record.npc);
  if (Progress.owns(api, player, Progress.DECORATIONS.chair)) return;
  const item = new api.core.Item(record.itemId, 1);
  if (player.getInventory().getAddableAmount(item) === 1) player.getInventory().add(item);
  else api.emitCustomEvent("holiday-rewards:unlock", { player, items: [Progress.DECORATIONS.chair] });
}

module.exports = { qualifyingIds, wornHalloweenItems, lanternEquipped, handOver, pickUpChair, spinChair, dropChair, logout, chairSpinSounds, CHAIR_RETURN_TICKS };
