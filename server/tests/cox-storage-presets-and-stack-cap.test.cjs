// Run after `yarn build`: node --test tests/cox-storage-presets-and-stack-cap.test.cjs
// Chambers of Xeric private storage (saved with the player): a stored stack keeps no meta, so a preset stack
// (untradeable, unbankable, preset, as Presets.PvpMode tags it) is refused rather than coming back plain; a deposit
// takes the clicked stack only; and a withdrawal moves only what the inventory can hold, so nothing past the stack
// cap (or with nowhere to go) is deleted. Real engine: every plugin loaded, a real Player and Inventory, and the
// storage plugin's own deposit and withdraw with its private view open.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
process.env.BROWSER_HOST = "1"; // No WorldAdmin listener in this full-registration fixture.
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
  const wire = [];
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: (packet) => { wire.push(Buffer.from(packet)); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
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
  return { p, inv: p.getInventory(), messages, wire };
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
const BankPin = require("../plugins/interface/bankpin/Common.BankPin");
const PinKeypad = require("../plugins/interface/bankpin/Keypad.BankPin");
const Parties = require("../plugins/minigames/cox/Parties.ChambersOfXeric");
const { InterfaceActionClickOpcode: Input } = require("../dist/net/packet/impl/InterfaceActionClickOpcode");
const { encodeVarbit, encodeWidgetOpenSub } = require("../dist/net/protocol/ClientProtocol");
const { SERVER_PACKET_LENGTHS } = require("../dist/net/protocol/ServerPackets");

function packets(chunks) {
  const bytes = Buffer.concat(chunks);
  const result = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = SERVER_PACKET_LENGTHS[bytes[offset]];
    assert.notEqual(length, undefined, "known transport opcode");
    const header = length >= 0 ? 1 : length === -1 ? 2 : 3;
    const payload = length >= 0 ? length : length === -1 ? bytes[offset + 1] : bytes.readUInt16BE(offset + 1);
    const end = offset + header + payload;
    assert.ok(end <= bytes.length, "complete framed packet");
    result.push(bytes.subarray(offset, end));
    offset = end;
  }
  return result;
}

/** Controlled membership, with the actual Party/Raid registry and registered packet dispatcher. */
function registeredStorage(t) {
  const f = actor(t);
  const party = Parties.create(f.p, { key: "coxmount" + f.p.getIndex() });
  const raid = new Raid.Raid(party);
  party.raid = raid;
  raid.players.add(f.p);
  raid.storageTier = 1;
  f.p.setAttribute(Raid.ATTR_RAID, raid);
  t.after(() => { f.p.setAttribute(Raid.ATTR_RAID, null); raid.players.clear(); raid.destroy("empty"); });
  return { ...f, raid };
}

function click(f, group, child, slot = 0, op = 1) {
  assert.equal(Input.handle(f.p, (group << 16) | child, op,
    { groupId: group, childId: child, slot, opId: op, itemId: f.inv.getItems()[slot]?.getId() ?? -1 }), true);
}

function lockPin(f) {
  BankPin.set(f.p, "hash", BankPin.hash(f.p, "1234"));
  BankPin.lock(f.p);
}

function mountain(f) {
  const objectId = 30107; // Active cache: Mount Quidamortem private storage unit.
  const object = new core.GameObject(objectId, f.p.getLocation().clone(), 10, 0, null);
  assert.equal(PM.emitObjectInteraction({ player: f.p, object, objectId, location: object.getLocation(), clickType: 1, handled: false }), true);
}

function answerPin(f, amount) {
  const answer = f.p.getEnteredAmountAction();
  assert.ok(answer);
  answer.execute(amount);
  core.TaskManager.process();
  core.TaskManager.process();
}

