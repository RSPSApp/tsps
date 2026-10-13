/**
 * Shared Araxxor constants and pure combat math.
 *
 * Behaviour: https://oldschool.runescape.wiki/w/Araxxor and
 * https://oldschool.runescape.wiki/w/Araxxor/Strategies (attack pattern, egg hatching,
 * specials, enrage, corpse harvest/destroy, max hits, prayers), checked against rsprox
 * captures (below).
 *
 * Ids from the cache (rev 241): NPCs 13668 (Araxxor, 7x7) / 13669 (corpse, Harvest+Destroy)
 * / eggs 13670 (Mirrorback), 13672 (Ruptura), 13674 (Acidic), all 2x2 / minions 13671, 13673,
 * 13675 (2x2) / 13676 (the 3x3 acid ball). Object 54148 is the acid pool (shape 10, rotation 0).
 * Animations as captured (gamevals in brackets): 11482 spawn, 11480 melee, 11479 magic
 * (projectile 1622), 11493 ranged (acid_cannon_01, projectile 2360), 11476 acid ball throw
 * (attack_ranged_01), 11478 acid spray, 11477 acid leak, 11491 ball rolling, 11492 ball burst,
 * 11487 cleave (with the "Skree!" say), 11488/11489 enrage, 11481 death, 11486 corpse sink,
 * 11506 egg settle, 11503 hatch, 11508 egg crumble, 11498 Acidic attack (projectile 1560),
 * 11500 Mirrorback attack, 11510 Mirrorback death, 11504 Ruptura/Acidic explode. Graphics
 * 2927/2928/2929 are the Acidic/Ruptura/Mirrorback hatch marks, 2925 the Ruptura explosion,
 * 2926 the Acidic death spray, 1626 the venom drip on the player.
 *
 * Checked against rsprox captures (https://rsprox.net/database; 21 normal-world recordings,
 * rev 224 and 237; facts in docs/araxxor.md): spawn tiles, the every-6-tick attack cadence,
 * the special that replaces every seventh attack, the hatch 3 ticks after the 3rd standard and
 * every 6th after, each attack's animation, projectile and sound, the ball, spray, drip and
 * cleave pools, the flat 4-5 venom a tick in acid, the enrage at 25%, and the death at +5 ticks
 * into the corpse. Still unverified: the destroy clue roll.
 */
const SIZE = 7;
const MAX_HITPOINTS = 1020;

const BOSS_ID = 13668;
const CORPSE_ID = 13669;
const BALL_ID = 13676;
const ACID_POOL_OBJECT = 54148;

const EGG_ID = Object.freeze({ mirrorback: 13670, ruptura: 13672, acidic: 13674 });
const MINION_ID = Object.freeze({ mirrorback: 13671, ruptura: 13673, acidic: 13675 });
const HATCH_GFX = Object.freeze({ mirrorback: 2929, ruptura: 2928, acidic: 2927 });

/** Boss tile and the middle of its 7x7 body there, as every captured spawn places them. */
const SPAWN_TILE = [3631, 9814, 0];
const CENTRE_TILE = [3634, 9817];
/**
 * The nine eggs' south-west tiles (they are 2x2) in hatch order, as captured in every fight:
 * first the south-easternmost, then clockwise. The first egg's colour picks the fight's
 * special, so pattern[0] is the SE egg.
 */
const EGG_TILES = Object.freeze([
  [3643, 9805], [3637, 9802], [3630, 9803],
  [3625, 9806], [3620, 9813], [3621, 9822],
  [3629, 9827], [3637, 9827], [3644, 9823],
]);
/** Captured: each egg's tiles are blocked by an invisible 2x2 loc a tick after it is laid,
 * swapped for the non-blocking one when it hatches. */
const EGG_BLOCKING_OBJECT = 47348;
const EGG_HATCHED_OBJECT = 29733;

/** The lair interior: entering it grows the per-player instance, leaving destroys it.
 * The east wall's web tile (3655) stays outside, so the tunnel decides entry. */
const LAIR = Object.freeze({ minX: 3615, maxX: 3654, minY: 9797, maxY: 9835 });

/** The three fixed egg patterns; the first egg's type picks the special for the fight. */
const PATTERNS = Object.freeze([
  ["acidic", "mirrorback", "ruptura", "acidic", "mirrorback", "ruptura", "acidic", "mirrorback", "ruptura"],
  ["mirrorback", "ruptura", "acidic", "mirrorback", "ruptura", "acidic", "mirrorback", "ruptura", "acidic"],
  ["ruptura", "acidic", "mirrorback", "ruptura", "acidic", "mirrorback", "ruptura", "acidic", "mirrorback"],
]);

