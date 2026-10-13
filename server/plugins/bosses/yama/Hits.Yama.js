/**
 * Yama's ways of hurting the challenger, shared by the fight's units: a styled hit that rolls
 * like any NPC attack and lets the protection prayer through only as far as the phase allows,
 * typeless damage from the arena, burn, poison, roots, and the map animations and projectiles
 * the attacks show.
 */
const Common = require("./Common.Yama");

const BURN_VARBIT = 10964;
const BURN_HITSPLAT_VARBIT = 10965;
const BURN_INTERVAL_TICKS = 4;
const SET_ALIGHT = "<col=ff8e32>You have been set alight!";

const styleMethods = new Map();

function styleMethod(style) {
  let method = styleMethods.get(style);
  if (!method) {
    const { CombatMethod, CombatType } = Common.core;
    const type = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC }[style];
    method = new (class extends CombatMethod {
      type() {
        return type;
      }

      hits() {
        return [];
      }
    })();
    styleMethods.set(style, method);
  }
  return method;
}

const PRAYER_FOR = { melee: "PROTECT_FROM_MELEE", ranged: "PROTECT_FROM_MISSILES", magic: "PROTECT_FROM_MAGIC" };

function protectedFrom(player, style) {
  const { PrayerHandler } = Common.core;
  const prayer = PRAYER_FOR[style];
  return Boolean(prayer) && PrayerHandler.isActivated(player, PrayerHandler[prayer]);
}

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * A styled hit from `npc`, landing `delay` ticks from now. The protection prayer of its style
 * lets through at most `throughPrayer` (0 blocks it); `accurate` skips the accuracy roll.
 */
function strike(npc, player, style, maxHit, delay, { throughPrayer = 0, accurate = false } = {}) {
  const { PendingHit, CombatFactory, World } = Common.core;
  const hit = new PendingHit(npc, player, styleMethod(style), { delay, rollAccuracy: !accurate });
  CombatFactory.applyStyleDamage(hit, Math.max(0, Math.floor(maxHit)), { bypassProtectionPrayer: true });
  if (protectedFrom(player, style)) {
    for (const part of hit.getHits()) part.setDamage(Math.min(part.getDamage(), randomInt(0, throughPrayer)));
    hit.updateTotalDamage();
  }
  player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle() + Math.max(0, delay));
  if (hit.getTotalDamage() > 0) player.__yamaHurt = true;
  return hit;
}

/** Damage no prayer or armour stops (the arena's hazards, the flares, glyphs of fire). */
function damage(player, amount) {
  const { HitDamage, HitMask } = Common.core;
  const value = Math.max(0, Math.floor(amount));
  if (value > 0) player.__yamaHurt = true;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(value, value > 0 ? HitMask.RED : HitMask.BLUE)]);
}

/** Set alight: 1 damage every 4 ticks, `total` times (varbit player_own_burn_damage_total). */
function burn(fight, total) {
  const { player } = fight;
  const sender = player.getPacketSender();
  player.sendMessage(SET_ALIGHT);
  let left = Math.max(fight.burnLeft ?? 0, total);
  fight.burnLeft = left;
  sender.sendVarbit(BURN_VARBIT, left);
  sender.sendVarbit(BURN_HITSPLAT_VARBIT, 1);
  if (fight.burning) return;
  fight.burning = true;
  const step = () => {
    if (fight.stopped || !player.isRegistered() || fight.burnLeft <= 0) {
      fight.burning = false;
      sender.sendVarbit(BURN_HITSPLAT_VARBIT, 0);
      return;
    }
    damage(player, 1);
    fight.burnLeft--;
    sender.sendVarbit(BURN_VARBIT, fight.burnLeft);
    fight.at(BURN_INTERVAL_TICKS, step);
  };
  fight.at(BURN_INTERVAL_TICKS, step);
}

/** Yama's poison (Wiki: from 20). */
function poison(player, severity) {
  const { CombatFactory } = Common.core;
  CombatFactory.poisonEntity(player, severity);
}

/** Rooted in place for `ticks` (no message, no freeze immunity after). */
function root(player, ticks) {
  const { TimerKey } = Common.core;
  player.getTimers().registers(TimerKey.FREEZE, ticks);
  player.getMovementQueue().reset();
}

function drainPrayer(player, points) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  const now = skills.getCurrentLevel(Skill.PRAYER);
  skills.setCurrentLevel(Skill.PRAYER, Math.max(0, now - Math.max(0, Math.floor(points))), true);
}

function graphic(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = Common.core;
  const gfx = new Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

/** A map animation the challenger sees on a tile. */
function tileGraphic(player, location, id, options) {
  player.getPacketSender().sendGraphic(graphic(id, options), location);
}

/** A projectile from `from` (a mobile or a tile) to `to` (a mobile or a tile), as captured. */
function projectile(fight, from, to, spec) {
  const { Projectile, Location } = Common.core;
  const tileOf = (thing) => (thing instanceof Location ? thing : Projectile.centreOf(thing));
  const lockon = to instanceof Location ? null : to;
  new Projectile(tileOf(from), tileOf(to), lockon, spec.id, spec.start, spec.end, spec.startHeight, spec.endHeight, fight.session.area)
    .withAngle(spec.angle)
    .withProgress(spec.progress)
    .sendProjectile();
}

function sound(player, spec) {
  if (spec) player.getPacketSender().sendSoundEffect(spec.id, 1, spec.delay ?? 0);
}

module.exports = {
  strike, damage, burn, poison, root, drainPrayer, graphic, tileGraphic, projectile, sound,
  protectedFrom, randomInt,
};
