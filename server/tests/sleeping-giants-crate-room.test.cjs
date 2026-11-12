// Run after `yarn build`: node --test tests/sleeping-giants-crate-room.test.cjs
// Sleeping Giants: the crate's 20-slot check (jYd0Ih) is answered when it is searched; taking worn gear off before
// the take (which leaves the dialogue open) filled a slot, and the one-time crate then marked itself looted and dropped
// what did not fit. Real engine: every plugin loaded, a real Player, a native equipment Remove, the quest's own
// "You take a selection of bars and weapons" step.
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
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const take = (p) => PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: core.NpcIdentifiers.KOVAC, stepId: "BkbGGN", kind: "message" });

test("gear taken off between the crate's room check and the take keeps the crate full", async (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9030); p.setUsername("giants9030"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => p.setRegistered(false));
  const inv = p.getInventory();
  for (let slot = 0; slot < 8; slot++) inv.setItem(slot, new core.Item(I.LOGS, 1)); // exactly 20 free
  p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_RECOIL, 1));
  await c.dispatch([{ type: "widget_action", widgetId: (387 << 16) | 24, groupId: 387, childId: 24, buttonNum: 1 }]);
  c.processTurnPackets();
  assert.equal(inv.getFreeSlots(), 19, "the ring took a slot");
  take(p);
  assert.equal(inv.getAmount(I.BRONZE_BAR), 0, "nothing given into 19 slots");
  inv.delete(I.RING_OF_RECOIL, 1);
  take(p);
  assert.deepEqual([inv.getAmount(I.BRONZE_BAR), inv.getAmount(I.IRON_BAR), inv.getAmount(I.IRON_PLATEBODY)], [8, 6, 1], "the crate is still there to take");
});
