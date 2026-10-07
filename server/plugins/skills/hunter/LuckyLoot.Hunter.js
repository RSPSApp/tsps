"use strict";
const { H, roll: quantity } = require("./Context.Hunter");
const tables = require("./LuckyLoot.json");
// Wiki reward-casket per-roll tables; Lucky never rolls mimic/tertiary rewards.
function roll() {
  const tiers = Object.values(tables), table = tiers[quantity(0, tiers.length - 1)];
  let draw = Math.random() * table.reduce((total, row) => total + row[1], 0);
  const row = table.find(row => (draw -= row[1]) < 0) ?? table.at(-1);
  let id = H.core.ItemIdentifiers[row[0]];
  if (row[4]) id = H.core.ItemDefinition.forId(id).getNoteId();
  return [[id, quantity(row[2], row[3])]];
}
module.exports = { roll, tables };
