/**
 * Dissect a sacred eel with a knife (Wiki: https://oldschool.runescape.wiki/w/Sacred_eel).
 * Cooking level controls the 3–9 scale yield in eight-level bands; each eel gives 100 base
 * Cooking XP plus 3 XP per scale. There is no RSProx action capture in the available recordings,
 * so this implements the documented item, level, yield, and XP behavior without guessing an
 * action message or animation.
 */
const Common = require("./Common.Cooking");

const MIN_LEVEL = 72;

function tables() {
  const { ItemIds } = Common.core;
  return {
    eel: ItemIds.SACRED_EEL,
    scales: ItemIds.ZULRAHS_SCALES,
    knives: Common.knives(),
  };
}

function pair(event, ids) {
  const { usedItemId, usedWithItemId } = event;
  if (usedItemId === ids.eel && ids.knives.has(usedWithItemId)) return true;
  return usedWithItemId === ids.eel && ids.knives.has(usedItemId);
}

function dissect(event) {
  const ids = tables();
  if (!pair(event, ids) || !Common.core.WorldDefinition.isMembersWorld()) return;
  event.handled = true;
  const { player } = event;
  const level = Common.level(player);
  if (level < MIN_LEVEL) {
    player.sendMessage(`You need a Cooking level of ${MIN_LEVEL} to dissect sacred eels.`);
    return;
  }

  const band = Math.min(4, Math.floor((level - MIN_LEVEL) / 8));
  const scales = 3 + band + Math.floor(Math.random() * 3);
  const xp = 100 + 3 * scales;
  const inventory = player.getInventory();
  if (!inventory.contains(ids.eel)) return;
  inventory.deleteNumber(ids.eel, 1);
  inventory.addItem(new Common.core.Item(ids.scales, scales));
  Common.addXp(player, xp);
  Common.api.emitCustomEvent("cooking:sacred-eel-dissected", { player, itemId: ids.eel, scales });
  Common.api.emitCustomEvent("skills:produced", {
    player, skill: Common.core.Skill.COOKING, itemId: ids.scales, amount: scales, xp, kind: "sacred-eel",
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(dissect, { noted: false });
};
