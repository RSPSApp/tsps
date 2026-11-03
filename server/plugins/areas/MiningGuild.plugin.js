/** Mining Guild entry needs 60 current Mining (boosts count); leaving is unrestricted.
 * https://oldschool.runescape.wiki/w/Mining_Guild
 */
const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const REQUIRED_LEVEL = 60;
let core;

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
  },
};
