"use strict";

/**
 * Shared Mimic ids, tiles and candy data (see ../Mimic.plugin.js for behaviour and sources).
 *
 * Ids are api.core.NpcIdentifiers / ObjectIdentifiers / ItemIdentifiers (cache gamevals),
 * never bare numbers at use sites.
 */

const State = require("./State.Mimic");
const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function ids() {
  const { NpcIdentifiers: N, ItemIdentifiers: I, ObjectIdentifiers: O } = state.core;
  return {
    CHALLENGE: N.THE_MIMIC,
    BOSS: N.THE_MIMIC_2,
    WARRIOR: N.THIRD_AGE_WARRIOR,
    RANGER: N.THIRD_AGE_RANGER,
    MAGE: N.THIRD_AGE_MAGE,
    CASKET_ITEM: I.MIMIC,
    PLANK: I.MAHOGANY_PLANK,
    STRANGE_CASKET: O.COL_FFFF00_STRANGE_CASKET_COL,
    KEYHOLE: O.KEYHOLE_2,
  };
}

/** The arena room on the real map (z=1): keyhole, sweets and coins all sit inside it. */
const ARENA = { minX: 2710, maxX: 2727, minY: 4311, maxY: 4324, z: 1 };
/** Where the fight starts: player entrance and the casket's tile. */
const ENTRANCE_TILE = [2719, 4314, 1];
const CASKET_TILE = [2718, 4319, 1];
/** By the strange casket upstairs in Watson's house (object at 1645, 3569): the exit tile.
 * (Verified walkable: stood on in testing.) */
const WATSON_TILE = [1645, 3570, 1];

/**
 * Surfacing/attack anims from data/definitions/npc-animations.json (rev 241): 8633's
 * entries decode as mimic_melee, mimic_charge_ranged and mimic_death (cache seq names).
 */
const ANIM = { MELEE: 8308, CANDY: 8309 };

/**
 * The four candy types (Wiki: three pink that hurt, one red/blue/green that spawns
 * the warrior/mage/ranger; the colour order is NR-only).
 * Projectile/impact ids decode in this cache (rev 241, `yarn dump:spotanim`).
 */
const CANDY = {
  PINK: { projectile: 1670, impact: 1674 },
  GREEN: { projectile: 1671, impact: 1675 },
  RED: { projectile: 1672, impact: 1676 },
  BLUE: { projectile: 1673, impact: 1677 },
};
/** Volley order over the six tiles (player tile first): three pink, then red/green/blue. */
const VOLLEY = ["PINK", "PINK", "PINK", "RED", "GREEN", "BLUE"];

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

/**
 * Legacy aliases remain available to callers; the per-casket ledger is now
 * authoritative when an item is dropped or moved to a grave during its fight.
 */
const ROLLS_META_KEY = State.META_KEY;
const ROLLS_ATTRIBUTE = State.LEGACY_ROLLS_ATTRIBUTE;
const FRESH_ROLLS = State.ATTEMPTS.elite;

function mimicSlot(player) {
  const slot = player.getInventory?.()?.getSlotForItemId?.(ids().CASKET_ITEM);
  return Number.isInteger(slot) && slot >= 0 ? slot : -1;
}

function mimicItem(player, casketId = null) {
  if (casketId != null) {
    return player.getInventory?.()?.getItems?.()?.find(item => item?.getId?.() === ids().CASKET_ITEM &&
      item.getMetaValue?.(ROLLS_META_KEY)?.id === casketId) ?? null;
  }
  const slot = mimicSlot(player);
  if (slot < 0) return null;
  const item = player.getInventory?.()?.getItems?.()?.[slot];
  return item?.getId?.() === ids().CASKET_ITEM ? item : null;
}

function rollsOn(item) {
  const rolls = Number(item?.getMetaValue?.(ROLLS_META_KEY)?.rolls);
  return Number.isInteger(rolls) ? rolls : null;
}

function casketState(player, casketId = null) {
  const item = mimicItem(player, casketId);
  if (!item && casketId == null) return null;
  return State.get(player, item, casketId);
}

function initializeCasket(item, tier, clueRolls) {
  if (item?.getId?.() !== ids().CASKET_ITEM) throw new Error("Invalid Mimic casket item");
  return State.initialize(item, tier, clueRolls);
}

/** The old mirror remains informational; new items reconcile by their own identity. */
function ensureRolls(player, casketId = null) {
  const item = mimicItem(player, casketId);
  const record = casketState(player, casketId);
  if (!record) return null;
  player.setAttribute?.(ROLLS_ATTRIBUTE, record.rolls);
  return item;
}

/**
 * Spend one roll (a leave or death with the fight on). At zero the chest
 * disappears. The session's casket identity selects its saved ledger entry even
 * when the item is on the ground or in a grave.
 */
function spendRoll(player, casketId = null) {
  const item = mimicItem(player, casketId);
  if (!item && casketId == null) return 0;
  const left = State.spend(player, item, casketId).rolls;
  player.setAttribute?.(ROLLS_ATTRIBUTE, left);
  if (left <= 0 && item) {
    const inventory = player.getInventory();
    const slot = inventory.getItems().indexOf(item);
    if (slot >= 0) inventory.deleteAtSlot(slot, 1);
    State.forget(player, casketId ?? item.getMetaValue(ROLLS_META_KEY).id);
  }
  return left;
}

/** Origin, original clue rolls and attempts reconciled by casket identity. */
function rewardState(player, item = mimicItem(player)) {
  return item ? State.forOpen(player, item) : null;
}

function rollsForOpen(player, item = mimicItem(player)) {
  return rewardState(player, item)?.attemptsLeft ?? 0;
}

function markDefeated(player, casketId) {
  return State.defeat(player, mimicItem(player, casketId), casketId);
}

module.exports = { bind, core, ids, alive, ARENA, ENTRANCE_TILE, CASKET_TILE, WATSON_TILE, ANIM, CANDY, VOLLEY,
  ROLLS_META_KEY, ROLLS_ATTRIBUTE, FRESH_ROLLS, mimicSlot, mimicItem, rollsOn, ensureRolls, spendRoll, rollsForOpen,
  casketState, initializeCasket, rewardState, markDefeated };
