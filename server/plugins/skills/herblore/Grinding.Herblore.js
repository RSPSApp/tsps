/**
 * A pestle and mortar on a Herblore secondary (rsprox captures): `human_herbing_grind` with synth
 * 2608 and the item's message, at once, then two ticks later, then every three ticks until none
 * are left or the player does something else. Crystal shards prompt for a quantity and crush
 * that many at once.
 */
const Common = require("./Common.Herblore");

const GRIND_ANIMATION = "human_herbing_grind";
const MAX_ITEM_AMOUNT = 2 ** 31 - 1;

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

/**
 * Whether the inventory holds this item only as preset (restricted) copies: grinding would turn
 * them into a plain, tradeable product, so it is refused, as Mixing does.
 */
function onlyRestricted(player, grind) {
  const inventory = player.getInventory();
  return inventory.getAmount(grind.itemId) > 0 && Common.plainAmount(inventory, grind.itemId) <= 0;
}

function grindOne(player, grind, requested = 1, toolId = null, withFeedback = true) {
  const inventory = player.getInventory();
  const pestle = Common.gameval("obj", "pestle_and_mortar");
  // Only unrestricted copies are ground; a preset copy of the same item stays put.
  const held = Common.plainAmount(inventory, grind.itemId);
  if (held <= 0 || inventory.getAmount(toolId ?? pestle) <= 0) return false;
  const stack = Common.core.ItemDefinition.forId(grind.itemId).isStackable();
  const used = Math.min(held, requested);
  let made = 0;
  if (grind.amount[0] === grind.amount[1]) made = used * amount(player, grind);
  else for (let n = 0; n < used; n++) made += amount(player, grind);
  const product = new Common.core.Item(grind.productId, made);
  const freesSlot = !stack || used === held;
  if (inventory.getAddableAmount(product) < made
      && !(freesSlot && inventory.getAmount(grind.productId) === 0 && made <= MAX_ITEM_AMOUNT)) {
    inventory.full();
    return false;
  }
  Common.takePlain(inventory, grind.itemId, used);
  inventory.refreshItems();
  inventory.addItem(product);
  if (withFeedback) {
    Common.animate(player, GRIND_ANIMATION);
    Common.sound(player, Common.MIX_SOUND);
    Common.spam(player, (used < held && grind.partialMessage ? grind.partialMessage : grind.message).replace("{count}", String(made)));
  }
  return true;
}

function grind(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const pestle = Common.gameval("obj", "pestle_and_mortar");
  let found;
  let alternateTool = null;
  if (usedItemId === pestle || usedWithItemId === pestle) {
    found = Common.grindFor(usedItemId === pestle ? usedWithItemId : usedItemId);
  } else {
    const used = Common.grindFor(usedItemId);
    const usedWith = Common.grindFor(usedWithItemId);
    if (used?.alternateToolId === usedWithItemId) {
      found = used;
      alternateTool = usedWithItemId;
    } else if (usedWith?.alternateToolId === usedItemId) {
      found = usedWith;
      alternateTool = usedItemId;
    }
  }
  if (!found) return;
  event.handled = true;
  Common.core.TaskManager.cancelTasks(player.getIndex());
  if (onlyRestricted(player, found)) {
    player.sendMessage(Common.PRESET_REFUSAL);
    return;
  }
  if (found.quantityPrompt) {
    const held = Common.plainAmount(player.getInventory(), found.itemId);
    player.setEnteredAmountAction({
      execute(quantity) {
        if (!Number.isInteger(quantity) || quantity <= 0) return;
        grindOne(player, found, Math.min(quantity, held));
      },
    });
    player.getPacketSender().sendEnterAmountPrompt(found.quantityPrompt.replace("{count}", String(held)));
    return;
  }
  // Wiki (Chocolate dust, under both the knife and the pestle): auto-crushing is 0, then 2, then 3 ticks. The knife's
  // animation, sound and message are not captured, so it converts without the pestle's feedback.
  const withFeedback = alternateTool === null;
  if (!grindOne(player, found, 1, alternateTool, withFeedback)) return;
  // Common.run's first step is the tick after the click: the second grind is 2 ticks on.
  let wait = 2;
  Common.run(player, () => {
    if (--wait > 0) return true;
    wait = 3;
    return grindOne(player, found, 1, alternateTool, withFeedback);
  });
}

module.exports = function attachGrinding(api) {
  api.onItemOnItem(grind, { noted: false });
};
