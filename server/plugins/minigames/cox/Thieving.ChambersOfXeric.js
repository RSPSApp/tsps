"use strict";

/**
 * The Thieving room (the creature keeper's): chests hold cavern grubs; fed enough of them from
 * the trough, the corrupted scavenger blocking the way falls asleep and moves aside.
 *
 * Wiki (Chest (Chambers of Xeric); Corrupted scavenger; Chambers of Xeric, Gaining points;
 * Chambers of Xeric/Strategies, Thieving):
 * - Opening tries every tick: 39% at Thieving 1 to 61% at 99, +21 points with a lockpick or
 *   hair clip. A chest that isn't poisoned always holds grubs: a random 0 to Thieving/25,
 *   raised to at least 1 (2 at 95+). Three chests hold poison: 1-3 damage to anyone next to
 *   it. One holds psykk bats, one per raider (5-25), once; they count as food the finder made.
 * - The scavenger needs 16 grubs per raider (30 solo). Each grub deposited gives 115 points,
 *   up to max(4500, (party's total Thieving / 6) x 150) points.
 * - Hunger comes back after 60 seconds without food. Asleep, it lets the party through, and
 *   the raiders get a batch of endarkened juice, stinkhorn mushrooms and cicely.
 * rsprox captures (recording 3389):
 * - Opening: the open-chest animation, and the tick after sound 52 (range 5), "Some cavern
 *   grubs have hatched; you take them." and the hatched chest (29745), locked again about 12
 *   ticks later. A full stack: "You don't have space to take any more grubs from the chest."
 *   in a message box.
 * - Depositing: 832 and sound 3637 (range 5), every grub held, no message; the trough fills
 *   (29874) the tick after.
 * - The scavenger's hunger is headbar 7 (100 to 0 as it eats what it needs). It eats every 3
 *   ticks (7496); fed, it walks aside the tick after, yawns 7 ticks later (7497, "Yawwwwwn!",
 *   sound 1734), sleeps (7603) at 14 and from 21 shows gfx 277 with sound 869 every 8 ticks.
 * Not on the Wiki (to check against a capture): the scavenger's tiles (by the room's version
 *   and turn) and where it sleeps; how much it eats at once (min(5, grubs/6), at least 1); the
 *   poison chests (gfx 184, locked again 10 ticks later) and the bats' chest (29743); Thieving
 *   XP 40 / 60 / 73 by grubs; the creature keeper's body giving his journal.
 * Not from a source: the batch on clearing (7 / 7 / 5, as the Ice Demon's) and the XP for 4
 *   grubs (as 3).
 */

const Shared = require("./CoxShared");
const Raid = require("./CoxRaid");
const Supplies = require("./Supplies.ChambersOfXeric");

const OBJECT = { CHEST: 29742, CHEST_EMPTY: 29743, CHEST_GRUBS: 29745, TROUGH: 29746, TROUGH_FULL: 29874, KEEPER: 29875 };
const NPC = { SCAVENGER: 7602, ASLEEP: 7603 };
const ITEM = { GRUBS: 20885, JOURNAL: 20886, PSYKK_BAT: 20883, LOCKPICKS: [1523, 11682] };
const GRUB_CAP = 28;
const POINTS_PER_GRUB = 115;
const HUNGER_TICKS = 100;
const HUNGER = { HEADBAR: 7, WIDTH: 100, EAT_EVERY: 3 };
/** Ticks from being fed: the yawn, sleep, and the snoring from then every 8 ticks. */
const SLEEP = { YAWN: 7, ASLEEP: 14, SNORE: 21, SNORE_EVERY: 8 };
const POISON_CHESTS = 3;
const GRUB_XP = [40, 60, 73, 73];
const CLEAR_REWARD = [[20910, 7], [20911, 7], [20912, 5]];

