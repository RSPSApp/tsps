"use strict";

const data = require("./Data.BarbarianAssault");
const Points = require("./Points.BarbarianAssault");

let api = null;
let core = null;
const given = new WeakMap();
const spellStyle = new Map();
const ARENA_ITEM_META = "barbarian-assault:arena";

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const [name, spell] of Object.entries(core.CombatSpells ?? {})) {
    if (!spell || typeof spell !== "object") continue;
    if (name.includes("WIND")) spellStyle.set(spell, data.CALL.CONTROLLED);
    else if (name.includes("WATER")) spellStyle.set(spell, data.CALL.ACCURATE);
    else if (name.includes("EARTH")) spellStyle.set(spell, data.CALL.AGGRESSIVE);
    else if (name.includes("FIRE")) spellStyle.set(spell, data.CALL.DEFENSIVE);
  }
}

function remember(player, itemId, amount) {
  let entries = given.get(player);
  if (!entries) given.set(player, (entries = new Map()));
  entries.set(itemId, (entries.get(itemId) ?? 0) + amount);
}

/**
 * Gives an arena item and records it, so cleanup only removes what the arena handed out.
 * Arena supplies carry the untradeable item meta, so a teammate trade cannot move them
 * off the match even if another transfer route is opened later.
 */
function give(player, itemId, amount = 1) {
  if (!player || !Number.isInteger(itemId) || amount <= 0) return false;
  const inventory = player.getInventory?.();
  if (!inventory) return false;
  const meta = { [core.Item.UNTRADEABLE_META]: true, [ARENA_ITEM_META]: true };
  const item = new core.Item(itemId, amount, meta);
  const addable = inventory.getAddableAmount?.(item);
  if (Number.isFinite(addable) && addable < amount) {
    inventory.full?.(itemId);
    return false;
  }
  inventory.add(item, true);
  remember(player, itemId, amount);
  return true;
}

/** Moves an arena item between teammates, keeping cleanup ownership with the holder. */
function transfer(from, to, itemId, amount = 1) {
  if (!from || !to || !Number.isInteger(itemId) || amount <= 0) return false;
  const source = from.getInventory?.();
  if (!source || (source.getAmount?.(itemId) ?? 0) < amount || !isTracked(from, itemId)) return false;
  if (!give(to, itemId, amount)) return false;
  removeTracked(from, itemId, amount);
  const entries = given.get(from);
  if (entries) {
    const held = (entries.get(itemId) ?? 0) - amount;
    if (held > 0) entries.set(itemId, held);
    else entries.delete(itemId);
  }
  return true;
}

/** Whether this player still holds an item the arena handed out. */
function isTracked(player, itemId) {
  const entries = given.get(player);
  return !!entries && (entries.get(itemId) ?? 0) > 0;
}

function isArenaItem(item) {
  return item?.getMetaValue?.(ARENA_ITEM_META) === true
    || item?.getMeta?.()?.[ARENA_ITEM_META] === true;
}

function removeTracked(player, itemId, amount) {
  const inventory = player?.getInventory?.();
  if (!inventory) return;
  // Remove only the arena copies, never the player's own stack of the same id.
  const items = inventory.getItems?.() ?? [];
  let remaining = amount;
  for (let slot = 0; slot < items.length && remaining > 0; slot++) {
    const item = items[slot];
    if (item?.getId?.() !== itemId || !isArenaItem(item)) continue;
    const remove = Math.min(remaining, item.getAmount?.() ?? 0);
    if (remove <= 0) continue;
    inventory.deleteAtSlot?.(slot, remove);
    remaining -= remove;
  }
}

function giveAll(player, items) {
  for (const [itemId, amount] of items) give(player, itemId, amount);
}

/** Removes only the copies this arena gave, never a player's own penance gear. */
function clear(player) {
  if (!player) return;
  const entries = given.get(player);
  if (entries) {
    for (const [itemId, amount] of entries) removeTracked(player, itemId, amount);
    entries.clear();
  }
}

