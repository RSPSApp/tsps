"use strict";

/**
 * The foundry cave as an Area: only players inside pay for its per-tick work.
 *
 * - The room's machinery runs for everyone inside (rsprox captures): two area sounds every
 *   second tick, and every fifth tick the trip hammer's hammer falls (sound 5603 and loc anim
 *   giants_foundry_hammer01 on the trip hammer and its belt system).
 * - Units that work the preform per tick hook in through `Shared.onTick`.
 * - Leaving (walking out, teleporting, logging out) stores a worn preform.
 */

const Shared = require("./Shared.GiantsFoundry");
const Preform = require("./Preform.GiantsFoundry");

const SHORT_PERIOD = 2;
/** The trip hammer's fall; its work tick rides the same cycle (Tools). */
const HAMMER_PERIOD = Shared.HAMMER_PERIOD;
/** The trip hammer and the belt system that drives it both play the hammer's fall. */
const HAMMER_LOCS = [
  { id: 44619, x: 3363, y: 11496 },
  { id: 44763, x: 3362, y: 11495 },
];

/**
 * Where players stand to use each station (rsprox captures: the tile every recorded use was
 * made from). The pathfinder can't reach the waterfall's own side through the belt system.
 */
const STATION_TILES = new Map([
  [44619, { x: 3367, y: 11497 }], // trip hammer
  [44620, { x: 3364, y: 11492 }], // grindstone
  [44621, { x: 3365, y: 11485 }], // polishing wheel
  [44631, { x: 3371, y: 11497 }], // lava pool
  [44632, { x: 3360, y: 11489 }], // waterfall
]);

let hammerObjects = null;

function hammerLocs() {
  if (hammerObjects?.length) return hammerObjects;
  const { MapObjects, Location } = Shared.core();
  hammerObjects = HAMMER_LOCS
    .map((loc) => MapObjects.get(loc.id, new Location(loc.x, loc.y, Shared.ROOM.z), null))
    .filter(Boolean);
  return hammerObjects;
}

function playAmbience(player, now) {
  if (now % SHORT_PERIOD === 0) {
    for (const spec of Shared.AMBIENT.SHORT) Shared.areaSound(player, spec);
  }
  if (now % HAMMER_PERIOD === 0) {
    Shared.areaSound(player, Shared.AMBIENT.HAMMER_SOUND);
    for (const loc of hammerLocs()) {
      player.getPacketSender().sendObjectAnimation(loc, { id: Shared.AMBIENT.HAMMER_ANIM });
    }
  }
}

function processPlayer(player) {
  const now = Shared.tick();
  playAmbience(player, now);
  Shared.runTick(player, now);
}

function processWorkshop({ player }) { processPlayer(player); }

function leaveWorkshop({ player }) { Shared.stopWork(player); Preform.storeOnLeave(player); }

function createArea() {
  const { Area, Boundary } = Shared.core();
  const room = Shared.ROOM;
  class GiantsFoundry extends Area {
    process(mobile) {
      if (mobile.isPlayer()) processPlayer(mobile.getAsPlayer());
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) Preform.noticeStoredPreform(mobile.getAsPlayer());
    }

    postLeave(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      Shared.stopWork(player);
      Preform.storeOnLeave(player);
    }
  }
  return new GiantsFoundry([new Boundary(room.minX, room.maxX, room.minY, room.maxY, room.z)]);
}

function routeToStation(event) {
  const tile = STATION_TILES.get(event.objectId);
  if (!tile || !Shared.inRoom(event.object.getLocation())) return;
  event.destination = { x: tile.x, y: tile.y, z: Shared.ROOM.z };
}

module.exports = function attachArea(api) {
  api.registerArea(createArea());
  api.onCustomEvent("giants-foundry:process", processWorkshop);
  api.onCustomEvent("giants-foundry:leave", leaveWorkshop);
  api.onObjectRoute(routeToStation);
};
