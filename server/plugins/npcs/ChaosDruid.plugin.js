/**
 * Chaos druids (docs/chaos-druids.md). Wiki (Chaos druid): "They attack with their fists and make use of a
 * spell that appears to be a combination of the Confuse and Bind spells, binding their target very briefly
 * if successful." Max hit 2 (melee), attack speed 4.
 *
 * rsprox capture (rev 243, Edgeville Dungeon, ticks 172-387: 35 punches and 33 casts):
 * - The punch is human_unarmedpunch (422), its hit on the same tick.
 * - The cast is human_castentangle (710) with entangle_casting (177) at height 92 and sound_area
 *   bind_cast (101) at the druid, and the projectile entangle_travel (178): starttime 75, endtime
 *   46 + 10 a tile, angle 16, progress 64, heights 180 -> 0. The target gets bind_impact (181) or
 *   failedspell_impact (85) in slot 2 at height 124, with sound_area bind_impact (99) or spellfail (227),
 *   both delayed to the endtime. It never shows a hitsplat.
 * - A landed cast holds the player (8 ticks: "The holding effect is beginning to fade." 6 ticks after the
 *   cast) and, on the cast's tick, lowers Attack 81 -> 76 with "You feel weakened.". A later landed cast with
 *   Attack still lowered (77) drained nothing and said nothing.
 * - 29 of the 35 casts were from the next tile and the rest from 2-3 tiles, where a punch can't reach.
 *
 * Ours: a druid in reach casts or punches at even odds (the recorded split), and one out of reach casts
 * from up to the generic NPC cast range (10). Out of a fight it reports melee reach, so its hunt and
 * aggression ranges stay those of a melee monster.
 */
const CHAOS_DRUID_IDS = [520]; // chaos_druid
const BIND_CAST = { anim: 710, graphic: 177, graphicHeight: 92, sound: 101 };
const BIND_PROJECTILE = { id: 178, start: 75, endBase: 46, endPerTile: 10, angle: 16, progress: 64, startHeight: 180, endHeight: 0 };
const BIND_IMPACT = { graphic: 181, sound: 99 };
const SPLASH = { graphic: 85, sound: 227 };
/** The player's impact spotanim slot and height (every recorded cast). */
const IMPACT_SLOT = 2;
const IMPACT_HEIGHT = 124;
const AREA_SOUND_RADIUS = 10;
/** Ours: the generic NPC cast range; the recorded casts were from 1-3 tiles. */
const BIND_DISTANCE = 10;
const WEAKENED_MESSAGE = "You feel weakened.";

let core;
let MethodClass = null;
/** One method per druid, so the attack it picked survives between lookups. */
const methods = new WeakMap();

function isChaosDruid(mobile) {
  if (!mobile?.isNpc?.()) return false;
  const npc = mobile.getAsNpc();
  return CHAOS_DRUID_IDS.includes(npc.getId()) || CHAOS_DRUID_IDS.includes(npc.getRealId?.());
}

/** Whether the druid could punch the target from where it stands: the next tile on a side, no wall between. */
function inMeleeReach(npc, target) {
  const a = npc.getLocation(), b = target.getLocation();
  if (a.getZ() !== b.getZ() || Math.abs(a.getX() - b.getX()) + Math.abs(a.getY() - b.getY()) !== 1) return false;
  return core.RegionManager.canMove(a.getX(), a.getY(), b.getX(), b.getY(), a.getZ(), 1, 1, npc.getPrivateArea());
}

/** Ours: even odds in reach (35 punches to 33 casts recorded); out of reach it casts. */
function picksBind(npc, target) {
  if (!target || !inMeleeReach(npc, target)) return true;
  return core.Misc.randomInclusive(0, 1) === 0;
}

/** The projectile's endtime: 46 + 10 cycles a tile (recorded 56, 66 and 76 from 1, 2 and 3 tiles). */
function bindEndCycles(npc, target) {
  const a = npc.getLocation(), b = target.getLocation();
  const tiles = Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
  return BIND_PROJECTILE.endBase + BIND_PROJECTILE.endPerTile * Math.max(1, tiles);
}

function areaSound(at, source, soundId, delay = 0) {
  core.Sounds.playAreaSound({
    soundId, source, x: at.getX(), y: at.getY(), level: at.getZ(), delay, radius: AREA_SOUND_RADIUS,
  });
}

