/**
 * Scurrius' fight (Wiki: Scurrius, Scurrius/Strategies), timed and animated from the rsprox
 * captures (docs/scurrius.md):
 * - phase one: tail swipes in melee, three attacks in ten a stomp that drops rubble, and only
 *   stomps while his target is out of reach, walking in on them (every 4 ticks);
 * - at 80% he runs to one of the three food piles and eats there: three to five heals of 5 or
 *   10 per player in the room, each just before an attack (every 6 or 7 ticks), while he throws
 *   magic and fur balls, stomps and calls six giant rats; then he walks two tiles off, swipes
 *   three to five times (no stomps) and goes back to the pile to eat again, until 30%;
 * - at 30% he runs to the middle of the room and keeps to magic, ranged, stomps and rats (every
 *   4 ticks), turning only to stomp at his target's tile, and goes back to eating if he heals
 *   above 30%;
 * - the rubble: twelve tiles, one under each player, the rest anywhere on the floor, landing nine
 *   ticks after the stomp for 15-22 (solo) or 15-24 (public);
 * - the rats: at most twelve waves, and none while his last ones live, each on a tile of its own;
 *   any hit from a player kills one, rat bone weapons hit them without an attack delay, and they
 *   hit 0-1 through Protect from Melee.
 */
const Common = require("./Common.Scurrius");

const { ANIM, GFX, SOUND } = Common;

/** Wiki: solo (7222) and public (7221) max hits. */
const SOLO_MAX_HITS = Object.freeze({ melee: 13, magic: 8, ranged: 7, rockfall: 22 });
const PUBLIC_MAX_HITS = Object.freeze({ melee: 13, magic: 14, ranged: 13, rockfall: 24 });
const ROCKFALL_MIN_HIT = 15;

const FEED_THRESHOLD = 0.8;
const ENRAGE_THRESHOLD = 0.3;
/**
 * Wiki: heals of 5 or 10 per player in the room. Captured (live, rev 241): three to five heals a
 * round at the pile, each on his attack's tick, and three to five tail swipes between rounds.
 */
const FEED_HEALS = Object.freeze([3, 5]);
/**
 * Wiki: 5 or 10 per player. Captured (live, 42 solo heals): 10 in 26 of the 38 taken with none of
 * his rats alive (about 2:1), and 5 in all 4 taken while some were (Wiki: the rats get in the way
 * of his healing; a small sample).
 */
const FEED_HEAL_AMOUNTS = Object.freeze([[10, 2], [5, 1]]);
const FEED_HEAL_WITH_RATS = 5;
const MELEE_BETWEEN_ROUNDS = Object.freeze([3, 5]);
/** Captured: a round's last turn is a stomp in 3 rounds of 10, otherwise he just gets up. */
const LAST_TURN_STOMP_CHANCE = Object.freeze([3, 10]);
/** Captured: back to the same pile for the next round in 5 of 6 kills. */
const SAME_PILE_CHANCE = Object.freeze([5, 6]);
/**
 * Captured (11 of 11 rounds): getting up, he walks two tiles in a straight line, any way but
 * towards the pile, a tick after the eating idle ends (or as his last stomp finishes).
 */
const STEP_OFF_TILES = 2;
const STEP_OFF_TICKS = 1;
const STEP_OFF_AFTER_STOMP_TICKS = 5;
const CARDINALS = Object.freeze([[0, 1], [1, 0], [0, -1], [-1, 0]]);
/** Captured: his next round starts about two ticks after the last swing. */
const BACK_TO_EATING_TICKS = 2;
/** Captured: his first turn comes two ticks after he reaches the pile or the middle. */
const FIRST_TURN_TICKS = 2;
/** Captured heal hitsplat. */
const HEAL_SPLAT = Object.freeze({ mine: 6, others: 6 });

/** Captured attack speeds: 4 ticks, but 6 or 7 while he eats. */
const ATTACK_SPEED = 4;
const FEEDING_ATTACK_SPEEDS = Object.freeze([6, 7]);
/** Captured: he runs (two tiles a tick) to the food and to the middle. */
const RUN_STEPS = 2;
/** He keeps his place while eating and in the middle; the room is 17 tiles across. */
const RANGED_DISTANCE = 20;

/**
 * Captured: 12 debris tiles. The rock lands 9 ticks after the stomp, on whoever stood on a tile at
 * the end of the tick before: 68 of 93 such players were hit then, against 1 in 437 at 5 ticks.
 */
const ROCKFALL_TILES = 12;
const ROCKFALL_LAND_TICKS = 9;
/** map_anim delay (client cycles) and the falling sound's delay and range, as captured. */
const DEBRIS_GFX_DELAY = 60;
const DEBRIS_SOUND_DELAY = 240;
const DEBRIS_SOUND_RANGE = 5;
const STOMP_SOUND_RANGE = 9;
const SUMMON_SOUND_DELAY = 90;

