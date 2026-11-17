"use strict";

/**
 * The two guards shouting from their watchtowers between Jatizso and Neitiznot (plane 2), as rsprox
 * recordings 3027 (rev 231, four Watch-shouting clicks) and local 1000323 (rev 227, one) show:
 * - between rounds each guard chants its island's name ("JATIZSO!" / "NEITIZNOT!") every 6
 *   ticks, facing the other guard;
 * - the round's lines and the chants are the generated Wiki transcript's (`watching-the-shouting`
 *   of Guard (Jatizso watchtower)), read at startup;
 * - Watch-shouting on either guard moves that player's camera behind the clicked guard, looking
 *   at the other one, and 3 ticks after the player arrives the guards trade the 11-line round of
 *   insults, one line every 5 ticks, the Jatizso guard first. Chants stop for the round and
 *   resume (Jatizso +58, Neitiznot +64 from the round's start); the camera resets at +63.
 * - The lines are the Wiki transcripts' ("CALL THAT A TOWN, I'VE SEEN BETTER HAMLETS!"); recorded
 *   difference: after the three Jatizso-guard clicks rec 3027 shows "CALL THAT A TOWN? ...".
 * - Talk-to's "Can I watch?" choice (the transcripts' action step "Continues below at Watching the
 *   shouting") plays the same round with the same camera; Ours: its timing, as no recording
 *   finishes that conversation.
 *
 * Ours: a Watch-shouting during a round's lines joins it (its camera resets with the round's)
 * rather than starting another; one after the last line starts the next round; no recording
 * clicks during or just after a round. The chant phases at startup (Neitiznot 5 ticks after
 * Jatizso) are the first recorded run's. The guards face each other when they speak,
 * where live sends a face_angle; it is the same direction (471 / 1496).
 * Data: plugins/npcs/data/viking-shouters.json; docs/viking-shouters.md.
 */
const path = require("path");
const DATA = require(path.join(__dirname, "data", "viking-shouters.json"));
const { loadTranscripts } = require("../quests/QuestRuntime");

const OPTION = "Watch-shouting";
/** How far from its spawn tile a guard is looked for (they never wander). */
const FIND_RADIUS = 2;
/** Ticks between looks for a missing guard (not spawned yet, or respawning). */
const FIND_RETRY_TICKS = 10;

let core = null;
let pluginApi = null;
/** The round: [guard gameval, text] per line, from the generated transcript at startup. */
let ROUND = [];
/** Guard gameval -> its chant between rounds (the transcript's closing line per guard). */
const CHANTS = new Map();
/** Npc id -> its gameval key in DATA.guards. */
const keysById = new Map();
const state = {
  tick: 0,
  /** Gameval key -> the guard NPC, once found. */
  guards: new Map(),
  nextFind: 0,
  /** Gameval key -> the tick of its next chant. */
  nextChant: new Map(),
  /** { start, watchers: Set<player> } while a round runs. */
  round: null,
};

function guardKeys() {
  return Object.keys(DATA.guards);
}

function loadIds() {
  keysById.clear();
  for (const key of guardKeys()) {
    const id = core.CacheDefinitions.getNpcId(key);
    if (id == null) throw new Error(`VikingShouters: npc ${key} missing from cache`);
    keysById.set(id, key);
  }
}

function resetState() {
  state.tick = 0;
  state.guards.clear();
  state.nextFind = 0;
  state.round = null;
  state.nextChant.clear();
}

/** The chants' phases, from the tick both guards are found (startup, or back after a despawn). */
function seedChants() {
  for (const key of guardKeys()) state.nextChant.set(key, state.tick + DATA.timing.chantStart[key]);
}

function guardAlive(npc) {
  return npc != null && npc.isRegistered();
}

/** Both guards, found near their spawn tiles; null while either is missing. */
function findGuards() {
  const keys = guardKeys();
  if (keys.every((key) => guardAlive(state.guards.get(key)))) return state.guards;
  if (state.tick < state.nextFind) return null;
  state.nextFind = state.tick + FIND_RETRY_TICKS;
  for (const key of keys) {
    if (guardAlive(state.guards.get(key))) continue;
    const [x, y, z] = DATA.guards[key].at;
    const npc = core.World.getNpcsNear(new core.Location(x, y, z), FIND_RADIUS)
      .find((candidate) => keysById.get(candidate.getId()) === key);
    if (npc) state.guards.set(key, npc);
    else state.guards.delete(key);
  }
  if (!keys.every((key) => guardAlive(state.guards.get(key)))) return null;
  seedChants();
  return state.guards;
}

function otherKey(key) {
  return guardKeys().find((other) => other !== key);
}

function shout(guards, key, text) {
  const npc = guards.get(key);
  npc.forcePositionToFace(guards.get(otherKey(key)).getLocation());
  npc.forceChat(text);
}


