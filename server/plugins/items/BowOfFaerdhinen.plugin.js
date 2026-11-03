// https://oldschool.runescape.wiki/w/Bow_of_Faerdhinen
let bowProfiles;

function attach(api) {
  bowProfiles = api.core.RangedWeapon.BOW_OF_FAERDHINEN;
}

function checkAmmo() {
  return null;
}

function decrementAmmo(player) {
  // The bow generates its projectile; it must never enter the thrown-item drop roll.
  // shortcut: regular Bowfa charges remain unmodelled; consume them here when charging is implemented.
  return bowProfiles.includes(player.getCombat().getRangedWeapon());
}

module.exports = {
  name: "BowOfFaerdhinen",
  members: true,
  register(api) {
    attach(api);
    api.registerRangedAmmoHandler({ checkAmmo, decrementAmmo });
  },
};