/**
 * Wiki: six rats a wave, twelve waves at most. Captured: they appear two ticks into the call,
 * calls are at least 41 ticks apart (27 gaps between calls, 41 to 190), and he never calls while
 * any of his rats live (live, rev 241: 6 calls, all with none left; none in 27 turns with some).
 */
const RATS_PER_WAVE = 6;
const RAT_WAVE_LIMIT = 12;
const RAT_SPAWN_TICKS = 2;
const RAT_CALL_COOLDOWN_TICKS = 41;
/** Cache: the giant rat is 2x2. Captured: no two rats of a wave share a tile (203 waves). */
const RAT_SIZE = 2;
const RAT_TILE_ATTEMPTS = 40;
/**
 * Wiki: the rats "hit 0-1 through Protect from Melee" (up to 4 without). Captured, with the prayer
 * on: 1 on 73 ticks, 0 on 15, both on 3.
 */
const RAT_PROTECTED_MAX_HIT = 1;
/** Generic engine flags: no turning back to fight on a hit, and no turning to the target. */
const NO_RETALIATE_FLAG = "combat:no-retaliate";
const KEEP_FACING_FLAG = "combat:keep-facing";
/** Generic engine flag: keeps walking in on the target while attacking from range. */
const CLOSE_IN_FLAG = "combat:close-in";

/**
 * Captured projectile: a fixed 30-120 cycle flight, so the hit lands 4 ticks after the cast. The
 * heights are the packet's 50 and 25 (rsprox prints map_projanim_v2 heights four times over:
 * 200 and 100). Live names no source actor, so the flight starts from its tile, not his model.
 */
const PROJECTILE = Object.freeze({ start: 30, end: 120, startHeight: 50, endHeight: 25, angle: 40, progress: 0 });
/**
 * Captured: the projectile leaves from a back corner of his 3x3 body, on his left for ranged and
 * on his right for magic, relative to where he faces (every cast at a pile, all three piles).
 */
const HAND_ANGLES = Object.freeze({ ranged: (3 * Math.PI) / 4, magic: -(3 * Math.PI) / 4 });
/**
 * Captured: the hitsplat and impact come 4 ticks after the cast, as the flight ends (live: 47 of
 * 52 casts; the other 5 never landed, as he died first). Melee lands on the swing's tick, as live.
 * Wiki: bolts and fur balls "only deal damage on impact" and "can be blocked with late
 * reactions", so they are rolled as they land, with the protection prayer up then.
 */
const DISTANT_HIT_DELAY = 4;
/** Bolts and fur balls landing this tick: placeholder PendingHit -> its max hit, rolled by `distantHitLands`. */
const landing = new WeakMap();
/** Captured on the player: a missed bolt splashes (failedspell_impact) with sound 227. */
const SPLASH_GFX = 85;
const SPLASH_SOUND = 227;

/**
 * Captured share of each attack per phase. In phase one, beside his target: tail swipe 24, stomp
 * 10 (live, rev 241; 95 to 21 on Leagues); out of reach he stomps (46 to 11). Eating: magic 18,
 * ranged 18, stomp 7, rats 2. Below 30%: magic 8, ranged 8, stomp 13, rats 4. Between rounds at
 * the pile he only swipes (26 of 26).
 */
const PHASE_ONE = Object.freeze([["melee", 7], ["stomp", 3]]);
const FEEDING = Object.freeze([["magic", 4], ["ranged", 4], ["stomp", 2], ["summon", 1]]);
const ENRAGED = Object.freeze([["magic", 2], ["ranged", 2], ["stomp", 3], ["summon", 1]]);

const WALK_REPATH_LIMIT = 10;
/**
 * Between rounds he walks in to swipe (captured: 26 of 26 turns, including step-offs that ended 2-4
 * tiles from the player). Only when he has gone an attack cycle without a step while out of reach
 * (his rats walling him off) does he stomp from range instead.
 */
const STUCK_TICKS = ATTACK_SPEED;

let api = null;
let core = null;
let ratbaneWeaponIds = null;
const states = new WeakMap();

function stateOf(npc) {
  let state = states.get(npc);
  if (!state) {
    state = { phase: "combat", feeding: null, spot: null, swingsLeft: 0, ratWaves: 0, walking: null };
    states.set(npc, state);
    npc.setFlag?.(CLOSE_IN_FLAG, true);
  }
  return state;
}

/** A fresh fight for a (re)spawned boss. */
function reset(npc) {
  states.delete(npc);
}

function maxHitsFor(npc) {
  return Common.isPublic(npc) ? PUBLIC_MAX_HITS : SOLO_MAX_HITS;
}

function maxHitpoints(npc) {
  return npc.getDefinition?.()?.getHitpoints?.() ?? npc.getMaxHitpoints?.() ?? 0;
}

