/**
 * The Catacombs of Kourend (https://oldschool.runescape.wiki/w/Catacombs_of_Kourend): the
 * statue of King Rada I in Kourend Castle's courtyard, and the vine ladder back up from where it
 * lands you (docs/catacombs-of-kourend.md).
 *
 * - Investigate (rsprox captures): the player faces the statue, kneels (human_pickupfloor) with
 *   "You investigate what looks like hinges...", then "You climb down the hole." as the screen
 *   fades, lands at (1666, 10050) and the screen fades back in.
 * - Read (rsprox captures): the scroll "Kourend the Magnificent" (longscroll).
 * - The vine ladder beside the landing climbs back to the statue's east side. Not captured: the
 *   ladder animation and the tile are ours.
 * - The four corner vines (Wiki: Demon's Run, Dragon's Den, Reeking Cove, The Shallows) climb to
 *   the surface, and the first climb opens that exit's way back in for the player: the hole or the
 *   Forthos Dungeon's strange passage is a multiloc on its own cache varbit (cata_hole1-4). The
 *   Giants' Den vine is a captured loc teleport (plugins/world/LocTeleports); its arrival opens the
 *   Giants' Den's strange passage (cata_hole_giants_den). The opened exits are saved and sent again
 *   at login.
 * - Bones buried here, or crushed by a bonecrusher, give back their Prayer restore (Wiki: "Bones
 *   restore 1 Prayer point, big bones 2, dragon bones 4"; per bone in plugins/skills/data/bones.json).
 *   Demonic ashes don't, and a dragonbone necklace doesn't stack with it.
 *
 * Under areas/ so the vine ladder's handler runs before objects/Ladders, which finds no floor above.
 */
const STATUE = { x: 1634, y: 3671, size: 5 };
const LANDING = [1666, 10050, 0];
const VINE_LADDER = { x: 1666, y: 10051, z: 0 };
const STATUE_EAST_SIDE = [1639, 3673, 0];
/** The Catacombs below Kourend Castle, as bounded for their totem drops (plugins/bosses/data/skotizo.json). */
const CATACOMBS = { minX: 1600, minY: 9984, maxX: 1791, maxY: 10111 };

/**
 * The vines out and their ways back in (Wiki "Catacombs of Kourend"; loc placements and varbits
 * from the cache). `top`/`bottom`: where each side lands (Shortest Path's transports; not captured).
 * `hole`: the way back in is a Hole (the others are strange passages).
 */
const EXITS = [
  // Demon's Run: the greater demons' north-east corner, to the hole west of the dense essence mine.
  { varbit: "cata_hole3", vine: { x: 1719, y: 10102 }, top: [1696, 3864, 0], entrance: { x: 1696, y: 3865 }, hole: true, bottom: [1719, 10101, 0] },
  // Dragon's Den: the brutal black dragons' north-west corner, to the hole north of The Deeper Lode.
  { varbit: "cata_hole4", vine: { x: 1617, y: 10102 }, top: [1562, 3791, 0], entrance: { x: 1563, y: 3791 }, hole: true, bottom: [1617, 10101, 0] },
  // Reeking Cove: the deviant spectres, to the hole north-west of the Shayzien Encampment bank.
  { varbit: "cata_hole2", vine: { x: 1650, y: 9986 }, top: [1469, 3653, 0], entrance: { x: 1470, y: 3653 }, hole: true, bottom: [1650, 9987, 0] },
  // The Shallows: the king sand crab's south-east corner, to the Forthos Dungeon's western exit.
  { varbit: "cata_hole1", vine: { x: 1726, y: 9993 }, top: [1803, 9968, 0], entrance: { x: 1804, y: 9967 }, bottom: [1726, 9994, 0] },
];
/** The Giants' Den vine (LocTeleports moves the player) and its strange passage back in. */
const GIANTS_DEN = { varbit: "cata_hole_giants_den", vine: { x: 1639, y: 10047 }, entrance: { x: 1462, y: 9878 }, bottom: [1639, 10046, 0] };
/** The exits a player has opened, by varbit name. */
const EXITS_ATTRIBUTE = "catacombs-of-kourend:exits";

