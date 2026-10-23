/**
 * Scurrius' fight (Wiki: Scurrius, Scurrius/Strategies), timed and animated from the rsprox
 * captures (docs/scurrius.md):
 * - phase one: tail swipes in melee, one attack in five a stomp that drops rubble, and only
 *   stomps while his target is out of reach, walking in on them (every 4 ticks);
 * - at 80% he walks to one of the three food piles and eats there: five heals of 5 or 10 per
 *   player in the room, about every six ticks, while he throws magic and fur balls, stomps and
 *   calls six giant rats; then back to melee;
 * - at 30% he walks to the middle of the room and keeps to magic, ranged, stomps and rats (every
 *   4 ticks), and goes back to eating if he heals above 30%;
 * - the rubble: twelve tiles, one under each player, the rest anywhere on the floor, landing nine
 *   ticks after the stomp for 15-22 (solo) or 15-24 (public);
 * - the rats: at most twelve waves; any hit from a player kills one, and rat bone weapons hit
 *   them without an attack delay.
 */
const Common = require("./Common.Scurrius");

const { ANIM, GFX, SOUND } = Common;

/** Wiki: solo (7222) and public (7221) max hits. */
const SOLO_MAX_HITS = Object.freeze({ melee: 13, magic: 8, ranged: 7, rockfall: 22 });
const PUBLIC_MAX_HITS = Object.freeze({ melee: 13, magic: 14, ranged: 13, rockfall: 24 });
const ROCKFALL_MIN_HIT = 15;

const FEED_THRESHOLD = 0.8;
const ENRAGE_THRESHOLD = 0.3;
/** Wiki: five heals of 5 or 10 per player in the room. Captured: about every six ticks. */
const FEED_HEALS = 5;
const FEED_HEAL_TICKS = 6;
const FEED_HEAL_AMOUNTS = Object.freeze([5, 10]);
/** Captured: the eating idle in between, twice per heal. */
const FEED_EAT_TICKS = 3;
/** Captured heal hitsplat. */
const HEAL_SPLAT = Object.freeze({ mine: 6, others: 6 });

/** Captured attack speeds: 4 ticks, but about 6 while he eats. */
const ATTACK_SPEED = 4;
const FEEDING_ATTACK_SPEED = 6;
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
 * Wiki: six rats a wave, twelve waves at most. Captured: they appear two ticks into the call, and
 * calls are at least 41 ticks apart (27 gaps between calls, 41 to 190).
 */
const RATS_PER_WAVE = 6;
const RAT_WAVE_LIMIT = 12;
const RAT_SPAWN_TICKS = 2;
const RAT_CALL_COOLDOWN_TICKS = 41;
/** Generic engine flags: no turning back to fight on a hit, and no turning to the target. */
const NO_RETALIATE_FLAG = "combat:no-retaliate";
const KEEP_FACING_FLAG = "combat:keep-facing";
/** Generic engine flag: keeps walking in on the target while attacking from range. */
const CLOSE_IN_FLAG = "combat:close-in";

/** Captured projectile: a fixed 30-120 cycle flight, so the hit lands 4 ticks after the cast. */
const PROJECTILE = Object.freeze({ start: 30, end: 120, startHeight: 200, endHeight: 100, angle: 40, progress: 0 });
const DISTANT_HIT_DELAY = 3;

/**
 * Captured share of each attack per phase (rsprox, 35 recordings). In phase one, beside his
 * target: tail swipe 95, stomp 21 (solo instances); out of reach he stomps (46 to 11).
 */
const PHASE_ONE = Object.freeze([["melee", 4], ["stomp", 1]]);
const FEEDING = Object.freeze([["magic", 4], ["ranged", 4], ["stomp", 2], ["summon", 1]]);
const ENRAGED = Object.freeze([["magic", 2], ["ranged", 2], ["stomp", 3], ["summon", 1]]);

const WALK_REPATH_LIMIT = 10;

let api = null;
let core = null;
let ratbaneWeaponIds = null;
const states = new WeakMap();