function hitpointRatio(npc) {
  const max = maxHitpoints(npc);
  return max > 0 ? npc.getHitpoints() / max : 1;
}

function weighted(choices, allowed = () => true) {
  const pool = choices.filter(([name]) => allowed(name));
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = core.Misc.randomInclusive(1, total);
  for (const [name, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return pool[0][0];
}

/** Whether any rat from his calls is still alive. */
function ratsAlive(state) {
  return (state.rats ?? []).some((rat) => rat.isRegistered?.() !== false && rat.getHitpoints() > 0);
}

function pickAction(state, now = core.World.getProcessCycle(), beside = true) {
  const canSummon = (name) => name !== "summon"
    || (state.ratWaves < RAT_WAVE_LIMIT && now - (state.lastCallAt ?? -Infinity) >= RAT_CALL_COOLDOWN_TICKS
      && !ratsAlive(state));
  if (state.phase === "feeding") return weighted(FEEDING, canSummon);
  if (state.phase === "enraged") return weighted(ENRAGED, canSummon);
  // Out of reach here means stuck (attackDistance only lets him attack from range then): he stomps, as
  // in phase one, so he never waits on a swipe he can't make.
  if (state.phase === "between") return beside ? "melee" : "stomp";
  return beside ? weighted(PHASE_ONE) : "stomp";
}

/**
 * Between rounds: whether he is out of reach of `target` and has not taken a step for STUCK_TICKS,
 * so walking in has stopped working. Any step or reaching them starts the count again.
 */
function stuckBetween(npc, state, target) {
  if (!target || besideTarget(npc, target)) {
    state.stall = null;
    return false;
  }
  const now = core.World.getProcessCycle();
  const at = npc.getLocation();
  if (!state.stall || !state.stall.at.equals(at)) {
    state.stall = { at: at.clone(), since: now };
    return false;
  }
  return now - state.stall.since >= STUCK_TICKS;
}

/** Whether he attacks `target` from range in a phase he otherwise walks in on them: phase one out of reach, or stuck between rounds. */
function fromRange(npc, state, target) {
  if (state.phase === "combat") return !besideTarget(npc, target);
  if (state.phase === "between") return stuckBetween(npc, state, target);
  return false;
}
const closesIn = (phase) => phase === "combat" || phase === "between";

/** Whether `target` stands within a tile of his footprint (or under him). */
function besideTarget(npc, target) {
  if (!target) return false;
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const from = npc.getLocation();
  const to = target.getLocation();
  const dx = Math.max(from.getX() - to.getX(), 0, to.getX() - (from.getX() + size - 1));
  const dy = Math.max(from.getY() - to.getY(), 0, to.getY() - (from.getY() + size - 1));
  return Math.max(dx, dy) <= 1;
}

function targetOf(npc) {
  return npc.getCombat?.().getTarget?.() ?? null;
}

/** The tile of his body a ranged or magic attack leaves from, turned to face `toward`. */
function handTile(npc, toward, kind) {
  const centre = core.Projectile.centreOf(npc);
  const facing = Math.atan2(toward.getY() - centre.getY(), toward.getX() - centre.getX());
  const angle = facing + HAND_ANGLES[kind];
  const step = (value) => Math.max(-1, Math.min(1, Math.round(Math.SQRT2 * value)));
  return centre.transform(step(Math.cos(angle)), step(Math.sin(angle)));
}

function sendProjectile(npc, target, projectileId, kind, toward = target.getLocation()) {
  new core.Projectile(
    handTile(npc, toward, kind), target.getLocation(), target, projectileId, PROJECTILE.start,
    PROJECTILE.end, PROJECTILE.startHeight, PROJECTILE.endHeight, npc.getPrivateArea(),
  ).withAngle(PROJECTILE.angle).withProgress(PROJECTILE.progress).sendProjectile();
}

/**
 * Who a bolt or fur ball turn is thrown at: every player in the room, his target among them
 * (captured, recording 84: one projectile per player in the public lair on each cast, up to six
 * at once, from the same tile, a player still on the entrance tile included).
 */
function volleyTargets(npc, target) {
  const players = Common.playersInRoom(npc);
  return target && !players.includes(target) ? [target, ...players] : players;
}

function areaSound(npc, soundId, [x, y, z], delay, range) {
  for (const player of Common.playersInRoom(npc)) player.getPacketSender().sendAreaSound(soundId, x, y, z, 1, delay, range);
}

function floorTile(npc) {
  const { FLOOR } = Common;
  const { Misc, RegionManager, Location } = core;
  for (let attempt = 0; attempt < 20; attempt++) {
    const tile = new Location(Misc.randomInclusive(FLOOR.minX, FLOOR.maxX), Misc.randomInclusive(FLOOR.minY, FLOOR.maxY), 0);
    if (!RegionManager.blocked(tile, npc.getPrivateArea())) return tile;
  }
  return Common.location(Common.CENTRE_TILE);
}

/** One tile under each player in the room, the rest anywhere on the floor. */
function rockfallTiles(npc, players) {
  const tiles = new Map();
  const add = (tile) => tiles.set(`${tile.getX()},${tile.getY()}`, tile);
  for (const player of players) add(player.getLocation().clone());
  for (let attempt = 0; tiles.size < ROCKFALL_TILES && attempt < ROCKFALL_TILES * 4; attempt++) add(floorTile(npc));
  return [...tiles.values()];
}

function stomp(npc) {
  const players = Common.playersInRoom(npc);
  if (players.length === 0) return;
  const tiles = rockfallTiles(npc, players);
  const viewer = players[0];
  for (const tile of tiles) {
    viewer.getPacketSender().sendGlobalGraphic(new core.Graphic(GFX.debris, DEBRIS_GFX_DELAY), tile);
    areaSound(npc, SOUND.debris, [tile.getX(), tile.getY(), 0], DEBRIS_SOUND_DELAY, DEBRIS_SOUND_RANGE);
  }
  for (const soundId of SOUND.stomp) areaSound(npc, soundId, Common.CENTRE_TILE, 0, STOMP_SOUND_RANGE);
  const maxHit = maxHitsFor(npc).rockfall;
  Common.later(ROCKFALL_LAND_TICKS, () => {
    if (npc.getHitpoints() <= 0 || !npc.isRegistered?.()) return;
    for (const player of Common.playersInRoom(npc)) {
      if (!tiles.some((tile) => tile.equals(player.getLocation()))) continue;
      const damage = core.Misc.randomInclusive(ROCKFALL_MIN_HIT, maxHit);
      player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    }
  }, npc);
}

/** A floor tile for a rat's south-west corner: its whole 2x2 body on open floor, on no other rat's tile. */
function ratTile(npc, taken) {
  for (let attempt = 0; attempt < RAT_TILE_ATTEMPTS; attempt++) {
    const tile = floorTile(npc);
    const key = `${tile.getX()},${tile.getY()}`;
    if (!taken.has(key) && roomFor(npc, tile, RAT_SIZE)) {
      taken.add(key);
      return tile;
    }
  }
  return floorTile(npc);
}

function summonRats(npc, state) {
  state.ratWaves++;
  state.lastCallAt = core.World.getProcessCycle();
  const area = npc.getPrivateArea?.() ?? null;
  Common.later(RAT_SPAWN_TICKS, () => {
    if (npc.getHitpoints() <= 0 || !npc.isRegistered?.()) return;
    const players = Common.playersInRoom(npc);
    state.rats = [];
    const taken = new Set();
    for (let i = 0; i < RATS_PER_WAVE; i++) {
      const tile = ratTile(npc, taken);
      const rat = core.NPC.create(Common.RAT_ID, tile);
      rat.__skipDefaultRespawn = true;
      rat.setMultiCombat?.(true);
      if (area) area.add(rat);
      core.World.getAddNPCQueue().push(rat);
      state.rats.push(rat);
      const target = players[i % Math.max(1, players.length)];
      if (target) rat.getCombat().attack(target);
    }
  }, npc);
}

function stopWalk(npc, state) {
  state.walking = null;
  npc.setScriptedMovement(false);
  npc.removeFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG);
  npc.removeFlag(NO_RETALIATE_FLAG);
  npc.setMovementSteps?.(1);
}

/**
 * Runs (or walks, one step a tick) him to `destination`. Combat pauses while the walk is scripted (Combat.preMovementProcess).
 * Wiki: nothing holds him on the way (he breaks free of binds), so players in his path don't
 * either, and hits don't stop him to turn on the attacker (captured: he faces where he walks);
 * a walk that stops getting anywhere is given up rather than freezing the boss.
 */
function walkTo(npc, state, destination, onArrive, steps = RUN_STEPS) {
  const { PathFinder, Task, TaskManager } = core;
  const target = destination.clone();
  // The scripted walk clears his fight; he picks it back up where he arrives.
  const opponent = npc.getCombat().getTarget?.() ?? null;
  const walk = {};
  state.walking = walk;
  npc.setScriptedMovement(true);
  npc.setFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  npc.setFlag(NO_RETALIATE_FLAG, true);
  npc.setMovementSteps?.(steps);
  npc.removeFlag(KEEP_FACING_FLAG);
  // He keeps his place where he arrives; only phase one and two close in again.
  npc.removeFlag(CLOSE_IN_FLAG);
  npc.setMobileInteraction(null);
  npc.setPositionToFace(null);
  npc.getMovementQueue().reset();
  PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
  let failedRepaths = 0;
  let last = npc.getLocation().clone();
  // The way his last step went: he faces it where he stops.
  let heading = null;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, npc, false);
    }
    execute() {
      // A newer walk (the enrage cutting a walk to the food short) takes over.
      if (state.walking !== walk) {
        this.stop();
        return;
      }
      if (!npc.isRegistered?.() || npc.getHitpoints() <= 0) {
        stopWalk(npc, state);
        this.stop();
        return;
      }
      const movement = npc.getMovementQueue();
      // The attack that started the walk turns him back to its target as it finishes, so the
      // facing is dropped each tick of the walk, not just at its start.
      if (npc.getInteractingMobile() != null) npc.setMobileInteraction(null);
      const arrived = npc.getLocation().equals(target);
      const moved = !npc.getLocation().equals(last);
      if (moved) heading = [Math.sign(npc.getLocation().getX() - last.getX()), Math.sign(npc.getLocation().getY() - last.getY())];
      last = npc.getLocation().clone();
      if (!arrived && moved) {
        failedRepaths = 0;
        return;
      }
      if (!arrived && (movement.size() > 0 || movement.isMovings()) && failedRepaths === 0) {
        failedRepaths++;
        return;
      }
      if (!arrived && ++failedRepaths <= WALK_REPATH_LIMIT) {
        PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
        return;
      }
      movement.reset();
      stopWalk(npc, state);
      this.stop();
      onArrive(heading);
      reengage(npc, opponent);
    }
  })());
}

