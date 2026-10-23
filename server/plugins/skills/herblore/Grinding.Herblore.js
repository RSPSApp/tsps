/**
 * A pestle and mortar on a Herblore secondary (rsprox captures): `human_herbing_grind` with synth
 * 2608 and the item's message, at once, then two ticks later, then every three ticks until none
 * are left or the player does something else. A stack (crystal shards) is ground all at once,
 * each item rolled on its own.
 */
const Common = require("./Common.Herblore");

const GRIND_ANIMATION = "human_herbing_grind";

/**
 * How many one grind makes, rolled evenly in its range; a `diaryBonus` diary (lava scales, Wiki:
 * the hard Wilderness Diary) gives half as many again, rounded down.
 */
function amount(player, grind) {
  const [low, high] = grind.amount;
  const rolled = low + Math.floor(Math.random() * (high - low + 1));
  if (!grind.diaryBonus) return rolled;
  const [name, tier] = grind.diaryBonus;
  const diary = { player, diary: name, tier, complete: false };
  Common.api.emitCustomEvent("diary:is-complete", diary);
  return diary.complete === true ? Math.floor(rolled * 1.5) : rolled;
}

function grindOne(player, grind) {
  const inventory = player.getInventory();
  const pestle = Common.gameval("obj", "pestle_and_mortar");
  const held = inventory.getAmount(grind.itemId);
  if (held <= 0 || inventory.getAmount(pestle) <= 0) return false;
  const stack = Common.core.ItemDefinition.forId(grind.itemId).isStackable();
  const used = stack ? held : 1;
  let made = 0;
  for (let n = 0; n < used; n++) made += amount(player, grind);
  inventory.deleteNumber(grind.itemId, used);
  inventory.addItem(new Common.core.Item(grind.productId, made));
  Common.animate(player, GRIND_ANIMATION);
  Common.sound(player, Common.MIX_SOUND);
  Common.spam(player, grind.message.replace("{count}", String(made)));
  return true;
}

function grind(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const pestle = Common.gameval("obj", "pestle_and_mortar");
  if (usedItemId !== pestle && usedWithItemId !== pestle) return;
  const found = Common.grindFor(usedItemId === pestle ? usedWithItemId : usedItemId);
  if (!found) return;
  event.handled = true;
  Common.core.TaskManager.cancelTasks(player.getIndex());
  if (!grindOne(player, found)) return;
  let wait = 3;
  Common.run(player, () => {
    if (--wait > 0) return true;
    wait = 3;
    return grindOne(player, found);
  });
}

module.exports = function attachGrinding(api) {
  api.onItemOnItem(grind, { noted: false });
};
