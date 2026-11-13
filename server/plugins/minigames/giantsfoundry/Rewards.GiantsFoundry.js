"use strict";

/**
 * What the reward shop's items do here, and selling them back to Kovac.
 *
 * - Ore pack (op Open), rsprox recording 96: 30 noted ores, "You open the pack and find 30
 *   ores.", or "You will need another free inventory space to open the pack." / "You will need
 *   another # free inventory spaces to open the pack." The ores are rolled one by one with the
 *   Wiki's rates from 1,913 opened packs.
 * - Kovac's grog (Drink), Wiki: heals 1, boosts Smithing by 4, drains Attack, Ranged and Magic by
 *   2, "You drink Kovac's grog. It tastes like giants' feet." and leaves a beer glass.
 * - Using an item on Kovac (Wiki transcript): he buys the Smiths' uniform, the double ammo mould,
 *   the smithing catalyst and the ore pack back for 80% of their price, refuses the colossal
 *   blade and his grog, and tells anything else "You keep that.".
 *
 * The catalyst, the double ammo mould, the uniform and the colossal blade work in Smithing and
 * combat (docs/giants-foundry.md, "Rewards outside the minigame").
 */

const DATA = require("../data/giants-foundry.json");
const Shared = require("./Shared.GiantsFoundry");

const ITEM = {
  ORE_PACK: 27019,
  GROG: 27014,
  COLOSSAL_BLADE: 27021,
  BEER_GLASS: 1919,
};
const ANIM_DRINK = 829;
const SELL_BACK = 0.8;
const ORES_PER_PACK = 30;

/** What Kovac pays back, by item id: 80% of the reward shop's price (Wiki). */
const SELL_PRICES = new Map([
  [27023, 4000], [27025, 4000], [27027, 3500], [27029, 3500], [27012, 2000], [27017, 15], [ITEM.ORE_PACK, 200],
]);

const MESSAGE = {
  ORE_PACK: (count) => `You open the pack and find ${count} ores.`,
  ORE_PACK_SPACE: (slots) => (slots === 1
    ? "You will need another free inventory space to open the pack."
    : `You will need another ${slots} free inventory spaces to open the pack.`),
  GROG: "You drink Kovac's grog. It tastes like giants' feet.",
  KEEP: "You keep that.",
  BLADE: "Kovac does not want that back. Maybe the smith clothes would be good, if you got any.",
  KEEP_GROG: "No, you keep that or give it to someone else.",
};

function noteOf(itemId) {
  const { ItemDefinition } = Shared.core();
  return ItemDefinition.forId(itemId)?.getNoteId?.() ?? itemId;
}

function oreIdByName(name) {
  const { ItemIdentifiers } = Shared.core();
  return Number(ItemIdentifiers[name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")]);
}

function rollOre() {
  const total = DATA.orePack.reduce((sum, ore) => sum + ore.weight, 0);
  let roll = Math.random() * total;
  for (const ore of DATA.orePack) {
    roll -= ore.weight;
    if (roll < 0) return ore.name;
  }
  return DATA.orePack[0].name;
}

function openOrePack({ player, itemId }) {
  // The Volcanic Mine's ore pack shares the name.
  if (itemId !== ITEM.ORE_PACK) return false;
  const inventory = player.getInventory();
  const found = new Map();
  for (let i = 0; i < ORES_PER_PACK; i++) {
    const name = rollOre();
    found.set(name, (found.get(name) ?? 0) + 1);
  }
  const notes = [...found].map(([name, amount]) => [noteOf(oreIdByName(name)), amount]);
  // The pack's own slot frees up; every ore not already held needs another.
  const needed = notes.filter(([id]) => !inventory.contains(id)).length - 1;
  if (needed > inventory.getFreeSlots()) {
    player.sendMessage(MESSAGE.ORE_PACK_SPACE(needed - inventory.getFreeSlots()));
    return;
  }
  inventory.delete(ITEM.ORE_PACK, 1);
  for (const [id, amount] of notes) inventory.adds(id, amount);
  inventory.refreshItems();
  player.sendMessage(MESSAGE.ORE_PACK(ORES_PER_PACK));
}

function drinkGrog({ player }) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  const inventory = player.getInventory();
  inventory.delete(ITEM.GROG, 1);
  inventory.adds(ITEM.BEER_GLASS, 1);
  inventory.refreshItems();
  Shared.animate(player, ANIM_DRINK);
  skills.setCurrentLevel(Skill.HITPOINTS, Math.min(skills.getMaxLevel(Skill.HITPOINTS), skills.getCurrentLevel(Skill.HITPOINTS) + 1), true);
  const smithing = skills.getCurrentLevel(Skill.SMITHING);
  skills.setCurrentLevel(Skill.SMITHING, Math.max(smithing, Math.min(skills.getMaxLevel(Skill.SMITHING) + 4, smithing + 4)), true);
  for (const skill of [Skill.ATTACK, Skill.RANGED, Skill.MAGIC]) skills.decreaseCurrentLevel(skill, 2, 0);
  player.sendMessage(MESSAGE.GROG);
}

function sellBack(player, itemId) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = Shared.core();
  const refund = Math.floor(SELL_PRICES.get(itemId) * SELL_BACK);
  const name = Shared.itemName(itemId);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId, `${name}: Kovac will give you ${refund.toLocaleString("en-US")} Foundry Reputation for this.`),
    new ActionDialogue(1, { execute: () => Shared.options(player, "Select an Option",
      "Accept", () => {
        player.getPacketSender().sendInterfaceRemoval();
        if (!player.getInventory().contains(itemId)) return;
        player.getInventory().delete(itemId, 1);
        player.getInventory().refreshItems();
        Shared.setReputation(player, Shared.reputation(player) + refund);
        player.sendMessage(`${name}: Kovac takes it back. Foundry Reputation: ${Shared.reputation(player).toLocaleString("en-US")}`);
      },
      "Decline", () => player.getPacketSender().sendInterfaceRemoval()) }),
  ));
}

