/**
 * Vorkath's two alternating specials plus the per-cycle fight engine.
 *
 * Acid/rapid-fire: pools land 3 ticks after the cast (object 32000), then 25 rapid
 * dragonbreath shots chase the player's current tile, one per tick, hitting only a player
 * still standing there (25-41, protection ignored). Standing in acid hits 1-10 and heals
 * Vorkath the same amount; all incoming damage is halved throughout (Wiki).
 *
 * Freeze/zombified spawn: icy breath freezes, a 38-HP spawn lands 8 tiles out and walks
 * in, exploding for up to 60 by remaining HP. Vorkath takes no damage until it resolves;
 * Crumble Undead (handled in Combat.Vorkath.js) ends it instantly (Wiki).
 */
const Shared = require("./Shared.Vorkath");
const CombatAchievements = require("./CombatAchievements.Vorkath");

const ACID_ANIMATION = 7957;
const HIGH_ANIMATION = 7960;
const BREATH_ANIMATION = 7952;

const ACID_PROJECTILE = 1483;
const RAPID_PROJECTILE = 1482;
const ICE_PROJECTILE = 395;
const SPAWN_PROJECTILE = 1484;

const RAPID_IMPACT_GFX = 131;
const RAPID_IMPACT_HEIGHT = 30;
const FREEZE_GFX = 369;
const SPAWN_EXPLOSION_GFX = 1460;

const SPAWN_KILLED_MESSAGE = "<col=229628>You become unfrozen as you kill the spawn.</col>";
const FROZEN_MESSAGE = "<col=ff3045>You have been frozen!</col>";
const WALKABLE_MASK = 0x1280100;

let api = null;
let core = null;
let CombatFactory = null;

/** Live fights by NPC: pools, rapid-fire progress, spawn ref and fighter. */
const fights = new Map();

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

function later(ticks, target, execFunc) {
  class DelayedTask extends core.Task {
    constructor() {
      super(Math.max(1, ticks), target, false);
    }

    execute() {
      this.stop();
      execFunc();
    }
  }
  core.TaskManager.submit(new DelayedTask());
}

function getFight(npc) {
  let fight = fights.get(npc);
  if (!fight) {
    fight = { pools: new Map(), rapidFired: 0, rapidNextCycle: 0, acidEndCycle: 0, spawn: null, fighter: null, exploding: false };
    fights.set(npc, fight);
  }
  return fight;
}

function isWalkable(x, y) {
  return (core.RegionManager.getClipping(x, y, 0, null) & WALKABLE_MASK) === 0;
}

function poolKey(x, y) {
  return Shared.tileKey(x, y);
}

/**
 * Tile-targeted shots use the captured flight values (delay, duration, arc), with
 * heights quartered like DoomShared does: this engine's height params run 4x
 * below capture units. They leave from her middle, not the corner of her 7x7 body.
 */
function sendTileProjectile(npc, tile, projectileId, flight) {
  new core.Projectile(
    core.Projectile.centreOf(npc),
    new core.Location(tile.x, tile.y, npc.getLocation().getZ()),
    null,
    projectileId,
    flight.delay,
    flight.duration,
    flight.startHeight,
    flight.endHeight,
    npc.getPrivateArea(),
  ).withAngle(flight.angle).sendProjectile();
}

const ACID_LOB_FLIGHT = { delay: 32, duration: 90, angle: 46, startHeight: 85, endHeight: 0 };
const RAPID_FLIGHT = { delay: 0, duration: 30, angle: 22, startHeight: 35, endHeight: 8 };
const SPAWN_FLIGHT = { delay: 32, duration: 120, angle: 46, startHeight: 85, endHeight: 0 };

function globalGraphic(npc, gfxId, height, tile) {
  return Shared.tileGraphic(core, npc, gfxId, height, tile);
}

function damagePlayer(player, amount) {
  if (!alive(player) || amount <= 0) return;
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(amount, core.HitMask.RED)]);
}

function healNpc(npc, amount) {
  if (!alive(npc) || amount <= 0) return;
  npc.setHitpoints?.(Math.min(Shared.MAX_HITPOINTS, (npc.getHitpoints?.() ?? 0) + amount));
}

function unfreeze(player) {
  if (!player?.isRegistered?.()) return;
  player.getTimers?.().cancel?.(core.TimerKey.FREEZE);
  player.getTimers?.().cancel?.(core.TimerKey.FREEZE_IMMUNITY);
}

