// Run after `yarn build`: node --test tests/stack-split-space.test.cjs
// Grinding a nihil shard and reverting a redirected house tablet each take one from a stack and add a different item.
// From a stack that frees no slot, so on a full inventory the new item was lost. Real engine: every plugin loaded, a
// real Player, the shard's own handler and the tablet's Revert through PluginManager.emitItemAction.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, next = 9420;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function holder(t, stackId, stack, free) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("stack" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getInventory().add(new core.Item(stackId, stack), false);
  for (let i = 0; i < 27 - free; i++) p.getInventory().add(new core.Item(1511, 1), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

test("grinding one nihil shard of a stack needs room for the dust", (t) => {
  const { grindShard } = require("../plugins/bosses/nex/Items.Nex");
  const SHARD = core.ItemIdentifiers.NIHIL_SHARD, DUST = core.ItemIdentifiers.NIHIL_DUST;
  const full = holder(t, SHARD, 5, 0);
  grindShard({ player: full.p });
  assert.equal(full.p.getInventory().getAmount(SHARD), 5, "the shard is kept");
  assert.ok(full.messages.includes("You don't have enough inventory space."), full.messages.join(" | "));
  const room = holder(t, SHARD, 5, 1);
  grindShard({ player: room.p });
  assert.equal(room.p.getInventory().getAmount(SHARD), 4);
  assert.equal(room.p.getInventory().getAmount(DUST), 1);
  const last = holder(t, SHARD, 1, 0);
  grindShard({ player: last.p });
  assert.equal(last.p.getInventory().getAmount(DUST), 1, "the last shard's slot holds the dust");
});

test("a preset nihil shard is never ground into plain dust; a plain one next to it is", (t) => {
  const { grindShard } = require("../plugins/bosses/nex/Items.Nex");
  const SHARD = core.ItemIdentifiers.NIHIL_SHARD, DUST = core.ItemIdentifiers.NIHIL_DUST;
  const preset = (amount) => {
    const item = new core.Item(SHARD, amount);
    for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) item.setMetaValue(meta, true);
    return item;
  };
  for (const amount of [5, 1]) {
    const only = holder(t, SHARD, 1, 5);
    only.p.getInventory().setItem(0, preset(amount));
    grindShard({ player: only.p });
    assert.equal(only.p.getInventory().getAmount(SHARD), amount, `${amount}: the preset shards are kept`);
    assert.equal(only.p.getInventory().getAmount(DUST), 0, `${amount}: no dust`);
    assert.ok(only.messages.includes("Preset items cannot be used for this."), only.messages.join(" | "));
  }
  const both = holder(t, SHARD, 1, 5);
  both.p.getInventory().setItem(0, preset(5));
  both.p.getInventory().setItem(1, new core.Item(SHARD, 3));
  grindShard({ player: both.p });
  const items = both.p.getInventory().getItems();
  assert.equal(items[0].getAmount(), 5, "the preset stack stays put");
  assert.equal(items[1].getAmount(), 2, "the plain stack pays");
  assert.equal(both.p.getInventory().getAmount(DUST), 1);
});

test("reverting one redirected house tablet of a stack needs room for the house tablet", (t) => {
  const RIMMINGTON = core.ItemIdentifiers.RIMMINGTON_TELEPORT, HOUSE = core.ItemIdentifiers.TELEPORT_TO_HOUSE;
  const revert = (f) => {
    const slot = f.p.getInventory().getSlotForItemId(RIMMINGTON);
    const clickType = (core.CacheDefinitions.getItem(RIMMINGTON).inventoryActions ?? []).indexOf("Revert") + 1;
    assert.ok(clickType > 0, "the cache's Revert");
    PM.emitItemAction({ player: f.p, itemId: RIMMINGTON, slot, item: f.p.getInventory().getItems()[slot], option: "Revert", clickType, handled: false });
  };
  const full = holder(t, RIMMINGTON, 3, 0);
  revert(full);
  assert.equal(full.p.getInventory().getAmount(RIMMINGTON), 3, "the tablet is kept");
  assert.equal(full.p.getInventory().getAmount(HOUSE), 0);
  const room = holder(t, RIMMINGTON, 3, 1);
  revert(room);
  assert.equal(room.p.getInventory().getAmount(RIMMINGTON), 2);
  assert.equal(room.p.getInventory().getAmount(HOUSE), 1);
});