/** Back at his last opponent if they are still in the room, or the nearest player who is. */
function reengage(npc, opponent) {
  if (npc.getHitpoints() <= 0 || !npc.isRegistered?.()) return;
  const players = Common.playersInRoom(npc);
  const target = players.includes(opponent) ? opponent : players[0];
  if (target) npc.getCombat().attack(target);
}

/** Turns him to the pile he eats from, and keeps him there while he attacks (captured). */
function facePile(npc, spot) {
  npc.setFlag(KEEP_FACING_FLAG, true);
  npc.setMobileInteraction(null);
  npc.setPositionToFace(Common.location(spot.face));
}

const between = ([min, max]) => core.Misc.randomInclusive(min, max);
const chance = ([times, outOf]) => core.Misc.randomInclusive(1, outOf) <= times;

/**
 * A round at the pile: the eating idle as his base animation (captured: a `bas` change, set on
 * arrival and cleared as he gets up), and three to five heals, each taken on an attack's turn.
 */
function startFeeding(npc, state, spot) {
  state.phase = "feeding";
  state.spot = spot;
  state.feeding = { heals: 0, of: between(FEED_HEALS) };
  facePile(npc, spot);
  npc.setBaseAnimations({ idle: ANIM.feedingIdle });
  npc.getCombat().setAttackDelay(FIRST_TURN_TICKS);
}

