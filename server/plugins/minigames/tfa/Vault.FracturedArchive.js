"use strict";

/**
 * The inner vault after Ocellus: a chest for each player, their loot, and the Rift out.
 *
 * Captured as a spectator (docs/fractured-archive.md):
 * - Travel on the Blade takes the party to the vault (level 2), arriving at 4127,5779.
 * - Eight chests stand round the island (4124,5793 to 4133,5803), one per party slot. Each is a
 *   multinpc on tfa_vault_own_chest, so a player's own chest shows as theirs. Opened, it plays
 *   chest_guthixian02_open01 and becomes a Rift ("Search").
 * - Searching it opens the Archive's reward chest (tfa_chests, 973: the Tombs of Amascut's
 *   layout) on its six-slot inventory (1029), with Take / Take-5 / Take-10 / Take-All on an
 *   item, Bank-all, Take-all and Discard-all.
 * - The Merit scroll reads the records. The Rift out ("Leave", "Quick-leave") fades in at
 *   4126,5796 about 15 ticks after the party arrives.
 * - The loot itself was never seen. It follows the Wiki's chest table (data
 *   fractured-archive.json): three standard rolls (1/51 for five times as much) when no unique,
 *   and tertiaries.
 * Estimates: the unique chance and weights, the pet's rate, the unique chest's tile, a player
 * opening only their own chest, the chest's item options (as the Tombs of Amascut's), and
 * leftovers going to the bank when a player leaves (the Wiki says the lobby's Loot Wheelbarrow
 * keeps them).
 */

const path = require("path");
const fs = require("fs");
const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");
const Records = require("./Records.FracturedArchive");

const { named, anim } = Shared;

const LOOT = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "fractured-archive.json"), "utf8")).loot;

const LAYOUT = {
  chests: [[4124, 5793], [4130, 5793], [4121, 5796], [4133, 5796], [4120, 5800], [4134, 5800], [4121, 5803], [4133, 5803]],
  unique: { x: 4126, y: 5806, z: 2 },
  rift: { x: 4126, y: 5796, z: 2 },
  exitLoc: { x: 4127, y: 5773, z: 2 },
  scoreboard: { x: 4129, y: 5778, z: 2 },
  braziers: [[4131, 5805], [4123, 5805]],
};
const RIFT_AFTER = 15;
/** The reward chest's inventory (gameval inv tfa_chests) and its size in the cache. */
const CHEST_INV = 1029;
const CHEST_SLOTS = 6;
/** interface_inv_init: the items' grid and their options. */
const INV_INIT_SCRIPT = 149;
/** The items' click events: Take, Take-5, Take-10, Take-All and Examine. */
const ITEM_EVENTS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 10);

class VaultRoom extends Raid.Room {
  onBuild() {
    this.placeObject(named("loc", "tfa_vault_exit"), LAYOUT.exitLoc);
    this.placeObject(named("loc", "tfa_vault_scoreboard"), LAYOUT.scoreboard);
    for (const [x, y] of LAYOUT.braziers) this.placeObject(named("loc", "tfa_brazier_guthixloot01_fire01"), { x, y, z: 2 });
    this.chests = new Map();
    this.loot = new Map();
    this.raid.roster.forEach((player, slot) => {
      const [x, y] = LAYOUT.chests[slot];
      const chest = this.spawn(named("npc", `tfa_rewards_chest_vault_${slot + 1}_closed`), { x, y, z: 2 }, { scripted: true });
      if (chest) this.chests.set(slot, { npc: chest, open: false });
    });
    for (const player of this.raid.players) this.loot.set(player.getUsername(), toEntries(rollLoot()));
    if ([...this.loot.values()].some((loot) => loot.unique)) {
      this.uniqueChest = this.spawn(named("npc", "tfa_unique_chest_vault_closed"), LAYOUT.unique, { scripted: true });
    }
    this.later(RIFT_AFTER, () => this.spawn(named("npc", "tfa_vault_exit_small"), LAYOUT.rift, { scripted: true, fadeIn: 90 }));
  }

  onArrive(player) {
    const slot = this.raid.slotOf(player);
    player.getPacketSender().sendVarbit(named("varbit", "tfa_vault_own_chest"), slot + 1);
    player.getPacketSender().sendVarbit(named("varbit", "tfa_has_claimable_loot"), this.loot.has(player.getUsername()) ? 1 : 0);
  }

  /** Open: their own chest opens into a Rift (captured); someone else's is left alone (estimate). */
  open(player, npc) {
    const slot = this.raid.slotOf(player);
    const own = this.chests.get(slot);
    if (!own || own.npc !== npc) {
      player.sendMessage("That isn't your chest.");
      return;
    }
    if (own.open) return;
    own.open = true;
    npc.performAnimation(anim("chest_guthixian02_open01"));
    this.later(1, () => npc.setNpcTransformationId(named("npc", `tfa_rewards_chest_vault_${slot + 1}_open`)));
    player.getPacketSender().sendVarbit(named("varbit", `tfa_vault_chest_${slot}_state`), 1);
  }