function presetCopy(id, amount) {
  const item = new core.Item(id, amount);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) item.setMetaValue(meta, true);
  return item;
}

test("preset ecumenical key shards never combine into a plain key; plain shards next to them do", (t) => {
  const { combineShards } = require("../plugins/bosses/nex/Items.Nex");
  const SHARD = core.ItemIdentifiers.ECUMENICAL_KEY_SHARD, KEY = core.ItemIdentifiers.ECUMENICAL_KEY;
  const only = holder(t, 1511, 1, 10);
  only.p.getInventory().setItem(20, presetCopy(SHARD, 60));
  combineShards({ player: only.p });
  assert.equal(only.p.getInventory().getAmount(KEY), 0, "no key from preset shards");
  assert.equal(only.p.getInventory().getAmount(SHARD), 60, "the preset shards are kept");
  assert.ok(only.messages.includes("Preset items cannot be used for this."), only.messages.join(" | "));
  const both = holder(t, SHARD, 50, 10);
  both.p.getInventory().setItem(20, presetCopy(SHARD, 60));
  combineShards({ player: both.p });
  assert.equal(both.p.getInventory().getAmount(KEY), 1, "the plain shards make the key");
  assert.equal(both.p.getInventory().getItems()[20].getAmount(), 60, "the preset stack stays put");
  assert.equal(both.p.getInventory().getAmount(SHARD), 60);
});

test("preset nihil shards or a preset horn never make a plain Zaryte crossbow; plain ones next to them do", (t) => {
  const Common = require("../plugins/bosses/nex/Common.Nex");
  const { attachHorn } = require("../plugins/bosses/nex/Items.Nex");
  const I = core.ItemIdentifiers;
  t.mock.method(Common.api, "sendMultiChatboxPrompt", (player, title, yes, onYes) => onYes());
  t.mock.method(Common, "later", (ticks, action) => action());
  const kit = (shards) => {
    const f = holder(t, 1511, 1, 20);
    const inventory = f.p.getInventory();
    if (shards > 0) inventory.setItem(10, new core.Item(I.NIHIL_SHARD, shards));
    inventory.setItem(11, new core.Item(I.NIHIL_HORN, 1));
    inventory.setItem(12, new core.Item(I.ARMADYL_CROSSBOW, 1));
    inventory.setItem(13, presetCopy(I.NIHIL_SHARD, 300));
    return f;
  };
  const presetShards = kit(0);
  attachHorn({ player: presetShards.p, usedItem: presetShards.p.getInventory().getItems()[11], usedWithItem: presetShards.p.getInventory().getItems()[12] });
  assert.equal(presetShards.p.getInventory().getAmount(I.ZARYTE_CROSSBOW), 0, "no crossbow from preset shards");
  assert.equal(presetShards.p.getInventory().getAmount(I.NIHIL_SHARD), 300, "the preset shards are kept");
  assert.ok(presetShards.messages.includes("Preset items cannot be used for this."), presetShards.messages.join(" | "));

  const presetHorn = kit(250);
  presetHorn.p.getInventory().setItem(11, presetCopy(I.NIHIL_HORN, 1));
  attachHorn({ player: presetHorn.p, usedItem: presetHorn.p.getInventory().getItems()[11], usedWithItem: presetHorn.p.getInventory().getItems()[12] });
  assert.equal(presetHorn.p.getInventory().getAmount(I.ZARYTE_CROSSBOW), 0, "no crossbow from a preset horn");
  assert.equal(presetHorn.p.getInventory().getAmount(I.NIHIL_HORN), 1);

  const plain = kit(250);
  attachHorn({ player: plain.p, usedItem: plain.p.getInventory().getItems()[11], usedWithItem: plain.p.getInventory().getItems()[12] });
  const inventory = plain.p.getInventory();
  assert.equal(inventory.getAmount(I.ZARYTE_CROSSBOW), 1, "the plain kit makes the crossbow");
  assert.equal(inventory.getItems()[13].getAmount(), 300, "the preset shard stack stays put");
  assert.equal(inventory.getAmount(I.NIHIL_SHARD), 300);
  assert.equal(inventory.getAmount(I.NIHIL_HORN) + inventory.getAmount(I.ARMADYL_CROSSBOW), 0);
});