/** The round's lines run from its start until the last line is said. */
function inRoundLines(round, tick) {
  return round != null && tick >= round.start && tick <= round.start + (ROUND.length - 1) * DATA.timing.lineInterval;
}

function processRound(guards) {
  const round = state.round;
  const at = state.tick - round.start;
  if (at >= 0 && at % DATA.timing.lineInterval === 0) {
    const index = at / DATA.timing.lineInterval;
    if (index < ROUND.length) shout(guards, ...ROUND[index]);
  }
  if (at === DATA.timing.cameraReset) endRound(round);
}

function endRound(round) {
  for (const player of round.watchers) {
    if (player.isRegistered()) player.getPacketSender().sendCameraReset();
  }
  state.round = null;
}

function processChants(guards) {
  if (inRoundLines(state.round, state.tick)) return;
  for (const key of guardKeys()) {
    if (state.tick < state.nextChant.get(key)) continue;
    shout(guards, key, CHANTS.get(key));
    state.nextChant.set(key, state.tick + DATA.timing.chantInterval);
  }
}

function tick() {
  state.tick++;
  const guards = findGuards();
  if (!guards) {
    // A guard is gone (despawned): the round ends, and its watchers get their camera back.
    if (state.round) endRound(state.round);
    return;
  }
  if (state.round) processRound(guards);
  processChants(guards);
}

/**
 * The transcript's overhead lines in order, each with the guard that says it. Its closing lines,
 * one per guard, are the chants the guards "continue to shout"; the rest is the round. Throws when
 * the variant is missing or doesn't name both guards.
 */
function loadRound() {
  const { page, variant, speakers } = DATA.transcript;
  const steps = loadTranscripts(pluginApi)?.[page]?.variants?.[variant] ?? [];
  const lines = steps
    .filter((step) => step.presentation === "overhead" && typeof step.text === "string")
    .map((step) => [speakers[step.speaker], step.text]);
  const keys = guardKeys();
  const chants = lines.slice(-keys.length);
  const round = lines.slice(0, -keys.length);
  if (round.length === 0 || lines.some(([key]) => !DATA.guards[key]) ||
      keys.some((key) => !chants.some(([speaker]) => speaker === key))) {
    throw new Error(`VikingShouters: ${page} / ${variant} missing, or without both guards' chants`);
  }
  CHANTS.clear();
  for (const [key, text] of chants) CHANTS.set(key, text);
  return round;
}

function startRound(watchers = new Set()) {
  const start = state.tick + DATA.timing.roundDelay;
  state.round = { start, watchers };
  for (const key of guardKeys()) state.nextChant.set(key, start + DATA.timing.chantResume[key]);
  return state.round;
}

/**
 * Joins the running round while it still has lines to say; after its last line a click starts a
 * new round, which takes over the old round's watchers so each still gets its cam_reset.
 */
function watch(player, key) {
  const round = inRoundLines(state.round, Math.max(state.tick, state.round?.start ?? 0))
    ? state.round : startRound(state.round?.watchers);
  round.watchers.add(player);
  const { moveTo, lookAt } = DATA.guards[key].camera;
  const rates = { rate: DATA.cameraRates.rate, rate2: DATA.cameraRates.rate2, heightRelative: false };
  const sender = player.getPacketSender();
  sender.sendCameraMoveTo(moveTo[0], moveTo[1], moveTo[2], rates);
  sender.sendCameraLookAt(lookAt[0], lookAt[1], lookAt[2], rates);
}

function watchShouting({ player, npc }) {
  const key = keysById.get(npc.getId());
  if (!key) return false;
  watch(player, key);
  return true;
}

/** Talk-to's "Can I watch?": the transcript's action step that continues at Watching the shouting. */
function dialogueWatch(action) {
  const key = DATA.dialogueSteps[action.stepId];
  if (!key || action.handled || !action.player) return;
  action.handled = true;
  watch(action.player, key);
}

function start() {
  loadIds();
  ROUND = loadRound();
  resetState();
  core.TaskManager.submit(new (class VikingShoutersTask extends core.Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      tick();
    }
  })());
}

function attach(api) {
  core = api.core;
  pluginApi = api;
}

module.exports = {
  name: "VikingShouters",
  description: "The Jatizso and Neitiznot watchtower guards chant their islands' names, and Watch-shouting shows their recorded insult round with its camera.",
  members: true,
  register(api) {
    attach(api);
    api.onServerStartup(start);
    api.onNpcInteraction("Guard", { [OPTION]: watchShouting });
    api.onCustomEvent("npc-dialogue:action", dialogueWatch);
  },
  _test: { state, tick, start, watchShouting, dialogueWatch },
};
