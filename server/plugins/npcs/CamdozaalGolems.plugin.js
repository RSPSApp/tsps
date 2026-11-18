/**
 * Ruins of Camdozaal golem rubble.
 *
 * Every pile of rubble in the golem workshop can be awakened into its golem:
 * Flawed, Mind and Body golems are free-to-play, Chaos golems members-only
 * (OSRS Wiki: Flawed/Mind/Body/Chaos Golem). The rubble never moves.
 *
 * RSProx recording 2026-11-17 (rev 242.1, Flawed Golem rubble 10696, three awakenings):
 * Awaken plays ancient_guardian_awaken (8944) on the rubble, which turns into the
 * golem 4 ticks later in the same NPC slot and attacks the player who woke it. It
 * dies with ancient_guardian_death (8943) and the rubble returns on its spawn tile.
 * Capture 1636 line 41081 shows the same transformation for Chaos rubble 10690.
 *
 * Wiki: only one golem may be awake per player, and one left behind "will
 * disintegrate as if it died, without dropping any loot".
 */
const GOLEMS = [
  { rubble: "camdozaal_golem_flawed_rock", golem: "camdozaal_golem_flawed", members: false },
  { rubble: "camdozaal_golem_mind_rock", golem: "camdozaal_golem_mind", members: false },
  { rubble: "camdozaal_golem_body_rock", golem: "camdozaal_golem_body", members: false },
  { rubble: "camdozaal_golem_chaos_rock", golem: "camdozaal_golem_chaos", members: true },
];
const RUBBLE_NAME = "<col=00ffff>Rubble</col>";
const AWAKEN_SEQ = "ancient_guardian_awaken";
/** Ticks from the awaken animation to the golem form (rsprox 2026-11-17: seq at 381, golem at 385). */
const RISE_TICKS = 4;
/**
 * How far the player may walk from their golem before it disintegrates. The Wiki only
 * says "far away"; 16 tiles (outside the golem's view) is an estimate, not a capture.
 */
const DISINTEGRATE_DISTANCE = 16;
const ALREADY_AWAKE_MESSAGE = "You're already in combat with a golem. There's no time to awaken another.";
/** Not captured: live F2P wording for members-only rubble is unknown. */
const MEMBERS_MESSAGE = "You need to be on a members' world to awaken this golem.";
const CAMDOZAAL_BOUNDS = [2897, 5757, 3047, 5869, 0];

let pluginApi = null;
let golemByRubble = null;
const stateByPlayer = new WeakMap();
const stateByNpc = new WeakMap();

function golems() {
  if (golemByRubble) return golemByRubble;
  const cache = pluginApi.core.CacheDefinitions;
  golemByRubble = new Map(GOLEMS.map(row => [cache.getNpcId(row.rubble), { ...row, golemId: cache.getNpcId(row.golem) }]));
  return golemByRubble;
}

function awakenGolem(event) {
  const { player, npc } = event;
  const row = npc && golems().get(npc.getId());
  if (!player || !row) return false;
  const existing = stateByNpc.get(npc);
  if (existing && existing.owner !== player) return;
  if (stateByPlayer.has(player) || existing || npc.getNpcTransformationId() !== -1) {
    player.sendMessage(ALREADY_AWAKE_MESSAGE);
    return;
  }
  if (row.members && !pluginApi.core.WorldDefinition.isMembersWorld()) {
    player.sendMessage(MEMBERS_MESSAGE);
    return;
  }
  const state = { npc, owner: player, golemId: row.golemId, rising: RISE_TICKS };
  npc.setOwner?.(player);
  npc.getMovementQueue().reset();
  npc.getMovementQueue().setBlockMovement(true);
  npc.performAnimation(new pluginApi.core.Animation(pluginApi.core.CacheDefinitions.getSeqId(AWAKEN_SEQ)));
  stateByPlayer.set(player, state);
  stateByNpc.set(npc, state);
}

/** The golem forms in the rubble's slot with its own hitpoints, then goes for whoever woke it. */
function rise(state) {
  const { npc, owner } = state;
  const definition = pluginApi.core.NpcDefinition.forId(state.golemId);
  npc.setNpcTransformationId(state.golemId);
  npc.setMaxHitpoints(definition.getHitpoints());
  npc.setHitpoints(definition.getHitpoints());
  npc.getMovementQueue().setBlockMovement(false);
  if (owner.isRegistered() && owner.getHitpoints() > 0) npc.getCombat().attack(owner);
}

function forget(state) {
  stateByPlayer.delete(state.owner);
  stateByNpc.delete(state.npc);
}

/** It dies without a killer, so no loot drops, and the rubble respawns as after a kill. */
function disintegrate(state) {
  if (!state) return;
  forget(state);
  const npc = state.npc;
  npc.getMovementQueue().setBlockMovement(false);
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) return;
  if (npc.getNpcTransformationId() === -1) {
    // Still rubble (it was rising): it settles back where it lay.
    npc.setOwner?.(null);
    return;
  }
  npc.getCombat().reset();
  npc.getCombat().clearDamageMap();
  state.owner.getCombat?.().reset?.();
  npc.setOwner?.(null);
  npc.setHitpoints(0);
}

function processGolem(player) {
  const state = stateByPlayer.get(player);
  if (!state) return;
  const { npc } = state;
  if (!npc.isRegistered() || npc.getHitpoints() <= 0) return forget(state);
  if (state.rising > 0) {
    if (--state.rising === 0) rise(state);
    return;
  }
  const here = player.getLocation(), there = npc.getLocation();
  if (here.getZ() !== there.getZ() || here.getDistance(there) > DISINTEGRATE_DISTANCE) disintegrate(state);
}

function handleNpcDeath({ npc }) {
  const state = stateByNpc.get(npc);
  if (!state) return;
  forget(state);
  npc.setOwner?.(null);
}

function handleLogout({ player }) {
  disintegrate(stateByPlayer.get(player));
}

function createArea() {
  const { Area, Boundary } = pluginApi.core;
  const [minX, minY, maxX, maxY, z] = CAMDOZAAL_BOUNDS;
  return new (class CamdozaalGolemArea extends Area {
    constructor() { super([new Boundary(minX, maxX, minY, maxY, z)]); }
    process(actor) {
      if (!actor?.isPlayer?.()) return;
      const player = actor.getAsPlayer();
      processGolem(player);
      pluginApi.emitCustomEvent("camdozaal:area-process", { player });
    }
    postEnter(actor) {
      super.postEnter(actor);
      if (actor?.isPlayer?.()) pluginApi.emitCustomEvent("camdozaal:area-enter", { player: actor.getAsPlayer() });
    }
    postLeave(actor, logout) {
      if (actor?.isPlayer?.()) {
        const player = actor.getAsPlayer();
        disintegrate(stateByPlayer.get(player));
        pluginApi.emitCustomEvent("camdozaal:area-leave", { player });
      }
      super.postLeave(actor, logout);
    }
  })();
}

module.exports = {
  name: "CamdozaalGolems",
  description: "Lets players Awaken golem rubble in the Ruins of Camdozaal into Flawed, Mind, Body or (members) Chaos golems, which disintegrate if left behind.",
  register(api) {
    pluginApi = api;
    api.onNpcInteraction(RUBBLE_NAME, { Awaken: awakenGolem });
    api.onNpcDeath(handleNpcDeath);
    api.onPlayerLogout(handleLogout);
    api.registerArea(createArea());
  },
  _test: { RISE_TICKS, DISINTEGRATE_DISTANCE, stateByPlayer },
};
