// Run after `yarn build`: node --test tests/surge-potion.test.cjs
//
// Surge potion (Wiki; rsprox recording 4098, rev 237): a dose restores 25% special attack energy, shows
// vfx_surge_potion_01 with synth 6182 and sets `surge_potion_timer` to 50, one less every ten ticks; at 0
// "You now feel capable of drinking another dose of surge potion". Early doses are refused with the time
// left, doses at full energy with "Drinking this would have no effect.". A house pool, the free-for-all
// portal or a death (not in a raid) ends the wait. The potion used to do nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");

const HOME = [3222, 3218];
const READY = "<col=ff3045>You now feel capable of drinking another dose of surge potion</col>.";
const ADRENALINE = (wait) => `You are still full of adrenaline. You'll be able to drink in ${wait}.`;

let core;
let I;
let Surge;
let next = 7800;
let cycle = 5000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  Surge = require("../plugins/items/SurgePotion.plugin.js");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("surgeqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const spam = [];
  const varbits = new Map();
  const graphics = [];
  const sounds = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.mock.method(sender, "sendTypedMessage", (type, message) => { if (type === core.ChatType.SPAM) spam.push(message); return sender; });
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.set(id, value); return sender; });
  t.mock.method(sender, "getVarbit", (id) => varbits.get(id) ?? 0);
  t.mock.method(sender, "sendSoundEffect", (id) => { sounds.push(id); return sender; });
  t.mock.method(p, "performGraphic", (graphic) => { graphics.push(graphic); });
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const timer = () => varbits.get(core.CacheDefinitions.getVarbitId("surge_potion_timer")) ?? 0;
  return { p, c, inv: p.getInventory(), messages, spam, graphics, sounds, timer };
}

async function drink(f, slot = 0) {
  await f.c.dispatch([{ type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option: "Drink" }]);
  f.c.processTurnPackets();
}

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    cycle++;
    f.p.getTimers().process();
    PM.emitPlayerProcess({ player: f.p });
  }
}

test("a dose restores 25% special energy, shows the surge graphic and starts the timer at 50", async (t) => {
  const f = actor(t);
  f.p.setSpecialPercentage(25);
  f.inv.add(new core.Item(I.SURGE_POTION_3_, 1));
  await drink(f);
  assert.equal(f.p.getSpecialPercentage(), 50);
  assert.equal(f.inv.getItems()[0].getId(), I.SURGE_POTION_2_);
  assert.equal(f.timer(), 50);
  assert.deepEqual(f.spam, ["You drink some of your surge potion.", "You have 2 doses of potion left."]);
  assert.deepEqual(f.graphics.map((g) => [g.id, g.height]), [[core.CacheDefinitions.getSpotanimId("vfx_surge_potion_01"), 100]]);
  assert.ok(f.sounds.includes(6182));
  // The drink's own tick does not count: 49 ten ticks later (rsprox t1291 -> t1301).
  tick(f, 9);
  assert.equal(f.timer(), 50);
  tick(f);
  assert.equal(f.timer(), 49);
});

test("the wait runs out 500 ticks after the drink, with the line once", async (t) => {
  const f = actor(t);
  f.p.setSpecialPercentage(0);
  f.inv.add(new core.Item(I.SURGE_POTION_4_, 1));
  await drink(f);
  tick(f, 499);
  assert.equal(f.timer(), 1);
  assert.equal(f.messages.includes(READY), false);
  tick(f);
  assert.equal(f.timer(), 0);
  tick(f, 20);
  assert.deepEqual(f.messages.filter((m) => m === READY), [READY]);
});

