"use strict";

/**
 * Ignisia's Exchange at the Wintertodt camp: the camp's uniques become burnt pages or an extra
 * supply crate.
 *
 * Wiki (Ignisia, Burnt page, Extra supply crate) and the dialogue captures (chisel 16367,
 * 2553, 9760, 22407):
 * - A pyromancer piece, the warm gloves or a bruma torch (either hand) is worth 50 pages; an
 *   empty tome of fire and a whole outfit are worth 250.
 * - The same items buy an extra supply crate, whose roll never gives a unique, pages or the
 *   phoenix. A whole outfit's crate holds five rolls instead of one.
 * - A charged tome is refused: "I think you may want to remove the pages before handing that
 *   over to me."
 * - The menu: "Do you have something for me?" (Yes, I do. / Err... nope. Sorry.), then the
 *   whole-set question, then "What would you like to trade [your Pyromancer pieces] for?"
 *   (Extra Crate. / Burnt Pages.) and one confirmation per item type held.
 */

const Shared = require("./Shared.Wintertodt");

const CRATE_ROLLS_META = Shared.CRATE_ROLLS_META;
const PAGES_PER_UNIQUE = 50;
const PAGES_PER_TOME = 250;
const PAGES_PER_OUTFIT = 250;
const CRATE_ROLLS = 1;
const OUTFIT_CRATE_ROLLS = 5;

const OUTFIT_ITEMS = [
  "PYROMANCER_HOOD", "PYROMANCER_GARB", "PYROMANCER_ROBE", "PYROMANCER_BOOTS",
];

