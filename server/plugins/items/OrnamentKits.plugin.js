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
  player.getInventory().deleteNumber(match.entry.kit, 1);
  const stage = Barrows.stageOf(baseItem.getId?.()) ?? 0;
  baseItem.setId(stage === 0
    ? match.entry.result
    : Barrows.stageItemIdFor(match.entry.result, stage) ?? match.entry.result);
  refresh(player);
  player.sendMessage(`You apply the ${match.entry.name.toLowerCase()}.`);
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
  if (!entry || !event.item) {
    return;
  }
  if (barrowsBase == null) {
    event.item.setId(entry.base);
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
    api.onItemAction(revertItem);
    api.log("registered", { pairs: byKitAndBase.size, variants: byResult.size });
  },
};
