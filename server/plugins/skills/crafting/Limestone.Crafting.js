/**
 * A chisel on limestone carves a limestone brick (https://oldschool.runescape.wiki/w/Limestone_brick:
 * level 12 Crafting, 6 XP, 0 ticks). rsprox captures (recordings 261 and 690, rev 229): each use
 * carves one brick on the tick of the use, with no menu; the brick takes the first limestone's slot,
 * whichever limestone was used (recording 690 tick 300: used on slot 14, brick in slot 12),
 * human_limestonecutting plays, the line below is spam, 6 Crafting XP, and no sound.
 *
 * Not covered: the Wiki says carving can fail below level 40, making a rock for 1.5 XP, but no
 * source gives the failure rate or its line, so every carve succeeds.
 */
const Shared = require("./Shared.Crafting");

const LEVEL = 12;
const XP = 6;
const CARVE_MESSAGE = "You use the chisel on the limestone and carve it into a building block.";
// Ours: no capture or Wiki line for a player below level 12.
const TOO_LOW_MESSAGE = `You need a Crafting level of ${LEVEL} to carve limestone.`;

function limestoneSlot(event, I) {
  const chisels = [I.CHISEL, I.JEWELLERS_CHISEL];
  if (event.usedItemId === I.LIMESTONE && chisels.includes(event.usedWithItemId)) return event.usedItemSlot;
  if (event.usedWithItemId === I.LIMESTONE && chisels.includes(event.usedItemId)) return event.usedWithItemSlot;
  return -1;
}

function carveLimestone(event) {
  if (event.handled || !Shared.isMembersWorld()) return;
  const { ItemIds: I, Animation, CacheDefinitions } = Shared.getCore();
  const slot = limestoneSlot(event, I);
  if (slot < 0) return;
  const { player } = event;
  const inventory = player.getInventory();
  const limestone = inventory.getItems()[slot];
  if (limestone?.getId() !== I.LIMESTONE) return;
  event.handled = true;
  Shared.stopCrafting(player);
  if (Shared.craftingLevel(player) < LEVEL) {
    player.sendMessage(TOO_LOW_MESSAGE);
    return;
  }
  const first = inventory.getItems().find((item) => item?.getId() === I.LIMESTONE);
  first.setId(I.LIMESTONE_BRICK);
  inventory.refreshItems();
  player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_limestonecutting")));
  Shared.spam(player, CARVE_MESSAGE);
  Shared.addCraftingXp(player, XP);
  Shared.produced(player, I.LIMESTONE_BRICK, 1, XP, "limestone-brick", [[I.LIMESTONE, 1]]);
  Shared.getApi().emitCustomEvent("crafting:made", { player, itemId: I.LIMESTONE_BRICK });
}

module.exports = function attach(api) {
  api.onItemOnItem(carveLimestone, { noted: false });
};
