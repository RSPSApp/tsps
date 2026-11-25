"use strict";

/**
 * Disturbing Kraken whirlpools (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Wiki (Kraken): to start the fight, use a fishing explosive on the large whirlpool (496)
 * or disturb the four whirlpools around it (5534) first. Only when
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
// RSProx 237/1150 t11209 and t11318; 237/1151 t3538 and t3623.
const THROW_ANIM = 385; // human_throw
const THROW_SPOTANIM = 50; // vial_launch
const THROW_SPOTANIM_HEIGHT = 96;
const THROW_PROJECTILE = 49; // vial_travel
const THROW_SOUND = 2379;
const THROW_LAUNCH_CYCLES = 28;
const THROW_END_BASE_CYCLES = 46;
const THROW_CYCLES_PER_TILE = 35;
// PacketSender multiplies projectile heights by four.
const THROW_PROJECTILE_START_HEIGHT = 163 / 4;
const THROW_PROJECTILE_ANGLE = 50;
const THROW_PROJECTILE_PROGRESS = 32;
const TENTACLE_RISE_AFTER_IMPACT = 2;
const BOSS_RISE_AFTER_TENTACLES = 2;
const RISE_ATTACK_DELAY = 1;
/** Estimate (no capture yet): disturbing the boss early does nothing. */
const BOSS_DISTURB_TOO_EARLY = "Nothing happens.";

function sameArea(player, npc) {
  return player?.getPrivateArea?.() === npc?.getPrivateArea?.();
}

function surface(npc, surfacedId, animId, player, attackDelay = 0) {
  const { Animation } = Shared.core();
  npc.setNpcTransformationId(surfacedId);
  npc.performAnimation(new Animation(animId));
  if (Shared.alive(player) && Shared.alive(npc)) {
    try {
      const combat = npc.getCombat?.();
      if (attackDelay) combat?.extendAttackDelay(attackDelay);
      combat?.attack?.(player);
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

function wakeNearbyTentacles(bossNpc, player, attackDelay = 0) {
  const { TENTACLE } = Shared.ids();
  const { SURFACE_ANIM } = Shared;
  for (const other of whirlpoolsNear(bossNpc.getLocation?.(), bossNpc.getPrivateArea?.())) {
    surface(other, TENTACLE, SURFACE_ANIM.tentacle, player, attackDelay);
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

// Each target accepts one explosive until its wake finishes.
const pendingWakes = new Map();

function cancelExplosiveWake(player) {
  for (const [target, wake] of pendingWakes) {
    if (wake.player === player && !wake.tentaclesUp) pendingWakes.delete(target);
  }
}

/** Fishing explosive on the large whirlpool. Cave krakens still only surface via Disturb. */
function explosive({ player, target, item, itemId, slot }) {
  const { BOSS, BOSS_WHIRLPOOL } = Shared.ids();
  const { Animation, Graphic, Projectile, ItemIdentifiers } = Shared.core();
  const { FISHING_EXPLOSIVE, FISHING_EXPLOSIVE_2 } = ItemIdentifiers;
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
  const inventory = player.getInventory();
  if (!item || inventory.get(slot) !== item || item.getId() !== itemId || item.getAmount() < 1) return true;

  const startingRoom = target.getPrivateArea?.();
  const startingArea = player.getArea();
  const wake = { player, tentaclesUp: false };
  pendingWakes.set(target, wake);
  inventory.deleteAtSlot(slot, 1);
  const endCycles = Projectile.arrivalCycles(player, target, THROW_END_BASE_CYCLES, THROW_CYCLES_PER_TILE);
  player.performAnimation(new Animation(THROW_ANIM));
  player.performGraphic(Graphic.atHeight(THROW_SPOTANIM, THROW_SPOTANIM_HEIGHT));
  Projectile.createProjectile(player, target, THROW_PROJECTILE, THROW_LAUNCH_CYCLES, endCycles,
    THROW_PROJECTILE_START_HEIGHT, 0).withAngle(THROW_PROJECTILE_ANGLE)
    .withProgress(THROW_PROJECTILE_PROGRESS).sendProjectile();
  player.getPacketSender().sendSoundEffect(THROW_SOUND, 1, endCycles, 1);

  // The samples at 3, 8 and 10 tiles support this landing-relative estimate.
  const tentacleRise = Math.ceil(endCycles / 30) + TENTACLE_RISE_AFTER_IMPACT;
  const canWake = () => Shared.alive(target) && target.getId() === BOSS_WHIRLPOOL
    && !startingRoom?.isDestroyed?.() && target.getPrivateArea() === startingRoom;
  later(tentacleRise, () => {
    if (pendingWakes.get(target) !== wake) return;
    if (!canWake() || !Shared.alive(player) || !sameArea(player, target) || player.getArea() !== startingArea) {
      pendingWakes.delete(target);
      return;
    }
    wake.tentaclesUp = true;
    wakeNearbyTentacles(target, player, RISE_ATTACK_DELAY);
    later(BOSS_RISE_AFTER_TENTACLES, () => {
      pendingWakes.delete(target);
      if (canWake()) {
        const disturber = sameArea(player, target) && player.getArea() === startingArea ? player : null;
        surface(target, BOSS, Shared.SURFACE_ANIM.boss, disturber, RISE_ATTACK_DELAY);
      }
    });
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

module.exports = { attach, disturb, explosive, bossReady, npcRoute, BOSS_WAKE_RADIUS, DISTURB_RANGE, cancelExplosiveWake };
