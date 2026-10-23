/**
 * Ruins of Camdozaal golem rubble.
 *
 * Capture 1636 line 41081: clicking Awaken on Rubble 10690 transforms that same
 * NPC index into Chaos Golem 10689; the golem is then fought normally and uses the
 * canonical chaos_golem drop table (Chaos core is tertiary 2/15, not guaranteed).
 * Chaos Golems are members-only content.
 */
const CHAOS_RUBBLE = 10690;
const CHAOS_GOLEM = 10689;
const CHAOS_RUBBLE_NAME = "<col=00ffff>Rubble</col>";
const CAMDOZAAL_BOUNDS = [2897, 5757, 3047, 5869, 0];

let pluginApi = null;
const stateByPlayer = new WeakMap();
const stateByNpc = new WeakMap();

function awakenChaosGolem(event) {
  const { player, npcId, npc, definition, clickType } = event;
  if (!player || npcId !== CHAOS_RUBBLE || !npc) return;
  const action = (definition?.getActions?.() ?? definition?.getInteractions?.())?.[clickType - 1];
  if (action !== "Awaken") return;
  if (stateByPlayer.has(player)) {
    player.sendMessage("You're already in combat with a golem. There's no time to awaken another.");
    return;
  }
  if (stateByNpc.has(npc) || npc.getNpcTransformationId?.() === CHAOS_GOLEM) {
    player.sendMessage("You're already in combat with a golem. There's no time to awaken another.");
    return;
  }
  const state = {
    npc,
    owner: player,
    originalId: npc.getRealId?.() ?? CHAOS_RUBBLE,
    originalMax: npc.getMaxHitpoints?.() ?? npc.getHitpoints?.(),
    originalPosition: npc.getLocation?.().clone?.(),
    originalOwner: npc.getOwner?.() ?? null,
  };
  npc.setNpcTransformationId(CHAOS_GOLEM);
  npc.setHitpoints(npc.getMaxHitpoints());
  npc.setOwner?.(player);
  stateByPlayer.set(player, state);
  stateByNpc.set(npc, state);
}

function forget(state) {
  stateByPlayer.delete(state.owner);
  stateByNpc.delete(state.npc);
}

/** Restore the real world rubble slot exactly once, including position and ownership. */
function restoreGolem(state) {
  if (!state) return;
  forget(state);
  const npc = state.npc;
  if (!npc?.isRegistered?.() || npc.getHitpoints?.() <= 0) return;
  npc.setNpcTransformationId(state.originalId);
  npc.setHitpoints(state.originalMax ?? npc.getMaxHitpoints());
  npc.setOwner?.(state.originalOwner);
  if (state.originalPosition) npc.moveTo(state.originalPosition);
  npc.getMovementQueue?.().reset?.();
  npc.getCombat?.().reset?.();
  state.owner.getCombat?.().reset?.();
}

function handleNpcDeath({ npc }) {
  const state = stateByNpc.get(npc);
  if (!state) return;
  // Restore the real rubble id/owner for the normal respawn; never revive the dead actor.
  forget(state);
  npc.setNpcTransformationId(state.originalId);
  npc.setOwner?.(state.originalOwner);
}

function handleLogout({ player }) {
  restoreGolem(stateByPlayer.get(player));
}

function createArea() {
  const { Area, Boundary } = pluginApi.core;
  const [minX, minY, maxX, maxY, z] = CAMDOZAAL_BOUNDS;
  return new (class CamdozaalGolemArea extends Area {
    constructor() { super([new Boundary(minX, maxX, minY, maxY, z)]); }
    postLeave(actor, logout) {
      if (actor?.isPlayer?.()) restoreGolem(stateByPlayer.get(actor.getAsPlayer()));
      super.postLeave(actor, logout);
    }
  })();
}

module.exports = {
  name: "CamdozaalGolems",
  members: true,
  register(api) {
    pluginApi = api;
    api.onNpcInteraction(CHAOS_RUBBLE_NAME, { Awaken: awakenChaosGolem });
    api.onNpcDeath(handleNpcDeath);
    api.onPlayerLogout(handleLogout);
    api.registerArea(createArea());
  },
};
