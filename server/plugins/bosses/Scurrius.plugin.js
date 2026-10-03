"use strict";

// Wiki: solo (7222) 13 melee / 8 magic / 7 ranged / 22 rockfall,
// public (7221) 13 melee / 14 magic / 13 ranged / 24 rockfall.
const SOLO_MAX_HITS = { melee: 13, magic: 8, ranged: 7, rockfall: 22 };
const PUBLIC_MAX_HITS = { melee: 13, magic: 14, ranged: 13, rockfall: 24 };

const FEED_THRESHOLD = 0.8;
const ENRAGE_THRESHOLD = 0.3;
const FEED_HEAL = 5;
const FEED_HEAL_COUNT = 5;
const HEAL_INTERVAL_TICKS = 8;
const ENRAGED_ATTACK_SPEED = 3;
const RANGED_PHASE_DISTANCE = 8;
const FOOD_PILE_SEARCH_RADIUS = 15;
const WALK_REPATH_LIMIT = 10;
const ROCKFALL_MIN_HIT = 15;
const ROCKFALL_WINDUP_TICKS = 3;
const ROCKFALL_SCATTER_RADIUS = 7;
const ROCKFALL_TILES_MIN = 15;
const ROCKFALL_TILES_MAX = 20;
const ROCKFALL_SEARCH_RADIUS = 20;
const RAT_WAVE_LIMIT = 12;
const RATS_PER_WAVE = 6;
const RAT_SPAWN_RADIUS = 5;

// Cache: npc_rat_boss_attack_* sequences and vfx_rat_boss_* spotanims.
const MELEE_ANIMATION = 10692;
const RANGED_ANIMATION = 10694;
const MAGIC_ANIMATION = 10696;
const FEEDING_RANGED_ANIMATION = 10695;
const FEEDING_MAGIC_ANIMATION = 10697;
const ROCKFALL_ANIMATION = 10698;
const SUMMON_ANIMATION = 10700;
const FEEDING_SUMMON_ANIMATION = 10702;
const RANGED_PROJECTILE = 2642;
const MAGIC_PROJECTILE = 2640;
const RANGED_IMPACT = 2643;
const MAGIC_IMPACT = 2641;
const ROCKFALL_TELEGRAPH = 2644;

let core = null;
let ratbaneWeaponIds = null;
const states = new WeakMap();

function stateOf(npc) {
  let state = states.get(npc);
  if (!state) {
    state = { phase: "combat", fed: false, feeding: false, ratWaves: 0 };
    states.set(npc, state);
  }
  return state;
}

function scurriusIds() {
  const I = core.NpcIdentifiers;
  return [I.SCURRIUS, I.SCURRIUS_2];
}

function isScurrius(npc) {
  const id = npc?.getId?.();
  const realId = npc?.getRealId?.();
  return [id, realId].some((value) => value === core.NpcIdentifiers.SCURRIUS || value === core.NpcIdentifiers.SCURRIUS_2);
}

function isSummonedRat(npc) {
  const id = npc?.getId?.();
  const realId = npc?.getRealId?.();
  return id === core.NpcIdentifiers.GIANT_RAT_16 || realId === core.NpcIdentifiers.GIANT_RAT_16;
}

function ratbaneIds() {
  if (!ratbaneWeaponIds) {
    const I = core.ItemIdentifiers;
    ratbaneWeaponIds = new Set([
      I.BONE_MACE,
      I.BONE_MACE_2,
      I.BONE_SHORTBOW,
      I.BONE_SHORTBOW_2,
      I.BONE_STAFF,
      I.BONE_STAFF_2,
    ]);
  }
  return ratbaneWeaponIds;
}

function maxHitsFor(npc) {
  return isPublic(npc) ? PUBLIC_MAX_HITS : SOLO_MAX_HITS;
}

function isPublic(npc) {
  const id = npc?.getId?.();
  const realId = npc?.getRealId?.();
  return id === core.NpcIdentifiers.SCURRIUS || realId === core.NpcIdentifiers.SCURRIUS;
}