test("mountain private storage asks for its locked PIN before opening or releasing items", (t) => {
  const f = actor(t);
  lockPin(f);
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }]);
  mountain(f);
  assert.equal(f.p.getInterfaceId(), BankPin.ids.groups.keypad, "locked PIN opens keypad, not private storage");
  for (const child of [6, 9, 10]) click(f, 271, child);
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.equal(stored(f, I.COINS), 50);
  assert.equal(f.p.getBank(core.Bank.getTabForItem(f.p, I.COINS)).getAmount(I.COINS), 0);
  answerPin(f, 1234);
  assert.equal(BankPin.isUnlocked(f.p), true);
  assert.equal(f.p.getInterfaceId(), 271);
  assert.equal(f.inv.getAmount(I.COINS), 0, "unlock opens recovery, without replaying any forged transfer");
  click(f, 271, 6);
  assert.equal(f.inv.getAmount(I.COINS), 1);
  assert.equal(stored(f, I.COINS), 49);
  assert.equal(f.p.getPacketSender().getSubInterfaceAt(core.CacheDefinitions.getComponentId("toplevel_osrs_stretch:sidemodal")).groupId, 551);
});

test("mountain recovery from canEnter is PIN guarded and does not automatically enter a raid", (t) => {
  const f = actor(t);
  lockPin(f);
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }]);
  assert.equal(Storage.canEnter(f.p), false);
  assert.equal(f.p.getInterfaceId(), BankPin.ids.groups.keypad);
  answerPin(f, 1234);
  assert.equal(f.p.getInterfaceId(), 271);
  assert.equal(Raid.raidOf(f.p), null);
  assert.equal(Storage.canEnter(f.p), false, "still must empty personal storage");
});

test("mountain PIN continuation refuses wrong or exited PIN and changed actor context", (t) => {
  for (const change of ["wrong", "exit", "move", "logout", "interface", "session", "raid", "area"]) {
    const f = actor(t);
    lockPin(f);
    f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }]);
    mountain(f);
    assert.equal(f.p.getInterfaceId(), BankPin.ids.groups.keypad);
    if (change === "wrong" || change === "exit") answerPin(f, change === "wrong" ? 9999 : PinKeypad.EXIT_ANSWER);
    else {
      const answer = f.p.getEnteredAmountAction();
      answer.execute(1234); // The guard's continuation is now queued for the next task cycle.
      if (change === "move") f.p.setLocation(new core.Location(3201, 3200, 0));
      if (change === "logout") f.p.setRegistered(false);
      if (change === "interface") f.p.getPacketSender().sendInterface(550);
      if (change === "session") f.p.setSession(new PlayerSession(f.p.getSession().getChannel()));
      if (change === "raid") {
        const party = Parties.create(f.p, { key: "coxpin" + f.p.getIndex() });
        const raid = new Raid.Raid(party);
        party.raid = raid;
        raid.players.add(f.p);
        f.p.setAttribute(Raid.ATTR_RAID, raid);
        t.after(() => { f.p.setAttribute(Raid.ATTR_RAID, null); raid.players.clear(); raid.destroy("empty"); });
      }
      if (change === "area") {
        const area = new core.PrivateArea();
        area.add(f.p);
        t.after(() => { area.remove(f.p); area.destroy(); });
      }
      core.TaskManager.process();
      core.TaskManager.process();
    }
    assert.notEqual(f.p.getInterfaceId(), 271, change + " cannot reopen a recovery interface");
    assert.equal(f.inv.getAmount(I.COINS), 0);
    assert.equal(stored(f, I.COINS), 50);
  }
});

test("relocking an open mountain view protects pending Withdraw-X, Withdraw-all and Bank-all", (t) => {
  for (const operation of ["amount", "withdraw-all", "bank-all", "drag"]) {
    const f = actor(t);
    lockPin(f);
    BankPin.unlock(f.p);
    f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }, { id: I.DEATH_RUNE, amount: 3 }]);
    mountain(f);
    let amountAction;
    if (operation === "amount") { click(f, 271, 6, 0, 5); amountAction = f.p.getEnteredAmountAction(); }
    BankPin.lock(f.p);
    if (operation === "amount") amountAction.execute(10);
    else if (operation === "drag") Storage.dragPrivate({ player: f.p, packet: { sourceWidgetId: (271 << 16) | 6, targetWidgetId: (271 << 16) | 6, sourceSlot: 0, targetSlot: 1 } });
    else click(f, 271, operation === "withdraw-all" ? 9 : 10);
    assert.equal(f.p.getInterfaceId(), BankPin.ids.groups.keypad, operation);
    assert.equal(f.p.getAttribute("cox:storage-view"), null);
    assert.equal(f.inv.getAmount(I.COINS), 0);
    assert.deepEqual(Storage.privateItems(f.p), [{ id: I.COINS, amount: 50 }, { id: I.DEATH_RUNE, amount: 3 }]);
    assert.equal(f.p.getBank(core.Bank.getTabForItem(f.p, I.COINS)).getAmount(I.COINS), 0);
    answerPin(f, 1234);
    assert.equal(f.p.getInterfaceId(), 271);
    assert.equal(f.inv.getAmount(I.COINS), 0, "old operation not replayed after unlocking");
  }
});

