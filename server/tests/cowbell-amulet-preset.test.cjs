// Run after `yarn build`: node --test tests/cowbell-amulet-preset.test.cjs
// Charging the cowbell amulet took air runes by id and Uncharge pays plain runes back, so free preset air runes came
// back plain. Only plain runes charge it now. Real engine: every plugin loaded, a real Player and Inventory, the
// amulet's own item-on-item path and amount prompt.
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
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function setup(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8941); p.setUsername("cowbell8941"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const amulet = new core.Item(I.COWBELL_AMULET, 1);
  p.getInventory().setItem(0, amulet);
  const charge = () => {
    p.setEnteredAmountAction(null);
    PM.emitItemOnItem({ player: p, usedItemId: I.AIR_RUNE, usedItem: p.getInventory().getItems()[1], usedSlot: 1,
      usedWithItemId: amulet.getId(), usedWithItem: amulet, usedWithSlot: 0, handled: false });
    return p.getEnteredAmountAction();
  };
  return { p, amulet, charge };
}

function presetRunes(amount) {
  const runes = new core.Item(I.AIR_RUNE, amount);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) runes.setMetaValue(meta, true);
  return runes;
}

test("preset air runes do not charge the amulet; plain ones do", (t) => {
  const f = setup(t);
  f.p.getInventory().setItem(1, presetRunes(500));
  assert.equal(f.charge(), null, "no amount prompt for preset-only runes");
  assert.equal(f.p.getInventory().getAmount(I.AIR_RUNE), 500, "the preset runes stay");
  assert.equal(f.amulet.getMetaValue("cowbell-amulet:charges"), undefined);

  f.p.getInventory().setItem(2, new core.Item(I.AIR_RUNE, 30));
  // the event names the preset stack, as the client may; only the plain 30 pay
  f.charge().execute(400);
  assert.equal(f.amulet.getMetaValue("cowbell-amulet:charges"), 30);
  assert.equal(f.p.getInventory().getItems()[1]?.getAmount(), 500, "the preset stack is untouched");
  assert.equal(f.p.getInventory().getAmount(I.AIR_RUNE), 500, "only the plain stack paid");
});
