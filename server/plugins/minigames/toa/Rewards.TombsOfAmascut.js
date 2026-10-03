"use strict";

/**
 * Tombs of Amascut: Osmumten's burial chamber. Loot is rolled as the party arrives; each
 * player's chest opens the reward interface (771) to take, bank or discard it, and the
 * spirit sees them out. Loot left behind waits in the lobby's retrieval chest.
 *
 * A unique (Wiki) turns the flames around Osmumten's sarcophagus purple, and its finder opens
 * the sarcophagus to reveal it; their chest holds only the tertiaries. The cache drives the
 * whole vault from TOA_VAULT_SARCOPHAGUS (14373): the sarcophagus (closed, or purple with
 * Open), the floor glow and the barrier. How OSRS hands the item over isn't known, so after
 * the reveal it joins the finder's loot in the reward interface, which handles a full
 * inventory and banking; the opened sarcophagus's Search reopens it.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");
const Rewards = require("./ToaRewards");

/** The departing spirit and the burial chamber's chests: unnamed in the cache, no constants. */
const SPIRIT = 11829;
const SPIRIT_SPOT = { x: 3680, y: 5143, z: 0 };
const CHEST_IDS = new Set([46217, 44545, 46215, 46219, 46218, 44547, 29994, 46216, 46224]);

const LOOT_INVENTORY = 811;
const LOOT_COMPONENT = { BANK_ALL: 4, INVENTORY_ALL: 6, DISCARD_ALL: 8, ITEMS: 10 };
const LOOT_ITEMS_UID = (Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.ITEMS;
const SCRIPT_ITEM_OPS = 149;
/**
 * TOA_SHOULD_HAVE_LOOT: chest 46224 is a False Door at 0 and a Rewards Niche (Claim) at 1.
 * (14139, used before, is a PvP Arena loadout varbit.)
 */
const VARBIT_CHEST_FULL = 14319;
const OP10 = 1 << 10;

/** TOA_VAULT_SARCOPHAGUS: 0 the standard vault, 1 purple (and the sarcophagus can be opened). */
const VARBIT_SARCOPHAGUS = 14373;
const SARCOPHAGUS = { id: 46220, x: 3679, y: 5140, z: 0, face: 2 };
const SARCOPHAGUS_IDS = new Set([46220, 44825, 44826, 44934]); // the parent, closed, purple, opened
const OPENED_SARCOPHAGUS = 44934;
const ANIMATION = { REVEAL: 9505, OPEN: 9506 }; // TOA_OSMUMTEN_CHEST_REVEAL / _OPEN
const REVEAL_TICKS = 8; // 223 client cycles

/**
 * The vault's eight chests (TOA_VAULT_CHEST_LOC0-7), one per party slot, each with its varbit
 * (TOA_VAULT_CHEST_0-7): 2 shows the slot's player their own chest with loot, 4 their emptied
 * one; anything else is someone else's chest.
 */
const SLOT_CHESTS = [
  [29994, 14356], [44545, 14357], [44547, 14358], [46215, 14359],
  [46216, 14360], [46217, 14370], [46218, 14371], [46219, 14372],
];
const CHEST_STATE = { OTHERS: 0, MINE: 2, EMPTY: 4 };

class RewardRoom extends Raid.Room {
  build() {
    const spirit = this.spawn(SPIRIT, SPIRIT_SPOT, { scale: false, points: 0, face: 1 });
    if (spirit) {
      spirit.__toaScripted = true;
      spirit.getMovementQueue().setBlockMovement(true);
    }
    const raid = this.raid;
    this.opening = false;
    if (raid.lootRolled) return;
    raid.lootRolled = true;
    raid.chestSlots = new Map(raid.players.map((player, slot) => [player, slot]));
    const { uniqueWinner, uniqueId, petWinner } = Rewards.rollRaidLoot(raid);
    const { ItemDefinition } = Shared.core();
    if (uniqueWinner) {
      raid.sarcophagusOwner = uniqueWinner;
      const name = ItemDefinition.forId(uniqueId)?.getName?.() ?? "a unique";
      raid.broadcast(`<col=a53fff>Special loot:</col> ${Shared.displayName(uniqueWinner)} found ${name}!`);
    }
    if (petWinner) raid.broadcast(`<col=ff0000>${Shared.displayName(petWinner)} has a funny feeling like they would have been followed...</col>`);
  }

  onPlayerArrive(player) {
    const loot = Rewards.lootOf(player);
    // Everyone sees the purple flames; only the finder can open the sarcophagus.
    player.getPacketSender().sendVarbit(VARBIT_SARCOPHAGUS, this.raid.sarcophagusOwner ? 1 : 0);
    sendChests(player);
    if (Rewards.sealedUnique(player) !== -1) player.sendMessage("<col=a53fff>Osmumten's sarcophagus glows for you. Open it to claim your reward.</col>");
    if (loot.length > 0) player.sendMessage("Your rewards await you in the chest.");
  }

  /** The finder opens the sarcophagus: it slides open, then the unique joins their loot. */
  openSarcophagus(player) {
    const raid = this.raid;
    if (raid.sarcophagusOwner !== player) {
      player.sendMessage(raid.sarcophagusOwner
        ? `This sarcophagus holds ${Shared.displayName(raid.sarcophagusOwner)}'s reward.`
        : "The sarcophagus is sealed shut.");
      return;
    }
    if (this.opening) return;
    if (raid.sarcophagusOpened || Rewards.sealedUnique(player) === -1) {
      openLoot(player);
      return;
    }
    this.opening = true;
    const movement = player.getMovementQueue();
    movement.reset();
    movement.setBlockMovement(true);
    player.setPositionToFace(Shared.loc(SARCOPHAGUS));
    // Every form of the sarcophagus shares one model: the lid is moved only by animations.
    // The opened one (Search) takes its place and slides open, holding the last frame.
    raid.sarcophagusOpened = true;
    this.setObject(OPENED_SARCOPHAGUS, SARCOPHAGUS, 10, SARCOPHAGUS.face);
    this.animateSarcophagus(OPENED_SARCOPHAGUS, ANIMATION.REVEAL);
    // Timed on the player, not the room, so they're always freed even if the room goes.
    Shared.later(player, REVEAL_TICKS, () => {
      this.opening = false;
      movement.setBlockMovement(false);
      if (this.destroyed || !raid.players.includes(player)) return; // the lobby chest has it
      // The open loop from here on, so a reloaded scene shows it open rather than opening.
      this.animateSarcophagus(OPENED_SARCOPHAGUS, ANIMATION.OPEN);
      if (Rewards.unsealUnique(player) === -1) return;
      sendChests(player);
      openLoot(player);
    });
  }

  animateSarcophagus(id, animation) {
    const { GameObject, Animation } = Shared.core();
    const object = new GameObject(id, Shared.loc(SARCOPHAGUS), 10, SARCOPHAGUS.face, null);
    for (const viewer of this.roomPlayers()) viewer.getPacketSender().sendObjectAnimation(object, new Animation(animation));
  }
}

/** Shows the player their own chest (with loot, or emptied) among the party's. */
function sendChests(player) {
  const raid = Raid.raidOf(player);
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_CHEST_FULL, Rewards.hasLoot(player) ? 1 : 0);
  const slot = raid?.chestSlots?.get(player);
  SLOT_CHESTS.forEach(([, varbit], index) => {
    const state = index !== slot ? CHEST_STATE.OTHERS : Rewards.hasLoot(player) ? CHEST_STATE.MINE : CHEST_STATE.EMPTY;
    sender.sendVarbit(varbit, state);
  });
}

