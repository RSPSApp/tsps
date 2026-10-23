"use strict";

/**
 * How long a player has been online, in whole seconds: the current session and the lifetime total.
 *
 * The session clock starts on the login hook and is read against the wall clock instead of counted
 * per process hook, so a reader costs nothing and lag or a stalled game loop does not shorten it.
 *
 * The lifetime total is a saved attribute that the open session counts toward live, so reads never
 * wait on a fold. A fold moves the elapsed seconds into the attribute - on a one-minute beat, at
 * logout (the core saves straight after) and at shutdown (before the core's shutdown save). A fold
 * writes memory only: attributes reach disk with whatever save follows anyway, the next autosave,
 * so the beat bounds what a hard crash can lose to one autosave window instead of a whole session,
 * without causing a single extra save.
 *
 * Other plugins ask through the `player:online-seconds` and `player:lifetime-seconds` events, whose
 * payloads double as the reply channel; no plugin needs to keep its own login timestamp.
 */

const ONLINE_SECONDS_EVENT = "player:online-seconds";
const LIFETIME_SECONDS_EVENT = "player:lifetime-seconds";
const LIFETIME_SECONDS_ATTRIBUTE = "player-online:lifetime-seconds";
const FOLD_INTERVAL_MS = 60_000;
const MS_PER_SECOND = 1000;

/** Keyed by player: the login instant, fixed for the session, and the time the total is folded to. */
const sessions = new WeakMap();
let World;
let core;

function secondsSince(ms, now) {
  return Math.max(0, Math.floor((now - ms) / MS_PER_SECOND));
}

function bankedSeconds(player) {
  return Math.max(0, Math.trunc(Number(player?.getAttribute?.(LIFETIME_SECONDS_ATTRIBUTE)) || 0));
}

function sessionSeconds(player) {
  const session = sessions.get(player);
  return session === undefined ? 0 : secondsSince(session.loginMs, Date.now());
}

function lifetimeSeconds(player) {
  const session = sessions.get(player);
  const open = session === undefined ? 0 : secondsSince(session.foldMs, Date.now());
  return bankedSeconds(player) + open;
}

function startSession({ player }) {
  const now = Date.now();
  sessions.set(player, { loginMs: now, foldMs: now });
}

/**
 * Folds the elapsed seconds into the saved total. Idempotent and lossless: the fold point moves by
 * exactly the whole seconds taken, so a partial second stays owed to the next fold, and a player
 * with no open session (already banked) has nothing to fold.
 */
function foldSession(player) {
  const session = sessions.get(player);
  if (session === undefined) return;
  const now = Date.now();
  const seconds = secondsSince(session.foldMs, now);
  if (seconds <= 0) return;
  session.foldMs += seconds * MS_PER_SECOND;
  player.setAttribute(LIFETIME_SECONDS_ATTRIBUTE, bankedSeconds(player) + seconds);
}

function bankLoggedOutSession({ player }) {
  foldSession(player);
  sessions.delete(player);
}

function foldOnlineSessions() {
  for (const player of World?.getPlayers() ?? []) foldSession(player);
}

/** One repeating task per server, not one per player: folds the whole online list once a minute. */
function startFolding() {
  const { Task, TaskManager, GameConstants } = core;
  const cycleMs = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, Math.round(FOLD_INTERVAL_MS / cycleMs)), "PlayerOnlineTimer");
    }
    execute() {
      foldOnlineSessions();
    }
  })());
}

function answerOnlineSeconds(request) {
  request.seconds = sessionSeconds(request.player);
}

function answerLifetimeSeconds(request) {
  request.seconds = lifetimeSeconds(request.player);
}

module.exports = {
  name: "PlayerOnlineTimer",
  register(api) {
    World = api.getWorld();
    core = api.core;
    api.persistAttribute(LIFETIME_SECONDS_ATTRIBUTE, 0);
    api.onServerStartup(startFolding);
    api.onPlayerLogin(startSession);
    api.onPlayerLogout(bankLoggedOutSession);
    api.onServerShutdown(foldOnlineSessions);
    api.onCustomEvent(ONLINE_SECONDS_EVENT, answerOnlineSeconds);
    api.onCustomEvent(LIFETIME_SECONDS_EVENT, answerLifetimeSeconds);
  },
  _test: {
    sessionSeconds,
    lifetimeSeconds,
    foldSession,
    foldOnlineSessions,
    FOLD_INTERVAL_MS,
    ONLINE_SECONDS_EVENT,
    LIFETIME_SECONDS_EVENT,
    LIFETIME_SECONDS_ATTRIBUTE,
  },
};
