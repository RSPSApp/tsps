// Run after `yarn build`: node --test tests/impling-tracker.test.cjs
// Issue 4463: the butterfly nets' "Check totals" (worn "Check Totals") opens the Impling Tracker (Wiki,
// Insect net), interface 180 filled by clientscript 1327 from two "|" lists in enum 1316's order, one for
// the surface and one for Puro-Puro. Catches are counted from hunter:impling-caught. Every plugin is
// loaded and the click goes through the real inventory dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Tracker = require("../plugins/skills/hunter/ImplingTracker.Hunter");

let core;
let next = 5500;
const TRACKER = 180;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("imptrack" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(2591, 4320, 0));
  p.needsPlacement = false;
  const sent = { interfaces: [], scripts: [] };
  const sender = p.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  const sendClientScript = sender.sendClientScript.bind(sender);
  t.mock.method(sender, "sendInterface", (id, ...rest) => { sent.interfaces.push(id); return sendInterface(id, ...rest); });
  t.mock.method(sender, "sendClientScript", (id, ...args) => { sent.scripts.push([id, ...args]); return sendClientScript(id, ...args); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, sent };
}

const npc = (name) => core.CacheDefinitions.getNpcId(name);
const caught = (p, gameval, puro) => PM.emitCustomEvent("hunter:impling-caught", { player: p, npc: null, npcId: npc(gameval), puro, handled: false });

async function checkTotals(f, itemId) {
  f.p.getInventory().setItem(0, new core.Item(itemId, 1));
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId, widgetId: 3214, option: "Check totals" }]);
  f.c.processTurnPackets();
}

test("the tracker's impling order covers enum 1316, one impling per model", () => {
  assert.equal(Tracker.IMPLINGS.length, core.CacheDefinitions.getEnumValues(1316).size);
  assert.equal(new Set(Tracker.IMPLINGS).size, Tracker.IMPLINGS.length);
});

test("catches count per tab, and Check totals opens ii_tracker with both lists", async (t) => {
  const f = actor(t);
  caught(f.p, "ii_impling_type_1", false);
  caught(f.p, "ii_impling_type_1", false);
  caught(f.p, "ii_impling_type_10_maze", true);
  caught(f.p, "ii_impling_type_12_johnny", false);
  const counts = Tracker.totals(f.p);
  const at = (name) => Tracker.IMPLINGS.indexOf(name);
  assert.equal(counts.surface[at("Baby impling")], 2);
  assert.equal(counts.puro[at("Dragon impling")], 1);
  assert.equal(counts.surface[at("Crystal impling")], 1);
  assert.equal(counts.surface.reduce((a, b) => a + b), 3);

  await checkTotals(f, core.ItemIdentifiers.BUTTERFLY_NET);
  assert.deepEqual(f.sent.interfaces, [core.CacheDefinitions.getInterfaceId("ii_tracker")]);
  const script = f.sent.scripts.find(([id]) => id === 1327);
  assert.ok(script, "clientscript 1327 builds the tracker");
  const uid = (child) => (TRACKER << 16) | child;
  assert.deepEqual(script.slice(1, 9), [...Tracker.SURFACE_COMPONENTS, ...Tracker.PURO_COMPONENTS].map(uid));
  assert.equal(script[9], counts.surface.join("|"));
  assert.equal(script[10], counts.puro.join("|"));
});

test("the magic butterfly net opens the same tracker, and a fresh player's lists are all zero", async (t) => {
  const f = actor(t);
  await checkTotals(f, core.ItemIdentifiers.MAGIC_BUTTERFLY_NET);
  const script = f.sent.scripts.find(([id]) => id === 1327);
  assert.equal(script[9], Tracker.IMPLINGS.map(() => 0).join("|"));
});
