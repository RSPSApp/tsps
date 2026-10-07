/**
 * The SQLite backend's writer, on its own thread (worker_threads) so the game tick never waits on
 * the disk. It owns the only connection that writes: each message is one player's writes (their
 * save row and history copies), validated, then committed in one transaction, and answered with
 * `{ seq, username, ok, error? }`. Messages are handled in the order they were sent.
 * See SqlitePlayerPersistence.plugin.js and docs/player-saves.md.
 */
const { isMainThread, parentPort, workerData } = require("worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { SqliteSaveHistory } = require("./SqliteSaveHistory");
const { validateSerializedSave } = require("./validateSave");

const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`;

/**
 * Returns `write(message) -> answer` for a connection: `message.writes` are
 * `{ kind: "row", json }` (the player's save) and `{ kind: "history", json, reason }` (a copy),
 * validated and committed in one transaction. The backend also uses this on the game thread if
 * the writer thread can't run.
 */
function createWriter(database, skillCount) {
  const history = new SqliteSaveHistory(database);
  const writeRow = database.prepare(`
    INSERT INTO player_saves (username, save_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      save_json = excluded.save_json,
      updated_at = excluded.updated_at
  `);
  function commit({ username, savedAt, writes }) {
    for (const write of writes) {
      if (write.kind === "row") validateSerializedSave(write.json, username, skillCount);
    }
    database.exec("BEGIN");
    try {
      for (const write of writes) {
        if (write.kind === "row") writeRow.run(username, write.json, savedAt);
        else history.record(username, write.json, write.reason, savedAt);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return (message) => {
    try {
      commit(message);
      return { seq: message.seq, username: message.username, ok: true };
    } catch (error) {
      return { seq: message.seq, username: message.username, ok: false, error: error?.message ?? String(error) };
    }
  };
}

if (!isMainThread && parentPort) {
  const database = new DatabaseSync(workerData.databasePath);
  database.exec(PRAGMAS);
  const write = createWriter(database, workerData.skillCount);
  parentPort.on("message", (message) => parentPort.postMessage(write(message)));
  parentPort.postMessage({ ready: true });
}

module.exports = { createWriter };