test("an early dose is refused with the time left, even at full energy, and nothing is drunk", async (t) => {
  const f = actor(t);
  f.p.setSpecialPercentage(0);
  f.inv.add(new core.Item(I.SURGE_POTION_4_, 1));
  await drink(f);
  tick(f, 8);
  await drink(f);
  assert.equal(f.messages.at(-1), ADRENALINE("5 minutes"));
  assert.equal(f.inv.getItems()[0].getId(), I.SURGE_POTION_3_);
  assert.equal(f.p.getSpecialPercentage(), 25);
  f.p.setSpecialPercentage(100);
  tick(f, 3);
  await drink(f);
  assert.equal(f.messages.at(-1), ADRENALINE("5 minutes"));
  // Timer 4 (rsprox t1752): "24 seconds".
  tick(f, 500 - 40 - 11);
  assert.equal(f.timer(), 4);
  await drink(f);
  assert.equal(f.messages.at(-1), ADRENALINE("24 seconds"));
  assert.equal(f.inv.getItems()[0].getId(), I.SURGE_POTION_3_);
});

test("the refusal rounds the timer as recorded", () => {
  // rsprox 4098 t1299-1783: timer value -> wait text.
  const recorded = {
    50: "5 minutes", 45: "5 minutes", 44: "4 minutes", 35: "4 minutes", 34: "3 minutes", 25: "3 minutes",
    24: "2 minutes", 15: "2 minutes", 14: "1 minute", 5: "1 minute", 4: "24 seconds", 3: "18 seconds",
    2: "12 seconds", 1: "6 seconds",
  };
  for (const [value, text] of Object.entries(recorded)) assert.equal(Surge._test.waitText(Number(value)), text, `timer ${value}`);
});

test("at full energy with no wait the dose has no effect", async (t) => {
  const f = actor(t);
  f.p.setSpecialPercentage(100);
  f.inv.add(new core.Item(I.SURGE_POTION_4_, 1));
  await drink(f);
  assert.deepEqual(f.messages, ["Drinking this would have no effect."]);
  assert.equal(f.inv.getItems()[0].getId(), I.SURGE_POTION_4_);
  assert.equal(f.timer(), 0);
});

test("a house pool, the free-for-all portal and a death end the wait: 1, then 0 and the line", async (t) => {
  const f = actor(t);
  for (const reset of [
    () => PM.emitCustomEvent("rejuvenation-pool:restored", { player: f.p, tier: 4 }),
    () => PM.emitCustomEvent("free-for-all-portal:used", { player: f.p }),
    () => PM.emitCustomEvent("player:died", { player: f.p, killer: null, itemsLost: true }),
  ]) {
    f.p.setSpecialPercentage(0);
    f.inv.resetItems().add(new core.Item(I.SURGE_POTION_4_, 1));
    f.messages.length = 0;
    await drink(f);
    tick(f, 30);
    reset();
    assert.equal(f.timer(), 1);
    tick(f);
    assert.equal(f.timer(), 0);
    assert.deepEqual(f.messages, [READY]);
  }
});

test("a death in a raid keeps the wait (Wiki)", async (t) => {
  const f = actor(t);
  f.p.setSpecialPercentage(0);
  f.inv.add(new core.Item(I.SURGE_POTION_4_, 1));
  await drink(f);
  t.mock.method(f.p, "getArea", () => ({ getName: () => "Theatre of Blood" }));
  PM.emitCustomEvent("player:died", { player: f.p, killer: null, itemsLost: false });
  assert.equal(f.timer(), 50);
});

test("the wait survives a real save and is sent again on login", async (t) => {
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const f = actor(t);
  f.p.setSpecialPercentage(0);
  f.inv.add(new core.Item(I.SURGE_POTION_4_, 1));
  await drink(f);
  tick(f, 100);
  const fresh = actor(t);
  PlayerSave.fromPlayer(f.p).applyToPlayer(fresh.p);
  assert.equal(fresh.p.getAttribute(Surge._test.TICKS_LEFT_ATTRIBUTE), 400);
  PM.emitPlayerLogin({ player: fresh.p, username: fresh.p.getUsername() });
  assert.equal(fresh.timer(), 40);
});
