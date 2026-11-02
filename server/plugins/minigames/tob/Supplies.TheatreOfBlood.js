"use strict";

/**
 * The supply chests after the Pestilent Bloat and Sotetseg, and their interface (405).
 *
 * Wiki ("Chest (Theatre of Blood)"): the chest is opened, then searched; supplies are bought
 * with points, which carry over to the second chest; one stamina potion per chest; a player
 * who died in both rooms since the last chest gets only an onion.
 * Cache: enum 1952 lists the stock by slot and enum 1953 their costs (the Wiki's prices);
 * script 2346 shows varbit 6460 as "Points Available" and offers Value, Buy-1, Buy-<last
 * amount> (varbit 12272), Buy-All, Buy-X and Examine.
 * Not captured (our wording): "You open the chest. It glimmers with rewards inside." and the
 * buy messages.
 * Entry Mode (Wiki, Bandages (Theatre of Blood), Theatre of Blood/Entry Mode): the chest holds ten
 * bandages for the player, not carried over; each wipe also hands the team three. A bandage heals 20
 * and 20% run energy, restores prayer (the Wiki's "variable amount": our amount is a super restore's
 * less a little), cures poison, gives a stamina potion's effect and boosts Attack, Strength and
 * Defence by 15% + 4, Ranged by 10% + 4 and Magic by 4. Hard Mode's points are fewer: Wiki gives "an
 * average of 15", "the highest is 18", by Sotetseg, so a band lower here (fitted to those two).
 */

const Shared = require("./Shared.TheatreOfBlood");
const Raid = require("./RaidState.TheatreOfBlood");

const { OBJECT, INTERFACE, VARBIT } = Shared;

/** Enum 1952 (slot -> item) and 1953 (item -> cost). */
const STOCK = [
  { id: 12625, cost: 1 }, // Stamina potion(4): one per chest
  { id: 2434, cost: 2 }, // Prayer potion(4)
  { id: 6685, cost: 3 }, // Saradomin brew(4)
  { id: 3024, cost: 3 }, // Super restore(4)
  { id: 7058, cost: 1 }, // Mushroom potato
  { id: 385, cost: 1 }, // Shark
  { id: 397, cost: 2 }, // Sea turtle
  { id: 391, cost: 2 }, // Manta ray
];
const STAMINA = 12625;
const ONION = 1957;
const ITEMS_UID = (INTERFACE.SUPPLIES << 16) | 8;
const OPS = { VALUE: 1, BUY_ONE: 2, BUY_LAST: 3, BUY_ALL: 4, BUY_X: 5, EXAMINE: 10 };
const FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 10);
const BANDAGES_PER_CHEST = 10;
const BANDAGES_PER_WIPE = 3;
const BANDAGE = { HEAL: 20, RUN: 20, STAMINA_MS: 120_000 };

function memberOf(player) {
  const raid = Raid.raidOf(player);
  return raid ? raid.member(player) : null;
}

function chestRoom(player) {
  const raid = Raid.raidOf(player);
  const room = raid?.room;
  return room?.supplyChest && raid.member(player).roomKey === room.key ? room : null;
}

/** Open: the chest swings open for the party. */
function openChest(event) {
  const room = chestRoom(event.player);
  if (!room) return false;
  // Shut until the room is won (it opens by itself then).
  if (!room.isCompleted()) return true;
  const { ObjectManager } = Shared.core();
  const closed = room.supplyChest;
  if (closed.getId() === OBJECT.SUPPLY_CHEST) {
    ObjectManager.deregister(closed, true);
    room.objects = room.objects.filter((object) => object !== closed);
    const tile = { x: closed.getLocation().getX(), y: closed.getLocation().getY(), z: closed.getLocation().getZ() };
    room.supplyChest = room.placeObject(OBJECT.SUPPLY_CHEST_OPEN, tile, closed.getType(), closed.getFace());
  }
  event.player.sendMessage("You open the chest. It glimmers with rewards inside.");
  return true;
}

/** Search: the supplies, or the onion for someone who died in both rooms. */
function searchChest(event) {
  const { player } = event;
  const room = chestRoom(player);
  if (!room) return false;
  const member = memberOf(player);
  if (room.raid.isEntry) {
    takeBandages(player, member, room);
    return true;
  }
  if (member.onion) {
    member.onion = false;
    giveOne(player, ONION);
    return true;
  }
  openSupplies(player);
  return true;
}

/** Each player's own ten, per chest. */
function takeBandages(player, member, room) {
  const taken = (member.bandagesTaken ??= {});
  let left = BANDAGES_PER_CHEST - (taken[room.key] ?? 0);
  let given = 0;
  while (left > 0 && giveOne(player, Shared.ITEM.BANDAGES)) {
    left--;
    given++;
  }
  taken[room.key] = BANDAGES_PER_CHEST - left;
  player.sendMessage(given > 0 ? `You take ${given} bandage${given === 1 ? "" : "s"}.` : "The chest is empty, or your inventory is full.");
}

function entryWipe({ player }) {
  for (let i = 0; i < BANDAGES_PER_WIPE; i++) if (!giveOne(player, Shared.ITEM.BANDAGES)) break;
}

