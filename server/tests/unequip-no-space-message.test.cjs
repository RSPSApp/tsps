// Run after `yarn build`: node --test tests/unequip-no-space-message.test.cjs
// Removing a worn item with nowhere to put it says "You don't have enough free space to do that." on live
// (rsprox_transcripts/226/01685.txt, 238/04147.txt: wornitems click, then that game message), and keeps it worn.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");

const LIVE = "You don't have enough free space to do that.";
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9310;
function player(t) {
  const p = new Player(null);
  p.setIndex(next++);
  p.setUsername(`unequipqa${p.getIndex()}`);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.messages = [];
  t.mock.method(p, "getSession", () => ({ sendClientPacket() { return true; }, write() { return true; } }));
  t.mock.method(p, "sendMessage", (m) => p.messages.push(m));
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  t.mock.method(p.getEquipment(), "refreshItems", () => p.getEquipment());
  p.setRegistered(true);
  p.setHitpoints(10);
  t.after(() => p.setRegistered(false));
  return p;
}

test("a full inventory keeps the worn helmet and gives the live message", (t) => {
  const p = player(t);
  const I = core.ItemIdentifiers;
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.BRONZE_FULL_HELM, 1));
  for (let slot = 0; slot < 28; slot++) p.getInventory().setItem(slot, new core.Item(I.RAKE, 1));
  assert.equal(EquipPacketListener.unequip(p, core.Equipment.HEAD_SLOT), false);
  assert.equal(p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), I.BRONZE_FULL_HELM);
  assert.deepEqual(p.messages, [LIVE]);
});

test("worn arrows that would overflow the carried stack stay worn with the same message", (t) => {
  const p = player(t);
  const I = core.ItemIdentifiers;
  p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(I.BRONZE_ARROW, 10));
  p.getInventory().setItem(0, new core.Item(I.BRONZE_ARROW, 2147483647));
  assert.equal(EquipPacketListener.unequip(p, core.Equipment.AMMUNITION_SLOT), false);
  assert.equal(p.getEquipment().getItems()[core.Equipment.AMMUNITION_SLOT].getAmount(), 10);
  assert.deepEqual(p.messages, [LIVE]);
});

test("the last free slot still takes the worn item", (t) => {
  const p = player(t);
  const I = core.ItemIdentifiers;
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.BRONZE_FULL_HELM, 1));
  for (let slot = 0; slot < 27; slot++) p.getInventory().setItem(slot, new core.Item(I.RAKE, 1));
  assert.equal(EquipPacketListener.unequip(p, core.Equipment.HEAD_SLOT), true);
  assert.equal(p.getInventory().getItems()[27].getId(), I.BRONZE_FULL_HELM);
  assert.deepEqual(p.messages, []);
});
