"use strict";

/**
 * Imps (5007) disappear in a puff of smoke and reappear a short way off (docs/imps.md).
 *
 * Wiki (Imp): "Every 30–120 seconds there is a 25% chance for an imp to disappear into a puff
 * of smoke and teleport a short distance away."
 *
 * rsprox captures (rev 241, local 1001018, 1001418, 1001419): 7 teleports.
 * - The imp leaves its tile with map anim smokepuff (86, height 124) there and sound 1931 (one
 *   loop, range 10), and a second smokepuff marks the tile it lands on, the same tick.
 * - It lands 17 to 20 tiles away (the larger of the x and y offsets; 4 of 7 exactly 20).
 * - 5 of the 7 came on the tick a player's hit on the imp landed (1001418 ticks 2580, 2587,
 *   3332; 1001419 ticks 283, 367), the other 2 with no fight (1001018 tick 306, 1001418 tick
 *   1291). The imp drops the fight; the player chases it (1001418 2580-2587).
 *
 * Ours:
 * - The chance on a hit, 1 in 6: the recordings have 5 teleports in about 31 damaging hits on
 *   imps, some of them killing blows. The Wiki doesn't mention hits. It is rolled when the
 *   damage lands, if the imp lives through it.
 * - The idle roll runs only for imps a player can see, every 10 ticks: an unseen imp's
 *   teleport can't be told apart from it standing still.
 * - The landing tile is any unblocked, dry tile on the imp's level in that 17-20 tile ring; the
 *   recordings show no wall or water landings.
 * - Only the plain Imp (5007): the God Wars imp (3134) has no recording, and imp_notele (14207)
 *   is the cache's non-teleporting one.
 */

const IMP = "IMP_2"; // NpcIdentifiers.IMP_2 = 5007, gameval imp
const SMOKEPUFF = 86; // smokepuff
const SMOKEPUFF_HEIGHT = 124;
const TELEPORT_SOUND = 1931;
const TELEPORT_SOUND_RADIUS = 10;
const MIN_DISTANCE = 17;
const MAX_DISTANCE = 20;
const TILE_ATTEMPTS = 64;
/** Wiki: every 30-120 seconds (50-200 ticks), a 25% chance. */
const IDLE_MIN_TICKS = 50;
const IDLE_MAX_TICKS = 200;
const IDLE_CHANCE = 0.25;
/** Ours: 5 teleports in about 31 damaging hits (see above). */
const HIT_CHANCE = 1 / 6;
const SCAN_TICKS = 10;
const VIEW_RADIUS = 15;
const GRAPHIC_RADIUS = 32;

let core = null;
let impId = -1;
let ticks = 0;
/** Imp -> the scan tick its next idle roll is due. */
const nextRoll = new WeakMap();

function initialize(api) {
  core = api.core;
  impId = core.NpcIdentifiers[IMP];
}

function isImp(npc) {
  return npc?.isNpc?.() === true && npc.getId() === impId;
}

function canTeleport(npc) {
  return npc.isRegistered() && npc.isVisible() && npc.getHitpoints() > 0 && !npc.isDyingFunction?.()
    && npc.getPrivateArea() == null;
}

/** A random loaded, unblocked, dry tile 17-20 tiles from `from`, or null. */
function landingTile(from) {
  const { Misc, Location, RegionManager } = core;
  for (let attempt = 0; attempt < TILE_ATTEMPTS; attempt++) {
    const dx = Misc.randomInclusive(-MAX_DISTANCE, MAX_DISTANCE);
    const dy = Misc.randomInclusive(-MAX_DISTANCE, MAX_DISTANCE);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < MIN_DISTANCE) continue;
    const tile = new Location(from.getX() + dx, from.getY() + dy, from.getZ());
    if (!RegionManager.getRegion(tile.getX(), tile.getY())) continue;
    if (RegionManager.blocked(tile, null) || RegionManager.isWater(tile)) continue;
    return tile;
  }
  return null;
}

/** Players attacking the imp. */
function fightingPlayers(npc) {
  const players = [];
  for (const player of core.World.getPlayers()) {
    if (player?.getCombat?.().getTarget() === npc) players.push(player);
  }
  return players;
}

