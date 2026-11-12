// Run after `yarn build`: node --test tests/chinchompa-throw-paid.test.cjs
// A thrown chinchompa is paid when it lands, from the stack that threw it, but only if that very object was still
// wielded: unwielding mid-flight (the stack goes to the pack) or re-wielding (a copy) made the throw free. The throw
// is paid from the same chinchompas wherever they are now. Real engine: every plugin loaded, a real Player, the
// plugin's own ammo handler and the real TaskManager.
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
let consume;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  consume = require("../plugins/items/Chinchompas.plugin")._test.consumeChinchompa;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function thrower(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8947); p.setUsername("chin8947"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.RED_CHINCHOMPA_2, 100));
  return p;
}
const land = () => { for (let i = 0; i < 3; i++) core.TaskManager.process(); };

test("unwielding mid-flight still pays the throw from the stack in the pack", (t) => {
  const p = thrower(t);
  assert.equal(consume(p, null, 1, 2), true);
  // What unequipping does (EquipPacketListener): the same object moves to the pack.
  const worn = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  p.getInventory().setItem(0, worn);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  land();
  assert.equal(p.getInventory().getAmount(I.RED_CHINCHOMPA_2), 99, "the throw is paid");
});

test("re-wielding mid-flight (a copy) still pays the throw; another weapon swapped in is left alone", (t) => {
  const p = thrower(t);
  consume(p, null, 1, 2);
  const worn = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, worn.clone()); // what re-equipping does
  land();
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getAmount(), 99, "the throw is paid");

  consume(p, null, 1, 2);
  const chins = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.MAGIC_SHORTBOW, 1));
  p.getBank(0).add(chins);
  land();
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), I.MAGIC_SHORTBOW, "the bow is untouched");
});

test("two throws in flight after the last chinchompa is unwielded: the second leaves the empty slots alone", (t) => {
  const p = thrower(t);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.RED_CHINCHOMPA_2, 1));
  consume(p, null, 1, 2);
  consume(p, null, 1, 2);
  const worn = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  p.getInventory().setItem(0, worn); // unwielded: the same object, into the pack
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  land();
  assert.equal(p.getInventory().getAmount(I.RED_CHINCHOMPA_2), 0, "the one chinchompa paid the first throw");
  const slot = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  assert.equal(slot.getId(), -1);
  assert.equal(slot.getAmount(), 0, "the empty weapon slot isn't charged for the second throw");
  assert.ok(p.getInventory().getItems().every((item) => item.getAmount() >= 0), "no negative stack anywhere");
});

test("throws given back on top of a kept throw (ranged:ammo-saving extra) join the stack, wherever it is now", (t) => {
  const keep = (extra) => (event) => { event.saved = event.amount; event.extra = extra; };
  const p = thrower(t);
  const emit = PM.emitCustomEvent;
  let saver = keep(2);
  t.mock.method(PM, "emitCustomEvent", (name, event) => (name === "ranged:ammo-saving" && event.player === p ? saver(event) : emit.call(PM, name, event)));
  consume(p, null, 1, 2);
  land();
  assert.equal(p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getAmount(), 102, "kept, and two more");

  saver = keep(1);
  consume(p, null, 1, 2);
  const worn = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  p.getInventory().setItem(0, worn); // unwielded mid-flight
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  land();
  assert.equal(p.getInventory().getAmount(I.RED_CHINCHOMPA_2), 103, "the stack in the pack gets it");
});
