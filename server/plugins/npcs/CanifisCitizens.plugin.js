// OSRS Wiki: Werewolf / Wolfbane. Cache gamevals pair each human with its werewolf form.
let core;
const forms = new Map();
let transformAnimation;

function loadForms() {
  forms.clear();
  const cache = core.CacheDefinitions;
  for (const [sex, count] of [["man", 8], ["woman", 12]]) {
    for (let i = 1; i <= count; i++) {
      const human = cache.getNpcId(`canafis_${sex}${i}`);
      const wolf = cache.getNpcId(`canafis_werewolf_${sex}${i}`);
      if (human == null || wolf == null) throw new Error("Canifis citizen forms missing from cache");
      forms.set(human, wolf);
    }
  }
  transformAnimation = cache.getSeqId("werewolf_update_transform_werewolf");
  if (transformAnimation == null) throw new Error("Canifis transformation animation missing from cache");
}

function attacked({ attacker, target }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || target.getHitpoints() <= 0) return;
  const wolf = forms.get(target.getId());
  if (wolf == null) return;
  const weapon = attacker.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId();
  if (weapon === core.ItemIdentifiers.WOLFBANE || weapon === core.ItemIdentifiers.WOLFBANE_2) return;
  const missingHealth = target.getMaxHitpoints() - target.getHitpoints();
  target.setNpcTransformationId(wolf);
  target.setHitpoints(Math.max(1, target.getMaxHitpoints() - missingHealth));
  target.performAnimation(new core.Animation(transformAnimation));
  core.CombatFactory.clearHitRollCache(target);
}

module.exports = {
  name: "CanifisCitizens",
  members: true,
  register(api) {
    core = api.core;
    api.onServerStartup(loadForms);
    api.onCombatHitPrepare(attacked);
  },
};
