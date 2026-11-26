/**
 * Wiki (https://oldschool.runescape.wiki/w/Magic_fang): 59 Crafting and a chisel attach a
 * magic fang to a staff of the dead or an uncharged normal/enhanced trident, for no XP.
 * No capture covers the attachment; the feedback is ours, and no animation/timing is assumed.
 */
const { restricted, PRESET_TEXT } = require("./PoweredStaff");

const CRAFTING_LEVEL = 59;
let core;

function attach({ player, usedItem, usedWithItem }) {
  const I = core.ItemIdentifiers;
  const fang = usedItem.getId() === I.MAGIC_FANG ? usedItem : usedWithItem;
  const weapon = fang === usedItem ? usedWithItem : usedItem;
  const product = new Map([
    [I.STAFF_OF_THE_DEAD, I.TOXIC_STAFF_UNCHARGED_],
    [I.UNCHARGED_TRIDENT, I.UNCHARGED_TOXIC_TRIDENT],
    [I.UNCHARGED_TRIDENT_E_, I.UNCHARGED_TOXIC_TRIDENT_E_],
  ]).get(weapon.getId());
  if (product === undefined || fang.getId() !== I.MAGIC_FANG) return false;
  const inventory = player.getInventory(), items = inventory.getItems();
  if (!items.includes(fang) || !items.includes(weapon)) return false;
  if (restricted(fang) || restricted(weapon)) {
    player.sendMessage(PRESET_TEXT);
    return;
  }
  if (player.getSkillManager().getCurrentLevel(core.Skill.CRAFTING) < CRAFTING_LEVEL) {
    player.sendMessage(`You need level ${CRAFTING_LEVEL} Crafting to attach the magic fang.`);
    return;
  }
  if (!inventory.contains(I.CHISEL) && !inventory.contains(I.JEWELLERS_CHISEL)) {
    player.sendMessage("You need a chisel to attach the magic fang.");
    return;
  }
  inventory.deleteAtSlot(items.indexOf(fang), 1);
  weapon.setId(product);
  inventory.refreshItems();
  player.sendMessage("You attach the magic fang to the weapon.");
}

module.exports = {
  name: "MagicFang",
  description: "Attaches a magic fang to a staff of the dead or an uncharged trident with 59 Crafting and a chisel.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemOnItem("Magic fang", "Staff of the Dead", attach, { noted: false });
    api.onItemOnItem("Magic fang", "Uncharged trident", attach, { noted: false });
    api.onItemOnItem("Magic fang", "Uncharged trident (e)", attach, { noted: false });
  },
};