test("mountain no-PIN and unlocked access work, without adding a PIN rule to in-raid storage", (t) => {
  for (const unlocked of [false, true]) {
    const f = actor(t);
    if (unlocked) { lockPin(f); BankPin.unlock(f.p); }
    f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }]);
    mountain(f);
    assert.equal(f.p.getInterfaceId(), 271);
    click(f, 271, 6);
    assert.equal(f.inv.getAmount(I.COINS), 1);
  }
  const f = registeredStorage(t);
  lockPin(f);
  f.p.setAttribute("cox:private-storage", [{ id: I.COINS, amount: 50 }]);
  Storage.openPrivate(f.p, 30);
  click(f, 271, 6);
  assert.equal(f.inv.getAmount(I.COINS), 1);
  Storage.openShared(f.p, f.raid);
  assert.equal(f.p.getInterfaceId(), 550);
  assert.equal(BankPin.isUnlocked(f.p), false, "no unsupported in-raid unlock prerequisite");
});

test("private/shared storage mounts its cache side modal after its onLoad varbits, including close and reopen", async (t) => {
  const f = registeredStorage(t);
  const cache = core.CacheDefinitions;
  const target = cache.getComponentId("toplevel_osrs_stretch:sidemodal");
  const side = cache.getInterfaceId("raids_storage_side");
  for (const privateView of [true, false, true]) {
    f.wire.length = 0;
    if (privateView) Storage.openPrivate(f.p, 30);
    else Storage.openShared(f.p, f.raid);
    f.p.getSession().flushPackets();
    await Promise.resolve();
    assert.deepEqual(f.p.getPacketSender().getSubInterfaceAt(target), { targetUid: target, groupId: side, type: 0 });
    const frames = packets(f.wire);
    const open = frames.findIndex((packet) => packet.equals(encodeWidgetOpenSub(target, side, 0)));
    assert.ok(open >= 0, "real open_sub packet mounts the storage inventory and runs onLoad");
    for (const [id, value] of [[3459, privateView ? 1 : 0], [5509, 0]]) {
      const index = frames.findIndex((packet) => packet.equals(encodeVarbit(id, value)));
      assert.ok(index >= 0 && index < open, "onLoad receives the correct private/shared and warning state");
    }
    f.p.getPacketSender().sendInterfaceRemoval();
    f.p.getSession().flushPackets();
    assert.equal(f.p.getPacketSender().getSubInterfaceAt(target), undefined);
    assert.equal(f.p.getInterfaceId(), -1);
  }
});

test("mounted private Store 1/5/10/All/X retain restricted instances, caps and once-per-bulk feedback", (t) => {
  const f = registeredStorage(t);
  Storage.openPrivate(f.p, 30);
  const restricted = preset(new core.Item(I.DEATH_RUNE, 1000, { proof: { nested: "retained" } }));
  const meta = structuredClone(restricted.getMeta());
  f.inv.setItem(0, restricted);
  for (const [op, quantity] of [[1, 1], [2, 5], [3, 10], [4, 40], [5, 7]]) {
    f.inv.setItem(1, new core.Item(I.DEATH_RUNE, 40));
    const before = stored(f, I.DEATH_RUNE);
    click(f, 551, 1, 1, op);
    if (op === 5) { assert.ok(f.p.getEnteredAmountAction()); f.p.getEnteredAmountAction().execute(quantity); f.p.setEnteredAmountAction(null); }
    assert.equal(stored(f, I.DEATH_RUNE) - before, quantity);
    assert.equal(f.inv.getItems()[1].getAmount(), op === 4 ? 0 : 40 - quantity);
    click(f, 551, 1, 0, op);
    if (op === 5) { f.p.getEnteredAmountAction().execute(7); f.p.setEnteredAmountAction(null); }
    assert.equal(f.messages.filter((message) => message === PRESET_TEXT).length, op);
    assert.equal(f.inv.getItems()[0], restricted);
    assert.deepEqual(restricted.getMeta(), meta);
  }
  f.p.setAttribute("cox:private-storage", [{ id: I.DEATH_RUNE, amount: 2147483645 }]);
  f.inv.setItem(1, new core.Item(I.DEATH_RUNE, 10));
  click(f, 551, 1, 1, 4);
  assert.equal(stored(f, I.DEATH_RUNE), 2147483647);
  assert.equal(f.inv.getItems()[1].getAmount(), 8);
  f.inv.setItem(2, preset(new core.Item(I.ABYSSAL_WHIP)));
  click(f, 271, 10);
  click(f, 271, 10);
  assert.equal(f.messages.filter((message) => message === PRESET_TEXT).length, 7);
  f.p.getPacketSender().sendInterfaceRemoval();
  click(f, 551, 1, 1, 4);
  assert.equal(f.inv.getItems()[1].getAmount(), 8, "closed side input cannot deposit");
});

