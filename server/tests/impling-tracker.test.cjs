// Run after `yarn build`: node --test tests/impling-tracker.test.cjs
// Issue 4463: the butterfly nets' "Check totals" (worn "Check Totals") opens the Impling Tracker as live does
// (rsprox 20261111T231757-5ab63b4: script 2524, interface 180, then 1327 with the surface and Puro-Puro lists and
// the tabs' components). Catches are counted from hunter:impling-caught. Every plugin is loaded and the click
// goes through the real inventory dispatch.
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

/** Live's zero lists, verbatim from the capture. */
const LIVE_SURFACE_ZERO = "Baby:<br><col=ffffff>0|Young:<br><col=ffffff>0|Gourmet:<br><col=ffffff>0|Earth:<br><col=ffffff>0|Essence:<br><col=ffffff>0|Eclectic:<br><col=ffffff>0|Nature:<br><col=ffffff>0|Magpie:<br><col=ffffff>0|Ninja:<br><col=ffffff>0|Crystal:<br><col=ffffff>0|Dragon:<br><col=ffffff>0|Lucky:<br><col=ffffff>0";
const LIVE_PURO_AFTER = "Baby:<br><col=ffffff>0|Young:<br><col=ffffff>1|Gourmet:<br><col=ffffff>0|Earth:<br><col=ffffff>0|Essence:<br><col=ffffff>1|Eclectic:<br><col=ffffff>0|Nature:<br><col=ffffff>0|Magpie:<br><col=ffffff>0|Ninja:<br><col=ffffff>0|<col=a46c19>Crystal:<br><col=a49f99>-|Dragon:<br><col=ffffff>0|Lucky:<br><col=ffffff>0";
const LIVE_COMPONENTS = [11796484, 11796486, 11796485, 11796483, 11796488, 11796490, 11796489, 11796487];

test("the tracker has one entry per enum 1316 model", () => {
  assert.equal(Tracker.IMPLINGS.length, core.CacheDefinitions.getEnumValues(1316).size);
});

test("a fresh player's tracker is live's zero lists, opened as the main modal", async (t) => {
  const f = actor(t);
  await checkTotals(f, core.ItemIdentifiers.MAGIC_BUTTERFLY_NET);
  assert.deepEqual(f.sent.interfaces, [TRACKER]);
  assert.deepEqual(f.sent.scripts.find(([id]) => id === 1327),
    [1327, LIVE_SURFACE_ZERO, LIVE_PURO_AFTER.replace("Young:<br><col=ffffff>1", "Young:<br><col=ffffff>0").replace("Essence:<br><col=ffffff>1", "Essence:<br><col=ffffff>0"), ...LIVE_COMPONENTS]);
});

test("Puro-Puro catches of a young and an essence impling give live's Puro-Puro list", async (t) => {
  const f = actor(t);
  caught(f.p, "ii_impling_type_5_maze", true);
  caught(f.p, "ii_impling_type_2_maze", true);
  caught(f.p, "ii_impling_type_12_johnny", false);
  caught(f.p, "ii_impling_type_1", false);
  caught(f.p, "ii_impling_type_1", false);
  await checkTotals(f, core.ItemIdentifiers.BUTTERFLY_NET);
  const script = f.sent.scripts.find(([id]) => id === 1327);
  assert.equal(script[2], LIVE_PURO_AFTER);
  assert.equal(script[1], LIVE_SURFACE_ZERO.replace("Baby:<br><col=ffffff>0", "Baby:<br><col=ffffff>2").replace("Crystal:<br><col=ffffff>0", "Crystal:<br><col=ffffff>1"));
});
