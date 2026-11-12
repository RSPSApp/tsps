// Run after `yarn build`: node --test tests/toa-het-mirror-slot.test.cjs
// Placing a Het mirror deleted the clicked slot a tick later after checking only that a mirror was held somewhere.
// Moving the mirror to another slot in that tick deleted whatever took its old slot, and the mirror stayed, so
// mirrors were unlimited. The mirror itself is taken now. Real engine: every plugin loaded, a real Player and
// Inventory, the room's own placeMirror (the room bare, its tick delay run by hand).
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
let Het;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Het = require("../plugins/minigames/toa/Het.TombsOfAmascut")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("a mirror moved in the pack before it goes down is the item taken", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8946); p.setUsername("het8946"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const pending = [];
  const placed = [];
  const room = Object.assign(Object.create(Het.HetPuzzleRoom.prototype), {
    layout: new Map(), lastStep: new Map(),
    inChallenge: () => true, objectAt: () => null,
    later: (_ticks, fn) => pending.push(fn),
    placeLayout: (tile) => placed.push(tile),
  });
  const inventory = p.getInventory();
  inventory.setItem(0, new core.Item(Het.MIRROR_ITEM, 1));
  room.placeMirror(p, 0);
  // Within the tick: the mirror is dragged to slot 5, and a shark sits where it was.
  inventory.setItem(5, inventory.getItems()[0]);
  inventory.setItem(0, new core.Item(I.SHARK, 1));
  for (const fn of pending) fn();
  assert.equal(placed.length, 1, "the mirror goes down");
  assert.equal(inventory.getAmount(I.SHARK), 1, "the shark in the old slot is not taken");
  assert.equal(inventory.getAmount(Het.MIRROR_ITEM), 0, "the mirror is taken");
});
