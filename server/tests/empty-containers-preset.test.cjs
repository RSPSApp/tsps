// Run after `yarn build`: node --test tests/empty-containers-preset.test.cjs
// Empty on a filled bucket put a fresh empty bucket in its slot, so a preset bucket of water (PvP presets) came back
// as a plain, tradeable bucket. The empty bucket keeps the full one's meta now. Real engine: every plugin loaded, a
// real Player and Inventory, the bucket's own Empty item action.
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

test("a preset bucket of water empties to a preset bucket; a plain one empties plain", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8943); p.setUsername("empty8943"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const preset = new core.Item(I.BUCKET_OF_WATER, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) preset.setMetaValue(meta, true);
  p.getInventory().setItem(0, preset);
  p.getInventory().setItem(1, new core.Item(I.BUCKET_OF_WATER, 1));
  const empty = (slot) => PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], interfaceId: core.CacheDefinitions.getComponentId("inventory:items"), itemId: I.BUCKET_OF_WATER,
    slot, clickType: core.CacheDefinitions.getItem(I.BUCKET_OF_WATER).inventoryActions.indexOf("Empty") + 1, option: "Empty", handled: false });
  empty(0);
  const first = p.getInventory().getItems()[0];
  assert.equal(first?.getId(), I.BUCKET);
  assert.equal(first.isPresetItem(), true, "still a preset copy");
  assert.equal(first.isUntradeable(), true);
  empty(1);
  const second = p.getInventory().getItems()[1];
  assert.equal(second?.getId(), I.BUCKET);
  assert.equal(second.isPresetItem(), false, "a plain bucket empties plain");
});
