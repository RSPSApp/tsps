/**
 * Setting a cannon up, as captured (docs/dwarf-cannon.md): "Set-up" on the base marks the
 * player busy; two ticks later the base lands centred on them and they run off it, then the
 * stand, barrels and furnace follow 2, 3 and 3 ticks apart, and the tick after the furnace it loads.
 */
const Cannon = require("./Common.DwarfCannon");
const Data = require("./Data.DwarfCannon");
const Restrictions = require("./Restrictions.DwarfCannon");
const Ammo = require("./Ammo.DwarfCannon");
const Firing = require("./Firing.DwarfCannon");

/** Spam lines (rsprox captures). */
const PART_MESSAGES = [
  "You place the cannon base on the ground.",
  "You add the stand.",
  "You add the barrels.",
  "You add the furnace.",
];
/** Ours (not captured). */
const MESSAGE = {
  ONE_ONLY: "You cannot construct more than one cannon at a time.",
  PARTS: "You need the base, stand, barrels and furnace to set up a cannon.",
  SPACE: "There isn't enough space to set up a cannon here.",
};
/** Further than this from the cannon and the setup stops where it is (ours). */
const SETUP_RANGE = 5;
/** Wall flags by the edge (or corner) they sit on: N, E, S, W, then NW, NE, SE, SW. */
const WALL = { N: 0x2, E: 0x8, S: 0x20, W: 0x80, NW: 0x1, NE: 0x4, SE: 0x10, SW: 0x40 };

function footprint(sw) {
  const tiles = [];
  for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) tiles.push(sw.transform(dx, dy));
  return tiles;
}

/**
 * Whether the 3x3 footprint from `sw` is solid anywhere or has a wall inside it. blocked()
 * stopped counting wall tiles with the Castle Wars barricade fix, which let a cannon straddle a
 * wall; a wall along the footprint's outer edge still allows it.
 */
function obstructed(sw) {
  return footprint(sw).some((tile) => {
    const dx = tile.getX() - sw.getX(), dy = tile.getY() - sw.getY();
    const n = dy < 2, e = dx < 2, s = dy > 0, w = dx > 0;
    const inner = Cannon.core.RegionManager.BLOCKED_MASK | (n ? WALL.N : 0) | (e ? WALL.E : 0) | (s ? WALL.S : 0) | (w ? WALL.W : 0)
      | (n && w ? WALL.NW : 0) | (n && e ? WALL.NE : 0) | (s && e ? WALL.SE : 0) | (s && w ? WALL.SW : 0);
    return (Cannon.core.RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), null) & inner) !== 0;
  });
}

function hasAllParts(player, kind) {
  return Cannon.KINDS[kind].parts.every((part) => player.getInventory().contains(part));
}

/** Why a cannon can't go down here, or null. */
function refusal(player, kind) {
  if (Cannon.cannonOf(player)) return MESSAGE.ONE_ONLY;
  if (!hasAllParts(player, kind)) return MESSAGE.PARTS;
  if (Cannon.core.BoatManager.getBoatAboard(player)) return Restrictions.load().default;
  const restricted = Restrictions.restrictionAt(player.getLocation(), player.getPrivateArea?.() ?? null, player);
  if (restricted) return restricted;
  const sw = player.getLocation().transform(-1, -1);
  if (obstructed(sw)) return MESSAGE.SPACE;
  return null;
}

/** "Set-up" on a cannon base (plain or ornament). */
function setUp({ player, itemId }) {
  const kind = Cannon.kindOfPart(itemId);
  const refused = refusal(player, kind);
  if (refused) {
    player.sendMessage(refused);
    return true;
  }
  player.getMovementQueue().reset();
  player.getPacketSender().sendVarbit(Data.VARBIT.BUSY, 1);
  const centre = player.getLocation().clone();
  Cannon.later(Data.SETUP_TICKS[0], () => placeBase(player, kind, centre));
  return true;
}

