"use strict";

const {
  api, Animation, GameObject, HitDamage, HitMask, Location, Misc, PluginManager, Skill, ItemIdentifiers,
  DialogueChainBuilder, StatementDialogue,
} = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// The house dungeon, oubliette and treasure room. Guard, guardian and trap levels, the treasure
// chest limits and the door odds are the OSRS Wiki's; the trap and hazard damage and the
// locked-door messages are not on the Wiki or in captures and are this server's.

// Monster furniture is a statue-like loc while building and its NPC otherwise (same gameval name).
const MONSTERS = Object.fromEntries(Object.entries({
  SKELETON_GUARD: "poh_skeleton", GUARD_DOG: "poh_guarddog", HOBGOBLIN: "poh_hobgoblin", TROLL_GUARD: "poh_troll",
  HUGE_SPIDER: "poh_giantspider", HELLHOUND: "poh_hellhound", BABY_RED_DRAGON: "poh_babyreddragon",
  KALPHITE_SOLDIER: "poh_kalphite_soldier", STEEL_DRAGON: "poh_steel_dragon", DAGANNOTH: "poh_dagganoth", TOK_XIL: "poh_tok_xil",
  DEMON: "poh_demon", ROCNAR: "poh_oub_monster1", RUNE_DRAGON: "poh_rune_dragon",
}).map(([key, name]) => [key, Ids.npc(name)]));
const GUARDIANS = new Set(["DEMON", "KALPHITE_SOLDIER", "TOK_XIL", "DAGANNOTH", "STEEL_DRAGON", "RUNE_DRAGON"]);
const GUARD_REACH = 4;

// Doors: closed leaves and their open locs (left, right); Wiki odds to pick (no lockpick / with
// one) and force, interpolated from level 1 to 99, and the experience for a success.
function openDoors(wood) {
  return [Ids.loc(`poh_dungeon_ldoor_${wood}_open`), Ids.loc(`poh_dungeon_rdoor_${wood}_open`)];
}
const DOORS = {
  OAK_DOOR: { open: openDoors("oak"), pick: [4, 98], lockpick: [24, 98], xp: 10 },
  STEEL_PLATED_DOOR: { open: openDoors("steel"), pick: [2.3, 49.2], lockpick: [21.9, 49.2], xp: 15 },
  MARBLE_DOOR: { open: openDoors("marble"), pick: [1.17, 19.92], lockpick: [20.7, 19.92], xp: 20 },
};
// Oubliette cages: their door locs open the same way, as hard as the doors their metal matches.
function openCage(kind) {
  return Ids.loc(`poh_cage_dungeon_${kind}_door_open`);
}
const CAGES = {
  OAK_CAGE: { open: [openCage("oak")], door: "OAK_DOOR" }, OAK_AND_STEEL_CAGE: { open: [openCage("oak+steel")], door: "STEEL_PLATED_DOOR" },
  STEEL_CAGE: { open: [openCage("steel")], door: "STEEL_PLATED_DOOR" }, SPIKED_CAGE: { open: [openCage("steel+spikes")], door: "MARBLE_DOOR" },
  BONE_CAGE: { open: [openCage("bones")], door: "MARBLE_DOOR" },
};
const LOCKPICK = ItemIdentifiers.LOCKPICK;
const DOOR_OFFSETS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

const TRAPS = new Set(["SPIKE_TRAP", "MAN_TRAP", "TANGLE_VINE", "MARBLE_TRAP", "TELEPORT_TRAP"]);
const TANGLE_TICKS = 8;
const OUBLIETTE_FLOORS = { SPIKES: [1, 5], TENTACLE_POOL: [1, 3], FLAME_PIT: [2, 8] };
const OUBLIETTE_FLOOR_KEYS = new Set(Object.keys(OUBLIETTE_FLOORS));
const HAZARD_INTERVAL = 4;

// Treasure chests act as one store, as large as the best chest built (Wiki), filled every 5 minutes.
const CHEST_LIMITS = { WOODEN_CRATE: 10000, OAK_CHEST: 20000, TEAK_CHEST: 50000, MAHOGANY_CHEST: 75000, MAGIC_CHEST: 100000 };
const TREASURE_COOLDOWN_MS = 5 * 60 * 1000;
const COINS = ItemIdentifiers.COINS;