/** Attack cadence: standards every 6 ticks; every 7th attack cycle becomes the special. */
const ATTACK_SPEED_TICKS = 6;
const ENRAGED_SPEED_TICKS = 4;
const SPECIAL_EVERY_ATTACKS = 7;
/** Wiki: the first egg hatches after 3 standards, then every 6 standards; captured 3 ticks
 * after the standard that triggers it. */
const FIRST_HATCH_STANDARDS = 3;
const HATCH_INTERVAL_STANDARDS = 6;
const HATCH_DELAY_TICKS = 3;
/** Captured: the boss and eggs appear five ticks after the tunnel's message box closes. */
const SPAWN_DELAY_TICKS = 5;
/** Captured: boss + eggs spawn together, first attack 6 ticks after the spawn animation. */
const ARM_TICKS = 6;
/** Fires from up to 10 tiles like Vorkath; melee only when edge-adjacent (checked in start). */
const ATTACK_DISTANCE = 10;

const MELEE_MAX = 38;
const MAGIC_MAX = 21;
const RANGED_MAX = 34;
/** Protect prayers (Wiki): melee caps at 5, missiles -45%, magic -50%, cleave -66%. */
const PROTECT_MELEE_CAP = 5;
const PROTECT_RANGED_FACTOR = 0.55;
const PROTECT_MAGIC_FACTOR = 0.5;
const CLEAVE_PROTECT_FACTOR = 0.34;
/** Wiki step-under: baiting him onto his own tiles hits him for 8-12. */
const CLEAVE_SELF_MIN = 8;
const CLEAVE_SELF_MAX = 12;
/** A living Mirrorback redirects a fifth of boss damage to itself, half of that back (Wiki). */
const MIRRORBACK_REDIRECT_FACTOR = 0.2;
const MIRRORBACK_RECOIL_FACTOR = 0.5;
/** On-hit drains (Wiki): a ranged hit drains 9% defence, a magic hit 9% prayer. */
const DRAIN_RANGED_DEFENCE = 0.09;
const DRAIN_MAGIC_PRAYER = 0.09;

const ENRAGE_THRESHOLD = 0.25;

/** Minions: 58 HP each (cache); Ruptura bursts for these (cache + captures). */
const MINION_HITPOINTS = 58;
const EGG_HITPOINTS = 65;
const MINION_MAX = 15;
/** Ruptura bursts by edge distance (Wiki): player 70/49/28/7, enemies 80/64/48/33. */
const RUPTURA_PLAYER_DAMAGE = [70, 49, 28, 7];
const RUPTURA_BOSS_DAMAGE = [80, 64, 48, 33];

/** Captured: the ball steps two tiles a tick until the next step is blocked (no range cap). */
const BALL_STEP_TILES = 2;
const BALL_SIZE = 3;
/** Captured: the ball lands on the player for 14-18 venom, a tick after it appears. */
const BALL_DAMAGE_MIN = 14;
const BALL_DAMAGE_MAX = 18;
/** Captured: the burst throws six blobs within two tiles of the ball's middle. */
const BALL_BURST_COUNT = 6;
const BALL_BURST_SPREAD = 2;
const SPLATTER_COUNT = 9;
/** Captured: the acidic death explodes into 13 blobs within four tiles of it. */
const ACIDIC_DEATH_SPLATTER_COUNT = 13;
const ACIDIC_DEATH_SPREAD = 4;
/** Estimated blob-landing damage: the Wiki says the splatter damages ("low venom damage")
 * before the pool forms; the captures show small player hits on impact ticks. */
const SPLAT_IMPACT_DAMAGE = 8;

