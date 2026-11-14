"use strict";

/**
 * The climbing ropes up from the arena's lower floor. A broken plank drops a player to the floor below
 * (Obstacles.BrimhavenAgilityArena.js plankFailureSteps: same x and y, plane 0); the Wiki's Plank page says they "will need
 * to go up a nearby climbing rope to get back onto the course". The cache has 25 Climbing ropes (3610, option Climb) on plane 0
 * at the corners of the pillars. Climb takes the player up to the pillar's platform: the rope's own tile on the arena plane
 * (the Wiki does not give the landing tile).
 */

const Shared = require("./Shared.BrimhavenAgilityArena");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const CLIMBING_ROPE = 3610;
const LOWER_PLANE = 0;
const CLIMB_ANIMATION = 828;
const CLIMB_TICKS = 2;

/** Only the arena's own ropes: "Climbing rope" is a name other places share. */
function isArenaRope(event) {
  const at = event.object?.getLocation();
  if (event.objectId !== CLIMBING_ROPE || !at || at.getZ() !== LOWER_PLANE) return false;
  const { ARENA } = Shared;
  return at.getX() >= ARENA.minX && at.getX() <= ARENA.maxX && at.getY() >= ARENA.minY && at.getY() <= ARENA.maxY;
}

function climbRope(event) {
  if (!isArenaRope(event)) return false;
  const { player, object } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  const at = object.getLocation();
  ObstacleRunner.run({ player, object, core: Shared.core() }, [
    { anim: CLIMB_ANIMATION },
    { wait: CLIMB_TICKS },
    { tele: [at.getX(), at.getY(), Shared.ARENA_PLANE] },
  ]);
  return true;
}

module.exports = (api) => {
  api.onObjectInteraction("Climbing rope", { Climb: climbRope });
};

module.exports.climbRope = climbRope;
