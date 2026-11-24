module.exports = function registerZamorakGodswordSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, PendingHit, Priority, Sound, Sounds } = api.core;

  const DRAIN = 50;
  const FREEZE_SECONDS = 19.2; // 32 ticks, as Ice Barrage
  const SLASH_DEFENCE_BONUS_INDEX = 1;
  const ANIMATION = new Animation(7638);
  const GRAPHIC = new Graphic(1210, Priority.HIGH);
  const ICE_GRAPHIC = new Graphic(369, Priority.HIGH); // Ice Barrage impact

  class ZamorakGodswordCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(GRAPHIC);
      Sounds.playAreaSoundAt(character, Sound.GODSWORD_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const freeze = { enabled: true, durationTicks: 32, ...this.specialMechanics?.freeze };
      if (!freeze.enabled) return;
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(ICE_GRAPHIC);
        CombatFactory.freeze(hit.getTarget(), freeze.durationTicks * .6, undefined, hit.getAttacker());
      }
    }
  }

  api.registerCombatSpecial({
    id: "zamorak_godsword",
    itemIds: [ItemIdentifiers.ZAMORAK_GODSWORD],
    drainAmount: DRAIN,
    strengthMultiplier: 1.1,
    accuracyMultiplier: 2,
    metadata: { editorMechanics: { version: 1, groups: [{
      id: "freeze", name: "Freeze", phase: "At impact", hook: "handleAfterHitEffects", event: "accurate",
      trigger: "When the hit passes accuracy, even if it deals zero damage",
      description: "Freeze the enemy for {durationTicks} ticks ({durationTicks:seconds} s), unless immunity or existing freeze protection prevents it.",
      preview: { graphic: 369, recipient: "target" },
      parameters: [
        { key: "enabled", label: "Enable freeze", type: "boolean", value: true },
        { key: "durationTicks", label: "Freeze duration (ticks)", type: "number", value: FREEZE_SECONDS / .6, min: 1, max: 100, step: 1 },
      ],
    }] } },
    traits: {
      hitCount: 1,
      accuracyMultiplier: 2,
      damageMultiplier: 1.1,
      meleeDefenceBonusIndex: SLASH_DEFENCE_BONUS_INDEX,
    },
    combatMethod: new ZamorakGodswordCombatMethod(),
  });
};
