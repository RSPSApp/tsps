"use strict";

/**
 * Ghosts Ahoy's progress, kept in the varbits live writes (all bit fields of varp 408). Each
 * one is saved as a player attribute and sent whenever it changes and at login. The values and
 * the moments they change are the user's revision 242 capture's (20261112T092603-5ab63b4):
 * docs/quests/ghosts-ahoy/README.md.
 *
 * Saves from before the varbits are converted once at login (see `migrateLegacy`).
 */

/** Varbit ids (gameval names in comments). */
const VARBIT = Object.freeze({
  WINDSPEED: 205, // ahoy_windspeed: 1 = Low, 0 = High
  GIVEN_MANUAL: 206, // ahoy_given_manual
  GIVEN_ROBES: 207, // ahoy_given_robes
  GIVEN_BOOK: 208, // ahoy_given_book
  SIGNATURES: 209, // ahoy_signaturecounter: 1 with the form, +1 a signature, 11 full, 31 burned
  NETTLE_TEA: 211, // ahoy_subquest_nettletea: 1 asked, 2 cup given, 3 tea drunk
  BOW: 212, // ahoy_subquest_bow: 1 agreed, 2 first game, 3-6 wins, 7 signed, 8 traded
  TEMPLE_DOOR: 213, // ahoy_templedoor_unlocked
  TOY_BOAT: 214, // ahoy_subquest_toyboat: 1 given, 2 key given, 3 chest unlocked
  LOBSTER: 215, // ahoy_killed_lobster
});

/** The attribute each saved varbit lives in. */
const ATTRIBUTE = Object.freeze({
  [VARBIT.GIVEN_MANUAL]: "ghosts-ahoy:given-manual",
  [VARBIT.GIVEN_ROBES]: "ghosts-ahoy:given-robes",
  [VARBIT.GIVEN_BOOK]: "ghosts-ahoy:given-book",
  [VARBIT.SIGNATURES]: "ghosts-ahoy:signatures",
  [VARBIT.NETTLE_TEA]: "ghosts-ahoy:nettle-tea",
  [VARBIT.BOW]: "ghosts-ahoy:bow",
  [VARBIT.TEMPLE_DOOR]: "ghosts-ahoy:temple-door",
  [VARBIT.TOY_BOAT]: "ghosts-ahoy:toy-boat",
  [VARBIT.LOBSTER]: "ghosts-ahoy:lobster",
});

/** The signature counter's special values. */
const SIGNATURES_FORM = 1;
const SIGNATURES_FULL = 11;
const SIGNATURES_BURNED = 31;

/** The flag colours: the toy boat's (as dyed) and the mast's (random), per part. */
const TOY_FLAG_ATTRIBUTE = "ghosts-ahoy:toy-flag";
const MAST_FLAG_ATTRIBUTE = "ghosts-ahoy:mast-flag";
/** Told the crone her son was found (her "Good news!" option); no varbit live shows it. */
const TOLD_CRONE_ATTRIBUTE = "ghosts-ahoy:told-crone";

/** The pre-varbit save keys and how each maps onto the varbits. */
const LEGACY = Object.freeze({
  bow: "quest.ghosts_ahoy.bow",
  toy: "quest.ghosts_ahoy.toy",
  signatures: "quest.ghosts_ahoy.signatures",
  burned: "quest.ghosts_ahoy.petition_burned",
  givenBook: "quest.ghosts_ahoy.given_book",
  givenManual: "quest.ghosts_ahoy.given_manual",
  givenRobes: "quest.ghosts_ahoy.given_robes",
  tomb: "quest.ghosts_ahoy.tomb_unlocked",
  lobster: "quest.ghosts_ahoy.lobster_killed",
  told: "quest.ghosts_ahoy.told_crone",
  toyTop: "quest.ghosts_ahoy.toy_top",
  toySkull: "quest.ghosts_ahoy.toy_skull",
  toyBottom: "quest.ghosts_ahoy.toy_bottom",
  mastTop: "quest.ghosts_ahoy.mast_top",
  mastSkull: "quest.ghosts_ahoy.mast_skull",
  mastBottom: "quest.ghosts_ahoy.mast_bottom",
});

function get(player, varbit) {
  return Number(player.getAttribute(ATTRIBUTE[varbit])) | 0;
}

function set(player, varbit, value) {
  player.setAttribute(ATTRIBUTE[varbit], value | 0);
  player.getPacketSender().sendVarbit(varbit, value | 0);
}

