// Run after `yarn build`: node --test tests/toxic-blowpipe-preset.test.cjs
// Preset copies (untradeable, unbankable, preset meta, as Presets.PvpMode's spawnPresetItem tags them) never load
// into the toxic blowpipe: Unload and Uncharge pay back plain darts and scales, so loading them would turn free
// preset darts into tradeable ones. Real engine: every plugin loaded, a real Player, the native inventory_use_on,
// inventory_action and dialogue_continue packets through ClientConnection.dispatch.
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
let next = 9750;
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
  p.setUsername("pipe" + p.getIndex());
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
const useOnPipe = (f, slot) => send(f, { type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(), target: { kind: "inventory", slot: 0, id: f.inv.getItems()[0].getId() } });
async function unload(f) {
  await send(f, { type: "inventory_action", slot: 0, itemId: f.inv.getItems()[0].getId(), widgetId: 3214, option: "Unload" });
  await send(f, { type: "dialogue_continue", widgetId: 584 << 16, childIndex: 1 });
}

test("preset dragon darts are refused and stay as they are", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  f.inv.setItem(1, new core.Item(I.ZULRAHS_SCALES, 100));
  f.inv.setItem(2, preset(new core.Item(I.DRAGON_DART, 1000)));
  await useOnPipe(f, 1);
  await useOnPipe(f, 2);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(amount(f.inv, I.DRAGON_DART, true), 1000);
  await unload(f);
  assert.equal(amount(f.inv, I.DRAGON_DART, false), 0, "no plain darts appear");
});

test("plain darts load from the stack used, never from a preset stack, and Unload returns only them", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  f.inv.setItem(1, new core.Item(I.ZULRAHS_SCALES, 100));
  f.inv.setItem(2, preset(new core.Item(I.DRAGON_DART, 1000))); // first in slot order
  f.inv.setItem(3, new core.Item(I.DRAGON_DART, 50));
  await useOnPipe(f, 1);
  await useOnPipe(f, 3);
  assert.equal(f.messages.at(-1), "You load 50 dragon dart into the blowpipe.");
  assert.equal(amount(f.inv, I.DRAGON_DART, true), 1000, "the preset stack is left alone");
  assert.equal(amount(f.inv, I.DRAGON_DART, false), 0);
  await unload(f);
  assert.equal(amount(f.inv, I.DRAGON_DART, false), 50);
  assert.equal(amount(f.inv, I.DRAGON_DART, true), 1000);
});

test("preset Zulrah's scales are refused too", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.TOXIC_BLOWPIPE_EMPTY_, 1));
  f.inv.setItem(1, preset(new core.Item(I.ZULRAHS_SCALES, 100)));
  await useOnPipe(f, 1);
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(amount(f.inv, I.ZULRAHS_SCALES, true), 100);
});
