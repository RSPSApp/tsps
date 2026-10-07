/**
 * Abyssal tentacle (https://oldschool.runescape.wiki/w/Abyssal_tentacle).
 *
 * A successful normal hit has a 25% chance to poison the target for 4 damage
 * (regular poison, not venom). CombatPoisonData deliberately omits the
 * tentacle, so the roll lives here rather than in core.
 */
const POISON_CHANCE = 0.25;
const POISON_SEVERITY = 4;
const POISON_ORB_TYPE = 1;

let core = null;
let tentacleIds = new Set();

function wieldedTentacle(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  return weapon && tentacleIds.has(weapon.getId()) ? weapon : null;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !target || !hit?.isAccurate?.() || !(hit?.getTotalDamage?.() > 0)) {
    return;
  }
  const player = attacker.getAsPlayer();
  if (!wieldedTentacle(player)) {
    return;
  }
  if (Math.random() >= POISON_CHANCE) {
    return;
  }
  core.CombatFactory.poisonEntity(target, POISON_SEVERITY, POISON_ORB_TYPE);
}

function attach(pluginApi) {
  core = pluginApi.core;
  tentacleIds = new Set([
    core.ItemIdentifiers.ABYSSAL_TENTACLE,
    core.ItemIdentifiers.ABYSSAL_TENTACLE_OR_,
  ]);
}

module.exports = {
  name: "AbyssalTentacle",
  members: true,
  register(api) {
    attach(api);
    api.onCombatHitResolved(onHitResolved);
  },
  _test: { onHitResolved, POISON_CHANCE, POISON_SEVERITY },
};
