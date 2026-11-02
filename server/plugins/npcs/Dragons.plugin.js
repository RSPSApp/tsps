const { CombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/CombatMethod");
const { CombatType } = require("../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { PendingHit } = require("../../src/main/typescript/elvarg/game/content/combat/hit/PendingHit");
const { Projectile } = require("../../src/main/typescript/elvarg/game/model/Projectile");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const {
  resolveChromaticDragonfireDamage,
  sendDragonfireMessages,
  initDragonfireProtectionCoreAccess,
} = require("../combat/DragonfireProtection");

const idsForFamilies = (families) => Object.entries(NpcIdentifiers)
  .filter(([name, id]) =>
    Number.isInteger(id) && families.some((family) => name === family || name.startsWith(`${family}_`)))
  .map(([, id]) => id);

const STANDARD_DRAGON_IDS = idsForFamilies([
  "GREEN_DRAGON",
  "BLUE_DRAGON",
  "RED_DRAGON",
  "BLACK_DRAGON",
  "LAVA_DRAGON",
  "REANIMATED_DRAGON",
  "FROST_DRAGON",
]);
const BRUTAL_DRAGON_IDS = idsForFamilies([
  "BRUTAL_GREEN_DRAGON",
  "BRUTAL_BLUE_DRAGON",
  "BRUTAL_RED_DRAGON",
  "BRUTAL_BLACK_DRAGON",
]);
const METALLIC_DRAGON_IDS = idsForFamilies([
  "BRONZE_DRAGON",
  "IRON_DRAGON",
  "STEEL_DRAGON",
  "MITHRIL_DRAGON",
  "ADAMANT_DRAGON",
  "RUNE_DRAGON",
]);

const DRAGON_MELEE_ANIMATION = new Animation(80);
const DRAGONFIRE_ANIMATION = new Animation(81);
const DRAGONFIRE_PROJECTILE_ID = 393;
const DRAGONFIRE_IMPACT_GFX = new Graphic(1);
const DRAGONFIRE_DELAY = 40;

// Breath lands 5 + 10 cycles a tile after launch, and hits when it does: a flat 40 -> 55
// crossed a long-range dragon's 8 tiles in a third of a second, with the hit a tick early.
const dragonfireEnd = (character, target) => Projectile.arrivalCycles(character, target, DRAGONFIRE_DELAY + 5, 10);

class DragonCombatMethod extends CombatMethod {
  constructor({ longRange = false, prayerProtects = true } = {}) {
    super();
    this.longRange = longRange;
    this.prayerProtects = prayerProtects;
    this.useDragonfire = false;
    this.currentAttackType = CombatType.MELEE;
  }

  start(character, target) {
    this.selectAttack(character, target);
    if (this.useDragonfire) {
      character.performAnimation(DRAGONFIRE_ANIMATION);
      Projectile.createProjectile(
        character,
        target,
        DRAGONFIRE_PROJECTILE_ID,
        DRAGONFIRE_DELAY,
        dragonfireEnd(character, target),
        31,
        43
      ).sendProjectile();
      return;
    }
    character.performAnimation(DRAGON_MELEE_ANIMATION);
  }

  attackSpeed() {
    return 4;
  }

  attackDistance() {
    return this.longRange ? 8 : 1;
  }

  type() {
    return this.currentAttackType;
  }

  hits(character, target) {
    if (!this.useDragonfire) {
      return [new PendingHit(character, target, this, 1)];
    }

    const hit = new PendingHit(character, target, this, {
      delay: Projectile.ticksToLand(dragonfireEnd(character, target)),
      rollAccuracy: false,
    });

    if (target.isPlayer()) {
      const player = target.getAsPlayer();
      const dragonfire = resolveChromaticDragonfireDamage(character, player, {
        maxHit: 50,
        prayerProtects: this.prayerProtects,
      });
      hit.setTotalDamage(dragonfire.damage);
      // The resolver above already applied the prayer (or ignored it for metallic
      // dragons); generic impact protection must not reduce the custom breath twice.
      hit.markProtectionBypassed();
      sendDragonfireMessages(player, dragonfire.messages);
    } else {
      hit.setTotalDamage(0);
    }

    return [hit];
  }

  handleAfterHitEffects(hit) {
    if (!this.useDragonfire) {
      return;
    }
    const target = hit?.getTarget?.();
    target?.performGraphic?.(DRAGONFIRE_IMPACT_GFX);
  }

  finished() {
  }

  selectAttack(character, target) {
    const distance = character?.calculateDistance?.(target) ?? 99;
    const canUseDragonfire =
      !!character &&
      !!target &&
      target.isPlayer?.() === true &&
      (this.longRange || distance <= 1);

    this.useDragonfire =
      canUseDragonfire &&
      ((this.longRange && distance > 1) || Misc.randomInclusive(0, 5) === 0);
    this.currentAttackType = this.useDragonfire
      ? CombatType.MAGIC
      : CombatType.MELEE;
  }
}

class BrutalDragonCombatMethod extends DragonCombatMethod {
  constructor() {
    super({ longRange: true });
  }
}

class MetallicDragonCombatMethod extends DragonCombatMethod {
  constructor() {
    super({ longRange: true, prayerProtects: false });
  }
}

module.exports = {
  name: "Dragons",
  register(api) {
    initDragonfireProtectionCoreAccess(api);
    api.registerNpcCombatMethodProvider(
      STANDARD_DRAGON_IDS,
      DragonCombatMethod,
      { singleton: false }
    );
    api.registerNpcCombatMethodProvider(
      BRUTAL_DRAGON_IDS,
      BrutalDragonCombatMethod,
      { singleton: false }
    );
    api.registerNpcCombatMethodProvider(
      METALLIC_DRAGON_IDS,
      MetallicDragonCombatMethod,
      { singleton: false }
    );
  },
};
