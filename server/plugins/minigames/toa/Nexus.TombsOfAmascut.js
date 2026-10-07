"use strict";

/**
 * The Nexus (main hall): choosing a path, path levels, the helpful spirit's supplies after the
 * second and fourth paths, and the way down to the Wardens once all four paths are done.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");
const Supplies = require("./Supplies.TombsOfAmascut");

const { INTERFACE, EVENT, PATHS, PATH_BY_KEY } = Shared;

const SUPPLY_SPIRIT_TILE = { x: 3548, y: 5154, z: 0 };
const ENTRANCE_SHAPE = 10;
const ENTRANCE_CLOSED = 1;
const ENTRANCE_COMPLETED = 2;
const WARDENS_OPEN = 1;

// Supply packs: inventory ids the shop interface draws, and its pack/take components.
const SUPPLY_INVENTORIES = [807, 808, 809];
const SUPPLY_BAG_INVENTORY = 810;
const SUPPLY_BAG_SIZE = 28;
const CHAOS_RARE_ONE_IN = 8;
const SHOP_PACK_COMPONENTS = [6, 9, 12];
const SHOP_CONTAINER_COMPONENTS = [4, 7, 10];
const SIDE_MODAL_UID = (161 << 16) | 74;
const BAG_ITEMS_COMPONENT = 5;
const BAG_OP = { ONE: 1, FIVE: 2, ALL: 3, DROP: 4 };

class NexusRoom extends Raid.Room {
  build() {
    const raid = this.raid;
    const settings = this.settings;
    this.increases = [0, 0, 0, 0];
    this.eligibleForSupplies = new Set();
    this.spirit = null;
    const done = raid.pathsCompleted.length;
    if (!raid.pathLevelsSeeded) {
      this.increases.fill(settings.startingPathLevel());
      raid.pathLevelsSeeded = true;
    }
    if (settings.isActive("WALK_THE_PATH")) {
      if (done === 1) this.levelRandomPaths(2);
      else if (done === 2 || done === 3) this.levelRandomPaths(1);
    }
    if (done === 2 || done === 4) this.offerSupplies();
    if (done === 4) this.replaceObject(Shared.WARDENS_ENTRANCE, ENTRANCE_SHAPE, WARDENS_OPEN);
    this.increases.forEach((amount, index) => {
      raid.pathLevels[index] += amount;
    });
    raid.sendPathLevels();
    for (const key of raid.pathsCompleted) {
      this.replaceObject(PATH_BY_KEY[key].entrance, ENTRANCE_SHAPE, ENTRANCE_COMPLETED);
    }
    this.startedPath = null;
  }

  onPlayerArrive(player) {
    const raid = this.raid;
    raid.setHudPath(player, 0);
    this.increases.forEach((amount, index) => {
      if (amount > 0) player.sendMessage(`You hear a mysterious rumbling coming from the Path of ${PATHS[index].name}.`);
    });
    if (this.spirit && this.eligibleForSupplies.delete(player.getUsername())) {
      player.sendMessage("<col=0000b2>A helpful spirit has arrived with some supplies.");
      raid.member(player).canClaimSupplies = true;
    }
    if (raid.pathsCompleted.length > 0) {
      const path = PATH_BY_KEY[raid.pathsCompleted[raid.pathsCompleted.length - 1]];
      const { Direction } = Shared.core();
      const facing = { APMEKEN: Direction.WEST, SCABARAS: Direction.SOUTH_WEST, HET: Direction.EAST, CRONDIS: Direction.SOUTH_EAST }[path.key];
      if (facing) player.setDirection?.(facing);
    }
  }

  levelRandomPaths(amount) {
    const open = PATHS.filter((path) => !this.raid.pathsCompleted.includes(path.key));
    for (let i = 0; i < amount && open.length > 0; i++) {
      this.increases[PATH_BY_KEY[Shared.randomOf(open).key].index]++;
    }
  }

  offerSupplies() {
    const { NpcIdentifiers } = Shared.core();
    this.spirit = this.spawn(NpcIdentifiers.HELPFUL_SPIRIT, SUPPLY_SPIRIT_TILE, { scale: false });
    this.spirit?.getMovementQueue().setBlockMovement(true);
    for (const username of this.raid.original) this.eligibleForSupplies.add(username);
    this.packs = supplyPacks(this.settings);
  }

  /** A path door: the leader picks the party's path, the rest follow it. */
  choosePath(player, path, quick) {
    const raid = this.raid;
    if (raid.pathsCompleted.includes(path.key)) {
      Shared.statement(player, "You have already completed this path.");
      return;
    }
    if (this.startedPath) {
      if (this.startedPath !== path.key) {
        Shared.statement(player, "You can't proceed as a different path has already been selected.");
        return;
      }
      if (raid.enterRoom(player, path.first, { leaderOnly: true })) raid.setHudPath(player, path.index + 1);
      return;
    }
    if (!raid.isLeader(player)) {
      Shared.statement(player, `Your leader, ${Shared.displayName(raid.leader)}, must enter first.`);
      return;
    }
    const go = () => {
      this.selectPath(path.key);
      raid.enterRoom(player, path.first, { leaderOnly: true });
      raid.setHudPath(player, path.index + 1);
      raid.broadcast(`${Shared.displayName(player)} has chosen to walk the Path of ${path.name}. Join them...`, player);
    };
    if (raid.hasStragglers()) raid.abandonPrompt(player, `Do you wish to walk the Path of ${path.name}`, go);
    else if (quick) go();
    else Shared.confirm(player, `Do you wish to walk the Path of ${path.name}?`, go);
  }

  /** Closes every other unfinished path's door once one is chosen. */
  selectPath(key) {
    this.startedPath = key;
    this.raid.pathKey = key;
    for (const path of PATHS) {
      if (path.key === key || this.raid.pathsCompleted.includes(path.key)) continue;
      this.replaceObject(path.entrance, ENTRANCE_SHAPE, ENTRANCE_CLOSED);
    }
  }

  enterWardens(player, quick) {
    const raid = this.raid;
    if (raid.pathsCompleted.length < PATHS.length) {
      Shared.statement(player, "The way is sealed. You must walk all four paths first.");
      return;
    }
    const go = () => {
      if (raid.enterRoom(player, "WARDENS_P1", { leaderOnly: true })) {
        raid.setHudPath(player, PATHS.length + 1);
        if (raid.isLeader(player)) raid.broadcast(`${Shared.displayName(player)} has proceeded to the lower level. Join them...`, player);
      }
    };
    if (!raid.isLeader(player)) {
      go();
      return;
    }
    if (raid.hasStragglers()) raid.abandonPrompt(player, "Do you wish to proceed to the lower level", go);
    else if (quick) go();
    else Shared.confirm(player, "Do you wish to proceed to the lower level?", go);
  }
}