/** Captured projectiles: { id, start, end (fixed, or base + perTile), heights, angle, progress }. */
const PROJECTILE = Object.freeze({
  ranged: Object.freeze({ id: 2360, start: 30, end: 120, startHeight: 296, endHeight: 50, angle: 35, progress: 0 }),
  magic: Object.freeze({ id: 1622, start: 30, end: 120, startHeight: 69, endHeight: 50, angle: 35, progress: 62 }),
  /** The acid spray: end 100 + 10 per tile from the boss's middle (130-160 captured). */
  spray: Object.freeze({ id: 2924, start: 30, base: 100, perTile: 10, startHeight: 170, endHeight: 0, angle: 35, progress: 200 }),
  drip: Object.freeze({ id: 2924, start: 30, end: 120, startHeight: 170, endHeight: 30, angle: 35, progress: 200 }),
  /** The acidic araxyte's death splash: end 90 + 10 per tile (110-130 captured). */
  acidicDeath: Object.freeze({ id: 2924, start: 30, base: 90, perTile: 10, startHeight: 140, endHeight: 0, angle: 35, progress: 20 }),
  /** The ball's burst: end 90 + 10 per tile (100-110 captured). */
  ballBurst: Object.freeze({ id: 2924, start: 30, base: 90, perTile: 10, startHeight: 254, endHeight: 0, angle: 35, progress: 0 }),
  /** The acidic araxyte's spit: end 39 + 10 per tile (49-119 captured). */
  acidic: Object.freeze({ id: 1560, start: 39, base: 39, perTile: 10, startHeight: 32, endHeight: 64, angle: 16, progress: 40 }),
});
/** Captured: ranged and magic land four ticks after the cast, whatever the distance. */
const DISTANT_HIT_TICKS = 4;
/** Captured landing of every blob: the 2923 splat at ground height with the 4135 splash, sent
 * with the cast and delayed to the blob's arrival; the pool appears on the tick it lands. */
const ACID_SPLAT_GFX = 2923;
const ACID_SPLAT_SOUND = 4135;
const RUPTURA_EXPLOSION_GFX = 2925;
const ACIDIC_EXPLOSION_GFX = 2926;
const EXPLODE_ANIMATION = 11504;

/** Captured sounds, as [id, delay]: the melee swing, ranged and magic landings, the ball throw. */
const SOUND = Object.freeze({
  melee: Object.freeze([9413, 40]),
  ranged: Object.freeze([9470, 120]),
  magic: Object.freeze([9479, 120]),
  ball: Object.freeze([9488, 0]),
  acidic: Object.freeze([9378, 25]),
});

/** Captured: standing in acid deals a flat 4-5 venom a tick (runs of 16 ticks never ramp). */
const POOL_DAMAGE_MIN = 4;
const POOL_DAMAGE_MAX = 5;
/** RuneLite HitsplatID.VENOM: the pools, the drip and the ball land as venom splats. */
const VENOM_SPLAT = 5;
/** Captured: the drip lands four ticks after the cast, then the player drips for seven ticks
 * (graphic 1626 each tick), leaving a pool on each tile they stepped through for six. */
const DRIP_GFX = 1626;
const DRIP_TICKS = 7;
const DRIP_MESSAGE = "<col=ff3045>Araxxor covers you in venom. It slowly drips off you and covers the floor.";

/** The corpse waits for the player's choice (Wiki: no respawn until Harvest or Destroy);
 * the cap is a safety net, and leaving the lair destroys it anyway. */
const CORPSE_TICKS = 6000;
const RESPAWN_TICKS = 10;
const HARVEST_ANIMATION = 2282;
const NID_ITEM_ID = 29836;
const ELITE_CLUE_ITEM_ID = 12073;
const DESTROY_PET_RATE = 1500;

const CORPSE_DESTROY_PROMPT =
  "Destroying the corpse will give no loot, but doubles your chance of receiving Nid (1/1500 instead of 1/3000). Are you sure you want to destroy it?";

/**
 * The captured enrage body: slot 0 (54289) becomes 54288, the venom-coated front legs,
 * while slot 1 (54290) stays (sent, as captured). Sent as an npc model customisation.
 */
const ENRAGE_MODELS = Object.freeze([
  Object.freeze({ slot: 0, modelId: 54288 }),
  Object.freeze({ slot: 1, modelId: 54290 }),
]);

function playSound(player, id, delay = 0) {
  player?.getPacketSender?.()?.sendSoundEffect(id, 1, delay);
}

/** A captured [id, delay] sound for the player. */
function playCaptured(player, sound) {
  if (sound) playSound(player, sound[0], sound[1]);
}

/** Projectile end cycle for a captured shape: fixed, or base + perTile x distance. */
function projectileEnd(shape, distance) {
  return shape.end ?? shape.base + shape.perTile * Math.max(1, distance);
}

