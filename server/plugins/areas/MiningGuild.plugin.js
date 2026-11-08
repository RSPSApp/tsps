/** Mining Guild entry needs 60 current Mining (boosts count); leaving is unrestricted.
 * https://oldschool.runescape.wiki/w/Mining_Guild
 *
 * The members' area (behind the two inner doors) gives an invisible +7 Mining level to the success
 * rolls and empties rocks for half as long: iron 5.4 s -> 2.4 s, adamantite 4 -> 2 minutes, runite
 * 12 -> 6 minutes (Wiki rock pages). Amethyst keeps its own 75 seconds (Wiki Amethyst crystals).
 * Docs: docs/mining.md.
 */
const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const REQUIRED_LEVEL = 60;
/** Wiki Mining Guild: the invisible boost inside the members' area. */
const MEMBERS_AREA_BOOST = 7;
/** Rocks that already have the area's own time on their Wiki page. */
const OWN_RESPAWN_ROCKS = new Set(["Amethyst crystals"]);
/**
 * The members' area: the main cave, the corridor behind the door at 3019,9732 and the one behind
 * 3043,9729 (the tiles reachable from the cave with the inner doors shut, in the active cache).
 */
const MEMBERS_AREA_TILES = [
  [2999, 3058, 9696, 9728],
  [3017, 3021, 9729, 9732],
  [3042, 3044, 9729, 9729],
];
let core;
let membersArea = null;

function inMembersArea(location) {
  membersArea ??= MEMBERS_AREA_TILES.map(([x, x2, y, y2]) => new core.Boundary(x, x2, y, y2, 0));
  return membersArea.some((boundary) => boundary.inside(location));
}

/** "mining:level-boost": the area's invisible boost for the player standing in it. */
function boostMining(request) {
  if (inMembersArea(request.player.getLocation())) request.boost += MEMBERS_AREA_BOOST;
}

/** "mining:respawn-ticks": half the time for a rock standing in the area. */
function halveRespawn(request) {
  if (OWN_RESPAWN_ROCKS.has(request.rock) || !inMembersArea(request.object.getLocation())) return;
  request.ticks = Math.floor(request.ticks / 2);
}

function canEnter(player) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.MINING) >= REQUIRED_LEVEL) return true;
  player.sendMessage(`You need a Mining level of ${REQUIRED_LEVEL} to enter the Mining Guild.`);
  return false;
}

function guardLadder(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.LADDER_354) return;
  if (!canEnter(request.player)) request.handled = true;
}

function useDoor(request) {
  if (request.handled) return;
  const { DOOR_562, DOOR_563, DOOR_564 } = core.ObjectIdentifiers;
  if (![DOOR_562, DOOR_563, DOOR_564].includes(request.objectId)) return;
  request.handled = true;
  const { player, object } = request;
  if (ObstacleRunner.isBusy(player) || player.getMovementQueue().isMovementBlocked()) return;
  const door = object.getLocation();
  const from = player.getLocation();
  // All three cache doors are north-facing walls: the guild side is the door's own tile.
  const entering = from.getY() > door.getY();
  if (entering && !canEnter(player)) return;
  if (entering && request.objectId !== DOOR_562 && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage("You need to be on a members' world to enter this part of the Mining Guild.");
    return;
  }
  const x = door.getX(), y = door.getY() + (entering ? 0 : 1);
  if (from.getZ() !== door.getZ() || Math.abs(from.getX() - x) + Math.abs(from.getY() - y) !== 1) return;
  const sender = player.getPacketSender();
  sender.sendObjectRemoval(object);
  // Keep the shared wall closed so another player cannot bypass the entry check.
  ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: [[x, y]] }], {
    onFinish: () => sender.sendObject(object),
  });
}

module.exports = {
  name: "MiningGuild",
  register(api) {
    core = api.core;
    ObstacleRunner.init(api);
    api.onCustomEvent("ladders:climb", guardLadder);
    api.onCustomEvent("door:toggle", useDoor);
    api.onCustomEvent("mining:level-boost", boostMining);
    api.onCustomEvent("mining:respawn-ticks", halveRespawn);
  },
};