/** Reconnect/restart cleanup when no match object survives to know what was given. */
function stripRoleItems(player) {
  const inventory = player?.getInventory?.();
  if (!inventory) return;
  given.delete(player);
  const items = inventory.getItems?.() ?? [];
  for (let slot = 0; slot < items.length; slot++) {
    const item = items[slot];
    if (!isArenaItem(item)) continue;
    const amount = item.getAmount?.() ?? 0;
    if (amount > 0) inventory.deleteAtSlot?.(slot, amount);
  }
}

function roleItems(player, role) {
  const level = Points.level(player, role);
  const items = [];
  items.push([data.HORN_ITEMS[role][Math.min(level, 5) - 1], 1]);
  if (role === data.ROLE.COLLECTOR) items.push([data.COLLECTION_BAGS[Math.min(level, 5) - 1], 1]);
  if (role === data.ROLE.HEALER) items.push([data.ITEM.HEALING_VIAL_EMPTY, 1]);
  if (role === data.ROLE.ATTACKER) {
    items.push([data.ITEM.BULLET_ARROW, 25], [data.ITEM.FIELD_ARROW, 25], [data.ITEM.BLUNT_ARROW, 25], [data.ITEM.BARBED_ARROW, 25]);
  }
  return items;
}

function openRoleHud(player, role) {
  const sender = player?.getPacketSender?.();
  if (!sender) return;
  sender.sendSubInterface(data.OVERLAY_HUD_UID, data.ROLE_INTERFACE[role], 1);
}

function closeHud(player) {
  player?.getPacketSender?.()?.closeSubInterface?.(data.OVERLAY_HUD_UID);
}

function setHudText(player, role, key, text) {
  const component = data.ROLE_TEXT[role]?.[key];
  if (!component) return;
  player?.getPacketSender?.()?.sendString?.(String(text), (data.ROLE_INTERFACE[role] << 16) | component);
}

function setHudPartner(player, role) {
  setHudText(player, role, "partner", data.ROLE_LABEL[data.PARTNER[role]]);
}

function healAmount(player) {
  const role = data.ROLE.HEALER;
  return data.HEALER_HEAL[Math.min(Points.level(player, role), 5) - 1];
}

function collectorCapacity(player) {
  return data.COLLECTOR_CAPACITY[Math.min(Points.level(player, data.ROLE.COLLECTOR), 5) - 1];
}

function attackerBonus(player) {
  return data.ATTACKER_BONUS[Math.min(Points.level(player, data.ROLE.ATTACKER), 5) - 1];
}

function defenderRange(player) {
  return data.DEFENDER_LURE_RANGE[Math.min(Points.level(player, data.ROLE.DEFENDER), 5) - 1];
}

/**
 * The call a player's current combat setup satisfies. Ranged checks the
 * BA arrows first (Wiki: Bullet/Field/Blunt/Barbed), magic checks the spell
 * element, melee falls back to its fight style.
 */
function attackStyle(player) {
  // A loaded bow is the attacker's active style; the BA arrow decides it even
  // when a spell happens to remain selected from an earlier action.
  const ammo = player?.getEquipment?.()?.get?.(core.Equipment.AMMUNITION_SLOT)?.getId?.();
  if (ammo != null && data.ARROW_CALL[ammo]) return data.ARROW_CALL[ammo];

  const spell = player?.getCombat?.()?.getSelectedSpell?.();
  const fromSpell = spell ? spellStyle.get(spell) : null;
  if (fromSpell) return fromSpell;

  const style = player?.getFightType?.()?.getStyle?.();
  if (style === core.FightStyle?.ACCURATE) return data.CALL.ACCURATE;
  if (style === core.FightStyle?.AGGRESSIVE) return data.CALL.AGGRESSIVE;
  if (style === core.FightStyle?.DEFENSIVE) return data.CALL.DEFENSIVE;
  return data.CALL.CONTROLLED;
}

function styleName(call) {
  return data.CALL_LABEL[call] ?? call;
}

module.exports = {
  init, give, giveAll, transfer, isTracked, clear, stripRoleItems, roleItems, ARENA_ITEM_META,
  openRoleHud, closeHud, setHudText, setHudPartner,
  healAmount, collectorCapacity, attackerBonus, defenderRange, attackStyle, styleName,
};