function stateOf(npc) {
  let state = states.get(npc);
  if (!state) {
    state = { phase: "combat", feeding: null, fed: false, ratWaves: 0, walking: null };
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

function pickAction(state, now = core.World.getProcessCycle(), beside = true) {
  const canSummon = (name) => name !== "summon"
    || (state.ratWaves < RAT_WAVE_LIMIT && now - (state.lastCallAt ?? -Infinity) >= RAT_CALL_COOLDOWN_TICKS);
  if (state.phase === "feeding") return weighted(FEEDING, canSummon);
  if (state.phase === "enraged") return weighted(ENRAGED, canSummon);
  return beside ? weighted(PHASE_ONE) : "stomp";
}

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

function sendProjectile(npc, target, projectileId) {
  new core.Projectile(
    core.Projectile.centreOf(npc), target.getLocation(), target, projectileId, PROJECTILE.start,
    PROJECTILE.end, PROJECTILE.startHeight, PROJECTILE.endHeight, npc.getPrivateArea(),
  ).withSource(npc).withAngle(PROJECTILE.angle).withProgress(PROJECTILE.progress).sendProjectile();
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

function summonRats(npc, state) {
  state.ratWaves++;
  state.lastCallAt = core.World.getProcessCycle();
  const area = npc.getPrivateArea?.() ?? null;
  Common.later(RAT_SPAWN_TICKS, () => {
    if (npc.getHitpoints() <= 0 || !npc.isRegistered?.()) return;
    const players = Common.playersInRoom(npc);
    for (let i = 0; i < RATS_PER_WAVE; i++) {
      const tile = floorTile(npc);
      const rat = core.NPC.create(Common.RAT_ID, tile);
      rat.__skipDefaultRespawn = true;
      rat.setMultiCombat?.(true);
      if (area) area.add(rat);
      core.World.getAddNPCQueue().push(rat);
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
}

/**
 * Walks him to `destination`. Combat pauses while the walk is scripted (Combat.preMovementProcess).
 * Wiki: nothing holds him on the way (he breaks free of binds), so players in his path don't
 * either, and hits don't stop him to turn on the attacker (captured: he faces where he walks);
 * a walk that stops getting anywhere is given up rather than freezing the boss.
 */
function walkTo(npc, state, destination, onArrive) {
  const { PathFinder, Task, TaskManager } = core;
  const target = destination.clone();
  // The scripted walk clears his fight; he picks it back up where he arrives.
  const opponent = npc.getCombat().getTarget?.() ?? null;
  const walk = {};
  state.walking = walk;
  npc.setScriptedMovement(true);
  npc.setFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  npc.setFlag(NO_RETALIATE_FLAG, true);
  npc.removeFlag(KEEP_FACING_FLAG);
  // He keeps his place where he arrives; only phase one and two close in again.
  npc.removeFlag(CLOSE_IN_FLAG);
  npc.setMobileInteraction(null);
  npc.setPositionToFace(null);
  npc.getMovementQueue().reset();
  PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
  let failedRepaths = 0;
  let last = npc.getLocation().clone();
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
      onArrive();
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

/** Five heals, about every six ticks, with the eating animation in between. */
function startFeeding(npc, state, spot) {
  const feeding = { heals: 0, ticks: 0, spot };
  state.phase = "feeding";
  state.feeding = feeding;
  facePile(npc, spot);
  npc.performAnimation(new core.Animation(ANIM.feedingIdle));
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, npc, false);
    }
    execute() {
      if (state.feeding !== feeding || !npc.isRegistered?.() || npc.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      feeding.ticks++;
      if (feeding.ticks % FEED_HEAL_TICKS === 0) {
        heal(npc);
        // Captured: his facing is sent again with each heal.
        npc.setPositionToFace(Common.location(spot.face));
        if (++feeding.heals >= FEED_HEALS) {
          finishFeeding(npc, state);
          this.stop();
          return;
        }
      }
      if (feeding.ticks % FEED_EAT_TICKS === 0) npc.performAnimation(new core.Animation(ANIM.feedingIdle));
    }
  })());
}

function heal(npc) {
  const players = Math.max(1, Common.playersInRoom(npc).length);
  const amount = FEED_HEAL_AMOUNTS[core.Misc.randomInclusive(0, FEED_HEAL_AMOUNTS.length - 1)] * players;
  npc.heal(amount);
  npc.showHitsplat(amount, HEAL_SPLAT);
}

function finishFeeding(npc, state) {
  state.feeding = null;
  npc.removeFlag(KEEP_FACING_FLAG);
  if (state.phase !== "feeding") return;
  state.phase = "combat";
  npc.setFlag(CLOSE_IN_FLAG, true);
}

function goEat(npc, state) {
  state.phase = "walking";
  const { FEEDING_SPOTS } = Common;
  const spot = FEEDING_SPOTS[core.Misc.randomInclusive(0, FEEDING_SPOTS.length - 1)];
  walkTo(npc, state, Common.location(spot.stand), () => {
    if (state.phase === "walking" && npc.getHitpoints() > 0) startFeeding(npc, state, spot);
  });
}

function enrage(npc, state) {
  state.feeding = null;
  npc.removeFlag(KEEP_FACING_FLAG);
  state.phase = "walking-centre";
  walkTo(npc, state, Common.location(Common.CENTRE_TILE), () => {
    if (state.phase === "walking-centre") state.phase = "enraged";
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
    state.phase = "combat";
    goEat(npc, state);
    return;
  }
  if (state.phase === "combat" && ratio <= FEED_THRESHOLD && !state.fed) {
    state.fed = true;
    goEat(npc, state);
  }
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

function defineCombatMethod() {
  const { Animation, CombatMethod, CombatType, Graphic, PendingHit } = core;

  return class ScurriusCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.MELEE;
      this.action = "melee";
      this.npc = null;
    }

    /** In phase one and two, melee beside his target; out of reach, the stomp works from range. */
    type() {
      const npc = this.npc;
      if (npc && stateOf(npc).phase === "combat") return besideTarget(npc, targetOf(npc)) ? CombatType.MELEE : CombatType.RANGED;
      return this.stance;
    }

    /**
     * Phase one and two: melee beside his target, so he steps round to an edge as usual; further
     * away he stomps, closing in as he does. Eating and in the middle he keeps his place.
     */
    attackDistance(character) {
      this.npc = character;
      const phase = stateOf(character).phase;
      if (phase === "combat") return besideTarget(character, targetOf(character)) ? 1 : RANGED_DISTANCE;
      return phase === "feeding" || phase === "enraged" ? RANGED_DISTANCE : 1;
    }

    attackSpeed(character) {
      return stateOf(character).phase === "feeding" ? FEEDING_ATTACK_SPEED : ATTACK_SPEED;
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
      this.action = pickAction(state, core.World.getProcessCycle(), besideTarget(character, target));
      if (this.action === "melee") {
        character.performAnimation(new Animation(ANIM.melee));
        return;
      }
      if (this.action === "stomp") {
        character.performAnimation(new Animation(feeding ? ANIM.feedingStomp : ANIM.stomp));
        stomp(character);
        return;
      }
      if (this.action === "summon") {
        character.performAnimation(new Animation(feeding ? ANIM.feedingSummon : ANIM.enragedSummon));
        if (!feeding) areaSound(character, SOUND.enragedSummon, Common.CENTRE_TILE, SUMMON_SOUND_DELAY, STOMP_SOUND_RANGE);
        summonRats(character, state);
        return;
      }
      const sender = target.isPlayer?.() ? target.getPacketSender() : null;
      if (this.action === "ranged") {
        this.stance = CombatType.RANGED;
        character.performAnimation(new Animation(feeding ? ANIM.feedingRanged : ANIM.ranged));
        sendProjectile(character, target, GFX.rangedProjectile);
        sender?.sendSound(SOUND.ranged, 1, 0);
        return;
      }
      this.stance = CombatType.MAGIC;
      character.performAnimation(new Animation(feeding ? ANIM.feedingMagic : ANIM.magic));
      character.performGraphic(new Graphic(feeding ? GFX.feedingMagicCast : GFX.magicCast));
      sendProjectile(character, target, GFX.magicProjectile);
      sender?.sendSound(SOUND.magic, 1, 0);
    }

    hits(character, target) {
      if (this.action !== "melee" && this.action !== "ranged" && this.action !== "magic") return [];
      const maxHits = maxHitsFor(character);
      const melee = this.stance === CombatType.MELEE;
      const hit = new PendingHit(character, target, this, melee ? 0 : DISTANT_HIT_DELAY);
      const maxHit = this.stance === CombatType.RANGED ? maxHits.ranged : this.stance === CombatType.MAGIC ? maxHits.magic : maxHits.melee;
      core.CombatFactory.applyStyleDamage(hit, maxHit);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target.isPlayer()) return;
      if (hit.getCombatType() === CombatType.RANGED) target.performGraphic(new Graphic(GFX.rangedImpact));
      else if (hit.getCombatType() === CombatType.MAGIC) target.performGraphic(new Graphic(GFX.magicImpact));
    }
  };
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onNpcHitModify(oneShotRat);
  api.onPlayerDealtDamage(trackPhase);
  api.onPlayerDealtDamage(removeRatAttackDelay);
  api.registerNpcCombatMethodProvider([Common.PUBLIC_ID, Common.SOLO_ID], defineCombatMethod(), { singleton: false });
}

module.exports = {
  attach,
  reset,
  stateOf,
  advancePhase,
  _test: {
    SOLO_MAX_HITS, PUBLIC_MAX_HITS, PHASE_ONE, FEEDING, ENRAGED, RAT_WAVE_LIMIT, ROCKFALL_TILES,
    RAT_CALL_COOLDOWN_TICKS, pickAction, rockfallTiles, stomp, summonRats, startFeeding, heal, goEat, enrage, oneShotRat,
    removeRatAttackDelay, defineCombatMethod, maxHitsFor,
  },
};
