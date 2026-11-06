/**
 * Snelms: a chisel on a blamish snail shell (https://oldschool.runescape.wiki/w/Snelm).
 * Level 15 Crafting, 32.5 XP, 2 ticks, one shell per snelm, the chisel kept. Round shells
 * make round snelms (Myre, blood'n'tar, ochre, bruise blue, broken bark); pointed shells make
 * pointed snelms, with no pointed bark variant in the cache. The cache has no dedicated snelm
 * sequence, so the chisel-on-gem sequence is reused; the chat line is not captured.
 */
const Shared = require("./Shared.Crafting");

const MENU_TITLE = "How many would you like to make?";
const MENU_MODE = 0;

let table = null;

function data() {
  if (table) return table;
  const { ItemIds: I, Animation } = Shared.getCore();
  const { snelms } = Shared.DATA;
  const chisels = new Set([I.CHISEL, I.JEWELLERS_CHISEL]);
  const byShell = new Map(snelms.recipes.map((recipe) => {
    const shell = Shared.itemId(recipe.shell);
    return [shell, { shell, item: Shared.itemId(recipe.item), level: snelms.level, xp: snelms.xp, animation: new Animation(snelms.seq), chisels }];
  }));
  return (table = { byShell, chisels });
}

function chiselOf(player) {
  const I = Shared.getCore().ItemIds;
  const inventory = player.getInventory();
  return inventory.contains(I.JEWELLERS_CHISEL) ? I.JEWELLERS_CHISEL
    : inventory.contains(I.CHISEL) ? I.CHISEL : null;
}

function shellOf(event, chisels) {
  if (chisels.has(event.usedItemId)) return event.usedWithItemId;
  if (chisels.has(event.usedWithItemId)) return event.usedItemId;
  return null;
}

function craftOne(player, recipe) {
  const { Item } = Shared.getCore();
  const inventory = player.getInventory();
  if (!inventory.contains(recipe.shell) || chiselOf(player) === null) return false;
  inventory.deleteNumber(recipe.shell, 1);
  inventory.addItem(new Item(recipe.item, 1));
  Shared.addCraftingXp(player, recipe.xp);
  Shared.produced(player, recipe.item, 1, recipe.xp, "snelms", [[recipe.shell, 1]]);
  Shared.getApi().emitCustomEvent("crafting:made", { player, itemId: recipe.item });
  Shared.spam(player, `You make a ${Shared.itemName(recipe.item).toLowerCase()}.`);
  return true;
}

function tooLow(player, recipe) {
  const { DialogueChainBuilder, ItemStatementDialogue } = Shared.getCore();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, recipe.shell, `You need a Crafting level of ${recipe.level} to craft this.`)));
}

function chiselOnShell(event) {
  const { player } = event;
  if (!Shared.isMembersWorld()) return;
  const { byShell, chisels } = data();
  const recipe = byShell.get(shellOf(event, chisels));
  if (!recipe) return;
  event.handled = true;

  if (Shared.craftingLevel(player) < recipe.level) {
    Shared.stopCrafting(player);
    Shared.nextTick(player, () => tooLow(player, recipe));
    return;
  }
  Shared.stopCrafting(player);
  const amount = player.getInventory().getAmount(recipe.shell);
  if (amount === 0) return;
  const start = (chosen) => Shared.startMaking(player, {
    amount: chosen, startTick: null, firstTick: 1, interval: Shared.DATA.snelms.ticks,
    animation: recipe.animation, kind: "snelms",
    has: () => player.getInventory().contains(recipe.shell) && chiselOf(player) !== null,
    make: () => craftOne(player, recipe),
  });
  // One shell needs no menu: the Wiki's Make-X prompt only matters for several.
  if (amount === 1) {
    start(1);
    return;
  }
  Shared.openMakeMenu(player, {
    title: MENU_TITLE,
    mode: MENU_MODE,
    items: [{ itemId: recipe.shell }],
    maxAmount: amount,
    choose: (_item, chosen) => start(chosen),
  });
}

module.exports = function attach(api) {
  api.onItemOnItem(chiselOnShell, { noted: false });
};

module.exports._test = { data, craftOne, shellOf };
