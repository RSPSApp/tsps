"use strict";

/**
 * The arena's clickable obstacles. They are one-tile-thick lines between the pillars, so a click
 * crosses one step: the animation plays, the player is force-moved past the clicked tile and the
 * Wiki's XP is paid when they land. Blade and trap obstacles have no click option; the Area unit
 * handles those.
 */

const Shared = require("./Shared.BrimhavenAgilityArena");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

/** Animation ids as server/plugins/skills/agility/constants.js names them. */
const ANIM = {
  BALANCE_WALK: 762,
  LEDGE_WALK: 756,
  MONKEY_BARS_CROSS: 744,
  CLIMB_LOW_WALL: 839,
  ROPE_SWING: 751,
  JUMP: 741,
  HANG_SWING: 1122,
};
/** 0 west, 1 north, 2 east, 3 south, as the agility steps' wall facings. */
const ROTATION_VECTORS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

const SPECS = {
  BALANCING_ROPE: { anim: ANIM.BALANCE_WALK, render: ANIM.BALANCE_WALK },
  LOG_BALANCE: { anim: ANIM.BALANCE_WALK, render: ANIM.BALANCE_WALK },
  BALANCING_LEDGE: { anim: ANIM.LEDGE_WALK, render: ANIM.LEDGE_WALK },
  MONKEY_BARS: { anim: ANIM.MONKEY_BARS_CROSS },
  LOW_WALL: { anim: ANIM.CLIMB_LOW_WALL },
  ROPE_SWING: { anim: ANIM.ROPE_SWING },
  PLANK: { anim: ANIM.BALANCE_WALK, render: ANIM.BALANCE_WALK },
  PILLAR: { anim: ANIM.JUMP },
  HAND_HOLDS: { anim: ANIM.HANG_SWING },
};

/** objectId -> obstacle family key. */
const FAMILY = new Map();
for (const [kind, ids] of Object.entries(Shared.OBSTACLE_IDS)) {
  for (const id of ids) FAMILY.set(id, kind);
}

function familyAt(objectId) {
  return FAMILY.get(objectId) ?? null;
}

function obstacleXp(kind) {
  return Shared.OBSTACLE_XP[kind] ?? 0;
}

/** One step past the clicked tile, away from where the player stood. */
function crossingTarget(player, object) {
  const at = object.getLocation();
  const pos = player.getLocation();
  let dx = at.getX() - pos.getX();
  let dy = at.getY() - pos.getY();
  if (dx === 0 && dy === 0) {
    const [fx, fy] = ROTATION_VECTORS[(object.getFace?.() ?? 0) & 3];
    return { x: at.getX() + fx, y: at.getY() + fy, z: at.getZ() };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    dx = Math.sign(dx);
    dy = 0;
  } else {
    dx = 0;
    dy = Math.sign(dy);
  }
  return { x: at.getX() + dx, y: at.getY() + dy, z: at.getZ() };
}

function useObstacle(event) {
  const kind = familyAt(event.objectId);
  if (!kind) return false;
  const player = event.player;
  if (ObstacleRunner.isBusy(player)) return true;
  const object = event.object;
  const at = object.getLocation();
  const spec = SPECS[kind];
  const target = crossingTarget(player, object);
  const context = {
    player,
    object,
    core: Shared.core(),
    obj: {
      x: at.getX(), y: at.getY(), z: at.getZ(),
      face: object.getFace?.() ?? 0, type: object.getType?.() ?? 10, id: event.objectId,
    },
    pos: (() => {
      const pos = player.getLocation();
      return { x: pos.getX(), y: pos.getY(), z: pos.getZ() };
    })(),
  };
  // ponytail: a click crosses one tile; repeated clicks walk a long rope/log, each paying XP.
  const steps = [
    { anim: spec.anim },
    { wait: 1 },
    { move: [target.x, target.y, target.z], anim: spec.anim, ticks: 1 },
  ];
  ObstacleRunner.run(context, steps, {
    render: spec.render ?? null,
    onFinish: (completed) => {
      if (completed) Shared.addXp(player, obstacleXp(kind));
    },
  });
  return true;
}

/** Clicks from far away walk to the obstacle first; the obstacle claims only its own tiles. */
function routeToObstacle(event) {
  if (event.clickType !== 1 || !familyAt(event.objectId)) return;
  const at = event.object.getLocation();
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

module.exports = (api) => {
  ObstacleRunner.init(api);
  api.onObjectInteraction("Balancing rope", { "Walk-on": useObstacle });
  api.onObjectInteraction("Log balance", { "Walk-on": useObstacle });
  api.onObjectInteraction("Balancing ledge", { "Walk-across": useObstacle });
  api.onObjectInteraction("Monkey bars", { "Swing-across": useObstacle });
  api.onObjectInteraction("Low wall", { "Climb-over": useObstacle });
  api.onObjectInteraction("Rope swing", { "Swing-on": useObstacle });
  api.onObjectInteraction("Plank", { "Walk-on": useObstacle });
  api.onObjectInteraction("Pillar", { "Jump-on": useObstacle });
  api.onObjectInteraction("Hand holds", { "Climb-across": useObstacle });
  api.onObjectRoute(routeToObstacle);
};

module.exports.useObstacle = useObstacle;
module.exports.routeToObstacle = routeToObstacle;
module.exports.crossingTarget = crossingTarget;
module.exports.familyAt = familyAt;
module.exports.obstacleXp = obstacleXp;
