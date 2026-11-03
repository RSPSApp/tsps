// Run after `yarn build`: node --test tests/players-command.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const PlayerCommands = require("../plugins/commands/PlayerCommands.plugin");
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();

function register(players = [], overrides = {}) {
  const handlers = new Map(), buttons = new Map(), rights = new Map();
  PlayerCommands.register({
    core: { ...core, ...overrides },
    getWorld: () => ({ getPlayers: () => players, isPlayerSessionConnected: (p) => p.getUsername() !== "Gone" }),
    getItemOnGroundManager: () => ({}),
    getCombatFactory: () => ({}),
    getPlayerPunishment: () => ({}),
    registerCommand: (name, handler, rank) => { handlers.set(name, handler); rights.set(name, rank); },
    onInterfaceActionButton: (id, handler) => buttons.set(id, handler),
  });
  return { handlers, buttons, rights };
}

test("::players lists connected real players and leaves bots out", () => {
  const online = (username, bot = false) => ({ getUsername: () => username, isPlayerBot: () => bot });
  const players = [online("Zed"), online("Bot 1", true), online("Alice"), online("Gone")];
  const { handlers } = register(players);
  const messages = [];
  handlers.get("players")({ player: { sendMessage: (text) => messages.push(text) } });
  assert.deepEqual(messages, ["Online players (2):", "Alice, Zed"]);
});

test("::home uses the current configured spawn and refuses ordinary teleport restrictions", (t) => {
  const spawn = new core.Location(3000, 3200, 2);
  const { handlers, rights } = register([], { WorldDefinition: { WORLD_SPAWN: spawn } });
  assert.equal(rights.get("home"), core.PlayerRights.NONE);
  const messages = [], teleports = [];
  const original = core.TeleportHandler.teleport;
  core.TeleportHandler.teleport = (...args) => teleports.push(args);
  t.after(() => { core.TeleportHandler.teleport = original; });
  let busy = false, blocked = false, teleblocked = false, level = 1;
  const player = {
    busy: () => busy,
    getLocation: () => new core.Location(3100, 3600, 0),
    getWildernessLevel: () => level,
    getRights: () => core.PlayerRights.NONE,
    isPlayerBot: () => false,
    getCombat: () => ({ getTeleblockTimer: () => ({ finished: () => !teleblocked }) }),
    getMovementQueue: () => ({ isMovementBlocked: () => blocked }),
    getArea: () => null,
    sendMessage: (text) => messages.push(text),
  };
  const run = () => handlers.get("home")({ player });
  run();
  assert.equal(teleports.length, 1);
  assert.deepEqual(teleports[0].slice(2), [core.TeleportType.NORMAL, false]);
  assert.deepEqual(teleports[0][1], spawn);
  assert.notEqual(teleports[0][1], spawn, "teleport receives a snapshot of the mutable world spawn");
  spawn.set(3010, 3210, 1);
  run();
  assert.deepEqual(teleports[1][1], spawn, "a live spawn update applies to the next command");
  busy = true; run(); busy = false;
  blocked = true; run(); blocked = false;
  level = 21; run(); level = 1;
  teleblocked = true; run();
  assert.equal(teleports.length, 2, "none of the blocked attempts teleports");
  assert.ok(messages.some((text) => text.includes("Wilderness")));
  assert.ok(messages.some((text) => text.includes("magical spell")));
});

test("::staff shows connected human staff with every rank, refreshes on reopen, and closes", () => {
  const member = (name, rank, bot = false) => ({
    getUsername: () => name, getRights: () => rank, isStaff: () => rank !== core.PlayerRights.NONE,
    isPlayerBot: () => bot,
  });
  const players = [member("Zed", core.PlayerRights.OWNER), member("Alice", core.PlayerRights.MODERATOR),
    member("Bob", core.PlayerRights.ADMINISTRATOR), member("Dev", core.PlayerRights.DEVELOPER),
    member("Player", core.PlayerRights.NONE), member("Bot", core.PlayerRights.OWNER, true),
    member("Gone", core.PlayerRights.OWNER), null];
  const { handlers, buttons, rights } = register(players);
  assert.equal(rights.get("staff"), core.PlayerRights.NONE);
  const texts = new Map(), calls = [];
  const sender = Object.fromEntries(["sendConfig", "sendSubInterface", "sendInterfaceFlagsRange", "sendInterfaceScript",
    "sendInterfaceDisplayState", "closeSubInterface"].map((name) => [name, (...args) => calls.push([name, ...args])]));
  sender.sendString = (text, uid) => texts.set(uid, text);
  const player = { getPacketSender: () => sender };
  const run = () => handlers.get("staff")({ player });
  run();
  assert.equal(texts.get((119 << 16) | 5), "<col=7f0000>Online staff (4)</col>");
  assert.deepEqual([11, 12, 13, 14].map((id) => texts.get((119 << 16) | id)), [
    "<col=000080>Alice - Moderator</col>", "<col=000080>Bob - Administrator</col>",
    "<col=000080>Dev - Developer</col>", "<col=000080>Zed - Owner</col>",
  ]);
  assert.ok(calls.some((call) => call[0] === "sendSubInterface" && call[2] === 119));
  texts.clear();
  run();
  assert.equal(texts.size, 5, "unchanged texts are sent again on reopen");
  players.length = 0;
  run();
  assert.equal(texts.get((119 << 16) | 11), "<col=000080>No staff are currently online.</col>");
  assert.deepEqual(calls.at(-1), ["sendInterfaceScript", 2523, [0, 1]]);
  buttons.get((119 << 16) | 8)({ player });
  assert.deepEqual(calls.at(-1), ["closeSubInterface", (161 << 16) | 18]);
  players.push(...Array.from({ length: 211 }, (_, i) => member(`Mod${i}`, core.PlayerRights.MODERATOR)));
  texts.clear();
  run();
  assert.equal(texts.size, 211, "title plus at most the native journal's 210 rows");
  assert.match(texts.get((119 << 16) | 220), /More staff/);
});
