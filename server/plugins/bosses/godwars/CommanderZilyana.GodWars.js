"use strict";

// Wiki: 27 melee, 10-20 magic, attack speed 2 from the definition.
const MELEE_MAX_HIT = 27;
const MAGIC_MAX_HIT = 20;
const MAGIC_MIN_HIT = 10;

// Cache: GODWARS_SARADOMIN_ATTACK/_MAGIC_ATTACK, _MAGIC_ATTACK_SPOTANIM.
const MELEE_ANIMATION = 6967;
const MAGIC_ANIMATION = 6970;
const MAGIC_GRAPHIC = 1196;

module.exports = function registerCommanderZilyana(api) {
  const {
    Animation,
    CombatFactory,
    CombatMethod,
    CombatType,
    Graphic,
    Misc,
    NpcIdentifiers,
    PendingHit,
  } = api.core;

  const NPC_IDS = [
    NpcIdentifiers.COMMANDER_ZILYANA,
    NpcIdentifiers.COMMANDER_ZILYANA_2,
  ];

  class CommanderZilyanaCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MELEE;
    }

    type() {
      return this.stance;
    }

    // She can only attack from melee distance, magic included.
    attackDistance() {
      return 1;
    }

    start(character) {
      // 3/5 melee, 2/5 magic.
      this.stance = Misc.randomInclusive(0, 4) < 3 ? CombatType.MELEE : CombatType.MAGIC;
      character.performAnimation(
        new Animation(this.stance === CombatType.MAGIC ? MAGIC_ANIMATION : MELEE_ANIMATION)
      );
    }

    hits(character, target) {
      const magic = this.stance === CombatType.MAGIC;
      const hit = new PendingHit(character, target, this, 1);
      CombatFactory.applyStyleDamage(hit, magic ? MAGIC_MAX_HIT : MELEE_MAX_HIT, {
        minHit: magic ? MAGIC_MIN_HIT : 0,
      });
      return [hit];
    }

    handleAfterHitEffects(hit) {
      if (this.stance === CombatType.MAGIC && hit.getTarget().isPlayer()) {
        hit.getTarget().performGraphic(new Graphic(MAGIC_GRAPHIC));
      }
    }
  }

  api.registerNpcCombatMethodProvider(NPC_IDS, CommanderZilyanaCombatMethod, { singleton: false });
};
