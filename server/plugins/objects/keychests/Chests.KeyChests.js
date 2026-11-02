"use strict";

/**
 * Opening a chest with its key (Open/Unlock, or the key used on it) and Check. The order is
 * the rsprox captures' (docs/key-chests.md), from the tick the player arrives:
 *
 * - Crystal, brimstone and Elven chests: the open-chest animation, sound 2402 and "You unlock
 *   the chest with your key."; a tick later the key goes, the loot comes with "You find some
 *   treasure in the chest!" and the chest shows open (a varbit, or the Taverley chest's open loc
 *   for everyone); a tick after that it closes, with the opened count (the Elven chest says its
 *   count with the loot).
 * - Larran's chests: the pick-up animation and sound 1227; a tick later sound 52, the key goes
 *   and the chest opens; then sound 51, the loot, the count, and the chest closes.
 */
const Data = require("./Data.KeyChests");
const Loot = require("./Loot.KeyChests");

/** Set while a chest opens, so a second click can't open it twice with one key. */
const OPENING_ATTRIBUTE = "key-chests:opening";
/** How many times each chest has been opened, by chest key in key-chests.json. */
const OPENED_ATTRIBUTES = {
  brimstone: "key-chests:brimstone-opened",
  larranSmall: "key-chests:larran-small-opened",
  larranBig: "key-chests:larran-big-opened",
  elven: "key-chests:elven-opened",
};
const OPEN_CHEST_SOUND = 2402;
const SLAYER_CHEST_SOUNDS = { start: 1227, unlock: 52, loot: 51 };
const SLAYER_CHEST_START_DELAY = 5;

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function later(ticks, action) {
  core.TaskManager.submit(new core.CountdownTask({}, ticks, action));
}

function opened(chest, player) {
  return Math.max(0, Number(player.getAttribute(OPENED_ATTRIBUTES[chest.key])) || 0);
}

function countMessage(chest, player) {
  const count = opened(chest, player);
  return chest.count.message.replace("{count}", count === 1 ? "once" : `${count.toLocaleString("en-US")} times`);
}

function animate(player, seq) {
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(seq)));
}

function setOpen(chest, player, object, open) {
  if (chest.varbitId != null) {
    player.getPacketSender().sendVarbit(chest.varbitId, open ? 1 : 0);
    return;
  }
  const id = open ? chest.openLocId : chest.locId;
  core.ObjectManager.register(new core.GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
}

/** Takes the key and gives the loot; false when the key is gone. */
function unlock(chest, player) {
  if (!player.getInventory().contains(chest.keyId)) return false;
  player.getInventory().deleteNumber(chest.keyId, 1);
  const drops = Loot.roll(chest, player.getSkillManager().getMaxLevel(core.Skill.FISHING));
  Loot.give(player, drops);
  for (const { itemId, amount } of drops) api.emitCustomEvent("collection-log:obtain", { player, itemId, amount });
  if (chest.count) player.setAttribute(OPENED_ATTRIBUTES[chest.key], opened(chest, player) + 1);
  if (chest.diaryTask) api.emitCustomEvent("diary:task", { player, ...chest.diaryTask });
  // "chests:opened" { player, chest }: a key chest opened, by its name (a league's "Open the Crystal Chest").
  api.emitCustomEvent("chests:opened", { player, chest: chest.name });
  return true;
}

function finish(player) {
  player.setAttribute(OPENING_ATTRIBUTE, false);
}

function openChest(chest, player, object) {
  if (player.getAttribute(OPENING_ATTRIBUTE)) return;
  if (!player.getInventory().contains(chest.keyId)) {
    if (chest.lockedSound) player.getPacketSender().sendSound(OPEN_CHEST_SOUND, 1, 0);
    player.sendMessage(chest.locked);
    return;
  }
  player.setAttribute(OPENING_ATTRIBUTE, true);
  if (chest.slayerChest) openSlayerChest(chest, player, object);
  else openTreasureChest(chest, player, object);
}

function openTreasureChest(chest, player, object) {
  animate(player, "human_openchest");
  player.getPacketSender().sendSound(OPEN_CHEST_SOUND, 1, 0);
  player.sendMessage("You unlock the chest with your key.");
  later(1, () => {
    if (!unlock(chest, player)) return finish(player);
    player.sendMessage("You find some treasure in the chest!");
    if (chest.count && chest.countWithLoot) player.sendMessage(countMessage(chest, player));
    setOpen(chest, player, object, true);
    later(1, () => {
      setOpen(chest, player, object, false);
      if (chest.count && !chest.countWithLoot) player.sendMessage(countMessage(chest, player));
      finish(player);
    });
  });
}

function openSlayerChest(chest, player, object) {
  animate(player, "human_pickuptable");
  player.getPacketSender().sendSound(SLAYER_CHEST_SOUNDS.start, 1, SLAYER_CHEST_START_DELAY);
  later(1, () => {
    if (!player.getInventory().contains(chest.keyId)) return finish(player);
    player.getPacketSender().sendSound(SLAYER_CHEST_SOUNDS.unlock, 1, 0);
    setOpen(chest, player, object, true);
    later(1, () => {
      player.getPacketSender().sendSound(SLAYER_CHEST_SOUNDS.loot, 1, 0);
      if (unlock(chest, player)) player.sendMessage(countMessage(chest, player));
      setOpen(chest, player, object, false);
      finish(player);
    });
  });
}

/** The chest this interaction is on (the Taverley chest shares its name, "Closed chest"). */
function chestFor(event) {
  const name = (event.definition ?? core.ObjectDefinition.forPlayer(event.objectId, event.player))?.getName?.();
  return Data.get().chests.find((chest) => chest.name === name || chest.locId === event.objectId) ?? null;
}

function open(event) {
  const chest = chestFor(event);
  if (!chest || (chest.openLocId != null && event.objectId !== chest.locId)) return false;
  openChest(chest, event.player, event.object);
}

function check(event) {
  const chest = chestFor(event);
  if (!chest?.count) return false;
  event.player.sendMessage(countMessage(chest, event.player));
}

/** A key used on its chest opens it; any other item falls through. */
function useKey(event) {
  const chest = chestFor(event);
  if (!chest || event.itemId !== chest.keyId) return false;
  return open(event);
}

/** [object name, the option that opens it]. */
const CHEST_OPTIONS = [
  ["Closed chest", "Open"],
  ["Brimstone chest", "Unlock"],
  ["Larran's small chest", "Unlock"],
  ["Larran's big chest", "Unlock"],
  ["Elven Crystal Chest", "Open"],
];
const KEYS = [
  ["Crystal key", "Closed chest"],
  ["Brimstone key", "Brimstone chest"],
  ["Larran's key", "Larran's small chest"],
  ["Larran's key", "Larran's big chest"],
  ["Enhanced crystal key", "Elven Crystal Chest"],
];

function attach(pluginApi) {
  for (const [name, option] of CHEST_OPTIONS) pluginApi.onObjectInteraction(name, { [option]: open, Check: check });
  for (const [key, chest] of KEYS) pluginApi.onItemOnObject(key, chest, useKey);
  for (const attribute of Object.values(OPENED_ATTRIBUTES)) pluginApi.persistAttribute(attribute, 0);
}

module.exports = { init, attach, openChest, countMessage, OPENING_ATTRIBUTE, OPENED_ATTRIBUTES };
