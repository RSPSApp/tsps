// Run after `yarn build`: node --test tests/farming-silklined-herb-sack.test.cjs
//
// Wiki (Silklined herb sack, Herb sack, Pristine spider silk): the sack is "made by using a pristine spider silk" on a herb
// sack, takes 1 tick, costs nothing and has no level requirement; it "will store up to 100 of each of the grimy normal herbs
// instead of 30"; its options are those of the herb sack (Fill, Open or Close, Check, Empty, Destroy) and an open one
// "will automatically collect any grimy herbs that are picked up", as the herb sack does. Items (cache): Silklined herb sack
// 33135, Open silklined herb sack 33137, Pristine spider silk 33133, which Sarachnis drops (generated drops, 1/50).
// NOT in any source, so assumed here and named in the PR: herbs already in the sack when it is upgraded (kept: the upgrade turns
// the same sack into the new one), whether an OPEN sack can be upgraded and stays open (it does), and any upgrade message (none).
//
// Real engine, the bots off; the upgrade is the real inventory_use_on packet, Open/Close/Fill the real inventory_action packet,
// the pickup a real ground_item_action. Built on the herb sack's auto-store (feat/herbsack-autostore bf97c76ba).
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
const STORED = "farming:stored";
let core, I, Data;
let next = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Data = require("../plugins/skills/farming/Data.Farming");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const ids = () => ({
  herb: Data.itemId("Herb sack"), openHerb: Data.itemId("Open herb sack"),
  silk: Data.itemId("Silklined herb sack"), openSilk: Data.itemId("Open silklined herb sack"),
});

