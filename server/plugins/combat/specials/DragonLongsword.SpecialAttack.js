// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDragonLongswordSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, GraphicHeight, ItemIdentifiers, MeleeCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 25;
  const DAMAGE_MULTIPLIER = 1.25;
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(1058);
  const GRAPHIC = new Graphic(248, GraphicHeight.HIGH);

  class DragonLongswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.sendSound(character, Sound.DRAGON_LONGSWORD_SPECIAL);
    }
  }

  api.registerCombatSpecial({
    id: "dragon_longsword",
    itemIds: [ItemIdentifiers.DRAGON_LONGSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: DAMAGE_MULTIPLIER,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      damageMultiplier: DAMAGE_MULTIPLIER,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new DragonLongswordCombatMethod(),
  });
};
