const { mechanicSchema, mechanicSettings } = require("./Mechanics.SpecialAttack");
// TODO: ported from xrsps-typescript; untested.
module.exports = function registerStatiusWarhammerBhSpecialAttack(api) {
  const { Animation, CombatSpecial, Graphic, ItemIdentifiers, MeleeCombatMethod, Skill, Sound, Sounds } = api.core;

  const DRAIN = 35;
  const ANIMATION = new Animation(1378); // DRAGON_WARHAMMER_SA_PLAYER, same Smash as Statius's warhammer
  const SPECIAL_VFX = new Graphic(844);
  const DEFENCE_DRAIN_FRACTION = 0.75;

  class StatiusWarhammerBhCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      Sounds.playAreaSoundAt(character, Sound.DRAGON_WARHAMMER_SPECIAL);
    }

    handleAfterHitEffects(hit) {
      const config = mechanicSettings(this, "defence-drain", { percent: DEFENCE_DRAIN_FRACTION * 100, requireDamage: true, playersOnly: true });
      if (!config.enabled) return;
      if (!hit.isAccurate() || config.requireDamage && Math.floor(hit.getTotalDamage()) <= 0) {
        return;
      }
      const target = hit.getTarget();
      if (config.playersOnly && !target.isPlayer()) {
        // TODO: NPC combat-stat drain is not exposed by our core NPC state.
        return;
      }
      const skillManager = target.isPlayer() ? target.getAsPlayer().getSkillManager() : target.getAsNpc();
      const current = skillManager.getCurrentLevel(Skill.DEFENCE);
      const drainAmount = Math.floor(current * config.percent / 100);
      skillManager.setCurrentLevels(Skill.DEFENCE, Math.max(0, current - drainAmount));
    }
  }

  api.registerCombatSpecial({
    id: "statius_warhammer_bh",
    itemIds: [ItemIdentifiers.STATIUSS_WARHAMMER_BH_],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      minimumDamageMultiplier: 0.25,
      maximumDamageMultiplier: 1.25,
    },
    metadata: { editorMechanics: mechanicSchema("defence-drain", { percent: DEFENCE_DRAIN_FRACTION * 100, requireDamage: true, playersOnly: true }) },
    combatMethod: new StatiusWarhammerBhCombatMethod(),
  });
};
