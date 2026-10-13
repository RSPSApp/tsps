/**
 * Shared Vorkath constants and pure combat math.
 *
 * Behaviour: https://oldschool.runescape.wiki/w/Vorkath and
 * https://oldschool.runescape.wiki/w/Vorkath/Strategies (attack pattern, specials, max hits,
 * dragonfire tiers, acid/rapid-fire, zombified spawn, drops), checked against rsprox
 * captures (below).
 *
 * Ids from the cache (rev 241): NPCs 8059 (sleeping, Poke) / 8061 (awake) / 8063 (Zombified
 * Spawn, post-quest; 8062 is the quest twin); Vorkath is 7x7 at 2269,4062 (the captures place her
 * there). Anim 7950 wakes (210 cycles = 7 ticks), 7951 melees,
 * 7952 breathes, 7957 channels acid (900 cycles), 7960 launches high; 7948 flinches (64
 * cycles) and 7949 dies (200 cycles) by length class. Projectiles 1477/1479/393/1470/1471/
 * 395/1481/1483/1482/1484 and graphics 1478/1480/1472/1473/1466/131/369/1460 and the acid
 * object 32000, as captured.
 *
 * Checked against rsprox captures (https://rsprox.net/database; 61 recordings, ~500 fights,
 * most on Leagues V or event worlds, so only Vorkath's own behaviour was taken from them, not
 * damage): the special count, the wake and respawn timing, the attack mix, the acid edge
 * pools, the spawn's landing distance, her projectiles' flights and impacts, the fireball's
 * impact and the breath messages. The ids above all appear in them. Still unverified: acid
 * and rapid-fire damage, the spawn's walk and explosion, and anything marked below.
 */
const SLEEPING_ID = 8059;
/** vorkath_sleeping_noop: what she is while she rises, between the poke and waking. */
const WAKING_ID = 8058;
const AWAKE_ID = 8061;
const SPAWN_ID = 8063;

const SIZE = 7;
const SPAWN_TILE = [2269, 4062, 0];
const TELEPORT_TILE = [2272, 4054];
const MAX_HITPOINTS = 750;
const SPAWN_HITPOINTS = 38;

const ATTACK_SPEED_TICKS = 5;
const ATTACK_DISTANCE = 10;
const STANDARDS_BEFORE_SPECIAL = 6;
/**
 * rsprox captures (496 fights): the first special follows 5 standard attacks, every later one
 * 6. The counter starts at this value on waking.
 */
const FIRST_SPECIAL_HEAD_START = 1;
/** Captured: she turns awake (8061) 7 ticks into the rise and attacks 6 ticks after that. */
const WAKE_TICKS = 7;
const FIRST_ATTACK_TICKS = 13;

const MELEE_MAX = 32;
const RANGED_MAX = 32;
const MAGIC_MAX = 30;
const FIREBALL_MAX = 121;
const RAPID_MIN = 25;
const RAPID_MAX = 41;
const POOL_MIN = 1;
const POOL_MAX = 10;
const SPAWN_EXPLOSION_MAX = 60;

const ACID_POOL_OBJECT = 32000;
const ACID_RAPID_SHOTS = 25;
const ACID_FIRST_SHOT_DELAY = 4;
const ACID_FORCE_END_TICKS = 33;
const ACID_POOL_LAND_DELAY = 3;
const ACID_GRID_ORIGIN = [2262, 4055];
const ACID_GRID_CELLS = 7;
const ACID_CELL_SIZE = 3;
/** The edge pools' first offsets along a side, and how many tiles each may land on. */
const ACID_EDGE_NEAR = 4;
const ACID_EDGE_FAR = 14;
const ACID_EDGE_SPREAD = 3;

const FREEZE_SECONDS = 60;
/** Captured: the spawn lands 8 tiles from the player (297 of 317 spawns). */
const SPAWN_LAND_DISTANCE = 8;
/** Spawn-phase failsafe: detonate in place rather than hold her immune forever. */
const SPAWN_FUSE_TICKS = 60;

/** NPC attribute keys (kebab-case, namespaced). */
const ATTR_ATTACKS = "vorkath:attacks";
const ATTR_NEXT_SPECIAL = "vorkath:next-special";
const ATTR_PHASE = "vorkath:phase";
const ATTR_WAKE_UNTIL = "vorkath:wake-until";
const ATTR_FIRST_ATTACK_AT = "vorkath:first-attack-at";

