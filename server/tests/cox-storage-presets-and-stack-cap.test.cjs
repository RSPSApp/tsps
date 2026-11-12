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

const Raid = require("../plugins/minigames/cox/RaidState.ChambersOfXeric");

/** At a unit in a raid with the private storage open (a view counts only while its interface is open, in the raid). */
function inStorage(t) {
  const f = actor(t);
  t.mock.method(Raid, "raidOf", (player) => (player === f.p ? {} : null));
  f.p.setInterfaceId(271);
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
  f.p.setInterfaceId(271);
  f.p.setAttribute("cox:storage-view", { kind: "private", size: 120, mount: true });
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 1500000000 }]);
  const tab = f.p.getBank(core.Bank.getTabForItem(f.p, I.COINS));
  tab.add(new core.Item(I.COINS, 1000000000), false);
  Storage.depositOrBankAll({ player: f.p });
  assert.equal(tab.getAmount(I.COINS), 2147483647);
  assert.equal(stored(f, I.COINS), 2500000000 - 2147483647, "nothing deleted");
});

test("the storage works only while its interface is open, at a unit in the raid: no remote deposits or withdrawals", (t) => {
  const f = inStorage(t);
  f.inv.setItem(0, new core.Item(I.DEATH_RUNE, 100));
  f.p.setInterfaceId(-1); // closed and walked away
  Storage.deposit(f.p, 0, 100);
  assert.equal(stored(f, I.DEATH_RUNE), 0, "a closed storage takes nothing");
  assert.equal(f.p.getAttribute("cox:storage-view"), null, "and its stale view is dropped");

  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 500 }]);
  f.p.setInterfaceId(271);
  f.p.setAttribute("cox:storage-view", { kind: "private", size: 120, mount: false });
  Raid.raidOf.mock.mockImplementation(() => null); // left the raid with it open
  Storage.withdraw(f.p, I.COINS, 500);
  assert.equal(f.inv.getAmount(I.COINS), 0, "the raid's storage is gone outside the raid");
  assert.equal(stored(f, I.COINS), 500);
});

test("a preset non-stackable is refused too, and storing All of a plain one leaves its preset copies", (t) => {
  const f = inStorage(t);
  f.inv.setItem(0, preset(new core.Item(I.ABYSSAL_WHIP, 1)));
  Storage.deposit(f.p, 0, 1);
  assert.equal(f.messages.at(-1), PRESET_TEXT);
  assert.equal(stored(f, I.ABYSSAL_WHIP), 0);

  f.inv.setItem(1, new core.Item(I.ABYSSAL_WHIP, 1));
  f.inv.setItem(2, preset(new core.Item(I.ABYSSAL_WHIP, 1)));
  Storage.deposit(f.p, 1, 28);
  assert.equal(stored(f, I.ABYSSAL_WHIP), 1, "only the plain whip");
  assert.equal(Storage.privateItems(f.p).some((entry) => entry.meta?.[core.Item.PRESET_META] === true), false);
  assert.equal(amount(f.inv, I.ABYSSAL_WHIP, true), 2, "both preset whips stay");
});

/** With the raid's shared storage open (550), its own raid kept for the view. */
function inSharedStorage(t) {
  const f = actor(t);
  const raid = { players: [f.p], storageTier: 1, sharedItems: [{ id: I.CAVE_WORMS, amount: 50 }] };
  t.mock.method(Raid, "raidOf", (player) => (player === f.p ? raid : null));
  f.p.setInterfaceId(550);
  f.p.setAttribute("cox:storage-view", { kind: "shared", size: 250, raid });
  return { ...f, raid };
}

test("forged private Withdraw-all / Deposit-all buttons do nothing while the shared storage is open", (t) => {
  const f = inSharedStorage(t);
  f.p.setAttribute("cox:private-storage", [{ id: I.CAVE_WORMS, amount: 10 }]);
  f.inv.setItem(0, new core.Item(I.CAVE_WORMS, 7));
  Storage.withdrawAll({ player: f.p });
  assert.equal(f.inv.getAmount(I.CAVE_WORMS), 7, "nothing withdrawn");
  assert.deepEqual(f.raid.sharedItems, [{ id: I.CAVE_WORMS, amount: 50 }], "the shared store is untouched");
  assert.equal(stored(f, I.CAVE_WORMS), 10, "the private store too");

  Storage.depositOrBankAll({ player: f.p });
  assert.equal(f.inv.getAmount(I.CAVE_WORMS), 7, "nothing deposited");
  assert.deepEqual(f.raid.sharedItems, [{ id: I.CAVE_WORMS, amount: 50 }]);
});
