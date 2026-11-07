// Run after `yarn build`: node --test tests/tome-obligator-preset-runes.test.cjs
// Zorya's tome and the Obligator: preset copies (untradeable, unbankable, preset meta, as Presets.PvpMode's
// spawnPresetItem tags them) never pay for charges, since Uncharge refunds plain runes and shards.
// Real engine: every plugin loaded, a real Player, the native inventory_use_on and inventory_action packets
// through ClientConnection.dispatch.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PRESET_TEXT } = require("../plugins/items/PoweredStaff");

let core;
let I;
let next = 9760;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("charge" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, c, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}
const useOn = (f, slot) => send(f, { type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(), target: { kind: "inventory", slot: 0, id: f.inv.getItems()[0].getId() } });
const uncharge = (f) => send(f, { type: "inventory_action", slot: 0, itemId: f.inv.getItems()[0].getId(), widgetId: 3214, option: "Uncharge" });

test("Zorya's tome: preset astral and nature runes are refused", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.ZORYAS_TOME_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.ASTRAL_RUNE, 300)));
  f.inv.setItem(2, preset(new core.Item(I.NATURE_RUNE, 200)));
  await useOn(f, 1);
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.inv.getItems()[0].getId(), I.ZORYAS_TOME_UNCHARGED_);
  assert.equal(amount(f.inv, I.ASTRAL_RUNE, true), 300);
});

test("Zorya's tome: with both held only the plain runes pay, and Uncharge refunds only them", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.ZORYAS_TOME_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.ASTRAL_RUNE, 300)));
  f.inv.setItem(2, preset(new core.Item(I.NATURE_RUNE, 200)));
  f.inv.setItem(3, new core.Item(I.ASTRAL_RUNE, 30));
  f.inv.setItem(4, new core.Item(I.NATURE_RUNE, 20));
  await useOn(f, 3);
  assert.equal(f.messages.at(-1), "You apply 10 charges to your Zorya's tome.");
  assert.equal(amount(f.inv, I.ASTRAL_RUNE, true), 300, "the preset stack is left alone");
  await uncharge(f);
  assert.equal(amount(f.inv, I.ASTRAL_RUNE, false), 30);
  assert.equal(amount(f.inv, I.NATURE_RUNE, false), 20);
  assert.equal(amount(f.inv, I.ASTRAL_RUNE, true), 300);
  assert.equal(amount(f.inv, I.NATURE_RUNE, true), 200);
});

test("Obligator: preset runes are refused; plain shards and runes still charge and refund", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.OBLIGATOR_UNCHARGED_, 1));
  f.inv.setItem(1, new core.Item(I.ASCENSION_SHARDS, 5));
  f.inv.setItem(2, preset(new core.Item(I.NATURE_RUNE, 100)));
  f.inv.setItem(3, preset(new core.Item(I.DEATH_RUNE, 100)));
  await useOn(f, 2);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  await useOn(f, 1);
  assert.equal(f.messages.at(-1), PRESET_TEXT, "only preset runes held: still refused");
  assert.equal(f.inv.getAmount(I.ASCENSION_SHARDS), 5);
  f.inv.setItem(4, new core.Item(I.NATURE_RUNE, 20));
  f.inv.setItem(5, new core.Item(I.DEATH_RUNE, 20));
  await useOn(f, 1);
  assert.equal(f.messages.at(-1), "You add 10 charges to your Obligator.");
  assert.equal(f.inv.getAmount(I.ASCENSION_SHARDS), 4);
  assert.equal(amount(f.inv, I.NATURE_RUNE, true), 100, "the preset stacks are left alone");
  await uncharge(f);
  assert.equal(amount(f.inv, I.NATURE_RUNE, false), 20);
  assert.equal(amount(f.inv, I.DEATH_RUNE, false), 20);
  assert.equal(f.inv.getAmount(I.ASCENSION_SHARDS), 5);
});