function heal(npc) {
  const players = Math.max(1, Common.playersInRoom(npc).length);
  const each = ratsAlive(stateOf(npc)) ? FEED_HEAL_WITH_RATS : weighted(FEED_HEAL_AMOUNTS);
  const amount = each * players;
  npc.heal(amount);
  npc.showHitsplat(amount, HEAL_SPLAT);
}

/**
 * He gets up from the pile and walks two tiles off it; three to five tail swipes later he goes
 * back to eat. `stomped`: his last turn was a stomp, which he finishes first.
 */
function finishFeeding(npc, state, stomped = false) {
  state.feeding = null;
  npc.removeFlag(KEEP_FACING_FLAG);
  npc.setBaseAnimations(null);
  if (state.phase !== "feeding") return;
  state.phase = "between";
  state.swingsLeft = between(MELEE_BETWEEN_ROUNDS);
  state.stall = null;
  const delay = stomped ? STEP_OFF_AFTER_STOMP_TICKS : STEP_OFF_TICKS;
  // No swing before he has walked off.
  npc.getCombat().setAttackDelay(delay + 1);
  const spot = state.spot;
  Common.later(delay, () => {
    if (state.phase === "between" && !state.walking && npc.getHitpoints() > 0 && npc.isRegistered?.()) stepOff(npc, state, spot);
  }, npc);
}

/** Whether a body of `size` (his own by default) fits on the floor with its south-west corner on `tile`. */
function roomFor(npc, tile, size = Math.max(1, npc.getSize?.() ?? 1)) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const at = tile.transform(x, y);
      if (!Common.within(Common.FLOOR, at) || core.RegionManager.blocked(at, npc.getPrivateArea())) return false;
    }
  }
  return true;
}