// ------------------------------------------------------------------ the loot interface

function openLoot(player) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    Shared.statement(player, "There is nothing to claim.");
    player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
    return;
  }
  const sender = player.getPacketSender();
  sendLoot(player, loot);
  sender.sendInterface(Shared.INTERFACE.LOOT);
  sender.sendClientScript(SCRIPT_ITEM_OPS, LOOT_ITEMS_UID, LOOT_INVENTORY, 2, 3, 0, -1, "Take", "Take-5", "Take-10", "Take-All", "");
  sender.sendInterfaceFlagsRange(LOOT_ITEMS_UID, 0, Rewards.LOOT_SLOTS - 1,
    Shared.EVENT.OP1 | Shared.EVENT.OP2 | Shared.EVENT.OP3 | Shared.EVENT.OP4 | OP10);
}

function sendLoot(player, loot) {
  player.getPacketSender().sendInventory(LOOT_INVENTORY, Rewards.LOOT_SLOTS, loot.map(({ id, amount }) => ({ id, amount })));
  if (Raid.raidOf(player)?.roomFor(player)?.key === "REWARD") sendChests(player);
  else if (loot.length === 0) player.getPacketSender().sendVarbit(VARBIT_CHEST_FULL, 0);
}

function bankFor(player, id) {
  const { Bank } = Shared.core();
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).contains(id)) return player.getBank(tab);
  }
  const preferred = player.getBank(Bank.getTabForItem(player, id));
  if (preferred.getFreeSlots() > 0) return preferred;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getFreeSlots() > 0) return player.getBank(tab);
  }
  return null;
}