/** house -> { monsters: Map(npc -> entry), dead: Set(furniture), openDoors: Map(key -> objects), challenge, trapped: Map(player -> tile) } */
const states = new WeakMap();

function stateOf(house) {
  let state = states.get(house);
  if (!state) states.set(house, state = { monsters: new Map(), dead: new Set(), openDoors: new Map(), challenge: false, lastTile: new WeakMap() });
  return state;
}

function say(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function isGuest(house, player) {
  return house.owner !== player;
}

// Monsters

/** Instance.rebuild: monsters stand in for their furniture outside building mode. */
function refreshMonsters(house) {
  const state = stateOf(house);
  if (house.buildingMode) {
    for (const [npc, entry] of state.monsters) despawn(house, npc, entry);
    state.dead.clear();
    return;
  }
  const spawned = new Set([...state.monsters.values()].map(entry => entry.furniture));
  for (const entry of house.furnitureEntries()) {
    const npcId = MONSTERS[entry.furniture.buildableKey];
    if (!npcId || spawned.has(entry.furniture) || state.dead.has(entry.furniture)) continue;
    const npc = PluginManager.spawnNpc({ id: npcId, x: entry.location.getX(), y: entry.location.getY(), z: entry.location.getZ(), wanderRadius: 0 });
    if (!npc) continue;
    npc.__skipDefaultRespawn = true; // back when the house next loads, not inside a closed instance
    house.enter(npc);
    state.monsters.set(npc, entry);
    house.hideFurniture(entry.furniture);
  }
}

function despawn(house, npc, entry) {
  stateOf(house).monsters.delete(npc);
  if (npc.isRegistered()) {
    house.leave(npc, false);
    PluginManager.removeNpc(npc);
  }
  house.showFurniture(entry.furniture);
}

function monsterDied({ npc }) {
  const house = npc?.getPrivateArea?.();
  const state = house && states.get(house);
  const entry = state?.monsters.get(npc);
  if (!entry) return;
  state.monsters.delete(npc);
  state.dead.add(entry.furniture);
}

function guardianAlive(house, roomPosition) {
  for (const entry of stateOf(house).monsters.values()) {
    if (GUARDIANS.has(entry.furniture.buildableKey) && sameRoom(entry.position, roomPosition)) return true;
  }
  return false;
}

function sameRoom(a, b) {
  return a.x === b.x && a.y === b.y && a.plane === b.plane;
}

// Challenge mode (the throne room lever's second op)

function setChallengeMode(house, on) {
  stateOf(house).challenge = on;
}

function inChallengeMode(house) {
  return states.get(house)?.challenge === true;
}

/** PlayerHouseInstance.process for each occupant: guards, traps and oubliette hazards. */
function processOccupant(player, house) {
  const state = states.get(house);
  if (!state || !isGuest(house, player) || house.buildingMode) return;
  const at = player.getLocation();
  if (state.challenge) {
    for (const [npc] of state.monsters) {
      if (npc.isRegistered() && !npc.getCombat().getTarget() && npc.getLocation().getZ() === at.getZ()
        && npc.getLocation().getDistance(at) <= GUARD_REACH) npc.getCombat().attack(player);
    }
    const last = state.lastTile.get(player);
    if (!last || !last.equals(at)) {
      state.lastTile.set(player, at.clone());
      const trap = furnitureOn(house, at, TRAPS);
      if (trap) springTrap(player, house, trap.furniture.buildableKey, last);
    }
  }
  if (Misc.getRandom(HAZARD_INTERVAL - 1) === 0) {
    const floor = furnitureOn(house, at, OUBLIETTE_FLOOR_KEYS);
    if (floor) hurt(player, OUBLIETTE_FLOORS[floor.furniture.buildableKey]);
  }
}

function furnitureOn(house, at, keys) {
  return house.furnitureEntries().find(entry => keys.has(entry.furniture.buildableKey) && entry.location.equals(at)) ?? null;
}

function hurt(player, [min, max]) {
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(min + Misc.getRandom(max - min), HitMask.RED)]);
}

