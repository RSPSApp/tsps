// https://oldschool.runescape.wiki/w/Blade_of_Saeldor
// Charges: docs/crystal-weapons.md. A swing uses one, hit or miss; 1,000 used is 1% of corruption progress.
const { defineCrystalWeapon } = require("./CrystalWeapon");

const CHARGES_META_KEY = "blade-of-saeldor:charges";
const CHARGES_USED_PER_PERCENT = 1000;

let core;
let blade;

function attach(api) {
  core = api.core;
  const ids = core.ItemIdentifiers;
  blade = defineCrystalWeapon(api, {
    name: "blade of Saeldor",
    chargesKey: CHARGES_META_KEY,
    chargedName: "Blade of Saeldor",
    inactiveName: "Blade of Saeldor (inactive)",
    pairs: [[ids.BLADE_OF_SAELDOR, ids.BLADE_OF_SAELDOR_INACTIVE_]],
    usedPerPercent: CHARGES_USED_PER_PERCENT,
  });
  blade.attach();
}

/** The charge goes when the swing is made, from the blade that made it. */
function onAttackStarted({ attacker, method }) {
  if (!attacker?.isPlayer?.() || method?.type?.() !== core.CombatType.MELEE) {
    return;
  }
  blade.useCharge(attacker.getAsPlayer());
}

module.exports = {
  name: "BladeOfSaeldor",
  members: true,
  register(api) {
    attach(api);
    api.onCustomEvent("combat:attack-started", onAttackStarted);
  },
};
