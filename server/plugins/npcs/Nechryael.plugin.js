"use strict";

/**
 * Nechryael and greater nechryael summon death spawns (docs/nechryael.md):
 * - an attack may be a summon instead of a hit: the nechryael plays demons_bringdead with
 *   sound 2418, and a death spawn appears on a free tile beside its target, with the
 *   demon_spawn_portal graphic, and attacks that target as it joins the world (rsprox
 *   recordings 90, 4092: on the tick it appears or the next);
 * - at most two of a nechryael's death spawns are alive at a time (Wiki: Nechryael);
 * - a death spawn that isn't killed leaves the world 99 ticks after it appeared (recordings 90
 *   and 4092: every uncut lifetime), stops attacking a target more than 7 tiles away and hits
 *   through protection prayers (Wiki: Death spawn);
 * - it fights alongside its nechryael in single-way combat, never draws the target's
 *   auto-retaliate and doesn't keep the target from logging out (Wiki: Death spawn).
 */
const NECHRYAEL_NAMES = ["NECHRYAEL", "NECHRYAEL_2", "GREATER_NECHRYAEL", "GREATER_NECHRYAEL_2"];
const DEATH_SPAWN_NAME = "Death spawn";
/** demons_bringdead and the sound every recorded summon played. */
const SUMMON_ANIMATION = 1529;
const SUMMON_SOUND = 2418;
/** demon_spawn_portal, at the height recording 90 gives it. */
const PORTAL_GRAPHIC = 333;
const PORTAL_HEIGHT = 92;
const MAX_SPAWNS = 2;
/**
 * Ours: one attack in six is a summon while a nechryael has room for one. No source states the
 * chance; recordings 90, 3314 and 4092 have 163 summons in 986 attacks below the cap (16.5%).
 */
const SUMMON_ONE_IN = 6;
const LIFETIME_TICKS = 99;
const LEASH_TILES = 7;
const BESIDE = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

let api = null;
let core = null;
/** Each nechryael's death spawns. */
const spawnsOf = new WeakMap();
/** Nechryael whose current attack is a summon, so their hits() hit nothing. */
const summoning = new WeakSet();
/** Each death spawn's target and the tick it leaves. */
const spawnState = new WeakMap();

const alive = (npc) => npc.isRegistered?.() !== false && npc.getHitpoints() > 0;

/** Dead, or out of the world after joining it (a new spawn waits a tick in the add queue). */
function gone(spawn) {
  const state = spawnState.get(spawn);
  if (spawn.getHitpoints() <= 0) return true;
  if (spawn.isRegistered()) {
    state.joined = true;
    return false;
  }
  return state.joined === true;
}

function liveSpawns(nechryael) {
  const spawns = (spawnsOf.get(nechryael) ?? []).filter((spawn) => !gone(spawn));
  spawnsOf.set(nechryael, spawns);
  return spawns;
}

function isDeathSpawn(mobile) {
  return mobile?.isNpc?.() === true && mobile.getCurrentDefinition?.()?.getName?.() === DEATH_SPAWN_NAME;
}

function occupied(tile, privateArea) {
  return core.World.getNpcsNear(tile, 0, privateArea).some((npc) => alive(npc) && npc.getLocation().equals(tile));
}

/** Ours: a random open tile of the eight beside the target; recordings show all eight used. */
function freeTileBeside(target) {
  const at = target.getLocation();
  const offsets = [...BESIDE].sort(() => Math.random() - 0.5);
  for (const [dx, dy] of offsets) {
    const tile = new core.Location(at.getX() + dx, at.getY() + dy, at.getZ());
    const area = target.getPrivateArea?.() ?? null;
    if (!core.RegionManager.blocked(tile, area) && !occupied(tile, area)) return tile;
  }
  return null;
}