/** Every saved varbit, as live sends them at login. */
function replay(player) {
  for (const varbit of Object.keys(ATTRIBUTE)) {
    player.getPacketSender().sendVarbit(Number(varbit), get(player, Number(varbit)));
  }
}

/** [top, bottom, skull] colour indices (0 white, 1-6 the dyes); null when never set. */
function flag(player, attribute) {
  const value = player.getAttribute(attribute);
  return Array.isArray(value) && value.length === 3 ? value.map((part) => part | 0) : null;
}

function setFlag(player, attribute, parts) {
  player.setAttribute(attribute, parts.map((part) => part | 0));
}

/**
 * Converts a save from before the varbits (quest.ghosts_ahoy.* attributes): the bow, toy,
 * hand-in, door and lobster flags carry over as they are; the old signature count becomes the
 * counter (form 1, then 1 + signatures, 31 once burned). The old keys are removed after.
 */
function migrateLegacy(player, heldPetition) {
  const old = (key) => player.getAttribute(key);
  if (!Object.values(LEGACY).some((key) => old(key) !== undefined && old(key) !== null)) return false;
  const number = (key) => Number(old(key)) | 0;
  const carry = (varbit, value) => {
    if (value > get(player, varbit)) player.setAttribute(ATTRIBUTE[varbit], value);
  };
  carry(VARBIT.BOW, Math.min(8, number(LEGACY.bow)));
  carry(VARBIT.TOY_BOAT, Math.min(3, number(LEGACY.toy)));
  carry(VARBIT.GIVEN_BOOK, number(LEGACY.givenBook) === 1 ? 1 : 0);
  carry(VARBIT.GIVEN_MANUAL, number(LEGACY.givenManual) === 1 ? 1 : 0);
  carry(VARBIT.GIVEN_ROBES, number(LEGACY.givenRobes) === 1 ? 1 : 0);
  carry(VARBIT.TEMPLE_DOOR, number(LEGACY.tomb) === 1 ? 1 : 0);
  carry(VARBIT.LOBSTER, number(LEGACY.lobster) === 1 ? 1 : 0);
  const signatures = Math.min(10, number(LEGACY.signatures));
  if (number(LEGACY.burned) === 1) carry(VARBIT.SIGNATURES, SIGNATURES_BURNED);
  else if (signatures > 0 || heldPetition) carry(VARBIT.SIGNATURES, SIGNATURES_FORM + signatures);
  if (number(LEGACY.told) === 1) player.setAttribute(TOLD_CRONE_ATTRIBUTE, 1);
  const toy = [number(LEGACY.toyTop), number(LEGACY.toyBottom), number(LEGACY.toySkull)];
  if (toy.some(Boolean) && !flag(player, TOY_FLAG_ATTRIBUTE)) setFlag(player, TOY_FLAG_ATTRIBUTE, toy);
  const mast = [number(LEGACY.mastTop), number(LEGACY.mastBottom), number(LEGACY.mastSkull)];
  if (mast.every(Boolean) && !flag(player, MAST_FLAG_ATTRIBUTE)) setFlag(player, MAST_FLAG_ATTRIBUTE, mast);
  // An undefined attribute is left out of the save.
  for (const key of Object.values(LEGACY)) player.setAttribute(key, undefined);
  return true;
}

/** Saves every attribute here, with the value a new player starts with. */
function persist(api) {
  for (const attribute of Object.values(ATTRIBUTE)) api.persistAttribute(attribute, 0);
  api.persistAttribute(TOLD_CRONE_ATTRIBUTE, 0);
  // Flags have no fixed starting value: the mast is rolled per player.
  api.persistAttribute(TOY_FLAG_ATTRIBUTE);
  api.persistAttribute(MAST_FLAG_ATTRIBUTE);
  // Read so an old save's progress can be converted at login.
  for (const key of Object.values(LEGACY)) api.persistAttribute(key);
}

module.exports = {
  VARBIT,
  ATTRIBUTE,
  SIGNATURES_FORM,
  SIGNATURES_FULL,
  SIGNATURES_BURNED,
  TOY_FLAG_ATTRIBUTE,
  MAST_FLAG_ATTRIBUTE,
  TOLD_CRONE_ATTRIBUTE,
  LEGACY,
  get,
  set,
  replay,
  flag,
  setFlag,
  migrateLegacy,
  persist,
};
