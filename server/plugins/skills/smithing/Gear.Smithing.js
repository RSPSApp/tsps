/**
 * Gear that changes a furnace's result (answers "smithing:smelt-outcome").
 *
 * Ring of forging (https://oldschool.runescape.wiki/w/Ring_of_forging): iron never fails while
 * it's worn. 140 charges kept on the player, one per iron ore; at none the ring melts, and
 * Break resets them for the next ring.
 *
 * Varrock armour (https://oldschool.runescape.wiki/w/Varrock_armour): at the Edgeville furnace,
 * a 10% chance to smelt two bars at once, up to the tier's metal. Each extra iron bar takes a
 * ring charge too.
 *
 * Neither has captures; the messages are the game's, not checked against one (docs/smithing.md).
 */
const Core = require("./Core.Smithing");
const Smelting = require("./Smelting.Smithing");

const RING_CHARGES = 140;
const RING_CHARGES_ATTRIBUTE = "smithing:ring-of-forging-charges";
const VARROCK_ARMOUR_CHANCE = 0.1;
/** Loc gameval of the Edgeville furnace, where Varrock armour works. */
const EDGEVILLE_FURNACE = "varrock_diary_furnace";
/** The bars each Varrock armour tier smelts two of (Wiki); higher tiers include the lower. */
const VARROCK_ARMOUR_TIERS = [
  ["VARROCK_ARMOUR_1", ["BRONZE_BAR", "BLURITE_BAR", "IRON_BAR", "SILVER_BAR", "STEEL_BAR"]],
  ["VARROCK_ARMOUR_2", ["MITHRIL_BAR", "GOLD_BAR", "PERFECT_GOLD_BAR"]],
  ["VARROCK_ARMOUR_3", ["ADAMANTITE_BAR"]],
  ["VARROCK_ARMOUR_4", ["RUNITE_BAR"]],
];

function worn(player, slot) {
  return player.getEquipment().get(slot)?.getId?.() ?? -1;
}

function wearsRingOfForging(player) {
  const { ItemIdentifiers: Items, Equipment } = Core;
  return [Items.RING_OF_FORGING, Items.RING_OF_FORGING_3].includes(worn(player, Equipment.RING_SLOT));
}

function ringCharges(player) {
  const stored = player.getAttribute(RING_CHARGES_ATTRIBUTE);
  return stored === undefined || stored === null ? RING_CHARGES : Number(stored);
}

function useRingCharges(player, count) {
  const charges = ringCharges(player) - count;
  if (charges > 0) {
    player.setAttribute(RING_CHARGES_ATTRIBUTE, charges);
    return;
  }
  player.setAttribute(RING_CHARGES_ATTRIBUTE, RING_CHARGES);
  player.getEquipment().set(Core.Equipment.RING_SLOT, new Core.Item(-1));
  player.getEquipment().refreshItems();
  player.sendMessage("<col=7f007f>Your Ring of Forging has melted.</col>");
}

/** The bars the worn Varrock armour smelts two of, or none. */
function varrockArmourBars(player) {
  const body = worn(player, Core.Equipment.BODY_SLOT);
  const bars = new Set();
  for (const [armour, tierBars] of VARROCK_ARMOUR_TIERS) {
    for (const bar of tierBars) bars.add(Core.ItemIdentifiers[bar]);
    if (Core.ItemIdentifiers[armour] === body) return bars;
  }
  return new Set();
}

function smeltOutcome(outcome) {
  const { player, recipe, furnaceId } = outcome;
  const iron = recipe.barId === Core.ItemIdentifiers.IRON_BAR;
  const ring = iron && wearsRingOfForging(player);
  if (ring) outcome.success = true;
  if (outcome.success
    && furnaceId === Core.CacheDefinitions.getLocId(EDGEVILLE_FURNACE)
    && varrockArmourBars(player).has(recipe.barId)
    && Math.random() < VARROCK_ARMOUR_CHANCE
    && Smelting.hasIngredients(player, recipe)) {
    Smelting.consumeIngredients(player, recipe);
    outcome.bars = 2;
    player.sendMessage("The Varrock platebody enabled you to smelt your next ore simultaneously.");
  }
  if (ring) useRingCharges(player, outcome.bars);
}

function checkRing({ player }) {
  const charges = ringCharges(player);
  player.sendMessage(`You can smelt ${charges} more piece${charges === 1 ? "" : "s"} of iron ore before a ring of forging melts.`);
}

function breakRing(event) {
  const { player, slot, interfaceId } = event;
  const container = interfaceId === Core.Equipment.INVENTORY_INTERFACE_ID ? player.getEquipment() : player.getInventory();
  container.set(slot, new Core.Item(-1));
  container.refreshItems();
  player.setAttribute(RING_CHARGES_ATTRIBUTE, RING_CHARGES);
  player.sendMessage("The ring shatters. Your next ring of forging will start afresh from 140 pieces of iron.");
}

module.exports = function attach(api) {
  api.persistAttribute(RING_CHARGES_ATTRIBUTE, RING_CHARGES);
  api.onCustomEvent("smithing:smelt-outcome", smeltOutcome);
  api.onItemAction("Ring of forging", { Check: checkRing, Break: breakRing });
};

Object.assign(module.exports, { RING_CHARGES_ATTRIBUTE, smeltOutcome });
