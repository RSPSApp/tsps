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
 * - The Zombie Pirate's Locker: the open-chest animation and sound 58; a tick later the key goes
 *   and the locker shows open for everyone; a tick after that the animation again; then sound 51,
 *   the loot with its line, the count and any valuable-drop line, and the locker closes. It needs
 *   two free inventory slots.
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
  grubby: "key-chests:grubby-opened",
  zombiePirateLocker: "key-chests:zombie-pirate-locker-opened",
};
/** The Grubby Chest's "Open anyway (do not show this again)" choice. */
const GRUBBY_WARNING_OFF_ATTRIBUTE = "key-chests:grubby-warning-off";
const OPEN_CHEST_SOUND = 2402;
const SLAYER_CHEST_SOUNDS = { start: 1227, unlock: 52, loot: 51 };
const SLAYER_CHEST_START_DELAY = 5;
const LOCKER_SOUNDS = { open: 58, loot: 51 };
/** Slot 2 of the equipment: the amulet of avarice notes a locker's loot (not its pre-roll). */
const AMULET_SLOT = 2;
const AMULET_OF_AVARICE = "wild_cave_amulet";

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
  const colour = chest.count.colour;
  const times = count === 1 ? "once" : count.toLocaleString("en-US");
  const text = colour ? `<col=${colour}>${times}</col>` : times;
  return chest.count.message.replace("{count}", count === 1 ? text : `${text} times`);
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

/** Takes one key; false when it is gone. */
function takeKey(chest, player) {
  if (!player.getInventory().contains(chest.keyId)) return false;
  player.getInventory().deleteNumber(chest.keyId, 1);
  return true;
}

function wearsAvarice(player) {
  const amulet = player.getEquipment?.()?.getItems?.()[AMULET_SLOT]?.getId?.();
  return amulet != null && amulet === core.CacheDefinitions.getObjId(AMULET_OF_AVARICE);
}

/** Rolls and gives the loot, counts the open and tells the listeners. */
function reward(chest, player) {
  const rules = [];
  // "drops:chance" { player, source, rules }: a league's boosted drops for this chest's pre-rolls.
  if (chest.loot.preRolls.length) api.emitCustomEvent("drops:chance", { player, source: chest.name, rules });
  const drops = Loot.roll(chest, player.getSkillManager().getMaxLevel(core.Skill.FISHING), Math.random, rules);
  if (chest.avariceNotes && wearsAvarice(player)) for (const entry of drops) if (!entry.preRoll) entry.noted = true;
  Loot.give(player, drops);
  for (const { itemId, amount } of drops) api.emitCustomEvent("collection-log:obtain", { player, itemId, amount });
  if (chest.count) player.setAttribute(OPENED_ATTRIBUTES[chest.key], opened(chest, player) + 1);
  if (chest.diaryTask) api.emitCustomEvent("diary:task", { player, ...chest.diaryTask });
  // "chests:opened" { player, chest }: a key chest opened, by its name (a league's "Open the Crystal Chest").
  api.emitCustomEvent("chests:opened", { player, chest: chest.name });
  return drops;
}

/** Takes the key and gives the loot; null when the key is gone. */
function unlock(chest, player) {
  return takeKey(chest, player) ? reward(chest, player) : null;
}

/**
 * The Grubby Chest's picture box. Wiki Transcript:Grubby Chest: a shark and red dragonhide,
 * or the orange and blue egg sacs when an egg sac came up (the data's two pictures each).
 */
function showItemBox(chest, player, drops) {
  const bonus = drops.find((entry) => entry.bonus);
  const { DialogueChainBuilder, ItemStatementDialogue, DoubleItemStatementDialogue, EndDialogue } = core;
  const text = bonus ? chest.itemBox.bonus : chest.itemBox.plain;
  const pictures = (bonus ? chest.itemBox.bonusItems : chest.itemBox.plainItems)?.map((name) => core.CacheDefinitions.getObjId(name));
  const box = pictures?.length === 2 && pictures.every((id) => id != null)
    ? new DoubleItemStatementDialogue(0, pictures[0], pictures[1], text)
    : new ItemStatementDialogue(0, (bonus ?? drops[0]).itemId, text);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(box, new EndDialogue(1)));
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
  if (chest.freeSlots && player.getInventory().getFreeSlots() < chest.freeSlots.needs) {
    player.sendMessage(chest.freeSlots.message);
    return;
  }
  const warn = chest.warnSlots != null && player.getInventory().getFreeSlots() < chest.warnSlots && !player.getAttribute(GRUBBY_WARNING_OFF_ATTRIBUTE);
  if (warn) return warnLowSpace(chest, player, object);
  beginOpening(chest, player, object);
}

