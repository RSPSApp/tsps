"use strict";

/**
 * Castle Wars doors.
 *
 * Large doors: defenders open and close them freely (plugins/objects/Doors.plugin.js does
 * the swinging); attackers have to batter them down. Every attacker chips at one shared
 * 100 hitpoint pool (OSRS Wiki: Large door (Castle Wars)), and at 0 both leaves fall into
 * broken doors that a defender repairs with a toolkit, which is not used up.
 *
 * Side doors: defenders lock and unlock them; an attacker on the outside has to pick the lock.
 *
 * Cache locs: large doors 4423/4424 (2426-2427,3088) and 4427/4428 (2372-2373,3119); side doors
 * 4465 (2415,3073) and 4467 (2384,3134), unlocked variants 4466/4468.
 * RSPS-only (Near-Reality): the broken leaves' tiles and rotations, the 1-15 damage per swing,
 * the 1-in-6 pick-lock chance and the refusal messages - the Wiki gives none of them.
 */

const DOOR_MAX_HEALTH = 100;
// ponytail: fixed swing speed and damage; the Wiki says crush hits harder, stab weakest.
const DOOR_SWING_TICKS = 4;
const DOOR_HIT_MIN = 1;
const DOOR_HIT_MAX = 15;
const PICK_LOCK_CHANCE = 6;
const COORD_OFFSETS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

let game;
let core;

const attackers = new WeakMap();
const openSideDoors = new Map();

function largeDoors() {
  const O = core.ObjectIdentifiers;
  return {
    [game.TEAM.SARADOMIN]: {
      leaves: [[O.LARGE_DOOR_24, 2426, 3088, 3], [O.LARGE_DOOR_25, 2427, 3088, 3]],
      broken: [[O.BROKEN_DOOR_2, 2426, 3087, 0], [O.BROKEN_DOOR, 2427, 3087, 2]],
      isInside: (player) => player.getLocation().getY() < 3088,
    },
    [game.TEAM.ZAMORAK]: {
      leaves: [[O.LARGE_DOOR_28, 2373, 3119, 1], [O.LARGE_DOOR_29, 2372, 3119, 1]],
      broken: [[O.BROKEN_DOOR_4, 2373, 3120, 2], [O.BROKEN_DOOR_3, 2372, 3120, 0]],
      isInside: (player) => player.getLocation().getY() > 3119,
    },
  };
}

function sideDoors() {
  const O = core.ObjectIdentifiers;
  return {
    [game.TEAM.SARADOMIN]: { lockedId: O.DOOR_125, openId: O.DOOR_126, isInside: (player) => player.getLocation().getX() >= 2415 },
    [game.TEAM.ZAMORAK]: { lockedId: O.DOOR_127, openId: O.DOOR_128, isInside: (player) => player.getLocation().getX() <= 2384 },
  };
}

function ownerOf(table, objectId, idsOf) {
  return Object.keys(table).find((teamId) => idsOf(table[teamId]).includes(objectId)) ?? null;
}

const leafIds = (door) => door.leaves.map(([id]) => id);
const brokenIds = (door) => door.broken.map(([id]) => id);
const lockedIds = (door) => [door.lockedId];
const openIds = (door) => [door.openId];

function objectAt([id, x, y, face]) {
  return new core.GameObject(id, new core.Location(x, y, 0), 0, face, null);
}

function hasToolkit(player) {
  return player.getInventory().contains(core.ItemIdentifiers.TOOLKIT_2);
}

function guardLargeDoor(request) {
  const { player, objectId } = request;
  const owner = ownerOf(largeDoors(), objectId, leafIds);
  if (!owner || !game.isPlaying(player) || game.getTeamId(player) === owner || largeDoors()[owner].isInside(player)) {
    return;
  }
  player.sendMessage("You can't open the other team's door, you have to attack it!");
  request.handled = true;
}

function attackDoor({ player, objectId }) {
  const owner = ownerOf(largeDoors(), objectId, leafIds);
  if (!owner) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) === owner) {
    player.sendMessage("You don't want to damage your own door!");
    return true;
  }
  attackers.set(player, { owner, from: player.getLocation().clone(), ticks: 0 });
  return true;
}