function useOnKovac(event) {
  const { player, itemId, npcId } = event;
  if (event.handled || npcId !== Shared.NPC.KOVAC) return;
  event.handled = true;
  if (SELL_PRICES.has(itemId)) sellBack(player, itemId);
  else if (itemId === ITEM.COLOSSAL_BLADE) Shared.kovacSays(player, MESSAGE.BLADE);
  else if (itemId === ITEM.GROG) Shared.kovacSays(player, MESSAGE.KEEP_GROG);
  else Shared.kovacSays(player, MESSAGE.KEEP);
}

// Keep the clicked instances through the confirmation, rather than consuming another copy.
function restricted(item) {
  const { Item } = Shared.core();
  return item?.isPresetItem?.() === true || item?.getMetaValue?.(Item.PRESET_META) === true
    || item?.getMetaValue?.(Item.UNTRADEABLE_META) === true || item?.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

function present(inventory, slot, item, id) {
  return inventory.getItems()[slot] === item && item.getId() === id && item.getAmount() === 1 && !restricted(item);
}

function combineGloves({ player, usedItem, usedWithItem, usedItemSlot, usedWithItemSlot }) {
  const { Item, ItemIdentifiers: I, ItemStatementDialogue, DialogueChainBuilder } = Shared.core();
  if (restricted(usedItem) || restricted(usedWithItem)) {
    player.sendMessage("Preset items cannot be used for this.");
    return;
  }
  const usedId = usedItem.getId();
  const targetId = usedWithItem.getId();
  Shared.api().sendMultiChatboxPrompt(player, "Combine Smiths gloves with your Ice gloves?",
    "Yes.", () => {
      const inventory = player.getInventory();
      if (!present(inventory, usedItemSlot, usedItem, usedId)
        || !present(inventory, usedWithItemSlot, usedWithItem, targetId)) return;
      inventory.deleteAtSlot(usedItemSlot, 1);
      inventory.deleteAtSlot(usedWithItemSlot, 1);
      inventory.addItem(new Item(I.SMITHS_GLOVES_I_, 1));
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
        new ItemStatementDialogue(0, I.SMITHS_GLOVES_I_, "You stuff the Ice gloves into the Smiths gloves to make Smith gloves (i).")));
    },
    "No.", () => {});
}

const DISMANTLE_MESSAGE = "The gloves get separated into smith gloves and ice gloves.";

function dismantleGloves({ player, item, slot }) {
  // Dismantle is an inventory option only (the worn gloves have Remove alone): a worn-slot click must not prompt.
  if (player.getInventory().getItems()[slot] !== item) return;
  if (restricted(item)) {
    player.sendMessage("Preset items cannot be used for this.");
    return;
  }
  const { Item, ItemIdentifiers: I, ItemStatementDialogue, DialogueChainBuilder } = Shared.core();
  Shared.api().sendMultiChatboxPrompt(player, "Dismantle your Smithing gloves (i)?",
    "Yes.", () => {
      const inventory = player.getInventory();
      if (!present(inventory, slot, item, I.SMITHS_GLOVES_I_)) return;
      if (inventory.getFreeSlots() < 1) {
        player.sendMessage("You don't have enough inventory space to do that.");
        return;
      }
      inventory.deleteAtSlot(slot, 1);
      inventory.addItem(new Item(I.SMITHS_GLOVES, 1));
      inventory.addItem(new Item(I.ICE_GLOVES, 1));
      // Wiki, Transcript:Smiths gloves (i), "When dismantling".
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
        new ItemStatementDialogue(0, I.SMITHS_GLOVES, DISMANTLE_MESSAGE)));
    },
    "No.", () => {});
}

module.exports = function attachRewards(api) {
  api.onItemOnItem("Smiths gloves", "Ice gloves", combineGloves, { noted: false });
  api.onItemAction("Smiths gloves (i)", { Dismantle: dismantleGloves });
  api.onItemAction("Ore pack", { Open: openOrePack });
  api.onItemAction("Kovac's grog", { Drink: drinkGrog });
  api.onItemOnNpc(useOnKovac, { noted: false });
};

Object.assign(module.exports, { SELL_PRICES, rollOre, MESSAGE });
