/**
 * Skeletal wyverns (Asgarnian Ice Dungeon), https://oldschool.runescape.wiki/w/Skeletal_Wyvern:
 * a bite / tail swipe at melee distance (max 13, Protect from Melee), the iceball (ranged, max 13,
 * 6 tiles, Protect from Missiles) and the icy breath (5 tiles, max 50). The breath ignores
 * Protect from Melee, is cut to 20 by Protect from Magic and to 10 by an elemental, mind or dragonfire
 * shield (an anti-dragon shield and antifire do nothing), and freezes for 6.6 seconds unless the
 * player wears an ancient wyvern shield. Animations and graphics are the cache's WYVERN_SKELETON_*
 * sequences and spotanims. The wiki gives no rule for choosing between attacks; see docs/skeletal-wyvern.md.
 */
const ICE_BREATH_MAX = Object.freeze({ unprotected: 50, prayer: 20, shield: 10 });
const BASIC_MAX_HIT = 13;
const FREEZE_TICKS = 11; // 6.6 seconds
/** Wiki: with a shield or Protect from Magic the same 1 in 7 as the dragons' special breaths. */
const FREEZE_DENOMINATOR_PROTECTED = 7;
const ICEBALL_DISTANCE = 6;
const BREATH_DISTANCE = 5;

const Attack = { MELEE: 0, ICEBALL: 1, BREATH: 2 };

const SEQ = { bite: 2985, tailSwipe: 2986, breath: 2988, iceball: 2989 };
const SPOTANIM = { iceballLaunch: 499, iceballTravel: 500, breathTravel: 501, breathImpact: 502 };

/** Shields that cut the breath to 10 (wiki). The anti-dragon shield is not among them. */
const BREATH_SHIELDS = new Set([
  "Elemental shield", "Mind shield", "Dragonfire shield", "Dragonfire ward", "Ancient wyvern shield",
]);
const FREEZE_IMMUNE_SHIELD = "Ancient wyvern shield";
const SHIELD_SLOT = 5;

function iceBreathMax({ shield, prayer }) {
  if (shield) return ICE_BREATH_MAX.shield;
  if (prayer) return ICE_BREATH_MAX.prayer;
  return ICE_BREATH_MAX.unprotected;
}

function shieldName(player) {
  const item = player.getEquipment().get(SHIELD_SLOT);
  const def = item && item.getId() > 0 ? item.getDefinition() : null;
  return def && !def.isNoted() ? def.getName() : "";
}

/**
 * Which attack comes next. `canMelee` is whether the wyvern could bite right now (an open shared edge, as for
 * any one-tile melee), `distance` the gap from its footprint: biting needs `canMelee`, the breath 5 tiles.
 */
function chooseAttack(canMelee, distance, roll) {
  if (canMelee) {
    if (roll < 0.5) return Attack.MELEE;
    return roll < 0.75 ? Attack.ICEBALL : Attack.BREATH;
  }
  if (distance > BREATH_DISTANCE) return Attack.ICEBALL;
  return roll < 0.5 ? Attack.ICEBALL : Attack.BREATH;
}

function combatClass(api) {
  const { Animation, Graphic, CombatMethod, CombatType, PendingHit, Projectile, Misc, CombatRange } = api.core;
  // The bite and tail swipe alternate per wyvern; a method is built fresh each cycle, so the count lives here.
  const swings = new WeakMap();
  const PrayerHandler = api.getPrayerHandler();
  const CombatFactory = api.getCombatFactory();

  class SkeletalWyvernCombatMethod extends CombatMethod {
    constructor() {
      super();
      // Not melee: the reach check runs before start(), and a stale melee type with a 6 tile range
      // skips the adjacency check. start() picks the real attack from the distance at that moment.
      this.attack = Attack.ICEBALL;
    }

    start(character, target) {
      const canMelee = CombatRange.canReach(character, CombatFactory.MELEE_COMBAT, target);
      const distance = CombatRange.footprintDistance(character.getLocation(), character.getSize(), target.getLocation());
      this.attack = chooseAttack(canMelee, distance, Math.random());
      if (this.attack === Attack.MELEE) {
        const swing = swings.get(character) ?? 0;
        swings.set(character, swing + 1);
        character.performAnimation(new Animation(swing % 2 === 0 ? SEQ.bite : SEQ.tailSwipe));
        return;
      }
      const iceball = this.attack === Attack.ICEBALL;
      character.performAnimation(new Animation(iceball ? SEQ.iceball : SEQ.breath));
      if (iceball) character.performGraphic(new Graphic(SPOTANIM.iceballLaunch));
      Projectile.createProjectile(
        character, target, iceball ? SPOTANIM.iceballTravel : SPOTANIM.breathTravel,
        40, Projectile.arrivalCycles(character, target), 43, 31,
      ).sendProjectile();
    }

    attackDistance() {
      return ICEBALL_DISTANCE;
    }

    type() {
      return this.attack === Attack.MELEE ? CombatType.MELEE : this.attack === Attack.ICEBALL ? CombatType.RANGED : CombatType.MAGIC;
    }

    hits(character, target) {
      if (this.attack === Attack.MELEE) return [new PendingHit(character, target, this, 1)];
      const delay = Projectile.arrivalTicks(character, target);
      if (this.attack === Attack.ICEBALL) return [new PendingHit(character, target, this, delay)];

      const hit = new PendingHit(character, target, this, { delay, rollAccuracy: false });
      // The breath's own table replaces the generic magic roll and its prayer stage.
      hit.markProtectionBypassed();
      hit.wyvernBreath = true;
      if (!target.isPlayer()) {
        hit.setTotalDamage(Misc.randomInclusive(0, ICE_BREATH_MAX.unprotected));
        return [hit];
      }
      const player = target.getAsPlayer();
      const name = shieldName(player);
      const shield = BREATH_SHIELDS.has(name);
      const prayer = PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC);
      hit.setTotalDamage(Misc.randomInclusive(0, iceBreathMax({ shield, prayer })));
      if (name !== FREEZE_IMMUNE_SHIELD) {
        hit.wyvernFreeze = shield || prayer ? Misc.randomInclusive(0, FREEZE_DENOMINATOR_PROTECTED - 1) === 0 : true;
      }
      return [hit];
    }

    /** The breath's impact graphic and freeze land with the hit, not when the breath launches. */
    handleAfterHitEffects(hit) {
      if (!hit || !hit.wyvernBreath) return;
      const target = hit.getTarget();
      if (!target) return;
      target.performGraphic(new Graphic(SPOTANIM.breathImpact));
      if (hit.wyvernFreeze && target.isPlayer()) CombatFactory.freezeTicks(target.getAsPlayer(), FREEZE_TICKS);
    }

    // Choosing in start() leaves nothing to carry from one attack to the next.
    finished() {}
  }

  return SkeletalWyvernCombatMethod;
}

module.exports = {
  name: "SkeletalWyvern",
  description: "Skeletal wyverns: bite and tail swipe, the iceball and the icy breath with its freeze.",
  members: true,
  register(api) {
    const { NpcIdentifiers } = api.core;
    api.registerNpcCombatMethodProvider(
      [NpcIdentifiers.SKELETAL_WYVERN, NpcIdentifiers.SKELETAL_WYVERN_2, NpcIdentifiers.SKELETAL_WYVERN_3, NpcIdentifiers.SKELETAL_WYVERN_4],
      combatClass(api),
      { singleton: false },
    );
  },
  _test: { iceBreathMax, chooseAttack, Attack, BREATH_SHIELDS, BASIC_MAX_HIT },
};
