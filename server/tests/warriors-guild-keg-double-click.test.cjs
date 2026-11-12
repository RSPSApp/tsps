// Run after `yarn build`: node --test tests/warriors-guild-keg-double-click.test.cjs
// A keg is picked up two ticks after the click, but the click only checked that it wasn't taken yet: clicking it again
// before then counted it twice, past five, and each extra keg paid 10 Strength XP and 10 tokens when the stack fell.
// A keg now counts once, and the stack stops at five. Real engine: every plugin loaded, a real Player in the keg room,
// the plugin's own pick-up handler and the real TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let Kegs;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Kegs = require("../plugins/areas/warriors-guild/Kegs.WarriorsGuild")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("clicking the same keg twice before it is picked up counts it once", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9030); p.setUsername("kegs9030"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2870, 3540, 1)); // the keg room
  t.after(() => { Kegs.balancing.delete(p); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  core.TaskManager.process(); // one tick on: the first pick-up is still under way
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(Kegs.balancing.get(p)?.kegs, 1, "one keg on the head");
});

const HELMET = 1155; // bronze full helm

function kegPlayer(t, index) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index); p.setUsername("kegs" + index); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(2870, 3540, 1)); // the keg room
  t.after(() => { Kegs.balancing.delete(p); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return p;
}

/** The real equip path (EquipPacketListener), as an inventory Wear click. */
function equipHelmet(p) {
  const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  p.getInventory().setItem(0, new core.Item(HELMET, 1));
  EquipPacketListener.equip(p, HELMET, 0, Inventory.INTERFACE_ID);
}

test("a helmet put on in the two-tick pick-up keeps its head slot: no keg replaces it", (t) => {
  const p = kegPlayer(t, 9031);
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  core.TaskManager.process();
  equipHelmet(p); // worn in the window
  assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), HELMET, "the helmet went on");
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), HELMET, "the helmet is still worn");
  assert.equal(Kegs.balancing.has(p), false, "no kegs balanced");
});

test("a helmet worn after the stack falls, while the next keg is coming, keeps its head slot", (t) => {
  const p = kegPlayer(t, 9032);
  Kegs.pickUpKeg({ player: p, objectId: 15669 });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(Kegs.balancing.get(p)?.kegs, 1);
  Kegs.pickUpKeg({ player: p, objectId: 15670 });
  core.TaskManager.process();
  equipHelmet(p); // drops the stack (the equip hook), then the helmet goes on
  assert.equal(Kegs.balancing.has(p), false, "the stack fell");
  assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), HELMET, "the helmet went on");
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), HELMET);
  assert.equal(Kegs.balancing.has(p), false);
});
