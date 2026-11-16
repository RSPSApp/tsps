/**
 * Pete's retrieval, as recorded (rsprox 1858 T2710-T3511): a death in the mine leaves nothing in
 * a grave. The mine's own items are gone, and Pete keeps the rest ("Petrified Pete has retrieved
 * some of your items. You can collect them from him on Fossil Island."). Retrieve hands them back for
 * 150 Numulite ("Death charges you 150 x Numulite."). Dying in the mine again before collecting
 * loses the older lot, and so does any unsafe death elsewhere (Wiki).
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");

/** Ticks after the death for the line: once the player is back on their feet. */
const MESSAGE_TICKS = 8;

function stored(player) {
  const value = player.getAttribute(Common.data.attributes.stored);
  return Array.isArray(value) && value.length ? value : null;
}

function take(container) {
  const items = [];
  for (const item of container.getValidItems?.() ?? []) {
    if (item?.getId?.() > 0 && item.getAmount() > 0) {
      const meta = item.getMeta?.() ?? null;
      items.push(meta ? { id: item.getId(), amount: item.getAmount(), meta: JSON.parse(JSON.stringify(meta)) } : { id: item.getId(), amount: item.getAmount() });
    }
  }
  container.resetItems?.();
  container.refreshItems?.();
  return items;
}

/** A death in the mine: Pete takes everything the player had (the mine's own items are already gone). */
function beforeDeath(event) {
  const { player } = event;
  if (!Game.gameOf(player)) return;
  const items = [...take(player.getInventory()), ...take(player.getEquipment())];
  player.getUpdateFlag?.().flag?.(Common.core.Flag?.APPEARANCE);
  player.setAttribute(Common.data.attributes.stored, items.length ? items : null);
  // This death's own drop (two ticks on) must not count as the "later" death that loses it.
  player.__volcanicMineStoring = true;
  if (items.length) Common.later(MESSAGE_TICKS, () => player.sendMessage(Common.message("retrieved")));
}

/** An unsafe death outside the mine loses what Pete holds (safe deaths drop nothing, so keep it). */
function deathDrops(event) {
  const { player } = event;
  if (player.__volcanicMineStoring) {
    player.__volcanicMineStoring = false;
    return;
  }
  if (Game.gameOf(player)) return;
  if (stored(player)) player.setAttribute(Common.data.attributes.stored, null);
}

/** Retrieve (Pete's op 5, or asking him): 150 Numulite from the pack, else from what he holds. */
function retrieve(player) {
  const { data } = Common;
  const items = stored(player);
  if (!items) {
    Common.chat(player, [["npc", Common.message("nothingStored")]]);
    return;
  }
  const { fee } = data.retrieval;
  const inventory = player.getInventory();
  const held = items.find((item) => item.id === data.items.numulite)?.amount ?? 0;
  if (inventory.getAmount(data.items.numulite) + held < fee) {
    Common.itemBox(player, data.items.numulite, Common.message("retrieveTooPoor"));
    return;
  }
  let owed = fee;
  const fromPack = Math.min(owed, inventory.getAmount(data.items.numulite));
  if (fromPack > 0) inventory.delete(data.items.numulite, fromPack);
  owed -= fromPack;
  const back = items.map((item) => ({ ...item }));
  if (owed > 0) {
    const numulite = back.find((item) => item.id === data.items.numulite);
    numulite.amount -= owed;
  }
  player.setAttribute(data.attributes.stored, null);
  player.sendMessage(Common.message("retrieveCharged"));
  const { Item, ItemOnGroundManager } = Common.core;
  for (const { id, amount, meta } of back) {
    if (amount <= 0) continue;
    const item = new Item(id, amount, meta ?? null);
    if (inventory.getAddableAmount(item) >= amount) inventory.add(item, true);
    else ItemOnGroundManager.registers(player, item);
  }
}

function retrieveItems({ player }) {
  retrieve(player);
  return true;
}

/**
 * "group-ironman:wipe-tradeables" { player, lost(id, amount) }: a leaver who stays a ranked Group
 * Ironman loses what Pete holds that they lose (Wiki, Group Ironman Mode: "Items in an Item
 * Retrieval Service").
 */
function wipeForGroupIronman({ player, lost }) {
  const items = stored(player);
  if (!items || typeof lost !== "function") return;
  const left = items.filter((item) => !lost(item.id, item.amount));
  if (left.length !== items.length) player.setAttribute(Common.data.attributes.stored, left.length ? left : null);
}

function attachRetrieval(api) {
  api.persistAttribute(Common.data.attributes.stored);
  api.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
  api.onPlayerBeforeDeath(beforeDeath);
  api.onPlayerDeathDrops(deathDrops);
  api.onNpcClick(Common.data.npcs.pete, 5, retrieveItems);
}

module.exports = { attachRetrieval, retrieve, beforeDeath, deathDrops, stored, wipeForGroupIronman };
