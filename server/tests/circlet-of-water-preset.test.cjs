// Run after `yarn build`: node --test tests/circlet-of-water-preset.test.cjs
// Preset copies (untradeable, unbankable, preset meta, as Presets.PvpMode spawnPresetItem tags them) never charge
// the circlet of water: Uncharge refunds plain water runes, so charging from them would turn free preset runes
// into tradeable ones. Real engine: every plugin loaded, a real Player, the native inventory_use_on, dialogue_amount
// and inventory_action packets through ClientConnection.dispatch, and the real Yes/No prompt.
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
let next = 9770;
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
  p.setUsername("circlet" + p.getIndex());
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
const useOnCirclet = (f, slot) => send(f, { type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(), target: { kind: "inventory", slot: 0, id: f.inv.getItems()[0].getId() } });
async function uncharge(f) {
  await send(f, { type: "inventory_action", slot: 0, itemId: f.inv.getItems()[0].getId(), widgetId: 3214, option: "Uncharge" });
  if (core.MultiChatboxPrompt.getPending(f.p)) {
    core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
  } else {
    await send(f, { type: "dialogue_continue", widgetId: (219 << 16) | 1, childIndex: 1 });
  }
}

test("preset water runes cannot charge the circlet", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.CIRCLET_OF_WATER_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.WATER_RUNE, 500)));
  await useOnCirclet(f, 1);
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.p.getEnteredAmountAction() ?? null, null);
  await send(f, { type: "inventory_action", slot: 0, itemId: I.CIRCLET_OF_WATER_UNCHARGED_, widgetId: 3214, option: "Charge" });
  assert.equal(f.messages.at(-1), PRESET_TEXT, "the Charge option refuses too");
  assert.equal(amount(f.inv, I.WATER_RUNE, true), 500);
});

test("with both held only the plain water runes pay, and Uncharge refunds only them", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.CIRCLET_OF_WATER_UNCHARGED_, 1));
  f.inv.setItem(1, preset(new core.Item(I.WATER_RUNE, 500)));
  f.inv.setItem(2, new core.Item(I.WATER_RUNE, 50));
  await useOnCirclet(f, 2);
  await send(f, { type: "dialogue_amount", amount: 100 }); // more than the plain runes pay for
  assert.equal(f.inv.getItems()[0].getId(), I.CIRCLET_OF_WATER);
  assert.equal(amount(f.inv, I.WATER_RUNE, false), 0);
  assert.equal(amount(f.inv, I.WATER_RUNE, true), 500, "the preset stack is left alone");
  await uncharge(f);
  assert.equal(amount(f.inv, I.WATER_RUNE, false), 50);
  assert.equal(amount(f.inv, I.WATER_RUNE, true), 500);
});
