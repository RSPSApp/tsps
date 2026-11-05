const DIARY = "ardougne";
const TASK = "enter-the-magic-guild";
const MAGIC_REQUIREMENT = 66;
const MAGIC_GUILD_DOORS = Object.freeze({ WEST: 2584, EAST: 2597 });
const DOOR_Y = new Set([3087, 3088]);
const PLANE = 0;
const AREA_X_MIN = 2580;
const AREA_X_MAX = 2601;
const AREA_Y_MIN = 3083;
const AREA_Y_MAX = 3092;

const previous = new WeakMap();
const movementGuards = new WeakMap();
let magicSkill;
let magicGuildDoorIds;

function snapshot(player) {
  const location = player.getLocation?.();
  if (!location) return null;
  return {
    x: location.getX(),
    y: location.getY(),
    z: location.getZ(),
    teleportSerial: player.getTeleportSerial?.(),
    privateArea: player.getPrivateArea?.() ?? null,
  };
}

function remember(player) {
  const current = snapshot(player);
  if (current) previous.set(player, current);
  else previous.delete(player);
}

function directionsFor(player) {
  const movement = player.getMovementQueue?.();
  if (!movement?.steppedThisWorldCycle?.()) return null;

  const first = player.getWalkingDirection?.();
  const second = player.getRunningDirection?.();
  const directions = [first, movement.didRunThisCycle?.() ? second : null]
    .filter((direction) => direction?.getId?.() >= 0);
  if (directions.length < 1 || directions.length > 2) return null;
  return directions;
}

function crossedDoor(start, directions) {
  let x = start.x;
  let y = start.y;
  for (const direction of directions) {
    const nextX = x + direction.getX();
    const nextY = y + direction.getY();
    if (DOOR_Y.has(y) || DOOR_Y.has(nextY)) {
      if ((x <= MAGIC_GUILD_DOORS.WEST && nextX > MAGIC_GUILD_DOORS.WEST)
        || (x >= MAGIC_GUILD_DOORS.EAST && nextX < MAGIC_GUILD_DOORS.EAST)) return true;
    }
    x = nextX;
    y = nextY;
  }
  return false;
}

function isInwardDoorStep(source, destination) {
  if (!source || !destination || source.getZ() !== PLANE || destination.getZ() !== PLANE) return false;
  const x = source.getX();
  const nextX = destination.getX();
  const y = source.getY();
  const nextY = destination.getY();
  const westCrossing = x <= MAGIC_GUILD_DOORS.WEST && nextX > MAGIC_GUILD_DOORS.WEST;
  const eastCrossing = x >= MAGIC_GUILD_DOORS.EAST && nextX < MAGIC_GUILD_DOORS.EAST;
  return (westCrossing || eastCrossing)
    && (DOOR_Y.has(y) || DOOR_Y.has(nextY));
}

function installMovementGuard(player) {
  const movement = player.getMovementQueue?.();
  if (!movement || movementGuards.has(player)) return;
  const original = movement.canWalkTo;
  if (typeof original !== "function") return;
  function canWalkGuildStep(next, source) {
    const start = source ?? player.getLocation();
    if (!original.call(this, next, start)) return false;
    if (player.getPrivateArea?.() == null
      && player.getSkillManager().getCurrentLevel(magicSkill) < MAGIC_REQUIREMENT
      && isInwardDoorStep(start, next)) return false;
    return true;
  }
  movement.canWalkTo = canWalkGuildStep;
  movementGuards.set(player, { movement, original, canWalkGuildStep });
}

function removeMovementGuard(player) {
  const guard = movementGuards.get(player);
  if (!guard) return;
  if (guard.movement.canWalkTo === guard.canWalkGuildStep) guard.movement.canWalkTo = guard.original;
  movementGuards.delete(player);
}

function enteredGuild(api, { player }) {
  if (!player) return;

  const before = previous.get(player);
  const after = snapshot(player);
  if (!after) {
    previous.delete(player);
    return;
  }
  previous.set(player, after);

  if (!before || before.teleportSerial !== after.teleportSerial) return;
  if (before.z !== PLANE || after.z !== PLANE || before.privateArea || after.privateArea) return;
  if (player.getHitpoints?.() <= 0 || player.isDyingReturn?.()) return;

  const dx = after.x - before.x;
  const dy = after.y - before.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 2) return;

  const directions = directionsFor(player);
  if (!directions || !crossedDoor(before, directions)) return;
  if (directions.some((direction) => Math.max(Math.abs(direction.getX()), Math.abs(direction.getY())) !== 1)) return;
  if (directions.reduce((sum, direction) => sum + direction.getX(), before.x) !== after.x) return;
  if (directions.reduce((sum, direction) => sum + direction.getY(), before.y) !== after.y) return;

  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function clear({ player }) {
  if (player) previous.delete(player);
}

function clearAndRemoveGuard({ player }) {
  if (!player) return;
  clear({ player });
  removeMovementGuard(player);
}

function isGuildEntrance(event, ids) {
  const name = event?.definition?.getName?.() ?? event?.object?.getDefinition?.()?.getName?.();
  if (!event?.player || !event.location || name !== "Magic guild door"
    || !ids.has(event.objectId ?? event.object?.getId?.())) return false;
  const { x, y, z } = event.location;
  if (z !== PLANE || !DOOR_Y.has(y)) return false;
  const player = event.player.getLocation?.();
  if (!player || player.getZ() !== PLANE || player.getY() < 3086 || player.getY() > 3089) return false;
  return (x === MAGIC_GUILD_DOORS.WEST && player.getX() <= x)
    || (x === MAGIC_GUILD_DOORS.EAST && player.getX() >= x);
}

function toggleDoor(ids, event) {
  if (event?.handled || !isGuildEntrance(event, ids)) return;
  const action = event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1];
  if (action && action.toLowerCase() !== "open") return;
  if (event.player.getSkillManager().getCurrentLevel(magicSkill) < MAGIC_REQUIREMENT) event.handled = true;
}

function handleDoorToggle(event) {
  toggleDoor(magicGuildDoorIds, event);
}

function createGuildArea(api) {
  return new (class extends api.core.Area {
    constructor() {
      super([new api.core.Boundary(AREA_X_MIN, AREA_X_MAX, AREA_Y_MIN, AREA_Y_MAX, PLANE)]);
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) {
        const player = mobile.getAsPlayer();
        remember(player);
        installMovementGuard(player);
      }
    }

    process(mobile) {
      if (mobile.isPlayer()) enteredGuild(api, { player: mobile.getAsPlayer() });
    }

    postLeave(mobile) {
      if (mobile.isPlayer()) {
        const player = mobile.getAsPlayer();
        clear({ player });
        removeMovementGuard(player);
      }
    }
  })();
}

module.exports = {
  name: "ArdougneMagicGuildDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    magicSkill = api.core.Skill.MAGIC;
    magicGuildDoorIds = new Set([
      api.core.ObjectIdentifiers.MAGIC_GUILD_DOOR,
      api.core.ObjectIdentifiers.MAGIC_GUILD_DOOR_2,
    ]);
    api.registerArea(createGuildArea(api));
    api.onCustomEvent("door:toggle", handleDoorToggle);
    api.onPlayerDeath(clear);
    api.onPlayerLogout(clearAndRemoveGuard);
    api.onPlayerDisconnect(clearAndRemoveGuard);
  },
  _test: { enteredGuild, remember, clear, clearAndRemoveGuard, crossedDoor, isInwardDoorStep, snapshot, isGuildEntrance, previous, movementGuards },
};
