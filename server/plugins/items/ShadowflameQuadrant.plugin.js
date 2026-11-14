/**
 * The Shadowflame quadrant (Wiki: Shadowflame quadrant; Leagues VI: Demonic Pacts). Its other
 * passives live in the shared systems: the four elemental runes in ElementalStaves.plugin.js, the
 * autocast spellbooks in Autocasting.
 *
 * - Second hit: a standard-spellbook elemental spell (Strike to Surge) fires a second spell
 *   dealing 40% of the first one's damage a tick later (SecondSpell.ElementalSpells.js, shared
 *   with the Twinflame staff). As a landed spell of its element it still counts for the Demonic
 *   Pacts that act on one (our reading).
 * - Elemental weakness: against an NPC with a weakness the spell counts as that element, for
 *   damage and accuracy, without changing the cast spell (`elemental-spells:weakness`); the NPC
 *   has one weakness, so it is its strongest. Demonic Pacts that check the weakness see it too.
 * - Melee: a melee range of 8 tiles, but no melee: its wielder on a melee style walks into reach,
 *   faces the target and never swings (live, 237/01161.txt tick 15130, 7 tiles from the boss).
 */
const SecondSpell = require("../combat/elementalspells/SecondSpell.ElementalSpells");

const MELEE_REACH = 8;

let core;

function wieldsQuadrant(mobile) {
  if (!mobile?.isPlayer?.()) return false;
  const weapon = mobile.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.SHADOWFLAME_QUADRANT;
}

/** The spell is treated as the element the target is weakest to. */
function countAsWeakness(request) {
  if (!request.weakness || !request.element || !SecondSpell.isStandardElemental(request.spell)) return;
  if (!wieldsQuadrant(request.attacker)) return;
  request.weakness.type = request.element;
}

function registerMeleeReach(api) {
  core = api.core;
  api.registerWeaponProfile({
    itemIds: [core.ItemIdentifiers.SHADOWFLAME_QUADRANT], attackDistance: MELEE_REACH, meleeAllowed: false,
  });
}

module.exports = {
  name: "ShadowflameQuadrant",
  description: "The Shadowflame quadrant's second elemental spell, its spells counting as the target's weakness, and its 8-tile reach without melee.",
  members: true,
  register(api) {
    registerMeleeReach(api);
    SecondSpell.register(api, wieldsQuadrant);
    api.onCustomEvent("elemental-spells:weakness", countAsWeakness);
  },
};
