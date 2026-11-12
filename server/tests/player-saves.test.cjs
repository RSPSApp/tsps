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
const { idsToPrune } = require("../plugins/persistence/SaveHistory.SqlitePlayerPersistence");
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
  const { saveDuePlayers: tick, schedule, forget, offsetOf, intervalOf, dueAt, INTERVAL_TICKS, MIN_INTERVAL_TICKS, MAX_SAVES_PER_TICK } = Autosave._test;
  const saved = [];
  Autosave.register({
    core: { GameConstants: { PLAYER_PERSISTENCE: { save: (p, reason) => saved.push([p.getUsername(), reason]) } } },
    onServerStartup() {},
    onPlayerLogin() {},
    onPlayerLogout() {},
  });
  assert.equal(MIN_INTERVAL_TICKS, 500, "5 minutes minimum");
  assert.equal(INTERVAL_TICKS, 1000, "10 minutes maximum");

  const one = player("Erin");
  const skipped = player("Bot 2");
  skipped.setAttribute("bot-skip-persistence", true);
  schedule({ player: one });
  assert.ok(dueAt.get(one) - Autosave._test.tick >= MIN_INTERVAL_TICKS);
  assert.ok(dueAt.get(one) - Autosave._test.tick <= INTERVAL_TICKS);
  schedule({ player: skipped });
  for (let i = 0; i < INTERVAL_TICKS * 2; i++) tick();
  assert.deepEqual(saved, Array.from({ length: Math.floor(INTERVAL_TICKS * 2 / intervalOf(one)) }, () => ["Erin", "autosave"]));
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

test("critical saves coalesce after the operation and flush drains them before shutdown", async () => {
  const p = player("Jade");
  setGold(p, 100);
  persistence.requestSave(p, "quest-completion");
  persistence.requestSave(p, "collection-log-unlock");
  setGold(p, 200);
  assert.equal(persistence.exists("Jade"), false, "no partial state is snapshotted during the operation");
  await persistence.flush();
  assert.equal(await savedGold("Jade"), 200);
  assert.deepEqual(await historyRows("jade"), ["quest-completion,collection-log-unlock"]);
  setGold(p, 300);
  persistence.requestSave(p, "death");
  persistence.cancelRequestedSave(p);
  persistence.save(p, "logout");
  await persistence.flush();
  assert.deepEqual(await historyRows("jade"), ["quest-completion,collection-log-unlock", "logout"]);
});

test("offline purchases write the updated account and keep a history entry", async () => {
  const p = player("Kara");
  setGold(p, 50);
  persistence.save(p, "logout");
  await persistence.flush();
  assert.equal(await persistence.updateOffline("Kara", save => {
    save.getInventory()[0].setAmount(75);
  }), true);
  assert.equal(await savedGold("Kara"), 75);
  assert.deepEqual(await historyRows("kara"), ["logout", "offline-purchase"]);
});

test("an unmade save (a Hardcore World Reset) is written, and loads back holding only the account", async () => {
  const p = player("Ruth");
  p.setPasswordHashWithSalt("salt:hash");
  setGold(p, 50);
  p.setAttribute("login:tokens", [{ hash: "t", expires: Date.now() + DAY }]);
  persistence.save(p, "logout");
  await persistence.flush();
  assert.equal(await persistence.updateOffline("Ruth", (save) => save.unmake(), "hardcore-reset"), true);
  const save = persistence.load("Ruth");
  assert.equal(save.isUnmade(), true, "the writer's validation accepted it");
  assert.equal(save.getPasswordHashWithSalt(), "salt:hash", "the name stays guarded by its password");
  assert.deepEqual(Object.keys(save.attributes), ["login:tokens"]);
  assert.equal(save.getInventory().every((item) => item.getId() === -1), true);
  const { Skills } = require("../dist/game/content/skill/SkillManager");
  assert.deepEqual(save.getSkills().maxLevel, new Skills().maxLevel, "a new character's levels");
  assert.equal(persistence.exists("Ruth"), true, "never no save");
});

