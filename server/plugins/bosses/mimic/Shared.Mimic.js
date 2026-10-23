"use strict";

/**
 * Shared Mimic ids, tiles and candy data (see ../Mimic.plugin.js for behaviour and sources).
 *
 * Ids are api.core.NpcIdentifiers / ObjectIdentifiers / ItemIdentifiers (cache gamevals),
 * never bare numbers at use sites.
 */

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
 * Rolls state, tracked per Mimic item: six chances from a master clue, five from
 * elite (Wiki article); fresh chests default to elite until the clue system
 * tracks origin.
 */
const ROLLS_META_KEY = "mimic-rolls";
const ROLLS_ATTRIBUTE = "mimic:rolls";
const FRESH_ROLLS = 5;

function mimicSlot(player) {
  const slot = player.getInventory?.()?.getSlotForItemId?.(ids().CASKET_ITEM);
  return Number.isInteger(slot) && slot >= 0 ? slot : -1;
}

function mimicItem(player) {
  const slot = mimicSlot(player);
  if (slot < 0) return null;
  const item = player.getInventory?.()?.getItems?.()?.[slot];
  return item?.getId?.() === ids().CASKET_ITEM ? item : null;
}

function rollsOn(item) {
  const rolls = Number(item?.getMetaValue?.(ROLLS_META_KEY)?.rolls);
  return Number.isInteger(rolls) ? rolls : null;
}

/** Fresh chest (or resync): the item and the attribute mirror each other. */
function ensureRolls(player) {
  const item = mimicItem(player);
  if (!item) return null;
  let rolls = rollsOn(item);
  if (rolls === null) {
    rolls = FRESH_ROLLS;
    item.setMetaValue?.(ROLLS_META_KEY, { rolls });
  }
  player.setAttribute?.(ROLLS_ATTRIBUTE, rolls);
  return item;
}

/**
 * Spend one roll (a leave or death with the fight on). At zero the chest
 * disappears. Falls back to the attribute mirror when the chest isn't carried
 * (grave, ground); the mirror is synced wherever the item is touched.
 */
function spendRoll(player) {
  const item = mimicItem(player);
  let rolls = item ? rollsOn(item) : null;
  if (rolls === null) {
    const attr = player.getAttribute?.(ROLLS_ATTRIBUTE);
    rolls = Number.isInteger(attr) ? attr : FRESH_ROLLS;
  }
  const left = Math.max(0, rolls - 1);
  if (item) item.setMetaValue?.(ROLLS_META_KEY, { rolls: left });
  player.setAttribute?.(ROLLS_ATTRIBUTE, left);
  if (left <= 0 && item) {
    player.getInventory?.()?.deleteNumber?.(ids().CASKET_ITEM, 1);
  }
  return left;
}

/** Rolls to pay on open: item and mirror reconciled down (grave/bank drift). */
function rollsForOpen(player) {
  const meta = rollsOn(mimicItem(player));
  const attr = player.getAttribute?.(ROLLS_ATTRIBUTE);
  return Math.min(meta ?? FRESH_ROLLS, Number.isInteger(attr) ? attr : FRESH_ROLLS);
}

module.exports = { bind, core, ids, alive, ARENA, ENTRANCE_TILE, CASKET_TILE, WATSON_TILE, ANIM, CANDY, VOLLEY, ROLLS_META_KEY, ROLLS_ATTRIBUTE, FRESH_ROLLS, mimicSlot, mimicItem, rollsOn, ensureRolls, spendRoll, rollsForOpen };
