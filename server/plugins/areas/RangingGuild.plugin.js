/**
 * The Ranging Guild entrance (https://oldschool.runescape.wiki/w/Ranging_Guild): 40 Ranged to
 * enter, "though this can be boosted", so the visible level is what counts. The doorman turns the
 * rest away with his Wiki transcript's line; leaving is never stopped.
 *
 * The door itself is loc 11665 "Guild door" at 2658,3438: a diagonal (type 9) leaf with an Open
 * action and no open variant in the cache. objects/Doors carries it as a pass-through gate, so the
 * doorway keeps an inviswall while it stands open and the opener is carried across — nothing can
 * walk or follow through it. This plugin only decides who may open it, on the door:toggle event
 * that runs before the gate (the Champions' Guild's shape).
 *
 * The leaf sits in the guild's diagonal north-west fence, so the two sides are the two half-planes
 * either side of x - y through the door tile: the guild is the larger side. That splits the four
 * tiles a player can click it from the way the diagonal does — 2657,3438 and 2658,3439 outside,
 * 2659,3438 and 2658,3437 inside. The half-plane alone runs to the edge of the map, so the guild's
 * own ground floor bounds it (the archery area's rectangle, whose north-west corner the fence cuts).
 */
const REQUIRED_LEVEL = 40;
const REFUSAL_VARIANT = "standard-dialogue-attempting-to-enter-the-ranging-guild-without-40-ranged";
const DOOR = { x: 2658, y: 3438, z: 0 };
/** The guild's ground floor: doorman 2658,3439, target corner 2682,3428. */
const GUILD = { minX: 2653, maxX: 2687, minY: 3412, maxY: 3443, z: 0 };

let api;
let core;

function rangedLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.RANGED);
}

/** The fence runs diagonally, so the two sides are the two half-planes either side of x - y. */
function insideSide(point) {
  return point.x - point.y > DOOR.x - DOOR.y;
}

function insideGuild(point) {
  return point.z === GUILD.z && point.x >= GUILD.minX && point.x <= GUILD.maxX
    && point.y >= GUILD.minY && point.y <= GUILD.maxY && insideSide(point);
}

function inside(player) {
  const at = player.getLocation();
  return insideGuild({ x: at.getX(), y: at.getY(), z: at.getZ() });
}

function refuse(player) {
  api.emitCustomEvent("npc-dialogue:start", {
    player,
    npcId: core.NpcIdentifiers.RANGING_GUILD_DOORMAN,
    variant: REFUSAL_VARIANT,
    handled: false,
  });
}

/** Doors' door:toggle, before the pass-through gate carries the opener across. */
function guardDoor(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.GUILD_DOOR) return;
  const { player } = request;
  if (inside(player)) return; // leaving is never stopped
  if (rangedLevel(player) >= REQUIRED_LEVEL) return; // let the gate carry them across
  request.handled = true;
  refuse(player);
}

module.exports = {
  name: "RangingGuild",
  members: true,
  _test: { guardDoor, inside, insideGuild, rangedLevel, REQUIRED_LEVEL, REFUSAL_VARIANT, DOOR, GUILD },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("door:toggle", guardDoor);
  },
};