/** Two tiles in a straight line, any way but towards the pile, at a walk. */
function stepOff(npc, state, spot) {
  const at = npc.getLocation();
  const ways = CARDINALS
    .filter(([dx, dy]) => dx !== spot.pile[0] || dy !== spot.pile[1])
    .map(([dx, dy]) => at.transform(dx * STEP_OFF_TILES, dy * STEP_OFF_TILES))
    .filter((tile) => roomFor(npc, tile));
  if (ways.length === 0) return;
  // Off the pile he walks in on his target again, to swipe, or stomps while he can't reach them.
  walkTo(npc, state, ways[core.Misc.randomInclusive(0, ways.length - 1)], () => npc.setFlag(CLOSE_IN_FLAG, true), 1);
}

/** A turn between rounds (a swipe, or a stomp out of reach); the last one sends him back to eat. */
function swungBetweenRounds(npc, state) {
  if (--state.swingsLeft > 0) return;
  Common.later(BACK_TO_EATING_TICKS, () => {
    if (state.phase === "between" && npc.getHitpoints() > 0 && npc.isRegistered?.()) goEat(npc, state);
  }, npc);
}

function goEat(npc, state) {
  state.phase = "walking";
  const { FEEDING_SPOTS } = Common;
  const spot = state.spot && chance(SAME_PILE_CHANCE)
    ? state.spot
    : FEEDING_SPOTS[core.Misc.randomInclusive(0, FEEDING_SPOTS.length - 1)];
  walkTo(npc, state, Common.location(spot.stand), () => {
    if (state.phase === "walking" && npc.getHitpoints() > 0) startFeeding(npc, state, spot);
  });
}

function enrage(npc, state) {
  state.feeding = null;
  npc.removeFlag(KEEP_FACING_FLAG);
  npc.setBaseAnimations(null);
  state.phase = "walking-centre";
  walkTo(npc, state, Common.location(Common.CENTRE_TILE), (heading) => {
    if (state.phase !== "walking-centre") return;
    state.phase = "enraged";
    // Captured: in the middle he never turns to his target; he faces the way he came in until a
    // stomp turns him to his target's tile.
    npc.setFlag(KEEP_FACING_FLAG, true);
    npc.setMobileInteraction(null);
    const centre = core.Projectile.centreOf(npc);
    state.facing = heading ? centre.transform(heading[0], heading[1]) : null;
    npc.getCombat().setAttackDelay(FIRST_TURN_TICKS);
  });
}

/** Moves him on to the next phase his hitpoints call for. */
function advancePhase(npc) {
  if (npc.getHitpoints() <= 0) return;
  const state = stateOf(npc);
  const ratio = hitpointRatio(npc);
  if (ratio <= ENRAGE_THRESHOLD) {
    if (state.phase !== "enraged" && state.phase !== "walking-centre") enrage(npc, state);
    return;
  }
  // Wiki: healed above 30% in the middle, he goes back to eating.
  if (state.phase === "enraged") {
    goEat(npc, state);
    return;
  }
  if (state.phase === "combat" && ratio <= FEED_THRESHOLD) goEat(npc, state);
}

/**
 * His turn at the pile: a heal, then an attack, until the round's heals are done; the turn after
 * the last heal he gets up, sometimes with a stomp.
 */
function feedingTurn(npc, state) {
  const feeding = state.feeding;
  if (feeding.heals >= feeding.of) {
    const stomped = chance(LAST_TURN_STOMP_CHANCE);
    finishFeeding(npc, state, stomped);
    return stomped ? "stomp" : "none";
  }
  feeding.heals++;
  heal(npc);
  // Captured: his facing is sent again with each heal.
  npc.setPositionToFace(Common.location(state.spot.face));
  return pickAction(state);
}

/** Where he faces for a cast: the pile while he eats, his last turn in the middle, otherwise his target. */
function facingFor(state, target) {
  if (state.phase === "feeding" && state.spot) return Common.location(state.spot.face);
  if (state.phase === "enraged" && state.facing) return state.facing;
  return target.getLocation();
}

function trackPhase(event) {
  const npc = event.target;
  if (npc?.isNpc?.() && Common.isScurrius(npc)) advancePhase(npc);
}

function ratbaneIds() {
  if (!ratbaneWeaponIds) {
    const I = core.ItemIdentifiers;
    ratbaneWeaponIds = new Set([I.BONE_MACE, I.BONE_MACE_2, I.BONE_SHORTBOW, I.BONE_SHORTBOW_2, I.BONE_STAFF, I.BONE_STAFF_2]);
  }
  return ratbaneWeaponIds;
}

/** Wiki: rat bone weapons have no attack delay against the summoned rats. */
function removeRatAttackDelay(event) {
  if (!Common.isRat(event.target) || !event.player?.isPlayer?.()) return;
  const weaponId = event.player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId();
  if (ratbaneIds().has(weaponId)) event.player.getCombat().setAttackDelay(0);
}