function castBind(npc, target) {
  const { Animation, Graphic, Projectile } = core;
  npc.performAnimation(new Animation(BIND_CAST.anim));
  npc.performGraphic(new Graphic(BIND_CAST.graphic, 0, BIND_CAST.graphicHeight));
  areaSound(npc.getLocation(), npc, BIND_CAST.sound);
  const end = bindEndCycles(npc, target);
  // The constructor takes the sent heights / 4.
  Projectile.createProjectile(npc, target, BIND_PROJECTILE.id, BIND_PROJECTILE.start, end,
    BIND_PROJECTILE.startHeight / 4, BIND_PROJECTILE.endHeight / 4)
    .withAngle(BIND_PROJECTILE.angle)
    .withProgress(BIND_PROJECTILE.progress)
    .sendProjectile();
  return end;
}

/** The impact or splash on the target, delayed to the projectile's end. */
function showImpact(target, accurate, end) {
  const impact = accurate ? BIND_IMPACT : SPLASH;
  target.performGraphicInSlot(IMPACT_SLOT, new core.Graphic(impact.graphic, end, IMPACT_HEIGHT));
  areaSound(target.getLocation(), target, impact.sound, end);
}

/**
 * The spell's two halves, on the cast's tick: Bind's hold (StandardBindings, 8 ticks) and Confuse's Attack
 * drain (StandardCurses, with the druid's own amount and line from curseRule).
 */
function bindAndConfuse(npc, target) {
  core.CombatSpells.BIND.spellEffect(npc, target, null);
  core.CombatSpells.CONFUSE.spellEffect(npc, target, null);
}

/** The druid's Confuse: floor(5%) + 1 of the current Attack (81 -> 76 recorded) and "You feel weakened.". */
function curseRule(rule) {
  if (!isChaosDruid(rule.attacker) || rule.spell !== core.CombatSpells.CONFUSE || !rule.target?.isPlayer?.()) return;
  rule.decrease = Math.floor(rule.current * 0.05) + 1;
  rule.message = WEAKENED_MESSAGE;
}

function methodClass() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType, PendingHit } = core;
  MethodClass = class ChaosDruidCombatMethod extends CombatMethod {
    constructor(npc) {
      super();
      const existing = npc ? methods.get(npc) : null;
      // The provider builds one per lookup; returning the druid's own keeps its picked attack.
      if (existing) return existing;
      if (npc) methods.set(npc, this);
      this.bind = null;
      this.landing = 0;
    }

    /** The attack the druid will make next, picked once per attack. */
    pick(npc, target) {
      if (this.bind === null) this.bind = picksBind(npc, target);
      return this.bind;
    }

    melee(npc) {
      return npc.getCombatMethod();
    }

    type(npc) {
      const target = npc?.getCombat?.().getTarget?.();
      return target && this.pick(npc, target) ? CombatType.MAGIC : CombatType.MELEE;
    }

    attackDistance(npc) {
      const target = npc?.getCombat?.().getTarget?.();
      if (!target) return this.melee(npc).attackDistance(npc);
      return this.pick(npc, target) ? BIND_DISTANCE : this.melee(npc).attackDistance(npc);
    }

    attackSpeed(npc) {
      return this.melee(npc).attackSpeed(npc);
    }

    canAttack(npc, target) {
      return this.pick(npc, target) ? true : this.melee(npc).canAttack(npc, target);
    }

    start(npc, target) {
      if (!this.pick(npc, target)) {
        this.melee(npc).start(npc, target);
        return;
      }
      this.landing = castBind(npc, target);
    }

    hits(npc, target) {
      if (!this.pick(npc, target)) return this.melee(npc).hits(npc, target);
      const hit = new PendingHit(npc, target, this, 0).withoutHitsplat();
      // The roll decides the hold and the drain; the cast deals no damage, but still counts as an attack.
      showImpact(target, hit.isAccurate(), this.landing);
      if (hit.isAccurate()) bindAndConfuse(npc, target);
      return [hit];
    }

    /** The cast's impact and effects are already sent from hits(); a punch's hit belongs to the melee method. */
    handleAfterHitEffects() {}

    finished(npc, target) {
      const bind = this.bind;
      this.bind = null;
      if (!bind) this.melee(npc).finished?.(npc, target);
    }
  };
  return MethodClass;
}

function attach(api) {
  core = api.core;
  api.registerNpcCombatMethodProvider(CHAOS_DRUID_IDS, methodClass(), { singleton: false });
  api.onCustomEvent("magic:curse-rule", curseRule);
}

module.exports = {
  name: "ChaosDruid",
  description: "Chaos druids punch and cast their Bind-and-Confuse spell, holding the player briefly and lowering their Attack, with the captured animations, projectile and sounds.",
  members: true,
  register: attach,
  _test: { CHAOS_DRUID_IDS, bindEndCycles, picksBind, inMeleeReach, curseRule, methodClass, methods },
};
