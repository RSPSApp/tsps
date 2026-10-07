/**
 * Spirit shield upgrades (https://oldschool.runescape.wiki/w/Spirit_shield).
 *
 * A holy elixir on a spirit shield makes the blessed spirit shield at 85 Prayer.
 * A spirit sigil on the blessed shield at an anvil (90 Prayer + 85 Smithing,
 * hammer in the inventory) makes the arcane/spectral/elysian shield. The
 * Spectral prayer-drain passive is not modelled because the prayer-drain
 * sources it halves are mostly unimplemented.
 */
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const BLESS_PRAYER = 85;
const SIGIL_PRAYER = 90;
const SIGIL_SMITHING = 85;

const SIGIL_RESULTS = new Map([
  [ItemIdentifiers.ELYSIAN_SIGIL, ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD],
  [ItemIdentifiers.SPECTRAL_SIGIL, ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD],
  [ItemIdentifiers.ARCANE_SIGIL, ItemIdentifiers.ARCANE_SPIRIT_SHIELD],
]);

let core = null;

function inventoryContains(player, itemId) {
  return player.getInventory().contains(itemId);
}

function prayerLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
}

function smithingLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.SMITHING);
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
  player.sendMessage("You bless the spirit shield with the elixir.");
}

function attachSigil(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const sigilOnLeft = SIGIL_RESULTS.has(Number(usedItemId));
  const sigilId = sigilOnLeft ? Number(usedItemId) : Number(usedWithItemId);
  const shieldId = sigilOnLeft ? Number(usedWithItemId) : Number(usedItemId);
  const result = SIGIL_RESULTS.get(sigilId);
  if (!result || shieldId !== ItemIdentifiers.BLESSED_SPIRIT_SHIELD) {
    return;
  }
  event.handled = true;
  if (prayerLevel(player) < SIGIL_PRAYER || smithingLevel(player) < SIGIL_SMITHING) {
    player.sendMessage(
      `You need level ${SIGIL_PRAYER} Prayer and ${SIGIL_SMITHING} Smithing to attach the sigil.`
    );
    return;
  }
  if (!inventoryContains(player, ItemIdentifiers.HAMMER)) {
    player.sendMessage("You need a hammer to attach the sigil.");
    return;
  }
  const shieldItem = sigilOnLeft ? usedWithItem : usedItem;
  player.getInventory().deleteNumber(sigilId, 1);
  shieldItem.setId(result);
  player.getInventory().refreshItems();
  player.sendMessage("You attach the sigil to the blessed spirit shield.");
}

module.exports = {
  name: "SpiritShields",
  members: true,
  _test: { bless, attachSigil, SIGIL_RESULTS },
  register(api) {
    core = api.core;
    api.onItemOnItem(bless, { noted: false });
    api.onItemOnItem(attachSigil, { noted: false });
  },
};
