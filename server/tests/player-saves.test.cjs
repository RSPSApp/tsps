// Run after `yarn build`: node --test tests/player-saves.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

// The SQLite backend reads its path when it loads.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-saves-"));
const DATABASE = path.join(directory, "players.sqlite");
process.env.PLAYER_SAVE_DATABASE_PATH = DATABASE;
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = "0";

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { idsToPrune } = require("../plugins/persistence/SqliteSaveHistory");
const Autosave = require("../plugins/persistence/Autosave.plugin");
const SaveHistory = require("../plugins/commands/SaveHistory.plugin");

let persistence = null;
require("../plugins/persistence/SqlitePlayerPersistence.plugin").register({
  getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
  setPlayerPersistence: (backend) => { persistence = backend; },
  log() {},
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function player(name, { bot = false } = {}) {
  const p = new Player(null);
  p.setUsername(name);
  if (bot) p.isPlayerBot = () => true;
  return p;
}

/** Saves are written by the writer thread: each read waits for it first. */
async function historyRows(name) {
  await persistence.flush();
  return persistence.database.prepare("SELECT reason FROM player_save_history WHERE username = ? ORDER BY id").all(name).map((row) => row.reason);
}

/** The coins in the saved row (read directly: load() is a login, which ends a pending rollback). */
async function savedGold(name) {
  await persistence.flush();
  const row = persistence.database.prepare("SELECT save_json AS json FROM player_saves WHERE username = ?").get(persistence.normalizeUsername(name));
  return JSON.parse(row.json).inventory[0]?.amount ?? 0;
}

async function snapshots(name) {
  await persistence.flush();
  return persistence.listSnapshots(name);
}

function setGold(p, amount) {
  const { Item } = require("../dist/game/model/Item");
  p.getInventory().setItem(0, new Item(995, amount));
}

test("a save adds a compressed copy with its reason; the same save again adds none; bots add none", async () => {
  const p = player("Alice");
  setGold(p, 100);
  persistence.save(p, "autosave");
  persistence.save(p, "logout");
  assert.deepEqual(await historyRows("alice"), ["autosave"], "identical saves are kept once");
  setGold(p, 200);
  persistence.save(p, "logout");
  assert.deepEqual(await historyRows("alice"), ["autosave", "logout"]);
  const [newest] = await snapshots("Alice");
  assert.equal(newest.reason, "logout");
  assert.ok(newest.bytes < JSON.stringify(require("../dist/game/entity/impl/player/persistence/PlayerSave").PlayerSave.fromPlayer(p)).length / 3, "gzipped");

  persistence.save(player("Bot 1", { bot: true }), "autosave");
  assert.ok(persistence.exists("Bot 1"), "the bot's save is written");
  assert.deepEqual(await historyRows("bot_1"), [], "but it has no history");
});

test("retention: all of the last day, the newest per hour to 7 days, per day to 30 days, nothing older", async () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const at = (msAgo) => new Date(now - msAgo).toISOString();
  const rows = [
    { id: 1, savedAt: at(1 * HOUR) },
    { id: 2, savedAt: at(23 * HOUR) },
    { id: 3, savedAt: at(30 * HOUR) }, // 06:00, the same hour as 4 and older
    { id: 4, savedAt: at(30 * HOUR - 10 * 60 * 1000) },
    { id: 5, savedAt: at(3 * DAY) },
    { id: 6, savedAt: at(10 * DAY + HOUR) }, // same day as 7, older
    { id: 7, savedAt: at(10 * DAY) },
    { id: 8, savedAt: at(40 * DAY) },
  ];
  assert.deepEqual(idsToPrune(rows, now).sort(), [3, 6, 8]);
});

test("restoring a snapshot of an offline player writes it and keeps the replaced save as pre-rollback", async () => {
  const p = player("Bob");
  setGold(p, 5);
  persistence.save(p, "logout");
  const [old] = await snapshots("Bob");
  setGold(p, 999);
  persistence.save(p, "logout");
  assert.equal(await savedGold("Bob"), 999);

  const restored = persistence.restoreSnapshot("Bob", old.id);
  assert.equal(restored.pending, false);
  assert.equal(await savedGold("Bob"), 5);
  assert.deepEqual(await historyRows("bob"), ["logout", "logout", "rollback"],
    "the replaced save is already the newest copy, so pre-rollback adds nothing new");
  assert.equal(persistence.restoreSnapshot("Bob", 123456), null, "no such snapshot");
});

test("an online player's rollback is written by their next save (their state kept as pre-rollback) until they log in", async () => {
  const p = player("Carol");
  setGold(p, 1);
  persistence.save(p, "logout");
  const [old] = await snapshots("Carol");
  setGold(p, 50);
  persistence.save(p, "autosave");

  assert.equal(persistence.restoreSnapshot("Carol", old.id, { online: true }).pending, true);
  setGold(p, 70);
  persistence.save(p, "autosave");
  assert.equal(await savedGold("Carol"), 1, "an autosave before the logout writes the snapshot");
  persistence.save(p, "logout");
  assert.equal(await savedGold("Carol"), 1, "and so does the logout save");
  assert.deepEqual(await historyRows("carol"), ["logout", "autosave", "pre-rollback", "rollback"]);

  persistence.load("Carol");
  setGold(p, 80);
  persistence.save(p, "logout");
  assert.equal(await savedGold("Carol"), 80, "after logging back in, saves are theirs again");
});

test("::rollback finds a copy by id or by age", async () => {
  const { parseTarget } = SaveHistory._test;
  assert.deepEqual(parseTarget("#12"), { id: 12 });
  assert.deepEqual(parseTarget("12"), { id: 12 });
  assert.deepEqual(parseTarget("30m"), { ageMs: 30 * 60 * 1000 });
  assert.deepEqual(parseTarget("2H"), { ageMs: 2 * HOUR });
  assert.equal(parseTarget("yesterday"), null);
});

test("::snapshots and ::rollback on a player who is online log them out", async () => {
  const commands = {};
  SaveHistory.register({
    core: { ...PluginManager.getCoreApi(), GameConstants: { PLAYER_PERSISTENCE: persistence } },
    registerCommand: (name, handler) => { commands[name] = handler; },
  });
  const p = player("Dave");
  setGold(p, 3);
  persistence.save(p, "logout");
  const [old] = await snapshots("Dave");
  setGold(p, 4);
  persistence.save(p, "logout");

  await persistence.flush();
  const messages = [];
  const owner = { sendMessage: (message) => messages.push(message) };
  commands.snapshots({ player: owner, parts: ["snapshots", "Dave"] });
  assert.equal(messages.length, 3, "a heading and two copies");
  assert.match(messages[2], new RegExp(`^#${old.id}  \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d UTC  logout$`));

  const { World } = PluginManager.getCoreApi();
  let loggedOut = false;
  const realLookup = World.getPlayerByName;
  World.getPlayerByName = (name) => (name === "Dave" ? { requestLogout: () => { loggedOut = true; } } : undefined);
  try {
    commands.rollback({ player: owner, parts: ["rollback", "Dave", `#${old.id}`] });
  } finally {
    World.getPlayerByName = realLookup;
  }
  assert.ok(loggedOut);
  assert.match(messages.at(-1), /Dave was online and has been logged out\./);
  persistence.save(p, "logout");
  assert.equal(await savedGold("Dave"), 3);
});

test("autosave: each player is due once per interval, staggered by name, within a per-tick budget", async () => {
  const { saveDuePlayers: tick, schedule, forget, offsetOf, dueAt, INTERVAL_TICKS, MAX_SAVES_PER_TICK } = Autosave._test;
  const saved = [];
  Autosave.register({
    core: { GameConstants: { PLAYER_PERSISTENCE: { save: (p, reason) => saved.push([p.getUsername(), reason]) } } },
    onServerStartup() {},
    onPlayerLogin() {},
    onPlayerLogout() {},
  });
  assert.equal(INTERVAL_TICKS, 1500, "15 minutes");

  const one = player("Erin");
  const skipped = player("Bot 2");
  skipped.setAttribute("bot-skip-persistence", true);
  schedule({ player: one });
  schedule({ player: skipped });
  for (let i = 0; i < INTERVAL_TICKS * 2; i++) tick();
  assert.deepEqual(saved, [["Erin", "autosave"], ["Erin", "autosave"]], "twice in two intervals; a skipped bot never");
  forget({ player: one });
  forget({ player: skipped });

  // A mass login (as after a restart) spreads out by name...
  const crowd = Array.from({ length: 200 }, (_, i) => player(`Player ${i}`));
  const offsets = new Set(crowd.map((p) => offsetOf(p.getUsername(), INTERVAL_TICKS)));
  assert.ok(offsets.size > 150, "spread over the interval");
  // ...and even if all are due at once, no tick saves more than the budget.
  saved.length = 0;
  for (const p of crowd) dueAt.set(p, 0);
  tick();
  assert.equal(saved.length, MAX_SAVES_PER_TICK);
  for (let i = 0; i < 25; i++) tick();
  assert.equal(saved.length, 200, "the rest follow on the next ticks");
  for (const p of crowd) forget({ player: p });
});

test("the rollback script: a dry run changes nothing, --apply backs up and restores from before a time", async () => {
  const { run } = await import("../scripts/rollback-saves.mjs");
  const p = player("Frank");
  setGold(p, 10);
  persistence.save(p, "logout");
  const cutoff = new Date(Date.now() + 5).toISOString();
  await new Promise((resolve) => setTimeout(resolve, 20));
  setGold(p, 20);
  persistence.save(p, "logout");

  await persistence.flush();
  // This test process holds the database, as a running server would.
  assert.throws(() => run(["--before", cutoff, "--player", "Frank", "--database", DATABASE], { log() {} }), /Stop it first/);
  fs.unlinkSync(`${DATABASE}.pid`);

  const log = [];
  assert.deepEqual(run(["--before", cutoff, "--player", "Frank", "--database", DATABASE], { log: (line) => log.push(line) }), { restored: 0, planned: 1 });
  assert.ok(log.some((line) => line.startsWith("Dry run")));
  assert.equal(await savedGold("Frank"), 20);

  const result = run(["--before", cutoff, "--player", "Frank", "--database", DATABASE, "--apply"], { log() {} });
  assert.equal(result.restored, 1);
  assert.ok(fs.existsSync(result.backup), "the database was copied first");
  assert.equal(await savedGold("Frank"), 10);
  assert.deepEqual((await historyRows("frank")).slice(-2), ["logout", "rollback"]);
});

test("saves are written by the writer thread; a login before it's done gets the new save", async () => {
  const p = player("Gina");
  setGold(p, 1);
  persistence.save(p, "logout");
  await persistence.flush();
  setGold(p, 2);
  persistence.save(p, "logout");
  // Still the same tick: the writer can't have answered yet.
  assert.ok(persistence.unwritten.has("gina"), "waiting for the writer");
  assert.equal(persistence.load("Gina").getInventory()[0].getAmount(), 2, "a quick re-login loads the newest save");
  assert.equal(await savedGold("Gina"), 2);
  assert.ok(!persistence.unwritten.has("gina"), "written");
  assert.ok(!JSON.stringify(persistence.findSave.get("gina").saveJson).includes("\\n  "), "stored without indentation");
});

test("a save that fails validation in the writer leaves the previous one, and flush reports it", async () => {
  const p = player("Hank");
  setGold(p, 7);
  persistence.save(p, "logout");
  await persistence.flush();
  persistence.enqueue("hank", [{ kind: "row", json: "{\"position\":{}}" }, { kind: "history", json: "{}", reason: "logout" }]);
  await assert.rejects(persistence.flush(), /Refusing to save hank/);
  const stored = persistence.findSave.get("hank").saveJson;
  assert.equal(JSON.parse(stored).inventory[0].amount, 7, "the previous save stays");
  assert.equal(persistence.listSnapshots("Hank").length, 1, "and nothing of the bad save is in the history");
  await assert.rejects(persistence.flush(), /Refusing/, "reported until Hank's next save succeeds");
  persistence.save(p, "logout");
  await persistence.flush();
});

test("a writer that dies is restarted, and the saves it hadn't written are sent again", async () => {
  const p = player("Iris");
  setGold(p, 11);
  const old = persistence.writer;
  persistence.save(p, "logout");
  await old.terminate();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.notEqual(persistence.writer, old, "a new writer");
  assert.equal(await savedGold("Iris"), 11);
});