/** The player runs off the footprint: to the tile south of its south-west corner (captured). */
function runOff(player, sw) {
  const { Direction, Location } = Cannon.core;
  const exits = [[0, -1], [-1, 0], [2, -1], [3, 0], [-1, 2], [0, 3], [3, 2], [2, 3]];
  for (const [ex, ey] of exits) {
    const to = sw.transform(ex, ey);
    if (Cannon.core.RegionManager.blocked(to, null)) continue;
    const from = player.getLocation();
    const via = new Location(Math.max(sw.getX(), Math.min(sw.getX() + 2, to.getX())), Math.max(sw.getY(), Math.min(sw.getY() + 2, to.getY())), sw.getZ());
    player.getMovementQueue().reset();
    player.setLocation(to);
    player.setWalkingDirection(Direction.fromDeltas(Math.sign(via.getX() - from.getX()), Math.sign(via.getY() - from.getY())));
    player.setRunningDirection(Direction.fromDeltas(Math.sign(to.getX() - via.getX()), Math.sign(to.getY() - via.getY())));
    player.getMovementQueue().handleRegionChange();
    return;
  }
}

function placeBase(player, kind, centre) {
  player.getPacketSender().sendVarbit(Data.VARBIT.BUSY, 0);
  if (player.isRegistered?.() === false || !player.getLocation().equals(centre) || refusal(player, kind)) return;
  const sw = centre.transform(-1, -1);
  const recovered = player.getAttribute(Cannon.RECOVERED_AMMO_ATTRIBUTE);
  const cannon = {
    owner: player.getUsername(), player, kind, sw, centre, stage: 0, steel: recovered?.steel ?? 0, granite: recovered?.granite ?? 0,
    direction: 0, firing: false, firedAt: 0, age: 0, broken: false, gone: false, object: null, setupTime: 0,
  };
  player.setAttribute(Cannon.RECOVERED_AMMO_ATTRIBUTE, null);
  Cannon.cannons.set(cannon.owner, cannon);
  addPart(cannon);
  runOff(player, sw);
  Firing.start(cannon);
  Cannon.later(Data.SETUP_TICKS[1], () => nextPart(cannon));
}

/** Adds the next part from the owner's inventory (captured: message, anim, sound, loc, vars). */
function addPart(cannon) {
  const { player } = cannon;
  const kind = Cannon.KINDS[cannon.kind];
  const part = kind.parts[cannon.stage];
  player.getInventory().delete(part, 1);
  player.getPacketSender().sendTypedMessage(Cannon.core.ChatType.SPAM, PART_MESSAGES[cannon.stage]);
  cannon.stage++;
  cannon.setupTime = Cannon.core.World.getProcessCycle();
  Cannon.setLoc(cannon, kind.locs[cannon.stage - 1]);
  player.setPositionToFace(cannon.centre);
  player.performAnimation(new Cannon.core.Animation(Data.SETUP_ANIMATION));
  Cannon.areaSound(player.getLocation(), Data.SOUND.SETUP);
  Cannon.save(cannon);
  Cannon.sendVars(cannon);
}

function nextPart(cannon) {
  const { player } = cannon;
  if (cannon.gone || cannon.stage >= 4 || !player || player.isRegistered?.() === false || Cannon.cannonOf(player) !== cannon) return;
  if (!player.getLocation().isWithinDistance(cannon.centre, SETUP_RANGE)) return;
  if (!player.getInventory().contains(Cannon.KINDS[cannon.kind].parts[cannon.stage])) return;
  addPart(cannon);
  if (cannon.stage < 4) {
    Cannon.later(Data.SETUP_TICKS[cannon.stage], () => nextPart(cannon));
    return;
  }
  // "dwarf-cannon:set-up" { player }: the last part on, the cannon standing whole.
  Cannon.api.emitCustomEvent("dwarf-cannon:set-up", { player });
  Cannon.later(1, () => Ammo.loadFromInventory(cannon, Cannon.capacity(cannon.player)));
}

module.exports = function attachSetup(api) {
  api.onItemAction("Cannon base", { "Set-up": setUp });
  api.onItemAction("Cannon base (or)", { "Set-up": setUp });
};

Object.assign(module.exports, { setUp, refusal, placeBase, nextPart, footprint, MESSAGE });