function liveTarget(npc) {
  const target = npc.getCombat?.().getTarget?.();
  return alive(target) ? target : null;
}

function startAcid(npc, target) {
  npc.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_ACID);
  npc.performAnimation(new core.Animation(ACID_ANIMATION));
  Shared.playSound(target, Shared.SOUND.ACID_LAUNCH, 20);
  const fight = getFight(npc);
  fight.fighter = target;
  CombatAchievements.acidStarted(target);
  fight.rapidFired = 0;
  const now = core.World.getProcessCycle();
  fight.rapidNextCycle = now + Shared.ACID_FIRST_SHOT_DELAY;
  fight.acidEndCycle = now + Shared.ACID_FORCE_END_TICKS;
  const base = npc.getLocation();
  const position = target.getLocation();
  const tiles = Shared.acidPoolTiles(
    base.getX(), base.getY(), position.getX(), position.getY(),
    isWalkable, (n) => core.Misc.getRandom(n),
  );
  for (const [x, y] of tiles) {
    sendTileProjectile(npc, { x, y }, ACID_PROJECTILE, ACID_LOB_FLIGHT);
  }
  later(Shared.ACID_POOL_LAND_DELAY, target, () => {
    if (!alive(npc) || (npc.getAttribute(Shared.ATTR_PHASE) ?? null) !== Shared.PHASE_ACID) return;
    const area = npc.getPrivateArea?.() ?? null;
    if (area?.isDestroyed?.() === true) return;
    for (const [x, y] of tiles) {
      const object = new core.GameObject(
        Shared.ACID_POOL_OBJECT, new core.Location(x, y, 0), 10, core.Misc.getRandom(3), area,
      );
      core.ObjectManager.register(object, true);
      area?.add?.(object);
      fight.pools.set(poolKey(x, y), object);
      Shared.areaSound(npc, Shared.SOUND.ACID_POOL, { x, y }, Shared.SOUND_RANGE.ACID_POOL);
    }
  });
}

function tickAcid(npc, fight) {
  const now = core.World.getProcessCycle();
  if (now >= fight.acidEndCycle) {
    endAcid(npc, fight);
    return;
  }
  const target = liveTarget(npc);
  if (!target) {
    endAcid(npc, fight);
    return;
  }
  if (fight.rapidFired < Shared.ACID_RAPID_SHOTS && now >= fight.rapidNextCycle) {
    const location = target.getLocation();
    const tile = { x: location.getX(), y: location.getY() };
    sendTileProjectile(npc, tile, RAPID_PROJECTILE, RAPID_FLIGHT);
    Shared.playSound(target, Shared.SOUND.RAPID_LAUNCH, 2);
    later(1, target, () => {
      // Captured on the landing tile, hit or miss: graphic 131 at height 30 and area sound 158.
      if (alive(npc)) {
        globalGraphic(npc, RAPID_IMPACT_GFX, RAPID_IMPACT_HEIGHT, tile);
        Shared.areaSound(npc, Shared.SOUND.RAPID_IMPACT, tile, Shared.SOUND_RANGE.RAPID_IMPACT);
      }
      if (!alive(target)) return;
      const current = target.getLocation();
      if (current.getX() !== tile.x || current.getY() !== tile.y) return;
      const rapid = Shared.RAPID_MIN + core.Misc.getRandom(Shared.RAPID_MAX - Shared.RAPID_MIN);
      damagePlayer(target, rapid);
      CombatAchievements.specialDamage(target, rapid, { acid: true });
    });
    fight.rapidFired += 1;
    fight.rapidNextCycle = now + 1;
    if (fight.rapidFired >= Shared.ACID_RAPID_SHOTS) {
      endAcid(npc, fight);
      return;
    }
  }
  const players = npc.getPlayersWithinDistance(25);
  for (const player of players) {
    if (!alive(player)) continue;
    const position = player.getLocation();
    if (!fight.pools.has(poolKey(position.getX(), position.getY()))) continue;
    const damage = Shared.POOL_MIN + core.Misc.getRandom(Shared.POOL_MAX - Shared.POOL_MIN);
    damagePlayer(player, damage);
    CombatAchievements.specialDamage(player, damage, { acid: true });
    healNpc(npc, damage);
  }
}

