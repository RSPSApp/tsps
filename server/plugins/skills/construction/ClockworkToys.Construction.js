"use strict";

const { Animation, CountdownTask, Item, ItemOnGroundManager, PluginManager, RegionManager, Sounds, Task, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// The clockwork toys made at the workshop's crafting table (rsprox captures, rev 229 recording
// 2598; rev 226/237 recordings 1695 and 1108 for the mouse):
// - Wind turns the toy into its wound form: "You wind up the soldier." (doll, mouse), synth 989.
// - Release, in building mode: "You cannot release clockwork toys while in building mode." and
//   the toy stays. Otherwise the wound toy leaves the inventory and walks off as an NPC: area
//   sound 941 (range 5) at the player, varbit poh_clockwork_recentdrop 0 -> 1, cleared 78 ticks
//   after the last release. The soldier and doll start on the tile the player faces, the mouse on
//   the player's own tile. The soldier and doll step every tick (941 at the tile left), the doll
//   turning now and then; the mouse waits 10 ticks, then runs diagonally with no sound.
// - Stopping: the soldier plays poh_toy_soldier_fallover (sound 988) and is gone a tick later;
//   the doll just stops. Either way the unwound toy lies on that tile for its owner for 99 ticks.
//   Captured walks lasted 3 to 75 ticks.
// - The varbit shows its owner the poh_toy_*_1op form, whose Pick-up takes the toy straight back
//   (unwound, area sound 941 at the toy); everyone else sees the 0op form with no options.
// Ours: how long a walk lasts (uniform over the captured 3-75 ticks), when the doll turns and
// pauses, the mouse's diagonal choice, turning at walls, and a toy whose owner logs out or
// leaves going back to their inventory.
const TOYS = [
  { kind: "soldier", unwound: "poh_toy_soldier_unwound", wound: "poh_toy_soldier_wound", npc: "poh_toy_soldier",
    stepSound: true, startDelay: 0, ahead: true, diagonal: false, turnChance: 0, pauseChance: 0, fall: "poh_toy_soldier_fallover" },
  { kind: "doll", unwound: "poh_toy_doll_unwound", wound: "poh_toy_doll_wound", npc: "poh_toy_doll",
    stepSound: true, startDelay: 0, ahead: true, diagonal: true, turnChance: 0.15, pauseChance: 0.15, fall: null },
  { kind: "mouse", unwound: "poh_toy_mouse_unwound", wound: "poh_toy_mouse_wound", npc: "poh_toy_mouse",
    stepSound: false, startDelay: 10, ahead: false, diagonal: true, turnChance: 0.2, pauseChance: 0, fall: null },
].map((toy) => ({
  ...toy,
  unwoundId: Ids.obj(toy.unwound),
  woundId: Ids.obj(toy.wound),
  npcId: Ids.npc(toy.npc),
  fallSeq: toy.fall ? Ids.seq(toy.fall) : -1,
}));
const BY_UNWOUND = new Map(TOYS.map((toy) => [toy.unwoundId, toy]));
const BY_WOUND = new Map(TOYS.map((toy) => [toy.woundId, toy]));
const BY_NPC = new Map(TOYS.map((toy) => [toy.npcId, toy]));

const RECENT_DROP_VARBIT = Ids.varbit("poh_clockwork_recentdrop");
const RECENT_DROP_TICKS = 78;
const WIND_SOUND = 989;
const STEP_SOUND = 941;
const FALL_SOUND = 988;
const SOUND_RANGE = 5;
const GROUND_TICKS = 99;
const MIN_WALK_TICKS = 3;
const MAX_WALK_TICKS = 75;

const STRAIGHT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const DIAGONAL = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

/** npc -> { toy, owner, task } */
const released = new Map();
/** player -> the latest release, so only the last one's timer clears the varbit */
const lastRelease = new WeakMap();

function wind({ player, itemId, slot }) {
  const toy = BY_UNWOUND.get(itemId);
  if (!toy) return false;
  const inventory = player.getInventory();
  const at = slotOf(inventory, itemId, slot);
  if (at < 0) return true;
  inventory.setItem(at, new Item(toy.woundId, 1)).refreshItems();
  player.sendMessage(`You wind up the ${toy.kind}.`);
  player.getPacketSender().sendSound(WIND_SOUND, 1, 0);
  return true;
}

function release({ player, itemId, slot }) {
  const toy = BY_WOUND.get(itemId);
  if (!toy) return false;
  const house = House.houseFor(player);
  if (house?.buildingMode) {
    player.sendMessage("You cannot release clockwork toys while in building mode.");
    return true;
  }
  const inventory = player.getInventory();
  const at = slotOf(inventory, itemId, slot);
  if (at < 0) return true;
  const here = player.getLocation();
  const heading = startHeading(player, toy);
  const start = toy.ahead && canStep(player, here, heading) ? here.transform(heading[0], heading[1]) : here.clone();
  const npc = PluginManager.spawnNpc({ id: toy.npcId, x: start.getX(), y: start.getY(), z: start.getZ(), wanderRadius: 0 });
  if (!npc) return true;
  npc.__skipDefaultRespawn = true;
  npc.setScriptedMovement?.(true);
  player.getPrivateArea()?.enter?.(npc);
  inventory.setItem(at, new Item(-1, 0)).refreshItems();
  markRecentDrop(player);
  Sounds.playAreaSound({ soundId: STEP_SOUND, x: here.getX(), y: here.getY(), level: here.getZ(), loops: 1, radius: SOUND_RANGE, source: player });
  const walk = new ToyWalk(npc, toy, player, heading);
  released.set(npc, { toy, owner: player, task: walk });
  TaskManager.submit(walk);
  return true;
}

/** The varbit that gives the owner the Pick-up form, cleared 78 ticks after the last release. */
function markRecentDrop(player) {
  const token = {};
  lastRelease.set(player, token);
  player.getPacketSender().sendVarbit(RECENT_DROP_VARBIT, 1);
  TaskManager.submit(new CountdownTask(player, RECENT_DROP_TICKS, () => {
    if (lastRelease.get(player) !== token) return;
    lastRelease.delete(player);
    player.getPacketSender().sendVarbit(RECENT_DROP_VARBIT, 0);
  }));
}

function startHeading(player, toy) {
  if (!toy.ahead) return randomFrom(toy.diagonal ? DIAGONAL : STRAIGHT);
  const facing = player.getFacingDirection?.();
  const dx = Math.sign(facing?.getX?.() ?? 0), dy = Math.sign(facing?.getY?.() ?? 0);
  if (dx === 0 && dy === 0) return [0, -1];
  return toy.diagonal || dx === 0 || dy === 0 ? [dx, dy] : [dx, 0];
}

/** The clicked slot when it still holds the item, else the item's first slot (-1 if gone). */
function slotOf(inventory, itemId, slot) {
  return Number.isInteger(slot) && inventory.getSlot(slot) === itemId ? slot : inventory.getSlotForItemId(itemId);
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Whether one step from `from` by `heading` is open, as the toy (size 1) walks. */
function canStep(entity, from, [dx, dy]) {
  return RegionManager.canMovestart(from, from.transform(dx, dy), 1, 1, entity.getPrivateArea());
}

class ToyWalk extends Task {
  constructor(npc, toy, owner, heading) {
    super(1, npc.getIndex(), false);
    this.npc = npc;
    this.toy = toy;
    this.owner = owner;
    this.heading = heading;
    this.ticks = 0;
    this.lasts = MIN_WALK_TICKS + Math.floor(Math.random() * (MAX_WALK_TICKS - MIN_WALK_TICKS + 1));
    this.falling = false;
  }

  execute() {
    const { npc, toy, owner } = this;
    if (released.get(npc)?.task !== this || !npc.isRegistered()) return this.stop();
    if (!owner.isRegistered?.() || owner.getPrivateArea() !== npc.getPrivateArea()) return returnToOwner(npc);
    this.ticks++;
    if (this.falling) return settle(npc, this);
    if (this.ticks >= this.lasts) {
      if (toy.fallSeq < 0) return settle(npc, this);
      this.falling = true;
      npc.getMovementQueue().reset();
      npc.performAnimation(new Animation(toy.fallSeq));
      const at = npc.getLocation();
      Sounds.playAreaSound({ soundId: FALL_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), loops: 1, radius: SOUND_RANGE, source: npc });
      return;
    }
    if (this.ticks <= toy.startDelay || Math.random() < toy.pauseChance) return;
    this.step();
  }

  step() {
    const { npc, toy } = this;
    const from = npc.getLocation();
    const choices = toy.diagonal ? [...STRAIGHT, ...DIAGONAL] : STRAIGHT;
    if (Math.random() < toy.turnChance) this.heading = randomFrom(choices);
    if (!canStep(npc, from, this.heading)) {
      const open = choices.filter((heading) => canStep(npc, from, heading));
      if (!open.length) return;
      this.heading = randomFrom(open);
    }
    npc.getMovementQueue().walkStep(this.heading[0], this.heading[1]);
    if (toy.stepSound) {
      Sounds.playAreaSound({ soundId: STEP_SOUND, x: from.getX(), y: from.getY(), level: from.getZ(), loops: 1, radius: SOUND_RANGE, source: npc });
    }
  }
}

function forget(npc) {
  const entry = released.get(npc);
  released.delete(npc);
  entry?.task?.stop();
  if (npc.isRegistered()) PluginManager.removeNpc(npc);
  return entry;
}

/** The walk ends: the unwound toy lies where it stopped, for its owner only. */
function settle(npc, task) {
  const at = npc.getLocation().clone();
  const { toy, owner } = forget(npc) ?? task;
  ItemOnGroundManager.registerLocation(owner, new Item(toy.unwoundId, 1), at, owner.getPrivateArea(),
    { goesGlobal: false, despawnDelay: GROUND_TICKS });
}

/** Ours: an owner who logs out or leaves gets the toy back in their inventory. */
function returnToOwner(npc) {
  const entry = forget(npc);
  if (!entry) return;
  const { toy, owner } = entry;
  if (owner.getInventory().getFreeSlots() > 0) owner.getInventory().adds(toy.unwoundId, 1);
  else ItemOnGroundManager.registerLocation(owner, new Item(toy.unwoundId, 1), owner.getLocation().clone(), owner.getPrivateArea());
}

function pickUp({ player, npc }) {
  const entry = released.get(npc);
  if (!entry || entry.owner !== player) return false;
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    return true;
  }
  const at = npc.getLocation();
  forget(npc);
  player.getInventory().adds(entry.toy.unwoundId, 1);
  Sounds.playAreaSound({ soundId: STEP_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), loops: 1, radius: SOUND_RANGE, source: player });
  return true;
}

function ownerLogout({ player }) {
  for (const [npc, entry] of [...released]) if (entry.owner === player) returnToOwner(npc);
}

function attachClockworkToys(api) {
  for (const name of ["Toy soldier", "Toy doll", "Toy mouse"]) api.onItemAction(name, { Wind: wind });
  for (const name of ["Toy soldier (wound)", "Toy doll (wound)", "Toy mouse (wound)"]) api.onItemAction(name, { Release: release });
  api.onNpcsInteraction(["Toy Soldier", "Toy Doll", "Toy Mouse"], { "Pick-up": pickUp });
  api.onPlayerLogout(ownerLogout);
}

Object.assign(module.exports, { attachClockworkToys, TOYS, BY_NPC, released });
