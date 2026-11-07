"use strict";

/**
 * Disturbing Kraken whirlpools (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Wiki (Kraken): to start the fight, use a fishing explosive on the large whirlpool (496)
 * (the wake lands 6 ticks after the throw, estimate), or disturb the four whirlpools
 * around it (5534) first — only when
 * all four are disturbed can the larger one be disturbed, waking the Kraken (494) with
 * level 112 Enormous Tentacles (5535). Wiki (Cave kraken): fishing explosives do NOT
 * surface regular cave krakens (493); those are Disturbed normally.
 * Surfacing anims: 7135 (cave/boss), 3860 (tentacle).
 * Surfaced NPCs aggro the disturber at once. Deaths respawn as whirlpools via the engine.
 */

const Shared = require("./Shared.Kraken");

/** Estimate (no capture yet): tentacles woken with the boss. Boss at (2278, 10034), its four whirlpools ~3-9 tiles away. */
const BOSS_WAKE_RADIUS = 10;
/**
 * Estimate (no capture yet): the pools sit in water with no adjacent tile, past the
 * engine's 2-tile water fallback, so Disturb is allowed from Magic distance as long as
 * there is projectile line of sight (the engine's `reached` check enforces both).
 */
const DISTURB_RANGE = 10;
/** Player throw animation (GnomeBall's PLAYER.THROW, 783): no Kraken-specific throw was
 * captured, so the generic throw stands in (estimate). */
const THROW_ANIM = 783;
/** Ticks from throw to wake: throw, splash pause, then emerge as separate beats. */
const THROW_DELAY_TICKS = 6;
/** Estimate (no capture yet): disturbing the boss early does nothing. */
const BOSS_DISTURB_TOO_EARLY = "Nothing happens.";

function sameArea(player, npc) {
  return player?.getPrivateArea?.() === npc?.getPrivateArea?.();
}

function surface(npc, surfacedId, animId, player) {
  const { Animation } = Shared.core();
  npc.setNpcTransformationId(surfacedId);
  npc.performAnimation(new Animation(animId));
  if (Shared.alive(player) && Shared.alive(npc)) {
    try {
      npc.getCombat?.().attack?.(player);
    } catch {
      // Attack best-effort: the wake itself is what matters.
    }
  }
}

/** Tentacle whirlpools (5534) near `at`, in the same area. */
function whirlpoolsNear(at, area) {
  const { TENTACLE_WHIRLPOOL } = Shared.ids();
  let World = null;
  try {
    World = Shared.core().World;
  } catch {
    return [];
  }
  const npcs = World?.getNpcs?.() ?? [];
  const found = [];
  for (const other of npcs) {
    if (!other?.isNpc?.()) continue;
    if (other.getId?.() !== TENTACLE_WHIRLPOOL) continue;
    if (!Shared.alive(other)) continue;
    if (other.getPrivateArea?.() !== area) continue;
    try {
      const loc = other.getLocation?.();
      if (at && loc && typeof at.getDistance === "function" && at.getDistance(loc) > BOSS_WAKE_RADIUS) continue;
    } catch {
      // Distance best-effort; wake on area match alone.
    }
    found.push(other);
  }
  return found;
}

function wakeNearbyTentacles(bossNpc, player) {
  const { TENTACLE } = Shared.ids();
  const { SURFACE_ANIM } = Shared;
  for (const other of whirlpoolsNear(bossNpc.getLocation?.(), bossNpc.getPrivateArea?.())) {
    surface(other, TENTACLE, SURFACE_ANIM.tentacle, player);
  }
}

/** Whether the boss whirlpool may be disturbed: no undisturbed tentacle whirlpool nearby. */
function bossReady(bossNpc) {
  return whirlpoolsNear(bossNpc.getLocation?.(), bossNpc.getPrivateArea?.()).length === 0;
}

/** A league that locks bosses (Shattered Relics) may refuse the fight before it starts. */
function bossLocked(player, bossId) {
  const query = { player, name: Shared.core().NpcDefinition.forId(bossId)?.getName?.(), notify: true, locked: false };
  pluginApi?.emitCustomEvent("league:boss-locked", query);
  return query.locked === true;
}