function breakDoor(owner) {
  const door = largeDoors()[owner];
  door.leaves.forEach((leaf, index) => {
    const standing = core.MapObjects.get(leaf[0], new core.Location(leaf[1], leaf[2], 0), null) ?? objectAt(leaf);
    game.swapObject(standing, objectAt(door.broken[index]));
  });
}

function swingAtDoor({ player }) {
  const attack = attackers.get(player);
  if (!attack) {
    return;
  }
  const health = game.getTeamVar(attack.owner, game.TEAM_VARBIT.DOOR_HEALTH);
  if (!game.isPlaying(player) || health <= 0 || !player.getLocation().equals(attack.from)) {
    attackers.delete(player);
    return;
  }
  if (attack.ticks++ % DOOR_SWING_TICKS !== 0) {
    return;
  }
  player.performAnimation(new core.Animation(player.getAttackAnim()));
  const remaining = Math.max(0, health - core.Misc.randomInclusive(DOOR_HIT_MIN, DOOR_HIT_MAX));
  game.setTeamVar(attack.owner, game.TEAM_VARBIT.DOOR_HEALTH, remaining);
  if (remaining === 0) {
    breakDoor(attack.owner);
    attackers.delete(player);
  }
}

function repairDoor({ player, objectId }) {
  const owner = ownerOf(largeDoors(), objectId, brokenIds);
  if (!owner) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) !== owner) {
    player.sendMessage("You don't want to repair the other team's door.");
    return true;
  }
  if (!hasToolkit(player)) {
    player.sendMessage("You need a toolkit to repair the door.");
    return true;
  }
  const door = largeDoors()[owner];
  door.broken.forEach((broken, index) => {
    const lying = core.MapObjects.get(broken[0], new core.Location(broken[1], broken[2], 0), null) ?? objectAt(broken);
    game.swapObject(lying, objectAt(door.leaves[index]));
  });
  game.setTeamVar(owner, game.TEAM_VARBIT.DOOR_HEALTH, DOOR_MAX_HEALTH);
  return true;
}

function openSideDoor(owner, object) {
  const location = object.getLocation();
  const face = object.getFace() & 3;
  const [dx, dy] = COORD_OFFSETS[face];
  const opened = new core.GameObject(
    sideDoors()[owner].openId,
    new core.Location(location.getX() + dx, location.getY() + dy, location.getZ()),
    object.getType(),
    (face + 1) & 3,
    null
  );
  game.swapObject(object, opened);
  openSideDoors.set(owner, { closed: object, opened });
  game.setTeamVar(owner, game.TEAM_VARBIT.DOOR_UNLOCKED, 1);
}

function unlockSideDoor({ player, object, objectId }) {
  const owner = ownerOf(sideDoors(), objectId, lockedIds);
  if (!owner) {
    return false;
  }
  if (!game.requirePlaying(player)) {
    return true;
  }
  if (game.getTeamId(player) === owner || sideDoors()[owner].isInside(player)) {
    openSideDoor(owner, object);
    return true;
  }
  if (core.Misc.randomInclusive(1, PICK_LOCK_CHANCE) !== 1) {
    player.sendMessage("You fail to pick the lock.");
    return true;
  }
  player.sendMessage("You successfully pick the lock.");
  openSideDoor(owner, object);
  return true;
}

function lockSideDoor({ player, objectId }) {
  const owner = ownerOf(sideDoors(), objectId, openIds);
  const door = openSideDoors.get(owner);
  if (!owner || !door || !game.isPlaying(player)) {
    return false;
  }
  game.swapObject(door.opened, door.closed);
  openSideDoors.delete(owner);
  game.setTeamVar(owner, game.TEAM_VARBIT.DOOR_UNLOCKED, 0);
  return true;
}

module.exports = function attachCastleWarsDoors(api, castleWars) {
  game = castleWars;
  core = api.core;
  api.onCustomEvent("door:toggle", guardLargeDoor);
  api.onObjectInteraction("Large door", { Attack: attackDoor });
  api.onObjectInteraction("Broken door", { Repair: repairDoor });
  api.onObjectInteraction("Door", { Unlock: unlockSideDoor, Lock: lockSideDoor });
  api.onPlayerProcess(swingAtDoor);
};
