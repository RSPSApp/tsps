/**
 * The Chapter V fight is an attempt, not saved quest progress. The Wiki gives
 * 575 HP and retreats at 75% and 50%; leaving or dying starts a fresh attempt.
 * The encounter owner supplies the actual room movement and actor teardown.
 */
const MAX_HITPOINTS = 575;
const FIGHT_STAGE = 160;
const SECOND_ROOM_THRESHOLD = Math.floor(MAX_HITPOINTS * 0.75);
const FINAL_ROOM_THRESHOLD = Math.floor(MAX_HITPOINTS * 0.5);

function phaseForHitpoints(hitpoints) {
  if (hitpoints <= FINAL_ROOM_THRESHOLD) return 2;
  if (hitpoints <= SECOND_ROOM_THRESHOLD) return 1;
  return 0;
}

function createEncounterLifecycle({ stageOf, contains, retreat, arrived, remove }) {
  const players = new WeakMap();
  const bosses = new WeakMap();

  function current(state) {
    return !!state && state.active
      && players.get(state.player) === state && bosses.get(state.boss) === state;
  }

  function ownerCanContinue(state) {
    return current(state) && state.player.isRegistered()
      && state.player.getHitpoints() > 0 && stageOf(state.player) === FIGHT_STAGE
      && state.boss.getOwner() === state.player && contains(state);
  }

  function cancel(state, reason) {
    if (!current(state)) return false;
    // Invalidate first: removing an actor may synchronously deliver other hooks.
    state.active = false;
    players.delete(state.player);
    bosses.delete(state.boss);
    remove(state, reason);
    return true;
  }

  function begin(player, boss) {
    if (!player.isRegistered() || player.getHitpoints() <= 0
      || stageOf(player) !== FIGHT_STAGE || !boss.isRegistered()
      || boss.getOwner() !== player || boss.getHitpoints() !== MAX_HITPOINTS) return null;
    cancel(players.get(player), "replaced");
    const state = { player, boss, phase: 0, pendingPhase: null, active: true,
      finalDeath: false, deferredLethal: false };
    players.set(player, state);
    bosses.set(boss, state);
    if (!contains(state)) {
      cancel(state, "outside");
      return null;
    }
    return state;
  }

  function process(state) {
    if (!current(state)) return;
    if (!ownerCanContinue(state)) {
      cancel(state, "owner-left-or-died");
      return;
    }
    if (!state.boss.isRegistered()) {
      cancel(state, "boss-removed");
      return;
    }
    if (state.pendingPhase !== null) {
      if (!arrived(state, state.pendingPhase)) return;
      state.phase = state.pendingPhase;
      state.pendingPhase = null;
      return;
    }
    // A lethal hit during a retreat remains lethal. The before-death boundary
    // keeps a temporary, non-attackable actor alive solely to finish the room
    // sequence; it does not discard the hit or grant premature quest credit.
    if (state.deferredLethal && state.phase === 2) {
      state.deferredLethal = false;
      state.boss.setHitpoints(0);
      return;
    }
    const hitpoints = state.boss.getHitpoints();
    if (hitpoints <= 0 || state.finalDeath) return;
    const desiredPhase = state.deferredLethal ? 2 : phaseForHitpoints(hitpoints);
    if (state.phase < desiredPhase) {
      const nextPhase = state.phase + 1;
      if (retreat(state, nextPhase) !== true) {
        cancel(state, "retreat-failed");
        return;
      }
      state.pendingPhase = nextPhase;
    }
  }

  function beforeDeath(boss) {
    const state = bosses.get(boss);
    if (!current(state)) return null;
    // Final credit is only a candidate here. The delayed death callback must
    // still belong to this same attempt and a living player in the encounter.
    if (!ownerCanContinue(state) || boss.getHitpoints() > 0) {
      cancel(state, "invalid-death");
      return "cancelled";
    }
    if (state.phase !== 2 || state.pendingPhase !== null) {
      state.deferredLethal = true;
      boss.setHitpoints(1);
      return "deferred";
    }
    state.finalDeath = true;
    return "final";
  }

  function claimVictory(player, boss) {
    const state = bosses.get(boss);
    if (!ownerCanContinue(state) || state.player !== player || state.phase !== 2 || state.pendingPhase !== null
      || !state.finalDeath || boss.getHitpoints() > 0) return false;
    // Consume before the caller advances the quest or starts dialogue. Duplicate
    // and stale death events cannot award credit a second time.
    state.active = false;
    players.delete(player);
    bosses.delete(boss);
    return true;
  }

  function leave(player, reason = "left") {
    return cancel(players.get(player), reason);
  }

  return { begin, process, beforeDeath, claimVictory, leave,
    forPlayer: (player) => players.get(player) ?? null,
    forBoss: (boss) => bosses.get(boss) ?? null };
}

module.exports = { MAX_HITPOINTS, FIGHT_STAGE, phaseForHitpoints, createEncounterLifecycle };
