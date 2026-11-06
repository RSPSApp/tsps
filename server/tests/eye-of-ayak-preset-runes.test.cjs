// Run after `yarn build`: node --test tests/eye-of-ayak-preset-runes.test.cjs
// Preset copies (untradeable, unbankable, preset meta, as Presets.PvpMode's spawnPresetItem tags them) never
// pay for Eye of Ayak charges: Uncharge refunds plain runes, so charging from them would turn free preset
// runes into bankable ones. Real engine: every plugin loaded, a real Player, the native inventory_use_on,
// dialogue_amount, inventory_action and dialogue_continue packets through ClientConnection.dispatch.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { PRESET_TEXT } = require("../plugins/items/PoweredStaff");

let core;
let I;
let next = 9710;
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
  p.setUsername("ayak" + p.getIndex());
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
const useOnEye = (f, slot, itemId) => send(f, { type: "inventory_use_on", slot, itemId, target: { kind: "inventory", slot: 0, id: f.inv.getItems()[0].getId() } });
const uncharge = async (f) => {
  await send(f, { type: "inventory_action", slot: 0, itemId: f.inv.getItems()[0].getId(), widgetId: 3214, option: "Uncharge" });
  await send(f, { type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: 1 });
};

test("preset death and chaos runes cannot charge the Eye of Ayak", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.EYE_OF_AYAK_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.DEATH_RUNE, 2000)));
  f.inv.setItem(2, preset(new core.Item(I.CHAOS_RUNE, 1000)));
  await useOnEye(f, 1, I.DEATH_RUNE);
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.p.getEnteredAmountAction() ?? null, null, "no amount prompt");
  await send(f, { type: "inventory_action", slot: 0, itemId: I.EYE_OF_AYAK_UNCHARGED_, widgetId: 3214, option: "Charge" });
  assert.equal(f.messages.at(-1), PRESET_TEXT, "the Charge option refuses too");
  assert.equal(f.p.getEnteredAmountAction() ?? null, null);
  assert.equal(f.inv.getItems()[0].getId(), I.EYE_OF_AYAK_UNCHARGED_);
  assert.equal(amount(f.inv, I.DEATH_RUNE, true), 2000);
  assert.equal(amount(f.inv, I.CHAOS_RUNE, true), 1000);
});

test("with preset and plain runes held, only the plain ones pay, and Uncharge refunds only what was paid", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.EYE_OF_AYAK_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.DEATH_RUNE, 2000)));
  f.inv.setItem(2, preset(new core.Item(I.CHAOS_RUNE, 1000)));
  f.inv.setItem(3, new core.Item(I.DEATH_RUNE, 20));
  f.inv.setItem(4, new core.Item(I.CHAOS_RUNE, 10));
  await useOnEye(f, 3, I.DEATH_RUNE);
  assert.ok(f.p.getEnteredAmountAction(), "the plain runes open the prompt");
  await send(f, { type: "dialogue_amount", amount: 1000 }); // more than the plain runes pay for
  assert.match(f.messages.at(-1), /It currently has 10 charges\./);
  assert.equal(amount(f.inv, I.DEATH_RUNE, false), 0);
  assert.equal(amount(f.inv, I.CHAOS_RUNE, false), 0);
  assert.equal(amount(f.inv, I.DEATH_RUNE, true), 2000, "the preset stack is left alone");
  assert.equal(amount(f.inv, I.CHAOS_RUNE, true), 1000);
  await uncharge(f);
  assert.equal(f.messages.at(-1), "You uncharge the Eye of Ayak.");
  assert.equal(amount(f.inv, I.DEATH_RUNE, false), 20);
  assert.equal(amount(f.inv, I.CHAOS_RUNE, false), 10);
  assert.equal(amount(f.inv, I.DEATH_RUNE, true), 2000);
  assert.equal(amount(f.inv, I.CHAOS_RUNE, true), 1000);
});

test("using a preset rune on the Eye is refused even when plain runes are held", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.EYE_OF_AYAK_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.DEATH_RUNE, 2000)));
  f.inv.setItem(2, new core.Item(I.DEATH_RUNE, 20));
  f.inv.setItem(3, new core.Item(I.CHAOS_RUNE, 10));
  await useOnEye(f, 1, I.DEATH_RUNE);
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.p.getEnteredAmountAction() ?? null, null);
});

test("plain runes still charge as before", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.EYE_OF_AYAK_UNCHARGED_, 1));
  f.inv.setItem(1, new core.Item(I.DEATH_RUNE, 200));
  f.inv.setItem(2, new core.Item(I.CHAOS_RUNE, 100));
  await useOnEye(f, 1, I.DEATH_RUNE);
  await send(f, { type: "dialogue_amount", amount: 100 });
  assert.match(f.messages.at(-1), /It currently has 100 charges\./);
  assert.equal(f.inv.getAmount(I.DEATH_RUNE), 0);
  assert.equal(f.inv.getAmount(I.CHAOS_RUNE), 0);
});