const PHASE_ACTIVE = "active";
const PHASE_ACID = "acid";
const PHASE_SPAWN = "spawn";

const SPECIAL_ACID = "acid";
const SPECIAL_SPAWN = "spawn";

const Attack = {
  MELEE: "melee",
  RANGED: "ranged",
  MAGIC: "magic",
  DRAGONFIRE: "dragonfire",
  VENOM: "venom",
  PRAYER: "prayer",
  FIREBALL: "fireball",
};

/**
 * One standard attack. Melee only when adjacent. The weights are the rsprox captures' shares
 * (3,734 attacks from range: ranged 30%, magic 24%, dragonfire 15%, venom 11%, fireball 11%,
 * prayer 8%); in melee distance melee takes about 16% (139 of 879) on top of the same mix.
 * `roll(n)` returns 0..n like Misc.getRandom, so tests can pass a stub.
 */
const RANGED_TABLE = [[Attack.RANGED, 30], [Attack.MAGIC, 24], [Attack.DRAGONFIRE, 15],
  [Attack.VENOM, 11], [Attack.FIREBALL, 11], [Attack.PRAYER, 8]];
const MELEE_WEIGHT = 19;

function chooseStandard({ adjacent, roll }) {
  const table = adjacent ? [[Attack.MELEE, MELEE_WEIGHT], ...RANGED_TABLE] : RANGED_TABLE;
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = roll(total - 1);
  for (const [attack, weight] of table) {
    pick -= weight;
    if (pick < 0) return attack;
  }
  return Attack.MAGIC;
}

/**
 * Dragonfire caps before the roll (shaped on the Wiki's dragonfire table): the shield/prayer
 * combination sets the cap, an inaccurate roll drops to the resisted cap, then the potion
 * and the venom/prayer-breath penalty subtract.
 */
function dragonfireCaps({ shield, prayer, potion, variant }) {
  const cap = shield ? 20 : (prayer ? 30 : 80);
  const resistedCap = (shield || prayer) ? cap : 50;
  const reduction = potion === "super" ? 20 : (potion === "antifire" ? 10 : 0);
  const variantPenalty = variant === "normal" ? 0 : 5;
  return { cap, resistedCap, reduction, variantPenalty };
}

/** Fireball damage from one roll: full on the tile, halved adjacent, none further out. */
function fireballDamage(roll, distance) {
  if (distance <= 0) return roll;
  if (distance === 1) return Math.floor(roll / 2);
  return 0;
}

/** Spawn explosion damage from its remaining hitpoints: up to 60 at full health (Wiki). */
function spawnExplosionDamage(hitpoints) {
  const clamped = Math.max(0, Math.min(SPAWN_HITPOINTS, hitpoints));
  return Math.floor((clamped * SPAWN_EXPLOSION_MAX) / SPAWN_HITPOINTS);
}

/**
 * Her shots, as rsprox captures show them: from her head (two tiles from the middle of her
 * 7x7 body toward the target), starting 30 cycles in and landing 70 + 5 cycles a tile later
 * (80 at 2 tiles, 115 at 9), heights 35 to 31, angle 14, progress 128. The impact graphic
 * goes out with the shot, delayed to land with it (height 124; the ice block has none).
 */
const SHOT = Object.freeze({ delay: 30, base: 70, perTile: 5, startHeight: 35, endHeight: 31, angle: 14, progress: 128 });
const SHOT_IMPACT_HEIGHT = 124;

function headTile(core, npc, target) {
  const centre = core.Projectile.centreOf(npc);
  const to = target.getLocation();
  return centre.transform(2 * Math.sign(to.getX() - centre.getX()), 2 * Math.sign(to.getY() - centre.getY()));
}

/** Sends a shot and its impact graphic; returns the flight's end, in client cycles. */
function sendShot(core, npc, target, projectileId, impactGfx, impactHeight = SHOT_IMPACT_HEIGHT) {
  const from = headTile(core, npc, target);
  const end = SHOT.base + SHOT.perTile * from.getDistance(target.getLocation());
  new core.Projectile(
    from, target.getLocation(), target, projectileId, SHOT.delay, end, SHOT.startHeight, SHOT.endHeight,
    npc.getPrivateArea(),
  ).withAngle(SHOT.angle).withProgress(SHOT.progress).sendProjectile();
  if (impactGfx > 0) {
    // Set directly: Graphic's overloads read a delay of 0/50/100 as a height.
    const impact = new core.Graphic(impactGfx);
    impact.delay = end;
    impact.height = impactHeight;
    target.performGraphic(impact);
  }
  return end;
}

