const DIARY = "ardougne";
const TASK = "enter-the-combat-training-camp-north-of-w-ardoug";
const GATE_X = new Set([2517, 2518]);
const GATE_SOUTH_Y = 3356;
const CAMP_Y = 3357;
const PLANE = 0;
const AREA_X_MIN = 2515;
const AREA_X_MAX = 2520;
const AREA_Y_MIN = 3354;
const AREA_Y_MAX = 3359;

const previous = new WeakMap();

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

function crossedGate(start, directions) {
  let x = start.x;
  let y = start.y;
  for (const direction of directions) {
    const nextX = x + direction.getX();
    const nextY = y + direction.getY();
    if (
      x === nextX &&
      y === GATE_SOUTH_Y &&
      nextY === CAMP_Y &&
      GATE_X.has(x)
    ) return true;
    x = nextX;
    y = nextY;
  }
  return false;
}

function enteredCamp(api, { player }) {
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
  if (!directions || !crossedGate(before, directions)) return;
  if (directions.some((direction) => Math.max(Math.abs(direction.getX()), Math.abs(direction.getY())) !== 1)) return;
  if (directions.reduce((sum, direction) => sum + direction.getX(), before.x) !== after.x) return;
  if (directions.reduce((sum, direction) => sum + direction.getY(), before.y) !== after.y) return;

  const quest = { player, key: "biohazard", complete: false };
  api.emitCustomEvent("quest:is-complete", quest);
  if (quest.complete) api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function clear({ player }) {
  if (player) previous.delete(player);
}

function createCampArea(api) {
  return new (class extends api.core.Area {
    constructor() {
      super([new api.core.Boundary(AREA_X_MIN, AREA_X_MAX, AREA_Y_MIN, AREA_Y_MAX, PLANE)]);
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) remember(mobile.getAsPlayer());
    }

    process(mobile) {
      if (mobile.isPlayer()) enteredCamp(api, { player: mobile.getAsPlayer() });
    }

    postLeave(mobile) {
      if (mobile.isPlayer()) clear({ player: mobile.getAsPlayer() });
    }
  })();
}

module.exports = {
  name: "ArdougneCombatTrainingCampDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests"],
  register(api) {
    api.registerArea(createCampArea(api));
    api.onPlayerDeath(clear);
    api.onPlayerLogout(clear);
    api.onPlayerDisconnect(clear);
  },
  _test: { enteredCamp, remember, clear, crossedGate, snapshot, previous },
};
