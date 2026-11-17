"use strict";

/**
 * Wiki Rock golem#Colours: use ore on the inventory pet or own follower; rock restores normal.
 * Wiki Granite: all three sizes work. Each form has a distinct cache item/world/house NPC.
 * Retail video Wt4YeKDJhAA at27.0–27.75s shows one Iron ore consumed on a copper follower.
 * No local recording establishes exact chat, ticks or effects; do not invent metamorphosis text.
 * Same-form uses keep the existing unhandled response. Rock reset uses the same one-item cost;
 * this cost is inferred from the successful ore transformation, not separately recorded.
 */
const FORMS = [
  {key: "normal", ores: ["rock"]},
  {key: "tin", ores: ["tin_ore"]},
  {key: "copper", ores: ["copper_ore"]},
  {key: "iron", ores: ["iron_ore"]},
  {key: "blurite", ores: ["blurite_ore"]},
  {key: "silver", ores: ["silver_ore"]},
  {key: "coal", ores: ["coal"]},
  {key: "gold", ores: ["gold_ore"]},
  {key: "mithril", ores: ["mithril_ore"]},
  {key: "granite", ores: ["enakh_granite_tiny", "enakh_granite_small", "enakh_granite_medium"]},
  {key: "adamantite", ores: ["adamantite_ore"]},
  {key: "runite", ores: ["runite_ore"]},
  {key: "amethyst", ores: ["amethyst"]},
  {key: "lovakite", ores: ["lovakite_ore"]},
  {key: "elemental", ores: ["elemental_workshop_ore"]},
  {key: "daeyalt", ores: ["sang_jas_ore"]},
  {key: "lead", ores: ["lead_ore"]},
  {key: "rubium", ores: ["rubium_splinters"]},
  {key: "nickel", ores: ["nickel_ore"]},
];
let api;
let services;
const rowByItem = new Map();
const rowByNpc = new Map();
const rowByOre = new Map();

function rows(base, cache) {
  rowByItem.clear(); rowByNpc.clear(); rowByOre.clear();
  if (!base) return [];
  const added = [];
  for (const {key, ores} of FORMS) {
    const itemId = cache.getObjId(key === "normal" ? "skillpetmining" : `skillpetmining_${key}`);
    const npcKey = key === "normal" ? "default" : key;
    const petId = cache.getNpcId(`skillpet_mining_${npcKey}`);
    const houseNpcId = cache.getNpcId(`poh_skillpet_mining_${npcKey}`);
    if (!Number.isInteger(itemId) || !Number.isInteger(petId)) continue;
    const row = key === "normal" ? base : {...base, enumName: `ROCK_GOLEM_${key.toUpperCase()}`,
      itemId, petId, houseNpcId, dialogueVariant: `standard-dialogue-${key}-variant`, chance: undefined};
    rowByItem.set(itemId, row); rowByNpc.set(petId, row);
    for (const ore of ores) {
      const oreId = cache.getObjId(ore);
      if (Number.isInteger(oreId)) rowByOre.set(oreId, row);
    }
    if (row !== base) added.push(row);
  }
  return added;
}

function use(player, usedId, usedSlot, current, {slot, npc}) {
  const next = rowByOre.get(usedId);
  if (!next || next === current || player.busy()) return false;
  const inventory = player.getInventory();
  const ore = inventory.get(usedSlot);
  if (ore?.getId() !== usedId || ore.getAmount() < 1) return false;
  // Validate both inputs before spending. Inventory use works in either orientation.
  if (!npc && inventory.get(slot)?.getId() !== current.itemId) return false;
  inventory.deleteAtSlot(usedSlot, 1);
  if (npc) services.transformFollower(player, npc, next);
  else {
    inventory.setItem(slot, new api.core.Item(next.itemId, 1));
    services.setStoredVariant(player, next, next.petId);
    services.recordOwnership(player, next);
  }
  inventory.refreshItems();
  api.emitCustomEvent("persistence:save", {player, reason: "rock-golem-form"});
  return true;
}

function itemOnItem(event) {
  if (event.handled) return;
  const sides = [
    [event.usedItemId, event.usedItemSlot, event.usedWithItemId, event.usedWithItemSlot],
    [event.usedWithItemId, event.usedWithItemSlot, event.usedItemId, event.usedItemSlot],
  ];
  for (const [usedId, usedSlot, petId, slot] of sides) {
    const current = rowByItem.get(petId);
    if (!current) continue;
    if (use(event.player, usedId, usedSlot, current, {slot})) event.handled = true;
    return;
  }
}

function itemOnNpc(event) {
  if (event.handled || !event.target) return;
  const current = rowByNpc.get(event.target.getId());
  if (!current || !services.isOwnFollower(event.player, event.target)) return;
  if (use(event.player, event.itemId, event.slot, current, {npc: event.target})) event.handled = true;
}

function attach(pluginApi, helpers) {
  api = pluginApi; services = helpers;
  api.onItemOnItem(itemOnItem, {noted: false});
  api.onItemOnNpc(itemOnNpc, {noted: false});
}
module.exports = {FORMS, rows, attach};
