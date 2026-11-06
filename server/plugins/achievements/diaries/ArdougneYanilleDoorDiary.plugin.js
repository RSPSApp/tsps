"use strict";

const DIARY = "ardougne";
const TASK = "picklock-the-door-to-the-basement-of-yanille-agi";
const DOOR_TILE = Object.freeze({ x: 2601, y: 9482, z: 0 });
const DOOR_FACE = 3;
const INSIDE_Y = 9482;
const THIEVING_LEVEL = 82;
const THIEVING_XP = 50;
const LOW_SUCCESS_ROLL = 4;
const HIGH_SUCCESS_ROLL = 40;

let api;
let DOOR_ID;
let LOCKPICK_ID;
const PICKLOCK_OPENERS = new WeakSet();

function atDoor(object, location) {
  const tile = location ?? object?.getLocation?.();
  const x = tile?.getX?.() ?? tile?.x;
  const y = tile?.getY?.() ?? tile?.y;
  const z = tile?.getZ?.() ?? tile?.z;
  return object?.getId?.() === DOOR_ID && x === DOOR_TILE.x && y === DOOR_TILE.y && z === DOOR_TILE.z;
}

function onDungeonSide(player) {
  const location = player?.getLocation?.();
  // The face-3 wall blocks movement from y=9481 to y=9482. The door tile is on the dungeon side.
  return location?.getY?.() >= INSIDE_Y;
}

function successChance(level) {
  const cappedLevel = Math.min(99, level);
  const roll = 1 + Math.floor(LOW_SUCCESS_ROLL * (99 - cappedLevel) / 98 +
    HIGH_SUCCESS_ROLL * (cappedLevel - 1) / 98 + 0.5);
  return Math.max(0, Math.min(256, roll)) / 256;
}

function pickLock({ player, object, location } = {}) {
  if (!atDoor(object, location) || object.getFace?.() !== DOOR_FACE) return false;
  if (player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.() ||
      player.getPrivateArea?.() != null) return true;
  if (onDungeonSide(player)) {
    player.sendMessage("The door is unlocked from this side.");
    return true;
  }
  // These response lines have not been checked against a live capture.
  if (!player.getInventory().contains(LOCKPICK_ID)) {
    player.sendMessage("You need a lockpick to pick this lock.");
    return true;
  }
  const level = player.getSkillManager().getCurrentLevel(api.core.Skill.THIEVING);
  if (level < THIEVING_LEVEL) {
    player.sendMessage("You need a Thieving level of 82 to pick this lock.");
    return true;
  }

  // The Wiki's 4/40 low/high chart gives rolls of 35/256 at level 82 and 41/256 at level 99.
  // No live timing or animation capture is available, so the attempt resolves on the click.
  if (Math.random() >= successChance(level)) {
    player.sendMessage("You fail to pick the lock.");
    return true;
  }

  const state = { objects: [object] };
  api.emitCustomEvent("door:state", state);
  const doorIsClosed = state.objects.some((current) => current.getId() === DOOR_ID && current.getFace() === DOOR_FACE &&
    current.getLocation().getX() === DOOR_TILE.x && current.getLocation().getY() === DOOR_TILE.y &&
    current.getLocation().getZ() === DOOR_TILE.z);
  if (!doorIsClosed) return true;

  const request = { player, object, objectId: DOOR_ID, location, handled: false };
  PICKLOCK_OPENERS.add(player);
  try {
    api.emitCustomEvent("door:open", request);
  } finally {
    PICKLOCK_OPENERS.delete(player);
  }
  if (request.handled) {
    player.getSkillManager().addExperiences(api.core.Skill.THIEVING, THIEVING_XP);
    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
  }
  return true;
}

function freeOpenFromDungeon(event) {
  const action = event.definition?.getInteractions?.()?.[event.clickType - 1]?.toLowerCase();
  if (!atDoor(event.object, event.location) || action !== "open" || onDungeonSide(event.player) ||
      PICKLOCK_OPENERS.has(event.player)) return;
  event.player.sendMessage("The door is locked.");
  event.handled = true;
  // The generic Doors plugin remains responsible for replacing the closed loc with its
  // cache-derived open leaf and collision. This listener only confirms the valid side.
}

module.exports = {
  name: "ArdougneYanilleDoorDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Doors"],
  register(registry) {
    api = registry;
    DOOR_ID = api.core.ObjectIdentifiers.DOOR_287;
    LOCKPICK_ID = api.core.ItemIdentifiers.LOCKPICK;
    api.onObjectInteraction("Door", { "Pick-lock": pickLock });
    api.onCustomEvent("door:toggle", freeOpenFromDungeon);
  },
  _test: { atDoor, onDungeonSide, successChance, pickLock, TASK, DOOR_ID, DOOR_TILE, THIEVING_LEVEL, LOCKPICK_ID, THIEVING_XP },
};
