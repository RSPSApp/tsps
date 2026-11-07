// Run after `yarn build`: node --test tests/warriors-guild-cyclopes-relog.test.cjs
// Warriors' Guild cyclopes (Wiki, Warrior guild token): "With every minute spent inside one of the cyclops rooms, 10
// tokens will crumble away." The room's state came only from its door, so a relog inside (a new Player) stopped the
// drain and the defender drops. Real engine: every plugin loaded, a real Player logging in on a room tile, the plugin's
// own login and process hooks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9800;
const MINUTE_TICKS = 100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function relogAt(t, x, y, z) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("cyclops" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.getInventory().setItem(0, new core.Item(I.WARRIOR_GUILD_TOKEN, 100));
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  return { p, messages };
}

function minute(p) {
  for (let tick = 0; tick < MINUTE_TICKS; tick++) PM.emitPlayerProcess({ player: p });
}

test("logging back in inside the top cyclops room keeps the tokens crumbling", (t) => {
  const { p, messages } = relogAt(t, 2860, 3545, 2);
  minute(p);
  assert.equal(p.getInventory().getAmount(I.WARRIOR_GUILD_TOKEN), 90);
  assert.ok(messages.includes("10 of your tokens crumble away."));
});

test("logging back in inside the basement keeps the tokens crumbling", (t) => {
  const { p } = relogAt(t, 2925, 9960, 0);
  minute(p);
  assert.equal(p.getInventory().getAmount(I.WARRIOR_GUILD_TOKEN), 90);
});

test("logging in outside the rooms (the lobby) costs nothing", (t) => {
  const { p } = relogAt(t, 2843, 3540, 2);
  minute(p);
  assert.equal(p.getInventory().getAmount(I.WARRIOR_GUILD_TOKEN), 100);
});