const PICKUP_FLOOR = 827; // human_pickupfloor
const READ_SCROLL = 2171; // human_use_wom_telecope
const CLIMB_LADDER = 828; // human_reachforladder

const HINGES = "You investigate what looks like hinges on the plaque and find it opens.";
const CLIMB_DOWN = "You climb down the hole.";

const LONGSCROLL = 625;
const LONGSCROLL_SETUP = 418;
const SCROLL_TITLE = "Kourend the Magnificent";
const SCROLL_TEXT = [
  "Kourend the magnificent,", "Kourend the resplendent,", "Kourend, the most powerful", "of the nations in the world.", "",
  "Kourend is our citadel,", "Kourend is our homeland.", "We will live and die for Kourend,", "for the kingdom of our birth.", "",
  "From the rugged mountains,", "to the foaming seas,", "here we make our home in Kourend,", "all together, all in peace.", "",
  "Kourend is a monument,", "Kourend is a triumph;", "it shall stand here forever", "in the shadow of our King.",
].join("<br>");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;

let core = null;

const isStatue = (location) => location?.x === STATUE.x && location?.y === STATUE.y;

function statueCentre() {
  const half = Math.floor(STATUE.size / 2);
  return new core.Location(STATUE.x + half, STATUE.y + half, 0);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * Runs `steps` (ticks from the click -> actions) with the player's movement blocked until the
 * last; stops if the player leaves or dies. Tick 0 runs now. Captured ticks count from the
 * player's arrival, and the click is handled a tick after it.
 */
function run(player, steps) {
  const { Task, TaskManager } = core;
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return false;
  const last = Math.max(...steps.keys());
  let tick = 0;
  const runTick = () => (steps.get(tick) ?? []).forEach((step) => step());
  movement.setBlockMovement(true).reset();
  runTick();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered() || player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      runTick();
      if (tick >= last) this.stop();
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
  return true;
}

function travel(player, [x, y, z], moveTick, steps) {
  const at = (tick, step) => steps.set(tick, [...(steps.get(tick) ?? []), step]);
  at(moveTick - 2, () => fade(player, true));
  at(moveTick - 1, () => player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  at(moveTick, () => player.moveTo(new core.Location(x, y, z)));
  at(moveTick + 2, () => {
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
    fade(player, false);
  });
  at(moveTick + 4, () => player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  return steps;
}

/** Investigate: arrival +1 face, +2 kneel and hinges, +3 climb down and fade, +5 land, +7 fade in. */
function investigate(event) {
  const { player, location } = event;
  if (!isStatue(location)) return false;
  const steps = new Map([
    [0, [() => player.setPositionToFace(statueCentre())]],
    [1, [() => {
      player.performAnimation(new core.Animation(PICKUP_FLOOR));
      player.sendMessage(HINGES);
    }]],
    [2, [() => player.sendMessage(CLIMB_DOWN)]],
  ]);
  run(player, travel(player, LANDING, 4, steps));
  return true;
}

/** Read: arrival +2 the reading animation, +3 the scroll. */
function read(event) {
  const { player, location } = event;
  if (!isStatue(location)) return false;
  run(player, new Map([
    [0, [() => player.setPositionToFace(statueCentre())]],
    [1, [() => player.performAnimation(new core.Animation(READ_SCROLL))]],
    [2, [() => {
      const sender = player.getPacketSender();
      sender.sendInterface(LONGSCROLL);
      sender.sendClientScript(LONGSCROLL_SETUP, SCROLL_TITLE, SCROLL_TEXT);
    }]],
  ]));
  return true;
}

/** The vine ladder by the landing: back up beside the statue. */
function climbUp(event) {
  const { player, location } = event;
  if (location?.x !== VINE_LADDER.x || location?.y !== VINE_LADDER.y || (location?.z ?? 0) !== VINE_LADDER.z) return false;
  const steps = new Map([[0, [() => player.performAnimation(new core.Animation(CLIMB_LADDER))]]]);
  run(player, travel(player, STATUE_EAST_SIDE, 2, steps));
  return true;
}

const isAt = (location, tile) => location?.x === tile.x && location?.y === tile.y && (location?.z ?? 0) === 0;

function varbitId(name) {
  return core.CacheDefinitions.getVarbitId(name);
}

function openedExits(player) {
  const exits = player.getAttribute(EXITS_ATTRIBUTE);
  return Array.isArray(exits) ? exits : [];
}

/** Opens `exit`'s way back in: its multiloc shows the hole or passage from now on. */
function openExit(player, exit) {
  const exits = openedExits(player);
  if (!exits.includes(exit.varbit)) player.setAttribute(EXITS_ATTRIBUTE, [...exits, exit.varbit]);
  player.getPacketSender().sendVarbit(varbitId(exit.varbit), 1);
}

function sendOpenedExits({ player }) {
  for (const name of openedExits(player)) player.getPacketSender().sendVarbit(varbitId(name), 1);
}

/**
 * A corner vine, as the Giants' Den vine was captured (rsprox captures, recording 3024): arrival +1
 * faces the vine, +2 human_reachforladder and the exit's varbit, +3 the move. No fade.
 */
function climbVine(event) {
  const { player, location } = event;
  const exit = EXITS.find((candidate) => isAt(location, candidate.vine));
  if (!exit) return false;
  run(player, new Map([
    [0, [() => player.setPositionToFace(new core.Location(exit.vine.x, exit.vine.y, 0))]],
    [1, [() => {
      player.performAnimation(new core.Animation(CLIMB_LADDER));
      openExit(player, exit);
    }]],
    [2, [() => player.moveTo(new core.Location(...exit.top))]],
  ]));
  return true;
}

/** "loc-teleports:arrived": the captured Giants' Den climb opens its passage. */
function climbedGiantsDenVine({ player, location }) {
  if (isAt(location, GIANTS_DEN.vine)) openExit(player, GIANTS_DEN);
}

/**
 * Enter on an opened hole or strange passage: down beside its vine. None of these was captured;
 * they play as a captured Hole's Enter does (rsprox captures, ds2_ogre_corsair_vine_ladder_entrance,
 * recordings 350 and 778): arrival +1 faces it, +2 human_pickupfloor, +3 the move. Ours: a strange
 * passage plays no animation.
 */
function enter(event) {
  const { player, location } = event;
  const exit = [...EXITS, GIANTS_DEN].find((candidate) => isAt(location, candidate.entrance));
  if (!exit || !openedExits(player).includes(exit.varbit)) return false;
  const definition = core.ObjectDefinition.forPlayer(event.objectId, player);
  const half = (size) => Math.floor(((size ?? 1) - 1) / 2);
  const centre = new core.Location(exit.entrance.x + half(definition?.getSizeX()), exit.entrance.y + half(definition?.getSizeY()), 0);
  run(player, new Map([
    [0, [() => player.setPositionToFace(centre)]],
    [1, [() => exit.hole && player.performAnimation(new core.Animation(PICKUP_FLOOR))]],
    [2, [() => player.moveTo(new core.Location(...exit.bottom))]],
  ]));
  return true;
}

function inCatacombs(location) {
  const x = location.getX();
  const y = location.getY();
  return x >= CATACOMBS.minX && x <= CATACOMBS.maxX && y >= CATACOMBS.minY && y <= CATACOMBS.maxY;
}

/** "prayer:bone-restore": bones buried in the Catacombs give back their Prayer points. */
function boneRestore(event) {
  if (inCatacombs(event.player.getLocation())) event.restore = Math.max(event.restore, event.points);
}

module.exports = {
  name: "CatacombsOfKourend",
  description: "Catacombs of Kourend access: King Rada's statue, the vine ladder back up, the corner vines and the surface holes they open, and bones restoring Prayer points while buried or crushed there.",
  members: true,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Statue", { Investigate: investigate, Read: read });
    api.onObjectInteraction("Vine ladder", { "Climb-up": climbUp });
    api.persistAttribute(EXITS_ATTRIBUTE, []);
    api.onObjectInteraction("Vine", { "Climb-up": climbVine });
    api.onObjectInteraction("Hole", { Enter: enter });
    api.onObjectInteraction("Strange passage", { Enter: enter });
    api.onCustomEvent("loc-teleports:arrived", climbedGiantsDenVine);
    api.onPlayerLogin(sendOpenedExits);
    api.onCustomEvent("prayer:bone-restore", boneRestore);
  },
};