test("mounted shared Donate operations isolate the raid and private storage; stale amount prompts refuse after close", (t) => {
  const f = registeredStorage(t);
  const other = registeredStorage(t);
  f.p.setAttribute("cox:private-storage", [{ id: I.CAVE_WORMS, amount: 13 }]);
  Storage.openShared(f.p, f.raid);
  for (const [op, quantity] of [[1, 1], [2, 5], [3, 10], [4, 40], [5, 7]]) {
    f.inv.setItem(0, new core.Item(I.CAVE_WORMS, 40));
    click(f, 551, 1, 0, op);
    if (op === 5) { f.p.getEnteredAmountAction().execute(quantity); f.p.setEnteredAmountAction(null); }
  }
  assert.equal(f.raid.sharedItems[0].amount, 63);
  assert.equal(stored(f, I.CAVE_WORMS), 13);
  assert.deepEqual(other.raid.sharedItems ?? [], []);
  click(f, 271, 10);
  assert.equal(f.raid.sharedItems[0].amount, 63, "private bulk button is refused in shared view");
  click(f, 551, 1, 0, 5);
  const pending = f.p.getEnteredAmountAction();
  f.p.getPacketSender().sendInterfaceRemoval();
  pending.execute(10);
  assert.equal(f.raid.sharedItems[0].amount, 63);
  Storage.openShared(f.p, f.raid);
  f.p.setAttribute(Raid.ATTR_RAID, other.raid);
  click(f, 551, 1, 0, 4);
  assert.equal(f.raid.sharedItems[0].amount, 63, "a different raid cannot access the old view");
});

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

test("Deposit-all warns once per operation while preserving restricted copies and storing plain items", (t) => {
  const f = inStorage(t);
  const restricted = [preset(new core.Item(I.DEATH_RUNE, 1000)), preset(new core.Item(I.ABYSSAL_WHIP)), new core.Item(I.COINS, 25)];
  restricted[2].setMetaValue(core.Item.UNBANKABLE_META, true);
  restricted.forEach((item, slot) => f.inv.setItem(slot, item));
  f.inv.setItem(3, new core.Item(I.DEATH_RUNE, 300));
  f.inv.setItem(4, new core.Item(I.ABYSSAL_WHIP));
  const before = restricted.map((item) => ({ id: item.getId(), amount: item.getAmount(), meta: { ...item.getMeta() } }));
  Storage.depositOrBankAll({ player: f.p });
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  assert.equal(stored(f, I.DEATH_RUNE), 300);
  assert.equal(stored(f, I.ABYSSAL_WHIP), 1);
  assert.equal(stored(f, I.COINS), 0);
  restricted.forEach((item, slot) => {
    assert.equal(f.inv.getItems()[slot], item, "same restricted item instance remains in its slot");
    assert.deepEqual({ id: item.getId(), amount: item.getAmount(), meta: { ...item.getMeta() } }, before[slot]);
  });
  Storage.depositOrBankAll({ player: f.p });
  assert.deepEqual(f.messages, [PRESET_TEXT, PRESET_TEXT], "another operation gets its own warning");
  Storage.deposit(f.p, 0, 1000);
  Storage.deposit(f.p, 1, 1);
  assert.equal(f.messages.length, 4, "individual refused deposits still each warn");
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
