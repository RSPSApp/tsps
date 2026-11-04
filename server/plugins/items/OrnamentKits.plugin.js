/**
 * Ornament kits and cosmetic recolours (https://oldschool.runescape.wiki/w/Ornament_kit).
 *
 * Using a kit on its base item consumes the kit and swaps the item for the cosmetic id from
 * plugins/items/data/ornament-kits.json. Reverting swaps the id back but does not return the
 * kit (Wiki: kits are consumed on apply). The table also maps graceful colour variants, which
 * keep the graceful set bonus because the cache names every colour "Graceful ...".
 *
 * Barrows gear maps through Barrows.baseItemId, so a kit applies to a degraded piece and an
 * Echo Ahrim's piece reverts to the matching stage of the plain set (keeping its meta).
 */
const fs = require("fs");
const path = require("path");
const { Barrows } = require("../../src/main/typescript/elvarg/game/content/combat/Barrows");

let core = null;
let byKitAndBase = new Map();
let byResult = new Map();
let byBase = new Map();

function loadKits() {
  const file = path.join(__dirname, "data", "ornament-kits.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return (data.kits ?? []).map((entry) => ({
    kit: Number(entry.kit) || 0,
    base: Number(entry.base),
    result: Number(entry.result),
    worn: Number(entry.worn) || 0,
    name: entry.name,
    refund: entry.refund === true,
    cleaningCloth: entry.cleaningCloth === true,
  }));
}

function resolvedBase(itemId) {
  return Barrows.baseItemId(Number(itemId)) ?? Number(itemId);
}

