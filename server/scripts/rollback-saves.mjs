#!/usr/bin/env node
/**
 * Rolls players back to their saved copies from before a time (docs/player-saves.md). Run it
 * with the server stopped:
 *
 *   yarn saves:rollback --before 2026-10-07T12:00:00Z              # what would change
 *   yarn saves:rollback --before 2026-10-07T12:00:00Z --apply      # do it
 *   yarn saves:rollback --before ... --player "Some name" [--apply]
 *
 * Each player gets their newest copy at or before the time; players without one are left alone.
 * --apply first copies the database to data/saves/players-before-rollback-<time>.sqlite, then
 * restores everyone in one transaction, recording each current save as "pre-rollback".
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const { SqliteSaveHistory, PRE_ROLLBACK_REASON, ROLLBACK_REASON } = require("../plugins/persistence/SqliteSaveHistory.js");

function parseArgs(argv) {
  const args = { apply: false, before: null, player: null, database: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--before") args.before = argv[++i];
    else if (arg === "--player") args.player = argv[++i];
    else if (arg === "--database") args.database = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.before || Number.isNaN(Date.parse(args.before))) throw new Error("--before <time> is required, e.g. --before 2026-10-07T12:00:00Z");
  return args;
}

/** As SqlitePlayerPersistence.normalizeUsername, for names given on the command line. */
function normalizeUsername(username) {
  const safe = String(username ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : "player";
}

function serverRunning(databasePath) {
  try {
    const pid = Number(fs.readFileSync(`${databasePath}.pid`, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

export function run(argv, { log = console.log, now = new Date() } = {}) {
  const args = parseArgs(argv);
  const databasePath = path.resolve(args.database ?? process.env.PLAYER_SAVE_DATABASE_PATH ?? path.join(process.cwd(), "data", "saves", "players.sqlite"));
  if (!fs.existsSync(databasePath)) throw new Error(`No save database at ${databasePath}`);
  const pid = serverRunning(databasePath);
  if (pid) throw new Error(`The server (pid ${pid}) has ${databasePath} open. Stop it first.`);

  const before = new Date(args.before).toISOString();
  const database = new DatabaseSync(databasePath);
  try {
    const history = new SqliteSaveHistory(database);
    const players = args.player
      ? [normalizeUsername(args.player)]
      : database.prepare("SELECT username FROM player_saves ORDER BY username").all().map((row) => row.username);
    const findCurrent = database.prepare("SELECT save_json AS json, updated_at AS updatedAt FROM player_saves WHERE username = ?");
    const findCopy = database.prepare(`
      SELECT id, saved_at AS savedAt, reason, save_gz AS gz FROM player_save_history
      WHERE username = ? AND saved_at <= ? ORDER BY saved_at DESC, id DESC LIMIT 1
    `);

    const restores = [];
    for (const username of players) {
      const current = findCurrent.get(username);
      const copy = findCopy.get(username, before);
      if (!current) {
        log(`  ${username}: no save`);
      } else if (!copy) {
        log(`  ${username}: left alone, no copy from before ${before}`);
      } else {
        const json = zlib.gunzipSync(copy.gz).toString("utf8");
        if (json === current.json) {
          log(`  ${username}: already at #${copy.id} (${copy.savedAt})`);
        } else {
          log(`  ${username}: ${current.updatedAt} -> #${copy.id} ${copy.savedAt} (${copy.reason})`);
          restores.push({ username, json, current: current.json });
        }
      }
    }
    log(`${restores.length} of ${players.length} player(s) to roll back to before ${before}.`);
    if (!args.apply) {
      log("Dry run: nothing changed. Add --apply to roll back.");
      return { restored: 0, planned: restores.length };
    }
    if (restores.length === 0) return { restored: 0, planned: 0 };

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const backup = path.join(path.dirname(databasePath), `players-before-rollback-${stamp}.sqlite`);
    database.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    log(`Copied the database to ${backup}.`);

    const savedAt = now.toISOString();
    const write = database.prepare("UPDATE player_saves SET save_json = ?, updated_at = ? WHERE username = ?");
    database.exec("BEGIN");
    try {
      for (const { username, json, current } of restores) {
        history.record(username, current, PRE_ROLLBACK_REASON, savedAt);
        write.run(json, savedAt, username);
        history.record(username, json, ROLLBACK_REASON, savedAt);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    log(`Rolled back ${restores.length} player(s).`);
    return { restored: restores.length, planned: restores.length, backup };
  } finally {
    database.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
