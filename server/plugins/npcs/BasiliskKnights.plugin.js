"use strict";

/**
 * Basilisk Knights in combat, from plugins/npcs/data/basilisk-knights.json (docs/basilisk-knights.md).
 *
 * Wiki (Basilisk Knight/Strategies): they "use standard melee and magic attacks, both with a maximum
 * hit of 20", they "will attempt to enter melee range once engaged in combat", and out of melee range
 * only magic. Wiki (Basilisk Knight): out of melee range their
 * attack speed "will match the player's current attack speed ... but can only go as low as 4 ticks".
 * The rsprox capture of recording 1862 gives the rest: both styles beside the player, every 4 ticks,
 * the cast's projectile, impact graphic and sounds. Without a mirror shield the hits are Equipment.Slayer's.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let DATA = null;
let MethodClass = null;

function core() {
  return api.core;
}

function data() {
  DATA ??= JSON.parse(fs.readFileSync(path.join(__dirname, "data", "basilisk-knights.json"), "utf8"));
  return DATA;
}

/** The tiles a mobile covers: [minX, minY, maxX, maxY]. */
function footprint(mobile) {
  const at = mobile.getLocation();
  const size = Math.max(1, mobile.getSize?.() ?? 1);
  return [at.getX(), at.getY(), at.getX() + size - 1, at.getY() + size - 1];
}

/** Melee range: the target touches the knight's footprint along an edge (not diagonally), on its floor. */
function beside(npc, target) {
  if (npc.getLocation().getZ() !== target.getLocation().getZ()) return false;
  const [ax, ay, bx, by] = footprint(npc);
  const [cx, cy, dx, dy] = footprint(target);
  const gapX = Math.max(0, cx - bx, ax - dx);
  const gapY = Math.max(0, cy - by, ay - dy);
  return (gapX === 1 && gapY === 0) || (gapX === 0 && gapY === 1);
}

/** In melee range: beside it with that edge open, by core's melee reach (a wall between them isn't). */
function inMelee(npc, target) {
  if (!beside(npc, target)) return false;
  const { CombatRange, CombatFactory } = core();
  return CombatRange.canReach(npc, CombatFactory.MELEE_COMBAT, target);
}

/** Where each knight last found it couldn't step closer: { x, y, target, tx, ty }. */
const stuck = new WeakMap();

const sameTile = (location, x, y) => location.getX() === x && location.getY() === y;

/**
 * Whether the knight can't get any closer to its target, so it casts from where it stands (Wiki: they
 * "attempt to enter melee range", and out of it "only retaliate with Magic"). It can't when it can't move
 * at all (a freeze), or when its last step toward the target hit scenery. That holds while neither of
 * them moves; once one does, the knight tries again.
 */
function cannotCloseIn(npc, target) {
  if (!target) return false;
  // Beside it across a wall there's no closer tile to step to.
  if (beside(npc, target)) return !inMelee(npc, target);
  const movement = npc.getMovementQueue?.();
  if (movement && movement.getMobility?.()?.canMove?.() === false) return true;
  const at = npc.getLocation();
  const to = target.getLocation();
  if (movement?.wasRouteInvalidated?.()) {
    stuck.set(npc, { x: at.getX(), y: at.getY(), target, tx: to.getX(), ty: to.getY() });
    return true;
  }
  const last = stuck.get(npc);
  if (last && last.target === target && sameTile(at, last.x, last.y) && sameTile(to, last.tx, last.ty)) return true;
  stuck.delete(npc);
  return false;
}

/**
 * When the cast lands, in client cycles: rec 1862 sends end 60 up to 3 tiles from the knight's centre
 * tile, then 6 more a tile (63 at 4, 69 at 5, 75 at 6), across 1,092 casts.
 */
function landingCycle(npc, target) {
  const { minEnd, base, perTile } = data().magic.projectile;
  const from = core().Projectile.centreOf(npc);
  const to = target.getLocation();
  const tiles = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
  return Math.max(minEnd, base + tiles * perTile);
}

