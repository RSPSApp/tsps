/**
 * The Nightmare: what the units share - the plugin api, plugins/bosses/data/nightmare.json, tick
 * timing, and the packets every part of the fight sends (map animations, area sounds, projectiles,
 * hits that roll like an NPC attack, typeless damage).
 */
const fs = require("fs");
const path = require("path");

/** Set while the player is in a dream, so a login there puts them back in the sanctuary. */
const INSIDE_ATTRIBUTE = "nightmare:inside";
/** Kill counts and best times (ticks), per version. */
const KILLS_ATTRIBUTE = "nightmare:kills";
const PHOSANI_KILLS_ATTRIBUTE = "nightmare:phosani-kills";
const BEST_ATTRIBUTE = "nightmare:best-ticks";
const PHOSANI_BEST_ATTRIBUTE = "nightmare:phosani-best-ticks";
/** "Yes, and don't ask again." on the way in and out. */
const SKIP_WARNING_ATTRIBUTE = "nightmare:skip-warning";
const PHOSANI_SKIP_WARNING_ATTRIBUTE = "nightmare:phosani-skip-warning";
const SKIP_LEAVE_WARNING_ATTRIBUTE = "nightmare:skip-leave-warning";
/** What Shura or Sister Senga hold from a death in the dream: { holder, items: [[id, amount]] }. */
const HELD_ITEMS_ATTRIBUTE = "nightmare:held-items";
/** Sister Senga's introduction has been heard. */
const PHOSANI_INTRO_ATTRIBUTE = "nightmare:phosani-intro";

const CHUNK = 8;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "nightmare.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffled = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

function graphic(id, { delay = 0, height = 0 } = {}) {
  const gfx = new core.Graphic(id);
  gfx.delay = delay;
  gfx.height = height;
  return gfx;
}

function animation(id, delay = 0) {
  return new core.Animation(id, delay);
}

/** A fade of the overlay atmosphere (script 948 with the captured arguments). */
function fade(player, args) {
  player.getPacketSender().sendSubInterface((161 << 16) | 1, 174, 1, {
    postScripts: [{ scriptId: 948, args }],
  });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface((161 << 16) | 1);
}

/** Sounds as captured: [id, delay] pairs, or a bare id. */
function sounds(player, list) {
  for (const entry of list ?? []) {
    const [id, delay] = Array.isArray(entry) ? entry : [entry, 0];
    player.getPacketSender().sendSoundEffect(id, 1, delay ?? 0);
  }
}

/** A map animation every player in the dream sees on a tile. */
function tileGraphic(players, location, id, options) {
  for (const player of players) player.getPacketSender().sendGraphic(graphic(id, options), location);
}

/** A sound from a tile, as the capture's sound_area: [id, delay, range]. */
function areaSound(players, location, [id, delay = 0, range = 7]) {
  for (const player of players) {
    player.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), 1, delay, range);
  }
}

/** A projectile from `from` (a mobile or a tile) to `to` (a mobile or a tile), as captured. */
function projectile(area, from, to, spec) {
  const { Projectile, Location } = core;
  const tileOf = (thing) => (thing instanceof Location ? thing : Projectile.centreOf(thing));
  const lockon = to instanceof Location ? null : to;
  const shot = new Projectile(tileOf(from), tileOf(to), lockon, spec.id, spec.start, spec.end, spec.startHeight, spec.endHeight, area)
    .withAngle(spec.angle)
    .withProgress(spec.progress);
  if (!(from instanceof Location)) shot.withSource(from);
  shot.sendProjectile();
}

const styleMethods = new Map();

/** A combat method that only names a style, for hits the fight times itself. */
function styleMethod(style) {
  let method = styleMethods.get(style);
  if (!method) {
    const { CombatMethod, CombatType } = core;
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

const PRAYERS = { melee: "PROTECT_FROM_MELEE", ranged: "PROTECT_FROM_MISSILES", magic: "PROTECT_FROM_MAGIC" };

/** Which style the player's active protection prayer stops, if any. */
function protectedStyle(player) {
  const { PrayerHandler } = core;
  for (const [style, prayer] of Object.entries(PRAYERS)) {
    if (PrayerHandler.isActivated(player, PrayerHandler[prayer])) return style;
  }
  return null;
}

/**
 * A styled hit from `npc`, landing `delay` ticks from now: rolled like an NPC attack, then the
 * protection prayer applied the fight's way (`prayed(style, prayer)` returns the multiplier).
 */
function strike(npc, player, style, maxHit, delay, { accurate = false, prayed = null } = {}) {
  const { PendingHit, CombatFactory, World } = core;
  const hit = new PendingHit(npc, player, styleMethod(style), { delay, rollAccuracy: !accurate });
  CombatFactory.applyStyleDamage(hit, Math.max(0, Math.floor(maxHit)), { bypassProtectionPrayer: true });
  const factor = prayed ? prayed(style, protectedStyle(player)) : 1;
  if (factor !== 1) {
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() * factor));
    hit.updateTotalDamage();
  }
  player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle() + Math.max(0, delay));
  return hit;
}

/** Damage no prayer or armour stops (claws, flowers, a blast, a parasite bursting out). */
function damage(target, amount) {
  const { HitDamage, HitMask } = core;
  const value = Math.max(0, Math.floor(amount));
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(value, value > 0 ? HitMask.RED : HitMask.BLUE)]);
}

function heal(target, amount) {
  const { Skill } = core;
  if (target.isPlayer?.()) {
    const skills = target.getSkillManager();
    skills.setCurrentLevel(Skill.HITPOINTS, Math.min(skills.getMaxLevel(Skill.HITPOINTS), skills.getCurrentLevel(Skill.HITPOINTS) + amount), true);
  } else {
    target.setHitpoints(target.getHitpoints() + amount);
  }
}

/** m:ss, as the kill message prints a fight's length. */
function formatTicks(ticks) {
  const seconds = Math.round(ticks * 0.6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

module.exports = {
  init, later, toLocation, randomInt, pick, shuffled, count, graphic, animation, fade, closeFade, sounds,
  tileGraphic, areaSound, projectile, styleMethod, protectedStyle, strike, damage, heal, formatTicks,
  INSIDE_ATTRIBUTE, KILLS_ATTRIBUTE, PHOSANI_KILLS_ATTRIBUTE, BEST_ATTRIBUTE, PHOSANI_BEST_ATTRIBUTE,
  SKIP_WARNING_ATTRIBUTE, PHOSANI_SKIP_WARNING_ATTRIBUTE, SKIP_LEAVE_WARNING_ATTRIBUTE, HELD_ITEMS_ATTRIBUTE, PHOSANI_INTRO_ATTRIBUTE, CHUNK,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
