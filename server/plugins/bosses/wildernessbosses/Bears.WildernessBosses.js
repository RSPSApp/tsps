/**
 * Callisto and Artio (https://oldschool.runescape.wiki/w/Callisto/Strategies,
 * https://oldschool.runescape.wiki/w/Artio/Strategies), as captured (docs/wilderness-bosses.md):
 *
 * - Melee (npc_callisto_attack_melee01) on a target next to it, diagonals too: 35-55 for
 *   Callisto, 15-35 for Artio, halved by Protect from Melee, and the same blow lands on anyone
 *   standing next to the target. Six ticks to the next attack.
 * - Ranged (attack_ranged01) when it can't reach: a crescent at everyone in the lair (up to 31 /
 *   17, blocked by Protect from Missiles), landing as the projectile does. Five ticks.
 * - The knockback orb (attack_magic01, windblast) every 8-12 attacks: unless Protect from Magic
 *   is on when it lands, everyone within a tile of the target is thrown 3 tiles away from the
 *   bear, taking 5 damage, and 15 more for each tile a wall stopped them short; a trap that stops
 *   them deals the 5 and springs on them (Wiki). Eight ticks.
 * - At 66% and 33% of its hitpoints it roars (enraged01) the tick after the hit that crossed,
 *   shaking off a freeze, and from then on lays five bear traps every 6 ticks across the lair.
 * - The first freeze always lands when it isn't frozen (Wiki); it can be frozen despite its
 *   size ("combat:freezable").
 */
const Common = require("./Common.WildernessBosses");
const Caves = require("./Caves.WildernessBosses");
const Traps = require("./Traps.WildernessBosses");

const SIZE = Object.freeze({ callisto: 5, artio: 3 });

const BEARS = Object.freeze({
  6609: Object.freeze({
    key: "callisto", meleeMin: 35, meleeMax: 55, rangedMax: 31, roarGraphic: 2352, // fx_callisto_enrage
  }),
  11992: Object.freeze({
    key: "artio", meleeMin: 15, meleeMax: 35, rangedMax: 17, roarGraphic: 2353, // fx_callisto_enrage_small
  }),
});

const ANIMATION = Object.freeze({ melee: 10012, ranged: 10013, magic: 10014, roar: 10015, spawn: 10016 });
/** Captured cadence: ticks from each attack to the next. */
const SPEED = Object.freeze({ melee: 6, ranged: 5, magic: 8 });
const FIRST_ATTACK_TICKS = 7;
const ROAR_DELAY_TICKS = 6;

const RANGED = Object.freeze({
  projectile: 2350, // fx_callisto_ranged_projectile
  castGraphic: 2349, // fx_callisto_ranged_spotanim
  impactGraphic: 2351, // fx_callisto_ranged_impact
  impactSound: 6968,
  start: 30, startHeight: 0, endHeight: 40, angle: 10, progress: 50,
});
const ORB = Object.freeze({
  projectile: 133, // windblast_travel
  start: 60, startHeight: 40, endHeight: 40, angle: 10, progress: 50,
});
const KNOCKBACK = Object.freeze({
  animation: 12212, // human_troll_flyback_withsound
  sounds: [6934, 6960],
  tiles: 3,
  baseDamage: 5,
  perBlockedTile: 15,
  damageAfterTicks: 3,
});
const ORB_EVERY = Object.freeze({ min: 8, max: 12 });
/** BonusManager.ATTACK_MAGIC: the magic attack bonus's slot. */
const ATTACK_MAGIC_BONUS = 3;
const ROAR_AT = Object.freeze([0.66, 0.33]);

const PHASE_ATTRIBUTE = "wilderness-bosses:bear-phase";
const ATTACKS_ATTRIBUTE = "wilderness-bosses:bear-attacks";
const NEXT_ORB_ATTRIBUTE = "wilderness-bosses:bear-next-orb";

let api = null;
let core = null;
let PrayerHandler = null;