/**
 * Wiki: the helpful spirit's three packs; the help invocations shrink them (with at least one
 * of each guaranteed item). The chaos pack is rolled: 1-8 nectar, 0-6 tears, 0-2 salts and a
 * rare (1 in 8, OpenRune) ambrosia and liquid adrenaline.
 */
function supplyPacks(settings) {
  const I = Shared.core().ItemIdentifiers;
  const factor = settings.supplyFactor();
  const diet = settings.isActive("ON_A_DIET");
  const scaled = (amount, minimum = 1) => Math.max(minimum, Math.floor(amount * factor));
  const rare = () => (Shared.random(1, CHAOS_RARE_ONE_IN) === 1 ? scaled(1, 0) : 0);
  const life = [
    [I.NECTAR_4_, scaled(5)],
    [I.TEARS_OF_ELIDINIS_4_, scaled(5)],
    [I.AMBROSIA_2_, scaled(diet ? 3 : 2)],
    [I.BLESSED_CRYSTAL_SCARAB_2_, scaled(diet ? 5 : 3)],
  ];
  if (!diet) life.push([I.SILK_DRESSING_2_, scaled(3, 0)]);
  const chaos = [
    [I.NECTAR_4_, scaled(Shared.random(1, 8))],
    [I.TEARS_OF_ELIDINIS_4_, scaled(Shared.random(0, 6), 0)],
    [I.SMELLING_SALTS_2_, scaled(Shared.random(0, 2), 0)],
    [I.AMBROSIA_2_, rare()],
    [I.LIQUID_ADRENALINE_2_, rare()],
  ];
  const power = [
    [I.SMELLING_SALTS_2_, scaled(2)],
    [I.LIQUID_ADRENALINE_2_, scaled(1)],
  ];
  return [life, chaos, power].map((pack) => pack.filter(([, amount]) => amount > 0));
}