function pickAction(state) {
  // Phase 1: tail swipe, with the occasional stomp.
  if (state.phase === "combat") {
    return core.Misc.randomInclusive(0, 5) === 0 ? "rockfall" : "melee";
  }
  // Feeding/enraged: magic and ranged with the occasional stomp or summon.
  const feeding = state.phase === "feeding";
  const options = [];
  for (let i = 0; i < (feeding ? 4 : 5); i++) options.push("magic");
  for (let i = 0; i < (feeding ? 4 : 5); i++) options.push("ranged");
  options.push("rockfall", "summon");
  return options[core.Misc.randomInclusive(0, options.length - 1)];
}

function fireProjectile(character, target, projectileId) {
  const { Projectile } = core;
  Projectile.createProjectile(
    character,
    target,
    projectileId,
    40,
    Projectile.arrivalCycles(character, target),
    43,
    31
  ).sendProjectile();
}

function buildRockfallTiles(centre) {
  const { Misc } = core;
  const count = Misc.randomInclusive(ROCKFALL_TILES_MIN, ROCKFALL_TILES_MAX);
  const seen = new Set();
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const tile = centre.transform(
      Misc.randomInclusive(-ROCKFALL_SCATTER_RADIUS, ROCKFALL_SCATTER_RADIUS),
      Misc.randomInclusive(-ROCKFALL_SCATTER_RADIUS, ROCKFALL_SCATTER_RADIUS)
    );
    const key = `${tile.getX()},${tile.getY()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tiles.push(tile);
  }
  return tiles;
}

function scheduleRockfall(npc, target) {
  const { Graphic, HitDamage, HitMask, Misc, Task, TaskManager } = core;
  const tiles = buildRockfallTiles(target.getLocation());
  for (const tile of tiles) {
    target.getPacketSender().sendGlobalGraphic(new Graphic(ROCKFALL_TELEGRAPH), tile);
  }
  const maxHit = maxHitsFor(npc).rockfall;

  class RockfallTask extends Task {
    constructor() {
      super(ROCKFALL_WINDUP_TICKS, npc);
    }

    execute() {
      if (npc.getHitpoints() > 0) {
        for (const player of npc.getPlayersWithinDistance(ROCKFALL_SEARCH_RADIUS)) {
          if (!tiles.some((tile) => tile.equals(player.getLocation()))) {
            continue;
          }
          player
            .getCombat()
            .getHitQueue()
            .addPendingDamage([
              new HitDamage(Misc.randomInclusive(ROCKFALL_MIN_HIT, maxHit), HitMask.RED),
            ]);
        }
      }
      this.stop();
    }
  }

  TaskManager.submit(new RockfallTask());
}

function summonRats(npc, state) {
  if (state.ratWaves >= RAT_WAVE_LIMIT) {
    return;
  }
  state.ratWaves++;
  const { Misc, NPC, NpcIdentifiers, World } = core;
  for (let i = 0; i < RATS_PER_WAVE; i++) {
    const rat = NPC.create(
      NpcIdentifiers.GIANT_RAT_16,
      npc
        .getLocation()
        .transform(
          Misc.randomInclusive(-RAT_SPAWN_RADIUS, RAT_SPAWN_RADIUS),
          Misc.randomInclusive(-RAT_SPAWN_RADIUS, RAT_SPAWN_RADIUS)
        )
    );
    rat.__skipDefaultRespawn = true;
    World.getAddNPCQueue().push(rat);
  }
}

function nearestFoodPile(npc) {
  const { ObjectIdentifiers, World } = core;
  const pileIds = new Set([ObjectIdentifiers.FOOD_PILE, ObjectIdentifiers.FOOD_PILE_2]);
  const location = npc.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const object of World.getObjects()) {
    if (!pileIds.has(object.getId?.())) {
      continue;
    }
    const distance = object.getLocation().getDistance(location);
    if (distance <= FOOD_PILE_SEARCH_RADIUS && distance < bestDistance) {
      best = object.getLocation();
      bestDistance = distance;
    }
  }
  return best;
}

function stopScriptedWalk(npc) {
  npc.setScriptedMovement(false);
  core.TaskManager.cancelTasks(npc);
}

// A plugin-owned route: Combat stops pursuing while setScriptedMovement is on,
// so this task repaths as needed and hands control back on arrival.
function walkTo(npc, destination, onArrive) {
  const { PathFinder, Task, TaskManager } = core;
  const target = destination.clone();

  class ScriptedWalkTask extends Task {
    constructor() {
      super(1, npc);
      this.failedRepaths = 0;
    }

    execute() {
      if (!npc.isRegistered?.() || npc.getHitpoints() <= 0) {
        npc.setScriptedMovement(false);
        this.stop();
        return;
      }
      if (npc.getLocation().equals(target)) {
        npc.getMovementQueue().reset();
        npc.setScriptedMovement(false);
        this.stop();
        onArrive();
        return;
      }
      const movement = npc.getMovementQueue();
      if (movement.size() > 0 || movement.isMovings()) {
        this.failedRepaths = 0;
        return;
      }
      // Unreachable pile: give up rather than repath forever and freeze the boss.
      if (++this.failedRepaths > WALK_REPATH_LIMIT) {
        npc.setScriptedMovement(false);
        this.stop();
        onArrive();
        return;
      }
      PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
    }
  }

  stopScriptedWalk(npc);
  npc.setScriptedMovement(true);
  PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
  TaskManager.submit(new ScriptedWalkTask());
}

function startFeedingWalk(npc, state) {
  const pile = nearestFoodPile(npc);
  if (!pile) {
    // No food pile in range (arena not spawned); eat where we stand.
    startFeeding(npc, state);
    return;
  }
  walkTo(npc, pile, () => {
    if (state.phase === "feeding" && npc.getHitpoints() > 0) {
      startFeeding(npc, state);
    }
  });
}

function startFeeding(npc, state) {
  const { Task, TaskManager } = core;
  state.feeding = true;

  class FeedingTask extends Task {
    constructor() {
      super(HEAL_INTERVAL_TICKS, state);
      this.heals = 0;
    }

    execute() {
      const alive = npc.isRegistered?.() === true && npc.getHitpoints() > 0;
      if (!alive || !state.feeding) {
        state.feeding = false;
        if (state.phase === "feeding") {
          state.phase = "combat";
        }
        this.stop();
        return;
      }
      npc.heal(FEED_HEAL);
      this.heals++;
      if (this.heals >= FEED_HEAL_COUNT) {
        state.feeding = false;
        state.phase = "combat";
        this.stop();
      }
    }
  }

  TaskManager.submit(new FeedingTask());
}

function maybeAdvancePhase(npc) {
  const state = stateOf(npc);
  const maxHitpoints = npc.getDefinition()?.getHitpoints?.() ?? 0;
  if (maxHitpoints <= 0) {
    return;
  }
  const ratio = npc.getHitpoints() / maxHitpoints;
  if (ratio <= ENRAGE_THRESHOLD) {
    if (state.phase !== "enraged") {
      state.phase = "enraged";
      state.feeding = false;
      core.TaskManager.cancelTasks(state);
      // Phase 3: back to the centre of the arena, ranged/magic only.
      walkTo(npc, npc.getSpawnPosition(), () => {});
    }
    return;
  }
  if (state.phase === "enraged" || state.fed) {
    return;
  }
  if (ratio <= FEED_THRESHOLD) {
    state.fed = true;
    state.phase = "feeding";
    startFeedingWalk(npc, state);
  }
}

function trackScurriusPhase(event) {
  const npc = event.target;
  if (npc?.isNpc?.() && isScurrius(npc)) {
    maybeAdvancePhase(npc);
  }
}

// Ratbane weapons have no attack delay against the summoned giant rats.
function removeRatAttackDelay(event) {
  if (!isSummonedRat(event.target) || !event.player?.isPlayer?.()) {
    return;
  }
  const { Equipment } = core;
  const weaponId = event.player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
  if (ratbaneIds().has(weaponId)) {
    event.player.getCombat().setAttackDelay(0);
  }
}

// Any attack kills a summoned giant rat outright.
function oneShotSummonedRat(event) {
  if (!isSummonedRat(event.npc)) {
    return;
  }
  const hit = event.hit;
  if (!hit?.isAccurate?.() || !hit.getAttacker?.()?.isPlayer?.()) {
    return;
  }
  const hits = hit.getHits();
  for (let i = 0; i < hits.length; i++) {
    hits[i].setDamage(i === 0 ? Math.max(1, event.npc.getHitpoints()) : 0);
  }
  hit.updateTotalDamage();
}

function defineScurriusCombatMethod() {
  const { Animation, CombatMethod, CombatType, Graphic, PendingHit, Projectile } = core;

  return class ScurriusCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.RANGED;
      this.action = "melee";
    }

    type() {
      return this.stance;
    }

    // Chases into melee in phase 1; holds its ground at range while feeding or enraged.
    attackDistance(character) {
      return stateOf(character).phase === "combat" ? 1 : RANGED_PHASE_DISTANCE;
    }

    attackSpeed(character) {
      return stateOf(character).phase === "enraged"
        ? ENRAGED_ATTACK_SPEED
        : super.attackSpeed(character);
    }

    start(character, target) {
      const state = stateOf(character);
      this.action = pickAction(state);
      this.stance = CombatType.MELEE;
      if (this.action === "melee") {
        character.performAnimation(new Animation(MELEE_ANIMATION));
        return;
      }
      if (this.action === "rockfall") {
        character.performAnimation(new Animation(ROCKFALL_ANIMATION));
        scheduleRockfall(character, target);
        return;
      }
      if (this.action === "summon") {
        character.performAnimation(
          new Animation(state.phase === "feeding" ? FEEDING_SUMMON_ANIMATION : SUMMON_ANIMATION)
        );
        summonRats(character, state);
        return;
      }
      if (this.action === "ranged") {
        this.stance = CombatType.RANGED;
        character.performAnimation(
          new Animation(state.phase === "feeding" ? FEEDING_RANGED_ANIMATION : RANGED_ANIMATION)
        );
        fireProjectile(character, target, RANGED_PROJECTILE);
        return;
      }
      this.stance = CombatType.MAGIC;
      character.performAnimation(
        new Animation(state.phase === "feeding" ? FEEDING_MAGIC_ANIMATION : MAGIC_ANIMATION)
      );
      fireProjectile(character, target, MAGIC_PROJECTILE);
    }

    hits(character, target) {
      if (this.action === "rockfall" || this.action === "summon") {
        return [];
      }
      const maxHits = maxHitsFor(character);
      const delay =
        this.stance === CombatType.MELEE ? 1 : Projectile.arrivalTicks(character, target);
      const hit = new PendingHit(character, target, this, delay);
      const maxHit =
        this.stance === CombatType.RANGED
          ? maxHits.ranged
          : this.stance === CombatType.MAGIC
            ? maxHits.magic
            : maxHits.melee;
      core.CombatFactory.applyStyleDamage(hit, maxHit);
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target.isPlayer()) {
        return;
      }
      if (hit.getCombatType() === CombatType.RANGED) {
        target.performGraphic(new Graphic(RANGED_IMPACT));
      } else if (hit.getCombatType() === CombatType.MAGIC) {
        target.performGraphic(new Graphic(MAGIC_IMPACT));
      }
    }
  };
}

module.exports = {
  name: "Scurrius",
  register(api) {
    core = api.core;
    api.onNpcHitModify(oneShotSummonedRat);
    api.onPlayerDealtDamage(trackScurriusPhase);
    api.onPlayerDealtDamage(removeRatAttackDelay);
    api.registerNpcCombatMethodProvider(scurriusIds(), defineScurriusCombatMethod(), {
      singleton: false,
    });
  },
};
