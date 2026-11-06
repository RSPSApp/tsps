// Run after `yarn build`: node --test tests/grand-exchange-single-collect.test.cjs
//
// Collecting a finished Grand Exchange buy of a noteable item (#2537): one item arrives as the item and
// only two or more in a slot arrive as notes. Real clicks through ClientConnection.dispatch on the real
// plugin, the real ::ge and ::gecollect commands and the real cache's dragon bones (536, note 537).
//
// Evidence (rsprox, private, ids only): capture 1521 (rev 224) buys one Infinity boots (6920) and one other
// item and the main Collect button (465:6, op 1) puts each in the inventory as the item with count 1; a
// single bought item collected with the slot's op 1 (465:24) arrives as the item; capture 703 (rev 229)
// buys 11 dragon bones and the slot's op 2 hands over 11 x 536. Not captured: Collect-all with a stack,
// and the explicit Collect-note on a single (kept as it is; the issue states notes begin at two).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const HOME = [3222, 3218];
const GE = 465;
const GE_COLLECT = 402;
const OFFERS = "grand-exchange-offers";

let core;
let BONES;
let NOTE;
let next = 1400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  BONES = core.ItemIdentifiers.DRAGON_BONES;
  NOTE = core.ItemDefinition.forId(BONES).getNoteId();
  assert.ok(NOTE > 0 && core.ItemDefinition.forId(NOTE).isNoted(), "dragon bones have a noted form");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gecol" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  const send = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => {
    messages.push(message);
    return send(message);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages };
}

/** A finished buy of `quantity` dragon bones waiting in offer slot 0. */
function finishedBuy(f, quantity) {
  f.p.setAttribute(OFFERS, {
    0: { itemId: BONES, sell: false, slot: 0, quantity, price: 1_000, total: 1_000 * quantity, finished: true, completesAt: null },
  });
}

async function click(f, groupId, childId, buttonNum, slot = 0, itemId = -1) {
  await f.c.dispatch([{ type: "widget_action", widgetId: (groupId << 16) | childId, groupId, childId, buttonNum, slot, itemId }]);
  f.c.processTurnPackets();
}

function openGe(f) {
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
}

function openBox(f) {
  PM.emitCommand({ player: f.p, raw: "gecollect", base: "gecollect", parts: ["gecollect"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE_COLLECT, "the collection box opened");
}

const held = (f) => ({ items: f.inv.getAmount(BONES), notes: f.inv.getAmount(NOTE) });
const waiting = (f) => Object.keys(f.p.getAttribute(OFFERS) ?? {}).length;

// The main Collect button (465:6), op 1: to the inventory.
test("Collect to inventory hands over a single item as the item", async (t) => {
  const f = actor(t);
  finishedBuy(f, 1);
  openGe(f);
  await click(f, GE, 6, 1);
  assert.deepEqual(held(f), { items: 1, notes: 0 }, "one item is not noted");
  assert.equal(waiting(f), 0, "and the offer is collected");
});

test("Collect to inventory hands over two or more as notes", async (t) => {
  const f = actor(t);
  finishedBuy(f, 2);
  openGe(f);
  await click(f, GE, 6, 1);
  assert.deepEqual(held(f), { items: 0, notes: 2 });
  assert.equal(waiting(f), 0);
});

// The Collection Box's collect-all to inventory (402:3).
test("the Collection Box's collect-all hands over a single item as the item", async (t) => {
  const f = actor(t);
  finishedBuy(f, 1);
  openBox(f);
  await click(f, GE_COLLECT, 3, 1);
  assert.deepEqual(held(f), { items: 1, notes: 0 }, "one item is not noted");
  assert.equal(waiting(f), 0);
});

test("the Collection Box's collect-all hands over two or more as notes", async (t) => {
  const f = actor(t);
  finishedBuy(f, 2);
  openBox(f);
  await click(f, GE_COLLECT, 3, 1);
  assert.deepEqual(held(f), { items: 0, notes: 2 });
  assert.equal(waiting(f), 0);
});

// The slot's own options (465:24), after opening the finished offer (465:7): a single is Collect-item (1)
// and Collect-note (2), a stack is Collect-notes (1) and Collect-items (2). These already behave so.
for (const [quantity, op, expected] of [
  [1, 1, { items: 1, notes: 0 }],
  [1, 2, { items: 0, notes: 1 }],
  [2, 1, { items: 0, notes: 2 }],
  [2, 2, { items: 2, notes: 0 }],
]) {
  test(`the slot's op ${op} on ${quantity} bought gives ${JSON.stringify(expected)}`, async (t) => {
    const f = actor(t);
    finishedBuy(f, quantity);
    openGe(f);
    await click(f, GE, 7, 1, 2);
    await click(f, GE, 24, op, 2, BONES);
    assert.deepEqual(held(f), expected);
    assert.equal(waiting(f), 0);
  });
}

// No room: the collection takes nothing and the offer stays.
test("a full inventory takes nothing and keeps the single item waiting", async (t) => {
  const f = actor(t);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(core.ItemIdentifiers.TINDERBOX, 1));
  finishedBuy(f, 1);
  openGe(f);
  await click(f, GE, 6, 1);
  assert.deepEqual(held(f), { items: 0, notes: 0 }, "nothing was handed over");
  assert.equal(waiting(f), 1, "the offer is still there to collect later");
  assert.match(f.messages.at(-1), /not have enough inventory space/);
});

// A single is an item and needs its own free slot, even beside a noted stack of the same item.
test("a full inventory holding the note does not take a single item as a note", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(NOTE, 5));
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(core.ItemIdentifiers.TINDERBOX, 1));
  finishedBuy(f, 1);
  openGe(f);
  await click(f, GE, 6, 1);
  assert.deepEqual(held(f), { items: 0, notes: 5 }, "the note stack is untouched");
  assert.equal(waiting(f), 1, "and the single item waits for room");
});