function packItems(pack) {
  const items = [];
  for (const [id, amount] of pack) for (let i = 0; i < amount; i++) items.push(id);
  return items;
}

function nexusOf(player) {
  const room = Raid.roomOf(player);
  return room instanceof NexusRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ objects

function usePathEntrance(event) {
  const room = nexusOf(event.player);
  if (!room) return false;
  const location = event.object.getLocation();
  const path = PATHS.find((candidate) => candidate.entrance.x === location.getX() && candidate.entrance.y === location.getY());
  if (!path) return false;
  room.choosePath(event.player, PATH_BY_KEY[path.key], event.option !== "Enter");
  return true;
}

function useWardensEntry(event) {
  const room = nexusOf(event.player);
  if (!room) return false;
  room.enterWardens(event.player, event.option !== "Enter");
  return true;
}

// ------------------------------------------------------------------ supplies

function claimSupplies({ player }) {
  const room = nexusOf(player);
  const raid = Raid.raidOf(player);
  if (!room?.packs || !raid) return false;
  if (!raid.member(player).canClaimSupplies) {
    player.sendMessage("The spirit gives you a strange look. You've clearly claimed all you can for now.");
    return true;
  }
  const sender = player.getPacketSender();
  room.packs.forEach((pack, index) => {
    sender.sendInventory(SUPPLY_INVENTORIES[index], 9, pack.map(([id, amount]) => ({ id, amount })));
    sender.sendInterfaceFlagsRange((INTERFACE.SUPPLIES_SHOP << 16) | SHOP_PACK_COMPONENTS[index], 0, 9, EVENT.OP1);
    sender.sendInterfaceFlagsRange((INTERFACE.SUPPLIES_SHOP << 16) | SHOP_CONTAINER_COMPONENTS[index], 2, 8, EVENT.OP1);
  });
  sender.sendInterface(INTERFACE.SUPPLIES_SHOP);
  return true;
}

/** Picking a pack fills (or creates) the player's supply bag. */
function takePack(event) {
  const { player } = event;
  const room = nexusOf(player);
  const raid = Raid.raidOf(player);
  const index = SHOP_PACK_COMPONENTS.indexOf(event.childId);
  if (!room?.packs || !raid || index === -1 || !raid.member(player).canClaimSupplies) return;
  const { ItemIdentifiers } = Shared.core();
  const member = raid.member(player);
  const items = packItems(room.packs[index]);
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.SUPPLIES)) {
    if (inventory.getFreeSlots() < 1) {
      Shared.statement(player, "You need at least one inventory spot for a supply bag.");
      return;
    }
    member.supplies = items;
    inventory.adds(ItemIdentifiers.SUPPLIES, 1);
  } else {
    if (SUPPLY_BAG_SIZE - member.supplies.length < items.length) {
      Shared.statement(player, "You need more space in your supply bag for additional supplies.");
      return;
    }
    member.supplies.push(...items);
  }
  member.canClaimSupplies = false;
  player.getPacketSender().sendInterfaceRemoval();
}

