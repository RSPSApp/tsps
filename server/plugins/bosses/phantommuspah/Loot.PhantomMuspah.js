/**
 * The Phantom Muspah's kill and loot (docs/phantom-muspah.md):
 * - Five ticks into its death (captured): "Your Phantom Muspah kill count is: N." (varp
 *   total_muspah_kills), the fight's length against the personal best, and the loot (its Wiki
 *   table in npc-drops.json) on its centre tile.
 * - Charged ice, for a kill under 3:00 when the player has none (Wiki), with the untradeable-drop
 *   message (captured).
 * - A Venator shard comes with no other main-table loot (Wiki).
 * - The frozen cache opens into its own Wiki table (pre-roll 1/50: another cache, an Ancient icon
 *   or a Venator shard).
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.PhantomMuspah");
const Scoreboard = require("./Scoreboard.PhantomMuspah");
const BOSS_NAME = "Phantom Muspah";

const UNTRADEABLE_DROP = (name) => `<col=ef1020>Untradeable drop: ${name}</col>`;

/** A fight's length as the Muspah's messages print it: m:ss.SS. */
function formatTicks(ticks) {
  const seconds = ticks * 0.6;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function onMuspahDeath({ npc, killer }) {
  const fight = npc?.__muspahFight;
  if (!fight || fight.stopped) return;
  const player = fight.player;
  if (killer !== player) {
    fight.finished();
    return;
  }
  const kills = Common.count(player, Common.KILLS_ATTRIBUTE) + 1;
  player.setAttribute(Common.KILLS_ATTRIBUTE, kills);
  player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
  player.sendMessage(`Your Phantom Muspah kill count is: <col=ff0000>${kills}</col>.`);
  // From its appearance to this moment, five ticks into its death (captured: 108 ticks, 1:04.80).
  const ticks = Common.core.World.getProcessCycle() - fight.startCycle;
  const best = Common.count(player, Common.BEST_TICKS_ATTRIBUTE);
  if (!best || ticks < best) {
    player.setAttribute(Common.BEST_TICKS_ATTRIBUTE, ticks);
    Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col> (new personal best)`);
  } else {
    player.sendMessage(`Fight duration: <col=ff0000>${formatTicks(ticks)}</col>. Personal best: ${formatTicks(best)}`);
  }
  Scoreboard.won(ticks);
  fight.lootTicks = ticks;
  fight.finished();
}

/** The loot lands on the Muspah's centre tile (captured). */
function lootOnCentre(event) {
  const npc = event.npc;
  if (!npc?.__muspahFight) return;
  const centre = Math.floor(npc.getSize() / 2);
  event.location = npc.getLocation().clone().add(centre, centre);
}

function owns(player, itemId) {
  if (player.getInventory().getAmount(itemId) > 0) return true;
  return (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(itemId) > 0);
}

let mainTableIds = null;

/** The item ids of the Muspah's main table (rolled once per kill, not separately). */
function mainTable() {
  if (mainTableIds) return mainTableIds;
  const file = path.join(__dirname, "..", "..", "..", "data", "definitions", "npc-drops.json");
  const { tables } = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(tables) ? tables : Object.values(tables);
  const table = list.find((entry) => entry.table_id === "phantom_muspah");
  mainTableIds = new Set((table?.entries ?? []).filter((entry) => !entry.separate_roll && Number.isInteger(entry.item_id)).map((entry) => entry.item_id));
  return mainTableIds;
}

/** Charged ice for a quick kill, and nothing from the main table beside a Venator shard. */
function editDrops(event) {
  const fight = event.npc?.__muspahFight;
  if (!fight || !Array.isArray(event.drops)) return;
  const { ItemIdentifiers } = Common.core;
  const { player } = event;
  if (event.drops.some((drop) => drop.itemId === ItemIdentifiers.VENATOR_SHARD)) {
    const main = mainTable();
    for (let i = event.drops.length - 1; i >= 0; i--) {
      if (main.has(event.drops[i].itemId)) event.drops.splice(i, 1);
    }
  }
  const ticks = fight.lootTicks ?? Infinity;
  if (ticks < Common.data.kill.chargedIceTicks && !owns(player, ItemIdentifiers.CHARGED_ICE)) {
    event.drops.push({ itemId: ItemIdentifiers.CHARGED_ICE, amount: 1, noted: false });
    player.sendMessage(UNTRADEABLE_DROP("Charged ice"));
  }
}

// ------------------------------------------------------------------ the frozen cache

function weighted(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

/** One of the cache's rewards: [itemId, amount]. */
function rollCache() {
  const { frozenCache } = Common.data;
  const { ItemIdentifiers } = Common.core;
  const pre = frozenCache.preRoll;
  let roll = Math.floor(Math.random() * pre.outOf);
  for (const entry of pre.entries) {
    if (roll < entry.weight) return { itemId: ItemIdentifiers[entry.item], amount: 1 };
    roll -= entry.weight;
  }
  const entry = weighted(frozenCache.entries);
  if (entry.essence) {
    const [min, max, step] = weighted(entry.essence.map(([lo, hi, by, weight]) => ({ value: [lo, hi, by], weight }))).value;
    const amount = min + step * Common.randomInt(0, Math.floor((max - min) / step));
    return { itemId: ItemIdentifiers.ANCIENT_ESSENCE, amount };
  }
  return { itemId: ItemIdentifiers[entry.item], amount: entry.amount, noted: entry.noted === true };
}

/** The cache's own slot frees up, so its one reward always fits. */
function openCache({ player, itemId }) {
  const { ItemIdentifiers, ItemDefinition } = Common.core;
  if (itemId !== ItemIdentifiers.FROZEN_CACHE) return false;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.FROZEN_CACHE)) return true;
  inventory.delete(ItemIdentifiers.FROZEN_CACHE, 1);
  const reward = rollCache();
  let rewardId = reward.itemId;
  if (reward.noted) {
    const noteId = ItemDefinition.forId(rewardId).getNoteId();
    if (noteId >= 0) rewardId = noteId;
  }
  if (reward.itemId === ItemIdentifiers.FROZEN_CACHE) player.sendMessage(Common.data.frozenCache.anotherCache);
  inventory.adds(rewardId, reward.amount);
  inventory.refreshItems();
  return true;
}

function sendKillCount({ player }) {
  const kills = Common.count(player, Common.KILLS_ATTRIBUTE);
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.killCountVarp, kills);
}

/** Combat Achievements counts kills from before it, from the Muspah's own count. */
function answerKillCount(request) {
  if (!request?.player || !request.counts) return;
  const kills = Common.count(request.player, Common.KILLS_ATTRIBUTE);
  if (kills > (Number(request.counts["Phantom Muspah"]) || 0)) request.counts["Phantom Muspah"] = kills;
}

function attachLoot(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  api.onNpcDeath(onMuspahDeath);
  api.onCustomEvent("npc-drops:location", lootOnCentre);
  api.onCustomEvent("npc-drops:roll", editDrops);
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  api.onPlayerLogin(sendKillCount);
  api.onItemAction("Frozen cache", { Open: openCache });
}

module.exports = { attachLoot, formatTicks, rollCache };