  /** Search the Rift: the reward chest, to take, bank or discard the loot. */
  search(player, npc) {
    const slot = this.raid.slotOf(player);
    const own = this.chests.get(slot);
    const unique = npc === this.uniqueChest;
    if (!unique && (!own || own.npc !== npc || !own.open)) return;
    const loot = this.loot.get(player.getUsername());
    if (!loot) {
      player.sendMessage("There's nothing left in here for you.");
      return;
    }
    if (loot.unique && !unique) {
      player.sendMessage("Something special waits for you in the chest at the north end of the vault.");
      return;
    }
    this.openChest(player, loot);
  }

  /** The reward chest: its items, with their options, and the loot's collection log entries once. */
  openChest(player, loot) {
    if (!loot.logged) {
      loot.logged = true;
      for (const { id, amount } of loot.entries) Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: id, amount });
    }
    const sender = player.getPacketSender();
    this.sendChest(player, loot);
    sender.sendInterface(Shared.id("iface", "CHESTS"));
    const items = Shared.id("component", "CHEST_ITEMS");
    sender.sendClientScript(INV_INIT_SCRIPT, items, CHEST_INV, 2, 3, 0, -1, "Take", "Take-5", "Take-10", "Take-All", "");
    sender.sendInterfaceFlagsRange(items, 0, CHEST_SLOTS - 1, ITEM_EVENTS);
  }

  sendChest(player, loot) {
    const shown = loot.entries.slice(0, CHEST_SLOTS);
    player.getPacketSender().sendInventory(CHEST_INV, CHEST_SLOTS, shown.map(({ id, amount }) => ({ id, amount })));
    if (loot.entries.length === 0) {
      this.loot.delete(player.getUsername());
      player.getPacketSender().sendVarbit(named("varbit", "tfa_has_claimable_loot"), 0);
    }
  }

  /** Take / Take-5 / Take-10 / Take-All on one item, or Take-all / Bank-all on the lot. */
  take(player, slot, amount, destination) {
    const loot = this.loot.get(player.getUsername());
    const entry = loot?.entries[slot];
    if (!entry) return;
    entry.amount -= move(player, entry, amount, destination);
    if (entry.amount <= 0) loot.entries.splice(slot, 1);
    this.sendChest(player, loot);
  }

  takeAll(player, destination) {
    const loot = this.loot.get(player.getUsername());
    if (!loot || loot.entries.length === 0) {
      player.sendMessage(`There is nothing to ${destination === "bank" ? "bank" : "put in your inventory"}.`);
      return;
    }
    loot.entries = loot.entries.filter((entry) => (entry.amount -= move(player, entry, entry.amount, destination)) > 0);
    this.sendChest(player, loot);
  }

  discardAll(player) {
    const loot = this.loot.get(player.getUsername());
    if (!loot || loot.entries.length === 0) {
      player.sendMessage("There is nothing to discard.");
      return;
    }
    Shared.options(player, "Are you sure you want to discard everything?",
      "No.", () => this.openChest(player, loot),
      "Yes.", () => {
        loot.entries = [];
        this.sendChest(player, loot);
      });
  }

  /** Leaving with loot still unclaimed sends it to the bank (estimate). */
  leave(player) {
    this.bankUnclaimed(player);
    this.raid.leaveFinished(player);
  }

  /** Logging out (or dropping) in the vault banks their unclaimed loot before the save. */
  onPlayerLogout(player) {
    this.bankUnclaimed(player);
  }

  bankUnclaimed(player) {
    const loot = this.loot.get(player.getUsername());
    if (!loot) return;
    if (!loot.logged) {
      loot.logged = true;
      for (const { id, amount } of loot.entries) Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: id, amount });
    }
    for (const entry of loot.entries) move(player, entry, entry.amount, "bank");
    this.loot.delete(player.getUsername());
    player.sendMessage("Your unclaimed rewards from the Archive have been sent to your bank.");
  }
}

// ---------------------------------------------------------------- the loot