/** Wiki: players always kill a summoned rat when they attack it. */
function oneShotRat(event) {
  if (!Common.isRat(event.npc)) return;
  const hit = event.hit;
  if (!hit?.getAttacker?.()?.isPlayer?.()) return;
  const hits = hit.getHits();
  for (let i = 0; i < hits.length; i++) hits[i].setDamage(i === 0 ? Math.max(1, event.npc.getHitpoints()) : 0);
  hit.updateTotalDamage();
}

/** Wiki: the rats' bites go through Protect from Melee; ratHitLands caps them as they land. */
function ratHitRoll(roll) {
  if (!Common.isRat(roll.attacker) || !roll.target?.isPlayer?.()) return;
  if (roll.combatType === core.CombatType.MELEE) roll.bypassProtectionPrayer = true;
}

/**
 * A rat's bite lands, in the player's turn after their clicks this tick: 0-1 with Protect from
 * Melee up then, its full roll without.
 */
function ratHitLands(event) {
  const hit = event.hit;
  if (!Common.isRat(hit?.getAttacker?.()) || hit.getCombatType?.() !== core.CombatType.MELEE) return;
  if (!core.PrayerHandler.isActivated(event.player, core.PrayerHandler.PROTECT_FROM_MELEE)) return;
  for (const damage of hit.getHits()) damage.setDamage(Math.min(damage.getDamage(), RAT_PROTECTED_MAX_HIT));
  hit.updateTotalDamage();
}

/**
 * A bolt or fur ball lands, in the player's own turn after their clicks this tick: rolled now,
 * against the protection prayer they have up as it hits.
 */
function distantHitLands(event) {
  const maxHit = landing.get(event.hit);
  if (maxHit === undefined) return;
  landing.delete(event.hit);
  const placeholder = event.hit;
  const hit = new core.PendingHit(placeholder.getAttacker(), placeholder.getTarget(), placeholder.getCombatMethod(), 0);
  core.CombatFactory.applyStyleDamage(hit, maxHit);
  event.hit = hit;
}

