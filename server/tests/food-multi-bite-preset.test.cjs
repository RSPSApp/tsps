// Run after `yarn build`: node --test tests/food-multi-bite-preset.test.cjs
// The next bite of a multi-bite food was a fresh item, so a preset redberry pie (PvP presets) left a plain, tradeable
// half pie, and the last bite a plain pie dish. What is left keeps the eaten item's meta now. Real engine: every plugin
// loaded, a real Player and Inventory, the food's own Eat item action at the cache's op index.
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

test("a preset redberry pie leaves a preset half pie; a plain one leaves a plain half", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8944); p.setUsername("pie8944"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const inventory = p.getInventory();
  const preset = new core.Item(I.REDBERRY_PIE, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) preset.setMetaValue(meta, true);
  inventory.setItem(0, preset);
  inventory.setItem(1, new core.Item(I.REDBERRY_PIE, 1));
  const eat = (slot) => {
    p.getTimers().cancel(core.TimerKey.FOOD); // the eat delay between bites
    const item = inventory.getItems()[slot];
    return PM.emitItemAction({ player: p, item, itemId: item.getId(), slot,
      interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
      clickType: core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Eat") + 1, handled: false });
  };
  assert.equal(eat(0), true);
  const half = inventory.getItems()[0];
  assert.equal(half?.getId(), I.HALF_A_REDBERRY_PIE);
  assert.equal(half.isPresetItem(), true, "still a preset copy");
  assert.equal(half.isUntradeable(), true);
  assert.equal(eat(1), true);
  assert.equal(inventory.getItems()[1]?.getId(), I.HALF_A_REDBERRY_PIE);
  assert.equal(inventory.getItems()[1].isPresetItem(), false, "a plain pie leaves a plain half");
});
