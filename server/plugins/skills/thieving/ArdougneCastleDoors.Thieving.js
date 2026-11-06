"use strict";

// OSRS Wiki: Door (Ardougne Castle), including its success chart and trap behavior.
const REQUIRED_LEVEL = 61;
const THIEVING_XP = 50;
const TRAP_LOW = 200;
const TRAP_HIGH = 270;
const LOCK_LOW = 4;
const LOCK_HIGH = 40;
const DOORS = new Map([
  ["2572,3288,1", { inside: (y) => y <= 3287 }],
  ["2572,3305,1", { inside: (y) => y >= 3306 }],
]);

let core;
let pluginApi;
let doorId;

function chanceNumerator(low, high, level) {
  const cappedLevel = Math.max(1, Math.min(99, Math.floor(level)));
  return Math.max(0, Math.min(256,
    1 + Math.floor(low * (99 - cappedLevel) / 98 + high * (cappedLevel - 1) / 98 + 0.5)));
}

function roll(low, high, level) {
  return Math.floor(Math.random() * 256) < chanceNumerator(low, high, level);
}

function locationOf(event) {
  const location = event.location ?? event.object?.getLocation?.();
  if (!location) return null;
  return {
    x: location.getX?.() ?? location.x,
    y: location.getY?.() ?? location.y,
    z: location.getZ?.() ?? location.z ?? 0,
  };
}

function isCastleDoor(event) {
  if (event.objectId !== doorId && event.object?.getId?.() !== doorId) return null;
  const location = locationOf(event);
  if (!location) return null;
  return DOORS.get(`${location.x},${location.y},${location.z}`) ?? null;
}

function openThroughDoors(event) {
  pluginApi.emitCustomEvent("door:open", {
    player: event.player,
    object: event.object,
    objectId: event.objectId,
    definition: event.definition,
    location: locationOf(event),
    clickType: event.clickType,
    handled: false,
  });
}

function maximumHitpoints(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
}

function tryPickLock(event) {
  const { player } = event;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  if (!roll(TRAP_LOW, TRAP_HIGH, level)) {
    const damage = Math.floor(maximumHitpoints(player) / 10);
    player.sendMessage("You trigger a trap and take damage.");
    player.getCombat().getHitQueue().addPendingDamage([
      new core.HitDamage(damage, core.HitMask.RED),
    ]);
  }

  if (level < REQUIRED_LEVEL) {
    player.sendMessage(`You need level ${REQUIRED_LEVEL} Thieving to pick this lock.`);
    return;
  }

  if (!roll(LOCK_LOW, LOCK_HIGH, level)) {
    player.sendMessage("You fail to pick the lock.");
    return;
  }

  player.getSkillManager().addExperiences(core.Skill.THIEVING, THIEVING_XP);
  openThroughDoors(event);
}

function handleCastleDoor(event) {
  const door = isCastleDoor(event);
  if (!door) return;
  const location = locationOf(event);
  const playerY = event.player.getLocation().getY();
  const inside = door.inside(playerY);
  const option = (event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1])?.toLowerCase();
  const boundaryY = location.y + (location.y === 3288 ? -1 : 1);
  const alreadyOpen = core.RegionManager.canMove(location.x, location.y,
    location.x, boundaryY, location.z, 1, 1, event.player.getPrivateArea?.() ?? null);

  if (alreadyOpen) {
    event.handled = true;
    return;
  }
  if (inside && option === "open") return;
  event.handled = true;
  if (inside) {
    openThroughDoors(event);
    return;
  }
  if (option === "open") {
    event.player.sendMessage("The door is locked from this side. Pick-lock it to open it.");
    return;
  }
  if (option === "pick-lock") tryPickLock(event);
}

function register(api) {
  core = api.core;
  pluginApi = api;
  doorId = core.ObjectIdentifiers.DOOR_283;
  api.onBeforeObjectInteraction(handleCastleDoor);
}

module.exports = { register, _test: { chanceNumerator, handleCastleDoor, isCastleDoor } };
