"use strict";

/**
 * Shared Kraken ids and helpers (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Ids are api.core.NpcIdentifiers (cache gamevals), never bare numbers at use sites.
 * Animations are data/definitions/npc-animations.json: 7135 surfaces cave krakens and the
 * boss, 3860 surfaces a tentacle.
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

function ids() {
  const { NpcIdentifiers: N } = state.core;
  return {
    CAVE_WHIRLPOOL: N.WHIRLPOOL,
    CAVE_KRAKEN: N.CAVE_KRAKEN,
    BOSS_WHIRLPOOL: N.WHIRLPOOL_2,
    BOSS: N.KRAKEN,
    TENTACLE_WHIRLPOOL: N.WHIRLPOOL_3,
    TENTACLE: N.ENORMOUS_TENTACLE,
  };
}

/**
 * Surfacing animations from data/definitions/npc-animations.json (rev 241; the role
 * mapping the loader reads): 7135 surfaces cave krakens and the boss, 3860 a tentacle.
 */
const SURFACE_ANIM = {
  cave: 7135,
  boss: 7135,
  tentacle: 3860,
};

/** Whirlpool id -> surfaced id, or null when already surfaced. */
function surfacedFor(whirlpoolId) {
  const { CAVE_WHIRLPOOL, CAVE_KRAKEN, BOSS_WHIRLPOOL, BOSS, TENTACLE_WHIRLPOOL, TENTACLE } = ids();
  if (whirlpoolId === CAVE_WHIRLPOOL) return CAVE_KRAKEN;
  if (whirlpoolId === BOSS_WHIRLPOOL) return BOSS;
  if (whirlpoolId === TENTACLE_WHIRLPOOL) return TENTACLE;
  return null;
}

/** Surfaced ids whose hits only count with Magic (Wiki). */
function isMagicOnlyId(npcId) {
  const { CAVE_KRAKEN, BOSS, TENTACLE } = ids();
  return npcId === CAVE_KRAKEN || npcId === BOSS || npcId === TENTACLE;
}

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

/**
 * Whether the player's Slayer task covers this cove monster (Wiki: every creature in the
 * cove can only be killed on a Kraken or cave kraken task). The tentacles belong to the
 * Kraken fight but carry no task of their own, so they are asked about as the boss.
 */
function onTask(player, npc) {
  const { BOSS, TENTACLE } = ids();
  const npcId = npc?.getId?.() === TENTACLE ? BOSS : npc?.getId?.();
  const request = { player, npc, npcId, location: npc?.getLocation?.(), onTask: false };
  state.api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

module.exports = { bind, api, core, ids, surfacedFor, isMagicOnlyId, alive, onTask, SURFACE_ANIM };
