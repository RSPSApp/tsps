"use strict";

// Wiki: 46 melee, 10-30 magic, 35-49 prayer-smash special (2/27 of attacks,
// 1 in 9 melee hits). Attack speed 6 from the definition.
const MELEE_MAX_HIT = 46;
const MAGIC_MAX_HIT = 30;
const MAGIC_MIN_HIT = 10;
const SPECIAL_MAX_HIT = 49;
const SPECIAL_MIN_HIT = 35;
const SPECIAL_CHAT = "YARRRRRRR!";

// Cache: GODWARS_ZAMORAK_ATTACK/_MAGIC_ATTACK, _MAGIC_ATTACK_PROJ/_SPOT.
const MELEE_ANIMATION = 6948;
const MAGIC_ANIMATION = 6950;
const MAGIC_PROJECTILE = 1225;
const MAGIC_GRAPHIC = 1224;

module.exports = function registerKrilTsutsaroth(api) {
  const {
    Animation,
    CombatFactory,
    CombatMethod,
    CombatType,
    Graphic,
    Misc,
    NpcIdentifiers,
    PendingHit,
    Projectile,
    Skill,
  } = api.core;

  const NPC_IDS = [
    NpcIdentifiers.KRIL_TSUTSAROTH,
    NpcIdentifiers.KRIL_TSUTSAROTH_2,
  ];

  class KrilTsutsarothCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MAGIC;
      this.special = false;
    }

    type() {
      return this.stance;
    }

    attackDistance() {
      return 8;
    }

    start(character, target) {
      this.special = false;
      if (character.calculateDistance(target) > 1) {
        this.stance = CombatType.MAGIC;
      } else {
        // Melee 16/27, magic 9/27, prayer smash 2/27.
        const roll = Misc.randomInclusive(0, 26);
        if (roll < 16) {
          this.stance = CombatType.MELEE;
        } else if (roll < 25) {
          this.stance = CombatType.MAGIC;
        } else {
          this.stance = CombatType.MELEE;
          this.special = true;
        }
      }
      if (this.stance === CombatType.MAGIC) {
        character.performAnimation(new Animation(MAGIC_ANIMATION));
        Projectile.createProjectile(
          character,
          target,
          MAGIC_PROJECTILE,
          40,
          Projectile.arrivalCycles(character, target),
          43,
          31
        ).sendProjectile();
        return;
      }
      character.performAnimation(new Animation(MELEE_ANIMATION));
      if (this.special) {
        character.forceChat(SPECIAL_CHAT);
      }
    }

    hits(character, target) {
      const delay = this.stance === CombatType.MAGIC ? Projectile.arrivalTicks(character, target) : 1;
      const hit = new PendingHit(character, target, this, delay);
      const magic = this.stance === CombatType.MAGIC;
      CombatFactory.applyStyleDamage(
        hit,
        this.special ? SPECIAL_MAX_HIT : magic ? MAGIC_MAX_HIT : MELEE_MAX_HIT,
        {
          minHit: this.special ? SPECIAL_MIN_HIT : magic ? MAGIC_MIN_HIT : 0,
          bypassProtectionPrayer: this.special,
        }
      );
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        return;
      }
      if (this.stance === CombatType.MAGIC) {
        target.performGraphic(new Graphic(MAGIC_GRAPHIC));
        return;
      }
      if (!this.special || !hit.isAccurate()) {
        return;
      }
      const skills = target.getAsPlayer().getSkillManager();
      const prayer = skills.getCurrentLevel(Skill.PRAYER);
      if (Number.isFinite(prayer) && prayer > 0) {
        skills.setCurrentLevels(Skill.PRAYER, prayer - Math.floor(prayer / 2));
      }
    }
  }

  api.registerNpcCombatMethodProvider(NPC_IDS, KrilTsutsarothCombatMethod, { singleton: false });
};