/** Cache tiles by version: where the scavenger stands by the room's turn (0-3), then where it sleeps. */
const SCAVENGER_TILES = [
  [{ x: 3271, y: 5390 }, { x: 3272, y: 5390 }, { x: 3272, y: 5391 }, { x: 3271, y: 5391 }, { x: 3271, y: 5394 }],
  [{ x: 3318, y: 5397 }, { x: 3319, y: 5397 }, { x: 3319, y: 5398 }, { x: 3318, y: 5398 }, { x: 3321, y: 5398 }],
  [{ x: 3350, y: 5397 }, { x: 3351, y: 5397 }, { x: 3351, y: 5398 }, { x: 3350, y: 5398 }, { x: 3351, y: 5394 }],
];

/** Wiki (Mod Ash): 39% at 1 to 61% at 99, +21 points with a lockpick. */
function openChance(level, lockpick) {
  const clamped = Math.min(99, Math.max(1, level));
  return 0.39 + ((clamped - 1) * 0.22) / 98 + (lockpick ? 0.21 : 0);
}

/** Wiki (Mod Ash): a random 0 to level/25, raised to the minimum (1, or 2 at 95+). */
function grubsFound(level) {
  const rolled = Shared.random(0, Math.floor(level / 25));
  return Math.max(level >= 95 ? 2 : 1, rolled);
}

function key(location) {
  return `${location.getX()},${location.getY()}`;
}

class ThievingRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.chests = new Map();
    this.trough = { grubs: 0, object: null };
    this.eaten = 0;
    this.hunger = 0;
    this.ticks = 0;
    this.fed = false;
    this.grubPoints = 0;
  }

  load() {
    const chests = Shared.shuffle(this.templateObjects(OBJECT.CHEST));
    this.batChest = chests[0] ? key(chests[0].getLocation()) : null;
    this.poisonChests = new Set(chests.slice(1, 1 + POISON_CHESTS).map((chest) => key(chest.getLocation())));
    const variant = this.record.variant;
    const at = SCAVENGER_TILES[variant][this.record.rotation];
    this.scavenger = this.spawnNpc(NPC.SCAVENGER, this.tile(at.x, at.y, 2), { scale: false });
    this.blockScavenger(true);
    const raiders = this.raid.scale;
    this.needed = raiders === 1 ? 30 : 16 * raiders;
    const thieving = [...this.raid.players].reduce((sum, player) => sum + Shared.baseLevel(player, "THIEVING"), 0);
    this.pointsCap = Math.max(4500, Math.floor(thieving / 6) * 150);
  }

  /** Where the awake scavenger stands nobody walks (the tiles are marked its tiles as floor). */
  blockScavenger(on) {
    const npc = this.scavenger;
    if (!npc) return;
    const { RegionManager } = Shared.core();
    const base = npc.getLocation();
    for (let dx = 0; dx < npc.getSize(); dx++) {
      for (let dy = 0; dy < npc.getSize(); dy++) {
        const args = [base.getX() + dx, base.getY() + dy, base.getZ(), RegionManager.BLOCKED_TILE, this.map];
        if (on) RegionManager.addClipping(...args);
        else RegionManager.removeClipping(...args);
      }
    }
  }

  canPass(player, passage) {
    if (this.fed || !this.scavenger || !passage) return true;
    if (passage.getLocation().getDistance(this.scavenger.getLocation()) > 7) return true;
    player.sendMessage("You need to feed the corrupted scavenger to pass to the next room.");
    return false;
  }

  tick() {
    for (const [at, chest] of this.chests) {
      if (chest.relockAt != null && this.raid.ticks >= chest.relockAt) {
        chest.object = Shared.replaceObject(this.map, chest.object, OBJECT.CHEST);
        this.chests.delete(at);
      }
    }
    if (this.fed || !this.scavenger) return;
    this.scavenger.showHeadbar(HUNGER.HEADBAR, { fill: Math.max(0, Math.floor((HUNGER.WIDTH * (this.needed - this.eaten)) / this.needed)) });
    if (this.ticks++ % HUNGER.EAT_EVERY !== 0) return;
    if (this.trough.grubs > 0) {
      const amount = Math.max(1, Math.min(5, Math.floor(this.trough.grubs / 6), this.trough.grubs));
      this.trough.grubs -= amount;
      this.eaten += amount;
      this.hunger = 0;
      Shared.animate(this.scavenger, 7496);
      if (this.trough.grubs <= 0 && this.trough.object) this.trough.object = Shared.replaceObject(this.map, this.trough.object, OBJECT.TROUGH);
      if (this.eaten >= this.needed) {
        this.scavenger.showHeadbar(HUNGER.HEADBAR, { fill: 0 });
        this.fallAsleep();
      }
      return;
    }
    // Wiki: hunger returns after 60 seconds without food.
    if ((this.hunger += 4) >= HUNGER_TICKS && this.eaten > 0) this.eaten--;
  }

  fallAsleep() {
    this.fed = true;
    this.completed = true;
    const npc = this.scavenger;
    this.blockScavenger(false);
    const bed = SCAVENGER_TILES[this.record.variant][4];
    Shared.later(this.raid, 1, () => {
      Shared.animate(npc, -1);
      Shared.walkStraight(npc, this.tile(bed.x, bed.y, 2));
    });
    Shared.later(this.raid, SLEEP.YAWN, () => {
      if (!npc.isRegistered()) return;
      npc.forceChat("Yawwwwwn!");
      Shared.animate(npc, 7497);
      Shared.areaSound(this.raiders(), 1734, npc.getLocation(), { delay: 10, range: 5 });
    });
    Shared.later(this.raid, SLEEP.ASLEEP, () => {
      if (!npc.isRegistered()) return;
      npc.setNpcTransformationId(NPC.ASLEEP);
      Shared.animate(npc, -1);
    });
    const snore = () => {
      if (!npc.isRegistered() || this.raid.destroyed) return false;
      npc.performGraphic(Shared.gfx(277));
      Shared.areaSound(this.raiders(), 869, npc.getLocation(), { range: 8 });
      return true;
    };
    Shared.later(this.raid, SLEEP.SNORE, () => snore() && Shared.repeat(this.raid, SLEEP.SNORE_EVERY, snore));
    const { Item, ItemOnGroundManager } = Shared.core();
    for (const player of this.raiders()) {
      for (const [id, amount] of CLEAR_REWARD) ItemOnGroundManager.registerLocation(player, new Item(id, amount), player.getLocation().clone());
    }
  }

  deposit(player, object) {
    if (this.fed) {
      player.sendMessage("That's not going to help now.");
      return;
    }
    const held = player.getInventory().getAmount(ITEM.GRUBS);
    if (held <= 0) {
      player.sendMessage("You need some cavern grubs to feed the scavenger.");
      return;
    }
    const amount = Math.min(GRUB_CAP, held);
    player.getInventory().delete(ITEM.GRUBS, held);
    Shared.animate(player, 832);
    Shared.areaSound(this.raiders(), 3637, player.getLocation(), { range: 5 });
    this.trough.grubs += amount;
    Shared.later(this.raid, 1, () => {
      if (this.trough.grubs > 0 && (!this.trough.object || this.trough.object.getId() !== OBJECT.TROUGH_FULL)) {
        this.trough.object = Shared.replaceObject(this.map, this.trough.object ?? object, OBJECT.TROUGH_FULL);
      }
    });
    const points = Math.max(0, Math.min(this.pointsCap - this.grubPoints, amount * POINTS_PER_GRUB));
    this.grubPoints += points;
    this.raid.addPoints(player, points);
  }

  /** One opening attempt; true to try again next tick. */
  tryChest(player, object) {
    const at = key(object.getLocation());
    if (this.chests.has(at)) {
      player.sendMessage("The chest is already opened.");
      return false;
    }
    if (player.getInventory().getFreeSlots() <= 0 && !Shared.has(player, ITEM.GRUBS)) {
      Shared.statement(player, "You wouldn't have space to take anything from the chest.");
      return false;
    }
    Shared.animate(player, 536);
    Shared.sound(player, 2402);
    const lockpick = ITEM.LOCKPICKS.some((id) => Shared.has(player, id));
    if (Math.random() >= openChance(Shared.level(player, "THIEVING"), lockpick)) return true;
    Shared.later(player, 1, () => this.openChest(player, object, at));
    return false;
  }

  openChest(player, object, at) {
    if (at === this.batChest) {
      const bats = Math.max(5, Math.min(25, this.raid.scale));
      this.chests.set(at, { object: Shared.replaceObject(this.map, object, OBJECT.CHEST_EMPTY), relockAt: null });
      this.batChest = null;
      Shared.sound(player, 2655);
      player.sendMessage("The chest contained some nicely cooked bats.");
      Shared.give(player, ITEM.PSYKK_BAT, bats);
      for (let i = 0; i < bats; i++) Supplies.recordMade(this.raid, Supplies.supplyKey(ITEM.PSYKK_BAT), player);
      return;
    }
    if (this.chests.has(at)) return;
    Shared.areaSound(this.raiders(), 52, object.getLocation(), { range: 5 });
    if (this.poisonChests.has(at)) {
      for (const raider of this.raiders()) {
        if (raider.getLocation().getDistance(player.getLocation()) <= 1) Shared.damage(raider, Shared.random(1, 3));
      }
      Shared.sound(player, 2138);
      Shared.graphicAt(this.raiders(), 184, object.getLocation());
      this.chests.set(at, { object: Shared.replaceObject(this.map, object, OBJECT.CHEST_EMPTY), relockAt: this.raid.ticks + 10 });
      return;
    }
    const held = player.getInventory().getAmount(ITEM.GRUBS);
    if (held >= GRUB_CAP) {
      Shared.statement(player, "You don't have space to take any more grubs from the chest.");
      return;
    }
    const amount = Math.min(grubsFound(Shared.level(player, "THIEVING")), GRUB_CAP - held);
    player.sendMessage("Some cavern grubs have hatched; you take them.");
    Shared.give(player, ITEM.GRUBS, amount);
    Shared.addXp(player, "THIEVING", GRUB_XP[amount - 1] ?? GRUB_XP[0]);
    this.chests.set(at, { object: Shared.replaceObject(this.map, object, OBJECT.CHEST_GRUBS), relockAt: this.raid.ticks + 12 });
  }
}

