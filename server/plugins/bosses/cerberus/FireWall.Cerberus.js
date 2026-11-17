/**
 * Cerberus' fire wall (Wiki: Cerberus; rsprox captures 1000323, 1000286, 1000457, rev 227):
 * - three Flames (hellhound_firewall) close the arena between its entrance and her as she stands
 *   for a fight, and go as she despawns after her death (the same tick as her NPC removal); she
 *   respawns, stands, and they come back;
 * - the flames are solid; Pass or Quick Pass on one crosses it. The player, beside it, faces the
 *   far side a tick later and the tick after that steps over it to the tile beyond, taking 5
 *   damage (captured going in; the Wiki: 5 damage each way).
 * Ours: Pass does what Quick Pass does (no capture of Pass); the wall also goes when the arena
 * empties and she sits back down, where the Wiki calls the live wall "bugged".
 */
const Common = require("./Common.Cerberus");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

/** The flames standing in an arena: Map(arena -> GameObject[]). */
const placed = new Map();

function place(arena) {
  const tiles = arena.def.flames;
  if (!tiles || placed.has(arena)) return;
  const { GameObject, ObjectManager } = Common.core;
  const { shape, rotation } = Common.data.fireWall;
  const objects = tiles.map(([x, y]) => {
    const object = new GameObject(Common.ids.locs.flames, new Common.core.Location(x, y, 0), shape, rotation, arena.privateArea ?? null);
    ObjectManager.register(object, true);
    return object;
  });
  placed.set(arena, objects);
}

function clear(arena) {
  const objects = placed.get(arena);
  if (!objects) return;
  placed.delete(arena);
  for (const object of objects) Common.core.ObjectManager.deregister(object, true);
}

function isUp(arena) {
  return placed.has(arena);
}

/** The arena whose wall has a flame on this tile, or null. */
function arenaOfFlame(location) {
  for (const def of Common.data.arenas) {
    if (!def.flames?.some(([x, y]) => x === location.x && y === location.y && (location.z ?? 0) === 0)) continue;
    return require("./Lair.Cerberus").arenas.find((arena) => arena.def === def) ?? null;
  }
  return null;
}

/** The steps over one flame: face across, then two tiles in one tick onto the far side, and the burn. */
function crossing(player, location) {
  const north = player.getLocation().getY() < location.y;
  const far = [location.x, location.y + (north ? 1 : -1)];
  // One far waypoint: the runner's two-tile tick walks straight through the flame to it.
  return [
    { face: far },
    { wait: 1 },
    { walk: [far], tilesPerTick: 2, arrive: true },
    { hit: Common.data.fireWall.damage },
  ];
}

function pass({ player, objectId, location }) {
  if (objectId !== Common.ids.locs.flames || !location) return false;
  const arena = arenaOfFlame(location);
  if (!arena) return false;
  ObstacleRunner.run({ player }, crossing(player, location));
  return true;
}

function attach(api) {
  api.onObjectInteraction("Flames", { Pass: pass, "Quick Pass": pass });
}

module.exports = { attach, place, clear, isUp, crossing, pass, arenaOfFlame };