/** Captured: the hit (or the freeze) lands floor(flight / 30) ticks after the attack. */
function shotHitDelay(end) {
  return Math.floor((end ?? SHOT.base) / 30);
}

/**
 * Her sounds, from rsprox captures: each shot has its launch sounds (with their delays, in
 * client cycles) and an impact sound timed to the projectile's landing.
 */
const SHOT_SOUNDS = Object.freeze({
  ranged: { launch: [[408, 10], [1965, 20]], impact: 3403 },
  magic: { launch: [[408, 10], [222, 20]], impact: 223 },
  dragonfire: { launch: [[585, 0], [3750, 15]], impact: 156 },
  venom: { launch: [[587, 0], [3750, 15]], impact: 129 },
  prayer: { launch: [[284, 0], [3750, 15]], impact: 135 },
  ice: { launch: [[586, 0], [3750, 15]], impact: 168 },
});
const SOUND = Object.freeze({
  MELEE: 1521,
  FIREBALL_LAUNCH: 1519,
  FIREBALL_IMPACT: 163,
  ACID_LAUNCH: 736,
  ACID_POOL: 3308,
  RAPID_LAUNCH: 3749,
  RAPID_IMPACT: 158,
  PRAYERS_DISABLED: 2675,
  FREEZE: 1784,
  SPAWN_LANDS: 232,
});
/** Area sounds' ranges, in tiles, as captured. */
const SOUND_RANGE = Object.freeze({ FIREBALL_IMPACT: 12, ACID_POOL: 5, RAPID_IMPACT: 12, SPAWN_LANDS: 16 });

function playSound(player, id, delay = 0) {
  player?.getPacketSender?.()?.sendSoundEffect(id, 1, delay);
}

/** The shot's launch sounds and its impact sound, landing with it (`end` cycles). */
function playShotSounds(player, kind, end) {
  const sounds = SHOT_SOUNDS[kind];
  if (!sounds) return;
  for (const [id, delay] of sounds.launch) playSound(player, id, delay);
  playSound(player, sounds.impact, end);
}

/** An area sound on a tile, for the players at her fight. */
function areaSound(npc, id, tile, range) {
  const z = npc.getLocation().getZ();
  for (const viewer of npc.getPlayersWithinDistance(25)) {
    viewer.getPacketSender().sendAreaSound(id, tile.x, tile.y, z, 1, 0, range);
  }
}

/**
 * A graphic on a tile for each player at her fight (once each); returns those players. Its
 * fields are set directly: Graphic's overloads read a height of 30 or 38 as a delay.
 */
function tileGraphic(core, npc, gfxId, height, tile) {
  const viewers = npc.getPlayersWithinDistance(25);
  const at = new core.Location(tile.x, tile.y, npc.getLocation().getZ());
  const gfx = new core.Graphic(gfxId);
  gfx.height = height;
  for (const viewer of viewers) viewer.getPacketSender().sendGraphic(gfx, at);
  return viewers;
}

function tileKey(x, y) {
  return `${x},${y}`;
}

/** True when the tile sits under the 7x7 body anchored at the boss base tile. */
function underBoss(bossX, bossY, x, y) {
  return x >= bossX && x < bossX + SIZE && y >= bossY && y < bossY + SIZE;
}

/**
 * Straight-line walkability from (x0, y0) to (x1, y1), stepping the way the engine
 * does (diagonal first): every tile must be walkable and outside the boss body, so the
 * spawn can actually walk in instead of stalling against her.
 */
function hasClearPath(x0, y0, x1, y1, bossX, bossY, isWalkable) {
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 64; guard++) {
    if (x === x1 && y === y1) return true;
    x += Math.sign(x1 - x);
    y += Math.sign(y1 - y);
    if (underBoss(bossX, bossY, x, y) || !isWalkable(x, y)) return false;
  }
  return false;
}

/**
 * Acid pool tiles: one uniform pick per 3x3 cell of the 7x7 grid around the arena (minus
 * the centre cell), 8 edge tiles in S,S,N,N,W,W,E,E order, then the player's tile.
 * Candidates must be walkable and outside the boss body; `isWalkable(x, y)` is injected.
 * The edge tiles are as rsprox captures place them (297 acid phases): two a side, one tile
 * outside the grid, each on one of three tiles at offsets 4-6 and 14-16 along that side.
 */