test("offline delivery refuses an online account without applying the purchase", async () => {
  const { World } = require("../dist/game/World");
  const lookup = World.getPlayerByName;
  World.getPlayerByName = () => player("Online");
  let changed = false;
  try {
    await assert.rejects(persistence.updateOffline("Online", () => { changed = true; }), /online account/);
    assert.equal(changed, false);
  } finally {
    World.getPlayerByName = lookup;
  }
});

test("repeated writer failures never fall back to synchronous game-thread writes", async () => {
  const p = player("Lina");
  persistence.save(p, "logout");
  await persistence.flush();
  persistence.writerFailures = 2;
  setGold(p, 20);
  persistence.save(p, "valuable-item-discard");
  await persistence.writer.terminate();
  assert.equal(persistence.writer, null);
  await assert.rejects(persistence.flush(), /writer unavailable/);
  assert.ok(persistence.unwritten.has("lina"));
  setGold(p, 30);
  persistence.save(p, "logout");
  assert.ok(persistence.writer, "a new save retries the worker with the queued snapshots");
  assert.equal(await savedGold("Lina"), 30);
});

// Exercise disk serialization and hydration used by login, not an in-memory snapshot.
const { FightType } = require("../dist/game/content/combat/FightType");
const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const { IndexedDbPlayerPersistence } = require("../plugins/persistence/IndexedDbPlayerPersistence.plugin");
JsonPlayerPersistence.SAVE_DIRECTORY = path.join(directory, "json-characters");
IndexedDbPlayerPersistence.SAVE_DIRECTORY = path.join(directory, "indexeddb-characters");
let jsonPersistence;
require("../plugins/persistence/JsonPlayerPersistence.plugin").register({
  getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
  setPlayerPersistence: (backend) => { jsonPersistence = backend; },
  log() {},
});

const persistenceBackends = [
  ["SQLite", persistence],
  ["JSON", jsonPersistence],
  ["IndexedDB", new IndexedDbPlayerPersistence()],
];

