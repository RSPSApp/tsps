// Run after `yarn build`: node --test tests/lunar-ring-dig.test.cjs
// RSPSApp/tsps#5162: the Lunar ring is dug up with the spade's Dig option at the blue flowers at
// 2090,3877 (Wiki: Lunar Diplomacy), the same as using the spade on the flowers. Real plugins, a real
// Player and Inventory, and the click goes through the real inventory packet dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const SPADE = 952;
const LUNAR_RING = 9104;
const STAFF_GIVEN = 150;
let core;
let quest;
let next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((entry) => entry.key === "lunar_diplomacy");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y], stage = STAFF_GIVEN) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("lunarring" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  quest.setStage(p, stage);
  p.getInventory().setItem(0, new core.Item(SPADE, 1));
  return { p, c, messages };
}

async function dig(f) {
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId: SPADE, widgetId: 3214, option: "Dig" }]);
  f.c.processTurnPackets();
}
const rings = (f) => f.p.getInventory().getAmount(LUNAR_RING);

test("digging at the ring flowers gives the lunar ring once", async (t) => {
  const f = actor(t, [2090, 3878]);
  await dig(f);
  assert.equal(rings(f), 1);
  assert.ok(!f.messages.includes("Nothing interesting happens."));
  await dig(f);
  assert.equal(rings(f), 1);
  assert.ok(f.messages.includes("You already have the lunar ring."));
});

test("digging with a full inventory gives no ring", async (t) => {
  const f = actor(t, [2090, 3877]);
  for (let i = 1; i < 28; i++) f.p.getInventory().setItem(i, new core.Item(995, 1 + i));
  await dig(f);
  assert.equal(rings(f), 0);
  assert.ok(f.messages.includes("You need a free inventory space for the lunar ring."));
});

test("digging before the staff stage gives no ring", async (t) => {
  const f = actor(t, [2090, 3877], 100);
  await dig(f);
  assert.equal(rings(f), 0);
});

test("digging elsewhere still says nothing interesting happens", async (t) => {
  const f = actor(t, [2100, 3877]);
  await dig(f);
  assert.equal(rings(f), 0);
  assert.deepEqual(f.messages, ["Nothing interesting happens."]);
});
