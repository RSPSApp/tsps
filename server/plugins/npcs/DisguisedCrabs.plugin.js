/**
 * Crabs that sit disguised as scenery (Rocks, Boulder, Sandy rocks, Fossil Rock, Swampy log,
 * Sandy Boulder), from data/definitions/disguised-crabs.json:
 * - a player who steps next to one wakes it, unless the crab has become tolerant of them
 *   (crabs can only be fought while they are aggressive, Wiki): it rises (1316) as its crab
 *   form, with that form's hitpoints, standing still until the rise is over, then attacks;
 * - out of combat for a while it walks back to where it lay, sinks (1314) and is scenery
 *   again, healed.
 * Crabs sit on coasts all over the map, so this follows players by map square and drives one
 * task each tick over the players in crab squares and the crabs awake right now.
 */
const fs = require("fs");
const path = require("path");

/** Rock crabs killed towards the Fremennik easy task, the one diary task that counts. */
const ROCK_CRAB_KILLS_ATTRIBUTE = "disguised-crabs:rock-crab-kills";

let api = null;
let core = null;
let DATA = null;
/** Dormant npc id -> { family, awakeId }. */
const dormantIds = new Map();
/** "x,y,z" of each 64x64 map square that holds a dormant crab spawn. */
const crabSquares = new Set();
/** Players standing in a crab square. */
const watched = new Set();
/** Awake crabs -> { idle, hiding, rising (ticks left), target }. */
const awake = new Map();

const squareKey = (location) => `${location.getX() >> 6},${location.getY() >> 6},${location.getZ()}`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, file), "utf8"));
}

/** Loads the data, finds the crab squares from the spawns and starts the task. */
function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DATA = readJson("disguised-crabs.json");
  for (const family of DATA.families) {
    for (const id of family.dormant) dormantIds.set(id, { family, awakeId: family.awake[id] });
  }
  for (const spawn of readJson("npc-spawns.json")) {
    if (!dormantIds.has(spawn.id)) continue;
    crabSquares.add(`${spawn.x >> 6},${spawn.y >> 6},${spawn.level ?? spawn.z ?? 0}`);
  }
  core.TaskManager.submit(new (class CrabsTask extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick();
    }
  })());
}

function track({ player }) {
  if (crabSquares.has(squareKey(player.getLocation()))) watched.add(player);
  else watched.delete(player);
}

function forget({ player }) {
  watched.delete(player);
}

/** Every crab beside the player rises; whether each may attack is the combat rules' call. */
function wakeNear(player) {
  if (!canBeWokenBy(player)) return;
  const at = player.getLocation();
  for (const npc of player.getLocalNpcs?.() ?? []) {
    if (!npc || !dormantIds.has(npc.getId()) || npc.getHitpoints() <= 0) continue;
    if (npc.getLocation().getZ() !== at.getZ() || npc.getLocation().getDistance(at) > DATA.wakeRange) continue;
    if (aggressiveTo(player, dormantIds.get(npc.getId()).awakeId)) wake(npc, player);
  }
}

/** Whether this crab would still be aggressive towards the player (Wiki, Tolerance). */
function aggressiveTo(player, awakeId) {
  const definition = core.NpcDefinition.forId(awakeId);
  return !definition?.buildsAggressionTolerance?.() || !player.getAggressionTolerance().finished();
}

function canBeWokenBy(player) {
  return player.isRegistered() && player.getHitpoints() > 0;
}

function wake(npc, player) {
  const { awakeId } = dormantIds.get(npc.getId());
  const definition = core.NpcDefinition.forId(awakeId);
  npc.setNpcTransformationId(awakeId);
  npc.setMaxHitpoints(definition.getHitpoints());
  npc.setHitpoints(definition.getHitpoints());
  npc.performAnimation(new core.Animation(DATA.revealAnim));
  // It stays put while it rises: walking (to a side tile, say) would cut the rise short.
  npc.getMovementQueue().reset();
  npc.getMovementQueue().setBlockMovement(true);
  awake.set(npc, { idle: 0, hiding: false, rising: DATA.revealTicks, target: player });
}

/** Risen: free to move, and goes for whoever woke it. */
function risen(npc, state) {
  state.rising = 0;
  npc.getMovementQueue().setBlockMovement(false);
  if (state.target?.isRegistered?.() && state.target.getHitpoints() > 0) npc.getCombat().attack(state.target);
  state.target = null;
}

/** Back to scenery (its base form, as it spawned), healed. */
function sleep(npc) {
  npc.setNpcTransformationId(-1);
  npc.setMaxHitpoints(-1);
  npc.setHitpoints(npc.getMaxHitpoints());
  awake.delete(npc);
}

/** Awake: resting resets in combat; after a while it walks home, sinks, and sleeps. */
function restTick(npc, state) {
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) {
    awake.delete(npc);
    return;
  }
  if (state.rising > 0) {
    if (--state.rising === 0) risen(npc, state);
    return;
  }
  if (state.hiding) {
    sleep(npc);
    return;
  }
  if (core.CombatFactory.inCombat(npc)) {
    state.idle = 0;
    return;
  }
  state.idle++;
  if (state.idle < DATA.restTicks) return;
  const home = npc.getSpawnPosition();
  const atHome = npc.getLocation().equals(home);
  if (!atHome && state.idle < DATA.restTicks + DATA.returnGraceTicks) {
    const movement = npc.getMovementQueue();
    if (movement.size() === 0 && !movement.isMovings()) core.PathFinder.calculateWalkRoute(npc, home.getX(), home.getY());
    return;
  }
  npc.getMovementQueue().reset();
  npc.setMobileInteraction?.(null);
  npc.performAnimation(new core.Animation(DATA.hideAnim));
  state.hiding = true;
}

function tick() {
  for (const player of watched) {
    if (!player.isRegistered()) watched.delete(player);
    else wakeNear(player);
  }
  for (const [npc, state] of awake) restTick(npc, state);
}

/** Kourend easy "Kill a Sandcrab" and Fremennik easy "Kill 5 Rock crabs". */
function killed({ killer, npc }) {
  awake.delete(npc);
  if (!killer?.isPlayer?.()) return;
  const name = npc.getCurrentDefinition?.()?.getName?.();
  for (const task of DATA?.diary ?? []) {
    if (task.name !== name) continue;
    const kills = task.count > 1 ? (Number(killer.getAttribute(ROCK_CRAB_KILLS_ATTRIBUTE)) || 0) + 1 : 1;
    if (task.count > 1) killer.setAttribute(ROCK_CRAB_KILLS_ATTRIBUTE, kills);
    if (kills >= task.count) api.emitCustomEvent("diary:task", { player: killer, diary: task.diary, task: task.task });
  }
}

module.exports = {
  name: "DisguisedCrabs",
  members: true,
  register(pluginApi) {
    pluginApi.persistAttribute(ROCK_CRAB_KILLS_ATTRIBUTE);
    pluginApi.onServerStartup(() => start(pluginApi));
    pluginApi.onPlayerLogin(track);
    pluginApi.onPlayerMapSquareChange(track);
    pluginApi.onPlayerLogout(forget);
    pluginApi.onPlayerDisconnect(forget);
    pluginApi.onNpcDeath(killed);
  },
  _test: { start, track, tick, wake, sleep, killed, watched, awake, crabSquares, dormantIds },
};