function bearOf(npc) {
  return BEARS[npc?.getId?.()] ?? null;
}

function sizeOf(bear) {
  return SIZE[bear.key];
}

function centre(npc, bear) {
  const base = npc.getLocation();
  const half = Math.floor(sizeOf(bear) / 2);
  return { x: base.getX() + half, y: base.getY() + half, z: base.getZ() };
}

function canMelee(npc, bear, target) {
  const at = target.getLocation();
  return at.getZ() === npc.getLocation().getZ() && Common.edgeDistance(npc, at.getX(), at.getY()) === 1;
}

function protects(player, prayer) {
  return PrayerHandler.isActivated(player, prayer);
}

function hit(player, damage) {
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE)]);
}

function lairOf(bear) {
  return Common.LAIR_BY_KEY.get(bear.key);
}

function lairPlayers(bear) {
  return Caves.playersIn(bear.key).filter(Common.alive);
}

// ------------------------------------------------------------------ attacks

function melee(npc, bear, method, target) {
  npc.performAnimation(new core.Animation(ANIMATION.melee));
  const at = target.getLocation();
  const struck = lairPlayers(bear).filter((player) => {
    const where = player.getLocation();
    return where.getZ() === at.getZ() && Math.max(Math.abs(where.getX() - at.getX()), Math.abs(where.getY() - at.getY())) <= 1;
  });
  if (!struck.includes(target) && target.isPlayer()) struck.push(target);
  for (const player of struck) {
    const rolled = Common.randomBetween(bear.meleeMin, bear.meleeMax);
    const damage = protects(player, PrayerHandler.PROTECT_FROM_MELEE) ? Math.floor(rolled / 2) : rolled;
    Common.bossHit(npc, method, player, damage, 0);
  }
}

function projectileTo(npc, bear, player, shape, end) {
  const from = centre(npc, bear);
  new core.Projectile(new core.Location(from.x, from.y, from.z), player.getLocation(), player, shape.projectile,
    shape.start, end, shape.startHeight, shape.endHeight, null)
    .withSource(npc).withAngle(shape.angle).withProgress(shape.progress).sendProjectile();
}

function distanceFromCentre(npc, bear, player) {
  const from = centre(npc, bear);
  const at = player.getLocation();
  return Math.max(Math.abs(at.getX() - from.x), Math.abs(at.getY() - from.y));
}

function rangedHitTicks(end) {
  return core.Projectile.ticksToLand(end);
}

/** Captured: the crescent flies 30 + 6 per tile (from the bear's middle, plus one) cycles. */
function ranged(npc, bear, method) {
  npc.performAnimation(new core.Animation(ANIMATION.ranged));
  npc.performGraphic(new core.Graphic(RANGED.castGraphic));
  for (const player of lairPlayers(bear)) {
    const end = RANGED.start + 6 * (distanceFromCentre(npc, bear, player) + 1);
    projectileTo(npc, bear, player, RANGED, end);
    player.performGraphic(new core.Graphic(RANGED.impactGraphic, end));
    player.getPacketSender().sendSoundEffect(RANGED.impactSound, 1, end);
    const damage = protects(player, PrayerHandler.PROTECT_FROM_MISSILES) ? 0 : Common.randomBetween(0, bear.rangedMax);
    // Splat on the first tick at or after the crescent lands; floor - 1 hit before it (#1862).
    Common.bossHit(npc, method, player, damage, rangedHitTicks(end));
  }
}

/** The octant from the bear's middle to a tile, as a unit step. */
function awayStep(from, x, y) {
  const angle = Math.atan2(y - from.y, x - from.x);
  const octant = Math.round(angle / (Math.PI / 4));
  return { dx: Math.round(Math.cos(octant * Math.PI / 4)), dy: Math.round(Math.sin(octant * Math.PI / 4)) };
}

