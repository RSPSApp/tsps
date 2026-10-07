/**
 * Shared checks for gear passives: what a player wears (by item name, so every
 * variant id counts) and what their combat target is.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

/** Lower-case name of the item in an equipment slot, "" when empty. */
function wornName(player, slot) {
  const item = player?.getEquipment?.()?.getItems?.()?.[slot];
  const id = item?.getId?.() ?? -1;
  return id > 0 ? String(ItemDefinition.forId(id)?.getName?.() ?? "").toLowerCase() : "";
}

function wearing(player, slot, names) {
  return names.has(wornName(player, slot));
}

function weaponName(player) {
  return wornName(player, Equipment.WEAPON_SLOT);
}

/** The NPC the entity is fighting, or null. */
function targetNpc(entity) {
  const target = entity?.getCombat?.()?.getTarget?.();
  return target?.isNpc?.() ? target.getAsNpc() : null;
}

/** Whether the entity's NPC target has a Wiki monster attribute (undead, demon, dragon, ...). */
function targetHasAttribute(entity, attribute) {
  return targetNpc(entity)?.getCurrentDefinition?.()?.hasAttribute?.(attribute) === true;
}

/** value * numerator / denominator, rounded down. */
function scale(value, numerator, denominator) {
  return Math.floor((value * numerator) / denominator);
}

/** value plus percent of it, the addition rounded down (the Wiki DPS calculator's demonbane). */
function addPercent(value, percent) {
  return value + Math.floor((value * percent) / 100);
}

module.exports = { asPlayer, wornName, wearing, weaponName, targetNpc, targetHasAttribute, scale, addPercent };