function actor(t, sack) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("silksack" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.HERBLORE, 99, false).setCurrentLevels(core.Skill.HERBLORE, 99, false);
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(String(message)); return sender; });
  t.mock.method(p, "sendMessage", (message) => { messages.push(String(message)); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const f = { p, c, inv: p.getInventory(), messages };
  if (sack) {
    f.inv.add(new core.Item(ids()[sack]), false);
    f.sack = f.inv.getItems()[0];
  }
  return f;
}

const storedOf = (item) => item.getMetaValue(STORED) ?? {};
const guam = () => I.GRIMY_GUAM_LEAF;

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 4; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const slotOf = (f, id) => f.inv.getItems().findIndex((item) => item?.getId() === id);
const useSilk = (f) => send(f, {
  type: "inventory_use_on", slot: slotOf(f, I.PRISTINE_SPIDER_SILK), itemId: I.PRISTINE_SPIDER_SILK,
  target: { kind: "inventory", slot: 0, itemId: f.inv.getItems()[0].getId() },
});
const action = (f, option) => send(f, { type: "inventory_action", slot: 0, itemId: f.inv.getItems()[0].getId(), widgetId: 3214, option });

async function take(f, id) {
  core.ItemOnGroundManager.registerLocation(f.p, new core.Item(id, 1), f.p.getLocation().clone(), null);
  await f.c.dispatch([{ type: "ground_item_action", itemId: id, x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), option: "Take", optionIndex: 3 }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

test("a pristine spider silk used on a herb sack makes it a silklined herb sack, and the silk is used up", async (t) => {
  const f = actor(t, "herb");
  f.inv.add(new core.Item(I.PRISTINE_SPIDER_SILK, 1), false);
  await useSilk(f);
  assert.equal(f.inv.getItems()[0].getId(), ids().silk, "now a silklined herb sack");
  assert.equal(f.inv.getAmount(I.PRISTINE_SPIDER_SILK), 0, "the silk is used up");
  assert.equal(f.inv.getAmount(ids().herb), 0, "and it is not a second sack");
});

test("the upgrade keeps the herbs in the sack (assumed: the Wiki is silent)", async (t) => {
  const f = actor(t, "herb");
  f.sack.setMetaValue(STORED, { [guam()]: 17 });
  f.inv.add(new core.Item(I.PRISTINE_SPIDER_SILK, 1), false);
  await useSilk(f);
  assert.equal(f.inv.getItems()[0].getId(), ids().silk);
  assert.equal(storedOf(f.inv.getItems()[0])[guam()], 17);
});

test("an open herb sack becomes an open silklined herb sack (assumed)", async (t) => {
  const f = actor(t, "openHerb");
  f.inv.add(new core.Item(I.PRISTINE_SPIDER_SILK, 1), false);
  await useSilk(f);
  assert.equal(f.inv.getItems()[0].getId(), ids().openSilk);
});

test("a silk on a silklined sack changes nothing and is kept", async (t) => {
  const f = actor(t, "silk");
  f.inv.add(new core.Item(I.PRISTINE_SPIDER_SILK, 1), false);
  await useSilk(f);
  assert.equal(f.inv.getItems()[0].getId(), ids().silk);
  assert.equal(f.inv.getAmount(I.PRISTINE_SPIDER_SILK), 1, "the silk is not used");
});

test("a silklined sack stores 100 of each grimy herb, not 30: Fill takes what fits and keeps the rest in the pack", async (t) => {
  const f = actor(t, "silk");
  f.sack.setMetaValue(STORED, { [guam()]: 90 });
  for (let i = 0; i < 20; i++) f.inv.add(new core.Item(guam(), 1), false);
  await action(f, "Fill");
  assert.equal(storedOf(f.sack)[guam()], 100, "full at 100");
  assert.equal(f.inv.getAmount(guam()), 10, "the other ten stay in the pack");
  const plain = actor(t, "herb");
  plain.sack.setMetaValue(STORED, { [guam()]: 20 });
  for (let i = 0; i < 20; i++) plain.inv.add(new core.Item(guam(), 1), false);
  await action(plain, "Fill");
  assert.equal(storedOf(plain.sack)[guam()], 30, "control: the plain sack stops at 30");
});

test("an open silklined sack takes a picked up grimy herb up to 100", async (t) => {
  const f = actor(t, "openSilk");
  f.sack.setMetaValue(STORED, { [guam()]: 99 });
  await take(f, guam());
  assert.equal(storedOf(f.sack)[guam()], 100, "the hundredth goes in");
  assert.equal(f.inv.getAmount(guam()), 0);
});

// A second pickup in the same test did not land (probably the pickup delay), so the full sack gets a player of its own.
test("an open silklined sack that holds 100 of the herb leaves the next one in the pack", async (t) => {
  const f = actor(t, "openSilk");
  f.sack.setMetaValue(STORED, { [guam()]: 100 });
  await take(f, guam());
  assert.equal(storedOf(f.sack)[guam()], 100, "it finds the sack full");
  assert.equal(f.inv.getAmount(guam()), 1, "and it stays in the pack");
});

test("a closed silklined sack does not auto-store; Open and Close keep it silklined and keep its herbs", async (t) => {
  const f = actor(t, "silk");
  f.sack.setMetaValue(STORED, { [guam()]: 5 });
  await take(f, guam());
  assert.equal(f.inv.getAmount(guam()), 1, "closed: in the pack");
  await action(f, "Open");
  assert.equal(f.inv.getItems()[0].getId(), ids().openSilk, "Open: the open silklined sack");
  await action(f, "Close");
  assert.equal(f.inv.getItems()[0].getId(), ids().silk, "Close: back to the silklined sack");
  assert.equal(storedOf(f.inv.getItems()[0])[guam()], 5, "herbs kept");
});

test("Check and Empty work on a silklined sack", async (t) => {
  const f = actor(t, "silk");
  f.sack.setMetaValue(STORED, { [guam()]: 42 });
  await action(f, "Check");
  assert.ok(f.messages.some((message) => message.includes("42") && /guam/i.test(message)), JSON.stringify(f.messages));
  await action(f, "Empty");
  assert.ok(f.inv.getAmount(guam()) > 0, "some herbs are in the pack");
  assert.ok((storedOf(f.sack)[guam()] ?? 0) < 42, "and fewer in the sack");
});