// The explicit Collect-note (slot op 2) on a single still is a note, so it joins a note stack even when
// the inventory is full. Unchanged by the fix: only Collect-all treats a single as an item.
test("the slot's Collect-note on a single still joins the note stack in a full inventory", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(NOTE, 5));
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(core.ItemIdentifiers.TINDERBOX, 1));
  finishedBuy(f, 1);
  openGe(f);
  await click(f, GE, 7, 1, 2);
  await click(f, GE, 24, 2, 2, BONES);
  assert.deepEqual(held(f), { items: 0, notes: 6 }, "the single joined the stack as a note");
  assert.equal(waiting(f), 0, "and the offer is collected");
});


// Actual registered bank policies and collection callbacks; dream/duel membership is set directly
// for these focused observer tests, not a claim of live travel or session creation.
function twoOffers(f) {
  f.p.setAttribute(OFFERS, {
    0: { itemId: BONES, sell: false, slot: 0, quantity: 1, price: 1000, total: 1000, finished: true, completesAt: null },
    1: { itemId: BONES, sell: false, slot: 1, quantity: 1, price: 1000, total: 1000, finished: true, completesAt: null },
    2: { itemId: BONES, sell: false, slot: 2, quantity: 1, price: 1000, total: 1000, finished: false, completesAt: null },
  });
}
function contents(f) {
  const items = container => container.getItems().filter(item => item.getId() > 0).map(item => [item.getId(), item.getAmount()]);
  return { offers: JSON.stringify(f.p.getAttribute(OFFERS)), inventory: items(f.inv),
    banks: Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, i) => items(f.p.getBank(i))) };
}
for (const policy of ["pin", "dream", "duel"]) {
  for (const route of ["exchange-all", "box-all", "box-single"]) {
    test(`${route} preserves all offers and checks ${policy} banking once`, async t => {
      const f = actor(t); twoOffers(f);
      if (route === "exchange-all") openGe(f); else openBox(f);
      const pin = require("../plugins/interface/bankpin/Common.BankPin");
      const dream = require("../plugins/minigames/nightmarezone/Dream.NightmareZone").dreams;
      const duel = require("../plugins/minigames/DuelArena.plugin")._test.sessions;
      t.after(() => { dream.delete(f.p); duel.delete(f.p); });
      if (policy === "pin") f.p.setAttribute("bank-pin:hash", pin.hash(f.p, "2468"));
      if (policy === "dream") dream.set(f.p, { player: f.p });
      if (policy === "duel") duel.set(f.p, {});
      const original = PM.emitCanBank, checks = [];
      t.mock.method(PM, "emitCanBank", (player, source) => { checks.push(source); return original.call(PM, player, source); });
      const before = contents(f); f.messages.length = 0;
      try {
        if (route === "exchange-all") await click(f, GE, 6, 2);
        else if (route === "box-all") await click(f, GE_COLLECT, 4, 1);
        else await click(f, GE_COLLECT, 5, 3, 3, BONES);
        assert.deepEqual(checks, ["grand-exchange-collect"], "one fresh bank-policy check");
        assert.deepEqual(contents(f), before, "refusal conserves offers, inventory and all bank tabs");
        assert.notEqual(f.p.getInterfaceId(), 213, "collection does not open a PIN keypad");
        if (policy !== "duel") assert.equal(f.messages.length, 1, "one refusal message for the batch");
        else assert.equal(f.messages.length, 0, "the duel bank policy is silent");
        // Remove the restriction and repeat: checks are per click and the retained offers are usable.
        if (policy === "pin") pin.unlock(f.p);
        dream.delete(f.p); duel.delete(f.p);
        if (route === "exchange-all") await click(f, GE, 6, 2);
        else if (route === "box-all") await click(f, GE_COLLECT, 4, 1);
        else await click(f, GE_COLLECT, 5, 3, 3, BONES);
        const expected = route === "box-single" ? 1 : 2;
        const banked = Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, i) => f.p.getBank(i).getAmount(BONES)).reduce((a, b) => a + b, 0);
        assert.equal(banked, expected, "the previously refused collection can complete");
        assert.equal(waiting(f), 3 - expected, "only collected offers are removed");
      } finally {
        dream.delete(f.p); duel.delete(f.p);
      }
    });
  }
}

test("a locked PIN still allows collection to inventory", async t => {
  const f = actor(t); twoOffers(f); openBox(f);
  const pin = require("../plugins/interface/bankpin/Common.BankPin");
  f.p.setAttribute("bank-pin:hash", pin.hash(f.p, "2468"));
  await click(f, GE_COLLECT, 3, 1);
  assert.equal(f.inv.getAmount(BONES), 2); assert.equal(waiting(f), 1, "unfinished offer remains");
});

test("no finished bank offer does not trigger a policy check", async t => {
  const f = actor(t); twoOffers(f); f.p.getAttribute(OFFERS)[0].finished = false; f.p.getAttribute(OFFERS)[1].finished = false; openBox(f);
  const original = PM.emitCanBank, checks = [];
  t.mock.method(PM, "emitCanBank", (player, source) => { checks.push(source); return original.call(PM, player, source); });
  await click(f, GE_COLLECT, 4, 1); assert.deepEqual(checks, []);
  assert.equal(waiting(f), 3);
});

test("normal account opening the exchange sees no Ironman-only instruction", t => {
  const f = actor(t); openGe(f);
  assert.ok(!f.messages.some(message => /Ironmen can only buy one bond/.test(message)));
});
