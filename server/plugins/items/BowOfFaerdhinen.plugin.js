// https://oldschool.runescape.wiki/w/Bow_of_Faerdhinen
// Charges: docs/crystal-weapons.md. A shot uses one, hit or miss; 2,000 used is 1% of corruption progress.
const { defineCrystalWeapon } = require("./CrystalWeapon");

const CHARGES_META_KEY = "bow-of-faerdhinen:charges";
const CHARGES_USED_PER_PERCENT = 2000;

let bowProfiles;
let bow;

function attach(api) {
  const ids = api.core.ItemIdentifiers;
  bowProfiles = api.core.RangedWeapon.BOW_OF_FAERDHINEN;
  bow = defineCrystalWeapon(api, {
    name: "bow of Faerdhinen",
    chargesKey: CHARGES_META_KEY,
    chargedName: "Bow of Faerdhinen",
    inactiveName: "Bow of Faerdhinen (inactive)",
    pairs: [[ids.BOW_OF_FAERDHINEN, ids.BOW_OF_FAERDHINEN_INACTIVE_]],
    usedPerPercent: CHARGES_USED_PER_PERCENT,
  });
  bow.attach();
}

function checkAmmo() {
  return null;
}

function decrementAmmo(player) {
  // The bow generates its projectile; it must never enter the thrown-item drop roll.
  if (!bowProfiles.includes(player.getCombat().getRangedWeapon())) {
    return false;
  }
  bow.useCharge(player);
  return true;
}

module.exports = {
  name: "BowOfFaerdhinen",
  description: "Bow of Faerdhinen: uses one charge per shot, hit or miss, and has its inactive form, built on the shared crystal-weapon charge code.",
  members: true,
  register(api) {
    attach(api);
    api.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
  },
};
