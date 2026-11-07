// Run after `yarn build`: node --test tests/goading-potion.test.cjs
//
// Goading potion (Wiki, rsprox recordings 821, 3402, 3414, 4056, 4066, 4069, 4073, 4092, 4094, 4099,
// 4101): drinking a dose sets `goading_potion_timer` to 100; it drops one every six ticks, warns at 3
// and ends at 0; another dose sets it back to 100; a teleport or a cup of tea ends it at once with the
// worn-off line. Every six ticks from the tick after the drink, monsters within four tiles that the
// player can see and has the Slayer level for turn on the player. The potion used to do nothing.
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
const WARNING = "<col=ff3045>Your Goading potion has almost run out!";
const WORN_OFF = "<col=ff3045>The effects of your Goading potion have worn off.";

let core;
let I;
let next = 7700;
let cycle = 1000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
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
  p.setUsername("goadqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const varbits = new Map();
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.set(id, value); return sender; });
  t.mock.method(sender, "getVarbit", (id) => varbits.get(id) ?? 0);
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const timer = () => varbits.get(core.CacheDefinitions.getVarbitId("goading_potion_timer")) ?? 0;
  return { p, c, inv: p.getInventory(), messages, timer };
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

function cow(f, dx, dy, id = core.NpcIdentifiers.COW) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + dx, HOME[1] + dy, 0));
  npc.setSpawnPosition(npc.getLocation().clone());
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  npc.setHitpoints(10);
  return npc;
}

function withNpcs(f, t, ...npcs) {
  t.mock.method(f.p, "getLocalNpcs", () => npcs);
}

const dose4 = () => new core.Item(I.GOADING_POTION_4_, 1);

test("a dose is drunk, starts the timer at 100 and leaves one fewer dose", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, dose4());
  await drink(f);
  assert.equal(f.inv.getItems()[0].getId(), I.GOADING_POTION_3_);
  assert.equal(f.timer(), 100);
  assert.deepEqual(f.messages, ["You drink some of your goading potion.", "You have 3 doses of potion left."]);
});

test("the doses left are told, down to the last", async (t) => {
  const f = actor(t);
  const told = [];
  for (const [id, line] of [[I.GOADING_POTION_3_, "You have 2 doses of potion left."], [I.GOADING_POTION_2_, "You have 1 dose of potion left."],
    [I.GOADING_POTION_1_, "You have finished your potion."]]) {
    f.messages.length = 0;
    f.inv.setItem(0, new core.Item(id, 1));
    tick(f, 3);
    await drink(f);
    told.push(f.messages[1]);
    assert.equal(f.messages[1], line);
  }
  assert.equal(told.length, 3);
});

test("the timer drops every six ticks, warns at 3 and ends at 0 after six minutes", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, dose4());
  await drink(f);
  tick(f, 5);
  assert.equal(f.timer(), 100);
  tick(f, 1);
  assert.equal(f.timer(), 99);
  tick(f, 6 * 96);
  assert.equal(f.timer(), 3);
  assert.equal(f.messages.filter((m) => m === WARNING).length, 1);
  tick(f, 17);
  assert.equal(f.timer(), 1);
  assert.ok(!f.messages.includes(WORN_OFF));
  tick(f, 1);
  assert.equal(f.timer(), 0);
  assert.equal(f.messages.filter((m) => m === WORN_OFF).length, 1);
  tick(f, 12);
  assert.equal(f.messages.filter((m) => m === WORN_OFF).length, 1);
});

test("another dose while it runs sets the timer back to 100", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, dose4());
  await drink(f);
  tick(f, 6 * 40);
  assert.equal(f.timer(), 60);
  f.inv.setItem(0, dose4());
  await drink(f);
  assert.equal(f.timer(), 100);
});

test("a teleport ends it with the worn-off line; without the potion it says nothing", async (t) => {
  const f = actor(t);
  PM.emitCustomEvent("teleport:landed", { player: f.p, from: f.p.getLocation(), fromInstance: false, to: f.p.getLocation() });
  assert.ok(!f.messages.includes(WORN_OFF));
  f.inv.setItem(0, dose4());
  await drink(f);
  tick(f, 30);
  PM.emitCustomEvent("teleport:landed", { player: f.p, from: f.p.getLocation(), fromInstance: false, to: f.p.getLocation() });
  assert.equal(f.timer(), 0);
  assert.equal(f.messages.filter((m) => m === WORN_OFF).length, 1);
  tick(f, 20);
  assert.equal(f.messages.filter((m) => m === WORN_OFF).length, 1);
});

test("drinking a cup of tea ends it with the worn-off line", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, dose4());
  f.inv.setItem(1, new core.Item(I.CUP_OF_TEA_2, 1));
  await drink(f);
  assert.equal(f.timer(), 100);
  tick(f, 3);
  await f.c.dispatch([{ type: "inventory_action", slot: 1, itemId: I.CUP_OF_TEA_2, widgetId: 3214, option: "Drink" }]);
  f.c.processTurnPackets();
  assert.equal(f.timer(), 0);
  assert.ok(f.messages.includes(WORN_OFF), f.messages.join("|"));
});

test("a monster in view within four tiles turns on the player the tick after the drink", async (t) => {
  const f = actor(t);
  const near = cow(f, 3, 0);
  withNpcs(f, t, near);
  f.inv.setItem(0, dose4());
  await drink(f);
  assert.equal(near.getCombat().getTarget(), null, "no attack on the drink tick");
  tick(f, 1);
  assert.equal(near.getCombat().getTarget(), f.p);
});

test("a monster beyond four tiles, or a Slayer monster above the player's level, is left alone", async (t) => {
  const f = actor(t);
  const far = cow(f, 5, 0);
  const crawler = cow(f, 2, 0, core.NpcIdentifiers.CAVE_CRAWLER);
  f.p.getSkillManager().setCurrentLevels(core.Skill.SLAYER, 1, false);
  withNpcs(f, t, far, crawler);
  f.inv.setItem(0, dose4());
  await drink(f);
  tick(f, 14);
  assert.equal(far.getCombat().getTarget(), null);
  assert.equal(crawler.getCombat().getTarget(), null);
});

test("in single-way combat only one monster turns on the player", async (t) => {
  const f = actor(t);
  const first = cow(f, 2, 0);
  const second = cow(f, -2, 0);
  withNpcs(f, t, first, second);
  f.inv.setItem(0, dose4());
  await drink(f);
  tick(f, 1);
  const attacking = [first, second].filter((npc) => npc.getCombat().getTarget() === f.p);
  assert.equal(attacking.length, 1);
});