/** Heal: as a shark, prayer, stamina, super combat and ranging potion at once. */
function useBandage(event) {
  const { player, itemId } = event;
  if (itemId !== Shared.ITEM.BANDAGES) return false;
  const { Skill } = Shared.core();
  const inventory = player.getInventory();
  if (!inventory.contains(Shared.ITEM.BANDAGES)) return true;
  inventory.delete(Shared.ITEM.BANDAGES, 1);
  const skills = player.getSkillManager();
  player.heal(BANDAGE.HEAL);
  player.setRunEnergy(Math.min(100, player.getRunEnergy() + BANDAGE.RUN));
  const prayer = skills.getMaxLevel(Skill.PRAYER);
  skills.setCurrentLevel(Skill.PRAYER, Math.min(prayer, skills.getCurrentLevel(Skill.PRAYER) + Math.floor(prayer / 4) + 7), true);
  const boost = (skill, amount) => {
    const max = skills.getMaxLevel(skill) + amount;
    skills.setCurrentLevel(skill, Math.min(max, Math.max(skills.getCurrentLevel(skill), skills.getMaxLevel(skill)) + amount), true);
  };
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) boost(skill, Math.floor(skills.getMaxLevel(skill) * 0.15) + 4);
  boost(Skill.RANGED, Math.floor(skills.getMaxLevel(Skill.RANGED) * 0.1) + 4);
  boost(Skill.MAGIC, 4);
  player.setPoisonDamage?.(0);
  Shared.api().emitCustomEvent("potions:apply-stamina", { player, durationMs: BANDAGE.STAMINA_MS });
  return true;
}

function openSupplies(player) {
  const member = memberOf(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT.SUPPLY_POINTS, member.supplyPoints);
  sender.sendVarbit(VARBIT.SUPPLY_STAMINA_BOUGHT, member.staminaBought ? 1 : 0);
  sender.sendInterface(INTERFACE.SUPPLIES);
  sender.sendInterfaceFlagsRange(ITEMS_UID, 0, STOCK.length - 1, FLAGS);
}

function giveOne(player, id) {
  const { Item } = Shared.core();
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) return false;
  inventory.add(new Item(id, 1), false);
  inventory.refreshItems();
  return true;
}

function nameOf(id) {
  return Shared.core().ItemDefinition.forId(id)?.getName?.() ?? "That";
}

/** Buys up to `amount`, one at a time while points and space last. */
function buy(player, entry, amount) {
  const member = memberOf(player);
  if (!member || amount < 1) return;
  if (entry.id === STAMINA) {
    if (member.staminaBought) {
      player.sendMessage("This item is out of stock.");
      return;
    }
    amount = 1;
  }
  if (amount * entry.cost > member.supplyPoints) {
    if (member.supplyPoints < entry.cost) {
      player.sendMessage(`You don't have enough points to buy ${amount === 1 ? "a" : amount} ${nameOf(entry.id)}.`);
      return;
    }
    amount = Math.floor(member.supplyPoints / entry.cost);
  }
  for (let i = 0; i < amount; i++) {
    if (!giveOne(player, entry.id)) {
      player.sendMessage("You don't have enough space in your inventory to purchase this item.");
      break;
    }
    member.supplyPoints -= entry.cost;
    Shared.api().emitCustomEvent("tob:supplies-bought", { raid: Raid.raidOf(player), player });
    Shared.api().emitCustomEvent("persistence:save", { player, reason: "reward-shop" });
    if (entry.id === STAMINA) member.staminaBought = true;
  }
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT.SUPPLY_POINTS, member.supplyPoints);
  sender.sendVarbit(VARBIT.SUPPLY_STAMINA_BOUGHT, member.staminaBought ? 1 : 0);
}

function clickSupply(event) {
  const { player } = event;
  const member = memberOf(player);
  const entry = STOCK[Number.isInteger(event.slot) ? event.slot : -1];
  if (!member || !entry) return;
  const op = event.opId ?? event.action;
  const sender = player.getPacketSender();
  if (op === OPS.VALUE) {
    const color = member.supplyPoints >= entry.cost ? "00ff00" : "ff0000";
    player.sendMessage(`${nameOf(entry.id)} costs <col=${color}>${entry.cost} point${entry.cost === 1 ? "" : "s"}</col>.`);
  } else if (op === OPS.BUY_ONE) {
    buy(player, entry, 1);
  } else if (op === OPS.BUY_LAST) {
    buy(player, entry, Math.max(1, sender.getVarbit?.(VARBIT.SUPPLY_LAST_AMOUNT) ?? 1));
  } else if (op === OPS.BUY_ALL) {
    buy(player, entry, Math.floor(member.supplyPoints / entry.cost));
  } else if (op === OPS.BUY_X) {
    player.setEnteredAmountAction({
      execute: (value) => {
        const amount = Math.max(0, value | 0);
        sender.sendVarbit(VARBIT.SUPPLY_LAST_AMOUNT, amount);
        buy(player, entry, amount);
      },
    });
    sender.sendEnterAmountPrompt("Enter amount:");
  } else if (op === OPS.EXAMINE) {
    player.sendMessage(Shared.core().ItemDefinition.forId(entry.id)?.getExamine?.() ?? nameOf(entry.id));
  }
}

module.exports = function registerTheatreSupplies(api) {
  Shared.bind(api);
  Shared.onObject(api, OBJECT.SUPPLY_CHEST, openChest);
  Shared.onObject(api, OBJECT.SUPPLY_CHEST_OPEN, searchChest);
  api.onInterfaceActionButton(ITEMS_UID, clickSupply);
  api.onItemAction("Bandages", { Heal: useBandage });
  api.onCustomEvent("tob:entry-wipe", entryWipe);
};

Object.assign(module.exports, { STOCK, ONION, openChest, searchChest, clickSupply, buy, takeBandages, entryWipe, useBandage, BANDAGES_PER_CHEST, BANDAGES_PER_WIPE });
