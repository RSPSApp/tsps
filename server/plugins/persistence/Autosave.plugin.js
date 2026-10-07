/**
 * Saves every online player every 15 minutes (OSRS: a crashed world puts players back to their
 * save from up to 15 minutes before). Staggered: each player's first save falls somewhere in
 * their first interval, spread by their name, so a mass login after a restart doesn't save
 * everyone on one tick; and no more than a few are saved on any tick. See docs/player-saves.md.
 */
const INTERVAL_TICKS = Number(process.env.AUTOSAVE_INTERVAL_TICKS) > 0 ? Math.floor(Number(process.env.AUTOSAVE_INTERVAL_TICKS)) : 1500;
const MAX_SAVES_PER_TICK = 10;
const REASON = "autosave";
/** Bots that are never saved (World.savePlayers skips them too). */
const SKIP_PERSISTENCE_ATTRIBUTE = "bot-skip-persistence";

let core = null;
let tick = 0;
/** Online player -> the tick their next autosave is due. */
const dueAt = new Map();

/** 0 to interval - 1, the same for a name every time. */
function offsetOf(username, interval) {
  let hash = 0;
  for (const char of String(username ?? "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % interval;
}

function schedule({ player }) {
  if (player) dueAt.set(player, tick + 1 + offsetOf(player.getUsername?.(), INTERVAL_TICKS));
}

function forget({ player }) {
  dueAt.delete(player);
}

/** One tick: saves the players that are due, up to the budget; the rest wait a tick. */
function saveDuePlayers() {
  tick++;
  let saved = 0;
  for (const [player, due] of dueAt) {
    if (due > tick) continue;
    if (saved >= MAX_SAVES_PER_TICK) {
      dueAt.set(player, tick + 1);
      continue;
    }
    dueAt.set(player, tick + INTERVAL_TICKS);
    if (player.getAttribute?.(SKIP_PERSISTENCE_ATTRIBUTE) === true) continue;
    saved++;
    try {
      core.GameConstants.PLAYER_PERSISTENCE.save(player, REASON);
    } catch (error) {
      console.error(`[autosave] Failed to save ${player.getUsername?.() ?? "unknown"}`, error);
    }
  }
}

function start() {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, "autosave");
    }
    execute() {
      saveDuePlayers();
    }
  })());
}

function bind(api) {
  core = api.core;
}

module.exports = {
  name: "Autosave",
  _test: { saveDuePlayers, schedule, forget, offsetOf, dueAt, INTERVAL_TICKS, MAX_SAVES_PER_TICK, get tick() { return tick; } },
  register(api) {
    bind(api);
    api.onServerStartup(start);
    api.onPlayerLogin(schedule);
    api.onPlayerLogout(forget);
  },
};
