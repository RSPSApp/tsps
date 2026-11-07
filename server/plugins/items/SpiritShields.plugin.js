/**
 * Spirit shield upgrades (https://oldschool.runescape.wiki/w/Spirit_shield).
 *
 * A holy elixir on a spirit shield makes the blessed spirit shield at 85 Prayer, which "cannot be boosted" (Wiki,
 * Blessed spirit shield). Sigils go on "using a hammer at an anvil" (Wiki, Arcane spirit shield): that is the Corporeal
 * Beast's unit (bosses/corporealbeast/SpiritShields.CorporealBeast.js); sigil-on-shield in the inventory is not a
 * recipe. The Spectral prayer-drain passive is in combat/effects/SpiritShields.EquipmentEffects.js.
 */
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const BLESS_PRAYER = 85;

let core = null;
let pluginApi = null;

function prayerLevel(player) {
  // The base level: "this level cannot be boosted" (Wiki, Blessed spirit shield).
  return player.getSkillManager().getMaxLevel(core.Skill.PRAYER);
}

function bless(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  if (Number(usedItemId) !== ItemIdentifiers.HOLY_ELIXIR || Number(usedWithItemId) !== ItemIdentifiers.SPIRIT_SHIELD) {
    return;
  }
  event.handled = true;
  if (prayerLevel(player) < BLESS_PRAYER) {
    player.sendMessage(`You need a Prayer level of ${BLESS_PRAYER} to do this.`);
    return;
  }
  player.getInventory().deleteNumber(ItemIdentifiers.HOLY_ELIXIR, 1);
  usedWithItem.setId(ItemIdentifiers.BLESSED_SPIRIT_SHIELD);
  player.getInventory().refreshItems();
  const sound = core.Sound?.PRAYER_RECHARGE;
  if (sound) core.Sounds?.sendSound?.(player, sound);
  pluginApi?.emitCustomEvent?.("equipment:changed", { player });
  player.sendMessage("The spirit shield glows an eerie holy glow.");
}


module.exports = {
  name: "SpiritShields",
  members: true,
  _test: { bless },
  register(api) {
    core = api.core;
    pluginApi = api;
    api.onItemOnItem(bless, { noted: false });
  },
};