for (const [name, backend] of persistenceBackends) {
  test(`${name}: account creation time survives committed save and login load`, async () => {
    const original = player(`Account Date ${name}`);
    const created = Date.now() - 36_000_001;
    original.getCreationDate().setTime(created);
    backend.save(original, "logout");
    await backend.flush();
    const loggedIn = player(original.getUsername());
    backend.load(original.getUsername()).applyToPlayer(loggedIn);
    assert.equal(loggedIn.getCreationDate().getTime(), created);
    backend.save(loggedIn, "logout");
    await backend.flush();
    const reloaded = player(original.getUsername());
    backend.load(original.getUsername()).applyToPlayer(reloaded);
    assert.equal(reloaded.getCreationDate().getTime(), created);
  });

  test(`${name}: non-default combat styles survive a committed save and login load`, async () => {
    for (const [index, fightType] of [FightType.UNARMED_BLOCK, FightType.UNARMED_PUNCH].entries()) {
      const original = player(`Style ${name} ${index}`);
      original.setFightType(fightType);
      backend.save(original, "logout");
      await backend.flush();
      const save = backend.load(original.getUsername());
      assert.equal(save.getFightType(), fightType, "load restores the selected registry entry");
      const loggedIn = player(original.getUsername());
      save.applyToPlayer(loggedIn);
      assert.equal(loggedIn.getFightType(), fightType, "login applies the selected style");
    }
  });

  test(`${name}: item meta saved under the old camelCase keys loads under the kebab-case ones (#226)`, () => {
    const item = backend.hydrateItem({ id: 12926, amount: 1, meta: { toxicBlowpipe: { scales: 100, darts: { id: 11230, amount: 50 } }, "barrows:lockpickCharges": 7 } });
    assert.deepEqual(item.getMeta(), { "toxic-blowpipe": { scales: 100, darts: { id: 11230, amount: 50 } }, "barrows:lockpick-charges": 7 });
    const both = backend.hydrateItem({ id: 11907, amount: 1, meta: { tridentCharges: 1, "trident-charges": 2500 } });
    assert.deepEqual(both.getMeta(), { "trident-charges": 2500 }, "a kebab-case key already there wins");
    const current = backend.hydrateItem({ id: 4241, amount: 1, meta: { "blood-fury": { charges: 9 } } });
    assert.deepEqual(current.getMeta(), { "blood-fury": { charges: 9 } });
    const bag = backend.hydrateItem({ id: 11941, amount: 1, meta: { lootingBag: [{ id: 995, amount: 5 }] } });
    assert.deepEqual(bag.getMeta(), { lootingBag: [{ id: 995, amount: 5 }] }, "only the keys #226 renamed move");
  });

  // #4705 review: the looting bag still keeps its contents under the camelCase "lootingBag", so only #226's own
  // renamed keys may be migrated; two save/load round trips keep the bag's contents.
  test(`${name}: a looting bag's contents survive save and login load twice`, async () => {
    const { Item } = require("../dist/game/model/Item");
    const contents = [{ id: 995, amount: 1000 }, { id: 4151, amount: 1 }];
    const original = player(`Looting Bag ${name}`);
    original.getInventory().setItem(0, new Item(11941, 1, { lootingBag: contents, "lootingBag:open": true }));
    backend.save(original, "logout");
    await backend.flush();
    const loggedIn = player(original.getUsername());
    backend.load(original.getUsername()).applyToPlayer(loggedIn);
    assert.deepEqual(loggedIn.getInventory().getItems()[0].getMeta(), { lootingBag: contents, "lootingBag:open": true });
    loggedIn.getInventory().getItems()[0].setMetaValue("lootingBag", [...contents, { id: 536, amount: 3 }]);
    backend.save(loggedIn, "logout");
    await backend.flush();
    const reloaded = player(original.getUsername());
    backend.load(original.getUsername()).applyToPlayer(reloaded);
    assert.deepEqual(reloaded.getInventory().getItems()[0].getMetaValue("lootingBag"), [...contents, { id: 536, amount: 3 }],
      "what the next session added is kept");
    assert.equal(reloaded.getInventory().getItems()[0].getMetaValue("looting-bag"), undefined);
  });

  test(`${name}: missing or invalid saved combat styles retain the safe default`, () => {
    for (const fightType of [undefined, null, {}, "UNARMED_BLOCK", { animation: -123456 }]) {
      const save = backend.hydratePlayerSave({ fightType });
      assert.equal(save.getFightType(), FightType.UNARMED_PUNCH);
    }
  });
}

let combatStyleCache;
for (const [name, backend] of persistenceBackends) {
  test(`${name}: equipped weapons keep colliding styles through login assignment`, async () => {
    const { CachePipeline } = require("../dist/game/cache/CachePipeline");
    combatStyleCache ??= CachePipeline.initialize(path.resolve(__dirname, "..")).then(() => {
      require("../plugins/items/ItemDefinitionLoader.plugin").register({
        log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
      });
    });
    await combatStyleCache;
    const { Item } = require("../dist/game/model/Item");
    const { Equipment } = require("../dist/game/model/container/impl/Equipment");
    const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
    const styles = [[1291, FightType.LONGSWORD_BLOCK], [839, FightType.LONGBOW_LONGRANGE], [1321, FightType.SCIMITAR_BLOCK]];
    for (const [weaponId, fightType] of styles) {
      const original = player(`Equipped ${name} ${weaponId}`);
      original.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(weaponId, 1));
      original.setFightType(fightType);
      backend.save(original, "logout");
      await backend.flush();
      const save = backend.load(original.getUsername());
      const loggedIn = new Player({ sendClientPacket: () => true, write() {} });
      loggedIn.setUsername(original.getUsername());
      save.applyToPlayer(loggedIn);
      WeaponInterfaceManager.assign(loggedIn);
      assert.equal(loggedIn.getFightType(), fightType, `weapon ${weaponId} retains its own style after assignment`);
      assert.equal(loggedIn.getPacketSender().getVarp(43), fightType.getChildId());
      for (const invalid of [undefined, null, {}, { animation: -123456 }]) {
        const invalidSave = backend.hydratePlayerSave({ ...save, fightType: invalid });
        assert.equal(invalidSave.getFightType(), FightType.UNARMED_PUNCH, "invalid styles keep the safe fallback with equipment too");
      }
    }
  });
}

