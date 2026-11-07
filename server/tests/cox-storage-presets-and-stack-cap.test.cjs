// Run after `yarn build`: node --test tests/cox-storage-presets-and-stack-cap.test.cjs
// Chambers of Xeric private storage (saved with the player): a stored stack keeps no meta, so a preset stack
// (untradeable, unbankable, preset, as Presets.PvpMode tags it) is refused rather than coming back plain; a deposit
// takes the clicked stack only; and a withdrawal moves only what the inventory can hold, so nothing past the stack
// cap (or with nowhere to go) is deleted. Real engine: every plugin loaded, a real Player and Inventory, and the
// storage plugin's own deposit and withdraw with its private view open.
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
let next = 9950;
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
  p.setUsername("coxstore" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
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

const Storage = require("../plugins/minigames/cox/Storage.ChambersOfXeric");
const PRESET_TEXT = "Preset items cannot be used for this.";

function inStorage(t) {
  const f = actor(t);
  f.p.setAttribute("cox:storage-view", { kind: "private", size: 120, mount: false });
  return f;
}
const stored = (f, id) => Storage.privateItems(f.p).filter((entry) => entry.id === id).reduce((sum, entry) => sum + entry.amount, 0);

test("a preset stack of death runes is refused and stays in the inventory", (t) => {
  const f = inStorage(t);
  f.inv.setItem(0, preset(new core.Item(I.DEATH_RUNE, 1000)));
  Storage.deposit(f.p, 0, 1000);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(stored(f, I.DEATH_RUNE), 0);
  assert.equal(amount(f.inv, I.DEATH_RUNE, true), 1000);
});

test("depositing a plain stack takes that stack, never a preset one of the same id", (t) => {
  const f = inStorage(t);
  f.inv.setItem(0, preset(new core.Item(I.DEATH_RUNE, 1000))); // first in slot order
  f.inv.setItem(1, new core.Item(I.DEATH_RUNE, 300));
  Storage.deposit(f.p, 1, 1000);
  assert.equal(stored(f, I.DEATH_RUNE), 300);
  assert.equal(amount(f.inv, I.DEATH_RUNE, true), 1000, "the preset stack is left alone");
  Storage.withdraw(f.p, I.DEATH_RUNE, 300);
  assert.equal(amount(f.inv, I.DEATH_RUNE, false), 300);
});

test("withdrawing onto a stack near the cap keeps the rest stored", (t) => {
  const f = inStorage(t);
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 1000000000 }]);
  f.inv.setItem(0, new core.Item(I.COINS, 1500000000));
  Storage.withdraw(f.p, I.COINS, 1000000000);
  assert.equal(f.inv.getAmount(I.COINS), 2147483647);
  assert.equal(stored(f, I.COINS), 2500000000 - 2147483647, "nothing deleted");
});

test("depositing onto a stored stack near the cap stores only what fits", (t) => {
  const f = inStorage(t);
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 2147483000 }]);
  f.inv.setItem(0, new core.Item(I.COINS, 1000));
  Storage.deposit(f.p, 0, 1000);
  assert.equal(stored(f, I.COINS), 2147483647);
  assert.equal(f.inv.getAmount(I.COINS), 1000 - 647, "the rest stays in the inventory");
});

test("banking the storage from the mountain moves only what the bank can hold, keeping the rest stored", (t) => {
  const f = actor(t);
  f.p.setAttribute("cox:storage-view", { kind: "private", size: 120, mount: true });
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 1500000000 }]);
  const tab = f.p.getBank(core.Bank.getTabForItem(f.p, I.COINS));
  tab.add(new core.Item(I.COINS, 1000000000), false);
  Storage.depositOrBankAll({ player: f.p });
  assert.equal(tab.getAmount(I.COINS), 2147483647);
  assert.equal(stored(f, I.COINS), 2500000000 - 2147483647, "nothing deleted");
});
