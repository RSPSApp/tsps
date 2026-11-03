// Wiki: Eclipse atlatl. The special is a magic attack at melee reach, without ammunition.
module.exports = function registerEclipseAtlatlSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit } = api.core;

  const DRAIN = 50;
  const SPECIAL_ANIMATION = new Animation(11060);
  const SPECIAL_VFX = new Graphic(2797);
  const IMPACT_GRAPHIC = new Graphic(2798);
  const ACCURACY_MULTIPLIER = 1.5;

  const consumedBurns = new WeakMap();
  const traits = {
    hitCount: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    rollAttackType: "magic",
    damageType: "magic",
    maximumHitSource: "ranged",
  };

  class EclipseAtlatlCombatMethod extends CombatMethod {
    hits(character, target) {
      return [new PendingHit(character, target, this)];
    }

    type() {
      return CombatType.MAGIC;
    }

    canAttack(character, target) {
      if (!character.isPlayer()) return false;
      const query = { player: character.getAsPlayer(), fullSet: false };
      api.emitCustomEvent("eclipse-atlatl:full-set", query);
      if (!query.fullSet) character.getAsPlayer().sendMessage("You must wear the full Eclipse Moon armour set to use this special attack.");
      return query.fullSet;
    }

    start(character, target) {
      const burn = { target, remaining: 0 };
      api.emitCustomEvent("combat:consume-burn", burn);
      consumedBurns.set(character, Math.min(50, burn.remaining));
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }

    finished(character) {
      consumedBurns.delete(character);
    }
  }

  api.registerCombatSpecial({
    id: "eclipse_atlatl",
    itemIds: [ItemIdentifiers.ECLIPSE_ATLATL, ItemIdentifiers.ECLIPSE_ATLATL_4],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits,
    traitsFor: (player) => ({
      ...traits,
      minimumDamageBonus: Math.floor((consumedBurns.get(player) ?? 0) / 2),
      maximumDamageBonus: consumedBurns.get(player) ?? 0,
    }),
    combatMethod: new EclipseAtlatlCombatMethod(),
  });
};
