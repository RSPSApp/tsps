/**
 * The SQLite backend's save history: a gzipped copy of each save, kept for rolling back. Every
 * save adds one (unless it's a bot's, or the same as that player's last copy), and old copies
 * thin out:
 * - every copy from the last 24 hours;
 * - from 24 hours to 7 days, the newest of each hour;
 * - from 7 to 30 days, the newest of each day;
 * - nothing older.
 * See docs/player-saves.md.
 */
const crypto = require("crypto");
const zlib = require("zlib");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KEEP_ALL_MS = DAY_MS;
const KEEP_HOURLY_MS = 7 * DAY_MS;
const KEEP_DAILY_MS = 30 * DAY_MS;

/** The reason recorded for the save a rollback replaces, so the rollback itself can be undone. */
const PRE_ROLLBACK_REASON = "pre-rollback";
const ROLLBACK_REASON = "rollback";

/**
 * The ids to delete from one player's copies under the retention rules. `rows` are
 * `{ id, savedAt }` (ISO times), in any order.
 */
function idsToPrune(rows, nowMs) {
  const newestFirst = [...rows].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || b.id - a.id);
  const buckets = new Set();
  const prune = [];
  for (const row of newestFirst) {
    const at = Date.parse(row.savedAt);
    const age = nowMs - at;
    if (age <= KEEP_ALL_MS) continue;
    const bucket = age <= KEEP_HOURLY_MS ? `h${Math.floor(at / HOUR_MS)}` : age <= KEEP_DAILY_MS ? `d${Math.floor(at / DAY_MS)}` : null;
    if (bucket && !buckets.has(bucket)) {
      buckets.add(bucket);
      continue;
    }
    prune.push(row.id);
  }
  return prune;
}

function hashOf(serialized) {
  return crypto.createHash("sha1").update(serialized).digest("hex");
}

class SqliteSaveHistory {
  constructor(database) {
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS player_save_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        save_hash TEXT NOT NULL,
        save_gz BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS player_save_history_by_player
        ON player_save_history (username, saved_at);
    `);
    this.insertCopy = database.prepare(
      "INSERT INTO player_save_history (username, saved_at, reason, save_hash, save_gz) VALUES (?, ?, ?, ?, ?)"
    );
    this.findLatestHash = database.prepare(
      "SELECT save_hash AS hash FROM player_save_history WHERE username = ? ORDER BY saved_at DESC, id DESC LIMIT 1"
    );
    this.findTimes = database.prepare(
      "SELECT id, saved_at AS savedAt FROM player_save_history WHERE username = ?"
    );
    this.deleteCopy = database.prepare("DELETE FROM player_save_history WHERE id = ?");
    this.findList = database.prepare(`
      SELECT id, saved_at AS savedAt, reason, length(save_gz) AS bytes FROM player_save_history
      WHERE username = ? ORDER BY saved_at DESC, id DESC LIMIT ?
    `);
    this.findCopy = database.prepare(
      "SELECT id, saved_at AS savedAt, reason, length(save_gz) AS bytes, save_gz AS gz FROM player_save_history WHERE username = ? AND id = ?"
    );
  }

  /** Adds a copy of `serialized` unless it matches the player's newest one, then thins theirs out. */
  record(username, serialized, reason, savedAt) {
    const hash = hashOf(serialized);
    if (this.findLatestHash.get(username)?.hash === hash) return false;
    this.insertCopy.run(username, savedAt, reason, hash, zlib.gzipSync(serialized));
    for (const id of idsToPrune(this.findTimes.all(username), Date.parse(savedAt))) this.deleteCopy.run(id);
    return true;
  }

  /** The player's copies, newest first: `{ id, savedAt, reason, bytes }`. */
  list(username, limit = 15) {
    return this.findList.all(username, limit).map(({ id, savedAt, reason, bytes }) => ({ id, savedAt, reason, bytes }));
  }

  /** One copy with its save JSON, or null. */
  get(username, id) {
    const row = this.findCopy.get(username, id);
    if (!row) return null;
    return { snapshot: { id: row.id, savedAt: row.savedAt, reason: row.reason, bytes: row.bytes }, json: zlib.gunzipSync(row.gz).toString("utf8") };
  }
}

module.exports = { SqliteSaveHistory, idsToPrune, PRE_ROLLBACK_REASON, ROLLBACK_REASON };