function summon(nechryael, target) {
  const tile = freeTileBeside(target);
  if (!tile) return false;
  const spawn = api.spawnNpc({ id: core.NpcIdentifiers.DEATH_SPAWN, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0 });
  if (!spawn) return false;
  spawn.__skipDefaultRespawn = true;
  spawn.setMultiCombat(true);
  spawn.setFlag(core.CombatFactory.BYSTANDER_FLAG);
  nechryael.getPrivateArea?.()?.add?.(spawn);
  spawnState.set(spawn, { target, leaves: core.World.getProcessCycle() + LIFETIME_TICKS, joined: false, engaged: false });
  spawnsOf.set(nechryael, [...liveSpawns(nechryael), spawn]);
  nechryael.performAnimation(new core.Animation(SUMMON_ANIMATION));
  target.getPacketSender?.().sendSound(SUMMON_SOUND, 1, 0);
  target.getPacketSender?.().sendGlobalGraphic(new core.Graphic(PORTAL_GRAPHIC, 0, PORTAL_HEIGHT), tile);
  core.TaskManager.submit(new DeathSpawnTask(spawn));
  return true;
}

/** On a nechryael's attack against a player: the summon roll, while it has room for a spawn. */
function maybeSummon(nechryael, target) {
  if (!target?.isPlayer?.() || liveSpawns(nechryael).length >= MAX_SPAWNS) return false;
  if (core.Misc.getRandom(SUMMON_ONE_IN - 1) !== 0) return false;
  return summon(nechryael, target);
}

/**
 * Each tick of a death spawn: it attacks its target once it is in the world, leaves when its
 * time is up and drops a target that went more than 7 tiles away.
 */
function tickDeathSpawn(spawn) {
  if (gone(spawn)) return false;
  const state = spawnState.get(spawn);
  if (core.World.getProcessCycle() >= state.leaves) {
    api.removeNpc(spawn);
    return false;
  }
  if (!spawn.isRegistered()) return true;
  if (!state.engaged) {
    state.engaged = true;
    if (alive(state.target)) spawn.getCombat().attack(state.target);
    return true;
  }
  const target = spawn.getCombat().getTarget();
  if (target && !target.getLocation().isWithinDistance(spawn.getLocation(), LEASH_TILES)) {
    spawn.getCombat().reset();
  }
  return true;
}

let DeathSpawnTask = null;

function defineDeathSpawnTask() {
  return class extends core.Task {
    constructor(spawn) {
      super(1, spawn, false);
      this.spawn = spawn;
    }

    execute() {
      if (!tickDeathSpawn(this.spawn)) this.stop();
    }
  };
}

function defineNechryaelCombatMethod() {
  return class NechryaelCombatMethod extends core.MeleeCombatMethod {
    start(character, target) {
      if (maybeSummon(character, target)) {
        summoning.add(character);
        return;
      }
      summoning.delete(character);
      super.start(character, target);
    }

    hits(character, target) {
      if (summoning.has(character)) return [];
      return super.hits(character, target);
    }
  };
}

/** Wiki (Death spawn): their attacks hit through protection prayers. */
function deathSpawnPierces(roll) {
  if (isDeathSpawn(roll.attacker) && roll.target?.isPlayer?.()) roll.bypassProtectionPrayer = true;
}

function nechryaelIds() {
  return NECHRYAEL_NAMES.map((name) => core.NpcIdentifiers[name]);
}

function initialise(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DeathSpawnTask = defineDeathSpawnTask();
}

module.exports = {
  name: "Nechryael",
  description: "Lets nechryael and greater nechryael summon up to two death spawns that hit through protection prayers and leave after a minute.",
  members: true,
  register(pluginApi) {
    initialise(pluginApi);
    pluginApi.registerNpcCombatMethodProvider(nechryaelIds(), defineNechryaelCombatMethod());
    pluginApi.onCombatHitRoll(deathSpawnPierces);
  },
};

Object.assign(module.exports, { _test: { maybeSummon, summon, liveSpawns, tickDeathSpawn, freeTileBeside, isDeathSpawn, spawnState } });
