"use strict";

/**
 * The Piscarilius patrol (Patrolmen/Patrolwomen 6973-6980). They have no Attack option, and
 * back that up in the area's canAttack. While a player carries an artefact they pursue within
 * sight and an adjacent guard catches. The catch is deterministic proximity; the Wiki
 * documents no catch roll.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Patrolman
 */

const Common = require("./Common.StealingArtefacts");

function createPatrol() {
  const { Area, Boundary, PathFinder, RegionManager } = Common.getCore();
  const { minX, maxX, minY, maxY, z } = Common.PATROL_AREA;

  class PiscariliusPatrol extends Area {
    process(mobile) {
      if (!mobile.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (player.getHitpoints() <= 0 || !Common.carriedArtefactId(player)) return;
      for (const npc of this.getNpcs()) {
        if (!Common.isGuard(npc.getId())) continue;
        const distance = npc.getLocation().getDistance(player.getLocation());
        if (distance > Common.SIGHT_RADIUS) continue;
        if (distance <= 1) {
          // A wall between the two tiles (the North house's ground floor) blocks the step
          // and the catch with it; guards camp the door until the carrier steps outside.
          if (RegionManager.canMovestart(npc.getLocation(), player.getLocation(), 1, 1, null)) {
            Common.guardCatch(player);
            return;
          }
          continue;
        }
        const movement = npc.getMovementQueue();
        if (!movement.getMobility().canMove()) continue;
        npc.setPositionToFace(player.getLocation());
        movement.setPursuitCheckpoint(PathFinder.naiveEntityDestination(npc, player));
      }
    }

    canAttack(attacker, target) {
      return target?.isNpc?.() && Common.isGuard(target.getId()) ? false : null;
    }
  }

  return new PiscariliusPatrol([new Boundary(minX, maxX, minY, maxY, z)]);
}

module.exports = function registerPatrol(api) {
  Common.bind(api);
  api.registerArea(createPatrol());
};

module.exports._test = { createPatrol };