/** `set` groups need one of every item per trade; the others take any of their ids. */
const OUTFIT = { key: "outfit", name: "Pyromancer outfit", ids: OUTFIT_ITEMS, pages: PAGES_PER_OUTFIT, rolls: OUTFIT_CRATE_ROLLS, set: true };
const PIECES = [
  { key: "hood", name: "Pyromancer hood", ids: ["PYROMANCER_HOOD"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
  { key: "garb", name: "Pyromancer garb", ids: ["PYROMANCER_GARB"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
  { key: "robe", name: "Pyromancer robe", ids: ["PYROMANCER_ROBE"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
  { key: "boots", name: "Pyromancer boots", ids: ["PYROMANCER_BOOTS"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
];
const OTHER = [
  { key: "gloves", name: "Warm gloves", ids: ["WARM_GLOVES"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
  { key: "torch", name: "Bruma torch", ids: ["BRUMA_TORCH", "BRUMA_TORCH_OFF_HAND_"], pages: PAGES_PER_UNIQUE, rolls: CRATE_ROLLS },
  { key: "tome", name: "Tome of fire (empty)", ids: ["TOME_OF_FIRE_EMPTY_"], pages: PAGES_PER_TOME, rolls: CRATE_ROLLS },
];

function ids() {
  return Shared.core().ItemIdentifiers;
}

function itemIds(group) {
  return group.ids.map((name) => ids()[name]).filter(Number.isInteger);
}

/** How many of a group's trade are held: complete outfits for the set, otherwise every id. */
function countOf(player, group) {
  const inventory = player.getInventory();
  const held = itemIds(group).map((id) => inventory.getAmount(id));
  return group.set ? Math.min(...held) : held.reduce((sum, amount) => sum + amount, 0);
}

function available(player, groups) {
  return groups.filter((group) => countOf(player, group) > 0);
}

function hasPieces(player) {
  return available(player, PIECES).length > 0;
}

function hasFullSet(player) {
  return countOf(player, OUTFIT) > 0;
}

function hasChargedTome(player) {
  return player.getInventory().getAmount(ids().TOME_OF_FIRE) > 0;
}

/** Takes `count` trades of the group: one of each piece for a set, otherwise every id held. */
function take(player, group, count) {
  const inventory = player.getInventory();
  if (group.set) {
    for (const id of itemIds(group)) inventory.delete(id, count);
    inventory.refreshItems();
    return;
  }
  let left = count;
  for (const id of itemIds(group)) {
    if (left <= 0) break;
    const amount = Math.min(left, inventory.getAmount(id));
    if (amount > 0) {
      inventory.delete(id, amount);
      left -= amount;
    }
  }
  inventory.refreshItems();
}

function giveCrates(player, count, rolls) {
  const { Item } = Shared.core();
  const inventory = player.getInventory();
  for (let i = 0; i < count; i++) {
    inventory.add(new Item(ids().EXTRA_SUPPLY_CRATE, 1, { [CRATE_ROLLS_META]: rolls }), false);
  }
  inventory.refreshItems();
}

/** Preview the same input removal without changing the live inventory or refreshing it. */
function hasRoomForPages(player, group, count) {
  const { Inventory, Item } = Shared.core();
  const plan = new Inventory(player).setItems(player.getInventory().getCopiedItems());
  let left = count;
  for (const id of itemIds(group)) {
    const amount = group.set ? count : Math.min(left, plan.getAmount(id));
    if (amount > 0) plan.deleted(id, amount, false);
    if (!group.set) left -= amount;
  }
  return plan.getAddableAmount(new Item(ids().BURNT_PAGE, count * group.pages)) === count * group.pages;
}

function trade(player, mode, group, count) {
  // The confirmation can stay open while the player equips, banks or drops the item.
  // Recheck every part of the offer (the whole outfit included) before taking or paying.
  if (!Number.isInteger(count) || count <= 0 || countOf(player, group) < count) return false;
  if (mode !== "crate" && !hasRoomForPages(player, group, count)) {
    // Local wording: the captures do not specify a full-stack refusal.
    player.sendMessage("You don't have enough inventory space for all the burnt pages.");
    return false;
  }
  take(player, group, count);
  if (mode === "crate") giveCrates(player, count, group.rolls);
  else {
    player.getInventory().adds(ids().BURNT_PAGE, count * group.pages);
    player.getInventory().refreshItems();
  }
  return true;
}

function removal(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

function askSet(player) {
  const { DialogueChainBuilder, OptionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        removal(player);
        if (Number(option) === 1) openMenu(player, "outfit");
        else enterStage(player, hasPieces(player) ? "pieces" : "other");
      },
    }, "Yes.", "No.").setTitle("Would you like to trade in a entire set?"),
  ));
}

function askConfirmation(player, mode, group, count, next) {
  const crate = mode === "crate";
  const title = crate
    ? `Trade in ${count}x ${group.name} for ${count === 1 ? "a supply crate" : "supply crates"}?`
    : `Trade in ${count}x ${group.name} for ${(count * group.pages).toLocaleString("en-US")}x burnt pages?`;
  const { DialogueChainBuilder, OptionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        removal(player);
        if (Number(option) === 1) trade(player, mode, group, count);
        next();
      },
    }, "Yes.", "No.").setTitle(title),
  ));
}

/** One confirmation per item type held, then on to the next stage of the exchange. */
function runStage(player, mode, groups, stage) {
  const offers = available(player, groups);
  const [group, ...rest] = offers;
  if (!group) {
    enterStage(player, nextStage(stage));
    return;
  }
  askConfirmation(player, mode, group, countOf(player, group), () => runStage(player, mode, rest, stage));
}

function nextStage(stage) {
  return stage === "other" ? null : "other";
}

/** Opens the stage's menu; skips it when the player holds nothing it can trade. */
function enterStage(player, stage) {
  if (!stage) {
    removal(player);
    return;
  }
  const groups = stage === "outfit" ? [OUTFIT] : stage === "pieces" ? PIECES : OTHER;
  if (available(player, groups).length === 0) {
    if (stage === "other" && hasChargedTome(player)) {
      Shared.statement(player, "I think you may want to remove the pages before handing that over to me.");
      return;
    }
    enterStage(player, nextStage(stage));
    return;
  }
  openMenu(player, stage);
}

function openMenu(player, stage) {
  const title = stage === "pieces"
    ? "What would you like to trade your Pyromancer pieces for?"
    : "What would you like to trade for?";
  const groups = stage === "outfit" ? [OUTFIT] : stage === "pieces" ? PIECES : OTHER;
  const { DialogueChainBuilder, OptionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        removal(player);
        const mode = Number(option) === 1 ? "crate" : Number(option) === 2 ? "pages" : null;
        if (mode) runStage(player, mode, groups, stage);
      },
    }, "Extra Crate.", "Burnt Pages.").setTitle(title),
  ));
}

function exchange(event) {
  const { player } = event;
  const { DialogueChainBuilder, NpcDialogue, OptionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, Shared.NPC.IGNISIA, "Do you have something for me?"),
    new OptionDialogue(1, {
      executeOption(option) {
        removal(player);
        if (Number(option) !== 1) return;
        if (hasFullSet(player)) askSet(player);
        else enterStage(player, hasPieces(player) ? "pieces" : "other");
      },
    }, "Yes, I do.", "Err... nope. Sorry."),
  ));
  return true;
}

module.exports = function registerWintertodtIgnisia(api) {
  Shared.bind(api);
  api.onNpcInteraction("Ignisia", { Exchange: exchange });
};

module.exports.exchange = exchange;
module.exports.countOf = countOf;
module.exports.trade = trade;
module.exports.PIECES = PIECES;
module.exports.OUTFIT = OUTFIT;
module.exports.OTHER = OTHER;
module.exports.CRATE_ROLLS_META = CRATE_ROLLS_META;
