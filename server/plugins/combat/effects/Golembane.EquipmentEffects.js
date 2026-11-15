/**
 * Golembane melee weapons against golems (Wiki: Golembane, Barronite mace, Granite hammer):
 * accuracy and damage each gain a percentage of themselves.
 * - Barronite mace (and its (l) copy) 15%: "a 15% damage and accuracy bonus against golems,
 *   including those within the dungeon", so it is not limited to the Ruins of Camdozaal.
 * - Granite hammer 30%: "dealing 30% extra damage and accuracy against all golem-type creatures".
 * A golem is a monster with the Wiki "golem" attribute (monsters-complete.json): the Camdozaal
 * golems, Rock/Runite golems, gargoyles, Dawn and Dusk, the Stone Guardians and so on.
 * Both pages say the bonus stacks (multiplicatively) with a black mask or slayer helmet; each
 * modifier here scales the value the earlier ones left, as Demonbane does.
 * Ours: the addition is rounded down, as the Wiki DPS calculator does for demonbane.
 */
const { asPlayer, weaponName, targetHasAttribute, addPercent } = require("./GearChecks.EquipmentEffects");

const GOLEMBANE_PERCENT = new Map([
  ["barronite mace", 15],
  ["barronite mace (l)", 15],
  ["granite hammer", 30],
]);

function percentFor(entity) {
  const player = asPlayer(entity);
  if (!player) return 0;
  const percent = GOLEMBANE_PERCENT.get(weaponName(player)) ?? 0;
  return percent > 0 && targetHasAttribute(entity, "golem") ? percent : 0;
}

function meleeGolembane(entity, value) {
  const percent = percentFor(entity);
  return percent > 0 ? addPercent(value, percent) : value;
}

module.exports = function registerGolembaneEffects(api) {
  api.registerMeleeAttackAccuracyModifier(meleeGolembane);
  api.registerMeleeHitModifier(meleeGolembane);
};

module.exports._test = { meleeGolembane };
