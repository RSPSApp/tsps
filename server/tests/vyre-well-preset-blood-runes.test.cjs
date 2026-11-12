// Run after `yarn build`: node --test tests/vyre-well-preset-blood-runes.test.cjs
// Preset copies (untradeable, unbankable, preset meta, as Presets.PvpMode spawnPresetItem tags them) never pay
// for scythe of vitur charges, at the vyre well or on the scythe itself: a scythe's charges can be deposited
// into the well, and the well's Empty hands back plain blood runes and vials, so preset runes would come back
// tradeable. Real engine: every plugin loaded, a real Player and Inventory, the plugin's real well handlers
// (Fill with its amount prompt, Empty) and the scythe's item-on-item charge through the native inventory_use_on.
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
let next = 9780;
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
  p.setUsername("well" + p.getIndex());
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
const VIAL_OF_BLOOD = 22446;
const NOTED_VIAL_OF_BLOOD = 22447;

/** The plugin's own well actions, as it registers them. */
function wellActions() {
  const Scythe = require("../plugins/items/ScytheOfVitur.plugin");
  let actions = null;
  const real = PM.createApi("VyreWellPresetTest");
  Scythe.register(new Proxy(real, {
    get: (target, key) => (key === "onObjectInteraction"
      ? (name, handlers) => { if (name === "Vyre well") actions = handlers; }
      : target[key]),
  }));
  PM.emitServerStartup({});
  return actions;
}

test("the vyre well refuses preset blood runes and Empty gives back nothing extra", async (t) => {
  const f = actor(t);
  const well = wellActions();
  f.inv.setItem(0, new core.Item(VIAL_OF_BLOOD, 1));
  f.inv.setItem(1, preset(new core.Item(I.BLOOD_RUNE, 300)));
  well.Fill({ player: f.p });
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.p.getEnteredAmountAction() ?? null, null);
  well.Empty({ player: f.p });
  assert.equal(amount(f.inv, I.BLOOD_RUNE, false), 0);
  assert.equal(amount(f.inv, I.BLOOD_RUNE, true), 300);
  assert.equal(f.inv.getAmount(VIAL_OF_BLOOD), 1);
});

test("with both held the well takes only plain blood runes, and Empty returns only those", async (t) => {
  const f = actor(t);
  const well = wellActions();
  f.inv.setItem(0, new core.Item(VIAL_OF_BLOOD, 1));
  f.inv.setItem(1, preset(new core.Item(I.BLOOD_RUNE, 300)));
  f.inv.setItem(2, new core.Item(I.BLOOD_RUNE, 200));
  well.Fill({ player: f.p });
  f.p.getEnteredAmountAction().execute(5);
  assert.equal(f.messages.at(-1), "You fill the well with one charge.");
  assert.equal(amount(f.inv, I.BLOOD_RUNE, true), 300, "the preset stack is left alone");
  assert.equal(amount(f.inv, I.BLOOD_RUNE, false), 0);
  well.Empty({ player: f.p });
  assert.equal(amount(f.inv, I.BLOOD_RUNE, false), 200);
  assert.equal(f.inv.getAmount(NOTED_VIAL_OF_BLOOD), 1);
  assert.equal(amount(f.inv, I.BLOOD_RUNE, true), 300);
});

test("a scythe cannot be charged from preset blood runes either (its charges could go into the well)", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(I.SCYTHE_OF_VITUR_UNCHARGED_, 1));
  f.inv.setItem(1, new core.Item(VIAL_OF_BLOOD, 1));
  f.inv.setItem(2, preset(new core.Item(I.BLOOD_RUNE, 300)));
  await send(f, { type: "inventory_use_on", slot: 2, itemId: I.BLOOD_RUNE, target: { kind: "inventory", slot: 0, id: I.SCYTHE_OF_VITUR_UNCHARGED_ } });
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(f.inv.getItems()[0].getId(), I.SCYTHE_OF_VITUR_UNCHARGED_);
  assert.equal(amount(f.inv, I.BLOOD_RUNE, true), 300);
  assert.equal(f.inv.getAmount(VIAL_OF_BLOOD), 1);
});