function weightedPick(rows, weightAt) {
  const total = rows.reduce((sum, row) => sum + row[weightAt], 0);
  let roll = Math.random() * total;
  for (const row of rows) {
    roll -= row[weightAt];
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

/** One player's loot: a unique, or three standard rolls; then the tertiaries and the pet. */
function rollLoot() {
  const items = [];
  let unique = null;
  if (Math.random() < LOOT.uniqueChance) {
    unique = weightedPick(LOOT.uniques, 1)[0];
    items.push([unique, 1]);
  } else {
    for (let i = 0; i < LOOT.rolls; i++) {
      const [name, min, max] = weightedPick(LOOT.standard, 3);
      const bonus = Math.random() < 1 / LOOT.bonusChance ? LOOT.bonusFactor : 1;
      items.push([name, Shared.random(min, max) * bonus]);
    }
  }
  for (const [name, oneIn] of LOOT.tertiary) if (Math.random() < 1 / oneIn) items.push([name, 1]);
  const [pet, petOneIn] = LOOT.pet;
  if (Math.random() < 1 / petOneIn) items.push([pet, 1]);
  return { unique, items };
}

/** An item by its gameval name (or an ItemIdentifiers constant, for the elite clue). */
function itemId(name) {
  const { ItemIdentifiers } = Shared.core();
  if (ItemIdentifiers[name] !== undefined) return ItemIdentifiers[name];
  return named("obj", name);
}

/** A player's loot as chest entries (items by id). */
function toEntries(loot) {
  return { unique: loot.unique, entries: loot.items.map(([name, amount]) => ({ id: itemId(name), amount })), logged: false };
}

/**
 * Up to `amount` of an entry into the inventory (bulky drops noted, as the other raids' chests
 * give them) or the bank (unnoted); how many moved.
 */
function move(player, entry, amount, destination) {
  const { Item, ItemDefinition, Bank } = Shared.core();
  const wanted = Math.max(0, Math.min(entry.amount, amount));
  if (wanted === 0) return 0;
  if (destination === "bank") {
    player.getBank(Bank.getTabForItem(player, entry.id)).add(new Item(entry.id, wanted), false);
    return wanted;
  }
  const inventory = player.getInventory();
  const definition = ItemDefinition.forId(entry.id);
  const id = !definition.isStackable() && wanted > 1 && definition.getNoteId() >= 0 ? definition.getNoteId() : entry.id;
  const stackable = ItemDefinition.forId(id).isStackable();
  const moved = stackable ? (inventory.contains(id) || inventory.getFreeSlots() > 0 ? wanted : 0) : Math.min(wanted, inventory.getFreeSlots());
  if (moved <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return 0;
  }
  inventory.add(new Item(id, moved), false);
  inventory.refreshItems();
  return moved;
}

// ---------------------------------------------------------------- clicks

function vaultOf(player) {
  const room = Raid.raidOf(player)?.room;
  return room instanceof VaultRoom ? room : null;
}

function openChest(event) {
  const room = vaultOf(event.player);
  if (!room) return false;
  if (event.npc === room.uniqueChest) {
    event.npc.performAnimation(anim("chest_guthixian02_open01"));
    event.npc.setNpcTransformationId(named("npc", "tfa_unique_chest_vault_open"));
    return true;
  }
  room.open(event.player, event.npc);
  return true;
}

function searchChest(event) {
  const room = vaultOf(event.player);
  if (!room) return false;
  room.search(event.player, event.npc);
  return true;
}

function leaveVault(event) {
  const room = vaultOf(event.player);
  if (!room) return false;
  room.leave(event.player);
  return true;
}

function chestRoomOf(player) {
  const room = vaultOf(player);
  return room && room.loot.has(player.getUsername()) ? room : null;
}

/** The reward chest's buttons and items (their ids resolved at click time, from the cache). */
function chestClick(event) {
  if (event.scriptTrigger) return;
  const { player, buttonId } = event;
  const id = (key) => Shared.id("component", key);
  if (![id("CHEST_BANK_ALL"), id("CHEST_TAKE_ALL"), id("CHEST_DISCARD_ALL"), id("CHEST_ITEMS")].includes(buttonId)) return;
  event.handled = true;
  const room = chestRoomOf(player);
  if (!room) return;
  if (buttonId === id("CHEST_BANK_ALL")) room.takeAll(player, "bank");
  else if (buttonId === id("CHEST_TAKE_ALL")) room.takeAll(player, "inventory");
  else if (buttonId === id("CHEST_DISCARD_ALL")) room.discardAll(player);
  else {
    // Take / Take-5 / Take-10 / Take-All on one slot.
    const op = event.opId ?? event.action;
    const amount = op === 2 ? 5 : op === 3 ? 10 : op === 4 ? Number.MAX_SAFE_INTEGER : 1;
    room.take(player, Number.isInteger(event.slot) ? event.slot : -1, amount, "inventory");
  }
}

function readMerits({ player }) {
  if (!vaultOf(player)) return false;
  Records.open(player);
  return true;
}

module.exports = function registerVault(api) {
  Shared.bind(api);
  Raid.registerRoom("VAULT", VaultRoom);
  api.onNpcInteraction("<col=00ffff>Chest</col>", { Open: openChest, Search: searchChest });
  api.onNpcInteraction("<col=00ffff>Rift</col>", { Search: searchChest, Leave: leaveVault, "Quick-leave": leaveVault });
  api.onObjectInteraction("Merit scroll", { Read: readMerits });
  api.onInterfaceActionClick(chestClick);
};

Object.assign(module.exports, { VaultRoom, LAYOUT, rollLoot });
