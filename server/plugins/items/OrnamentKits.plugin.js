/**
 * Ornament kits and cosmetic recolours (https://oldschool.runescape.wiki/w/Ornament_kit).
 *
 * Using a kit on its base item consumes the kit and swaps the item for the cosmetic id from
 * plugins/items/data/ornament-kits.json. Reverting swaps the id back; entries whose Wiki says
 * the kit is returned set `refund: true`. The table also maps graceful colour variants, which
 * keep the graceful set bonus because the cache names every colour "Graceful ...".
 *
 * Barrows gear maps through Barrows.baseItemId, so a kit applies to a degraded piece and an
 * Echo Ahrim's piece reverts to the matching stage of the plain set (keeping its meta).
 *
 * A refund (the Wiki page of the ornamented item: "can be dismantled anytime, returning the
 * tradeable <item> and ornament kit") needs a free slot, and a restricted (preset, untradeable,
 * unbankable) copy is refused, because the kit would come back as a free, unrestricted item.
 * The same refusal guards applying a kit. Echo Ahrim's takes the option "Detach" as well.
 */
const fs = require("fs");
const path = require("path");
const { Barrows } = require("../../src/main/typescript/elvarg/game/content/combat/Barrows");

let core = null;
let byKitAndBase = new Map();
let byResult = new Map();
let byBase = new Map();

const PRESET_TEXT = "Preset items cannot be used for this.";

/** Preset (and other untradeable or unbankable) copies keep their restrictions; a refunded kit would not. */
function restricted(item) {
  const Item = core.Item;
  return !!item && (item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true);
}

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

/** True when the piece already is this entry's ornamented item (any Barrows stage of it, for Echo Ahrim's). */
function alreadyOrnamented(entry, itemId) {
  if (itemId === entry.result || (entry.worn > 0 && itemId === entry.worn)) {
    return true;
  }
  for (let stage = 0; stage < 5; stage++) {
    if (Barrows.stageItemIdFor(entry.result, stage) === itemId) {
      return true;
    }
  }
  return false;
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
  // Echo Ahrim's resolves to its plain base, so the kit would otherwise be spent on a piece that has it.
  if (alreadyOrnamented(match.entry, baseItem.getId())) {
    return;
  }
  // A restricted kit would make a free, unrestricted ornamented item. A restricted base is refused only
  // where the kit is refundable (it could never come back from a restricted copy); a preset whip still
  // takes a whip mix, which keeps its metadata.
  if (restricted(kit) || (match.entry.refund && restricted(baseItem))) {
    player.sendMessage("You cannot use restricted items to upgrade equipment.");
    event.handled = true;
    return;
  }
  inventory.deleteAtSlot(kitSlot, 1, false);
  // The plain undamaged piece makes the undamaged ornamented one; a used one keeps its stage.
  const stage = Barrows.stageOf(baseItem.getId?.()) ?? 0;
  baseItem.setId(baseItem.getId() === match.entry.base
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

/** Revert from the item's Revert/Dismantle option, returning the kit for entries that specify it. */
function revertItem(event) {
  if (event.option !== "Revert" && event.option !== "Dismantle" && event.option !== "Detach") {
    return;
  }
  const itemId = Number(event.itemId);
  const barrowsBase = Barrows.baseItemId(itemId);
  const entry = byResult.get(itemId) ?? (barrowsBase == null ? null : byBase.get(barrowsBase));
  if (!entry || entry.cleaningCloth || !event.item) {
    return;
  }
  // Wiki (Dragon full helm (g) and the rest): these kits come back when dismantled, so it must fit first.
  const kit = entry.refund ? new core.Item(entry.kit, 1) : null;
  if (kit && restricted(event.item)) {
    event.player.sendMessage(PRESET_TEXT);
    event.handled = true;
    return;
  }
  if (kit && event.player.getInventory().getAddableAmount(kit) < 1) {
    event.player.sendMessage("You don't have enough inventory space to do that.");
    event.handled = true;
    return;
  }
  if (barrowsBase == null) {
    event.item.setId(entry.base);
  } else {
    // The undamaged ornamented piece gives the undamaged plain one back, a used one its stage.
    event.item.setId(itemId === entry.result
      ? entry.base
      : Barrows.stageItemId(barrowsBase, Barrows.stageOf(itemId) ?? 0));
  }
  if (kit) event.player.getInventory().add(kit, false);
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
