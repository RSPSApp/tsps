/**
 * NPCs that lie dormant until woken, from data/definitions/dormant-npcs.json. Each family has
 * its dormant and awake ids, its rise and sink animations, and what wakes it:
 * - "approach": crabs disguised as scenery (Rocks, Boulder, Sandy rocks, Fossil Rock, Swampy
 *   log, Sandy Boulder). A player who steps next to one wakes it, unless the crab has become
 *   tolerant of them (crabs can only be fought while they are aggressive, Wiki);
 * - "attacked": wyrms and wyrmlings slithering on the ground rise when a player attacks them
 *   (Wiki);
 * - "picked": Zanaris' zygomites stand as Fungi until a player picks one (rsprox captures,
 *   docs/dormant-npcs.md): the tick after arriving the player plays the pick animation, and
 *   on the next tick the cap leaps out as the zygomite, which can't be attacked until it has
 *   risen.
 * Woken, it rises as its awake form, with that form's hitpoints, standing still and not
 * attacking until the rise is over, then attacks whoever woke it. Out of combat for a while it
 * walks back to where it lay, sinks and is dormant again, healed.
 * Crabs sit on coasts all over the map, so this follows players by map square and drives one
 * task each tick over the players in crab squares and the NPCs awake right now.
 */
const fs = require("fs");
const path = require("path");

/** Rock crabs killed towards the Fremennik easy task, the one diary task that counts. */
const ROCK_CRAB_KILLS_ATTRIBUTE = "disguised-crabs:rock-crab-kills";
/** Emitted when an awake NPC turns back into its dormant form. */
const SLEPT_EVENT = "dormant-npcs:slept";

let api = null;
let core = null;
let DATA = null;
/** Dormant npc id -> { family, awakeId }. */
const dormantIds = new Map();
/** "x,y,z" of each 64x64 map square that holds a dormant spawn woken by approach. */
const crabSquares = new Set();
/** Players standing in a crab square. */
const watched = new Set();
/** Awake NPCs -> { family, idle, hiding (ticks left), rising (ticks left), target }. */
const awake = new Map();
/** Picked caps, not yet risen -> { player, at (where they picked), wait (ticks to the pick), ticks (then to the rise) }. */
const picking = new Map();

const squareKey = (location) => `${location.getX() >> 6},${location.getY() >> 6},${location.getZ()}`;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, file), "utf8"));
}

/** Loads the data, finds the crab squares from the spawns and starts the task. */
function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  DATA = readJson("dormant-npcs.json");
  for (const family of DATA.families) {
    for (const id of family.dormant) dormantIds.set(id, { family, awakeId: family.awake[id] });
  }
  for (const spawn of readJson("npc-spawns.json")) {
    if (dormantIds.get(spawn.id)?.family.trigger !== "approach") continue;
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
    if (!npc || dormantIds.get(npc.getId())?.family.trigger !== "approach" || npc.getHitpoints() <= 0) continue;
    if (npc.getLocation().getZ() !== at.getZ() || npc.getLocation().getDistance(at) > DATA.wakeRange) continue;
    if (aggressiveTo(player, npc, dormantIds.get(npc.getId()).awakeId)) wake(npc, player);
  }
}

/**
 * Whether this crab would still be aggressive towards the player (Wiki, Tolerance). Plugins that
 * keep monsters aggressive past tolerance (::aggro) answer through the same hook as for any NPC.
 */
function aggressiveTo(player, npc, awakeId) {
  const definition = core.NpcDefinition.forId(awakeId);
  return !definition?.buildsAggressionTolerance?.() || !player.getAggressionTolerance().finished()
    || core.PluginManager.emitNpcAggressionTolerance(player, npc) === true;
}

function canBeWokenBy(player) {
  return player.isRegistered() && player.getHitpoints() > 0;
}

function wake(npc, player) {
  const { family, awakeId } = dormantIds.get(npc.getId());
  const definition = core.NpcDefinition.forId(awakeId);
  npc.setNpcTransformationId(awakeId);
  npc.setMaxHitpoints(definition.getHitpoints());
  npc.setHitpoints(definition.getHitpoints());
  npc.performAnimation(new core.Animation(family.revealAnim));
  if (family.revealSound != null) player.getPacketSender?.().sendSound(family.revealSound, 1, 0);
  // It stays put while it rises: walking (to a side tile, say) would cut the rise short.
  npc.getMovementQueue().reset();
  npc.getMovementQueue().setBlockMovement(true);
  awake.set(npc, { family, idle: 0, hiding: 0, rising: family.revealTicks, target: player });
}

/**
 * Pick on a dormant "picked" NPC (a zygomite's Fungi), on arrival: refused while the player is
 * fighting something; otherwise the pick animation and sound come a tick later, and the NPC
 * rises the tick after that (rsprox captures).
 */
function pick({ player, npc }) {
  const entry = dormantIds.get(npc.getId());
  if (entry?.family.trigger !== "picked") return false;
  const { family } = entry;
  if (core.CombatFactory.inCombat(player)) {
    player.sendMessage(family.inCombatMessage);
    return true;
  }
  // Ours: a cap someone has just picked is theirs until it rises; a second pick does nothing.
  if (picking.has(npc) || npc.getHitpoints() <= 0) return true;
  picking.set(npc, { player, at: player.getLocation(), wait: family.pickDelay, ticks: family.pickTicks });
  return true;
}

/**
 * The pick plays once its delay is over, then the cap rises for its picker, if they are still
 * there to fight. Ours: a picker who has walked off by then doesn't pick.
 */