function disturb({ player, npc }) {
  if (!npc || !Shared.alive(npc)) return false;
  if (!Shared.alive(player)) return false;
  if (!sameArea(player, npc)) return false;
  const npcId = npc.getId?.();
  const surfacedId = Shared.surfacedFor(npcId);
  // Already surfaced (or another Whirlpool variant): nothing to wake.
  if (surfacedId == null) return false;
  const { CAVE_WHIRLPOOL, BOSS_WHIRLPOOL, TENTACLE_WHIRLPOOL } = Shared.ids();
  if (npcId === BOSS_WHIRLPOOL && bossLocked(player, surfacedId)) return true;
  const { SURFACE_ANIM } = Shared;
  if (npcId === CAVE_WHIRLPOOL) {
    surface(npc, surfacedId, SURFACE_ANIM.cave, player);
    return true;
  }
  if (npcId === TENTACLE_WHIRLPOOL) {
    surface(npc, surfacedId, SURFACE_ANIM.tentacle, player);
    return true;
  }
  if (npcId === BOSS_WHIRLPOOL) {
    if (!bossReady(npc)) {
      player.sendMessage(BOSS_DISTURB_TOO_EARLY);
      return true;
    }
    surface(npc, surfacedId, SURFACE_ANIM.boss, player);
    wakeNearbyTentacles(npc, player);
    return true;
  }
  return false;
}

/** Whirlpools with a throw already in the air: further throws are swallowed, not consumed. */
const pendingWakes = new Set();

/**
 * Fishing explosive on the large whirlpool: wakes the Kraken and its tentacles (Wiki).
 * The player throws (783, estimate) and the wake lands a moment later. The explosive
 * is consumed when the wake lands, not on the throw, so spam, logout or death in the
 * window costs nothing (all estimates: consumption, throw anim, delay).
 * Used on anything else kraken it does nothing (Wiki: explosives cannot surface
 * regular cave krakens).
 */
function explosive({ player, target, itemId }) {
  const { BOSS, BOSS_WHIRLPOOL } = Shared.ids();
  const { Animation } = Shared.core();
  const { FISHING_EXPLOSIVE, FISHING_EXPLOSIVE_2 } = Shared.core().ItemIdentifiers;
  if (itemId !== FISHING_EXPLOSIVE && itemId !== FISHING_EXPLOSIVE_2) return;
  if (!target?.isNpc?.() || !Shared.alive(target) || !Shared.alive(player)) return;
  if (!sameArea(player, target)) return;
  if (target.getId?.() !== BOSS_WHIRLPOOL) {
    if (Shared.surfacedFor(target.getId?.()) != null || Shared.isMagicOnlyId(target.getId?.())) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    return;
  }
  if (pendingWakes.has(target)) return true;
  pendingWakes.add(target);
  const startingArea = target.getPrivateArea?.();
  const { SURFACE_ANIM } = Shared;
  player.performAnimation(new Animation(THROW_ANIM));
  later(THROW_DELAY_TICKS, () => {
    pendingWakes.delete(target);
    if (!Shared.alive(target) || target.getId?.() !== BOSS_WHIRLPOOL || !Shared.alive(player)) return;
    if (startingArea?.isKrakenInstance === true
      && (startingArea.isDestroyed() || player.getPrivateArea?.() !== startingArea || target.getPrivateArea?.() !== startingArea)) return;
    player.getInventory()?.deleteNumber?.(itemId, 1);
    surface(target, BOSS, SURFACE_ANIM.boss, player);
    wakeNearbyTentacles(target, player);
  });
  return true;
}

function npcRoute(event) {
  // Ids first: only kraken whirlpools and surfaced forms qualify, before any
  // definition reads. Item-on-NPC routes carry clickType 0: any kraken gets the
  // reach so a misused explosive answers "Nothing interesting happens." instead
  // of a routing error.
  const { CAVE_KRAKEN, BOSS, TENTACLE } = Shared.ids();
  const surfaced = Shared.surfacedFor(event.npcId);
  const isKraken = surfaced != null || event.npcId === CAVE_KRAKEN || event.npcId === BOSS || event.npcId === TENTACLE;
  if (!isKraken) return;
  if (Number.isInteger(event.clickType) && event.clickType >= 1 && event.clickType <= 5) {
    const name = event.definition?.getName?.();
    if (name !== "Whirlpool") return;
    if (event.definition?.getActions?.()?.[event.clickType - 1] !== "Disturb") return;
  }
  event.range = DISTURB_RANGE;
}

function later(ticks, action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(
    new (class extends Task {
      constructor() {
        super(Math.max(1, ticks), null, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

/** Kept for `league:boss-locked` (a custom event needs the api). */
let pluginApi = null;

function attach(api) {
  pluginApi = api;
  api.onNpcInteraction("Whirlpool", { Disturb: disturb });
  api.onNpcRoute(npcRoute);
  api.onItemOnNpc(explosive);
}

module.exports = { attach, disturb, explosive, bossReady, npcRoute, BOSS_WAKE_RADIUS, DISTURB_RANGE, THROW_ANIM, THROW_DELAY_TICKS };