/** Ticks until a projectile ending at `end` cycles lands (30 cycles a tick). */
function landingTicks(end) {
  return Math.max(1, Math.ceil(end / 30));
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** NPC attribute keys (kebab-case, namespaced). */
const ATTR_ATTACKS = "araxxor:attacks";
const ATTR_STANDARDS = "araxxor:standards";
const ATTR_NEXT_HATCH = "araxxor:next-hatch";
const ATTR_ARMED_AT = "araxxor:armed-at";
const ATTR_ENRAGED = "araxxor:enraged";
const ATTR_DYING = "araxxor:dying";
const ATTR_ENCOUNTER = "araxxor:encounter";
const ATTR_SPECIAL = "araxxor:special";
const ATTR_DESTROY_NO_PROMPT = "araxxor:destroy-no-prompt";
/** Player attribute keys: the kill count and best fight time (ticks), persisted. */
const ATTR_KILLS = "araxxor:kills";
const ATTR_BEST_TICKS = "araxxor:best-ticks";

const Attack = { MELEE: "melee", RANGED: "ranged", MAGIC: "magic", CLEAVE: "cleave" };

/**
 * The special for the primary araxyte (the first egg in the pattern): Acidic throws the
 * rolling ball, Mirrorback splatters acid onto the player, Ruptura drips a chasing pool.
 */
const SPECIAL_FOR_PRIMARY = Object.freeze({
  acidic: "ball",
  mirrorback: "splatter",
  ruptura: "drip",
});

/** Edge-to-edge Chebyshev distance between the 7x7 body and a 1x1 target. */
function edgeDistance(bossX, bossY, x, y) {
  const maxX = bossX + SIZE - 1;
  const maxY = bossY + SIZE - 1;
  const dx = x < bossX ? bossX - x : x > maxX ? x - maxX : 0;
  const dy = y < bossY ? bossY - y : y > maxY ? y - maxY : 0;
  return Math.max(dx, dy);
}

function underBoss(bossX, bossY, x, y) {
  return x >= bossX && x < bossX + SIZE && y >= bossY && y < bossY + SIZE;
}

function tileKey(x, y) {
  return `${x},${y}`;
}

/**
 * The nine splatter tiles around a point. Without a direction: offsets -3..2 on both axes
 * (Near-Reality's getAcidSplatterLocation, the acidic spider's death splash). With a
 * direction (dx, dy): a random spray biased outward along it - the Wiki's acid spray,
 * "sprays randomly outward in the player's general direction".
 */
function splatterTiles(x, y, isWalkable, direction = null, count = SPLATTER_COUNT, spread = null) {
  const tiles = [];
  const dx = direction ? Math.sign(direction.x) : 0;
  const dy = direction ? Math.sign(direction.y) : 0;
  for (let index = 0; index < count; index++) {
    let tile;
    if (dx === 0 && dy === 0 && spread != null) {
      tile = [x + randomBetween(-spread, spread), y + randomBetween(-spread, spread)];
    } else if (dx === 0 && dy === 0) {
      const ox = -3 + Math.floor(Math.random() * 6);
      const oy = -3 + Math.floor(Math.random() * 6);
      tile = [x + ox, y + oy];
    } else {
      const along = Math.floor(Math.random() * 5) - 1;
      const lateral = -3 + Math.floor(Math.random() * 7);
      tile = [
        x + dx * along - dy * lateral,
        y + dy * along + dx * lateral,
      ];
    }
    if (tile[0] === x && tile[1] === y) {
      tile[0] += 1;
    }
    tiles.push(tile);
  }
  return isWalkable ? tiles.filter(([tx, ty]) => isWalkable(tx, ty)) : tiles;
}

/**
 * The three cleave pool tiles: the struck tile and one either side, across the blow
 * (captured: a player west or east of her gets a north-south line, north or south of her
 * an east-west one). Standing underfoot (no direction) picks the row.
 */
function cleavePoolTiles(x, y, dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) {
    return [[x, y], [x, y - 1], [x, y + 1]];
  }
  return [[x, y], [x - 1, y], [x + 1, y]];
}

/** Captured: a flat 4-5 a tick, however long the player has stood in acid. */
function poolDamage() {
  return randomBetween(POOL_DAMAGE_MIN, POOL_DAMAGE_MAX);
}

/** A venom hitsplat for `damage`, as the pools, drip and ball land. */
function venomHit(core, damage) {
  return new core.HitDamage(damage, core.HitMask.RED).setSplatTypes(VENOM_SPLAT, VENOM_SPLAT);
}