test("legacy combat style fields resolve uniquely within every weapon family", () => {
  const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
  for (const weapon of Object.values(WeaponInterfaces)) {
    if (typeof weapon?.getFightType !== "function") continue;
    for (const fightType of weapon.getFightType()) {
      const legacy = JSON.parse(JSON.stringify(fightType));
      assert.equal(FightType.resolve(legacy, weapon.getFightType()), fightType, `${weapon.getName()} style ${fightType.getChildId()}`);
    }
  }
});

test("deleting a save removes the row, keeps its history under a deleted key, and frees the name", async () => {
  const p = player("Doomed");
  setGold(p, 1);
  persistence.save(p, "save");
  setGold(p, 2);
  persistence.save(p, "logout");
  await persistence.flush();
  await persistence.delete("Doomed");
  assert.equal(persistence.exists("Doomed"), false);
  assert.equal(persistence.load("Doomed"), null);
  assert.deepEqual(await snapshots("Doomed"), []);
  const kept = persistence.database.prepare("SELECT username, reason FROM player_save_history WHERE username LIKE 'deleted:%:doomed' ORDER BY id").all();
  assert.equal(kept.length, 2, "every older copy was re-keyed");
  // The final copy equals the newest one already recorded, so history skips a duplicate.
  assert.equal(kept.at(-1).reason, "logout");
  const fresh = player("Doomed");
  setGold(fresh, 9);
  persistence.save(fresh, "fresh");
  assert.deepEqual((await snapshots("Doomed")).map((s) => s.reason), ["fresh"]);
  assert.equal(await savedGold("Doomed"), 9);
});

test("deleting a save records an unrecorded final copy as character-delete", async () => {
  const p = player("Doomed Two");
  setGold(p, 1);
  persistence.save(p, "save");
  await persistence.flush();
  persistence.database.prepare("DELETE FROM player_save_history WHERE username = 'doomed_two'").run();
  await persistence.delete("Doomed Two");
  const reasons = persistence.database.prepare("SELECT reason FROM player_save_history WHERE username LIKE 'deleted:%:doomed_two' ORDER BY id").all().map((r) => r.reason);
  assert.equal(reasons.at(-1), "character-delete");
});

test("deleting a save that does not exist resolves and writes nothing", async () => {
  const before = persistence.sequence;
  await persistence.delete("Never Existed");
  assert.equal(persistence.sequence, before);
  assert.equal(persistence.exists("Never Existed"), false);
});

test("deleting right after a save still in flight leaves nothing behind", async () => {
  const p = player("Racer");
  setGold(p, 3);
  persistence.save(p, "save");
  assert.ok(persistence.unwritten.has("racer"));
  const done = persistence.delete("Racer");
  assert.equal(persistence.exists("Racer"), false, "gone at once");
  assert.equal(persistence.load("Racer"), null);
  await done;
  await persistence.flush();
  assert.equal(persistence.findSave.get("racer"), undefined);
  assert.equal(persistence.exists("Racer"), false);
});

