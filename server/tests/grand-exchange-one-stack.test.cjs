// Run after `yarn build`: node --test tests/grand-exchange-one-stack.test.cjs
//
// A Grand Exchange offer takes its input from one stack: an amount above the first stack of that id
// is refused with "Trade one item stack at a time." and takes nothing, even with a second stack that
// would cover it. Clicks go through ClientConnection.dispatch as decoded IF_BUTTON packets. The GE
// opens through the real ::ge command, and a buy's item is the answer to its search prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

const HOME = [3222, 3218];
const GE = 465;
const SIDE = 467;
const REFUSAL = "Trade one item stack at a time.";
const OFFERS = "grand-exchange-offers";
const PLUS_100 = 5;
const ALL = 6;

let core;
let I;
let next = 5500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("geqa" + p.getIndex());
  p.setRegistered(true);
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

const item = (id, amount = 1) => new core.Item(id, amount);
const put = (f, value, slot) => f.inv.setItem(slot, value);
const stacks = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && held.getAmount() > 0).map((held) => held.getAmount());
const placed = (f) => Object.values(f.p.getAttribute(OFFERS) ?? {});

async function button(f, groupId, childId, slot, itemId) {
  await f.c.dispatch([{ type: "widget_action", widgetId: (groupId << 16) | childId, groupId, childId, buttonNum: 1, slot, itemId }]);
  f.c.processTurnPackets();
}

function open(f) {
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
}

/** Clicks a stack in the side panel, picks a quantity with `control`, and confirms. */
async function sell(f, id, slot, control) {
  open(f);
  await button(f, SIDE, 0, slot, id);
  await button(f, GE, 34, control);
  await button(f, GE, 30);
}

/** One of `id` at its guide price, from the slot's Buy button and the search prompt. */
async function buy(f, id) {
  open(f);
  await button(f, GE, 7, 3);
  f.p.getEnteredSyntaxAction().execute(String(id));
  await button(f, GE, 30);
}

test("a sale within the first stack goes through and leaves the other stack", async (t) => {
  const single = actor(t);
  put(single, item(I.DRAGON_ARROW, 100), 0);
  await sell(single, I.DRAGON_ARROW, 0, PLUS_100);
  assert.equal(placed(single).length, 1, "control: one stack, offer placed");
  assert.deepEqual(stacks(single, I.DRAGON_ARROW), [], "control: the stack left");

  const f = actor(t);
  put(f, item(I.DRAGON_ARROW, 100), 0);
  put(f, item(I.DRAGON_ARROW, 30), 1);
  await sell(f, I.DRAGON_ARROW, 0, PLUS_100);
  assert.equal(placed(f).length, 1, "offer placed");
  assert.equal(placed(f)[0].quantity, 100);
  assert.deepEqual(stacks(f, I.DRAGON_ARROW), [30]);
  assert.ok(!f.messages.includes(REFUSAL));
});

test("a sale above the first stack is refused and takes nothing", async (t) => {
  const f = actor(t);
  put(f, item(I.DRAGON_ARROW, 30), 0);
  put(f, item(I.DRAGON_ARROW, 100), 1);
  await sell(f, I.DRAGON_ARROW, 1, PLUS_100);
  assert.ok(f.messages.includes(REFUSAL), "the refusal");
  assert.equal(placed(f).length, 0, "no offer");
  assert.deepEqual(stacks(f, I.DRAGON_ARROW), [30, 100], "nothing taken");
});

test("All across a plain and a preset stack is refused and takes neither", async (t) => {
  const f = actor(t);
  const preset = new Presetable("qa", [item(I.DRAGON_ARROW, 300)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, preset);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true, "marked copies from the real load");
  put(f, f.inv.getItems()[0].clone(), 10);
  put(f, item(-1, 0), 0);
  put(f, item(I.DRAGON_ARROW, 200), 5);
  await sell(f, I.DRAGON_ARROW, 5, ALL);
  assert.ok(f.messages.includes(REFUSAL), "the refusal");
  assert.equal(placed(f).length, 0, "no offer");
  assert.deepEqual(stacks(f, I.DRAGON_ARROW), [200, 300], "nothing taken");
  assert.equal(f.inv.getItems()[10].isPresetItem(), true, "the preset stack is untouched");
});

test("selling an unstackable item from several slots still goes through", async (t) => {
  const f = actor(t);
  put(f, item(I.RUNE_SCIMITAR), 0);
  put(f, item(I.RUNE_SCIMITAR), 1);
  await sell(f, I.RUNE_SCIMITAR, 0, ALL);
  assert.equal(placed(f).length, 1, "offer placed");
  assert.equal(placed(f)[0].quantity, 2);
  assert.equal(f.inv.getAmount(I.RUNE_SCIMITAR), 0);
  assert.ok(!f.messages.includes(REFUSAL));
});

test("a buy costing more than the first coin stack is refused and takes nothing", async (t) => {
  const control = actor(t);
  put(control, item(I.COINS, 100000000), 0);
  put(control, item(I.COINS, 1), 1);
  await buy(control, I.ABYSSAL_WHIP);
  assert.equal(placed(control).length, 1, "control: the first stack covers it");
  assert.deepEqual(stacks(control, I.COINS), [100000000 - placed(control)[0].total, 1], "control: paid from the first");
  assert.ok(placed(control)[0].total > 1, "control: costs more than 1 coin");

  const f = actor(t);
  put(f, item(I.COINS, 1), 0);
  put(f, item(I.COINS, 100000000), 1);
  await buy(f, I.ABYSSAL_WHIP);
  assert.ok(f.messages.includes(REFUSAL), "the refusal");
  assert.equal(placed(f).length, 0, "no offer");
  assert.deepEqual(stacks(f, I.COINS), [1, 100000000], "nothing taken");
});
