/**
 * Ornament kits (https://oldschool.runescape.wiki/w/Ornament_kit).
 *
 * Using a kit on its base item consumes the kit and swaps the item for the
 * ornamented id from data/definitions/ornament-kits.json. The three rune
 * scimitar kits are not in the table because this cache revision has no
 * ornamented rune scimitar items to point at.
 */
const fs = require("fs");
const path = require("path");

let core = null;
let kitIds = new Set();
let byKitAndBase = new Map();

function loadKits() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "ornament-kits.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return (data.kits ?? []).map((entry) => ({
    kit: Number(entry.kit),
    base: Number(entry.base),
    result: Number(entry.result),
    name: entry.name,
  }));
}

function findEntry(usedItemId, usedWithItemId) {
  const direct = byKitAndBase.get(`${usedItemId}|${usedWithItemId}`);
  if (direct) {
    return { entry: direct, kitOnLeft: true };
  }
  const reverse = byKitAndBase.get(`${usedWithItemId}|${usedItemId}`);
  return reverse ? { entry: reverse, kitOnLeft: false } : null;
}

function applyKit(event) {
  const match = findEntry(Number(event.usedItemId), Number(event.usedWithItemId));
  if (!match) {
    return;
  }
  const { player } = event;
  const kitItem = match.kitOnLeft ? event.usedItem : event.usedWithItem;
  const baseItem = match.kitOnLeft ? event.usedWithItem : event.usedItem;
  if (!kitItem || !baseItem || Number(baseItem.getId?.()) !== match.entry.base) {
    return;
  }
  player.getInventory().deleteNumber(match.entry.kit, 1);
  baseItem.setId(match.entry.result);
  player.getInventory().refreshItems();
  player.sendMessage(`You apply the ${match.entry.name.toLowerCase()}.`);
  event.handled = true;
}

module.exports = {
  name: "OrnamentKits",
  _test: { loadKits: () => loadKits(), findEntry, applyKit },
  register(api) {
    core = api.core;
    for (const entry of loadKits()) {
      kitIds.add(entry.kit);
      byKitAndBase.set(`${entry.kit}|${entry.base}`, entry);
    }
    api.onItemOnItem(applyKit, { noted: false });
    api.log("registered", { kits: kitIds.size, pairs: byKitAndBase.size });
  },
};
