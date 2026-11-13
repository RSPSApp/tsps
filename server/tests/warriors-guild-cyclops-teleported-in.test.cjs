// Run after `yarn build`: node --test tests/warriors-guild-cyclops-teleported-in.test.cjs
// A player put in a cyclops room without its door (an admin's teleport) was never added to the room, so no tokens
// drained and no defender dropped. They are now in the room from the first tick it sees them there. Real engine:
// every plugin loaded, a real Player and Inventory, the real player-process hook; only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const ROOM = "warriors-guild:room";

function guildPlayer(t, index, location) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index); p.setUsername("cyclops" + index); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.messages = [];
  p.sendMessage = (message) => p.messages.push(message);
  p.getInventory().resetItems();
  p.setLocation(location);
  t.after(() => { PM.emitPlayerLogout?.({ player: p }); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return p;
}

function process(p, ticks) {
  for (let i = 0; i < ticks; i++) PM.emitPlayerProcess({ player: p });
}

const token = () => core.ItemIdentifiers.WARRIOR_GUILD_TOKEN;

test("a player teleported into Kamfreena's room pays 10 tokens a minute like one who came through the door", (t) => {
  const p = guildPlayer(t, 9040, new core.Location(2860, 3545, 2));
  p.getInventory().adds(token(), 25);
  process(p, 1);
  assert.equal(p.getAttribute(ROOM)?.room, "top", "in the room from the first tick");
  assert.equal(p.getInventory().getAmount(token()), 25, "no entry fee: they never used the door");
  process(p, 99);
  assert.equal(p.getInventory().getAmount(token()), 15, "a minute in, 10 tokens go");
  assert.ok(p.messages.includes("10 of your tokens crumble away."));
});

test("a player teleported into Lorelai's basement pays too, and leaving the room ends it", (t) => {
  const p = guildPlayer(t, 9041, new core.Location(2920, 9960, 0));
  p.getInventory().adds(token(), 40);
  process(p, 100);
  assert.equal(p.getAttribute(ROOM)?.room, "basement");
  assert.equal(p.getInventory().getAmount(token()), 30);
  p.setLocation(new core.Location(2907, 9968, 0)); // Lorelai's lobby
  process(p, 1);
  assert.deepEqual(p.getAttribute(ROOM), {}, "out of the room");
  process(p, 100);
  assert.equal(p.getInventory().getAmount(token()), 30, "nothing more is taken outside");
});