/** Straight-line walkability from (x0, y0) to (x1, y1), stepping like the engine (diagonal-first). */
function hasClearPath(x0, y0, x1, y1, isWalkable) {
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 64; guard++) {
    if (x === x1 && y === y1) return true;
    x += Math.sign(x1 - x);
    y += Math.sign(y1 - y);
    if (!isWalkable(x, y)) return false;
  }
  return false;
}

module.exports = {
  SIZE,
  MAX_HITPOINTS,
  BOSS_ID,
  CORPSE_ID,
  BALL_ID,
  ACID_POOL_OBJECT,
  EGG_ID,
  MINION_ID,
  HATCH_GFX,
  SPAWN_TILE,
  CENTRE_TILE,
  EGG_TILES,
  EGG_BLOCKING_OBJECT,
  EGG_HATCHED_OBJECT,
  LAIR,
  PATTERNS,
  ATTACK_SPEED_TICKS,
  ENRAGED_SPEED_TICKS,
  SPECIAL_EVERY_ATTACKS,
  FIRST_HATCH_STANDARDS,
  HATCH_INTERVAL_STANDARDS,
  HATCH_DELAY_TICKS,
  SPAWN_DELAY_TICKS,
  ARM_TICKS,
  ATTACK_DISTANCE,
  MELEE_MAX,
  MAGIC_MAX,
  RANGED_MAX,
  PROTECT_MELEE_CAP,
  PROTECT_RANGED_FACTOR,
  PROTECT_MAGIC_FACTOR,
  CLEAVE_PROTECT_FACTOR,
  CLEAVE_SELF_MIN,
  CLEAVE_SELF_MAX,
  MIRRORBACK_REDIRECT_FACTOR,
  MIRRORBACK_RECOIL_FACTOR,
  DRAIN_RANGED_DEFENCE,
  DRAIN_MAGIC_PRAYER,
  ENRAGE_THRESHOLD,
  MINION_HITPOINTS,
  EGG_HITPOINTS,
  MINION_MAX,
  RUPTURA_PLAYER_DAMAGE,
  RUPTURA_BOSS_DAMAGE,
  BALL_STEP_TILES,
  BALL_SIZE,
  BALL_DAMAGE_MIN,
  BALL_DAMAGE_MAX,
  BALL_BURST_COUNT,
  BALL_BURST_SPREAD,
  SPLATTER_COUNT,
  ACIDIC_DEATH_SPLATTER_COUNT,
  ACIDIC_DEATH_SPREAD,
  SPLAT_IMPACT_DAMAGE,
  PROJECTILE,
  DISTANT_HIT_TICKS,
  ACID_SPLAT_GFX,
  ACID_SPLAT_SOUND,
  RUPTURA_EXPLOSION_GFX,
  ACIDIC_EXPLOSION_GFX,
  EXPLODE_ANIMATION,
  SOUND,
  POOL_DAMAGE_MIN,
  POOL_DAMAGE_MAX,
  VENOM_SPLAT,
  DRIP_GFX,
  DRIP_TICKS,
  DRIP_MESSAGE,
  CORPSE_TICKS,
  RESPAWN_TICKS,
  HARVEST_ANIMATION,
  NID_ITEM_ID,
  ELITE_CLUE_ITEM_ID,
  DESTROY_PET_RATE,
  CORPSE_DESTROY_PROMPT,
  ATTR_ATTACKS,
  ATTR_STANDARDS,
  ATTR_NEXT_HATCH,
  ATTR_ARMED_AT,
  ATTR_ENRAGED,
  ATTR_DYING,
  ATTR_ENCOUNTER,
  ATTR_SPECIAL,
  ATTR_DESTROY_NO_PROMPT,
  ATTR_KILLS,
  ATTR_BEST_TICKS,
  ENRAGE_MODELS,
  playSound,
  playCaptured,
  projectileEnd,
  landingTicks,
  randomBetween,
  venomHit,
  Attack,
  SPECIAL_FOR_PRIMARY,
  edgeDistance,
  underBoss,
  tileKey,
  splatterTiles,
  cleavePoolTiles,
  poolDamage,
  hasClearPath,
  _test: {
    edgeDistance,
    underBoss,
    splatterTiles,
    cleavePoolTiles,
    poolDamage,
    hasClearPath,
  },
};
