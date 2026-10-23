/**
 * Passive rune saving on staves.
 * - Staff of the dead (and its staff of light, staff of balance and toxic variants): 1/7 chance to
 *   negate the rune cost of a combat spell (https://oldschool.runescape.wiki/w/Staff_of_the_dead).
 * - Kodai wand: 15% chance to negate the rune cost of an offensive spell
 *   (https://oldschool.runescape.wiki/w/Kodai_wand).
 */
let core;

const STAFF_OF_THE_DEAD_CHANCE = 1 / 7;
const KODAI_WAND_CHANCE = 0.15;
const STAFF_OF_THE_DEAD_MESSAGE = "Your Staff of the dead negated your runes for this cast.";

const SAVING_WEAPONS = new Map([
  ["STAFF_OF_THE_DEAD", [STAFF_OF_THE_DEAD_CHANCE, STAFF_OF_THE_DEAD_MESSAGE]],
  ["STAFF_OF_LIGHT", [STAFF_OF_THE_DEAD_CHANCE, STAFF_OF_THE_DEAD_MESSAGE]],
  ["STAFF_OF_BALANCE", [STAFF_OF_THE_DEAD_CHANCE, STAFF_OF_THE_DEAD_MESSAGE]],
  ["TOXIC_STAFF_OF_THE_DEAD", [STAFF_OF_THE_DEAD_CHANCE, STAFF_OF_THE_DEAD_MESSAGE]],
  ["KODAI_WAND", [KODAI_WAND_CHANCE, null]],
  ["KODAI_WAND_3", [KODAI_WAND_CHANCE, null]],
]);

function savingFor(weaponId) {
  for (const [name, saving] of SAVING_WEAPONS) {
    if (core.ItemIdentifiers[name] === weaponId) return saving;
  }
  return null;
}

/** `magic:rune-saving` { player, offensive } -> `saved` (and a chat `message`) when the weapon negates the cost. */
function saveRunes(event) {
  const weaponId = event.player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.();
  const saving = savingFor(weaponId);
  if (event.offensive && saving && Math.random() < saving[0]) {
    event.saved = true;
    event.message = saving[1];
  }
}

module.exports = {
  name: "SpellRuneSaving",
  members: true,
  register(api) {
    core = api.core;
    api.onCustomEvent("magic:rune-saving", saveRunes);
  },
};
