const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { inDemonicPacts } = require("./EchoItems");

const STAFF_GROUPS = [
  [[ItemIdentifiers.STAFF_OF_AIR, ItemIdentifiers.AIR_BATTLESTAFF, ItemIdentifiers.MYSTIC_AIR_STAFF], [ItemIdentifiers.AIR_RUNE]],
  [[ItemIdentifiers.STAFF_OF_WATER, ItemIdentifiers.WATER_BATTLESTAFF, ItemIdentifiers.MYSTIC_WATER_STAFF], [ItemIdentifiers.WATER_RUNE]],
  [[ItemIdentifiers.STAFF_OF_EARTH, ItemIdentifiers.EARTH_BATTLESTAFF, ItemIdentifiers.MYSTIC_EARTH_STAFF], [ItemIdentifiers.EARTH_RUNE]],
  [[ItemIdentifiers.STAFF_OF_FIRE, ItemIdentifiers.FIRE_BATTLESTAFF, ItemIdentifiers.MYSTIC_FIRE_STAFF], [ItemIdentifiers.FIRE_RUNE]],
  [[ItemIdentifiers.LAVA_BATTLESTAFF, ItemIdentifiers.MYSTIC_LAVA_STAFF, ItemIdentifiers.LAVA_BATTLESTAFF_3, ItemIdentifiers.MYSTIC_LAVA_STAFF_3], [ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.EARTH_RUNE]],
  [[ItemIdentifiers.MUD_BATTLESTAFF, ItemIdentifiers.MYSTIC_MUD_STAFF], [ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE]],
  [[ItemIdentifiers.STEAM_BATTLESTAFF, ItemIdentifiers.MYSTIC_STEAM_STAFF, ItemIdentifiers.STEAM_BATTLESTAFF_3, ItemIdentifiers.MYSTIC_STEAM_STAFF_3], [ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.WATER_RUNE]],
  [[ItemIdentifiers.SMOKE_BATTLESTAFF, ItemIdentifiers.MYSTIC_SMOKE_STAFF], [ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.AIR_RUNE]],
  [[ItemIdentifiers.MIST_BATTLESTAFF, ItemIdentifiers.MYSTIC_MIST_STAFF], [ItemIdentifiers.WATER_RUNE, ItemIdentifiers.AIR_RUNE]],
  [[ItemIdentifiers.DUST_BATTLESTAFF, ItemIdentifiers.MYSTIC_DUST_STAFF], [ItemIdentifiers.AIR_RUNE, ItemIdentifiers.EARTH_RUNE]],
  [[ItemIdentifiers.KODAI_WAND, ItemIdentifiers.KODAI_WAND_3], [ItemIdentifiers.WATER_RUNE]],
  [[ItemIdentifiers.TWINFLAME_STAFF], [ItemIdentifiers.FIRE_RUNE, ItemIdentifiers.WATER_RUNE]],
  // Wiki (Shadowflame quadrant): an infinite source of air, water, earth and fire runes.
  [[ItemIdentifiers.SHADOWFLAME_QUADRANT], [ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE, ItemIdentifiers.FIRE_RUNE]],
];

/**
 * Shield-slot items that supply runes the same way, for a Demonic Pacts character (EchoItems.js).
 * Wiki (Devil's element): unlimited air, water, earth and fire runes.
 */
const OFFHAND_GROUPS = [
  [[ItemIdentifiers.DEVILS_ELEMENT], [ItemIdentifiers.AIR_RUNE, ItemIdentifiers.WATER_RUNE, ItemIdentifiers.EARTH_RUNE, ItemIdentifiers.FIRE_RUNE]],
];

let pluginApi = null;

function wornId(player, slot) {
  return player?.getEquipment?.()?.get?.(slot)?.getId?.() ?? -1;
}

function suppliedRunes(player) {
  const weaponId = wornId(player, Equipment.WEAPON_SLOT);
  const weapon = STAFF_GROUPS.find(([staffIds]) => staffIds.includes(weaponId))?.[1] ?? [];
  const shieldId = wornId(player, Equipment.SHIELD_SLOT);
  const offhand = OFFHAND_GROUPS.find(([ids]) => ids.includes(shieldId))?.[1] ?? [];
  if (!offhand.length || !pluginApi || !inDemonicPacts(pluginApi, player)) return weapon;
  return [...new Set([...weapon, ...offhand])];
}

function bypassSuppliedRune(event) {
  if (Number.isInteger(event.runeId) && suppliedRunes(event.player).includes(event.runeId)) {
    event.bypass = true;
  }
}

/** `elemental-staves:runes` { player } -> `runes`: the rune ids the wielded staff (and offhand) supply. */
function reportSuppliedRunes(request) {
  request.runes = suppliedRunes(request.player);
}

module.exports = {
  name: "ElementalStaves",
  description: "Elemental staves, battlestaves, the Kodai wand, the twinflame staff, the Shadowflame quadrant and the Devil's element supply their element's runes to spells automatically.",
  register(api) {
    pluginApi = api;
    api.onSpellRuneBypass(bypassSuppliedRune);
    api.onCustomEvent("elemental-staves:runes", reportSuppliedRunes);
  },
};