function openSupplyBag({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const sender = player.getPacketSender();
  sendBagContents(player, raid.member(player).supplies);
  sender.sendSubInterface(SIDE_MODAL_UID, INTERFACE.SUPPLIES_BAG, 3);
  sender.sendInterfaceFlagsRange((INTERFACE.SUPPLIES_BAG << 16) | BAG_ITEMS_COMPONENT, 0, SUPPLY_BAG_SIZE - 1,
    EVENT.OP1 | EVENT.OP2 | EVENT.OP3 | EVENT.OP4 | EVENT.OP9 | EVENT.DRAG | EVENT.DRAG_TARGET);
  return true;
}

function sendBagContents(player, items) {
  player.getPacketSender().sendInventory(SUPPLY_BAG_INVENTORY, SUPPLY_BAG_SIZE, items.map((id) => ({ id, amount: 1 })));
}

/** Withdraw 1 / 5 / all of a supply, or drop it. */
function useSupplyBag(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return;
  const member = raid.member(player);
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  const id = member.supplies[slot];
  if (id === undefined) return;
  const op = event.opId ?? event.action;
  if (op === BAG_OP.DROP) {
    member.supplies.splice(slot, 1);
    const { ItemOnGroundManager, Item } = Shared.core();
    ItemOnGroundManager.registerLocation(player, new Item(id, 1), player.getLocation().clone(), raid.area);
  } else {
    const wanted = op === BAG_OP.FIVE ? 5 : op === BAG_OP.ALL ? SUPPLY_BAG_SIZE : 1;
    const free = player.getInventory().getFreeSlots();
    if (free <= 0) player.sendMessage("You do not have enough space in your inventory to withdraw your supplies.");
    let taken = 0;
    for (let i = member.supplies.length - 1; i >= 0 && taken < Math.min(wanted, free); i--) {
      if (member.supplies[i] !== id) continue;
      member.supplies.splice(i, 1);
      player.getInventory().adds(id, 1);
      taken++;
    }
  }
  if (member.supplies.length === 0) {
    player.getInventory().delete(Shared.core().ItemIdentifiers.SUPPLIES, 1);
    player.getPacketSender().closeSubInterface(SIDE_MODAL_UID);
    return;
  }
  sendBagContents(player, member.supplies);
}

/** Using one of the spirit's supplies on the bag puts it back in (OpenRune; not honey locusts). */
function storeSupply(event) {
  const { player } = event;
  const raid = Raid.raidOf(player);
  const { ItemIdentifiers } = Shared.core();
  if (!raid) return;
  const bag = ItemIdentifiers.SUPPLIES;
  if (event.usedItemId !== bag && event.usedWithItemId !== bag) return;
  const supplyId = event.usedItemId === bag ? event.usedWithItemId : event.usedItemId;
  if (!Supplies.doses(supplyId) || supplyId === ItemIdentifiers.HONEY_LOCUST) return;
  event.handled = true;
  const member = raid.member(player);
  if (member.supplies.length >= SUPPLY_BAG_SIZE) {
    player.sendMessage("Your supply bag is full.");
    return;
  }
  player.getInventory().delete(supplyId, 1);
  member.supplies.push(supplyId);
  sendBagContents(player, member.supplies);
}

/**
 * Withdraw-1 and Withdraw-all (Wiki): the first items, left to right, while the inventory has
 * room. The last item still comes out with a full inventory, as the bag itself goes.
 */
function withdrawSupplies(player, count) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const member = raid.member(player);
  const inventory = player.getInventory();
  let taken = 0;
  while (taken < count && member.supplies.length > 0) {
    const last = member.supplies.length === 1;
    if (inventory.getFreeSlots() <= 0 && !last) {
      player.sendMessage("You do not have enough space in your inventory to withdraw your supplies.");
      break;
    }
    const id = member.supplies.shift();
    if (last) inventory.delete(Shared.core().ItemIdentifiers.SUPPLIES, 1);
    inventory.adds(id, 1);
    taken++;
  }
  if (member.supplies.length === 0) player.getPacketSender().closeSubInterface(SIDE_MODAL_UID);
  else sendBagContents(player, member.supplies);
  return true;
}