function beginOpening(chest, player, object) {
  if (player.getAttribute(OPENING_ATTRIBUTE)) return;
  player.setAttribute(OPENING_ATTRIBUTE, true);
  if (chest.slayerChest) openSlayerChest(chest, player, object);
  else if (chest.locker) openLocker(chest, player, object);
  else openTreasureChest(chest, player, object);
}

/** Wiki Transcript:Grubby Chest: under 11 free slots, a choice; what won't fit drops to the floor. */
function warnLowSpace(chest, player, object) {
  const open = () => beginOpening(chest, player, object);
  const openAndSilence = () => {
    player.setAttribute(GRUBBY_WARNING_OFF_ATTRIBUTE, true);
    open();
  };
  api.sendMultiChatboxPrompt(
    player,
    `You do require at least ${chest.warnSlots} spaces in your inventory to loot this chest.<br><col=ff0000>Any items you cannot hold will be dropped to the floor.</col>`,
    "Open anyway", open,
    "Open anyway (do not show this again)", openAndSilence,
    "Do not open", () => {},
  );
}

function openTreasureChest(chest, player, object) {
  animate(player, "human_openchest");
  player.getPacketSender().sendSound(OPEN_CHEST_SOUND, 1, 0);
  if (!chest.itemBox) player.sendMessage("You unlock the chest with your key.");
  later(1, () => {
    const drops = unlock(chest, player);
    if (!drops) return finish(player);
    if (chest.itemBox) showItemBox(chest, player, drops);
    else player.sendMessage("You find some treasure in the chest!");
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

/** "You loot the locker and receive 4 x Blighted super restore(4)." */
function lootMessage(chest, drops) {
  const loot = drops.map(({ itemId, amount }) => `${amount.toLocaleString("en-US")} x ${core.ItemDefinition.forId(itemId).getName()}`).join(", ");
  return chest.lootMessage.replace("{loot}", loot);
}

function openLocker(chest, player, object) {
  const sounds = player.getPacketSender();
  animate(player, "human_openchest");
  sounds.sendSound(LOCKER_SOUNDS.open, 1, 0);
  later(1, () => {
    if (!takeKey(chest, player)) return finish(player);
    setOpen(chest, player, object, true);
    later(1, () => {
      animate(player, "human_openchest");
      later(1, () => {
        sounds.sendSound(LOCKER_SOUNDS.loot, 1, 0);
        const drops = reward(chest, player);
        player.sendMessage(lootMessage(chest, drops));
        player.sendMessage(countMessage(chest, player));
        // "drops:received" { player, source, drops }: loot given by something other than a kill (the loot notifications).
        api.emitCustomEvent("drops:received", { player, source: chest.name, drops });
        setOpen(chest, player, object, false);
        finish(player);
      });
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
  ["Grubby Chest", "Open"],
  ["Zombie Pirate's Locker", "Open"],
];
const KEYS = [
  ["Crystal key", "Closed chest"],
  ["Brimstone key", "Brimstone chest"],
  ["Larran's key", "Larran's small chest"],
  ["Larran's key", "Larran's big chest"],
  ["Enhanced crystal key", "Elven Crystal Chest"],
  ["Grubby key", "Grubby Chest"],
  ["Zombie pirate key", "Zombie Pirate's Locker"],
];

function attach(pluginApi) {
  for (const [name, option] of CHEST_OPTIONS) pluginApi.onObjectInteraction(name, { [option]: open, Check: check });
  for (const [key, chest] of KEYS) pluginApi.onItemOnObject(key, chest, useKey);
  for (const attribute of Object.values(OPENED_ATTRIBUTES)) pluginApi.persistAttribute(attribute, 0);
  pluginApi.persistAttribute(GRUBBY_WARNING_OFF_ATTRIBUTE, false);
}

module.exports = { init, attach, openChest, countMessage, lootMessage, showItemBox, OPENING_ATTRIBUTE, OPENED_ATTRIBUTES };
