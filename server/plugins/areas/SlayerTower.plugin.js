/**
 * The Slayer Tower (https://oldschool.runescape.wiki/w/Slayer_Tower), from an OSRS capture
 * (docs/slayer-tower.md):
 *
 * - The entrance is one double door: opening either leaf swings both, and the gargoyle statues
 *   either side turn to their "open" pose; closing either puts all four back.
 * - The basement ladder goes between the ground floor and the dark basement, whose darkness
 *   overlay shows while you're down there (no light source needed).
 *
 * The ivy, windows and spikey chains are agility shortcuts (skills/agility/shortcuts/Morytania).
 * This is under areas/ so its door and ladder handlers run before objects/Doors and Ladders.
 */
let core = null;
let api = null;
let entranceOpen = false;

const DOOR = { x: 3428, y: 3535 };
const STATUES = [[3426, 3534], [3430, 3534]];
const SOUND = { OPEN: [46, 2717, 2717], CLOSE: [60, 2718, 2718] };
const BASEMENT = { landing: [3412, 9932, 3], exit: [3417, 3536, 0], bounds: [3392, 3455, 9920, 9983, 3] };
const DARKNESS_VARBIT = 278; // darkness_level
const DARKNESS_OVERLAY = 97; // darkness_light
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;

function ids() {
  const O = core.ObjectIdentifiers;
  return {
    closed: [O.DOOR_63, O.DOOR_64],
    open: [O.DOOR_65, O.DOOR_66],
    statue: O.STATUE_14,
    statueOpen: O.STATUE_15,
    ladderTop: O.LADDER_352,
    ladderBottom: O.LADDER_353,
  };
}

const at = (x, y, z = 0) => new core.Location(x, y, z);

/** The two leaves: closed in the doorway (rotation 1), open a tile north (rotations 0 and 2). */
function leaves(open) {
  const { closed, open: opened } = ids();
  return open
    ? [{ id: opened[0], tile: at(DOOR.x, DOOR.y + 1), face: 0 }, { id: opened[1], tile: at(DOOR.x + 1, DOOR.y + 1), face: 2 }]
    : [{ id: closed[0], tile: at(DOOR.x, DOOR.y), face: 1 }, { id: closed[1], tile: at(DOOR.x + 1, DOOR.y), face: 1 }];
}

function isEntranceLeaf(objectId, location, open) {
  return leaves(open).some((leaf) => leaf.id === objectId && leaf.tile.getX() === location.x && leaf.tile.getY() === location.y && location.z === 0);
}

/** Swings both leaves and turns both statues, as captured. */
function swing(player, open) {
  const { ObjectManager, GameObject, MapObjects } = core;
  for (const leaf of leaves(!open)) {
    const placed = MapObjects.get(leaf.id, leaf.tile, null) ?? new GameObject(leaf.id, leaf.tile, 0, leaf.face, null);
    ObjectManager.deregister(placed, true);
  }
  for (const leaf of leaves(open)) ObjectManager.register(new GameObject(leaf.id, leaf.tile, 0, leaf.face, null), true);
  const statue = open ? ids().statueOpen : ids().statue;
  for (const [x, y] of STATUES) ObjectManager.register(new GameObject(statue, at(x, y), 10, 2, null), true);
  for (const sound of open ? SOUND.OPEN : SOUND.CLOSE) player.getPacketSender().sendSound(sound, 1, 0);
  entranceOpen = open;
}

function openEntrance({ player, objectId, location }) {
  if (!isEntranceLeaf(objectId, location, false)) return false;
  if (!entranceOpen) swing(player, true);
  return true;
}

function closeEntrance({ player, objectId, location }) {
  if (!isEntranceLeaf(objectId, location, true)) return false;
  if (entranceOpen) swing(player, false);
  return true;
}

/** The basement ladder: the reach animation both ways and the landing a tick later (captured). */
function claimBasementLadder(request) {
  const { ladderTop, ladderBottom } = ids();
  if (request.objectId !== ladderTop && request.objectId !== ladderBottom) return;
  request.handled = true;
  const [x, y, z] = request.objectId === ladderTop ? BASEMENT.landing : BASEMENT.exit;
  // ladders:climbUp plays the reach animation (828), which the capture shows going down too.
  api.emitCustomEvent("ladders:climbUp", { player: request.player, destination: at(x, y, z) });
}

function showDarkness(player, dark) {
  const sender = player.getPacketSender();
  sender.sendVarbit(DARKNESS_VARBIT, dark ? 1 : 0);
  if (dark) sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, DARKNESS_OVERLAY, 1);
  else sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** The basement, dark while you're in it. */
function basementArea() {
  class SlayerTowerBasement extends core.Area {
    getName() {
      return "Slayer Tower basement";
    }

    postEnter(mobile) {
      if (mobile.isPlayer()) showDarkness(mobile.getAsPlayer(), true);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer() && !logout) showDarkness(mobile.getAsPlayer(), false);
    }
  }
  const [minX, maxX, minY, maxY, z] = BASEMENT.bounds;
  return new SlayerTowerBasement([new core.Boundary(minX, maxX, minY, maxY, z)]);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "SlayerTower",
  members: true,
  _test: { attach, swing, openEntrance, closeEntrance, claimBasementLadder, showDarkness, basementArea, leaves, isOpen: () => entranceOpen, BASEMENT },
  register(pluginApi) {
    attach(pluginApi);
    pluginApi.onObjectInteraction("Door", { Open: openEntrance, Close: closeEntrance });
    pluginApi.onCustomEvent("ladders:climb", claimBasementLadder);
    pluginApi.registerArea(basementArea());
  },
};