Raid.registerRoom("CREATURE_KEEPER", ThievingRoom);

function roomOf(player) {
  const room = Raid.raidOf(player)?.roomAt(player.getLocation());
  return room instanceof ThievingRoom ? room : null;
}

function openChest(event) {
  const { player, object } = event;
  const room = roomOf(player);
  if (!room) return false;
  if (room.tryChest(player, object)) Shared.action(player, { first: 1, interval: 1, step: () => room.tryChest(player, object) });
  return true;
}

function useTrough(event) {
  const room = roomOf(event.player);
  if (!room) return false;
  room.deposit(event.player, event.object);
  return true;
}

function searchKeeper(event) {
  const { player } = event;
  if (!Raid.raidOf(player)) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You need some more free space to search the body.");
    return true;
  }
  if (Shared.has(player, ITEM.JOURNAL)) {
    Shared.statement(player, "You already have a journal.");
    return true;
  }
  Shared.give(player, ITEM.JOURNAL);
  Shared.statement(player, "You find the creature keeper's journal.");
  return true;
}

function lockpickOnChest(event) {
  const id = event.objectId ?? event.object?.getId?.();
  if (event.handled || id !== OBJECT.CHEST || !ITEM.LOCKPICKS.includes(event.itemId)) return;
  if (openChest(event) !== false) event.handled = true;
}

module.exports = function registerCoxThieving(api) {
  Shared.bind(api);
  Shared.onObjectIds(api, [OBJECT.CHEST], openChest);
  Shared.onObjectIds(api, [OBJECT.TROUGH, OBJECT.TROUGH_FULL], useTrough);
  Shared.onObjectIds(api, [OBJECT.KEEPER], searchKeeper);
  api.onItemOnObject(lockpickOnChest);
};

Object.assign(module.exports, { ThievingRoom, openChance, grubsFound });