function acidPoolTiles(bossX, bossY, playerX, playerY, isWalkable, pick) {
  const [originX, originY] = ACID_GRID_ORIGIN;
  const pools = [];
  const seen = new Set();
  const take = (x, y) => {
    const key = tileKey(x, y);
    if (seen.has(key) || underBoss(bossX, bossY, x, y) || !isWalkable(x, y)) return false;
    seen.add(key);
    pools.push([x, y]);
    return true;
  };
  for (let cx = 0; cx < ACID_GRID_CELLS; cx++) {
    for (let cy = 0; cy < ACID_GRID_CELLS; cy++) {
      if (cx === 3 && cy === 3) continue;
      const candidates = [];
      for (let dx = 0; dx < ACID_CELL_SIZE; dx++) {
        for (let dy = 0; dy < ACID_CELL_SIZE; dy++) {
          const x = originX + cx * ACID_CELL_SIZE + dx;
          const y = originY + cy * ACID_CELL_SIZE + dy;
          if (!seen.has(tileKey(x, y)) && !underBoss(bossX, bossY, x, y) && isWalkable(x, y)) {
            candidates.push([x, y]);
          }
        }
      }
      if (candidates.length > 0) take(...candidates[pick(candidates.length - 1)]);
    }
  }
  const span = ACID_GRID_CELLS * ACID_CELL_SIZE;
  const along = (first) => first + pick(ACID_EDGE_SPREAD - 1);
  for (const [x, y] of [
    [originX + along(ACID_EDGE_NEAR), originY - 1], [originX + along(ACID_EDGE_FAR), originY - 1],
    [originX + along(ACID_EDGE_NEAR), originY + span], [originX + along(ACID_EDGE_FAR), originY + span],
    [originX - 1, originY + along(ACID_EDGE_NEAR)], [originX - 1, originY + along(ACID_EDGE_FAR)],
    [originX + span, originY + along(ACID_EDGE_NEAR)], [originX + span, originY + along(ACID_EDGE_FAR)],
  ]) {
    take(x, y);
  }
  take(playerX, playerY);
  return pools;
}

module.exports = {
  SLEEPING_ID,
  WAKING_ID,
  AWAKE_ID,
  SPAWN_ID,
  SIZE,
  SPAWN_TILE,
  TELEPORT_TILE,
  MAX_HITPOINTS,
  SPAWN_HITPOINTS,
  ATTACK_SPEED_TICKS,
  ATTACK_DISTANCE,
  STANDARDS_BEFORE_SPECIAL,
  FIRST_SPECIAL_HEAD_START,
  WAKE_TICKS,
  FIRST_ATTACK_TICKS,
  MELEE_MAX,
  RANGED_MAX,
  MAGIC_MAX,
  FIREBALL_MAX,
  RAPID_MIN,
  RAPID_MAX,
  POOL_MIN,
  POOL_MAX,
  SPAWN_EXPLOSION_MAX,
  ACID_POOL_OBJECT,
  ACID_RAPID_SHOTS,
  ACID_FIRST_SHOT_DELAY,
  ACID_FORCE_END_TICKS,
  ACID_POOL_LAND_DELAY,
  FREEZE_SECONDS,
  SPAWN_LAND_DISTANCE,
  SPAWN_FUSE_TICKS,
  ATTR_ATTACKS,
  ATTR_NEXT_SPECIAL,
  ATTR_PHASE,
  ATTR_WAKE_UNTIL,
  ATTR_FIRST_ATTACK_AT,
  PHASE_ACTIVE,
  PHASE_ACID,
  PHASE_SPAWN,
  SPECIAL_ACID,
  SPECIAL_SPAWN,
  Attack,
  chooseStandard,
  dragonfireCaps,
  fireballDamage,
  spawnExplosionDamage,
  SHOT,
  SOUND,
  SOUND_RANGE,
  playSound,
  playShotSounds,
  areaSound,
  tileGraphic,
  headTile,
  sendShot,
  shotHitDelay,
  tileKey,
  underBoss,
  hasClearPath,
  acidPoolTiles,
  _test: {
    chooseStandard,
    dragonfireCaps,
    fireballDamage,
    spawnExplosionDamage,
    underBoss,
    hasClearPath,
    acidPoolTiles,
  },
};