function findEntry(usedItemId, usedWithItemId) {
  const direct = byKitAndBase.get(`${usedItemId}|${resolvedBase(usedWithItemId)}`);
  if (direct) {
    return { entry: direct, kitOnLeft: true };
  }
  const reverse = byKitAndBase.get(`${usedWithItemId}|${resolvedBase(usedItemId)}`);
  return reverse ? { entry: reverse, kitOnLeft: false } : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function applyKit(event) {
  const match = findEntry(Number(event.usedItemId), Number(event.usedWithItemId));
  if (!match) {
    return;
  }
  const { player } = event;
  const baseItem = match.kitOnLeft ? event.usedWithItem : event.usedItem;
  if (!baseItem || resolvedBase(baseItem.getId?.()) !== match.entry.base) {
    return;
  }
  const kit = match.kitOnLeft ? event.usedItem : event.usedWithItem;
  const kitSlot = match.kitOnLeft ? event.usedItemSlot : event.usedWithItemSlot;
  const baseSlot = match.kitOnLeft ? event.usedWithItemSlot : event.usedItemSlot;
  const inventory = player.getInventory();
  if (inventory.getItems()[kitSlot] !== kit || inventory.getItems()[baseSlot] !== baseItem ||
    kit.getId() !== match.entry.kit || kit.getAmount() !== 1 || baseItem.getAmount() !== 1) return;
  if (kit.isPresetItem() || kit.isUntradeable() || kit.isUnbankable()) {
    player.sendMessage("You cannot use restricted items to upgrade equipment.");
    event.handled = true;
    return;
  }
  inventory.deleteAtSlot(kitSlot, 1, false);
  const stage = Barrows.stageOf(baseItem.getId?.()) ?? 0;
  baseItem.setId(stage === 0
    ? match.entry.result
    : Barrows.stageItemIdFor(match.entry.result, stage) ?? match.entry.result);
  refresh(player);
  player.sendMessage(`You apply the ${match.entry.name.toLowerCase()}.`);
  event.handled = true;
}

function cleanDye(event) {
  const clothFirst = event.usedItemId === core.ItemIdentifiers.CLEANING_CLOTH;
  const cloth = clothFirst ? event.usedItem : event.usedWithItem;
  const item = clothFirst ? event.usedWithItem : event.usedItem;
  const clothSlot = clothFirst ? event.usedItemSlot : event.usedWithItemSlot;
  const itemSlot = clothFirst ? event.usedWithItemSlot : event.usedItemSlot;
  const entry = byResult.get(item?.getId());
  const inventory = event.player.getInventory();
  if (!entry?.cleaningCloth || cloth?.getId() !== core.ItemIdentifiers.CLEANING_CLOTH ||
    inventory.getItems()[clothSlot] !== cloth || inventory.getItems()[itemSlot] !== item ||
    cloth.getAmount() !== 1 || item.getAmount() !== 1) return;
  item.setId(entry.base);
  inventory.refreshItems();
  event.player.sendMessage("You wipe the colour off your weapon.");
  event.handled = true;
}

/** Revert from the item's Revert/Dismantle option; the kit is not refunded. */
function revertItem(event) {
  if (event.option !== "Revert" && event.option !== "Dismantle") {
    return;
  }
  const itemId = Number(event.itemId);
  const barrowsBase = Barrows.baseItemId(itemId);
  const entry = byResult.get(itemId) ?? (barrowsBase == null ? null : byBase.get(barrowsBase));
  if (!entry || entry.cleaningCloth || !event.item) {
    return;
  }
  if (barrowsBase == null) {
    // Wiki (Holy ghrazi rapier and friends): these kits come back when dismantled, so it must fit first.
    const kit = entry.refund ? new core.Item(entry.kit, 1) : null;
    if (kit && event.player.getInventory().getAddableAmount(kit) < 1) {
      event.player.sendMessage("You don't have enough inventory space to do that.");
      event.handled = true;
      return;
    }
    event.item.setId(entry.base);
    if (kit) event.player.getInventory().add(kit, false);
  } else {
    event.item.setId(Barrows.stageItemId(barrowsBase, Barrows.stageOf(itemId) ?? 0));
  }
  refresh(event.player);
  event.player.sendMessage(`You revert the ${entry.name.toLowerCase()}.`);
  event.handled = true;
}

module.exports = {
  name: "OrnamentKits",
  _test: { loadKits: () => loadKits(), findEntry, applyKit, revertItem },
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    core.Barrows.registerVariantStages(I.AHRIMS_HOOD, [
      I.ECHO_AHRIMS_HOOD_100,
      I.ECHO_AHRIMS_HOOD_75,
      I.ECHO_AHRIMS_HOOD_50,
      I.ECHO_AHRIMS_HOOD_25,
      I.ECHO_AHRIMS_HOOD_0,
    ], I.ECHO_AHRIMS_HOOD);
    core.Barrows.registerVariantStages(I.AHRIMS_ROBETOP, [
      I.ECHO_AHRIMS_ROBETOP_100,
      I.ECHO_AHRIMS_ROBETOP_75,
      I.ECHO_AHRIMS_ROBETOP_50,
      I.ECHO_AHRIMS_ROBETOP_25,
      I.ECHO_AHRIMS_ROBETOP_0,
    ], I.ECHO_AHRIMS_ROBETOP);
    core.Barrows.registerVariantStages(I.AHRIMS_ROBESKIRT, [
      I.ECHO_AHRIMS_ROBESKIRT_100,
      I.ECHO_AHRIMS_ROBESKIRT_75,
      I.ECHO_AHRIMS_ROBESKIRT_50,
      I.ECHO_AHRIMS_ROBESKIRT_25,
      I.ECHO_AHRIMS_ROBESKIRT_0,
    ], I.ECHO_AHRIMS_ROBESKIRT);
    core.Barrows.registerVariantStages(I.AHRIMS_STAFF, [
      I.ECHO_AHRIMS_STAFF_100,
      I.ECHO_AHRIMS_STAFF_75,
      I.ECHO_AHRIMS_STAFF_50,
      I.ECHO_AHRIMS_STAFF_25,
      I.ECHO_AHRIMS_STAFF_0,
    ], I.ECHO_AHRIMS_STAFF);
    for (const entry of loadKits()) {
      if (entry.kit > 0) {
        byKitAndBase.set(`${entry.kit}|${entry.base}`, entry);
        byBase.set(entry.base, entry);
      }
      byResult.set(entry.result, entry);
      if (entry.worn > 0) {
        byResult.set(entry.worn, entry);
      }
    }
    api.onItemOnItem(applyKit, { noted: false });
    api.onItemOnItem(cleanDye, { noted: false });
    api.onItemAction(revertItem);
    api.log("registered", { pairs: byKitAndBase.size, variants: byResult.size });
  },
};