/** Moves up to `amount` of one loot slot into the inventory or bank; returns how many moved. */
function take(player, entry, amount, destination) {
  const { Item, ItemDefinition } = Shared.core();
  const wanted = Math.max(0, Math.min(entry.amount, amount));
  if (wanted === 0) return 0;
  if (destination === "bank") {
    const bank = bankFor(player, entry.id);
    if (!bank) {
      player.sendMessage("You need more space in your bank.");
      return 0;
    }
    bank.add(new Item(entry.id, wanted), false);
    return wanted;
  }
  const inventory = player.getInventory();
  const stackable = ItemDefinition.forId(entry.id)?.isStackable?.() === true;
  const moved = stackable ? (inventory.contains(entry.id) || inventory.getFreeSlots() > 0 ? wanted : 0)
    : Math.min(wanted, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.add(new Item(entry.id, moved), false);
  inventory.refreshItems();
  return moved;
}

function takeAll(player, destination) {
  const loot = Rewards.lootOf(player);
  if (loot.length === 0) {
    player.sendMessage(`There is nothing to ${destination === "bank" ? "bank" : "put in your inventory"}.`);
    return;
  }
  const left = [];
  for (const entry of loot) {
    entry.amount -= take(player, entry, entry.amount, destination);
    if (entry.amount > 0) left.push(entry);
  }
  Rewards.setLoot(player, left);
  sendLoot(player, left);
}

function clickBankAll({ player }) {
  takeAll(player, "bank");
}

function clickInventoryAll({ player }) {
  takeAll(player, "inventory");
}

function clickDiscardAll({ player }) {
  if (!Rewards.hasLoot(player)) {
    player.sendMessage("There is nothing to discard.");
    return;
  }
  Shared.options(player, "Are you sure you want to discard everything?",
    "No.", () => openLoot(player),
    "Yes.", () => {
      Rewards.setLoot(player, []);
      sendLoot(player, []);
    });
}

/** Take / Take-5 / Take-10 / Take-All on one slot. */
function clickLootItem(event) {
  const { player } = event;
  const loot = Rewards.lootOf(player);
  const slot = Number.isInteger(event.slot) ? event.slot : -1;
  const entry = loot[slot];
  if (!entry) return;
  const op = event.opId ?? event.action;
  const amount = op === 2 ? 5 : op === 3 ? 10 : op === 4 ? entry.amount : 1;
  entry.amount -= take(player, entry, amount, "inventory");
  if (entry.amount <= 0) loot.splice(slot, 1);
  Rewards.setLoot(player, loot);
  sendLoot(player, loot);
}

// ------------------------------------------------------------------ objects and the spirit

function openChest(event) {
  const { player } = event;
  const id = event.objectId;
  const room = Raid.raidOf(player)?.roomFor(player);
  const inReward = room?.key === "REWARD" && !room.destroyed;
  if (inReward && SARCOPHAGUS_IDS.has(id)) {
    event.handled = true;
    room.openSarcophagus(player);
    return;
  }
  const atLobby = id === Shared.core().ObjectIdentifiers.CHEST_155 && Shared.inLobby(player.getLocation());
  if (!((CHEST_IDS.has(id) || id === Shared.core().ObjectIdentifiers.REWARDS_NICHE) && inReward) && !atLobby) return;
  event.handled = true;
  if (atLobby) {
    // A sarcophagus left unopened hands its unique over with the rest of the loot.
    Rewards.unsealUnique(player);
    if (!Rewards.hasLoot(player)) {
      Shared.statement(player, "There is nothing to collect.");
      return;
    }
  }
  const slotChest = SLOT_CHESTS.findIndex(([chestId]) => chestId === id);
  const slot = room?.raid?.chestSlots?.get(player);
  if (inReward && slotChest !== -1 && slot !== undefined && slotChest !== slot) {
    player.sendMessage("That chest belongs to someone else.");
    return;
  }
  openLoot(player);
}

function talkToSpirit(event) {
  if (event.handled || event.npcId !== SPIRIT) return;
  const { player } = event;
  const raid = Raid.raidOf(player);
  if (!raid) return;
  event.handled = true;
  Shared.options(player, "Are you ready to leave the Tombs of Amascut?",
    "Yes.", () => {
      if (!Raid.raidOf(player)) return;
      player.sendMessage("You leave the Tombs of Amascut.");
      if (Rewards.hasRewards(player)) player.sendMessage("Your unclaimed rewards can be collected from the chest in the lobby.");
      raid.leave(player, { teleport: true });
    },
    "No.", () => {});
}

module.exports = function registerTombsRewards(api) {
  Shared.bind(api);
  Raid.registerRoom("REWARD", RewardRoom);
  api.onObjectInteraction(openChest);
  api.onNpcInteraction(talkToSpirit);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.BANK_ALL, clickBankAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.INVENTORY_ALL, clickInventoryAll);
  api.onInterfaceActionButton((Shared.INTERFACE.LOOT << 16) | LOOT_COMPONENT.DISCARD_ALL, clickDiscardAll);
  api.onInterfaceActionButton(LOOT_ITEMS_UID, clickLootItem);
  api.persistAttribute(Rewards.ATTR_LOOT);
  api.persistAttribute(Rewards.ATTR_THREAD);
  api.persistAttribute(Rewards.ATTR_SARCOPHAGUS);
};