function endAcid(npc, fight) {
  for (const object of fight.pools.values()) {
    core.ObjectManager.deregister(object, true);
  }
  fight.pools.clear();
  if ((npc.getAttribute?.(Shared.ATTR_PHASE) ?? null) === Shared.PHASE_ACID) {
    if (fight.fighter) CombatAchievements.acidEnded(fight.fighter);
    npc.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_ACTIVE);
  }
}

function pickSpawnTile(npc, target) {
  const position = target.getLocation();
  const base = npc.getLocation();
  const bossX = base.getX();
  const bossY = base.getY();
  for (const distance of [Shared.SPAWN_LAND_DISTANCE, 7, 9, 6, 10]) {
    const candidates = [];
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dy = -distance; dy <= distance; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
        const x = position.getX() + dx;
        const y = position.getY() + dy;
        if (Shared.underBoss(bossX, bossY, x, y) || !isWalkable(x, y)) continue;
        if (!Shared.hasClearPath(x, y, position.getX(), position.getY(), bossX, bossY, isWalkable)) continue;
        candidates.push([x, y]);
      }
    }
    if (candidates.length > 0) {
      return candidates[core.Misc.getRandom(candidates.length - 1)];
    }
  }
  return null;
}

function startSpawn(npc, target) {
  npc.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_SPAWN);
  npc.performAnimation(new core.Animation(BREATH_ANIMATION));
  const fight = getFight(npc);
  fight.fighter = target;
  fight.spawn = null;
  fight.exploding = false;
  // The ice block (369) goes out with the shot, as captured, so it lands with the freeze.
  const end = Shared.sendShot(core, npc, target, ICE_PROJECTILE, FREEZE_GFX, 0);
  Shared.playShotSounds(target, "ice", end);
  const delay = Shared.shotHitDelay(end);
  later(delay, target, () => {
    if (!alive(npc) || (npc.getAttribute(Shared.ATTR_PHASE) ?? null) !== Shared.PHASE_SPAWN) return;
    if (!alive(target)) {
      endSpawn(npc, fight);
      return;
    }
    CombatFactory.freeze(target, Shared.FREEZE_SECONDS, FROZEN_MESSAGE);
    Shared.playSound(target, Shared.SOUND.FREEZE, 28);
    npc.performAnimation(new core.Animation(HIGH_ANIMATION));
    const tile = pickSpawnTile(npc, target);
    if (!tile) {
      endSpawn(npc, fight);
      return;
    }
    sendTileProjectile(npc, { x: tile[0], y: tile[1] }, SPAWN_PROJECTILE, SPAWN_FLIGHT);
    later(4, target, () => {
      if (!alive(npc) || (npc.getAttribute(Shared.ATTR_PHASE) ?? null) !== Shared.PHASE_SPAWN) return;
      if (!alive(target)) {
        endSpawn(npc, fight);
        return;
      }
      const spawn = core.NPC.create(Shared.SPAWN_ID, new core.Location(tile[0], tile[1], 0));
      spawn.setHitpoints?.(Shared.SPAWN_HITPOINTS);
      spawn.getMovementCoordinator?.().setRadius?.(30);
      // Walks through other NPCs (notably her own 7x7 body): without this a spawn
      // whose path crosses her stalls and her immunity never lifts.
      spawn.setFlag?.(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
      const area = npc.getPrivateArea?.() ?? null;
      if (area?.isDestroyed?.() === true) return;
      area?.add?.(spawn);
      core.World.getAddNPCQueue().push(spawn);
      fight.spawn = spawn;
      Shared.areaSound(npc, Shared.SOUND.SPAWN_LANDS, { x: tile[0], y: tile[1] }, Shared.SOUND_RANGE.SPAWN_LANDS);
      fight.spawnBornCycle = core.World.getProcessCycle();
      spawn.getCombat?.().attack?.(target);
    });
  });
}

function spawnEdgeDistance(spawn, target) {
  const base = spawn.getLocation();
  const pos = target.getLocation();
  const size = Math.max(1, spawn.getSize?.() ?? 1);
  const maxX = base.getX() + size - 1;
  const maxY = base.getY() + size - 1;
  const dx = pos.getX() < base.getX() ? base.getX() - pos.getX()
    : pos.getX() > maxX ? pos.getX() - maxX : 0;
  const dy = pos.getY() < base.getY() ? base.getY() - pos.getY()
    : pos.getY() > maxY ? pos.getY() - maxY : 0;
  return Math.max(dx, dy);
}

