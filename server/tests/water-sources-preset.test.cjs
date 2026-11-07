// Run after `yarn build`: node --test tests/water-sources-preset.test.cjs
// Filling swapped the empty container for a fresh full one, so a preset vial (PvP presets) came back as a plain,
// tradeable vial of water. The filled one keeps the empty one's meta now. Real engine: every plugin loaded, a real
// Player and Inventory, the water source's own item-on-object path at the Getting Ahead farmhouse sink.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const SINK = 1763;
let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function setup(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8942); p.setUsername("water8942"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(1239, 3676, 0));
  t.after(() => p.setRegistered(false));
  const fill = (itemId, slot = p.getInventory().getItems().findIndex((i) => i?.getId() === itemId)) => PM.emitItemOnObject({ player: p, itemId, item: p.getInventory().getItems()[slot], slot,
    objectId: SINK, object: { getId: () => SINK, getType: () => 10, getLocation: () => new core.Location(1239, 3677, 0), getDefinition: () => core.ObjectDefinition.forId(SINK) },
    location: { x: 1239, y: 3677, z: 0 }, handled: false });
  return { p, fill };
}

test("a preset vial fills as a preset vial of water; a plain one fills plain", (t) => {
  const f = setup(t);
  const vial = new core.Item(I.VIAL, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) vial.setMetaValue(meta, true);
  f.p.getInventory().setItem(0, vial);
  f.p.getInventory().setItem(1, new core.Item(I.VIAL, 1));
  f.fill(I.VIAL);
  const first = f.p.getInventory().getItems()[0];
  assert.equal(first?.getId(), I.VIAL_OF_WATER);
  assert.equal(first.isPresetItem(), true, "still a preset copy");
  assert.equal(first.isUntradeable(), true);
  f.fill(I.VIAL);
  const second = f.p.getInventory().getItems()[1];
  assert.equal(second?.getId(), I.VIAL_OF_WATER);
  assert.equal(second.isPresetItem(), false, "a plain vial fills plain");
});

// Any "Sink" is also the Blast Furnace's (Furnace.BlastFurnace.js), whose name-matched hook runs first.
test("a preset bucket fills at a sink as a preset bucket of water; a plain one fills plain", (t) => {
  const f = setup(t);
  const bucket = new core.Item(I.BUCKET, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) bucket.setMetaValue(meta, true);
  f.p.getInventory().setItem(0, new core.Item(I.BUCKET, 1));
  f.p.getInventory().setItem(1, bucket);
  f.fill(I.BUCKET, 1);
  const preset = f.p.getInventory().getItems()[1];
  assert.equal(preset?.getId(), I.BUCKET_OF_WATER, "the used bucket is the one filled");
  assert.equal(preset.isPresetItem(), true, "still a preset copy");
  assert.equal(f.p.getInventory().getItems()[0]?.getId(), I.BUCKET, "the other bucket is untouched");
  f.fill(I.BUCKET, 0);
  const plain = f.p.getInventory().getItems()[0];
  assert.equal(plain?.getId(), I.BUCKET_OF_WATER);
  assert.equal(plain.isPresetItem(), false, "a plain bucket fills plain");
});
