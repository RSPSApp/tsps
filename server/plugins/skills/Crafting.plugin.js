const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Sound } = require("../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../src/main/typescript/elvarg/game/Sounds");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

const GEMS = new Map([
  [ItemIds.UNCUT_OPAL, { cut: ItemIds.OPAL, level: 1, xp: 15, animation: 890 }],
  [ItemIds.UNCUT_JADE, { cut: ItemIds.JADE, level: 13, xp: 20, animation: 891 }],
  [ItemIds.UNCUT_RED_TOPAZ, { cut: ItemIds.RED_TOPAZ, level: 16, xp: 25, animation: 892 }],
  [ItemIds.UNCUT_SAPPHIRE, { cut: ItemIds.SAPPHIRE, level: 20, xp: 50, animation: 888 }],
  [ItemIds.UNCUT_EMERALD, { cut: ItemIds.EMERALD, level: 27, xp: 68, animation: 889 }],
  [ItemIds.UNCUT_RUBY, { cut: ItemIds.RUBY, level: 34, xp: 85, animation: 887 }],
  [ItemIds.UNCUT_DIAMOND, { cut: ItemIds.DIAMOND, level: 43, xp: 108, animation: 886 }],
  [ItemIds.UNCUT_DRAGONSTONE, { cut: ItemIds.DRAGONSTONE, level: 55, xp: 138, animation: 885 }],
  [ItemIds.UNCUT_ONYX, { cut: ItemIds.ONYX, level: 67, xp: 168, animation: 2717 }],
  [ItemIds.UNCUT_ZENYTE, { cut: ItemIds.ZENYTE, level: 89, xp: 200, animation: 7185 }],
]);

function cutGem(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const hasChisel =
    usedItemId === ItemIds.CHISEL || usedWithItemId === ItemIds.CHISEL;
  if (!hasChisel) {
    return;
  }

  const uncutId =
    usedItemId === ItemIds.CHISEL ? usedWithItemId : usedItemId;
  const gem = GEMS.get(uncutId);
  if (!gem) {
    return;
  }

  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < gem.level) {
    player.sendMessage(
      `You need a Crafting level of at least ${gem.level} to cut this gem.`
    );
    event.handled = true;
    return;
  }

  if (!player.getInventory().contains(uncutId)) {
    event.handled = true;
    return;
  }

  player.performAnimation(new Animation(gem.animation));
  Sounds.sendSound(player, Sound.GEM_CUTTING);
  player.getInventory().deleteNumber(uncutId, 1);
  player.getInventory().addItem(new Item(gem.cut, 1));
  player.getSkillManager().addExperiences(Skill.CRAFTING, gem.xp);
  event.handled = true;
}

module.exports = {
  name: "Crafting",
  register(api) {
    api.onItemOnItem(cutGem, { noted: false });
    api.log("registered", { gems: GEMS.size });
  },
};