function tickSpawn(npc, fight) {
  const target = alive(fight.fighter) ? fight.fighter : null;
  const spawn = fight.spawn;
  if (!target) {
    if (spawn && alive(spawn)) core.World.getRemoveNPCQueue().push(spawn);
    endSpawn(npc, fight);
    return;
  }
  if (!spawn || fight.exploding) return;
  if (!alive(spawn)) {
    endSpawn(npc, fight);
    return;
  }
  // The ice block shows once at impact (like Ancient Barrage), not for the freeze.
  if (spawnEdgeDistance(spawn, target) > 1) {
    // Failsafe: a spawn that never reaches its target (walled off, target gone
    // walkabout) must not hold her immune forever - detonate where it stands.
    if (core.World.getProcessCycle() - (fight.spawnBornCycle ?? 0) > Shared.SPAWN_FUSE_TICKS) {
      finishExplosion(npc, fight, spawn, target);
    }
    return;
  }
  finishExplosion(npc, fight, spawn, target);
}

function finishExplosion(npc, fight, spawn, target) {
  if (fight.exploding) return;
  fight.exploding = true;
  const location = spawn.getLocation();
  globalGraphic(npc, SPAWN_EXPLOSION_GFX, core.GraphicHeight.HIGH, { x: location.getX(), y: location.getY() });
  unfreeze(target);
  const hp = spawn.getHitpoints?.() ?? 0;
  later(1, target, () => {
    if (fight.spawn !== spawn || (npc.getAttribute?.(Shared.ATTR_PHASE) ?? null) !== Shared.PHASE_SPAWN) return;
    const explosion = Shared.spawnExplosionDamage(hp);
    damagePlayer(target, explosion);
    CombatAchievements.specialDamage(target, explosion);
    core.World.getRemoveNPCQueue().push(spawn);
    endSpawn(npc, fight);
  });
}

function spawnDied({ npc }) {
  if (!npc || npc.getId?.() !== Shared.SPAWN_ID) return;
  for (const [boss, fight] of fights) {
    if (fight.spawn !== npc) continue;
    if (alive(fight.fighter)) {
      unfreeze(fight.fighter);
      fight.fighter.sendMessage(SPAWN_KILLED_MESSAGE);
    }
    endSpawn(boss, fight);
    return;
  }
}

function endSpawn(npc, fight) {
  if (alive(fight.fighter)) unfreeze(fight.fighter);
  fight.spawn = null;
  fight.exploding = false;
  if ((npc.getAttribute?.(Shared.ATTR_PHASE) ?? null) === Shared.PHASE_SPAWN) {
    npc.setAttribute(Shared.ATTR_PHASE, Shared.PHASE_ACTIVE);
  }
}

function endFight(npc) {
  const fight = fights.get(npc);
  if (!fight) return;
  for (const object of fight.pools.values()) {
    core.ObjectManager.deregister(object, true);
  }
  fight.pools.clear();
  if (fight.spawn && alive(fight.spawn)) {
    core.World.getRemoveNPCQueue().push(fight.spawn);
  }
  if (alive(fight.fighter)) unfreeze(fight.fighter);
  fights.delete(npc);
}

function tick() {
  for (const [npc, fight] of fights) {
    if (!alive(npc)) {
      endFight(npc);
      continue;
    }
    const phase = npc.getAttribute?.(Shared.ATTR_PHASE) ?? Shared.PHASE_ACTIVE;
    if (phase === Shared.PHASE_ACID) {
      tickAcid(npc, fight);
    } else if (phase === Shared.PHASE_SPAWN) {
      tickSpawn(npc, fight);
    } else if (fight.pools.size === 0 && !fight.spawn) {
      fights.delete(npc);
    }
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  CombatFactory = pluginApi.getCombatFactory();
  class EngineTask extends core.Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      tick();
    }
  }
  core.TaskManager.submit(new EngineTask());
  pluginApi.onNpcDeath(spawnDied);
}

module.exports = {
  attach,
  startAcid,
  startSpawn,
  endAcid,
  endSpawn,
  endFight,
  spawnDied,
  tick,
  fights,
};