/** Higher Agility dodges more often (Wiki); the odds are this server's. */
function springTrap(player, house, trap, from) {
  if (Misc.getRandom(199) < player.getSkillManager().getCurrentLevel(Skill.AGILITY)) {
    player.sendMessage("You avoid the trap.");
    return;
  }
  switch (trap) {
    case "SPIKE_TRAP":
      hurt(player, [2, 6]);
      if (from) player.moveTo(from);
      player.sendMessage("Spikes shoot out of the floor!");
      break;
    case "MAN_TRAP":
      hurt(player, [9, 12]); // Wiki: 9-12
      player.sendMessage("A trap snaps shut on your leg!");
      break;
    case "TANGLE_VINE":
      player.getMovementQueue().setBlockMovement(true).reset();
      api.getTaskManager().submit(new api.core.CountdownTask(player, TANGLE_TICKS, () => player.getMovementQueue().setBlockMovement(false)));
      player.sendMessage("Vines tangle around your legs!");
      break;
    case "MARBLE_TRAP":
      player.getSkillManager().setCurrentLevel(Skill.AGILITY, Math.max(0, player.getSkillManager().getCurrentLevel(Skill.AGILITY) - 3), true);
      player.sendMessage("A marble block falls on you, leaving you bruised.");
      break;
    case "TELEPORT_TRAP": {
      const oubliette = house.furnitureEntries().find(entry => entry.room.roomKey === "OUBLIETTE");
      if (oubliette) player.moveTo(oubliette.location);
      player.sendMessage("You are teleported into the oubliette!");
      break;
    }
  }
}

// Doors and cage doors

function doorAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const door = furniture && (DOORS[furniture.buildableKey] ?? CAGES[furniture.buildableKey]);
  return door ? { house, furniture, door: DOORS[door.door] ?? door, opens: door.open } : null;
}