function pickTick(npc, state) {
  if (state.wait > 0) {
    if (--state.wait > 0) return;
    const { family } = dormantIds.get(npc.getId()) ?? {};
    if (!family || !canBeWokenBy(state.player) || !state.player.getLocation().equals(state.at)) {
      picking.delete(npc);
      return;
    }
    state.player.performAnimation(new core.Animation(family.pickAnim));
    state.player.getPacketSender().sendSound(family.pickSound, 1, 0);
    return;
  }
  if (--state.ticks > 0) return;
  picking.delete(npc);
  if (!npc.isRegistered() || npc.getHitpoints() <= 0 || awake.has(npc) || !canBeWokenBy(state.player)) return;
  wake(npc, state.player);
}

/**
 * A player attacking a dormant "attacked" NPC wakes it; nothing that is still rising attacks
 * back; and a picked one can't be attacked until it has risen (live disables its options).
 */
function onAttack(event) {
  const { attacker, target } = event;
  if (attacker?.isNpc?.() && (awake.get(attacker)?.rising ?? 0) > 0) {
    event.allow = false;
    return;
  }
  const rising = awake.get(target);
  if (attacker?.isPlayer?.() && rising?.rising > 0 && rising.family.trigger === "picked") {
    event.allow = false;
    return;
  }
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || awake.has(target) || target.getHitpoints() <= 0) return;
  if (dormantIds.get(target.getId())?.family.trigger === "attacked") wake(target, attacker);
}

/** Risen: free to move, and goes for whoever woke it. */
function risen(npc, state) {
  state.rising = 0;
  npc.getMovementQueue().setBlockMovement(false);
  if (state.target?.isRegistered?.() && state.target.getHitpoints() > 0) npc.getCombat().attack(state.target);
  state.target = null;
}

/**
 * Back to scenery (its base form, as it spawned), healed, with its last fight's damage forgotten
 * so a later kill goes to whoever fights it next. `dormant-npcs:slept` { npc } tells
 * whatever kept state on the awake form (a Slayer finisher's last-legs line) to forget it.
 */
function sleep(npc) {
  npc.setNpcTransformationId(-1);
  npc.setMaxHitpoints(-1);
  npc.setHitpoints(npc.getMaxHitpoints());
  npc.getCombat?.()?.clearDamageMap?.();
  awake.delete(npc);
  api?.emitCustomEvent?.(SLEPT_EVENT, { npc });
}

/**
 * Awake: resting resets in combat; after a while it walks home, sinks, and sleeps. One left on
 * 0 hitpoints without dying (a zygomite waiting for its fungicide) rests and heals the same way.
 */
function restTick(npc, state) {
  if (!npc.isRegistered() || npc.isDyingFunction?.() === true) {
    awake.delete(npc);
    return;
  }
  if (state.rising > 0) {
    if (--state.rising === 0) risen(npc, state);
    return;
  }
  if (state.hiding > 0) {
    if (--state.hiding === 0) sleep(npc);
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
  if (state.family.hideAnim != null) npc.performAnimation(new core.Animation(state.family.hideAnim));
  state.hiding = state.family.hideTicks;
}

function tick() {
  for (const player of watched) {
    if (!player.isRegistered()) watched.delete(player);
    else wakeNear(player);
  }
  for (const [npc, state] of awake) restTick(npc, state);
  // After the awake ones, so a cap that rises now starts its rise next tick.
  for (const [npc, state] of picking) pickTick(npc, state);
}

/** Whether a task's optional bounding boxes contain the NPC's tile. */
function inTaskArea(task, location) {
  if (!Array.isArray(task.areas) || task.areas.length === 0) return true;
  if (!location) return false;
  const x = location.getX();
  const y = location.getY();
  return task.areas.some(([minX, maxX, minY, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

/** Kourend easy "Kill a Sandcrab" (not in Varlamore) and Fremennik easy "Kill 5 Rock crabs". */
function killed({ killer, npc }) {
  awake.delete(npc);
  picking.delete(npc);
  if (!killer?.isPlayer?.()) return;
  const name = npc.getCurrentDefinition?.()?.getName?.();
  for (const task of DATA?.diary ?? []) {
    if (task.name !== name || !inTaskArea(task, npc.getLocation?.())) continue;
    const kills = task.count > 1 ? (Number(killer.getAttribute(ROCK_CRAB_KILLS_ATTRIBUTE)) || 0) + 1 : 1;
    if (task.count > 1) killer.setAttribute(ROCK_CRAB_KILLS_ATTRIBUTE, kills);
    if (kills >= task.count) api.emitCustomEvent("diary:task", { player: killer, diary: task.diary, task: task.task });
  }
}

/** Playable encounter IDs, read without starting a run or rolling rewards. */
function describeEncounters({ npcIds }) {
  for (const family of DATA?.families ?? []) for (const id of Object.values(family.awake)) npcIds.add(id);
}

module.exports = {
  name: "DormantNpcs",
  description: "Makes disguised crabs, wyrms and Zanaris' zygomites lie dormant as scenery, rising and sinking when a player steps near, attacks or picks them.",
  members: true,
  register(pluginApi) {
    pluginApi.persistAttribute(ROCK_CRAB_KILLS_ATTRIBUTE);
    pluginApi.onServerStartup(() => start(pluginApi));
    pluginApi.onPlayerLogin(track);
    pluginApi.onPlayerMapSquareChange(track);
    pluginApi.onPlayerLogout(forget);
    pluginApi.onPlayerDisconnect(forget);
    pluginApi.onNpcDeath(killed);
    pluginApi.onCustomEvent("bestiary:encounters", describeEncounters);
    pluginApi.onCanAttack(onAttack);
    pluginApi.onNpcInteraction("Fungi", { Pick: pick });
  },
  _test: { start, track, tick, wake, sleep, killed, onAttack, pick, inTaskArea, watched, awake, picking, crabSquares, dormantIds },
};