/** Out of melee range, the player's own attack speed, no faster than 4 ticks (Wiki); 4 beside them (rec 1862). */
function speedAgainst(npc, target) {
  const floor = data().speed;
  if (!target || inMelee(npc, target) || !target.isPlayer?.()) return floor;
  const { CombatFactory, PluginManager } = core();
  // The player's swing interval after the onAttackSpeed hooks (league masteries, relics), as Combat swings it.
  const method = CombatFactory.getMethod(target);
  const raw = method?.attackSpeed?.(target) | 0;
  const own = PluginManager.emitAttackSpeed(target, npc, method?.type?.(), raw) | 0;
  return Math.max(floor, own);
}

function sendSounds(target, sounds) {
  if (!target.isPlayer?.()) return;
  const { Sound, Sounds } = core();
  for (const [id, delay] of sounds) Sounds.sendSound(target, new Sound(id, 1, delay, 0));
}

/** The combat method; the provider makes one per attack, so the style lives only for that attack. */
function method() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType, PendingHit, Animation, Graphic, Projectile } = core();
  MethodClass = class BasiliskKnightCombatMethod extends CombatMethod {
    constructor(npc = null) {
      super();
      this.npc = npc;
      this.style = null;
      this.landing = 0;
    }

    /**
     * Until an attack starts, melee's, so the knight walks up to the player's side (not a diagonal);
     * magic's from wherever it can't step closer.
     */
    type() {
      if (this.style != null) return this.style;
      const target = this.npc?.getCombat?.()?.getTarget?.();
      return this.npc && !cannotCloseIn(this.npc, target) ? CombatType.MELEE : CombatType.MAGIC;
    }

    attackDistance() {
      return this.type() === CombatType.MAGIC ? data().magicRange : 1;
    }

    attackSpeed(character) {
      return speedAgainst(character, character.getCombat?.()?.getTarget?.());
    }

    start(character, target) {
      // Beside the player either style (rec 1862: melee, melee, then magic against a player beside it,
      // ticks 9686-9694); the split between them is ours. Out of range (only where it can't step closer)
      // only magic (Wiki).
      const melee = inMelee(character, target) && Math.random() < data().meleeChance;
      this.style = melee ? CombatType.MELEE : CombatType.MAGIC;
      if (melee) {
        character.performAnimation(new Animation(data().melee.anim));
        sendSounds(target, data().melee.sounds);
        return;
      }
      const { anim, projectile, impact, sounds, landSound } = data().magic;
      this.landing = landingCycle(character, target);
      character.performAnimation(new Animation(anim));
      Projectile.createProjectile(character, target, projectile.id, projectile.start, this.landing,
        projectile.startHeight / 4, projectile.endHeight / 4)
        .withAngle(projectile.angle).withProgress(projectile.progress).sendProjectile();
      // Sent with the cast, timed to the landing, hit or miss (rec 1862: 597 of 603 casts at the recorder).
      target.performGraphic(new Graphic(impact.id, this.landing, impact.height));
      sendSounds(target, [...sounds, [landSound, this.landing]]);
    }

    hits(character, target) {
      const melee = this.type() === CombatType.MELEE;
      const delay = melee ? data().melee.hitDelay : Projectile.ticksToLand(this.landing || landingCycle(character, target));
      return [new PendingHit(character, target, this, delay)];
    }
  };
  return MethodClass;
}

module.exports = {
  name: "BasiliskKnights",
  description: "Basilisk Knight combat: walks into melee range, then melee or magic beside the player; magic from where it can't step closer, at the player's attack speed (4 ticks at the fastest), with the captured cast.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.registerNpcCombatMethodProvider(data().ids, method(), { singleton: false });
  },
  _test: { beside, inMelee, cannotCloseIn, landingCycle, speedAgainst, method, data },
};
