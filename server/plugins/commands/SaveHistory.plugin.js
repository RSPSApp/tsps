/**
 * Owner commands for the save history (docs/player-saves.md):
 * - ::snapshots <name> - their newest saved copies;
 * - ::rollback <name> <#id | 30m | 2h | 1d> - puts back that copy, or the newest at least that
 *   old. An online player is logged out, and their logout save writes the copy.
 */
const LIST_LIMIT = 15;
/** How far back a rollback by age looks. */
const SEARCH_LIMIT = 1000;
const AGE_UNITS_MS = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

let core = null;

function persistence() {
  return core.GameConstants.PLAYER_PERSISTENCE;
}

function formatTime(iso) {
  return `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function describe(snapshot) {
  return `#${snapshot.id}  ${formatTime(snapshot.savedAt)}  ${snapshot.reason}`;
}

/** "#12" or "12" -> { id: 12 }; "30m", "2h", "1d" -> { ageMs }; anything else -> null. */
function parseTarget(text) {
  const id = /^#?(\d+)$/.exec(text ?? "");
  if (id) return { id: Number(id[1]) };
  const age = /^(\d+)([mhd])$/i.exec(text ?? "");
  if (age) return { ageMs: Number(age[1]) * AGE_UNITS_MS[age[2].toLowerCase()] };
  return null;
}

/** The snapshot a target means: by id, or the newest at least `ageMs` old. */
function findSnapshot(username, target, nowMs = Date.now()) {
  const snapshots = persistence().listSnapshots(username, SEARCH_LIMIT);
  if (target.id != null) return snapshots.find((snapshot) => snapshot.id === target.id) ?? null;
  return snapshots.find((snapshot) => Date.parse(snapshot.savedAt) <= nowMs - target.ageMs) ?? null;
}

function needsHistory(player) {
  if (persistence().supportsHistory?.()) return false;
  player.sendMessage("Save history needs the SQLite save backend.");
  return true;
}

function listSnapshots({ player, parts }) {
  if (needsHistory(player)) return true;
  const name = parts.slice(1).join(" ").trim();
  if (!name) {
    player.sendMessage("Use ::snapshots <name>.");
    return true;
  }
  const snapshots = persistence().listSnapshots(name, LIST_LIMIT);
  if (snapshots.length === 0) {
    player.sendMessage(`No saved copies for ${name}.`);
    return true;
  }
  player.sendMessage(`${name}'s newest saved copies:`);
  for (const snapshot of snapshots) player.sendMessage(describe(snapshot));
  return true;
}

function rollback({ player, parts }) {
  if (needsHistory(player)) return true;
  const target = parseTarget(parts.at(-1));
  const name = parts.slice(1, -1).join(" ").trim();
  if (!target || !name) {
    player.sendMessage("Use ::rollback <name> <#id | 30m | 2h | 1d>.");
    return true;
  }
  const snapshot = findSnapshot(name, target);
  if (!snapshot) {
    player.sendMessage(`No saved copy of ${name} matches that. See ::snapshots ${name}.`);
    return true;
  }
  const online = core.World.getPlayerByName(name);
  const restored = persistence().restoreSnapshot(name, snapshot.id, { online: Boolean(online) });
  if (!restored) {
    player.sendMessage(`Could not restore ${describe(snapshot)}.`);
    return true;
  }
  player.sendMessage(`${name} is rolled back to ${describe(restored.snapshot)}.`);
  if (online) {
    if (online === player) player.sendMessage("Logging you out; log back in to load it.");
    else player.sendMessage(`${name} was online and has been logged out.`);
    online.requestLogout();
  }
  return true;
}

function bind(api) {
  core = api.core;
}

module.exports = {
  name: "SaveHistory",
  _test: { parseTarget, findSnapshot },
  register(api) {
    bind(api);
    api.registerCommand("snapshots", listSnapshots, api.core.PlayerRights.OWNER, "List a player's saved copies");
    api.registerCommand("rollback", rollback, api.core.PlayerRights.OWNER, "Roll a player back to a saved copy");
  },
};
