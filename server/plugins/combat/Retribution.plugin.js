"use strict";

/**
 * Retribution (https://oldschool.runescape.wiki/w/Retribution; docs/retribution.md): when a
 * player with the prayer active dies, it hurts the enemies around them for up to a quarter of
 * their base Prayer level, rounded down. It doesn't go off when the killing blow was reflected
 * damage (Vengeance, a recoil ring, another Retribution) or came from a failed pickpocket.
 *
 * rsprox capture 1754: the tick after the player's Hitpoints reach 0 they play
 * retribution_spotanim (437, delay 30), area sound 159 (radius 5) plays on their tile, and one
 * retfirebreath_travel (438) projectile flies from their tile to each of the eight tiles
 * around it (cycle 36 to 48, no slope, height 23 both ends). So the fire reaches the adjacent
 * tiles only, not a wider radius, and whoever stands there when it lands is hit.
 */
const PRAYER_LEVEL_DIVISOR = 4;
const GRAPHIC = 437; // retribution_spotanim
const GRAPHIC_DELAY = 30;
const PROJECTILE = { ID: 438, START: 36, END: 48, ANGLE: 0, PROGRESS: 0, HEIGHT: 23 / 4 }; // retfirebreath_travel
const SOUND = { ID: 159, RADIUS: 5 };
/** The widest NPC that can be found by its south-west tile and still cover a tile next to the wearer. */
const MOST_NPC_SIZE = 9;
const NEIGHBOURS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];

let core;
let api;

function maxHit(player) {
  return Math.floor(player.getSkillManager().getMaxLevel(core.Skill.PRAYER) / PRAYER_LEVEL_DIVISOR);
}

/** Content may say the death doesn't set Retribution off: `retribution:trigger` with `allow = false`. */
function setsOff(player) {
  if (!core.PrayerHandler.isActivated(player, core.PrayerHandler.RETRIBUTION)) return false;
  const blow = player.getCombat().getHitQueue().getLastAppliedHit();
  if (blow?.isReflected()) return false;
  const check = { player, hit: blow, allow: true };
  api.emitCustomEvent("retribution:trigger", check);
  return check.allow !== false;
}

/**
 * The area policy as the dying player would meet it, without telling them. Areas answer a refused
 * attack with a message to the attacker (the Wilderness level range, quest rules); the fire is not
 * an attack the player chose, so their packet sender is muted for the check.
 */
function allowedQuietly(dying, target) {
  const hadOwn = Object.prototype.hasOwnProperty.call(dying, "getPacketSender");
  const own = dying.getPacketSender;
  const mute = new Proxy({}, { get: () => () => mute });
  dying.getPacketSender = () => mute;
  try {
    return core.CombatFactory.canAttackByPolicy(dying, target) === core.CanAttackResponse.CAN_ATTACK;
  } finally {
    if (hadOwn) dying.getPacketSender = own;
    else delete dying.getPacketSender;
  }
}

/** Whether Retribution may hurt `target`: a living enemy in an area that lets the dying player attack it. */
function isEnemy(dying, target) {
  if (!target || target === dying || !target.isRegistered() || target.getHitpoints() <= 0 || target.isUntargetable()) return false;
  if (target.isNpc()) return target.getAsNpc().getCurrentDefinition().isAttackable() && allowedQuietly(dying, target);
  return !target.getAsPlayer().getDueling().inDuel() && allowedQuietly(dying, target);
}

/** Tiles from `centre` to the nearest tile a mobile covers (a big NPC's location is its south-west tile). */
function reach(centre, mobile) {
  const at = mobile.getLocation();
  const size = Math.max(1, mobile.getSize());
  const dx = Math.max(0, at.getX() - centre.getX(), centre.getX() - (at.getX() + size - 1));
  const dy = Math.max(0, at.getY() - centre.getY(), centre.getY() - (at.getY() + size - 1));
  return Math.max(dx, dy);
}

/** Everything standing on, or covering, one of the eight tiles around `centre`. */
function occupants(centre, area) {
  const found = core.World.getNpcsNear(centre, 1 + MOST_NPC_SIZE, area).filter((npc) => reach(centre, npc) === 1);
  for (const other of core.World.getPlayers()) {
    if (other.getPrivateArea() === area && other.getLocation().getZ() === centre.getZ() && reach(centre, other) === 1) found.push(other);
  }
  return found;
}

function fire(player, centre, area) {
  player.performGraphic(new core.Graphic(GRAPHIC, GRAPHIC_DELAY));
  core.Sounds.playAreaSound({ soundId: SOUND.ID, x: centre.getX(), y: centre.getY(), level: centre.getZ(), radius: SOUND.RADIUS, source: player });
  for (const [dx, dy] of NEIGHBOURS) {
    new core.Projectile(centre, centre.transform(dx, dy), null, PROJECTILE.ID, PROJECTILE.START, PROJECTILE.END,
      PROJECTILE.HEIGHT, PROJECTILE.HEIGHT, area).withAngle(PROJECTILE.ANGLE).withProgress(PROJECTILE.PROGRESS).sendProjectile();
  }
}

function land(player, centre, area, most) {
  for (const target of occupants(centre, area)) {
    if (!isEnemy(player, target)) continue;
    target.getCombat().getHitQueue().addPendingDamage([
      new core.HitDamage(core.Misc.randomInclusive(0, most), core.HitMask.RED).markReflected().setSource(player),
    ]);
  }
}

function retribute({ player }) {
  if (!setsOff(player)) return;
  const centre = player.getLocation().clone();
  const area = player.getPrivateArea();
  const most = maxHit(player);
  fire(player, centre, area);
  core.TaskManager.submit(new core.CountdownTask({}, core.Projectile.ticksToLand(PROJECTILE.END), () => land(player, centre, area, most)));
}

module.exports = {
  name: "Retribution",
  description: "The Retribution prayer: when its user dies, nearby enemies take damage up to a quarter of their Prayer level, with its graphic and sound.",
  _test: { maxHit, setsOff, isEnemy, occupants, land, reach },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onCustomEvent("player:dying", retribute);
  },
};
