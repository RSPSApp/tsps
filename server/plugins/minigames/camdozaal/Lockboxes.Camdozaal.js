"use strict";

const S = require("./Shared.Camdozaal");
const Vault = require("./Vault.Camdozaal");
const TABLES = require("./data/lockboxes.json");
function weighted(rows) {
  let roll = Math.random() * rows.reduce((total, row) => total + row.weight, 0);
  return rows.find(row => (roll -= row.weight) < 0) ?? rows[rows.length - 1];
}
function open({ player, itemId }) {
  if (Vault.inVault(player)) return player.sendMessage("You can't open lockboxes whilst inside the Vault.");
  const tier = Object.keys(TABLES).find(name => S.obj(`camdozaal_vault_chest_${name}`) === itemId);
  if (!tier || !player.getInventory().contains(itemId)) return;
  const table = TABLES[tier], loot = [];
  let gearRolled = false;
  for (let i = 0; i < table.rolls; i++) {
    // Once gear has hit, condition subsequent rolls on the standard table.
    const gear = !gearRolled && Math.random() * 50 < table.gearWeight;
    const row = weighted(gear ? table.gear : table.standard);
    gearRolled ||= gear;
    let id = S.obj(row.item);
    if (row.noted) {
      id = S.core().ItemDefinition.forId(id).getNoteId();
      if (!Number.isInteger(id) || id < 0) throw new Error(`Missing lockbox reward note: ${row.item}`);
    }
    loot.push(new (S.core().Item)(id, row.minimum + Math.floor(Math.random() * (row.maximum - row.minimum + 1))));
  }
  player.getInventory().deleteNumber(itemId, 1);
  for (const item of loot) player.getInventory().forceAdd(player, item);
  player.sendMessage("You open the lockbox and find some treasure.");
}
module.exports = function attach(api) {
  api.onItemAction("Simple lockbox", { Open: open });
  api.onItemAction("Elaborate lockbox", { Open: open });
  api.onItemAction("Ornate lockbox", { Open: open });
};