function knockBack(npc, bear, player) {
  const from = centre(npc, bear);
  const start = player.getLocation();
  const { dx, dy } = awayStep(from, start.getX(), start.getY());
  let x = start.getX();
  let y = start.getY();
  let moved = 0;
  let trapped = false;
  while (moved < KNOCKBACK.tiles && core.RegionManager.canMove(x, y, x + dx, y + dy, start.getZ(), 1, 1, null)) {
    x += dx;
    y += dy;
    moved++;
    if (Traps.at(bear.key, x, y)) {
      trapped = true;
      break;
    }
  }
  if (moved > 0) player.moveTo(new core.Location(x, y, start.getZ()));
  player.performAnimation(new core.Animation(KNOCKBACK.animation, 20));
  for (const sound of KNOCKBACK.sounds) player.getPacketSender().sendSoundEffect(sound, 1, 0);
  const damage = trapped ? KNOCKBACK.baseDamage : KNOCKBACK.baseDamage + KNOCKBACK.perBlockedTile * (KNOCKBACK.tiles - moved);
  Common.later(KNOCKBACK.damageAfterTicks, () => Common.alive(player) && hit(player, damage), player);
}

/** Captured: the orb flies 60 + 12 per tile and lands floor(end / 30) ticks later. */
function orb(npc, bear, target) {
  npc.performAnimation(new core.Animation(ANIMATION.magic));
  const end = ORB.start + 12 * distanceFromCentre(npc, bear, target);
  projectileTo(npc, bear, target, ORB, end);
  Common.later(Math.floor(end / 30), () => {
    if (!Common.alive(npc) || !Common.alive(target)) return;
    const at = target.getLocation();
    for (const player of lairPlayers(bear)) {
      const where = player.getLocation();
      if (where.getZ() !== at.getZ() || Math.max(Math.abs(where.getX() - at.getX()), Math.abs(where.getY() - at.getY())) > 1) continue;
      if (!protects(player, PrayerHandler.PROTECT_FROM_MAGIC)) knockBack(npc, bear, player);
    }
  }, npc);
}

// ------------------------------------------------------------------ roars

/** Hits that cross 66% or 33% roar the tick after (captured); the roar shakes off a freeze. */
function checkRoar(npc, bear, incoming) {
  const phase = Number(npc.getAttribute(PHASE_ATTRIBUTE)) || 0;
  if (phase >= ROAR_AT.length) return;
  const after = npc.getHitpoints() - incoming;
  if (after <= 0 || after > npc.getMaxHitpoints() * ROAR_AT[phase]) return;
  npc.setAttribute(PHASE_ATTRIBUTE, phase + 1);
  Common.later(1, () => roar(npc, bear), npc);
}

function roar(npc, bear) {
  if (!Common.alive(npc)) return;
  npc.performAnimation(new core.Animation(ANIMATION.roar));
  npc.performGraphic(new core.Graphic(bear.roarGraphic));
  npc.getTimers().cancel(core.TimerKey.FREEZE);
  npc.getTimers().cancel(core.TimerKey.FREEZE_IMMUNITY);
  npc.getCombat().extendAttackDelay(ROAR_DELAY_TICKS);
  Traps.start(npc, bear.key);
}

// ------------------------------------------------------------------ the combat method

function combatClass() {
  const { CombatMethod, CombatType } = core;
  return class BearCombat extends CombatMethod {
    start(character, target) {
      const npc = character.getAsNpc();
      const bear = bearOf(npc);
      this.npc = npc;
      if (!bear || !target?.isPlayer?.()) return;
      const attacks = (Number(npc.getAttribute(ATTACKS_ATTRIBUTE)) || 0) + 1;
      npc.setAttribute(ATTACKS_ATTRIBUTE, attacks);
      npc.setPositionToFace(target.getLocation());
      if (attacks >= (Number(npc.getAttribute(NEXT_ORB_ATTRIBUTE)) || ORB_EVERY.max)) {
        npc.setAttribute(NEXT_ORB_ATTRIBUTE, attacks + Common.randomBetween(ORB_EVERY.min, ORB_EVERY.max));
        orb(npc, bear, target);
        character.getCombat().setAttackDelay(SPEED.magic);
      } else if (canMelee(npc, bear, target)) {
        melee(npc, bear, this, target);
        character.getCombat().setAttackDelay(SPEED.melee);
      } else {
        ranged(npc, bear, this);
        character.getCombat().setAttackDelay(SPEED.ranged);
      }
    }

    /** start() queues every hit itself (several players at once). */
    hits() {
      return [];
    }

    attackDistance() {
      return 15;
    }

    type() {
      const npc = this.npc;
      const target = npc?.getCombat?.().getTarget?.() ?? null;
      const bear = bearOf(npc);
      return bear && target && canMelee(npc, bear, target) ? CombatType.MELEE : CombatType.RANGED;
    }
  };
}

