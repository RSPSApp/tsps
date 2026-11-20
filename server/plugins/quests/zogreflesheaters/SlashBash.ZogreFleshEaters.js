/**
 * Slash Bash's two attacks. The Wiki (Slash Bash) lists "Ranged, Crush" and says safespotting him
 * east of the stand makes him use only ranged. The capture (rsprox ZogreFleshEaters.bin, ticks
 * 2440-2650) shows the shapes and when each is used:
 * - Crush: `ogre_attack` (359) with the hit on the same tick (2440, 2488, 2494), only while the
 *   player stands next to him.
 * - Ranged: `ogre_breath` (2101) and the `flob` projectile (397), launched at 41 and landing at
 *   51 + 5 cycles a tile from his centre, at 163 -> 146 on the wire, angle 15 and progress 11, with
 *   the area sound `ogre_bow` (1452, range 10) at him on the same tick. The
 *   hit lands 2 ticks after the breath at every range in the capture (2446 -> 2448, 2470 -> 2472,
 *   2500 -> 2502). He uses it from 3+ tiles away (2446-2464, 2500-2642) and also next to the
 *   player (2470-2482, the same tile as the crush at 2488).
 * Ours: the even chance between the two while he is in melee reach.
 */
const SLASH_BASH_ID = 882; // zogre_slash_bash
const RANGED_ANIMATION = 2101; // ogre_breath
const FLOB_PROJECTILE = 397;
const FLOB_DELAY = 41;
const FLOB_END_BASE = 51;
const FLOB_CYCLES_PER_TILE = 5;
/** 163 and 146 on the wire, in the quarter units Projectile sends times four. */
const FLOB_START_HEIGHT = 40.75;
const FLOB_END_HEIGHT = 36.5;
const FLOB_ANGLE = 15;
const FLOB_PROGRESS = 11;
const RANGED_HIT_DELAY = 2;
const OGRE_BOW_SOUND = 1452;
const OGRE_BOW_SOUND_RADIUS = 10;
const MELEE_CHANCE = 0.5;

module.exports = function attachSlashBash(api) {
  const { Animation, CombatMethod, CombatRange, CombatType, MeleeCombatMethod, PendingHit, Projectile, RangedCombatMethod, Sounds } = api.core;
  const melee = new MeleeCombatMethod();
  const ranged = new RangedCombatMethod();

  /** Crush only where it reaches, and then only some of the time; ranged otherwise. */
  function chooseStyle(npc) {
    const target = npc?.getCombat?.().getTarget?.();
    if (!target || !CombatRange.canReach(npc, melee, target)) return CombatType.RANGED;
    return Math.random() < MELEE_CHANCE ? CombatType.MELEE : CombatType.RANGED;
  }

  function breathe(npc, target) {
    npc.performAnimation(new Animation(RANGED_ANIMATION));
    const at = npc.getLocation();
    Sounds.playAreaSound({ soundId: OGRE_BOW_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), radius: OGRE_BOW_SOUND_RADIUS, source: npc });
    const end = Projectile.arrivalCycles(npc, target, FLOB_END_BASE, FLOB_CYCLES_PER_TILE);
    Projectile.createProjectile(npc, target, FLOB_PROJECTILE, FLOB_DELAY, end, FLOB_START_HEIGHT, FLOB_END_HEIGHT)
      .withAngle(FLOB_ANGLE)
      .withProgress(FLOB_PROGRESS)
      .sendProjectile();
  }

  /** A new one each attack (singleton: false), so each attack picks its style from where the player stands. */
  class SlashBashCombat extends CombatMethod {
    constructor(npc) {
      super();
      this.style = chooseStyle(npc);
    }

    type() {
      return this.style;
    }

    attackSpeed(npc) {
      return melee.attackSpeed(npc);
    }

    attackDistance(npc) {
      return this.style === CombatType.MELEE ? melee.attackDistance(npc) : ranged.attackDistance(npc);
    }

    start(npc, target) {
      if (this.style === CombatType.MELEE) {
        melee.start(npc, target);
        return;
      }
      breathe(npc, target);
    }

    hits(npc, target) {
      if (this.style === CombatType.MELEE) return melee.hits(npc, target);
      return [new PendingHit(npc, target, this, RANGED_HIT_DELAY)];
    }
  }

  api.registerNpcCombatMethodProvider([SLASH_BASH_ID], SlashBashCombat, { singleton: false });
};