/**
 * The core drops a fight whose target moved this tick; live, the player runs after the imp and
 * keeps hitting it (local 1001418 ticks 2580-2587), so they go after it again. Not a player who
 * did something else that tick: walked off, started a teleport, or became untargetable.
 */
function chase(npc, players) {
  if (!canTeleport(npc)) return;
  for (const player of players) {
    if (!player.isRegistered() || player.getHitpoints() <= 0 || player.getCombat().getTarget() != null) continue;
    if (player.isTeleportingReturn() || player.isUntargetable() || player.getMovementQueue().size() > 0) continue;
    player.getCombat().attack(npc);
  }
}

function smokepuff(tile) {
  const graphic = core.Graphic.atHeight(SMOKEPUFF, SMOKEPUFF_HEIGHT);
  core.World.forEachNetworkPlayer((player) => {
    if (player.getPrivateArea() == null && player.getLocation().isWithinDistance(tile, GRAPHIC_RADIUS)) {
      player.getPacketSender().sendGraphic(graphic, tile);
    }
  });
}

/** Puff of smoke, sound, and the imp is elsewhere. Returns whether it moved. */
function teleportImp(npc) {
  if (!canTeleport(npc)) return false;
  const from = npc.getLocation().clone();
  const to = landingTile(from);
  if (!to) return false;
  const chasers = fightingPlayers(npc);
  npc.getCombat().reset();
  npc.getMovementQueue().reset();
  npc.moveTo(to);
  if (chasers.length) core.TaskManager.submit(new core.CountdownTask(npc, 1, () => chase(npc, chasers)));
  smokepuff(from);
  smokepuff(to);
  core.Sounds.playAreaSound({
    soundId: TELEPORT_SOUND, x: from.getX(), y: from.getY(), level: from.getZ(), loops: 1,
    radius: TELEPORT_SOUND_RADIUS, source: npc,
  });
  return true;
}

/** 50-200 ticks, uniformly. */
function idleDelay() {
  return IDLE_MIN_TICKS + Math.floor(Math.random() * (IDLE_MAX_TICKS - IDLE_MIN_TICKS + 1));
}

/** When the hit's damage lands and the imp lives through it, it may be sent away. */
function damageLanded(npc, taken) {
  if (taken > 0 && npc.getHitpoints() > 0 && Math.random() < HIT_CHANCE) teleportImp(npc);
}

/** Each damaging hit on an imp rolls on the tick its damage lands. */
function hitResolved({ target, hit }) {
  if (!isImp(target)) return;
  for (const damage of hit?.getHits?.() ?? []) {
    if (damage?.getDamage?.() > 0) damage.onApplied((taken) => damageLanded(target, taken));
  }
}

/** The Wiki's idle roll, for the imps players can see. */
function scan() {
  ticks += SCAN_TICKS;
  const seen = new Set();
  core.World.forEachNetworkPlayer((player) => {
    if (player.getPrivateArea() != null) return;
    for (const npc of core.World.getNpcsNear(player.getLocation(), VIEW_RADIUS, null)) {
      if (isImp(npc)) seen.add(npc);
    }
  });
  for (const npc of seen) {
    const due = nextRoll.get(npc);
    if (due === undefined) {
      nextRoll.set(npc, ticks + idleDelay());
      continue;
    }
    if (ticks < due) continue;
    nextRoll.set(npc, ticks + idleDelay());
    if (Math.random() < IDLE_CHANCE) teleportImp(npc);
  }
}

function start() {
  core.TaskManager.submit(new (class ImpTeleportTask extends core.Task {
    constructor() {
      super(SCAN_TICKS, false);
    }

    execute() {
      scan();
    }
  })());
}

module.exports = {
  name: "Imps",
  description: "Imps teleport away in a puff of smoke, when hit and every 30-120 seconds.",
  register(api) {
    initialize(api);
    api.onCombatHitResolved(hitResolved);
    api.onServerStartup(start);
  },
  _test: { teleportImp, hitResolved, damageLanded, scan, landingTile, nextRoll, constants: { MIN_DISTANCE, MAX_DISTANCE, SMOKEPUFF, TELEPORT_SOUND } },
};