// ------------------------------------------------------------------ hooks

function hitModify({ npc, hit: pending }) {
  const bear = bearOf(npc);
  if (!bear) return;
  const incoming = (pending.getHits?.() ?? []).reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  checkRoar(npc, bear, incoming);
}

const FREEZE_SPELLS = () => [
  core.CombatSpells.BIND, core.CombatSpells.SNARE, core.CombatSpells.ENTANGLE,
  core.CombatSpells.ICE_RUSH, core.CombatSpells.ICE_BURST, core.CombatSpells.ICE_BLITZ, core.CombatSpells.ICE_BARRAGE,
];

/** Wiki: the first freeze always lands when the bear isn't frozen and the caster's magic accuracy is positive. */
function hitRoll(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !bearOf(target)) return;
  const spell = attacker.getCombat().getSelectedSpell();
  if (!spell || !FREEZE_SPELLS().includes(spell)) return;
  const timers = target.getTimers();
  if (timers.has(core.TimerKey.FREEZE) || timers.has(core.TimerKey.FREEZE_IMMUNITY)) return;
  const magicAccuracy = attacker.getBonusManager().getAttackBonus()[ATTACK_MAGIC_BONUS];
  if (magicAccuracy > 0) event.forceAccurate = true;
}

/** A fresh bear: its spawn animation, a clean fight, and the first attack 7 ticks on (captured). */
function spawned(npc) {
  const bear = bearOf(npc);
  if (!bear) return;
  npc.setAttribute(PHASE_ATTRIBUTE, 0);
  npc.setAttribute(ATTACKS_ATTRIBUTE, 0);
  npc.setAttribute(NEXT_ORB_ATTRIBUTE, Common.randomBetween(ORB_EVERY.min, ORB_EVERY.max));
  npc.setFlag("combat:close-in");
  npc.setFlag("combat:freezable");
  npc.setFlag("combat:no-regen");
  npc.performAnimation(new core.Animation(ANIMATION.spawn));
  npc.getCombat().setAttackDelay(FIRST_ATTACK_TICKS);
  Traps.clear(bear.key, false);
}

/** An abandoned fight (Caves): its traps go and it starts over at its first phase. */
function reset(npc) {
  const bear = bearOf(npc);
  if (!bear) return;
  npc.setAttribute(PHASE_ATTRIBUTE, 0);
  npc.setAttribute(ATTACKS_ATTRIBUTE, 0);
  Traps.clear(bear.key, false);
}

function died({ npc }) {
  const bear = bearOf(npc);
  if (bear) Traps.clear(bear.key, true);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.registerNpcCombatMethodProvider(Object.keys(BEARS).map(Number), combatClass(), { singleton: false });
  pluginApi.onNpcHitModify(hitModify);
  pluginApi.onCombatHitRoll(hitRoll);
  pluginApi.onNpcBeforeDeath(died);
  for (const bear of Object.values(BEARS)) Common.FIGHTS.set(bear.key, { spawned, reset, playerTick: Traps.playerTick });
}

module.exports = { attach, _test: { BEARS, awayStep, checkRoar, lairOf, RANGED, rangedHitTicks } };
