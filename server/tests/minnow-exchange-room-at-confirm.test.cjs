// Run after `yarn build`: node --test tests/minnow-exchange-room-at-confirm.test.cjs
// Kylie Minnow's exchange checks for room for the noted sharks before asking how many; gloves taken off while the
// amount prompt is open filled the last slot, and the minnows were then taken for sharks that vanished. Real engine:
// every plugin loaded, a real Player, a native worn-equipment Remove and the native dialogue_amount packet.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let I;
let Minnows;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Minnows = require("../plugins/skills/fishing/MinnowPlatform.Fishing");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("gloves taken off while the amount prompt is open keep the minnows", async (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8970); p.setUsername("minnow8970"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => p.setRegistered(false));
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.MINNOW, 100));
  for (let slot = 1; slot < 27; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1)); // one free slot
  p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(I.LEATHER_GLOVES, 1));
  Minnows.exchangeMinnows(p);
  assert.ok(p.getEnteredAmountAction(), "the amount prompt is open");
  // The hands slot is the 8th of the worn tab's slots (child 15 + 7).
  await c.dispatch([{ type: "widget_action", widgetId: (387 << 16) | 22, groupId: 387, childId: 22, buttonNum: 1 }]);
  c.processTurnPackets();
  assert.equal(inv.getFreeSlots(), 0, "the gloves took the last slot");
  await c.dispatch([{ type: "dialogue_amount", amount: 2 }]);
  c.processTurnPackets();
  const notedShark = core.ItemDefinition.forId(I.RAW_SHARK).getNoteId();
  assert.equal(inv.getAmount(I.MINNOW), 100, "no minnows taken");
  assert.equal(inv.getAmount(notedShark), 0);
});