function defineCombatMethod() {
  const { Animation, CombatMethod, CombatType, Graphic, PendingHit } = core;

  class ScurriusCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MELEE;
      this.action = "melee";
      this.npc = null;
      /** The players a bolt or fur ball turn was thrown at, for hits(). */
      this.volley = null;
    }

    /** In phase one and between rounds, melee beside his target; out of reach, the stomp works from range. */
    type() {
      const npc = this.npc;
      if (npc && closesIn(stateOf(npc).phase)) return fromRange(npc, stateOf(npc), targetOf(npc)) ? CombatType.RANGED : CombatType.MELEE;
      return this.stance;
    }

    /**
     * Phase one and between rounds: melee beside his target, so he steps round to an edge as
     * usual; further away (or with rats in his way) he stomps, closing in as he does. Eating and
     * in the middle he keeps his place.
     */
    attackDistance(character) {
      this.npc = character;
      const phase = stateOf(character).phase;
      if (closesIn(phase)) return fromRange(character, stateOf(character), targetOf(character)) ? RANGED_DISTANCE : 1;
      return phase === "feeding" || phase === "enraged" ? RANGED_DISTANCE : 1;
    }

    attackSpeed(character) {
      return stateOf(character).phase === "feeding" ? between(FEEDING_ATTACK_SPEEDS) : ATTACK_SPEED;
    }

    start(character, target) {
      this.npc = character;
      const state = stateOf(character);
      // A heal or a hit since the last check may call for the next phase first.
      advancePhase(character);
      this.stance = CombatType.MELEE;
      if (state.walking) {
        this.action = "none";
        return;
      }
      const feeding = state.phase === "feeding";
      this.action = feeding ? feedingTurn(character, state) : pickAction(state, core.World.getProcessCycle(), besideTarget(character, target));
      if (this.action === "none") return;
      if (this.action === "melee") {
        character.performAnimation(new Animation(ANIM.melee));
        if (state.phase === "between") swungBetweenRounds(character, state);
        return;
      }
      if (this.action === "stomp") {
        character.performAnimation(new Animation(feeding ? ANIM.feedingStomp : ANIM.stomp));
        // Captured: in the middle a stomp is his only turn, to his target's tile.
        if (state.phase === "enraged") {
          state.facing = target.getLocation().clone();
          character.setPositionToFace(state.facing);
        }
        stomp(character);
        if (state.phase === "between") swungBetweenRounds(character, state);
        return;
      }
      if (this.action === "summon") {
        character.performAnimation(new Animation(feeding ? ANIM.feedingSummon : ANIM.enragedSummon));
        areaSound(character, SOUND.summon, Common.CENTRE_TILE, SUMMON_SOUND_DELAY, STOMP_SOUND_RANGE);
        summonRats(character, state);
        return;
      }
      const ranged = this.action === "ranged";
      this.stance = ranged ? CombatType.RANGED : CombatType.MAGIC;
      if (ranged) {
        character.performAnimation(new Animation(feeding ? ANIM.feedingRanged : ANIM.ranged));
      } else {
        character.performAnimation(new Animation(feeding ? ANIM.feedingMagic : ANIM.magic));
        character.performGraphic(new Graphic(feeding ? GFX.feedingMagicCast : GFX.magicCast));
      }
      // One cast, one projectile and cast sound for each player in the room, all from the same
      // hand tile (he faces the pile or his last turn, never each player).
      const toward = facingFor(state, target);
      this.volley = volleyTargets(character, target);
      for (const victim of this.volley) {
        sendProjectile(character, victim, ranged ? GFX.rangedProjectile : GFX.magicProjectile, this.action, toward);
        if (victim.isPlayer?.()) victim.getPacketSender().sendSound(ranged ? SOUND.ranged : SOUND.magic, 1, 0);
      }
    }

    hits(character, target) {
      const maxHits = maxHitsFor(character);
      if (this.action === "melee") {
        const hit = new PendingHit(character, target, this, 0);
        core.CombatFactory.applyStyleDamage(hit, maxHits.melee);
        return [hit];
      }
      if (this.action !== "ranged" && this.action !== "magic") return [];
      const kind = this.action;
      const volley = this.volley ?? [target];
      this.volley = null;
      // Queued at 0 as the flight ends and rolled by distantHitLands in each player's turn, so a
      // prayer clicked on the landing tick counts (the task runs before the player's clicks).
      Common.later(DISTANT_HIT_DELAY, () => {
        if (character.getHitpoints() <= 0 || !character.isRegistered?.()) return;
        for (const victim of volley) {
          if (victim.getHitpoints() <= 0 || victim.isRegistered?.() === false) continue;
          const placeholder = new PendingHit(character, victim, DISTANT_STYLES[kind],
            { delay: 0, rollAccuracy: false, experience: false, damage: 0, bypassProtectionPrayer: true });
          landing.set(placeholder, maxHits[kind]);
          core.CombatFactory.addPendingHit(placeholder);
        }
      }, character);
      return [];
    }
  }

  /**
   * Carries a landing bolt's or fur ball's style: PendingHit reads its style from its method as
   * it is built, and by the time one lands his own method may have moved on to the next attack.
   */
  class DistantHit extends CombatMethod {
    constructor(style) {
      super();
      this.style = style;
    }

    type() {
      return this.style;
    }

    hits() {
      return [];
    }

    /** Captured on the player, at height 100: the fur ball's impact, or the bolt's (a splash on a miss). */
    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target.isPlayer()) return;
      const high = core.GraphicHeight.HIGH;
      const sender = target.getPacketSender();
      if (hit.getCombatType() === CombatType.RANGED) {
        target.performGraphic(new Graphic(GFX.rangedImpact, 0, high));
        sender.sendSound(SOUND.rangedImpact, 1, 0);
      } else if (hit.getCombatType() === CombatType.MAGIC) {
        const landed = hit.isAccurate();
        target.performGraphic(new Graphic(landed ? GFX.magicImpact : SPLASH_GFX, 0, high));
        sender.sendSound(landed ? SOUND.magicImpact : SPLASH_SOUND, 1, 0);
      }
    }
  }

  const DISTANT_STYLES = { ranged: new DistantHit(CombatType.RANGED), magic: new DistantHit(CombatType.MAGIC) };
  return ScurriusCombatMethod;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onNpcHitModify(oneShotRat);
  api.onPlayerDealtDamage(trackPhase);
  api.onPlayerDealtDamage(removeRatAttackDelay);
  api.onPlayerHitModify(distantHitLands);
  api.onCombatHitRoll(ratHitRoll);
  api.onPlayerHitModify(ratHitLands);
  api.registerNpcCombatMethodProvider([Common.PUBLIC_ID, Common.SOLO_ID], defineCombatMethod(), { singleton: false });
}

module.exports = {
  attach,
  reset,
  stateOf,
  advancePhase,
  _test: {
    SOLO_MAX_HITS, PUBLIC_MAX_HITS, PHASE_ONE, FEEDING, ENRAGED, RAT_WAVE_LIMIT, ROCKFALL_TILES,
    RAT_CALL_COOLDOWN_TICKS, FEED_HEALS, MELEE_BETWEEN_ROUNDS, PROJECTILE, pickAction, rockfallTiles, stomp, summonRats,
    FEED_HEAL_AMOUNTS, DISTANT_HIT_DELAY, startFeeding, feedingTurn, finishFeeding, stepOff, ratsAlive, facingFor, heal, goEat, enrage, handTile, oneShotRat, removeRatAttackDelay,
    defineCombatMethod, distantHitLands, volleyTargets, maxHitsFor, STUCK_TICKS, ratHitRoll, ratHitLands, ratTile, RAT_PROTECTED_MAX_HIT,
  },
};