test("a delete answers for its own write: another player's failed save doesn't fail it", async () => {
  const bystander = player("Bystander");
  setGold(bystander, 1);
  persistence.save(bystander, "logout");
  const doomed = player("Doomed Three");
  setGold(doomed, 1);
  persistence.save(doomed, "logout");
  await persistence.flush();
  const quiet = console.error;
  console.error = () => {};
  try {
    // An unrelated save the writer refuses (as in the Hank test) is still reported by flush.
    persistence.enqueue("bystander", [{ kind: "row", json: "{\"position\":{}}" }]);
    await persistence.delete("Doomed Three");
    assert.equal(persistence.findSave.get("doomed_three"), undefined, "the delete was committed");
    await assert.rejects(persistence.flush(), /Refusing to save bystander/);
  } finally {
    console.error = quiet;
  }
  persistence.save(bystander, "logout");
  await persistence.flush();
});

test("a delete whose own write fails rejects and keeps the save", async () => {
  const p = player("Doomed Four");
  setGold(p, 4);
  persistence.save(p, "logout");
  await persistence.flush();
  const writer = persistence.writer;
  const post = writer.postMessage.bind(writer);
  // A row that fails validation in the same message makes the writer roll the delete back.
  writer.postMessage = (message) => post(message.writes.some((write) => write.kind === "delete")
    ? { ...message, writes: [...message.writes, { kind: "row", json: "{\"position\":{}}" }] }
    : message);
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(persistence.delete("Doomed Four"), /Refusing to save doomed_four/);
  } finally {
    writer.postMessage = post;
    console.error = quiet;
  }
  assert.equal(persistence.exists("Doomed Four"), true, "the save is still there");
  assert.equal(await savedGold("Doomed Four").catch(() => null), null, "flush reports the failed write");
  persistence.save(p, "logout");
  assert.equal(await savedGold("Doomed Four"), 4);
});

test("JSON backend deletes the file, even one still queued; Null backend ignores delete", async () => {
  const p = player("Json Doomed");
  jsonPersistence.save(p);
  await jsonPersistence.flush();
  const file = jsonPersistence.resolveFilePath("Json Doomed");
  assert.ok(fs.existsSync(file));
  await jsonPersistence.delete("Json Doomed");
  assert.equal(jsonPersistence.exists("Json Doomed"), false);
  assert.ok(!fs.existsSync(file));
  jsonPersistence.save(p);
  await jsonPersistence.delete("Json Doomed");
  await jsonPersistence.flush();
  assert.ok(!fs.existsSync(file), "a queued write does not land after the delete");
  const idb = new IndexedDbPlayerPersistence();
  idb.save(p);
  await idb.delete("Json Doomed");
  assert.equal(idb.exists("Json Doomed"), false);
  const { NullPlayerPersistence } = require("../dist/game/entity/impl/player/persistence/NullPlayerPersistence");
  await new NullPlayerPersistence().delete("anyone");
});

test("a pending delete hides the save's history and refuses a restore", async () => {
  const p = player("Hidden");
  setGold(p, 1);
  persistence.save(p, "save");
  setGold(p, 2);
  persistence.save(p, "logout");
  await persistence.flush();
  const id = (await snapshots("Hidden"))[0].id;
  const done = persistence.delete("Hidden");
  assert.deepEqual(persistence.listSnapshots("Hidden"), []);
  assert.equal(persistence.restoreSnapshot("Hidden", id), null);
  await done;
  assert.equal(persistence.exists("Hidden"), false);
  assert.equal(persistence.findSave.get("hidden"), undefined, "the refused restore wrote nothing");
});

test("JSON delete forgets a write that fails while it waits", async () => {
  const p = player("Json Failing");
  const file = jsonPersistence.resolveFilePath("Json Failing");
  const fsp = require("node:fs/promises");
  const original = fsp.mkdir;
  fsp.mkdir = async () => { throw new Error("disk full"); };
  const quiet = console.error;
  console.error = () => {};
  try {
    jsonPersistence.save(p);
    await jsonPersistence.delete("Json Failing");
  } finally {
    fsp.mkdir = original;
    console.error = quiet;
  }
  await jsonPersistence.flush();
  assert.ok(!fs.existsSync(file));
});