function withdrawOne({ player }) {
  return withdrawSupplies(player, 1);
}

function withdrawAll({ player }) {
  return withdrawSupplies(player, SUPPLY_BAG_SIZE);
}

/**
 * Resupply (Wiki): "restores any partially-used items in the player's inventory by using the
 * items contained within", e.g. Smelling salts (1) becomes (2); it never adds new items.
 */
function resupply({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  const member = raid.member(player);
  const inventory = player.getInventory();
  const { Item } = Shared.core();
  let restored = false;
  inventory.getItems().forEach((item, slot) => {
    const held = item ? Supplies.doses(item.getId()) : null;
    if (!held || held.doses >= held.chain.length) return;
    let have = held.doses;
    for (let i = 0; i < member.supplies.length && have < held.chain.length; i++) {
      const stored = Supplies.doses(member.supplies[i]);
      if (!stored || stored.chain !== held.chain) continue;
      const moved = Math.min(held.chain.length - have, stored.doses);
      have += moved;
      const left = stored.doses - moved;
      if (left > 0) member.supplies[i] = held.chain[held.chain.length - left];
      else member.supplies.splice(i--, 1);
    }
    if (have === held.doses) return;
    inventory.setItem(slot, new Item(held.chain[held.chain.length - have], 1));
    restored = true;
  });
  if (!restored) return true;
  inventory.refreshItems();
  if (member.supplies.length === 0) {
    inventory.delete(Shared.core().ItemIdentifiers.SUPPLIES, 1);
    player.getPacketSender().closeSubInterface(SIDE_MODAL_UID);
  } else {
    sendBagContents(player, member.supplies);
  }
  return true;
}

function registerRaidItems() {
  const I = Shared.core().ItemIdentifiers;
  Raid.registerRaidItems(
    I.SUPPLIES, I.HONEY_LOCUST,
    I.NECTAR_4_, I.NECTAR_3_, I.NECTAR_2_, I.NECTAR_1_,
    I.TEARS_OF_ELIDINIS_4_, I.TEARS_OF_ELIDINIS_3_, I.TEARS_OF_ELIDINIS_2_, I.TEARS_OF_ELIDINIS_1_,
    I.SMELLING_SALTS_2_, I.SMELLING_SALTS_1_, I.LIQUID_ADRENALINE_2_, I.LIQUID_ADRENALINE_1_,
    I.SILK_DRESSING_2_, I.SILK_DRESSING_1_, I.BLESSED_CRYSTAL_SCARAB_2_, I.BLESSED_CRYSTAL_SCARAB_1_,
    I.AMBROSIA_2_, I.AMBROSIA_1_,
  );
}

module.exports = function registerTombsNexus(api) {
  Shared.bind(api);
  Raid.registerRoom("MAIN_HALL", NexusRoom);
  registerRaidItems();
  Shared.onObject(api, PATHS.map((path) => `Path of ${path.name}`), usePathEntrance);
  Shared.onObject(api, "Entry", useWardensEntry);
  api.onNpcInteraction("Helpful Spirit", { Claim: claimSupplies });
  api.onItemAction("Supplies", { Open: openSupplyBag, "Withdraw 1": withdrawOne, "Withdraw All": withdrawAll, Resupply: resupply });
  api.onItemOnItem(storeSupply);
  api.onInterfaceActionButton(SHOP_PACK_COMPONENTS.map((child) => (INTERFACE.SUPPLIES_SHOP << 16) | child), takePack);
  api.onInterfaceActionButton((INTERFACE.SUPPLIES_BAG << 16) | BAG_ITEMS_COMPONENT, useSupplyBag);
};