function plain(location) {
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

/** The drawn leaves of a door's hotspot in the room at `at`, with their furniture. */
function leavesOf(house, furniture, at) {
  const room = house.getRoomPositionAt(at);
  return house.furnitureObjects.map(object => ({ object, furniture: house.getFurnitureAt(plain(object.getLocation()), object.getId(), object.getType()) }))
    .filter(({ object, furniture: leaf }) => leaf?.hotspotKey === furniture.hotspotKey && sameRoom(house.getRoomPositionAt(plain(object.getLocation())) ?? {}, room));
}

function openDoor(house, furniture, opens, at) {
  const state = stateOf(house);
  const room = house.getRoomPositionAt(at);
  const key = `${room.x}:${room.y}:${room.plane}:${furniture.hotspotKey}`;
  if (state.openDoors.has(key)) return;
  const leaves = leavesOf(house, furniture, at);
  // Each leaf swings out to its outer hinge, as the house's own doors do.
  const opened = leaves.map(({ object }, side) => {
    const face = object.getFace();
    const [dx, dy] = DOOR_OFFSETS[face];
    return new GameObject(opens[Math.min(side, opens.length - 1)], object.getLocation().transform(dx, dy), object.getType(), (face + (side ? 3 : 1)) & 3, house);
  });
  for (const leaf of leaves) house.hideFurniture(leaf.furniture);
  for (const object of opened) house.addExtraObject(object);
  state.openDoors.set(key, { opened, leaves: leaves.map(leaf => leaf.furniture) });
}

function closeDoor(event) {
  const house = House.houseFor(event.player);
  if (!house) return false;
  const state = stateOf(house);
  for (const [key, door] of state.openDoors) {
    if (!door.opened.some(object => object.getId() === event.objectId && object.getLocation().getX() === event.location.x && object.getLocation().getY() === event.location.y)) continue;
    state.openDoors.delete(key);
    for (const object of door.opened) house.removeExtraObject(object);
    for (const leaf of door.leaves) house.showFurniture(leaf);
    return true;
  }
  return false;
}

function locked(house, player) {
  return inChallengeMode(house) && isGuest(house, player);
}

function useDoor(event) {
  const found = doorAt(event);
  if (!found) return false;
  if (locked(found.house, event.player)) {
    event.player.sendMessage("The door is locked.");
    return true;
  }
  openDoor(found.house, found.furniture, found.opens, event.location);
  return true;
}

function chance([low, high], level) {
  return (low + (high - low) * (Math.min(99, level) - 1) / 98) / 100;
}

function breakIn(event, skill) {
  const found = doorAt(event);
  if (!found) return false;
  const player = event.player;
  if (!locked(found.house, player)) {
    player.sendMessage("The door is not locked.");
    openDoor(found.house, found.furniture, found.opens, event.location);
    return true;
  }
  const level = player.getSkillManager().getCurrentLevel(skill);
  const odds = skill === Skill.THIEVING && player.getInventory().contains(LOCKPICK) ? found.door.lockpick : found.door.pick;
  if (Math.random() >= chance(odds, level)) {
    player.sendMessage(skill === Skill.THIEVING ? "You fail to pick the lock." : "You fail to force the door open.");
    return true;
  }
  player.getSkillManager().addExperiences(skill, found.door.xp);
  player.sendMessage(skill === Skill.THIEVING ? "You pick the lock." : "You force the door open.");
  openDoor(found.house, found.furniture, found.opens, event.location);
  return true;
}

function pickLock(event) { return breakIn(event, Skill.THIEVING); }
function force(event) { return breakIn(event, Skill.STRENGTH); }

// Treasure room

function treasureOf(house) {
  return house.save.treasure ??= { coins: 0, addedAt: 0 };
}

function chestLimit(house) {
  return Math.max(0, ...house.furnitureEntries().map(entry => CHEST_LIMITS[entry.furniture.buildableKey] ?? 0));
}

function isChest(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture && CHEST_LIMITS[furniture.buildableKey] !== undefined ? { house, roomPosition: house.getRoomPositionAt(event.location) } : null;
}

function openChest(event) {
  const chest = isChest(event);
  if (!chest) return false;
  const { house } = chest;
  const player = event.player;
  const treasure = treasureOf(house);
  if (!isGuest(house, player)) {
    if (inChallengeMode(house)) player.sendMessage("Only guests can open the chest when the house is in challenge mode.");
    else say(player, `Amount of treasure: <col=ff0000>${treasure.coins.toLocaleString("en-US")}</col>`);
    return true;
  }
  if (!inChallengeMode(house)) return player.sendMessage("The chest is locked."), true;
  if (guardianAlive(house, chest.roomPosition)) return player.sendMessage("You must defeat the guardian first."), true;
  if (treasure.coins <= 0) return say(player, "The chest is empty."), true;
  const coins = treasure.coins;
  treasure.coins = 0;
  player.getInventory().adds(COINS, coins);
  House.saveHouse(house);
  player.sendMessage(`You find ${coins.toLocaleString("en-US")} coins in the chest!`);
  house.owner?.sendMessage(`${player.getDisplayName()} has won ${coins.toLocaleString("en-US")} coins from your treasure chest.`);
  return true;
}

function coinsOnChest(event) {
  if (event.itemId !== COINS) return;
  const chest = isChest(event);
  if (!chest) return;
  event.handled = true;
  const { house } = chest;
  const player = event.player;
  if (isGuest(house, player)) return player.sendMessage("Only the house owner can add treasure.");
  const treasure = treasureOf(house);
  const wait = treasure.addedAt + TREASURE_COOLDOWN_MS - Date.now();
  if (wait > 0) return player.sendMessage(`You can add more treasure in ${Math.ceil(wait / 60000)} minutes.`);
  const space = chestLimit(house) - treasure.coins;
  const amount = Math.min(space, player.getInventory().getAmount(COINS));
  if (amount <= 0) return player.sendMessage("Your treasure chests can't hold any more coins.");
  player.getInventory().delete(COINS, amount);
  treasure.coins += amount;
  treasure.addedAt = Date.now();
  House.saveHouse(house);
  player.sendMessage(`You add ${amount.toLocaleString("en-US")} coins to your treasure.`);
}

function attachDungeon(api) {
  api.onObjectInteraction("Door", { Open: useDoor, Close: closeDoor, "Pick-lock": pickLock, Force: force });
  for (const name of ["Wooden crate", "Oak chest", "Teak chest", "Mahogany chest", "Magic chest"]) api.onObjectInteraction(name, { Open: openChest });
  api.onItemOnObject(coinsOnChest);
  api.onNpcDeath(monsterDied);
}

Object.assign(module.exports, { attachDungeon, refreshMonsters, processOccupant, setChallengeMode, inChallengeMode, isGuest });
