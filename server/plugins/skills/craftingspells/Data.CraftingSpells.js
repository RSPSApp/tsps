/**
 * data/crafting-spells.json with its item names resolved to the cache's ids. A name the
 * cache doesn't have throws at load, rather than casting with a missing item.
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "crafting-spells.json"), "utf8"));

function itemId(core, name) {
  const id = core.ItemIds[name];
  if (!Number.isInteger(id)) throw new Error(`crafting-spells.json: unknown item ${name}`);
  return id;
}

function runes(core, entries) {
  return entries.map(([name, amount]) => new core.Item(itemId(core, name), amount));
}

module.exports = { DATA, itemId, runes };
