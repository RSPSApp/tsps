// Run after `yarn build`: node --test tests/seed-box-auto-store.test.cjs
//
// #2650. Wiki, Seed box: open, it takes "seeds that the player picks up", "Seeds pickpocketed from Master Farmers", and
// "looting Sailing creatures while opened", "provided there is space for it". Six types at most.
//
// Real: the plugins, the ground_item_action and npc_option packets, the pickpocket. Fixture seams: the sea test calls
// the harvest's loot directly with a corpse put in its map, and a test listener adds the seed to its drop table, as
// no drop table is relied on. Math.random is held only for the few ticks of one pickpocket, so a roll takes a seed and
// the pickpocket lands; never across a burrow of the Gemstone Crab, which starts at tick 918. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { OperationType: GroundOperationType } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const Data = require("../plugins/skills/farming/Data.Farming");
const Loot = require("../plugins/skills/sailing/seacombat/Loot.SeaCombat");
const { Wilderness } = require("../dist/game/content/wilderness/Wilderness");

const HOME = [3094, 3250]; // Draynor market, where a Master Farmer stands.
const WILDERNESS = [3100, 3600]; // As looting-bag.test.cjs.
const STORED = "farming:stored";

let core;
let I;
let next = 9500;
let seaSeeds = 0;
let seaExtra = [];
const pickupPolicies = new WeakMap();
const pickupEvents = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(HOME[0], HOME[1]);
  core.RegionManager.loadMapFiles(WILDERNESS[0], WILDERNESS[1]);
  PM.emitServerStartup({});
  PM.createApi("SeedPickupPolicyTest").onCustomEvent("ground-items:take", (event) => pickupPolicies.get(event.player)?.(event));
  PM.createApi("SeedPickupEventTest").onCustomEvent("ground-items:taken", (event) => pickupEvents.get(event.player)?.push({ amount: event.amount, discarded: event.discarded, source: event.source }));

  PM.createApi("SeedBoxTest").onCustomEvent("npc-drops:roll-table", ({ drops }) => {
    if (seaSeeds > 0) drops.push({ itemId: I.POTATO_SEED, amount: seaSeeds });
    drops.push(...seaExtra);
  });
});
after(() => PM.emitServerShutdown({}));

function actor(t, boxName, stored = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("seedqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 99);
  p.getSkillManager().setMaxLevel(core.Skill.THIEVING, 99);
  const c = new ClientConnection(channel);
  c.player = p;
  const box = new core.Item(Data.itemId(boxName), 1);
  box.setMetaValue(STORED, { ...stored });
  p.getInventory().setItem(0, box);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), box };
}

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const inBox = (f, id) => (f.box.getMetaValue(STORED) ?? {})[id] ?? 0;

function drop(f, id, amount) {
  const location = f.p.getLocation().clone();
  return core.ItemOnGroundManager.registerLocation(f.p, new core.Item(id, amount), location, null);
}

const take = (f, id) => send(f, {
  type: "ground_item_action", itemId: id, x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), option: "Take",
});

test("an open box takes seeds picked up; nothing's left on the floor", async (t) => {
  const f = actor(t, "Open seed box");
  drop(f, I.POTATO_SEED, 5);
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 5, "in the box");
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 0, "not in the inventory");
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 5, "the floor is empty");
});

test("partial pickup reports the changed floor stack and each credited quantity", async (t) => {
  const f = actor(t, "Open seed box", { [I.POTATO_SEED]: 2147483645 });
  const events = [];
  pickupEvents.set(f.p, events);
  const ground = drop(f, I.POTATO_SEED, 5);
  const changes = [];
  const manager = core.ItemOnGroundManager;
  const perform = manager.perform.bind(manager);
  t.mock.method(manager, "perform", (item, operation) => {
    if (item === ground) changes.push([item.getOldAmount(), item.getItem().getAmount(), operation]);
    return perform(item, operation);
  });
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 2147483647);
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 3);
  assert.ok(changes.some(([oldAmount, amount, operation]) => oldAmount === 5 && amount === 3 && operation === GroundOperationType.ALTER));
  assert.deepEqual(events, [{ amount: 2, discarded: 0, source: "pickup" }, { amount: 3, discarded: 0, source: "pickup" }]);
});

test("a refused ground take never stores or removes the seed", async (t) => {
  const f = actor(t, "Open seed box");
  const ground = drop(f, I.POTATO_SEED, 5);
  const events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => { event.allow = false; });
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 0);
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 0);
  assert.equal(ground.getItem().getAmount(), 5);
  assert.equal(ground.isPendingRemoval(), false);
  assert.deepEqual(events, []);
});

test("a nested pickup during the take policy cannot take the same seed twice", async (t) => {
  const f = actor(t, "Open seed box");
  const ground = drop(f, I.POTATO_SEED, 5);
  const events = [];
  pickupEvents.set(f.p, events);
  let calls = 0;
  pickupPolicies.set(f.p, () => {
    calls++;
    if (calls === 1) core.ItemOnGroundManager.pickup(f.p, ground);
  });
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(calls, 1);
  assert.equal(inBox(f, I.POTATO_SEED), 5);
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 0);
  assert.deepEqual(events, [{ amount: 5, discarded: 0, source: "pickup" }]);
});

test("a take policy can reduce credit and discard a bounded quantity", async (t) => {
  const f = actor(t, "Open seed box");
  drop(f, I.POTATO_SEED, 5);
  const events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => {
    if (event.amount === 5) { event.amount = 2; event.discard = 1; }
  });
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 2);
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 2);
  assert.deepEqual(events, [{ amount: 2, discarded: 1, source: "pickup" }, { amount: 2, discarded: 0, source: "pickup" }]);
});

test("a take policy changing the floor item cancels the seed-box transfer", async (t) => {
  const f = actor(t, "Open seed box");
  const ground = drop(f, I.POTATO_SEED, 5);
  const events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, () => ground.getItem().setAmount(4));
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 0);
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 0);
  assert.equal(ground.getItem().getAmount(), 4);
  assert.deepEqual(events, []);
});

test("metadata-bearing seeds follow the ordinary pickup path", async (t) => {
  const f = actor(t, "Open seed box");
  const item = new core.Item(I.POTATO_SEED, 3);
  item.setMetaValue("seed-test:marker", 17);
  core.ItemOnGroundManager.registerLocation(f.p, item, f.p.getLocation().clone(), null);
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 0);
  const held = f.inv.getValidItems().find((entry) => entry.getId() === I.POTATO_SEED);
  assert.equal(held?.getAmount(), 3);
  assert.equal(held?.getMetaValue("seed-test:marker"), 17);
});

// These two pin the hook order: the API's onGroundItemPickup skips a hook once the event is handled, so whichever runs
// first has the pickup. Dependency resolution puts Farming before LootingBag, and the Ironman refusal before Farming.
test("with an open looting bag too, the open box takes the seeds, once: ours, the Wiki's silent", async (t) => {
  const f = actor(t, "Open seed box");
  f.p.setLocation(new core.Location(WILDERNESS[0], WILDERNESS[1], 0));
  assert.equal(Wilderness.isIn(f.p), true, "control: where the bag can take things");
  const bag = new core.Item(22586, 1); // Open looting bag
  f.inv.setItem(1, bag);
  drop(f, I.POTATO_SEED, 5);
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 5, "the box has them");
  assert.deepEqual(bag.getMetaValue("lootingBag") ?? [], [], "the bag has no copy");
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 0, "nor the inventory");
});

test("without an open box, the open looting bag does take them", async (t) => {
  const f = actor(t, "Seed box");
  f.p.setLocation(new core.Location(WILDERNESS[0], WILDERNESS[1], 0));
  const bag = new core.Item(22586, 1);
  f.inv.setItem(1, bag);
  drop(f, I.POTATO_SEED, 5);
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal((bag.getMetaValue("lootingBag") ?? []).reduce((sum, entry) => sum + entry.amount, 0), 5, "control: the bag works here");
  assert.equal(inBox(f, I.POTATO_SEED), 0, "the closed box");
});

test("an Ironman refused another player's seeds stores nothing, and they stay on the floor", async (t) => {
  const other = actor(t, "Seed box");
  const f = actor(t, "Open seed box");
  f.p.setAttribute("ironman:mode", "ironman");
  const messages = [];
  const say = f.p.sendMessage.bind(f.p);
  t.mock.method(f.p, "sendMessage", (text) => { messages.push(String(text)); return say(text); });
  core.ItemOnGroundManager.registerLocation(other.p, new core.Item(I.POTATO_SEED, 5), f.p.getLocation().clone(), null, { public: true });
  const left = () => core.World.getItems().filter((item) => item.getItem().getId() === I.POTATO_SEED && item.getOwner?.() === other.p.getUsername());
  t.after(() => { for (const item of left()) core.ItemOnGroundManager.deregister(item); });
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.ok(messages.length > 0, "control: refused, with a line");
  assert.equal(inBox(f, I.POTATO_SEED), 0, "not stored");
  assert.equal(left().length, 1, "still on the floor");
});

test("a closed box takes nothing, and neither does an open one for what isn't a seed", async (t) => {
  const closed = actor(t, "Seed box");
  drop(closed, I.POTATO_SEED, 5);
  await take(closed, I.POTATO_SEED);
  tick(closed, 2);
  assert.equal(closed.inv.getAmount(I.POTATO_SEED), 5, "control: into the inventory");
  assert.equal(inBox(closed, I.POTATO_SEED), 0, "the closed box");

  const open = actor(t, "Open seed box");
  drop(open, I.COINS, 5);
  await take(open, I.COINS);
  tick(open, 2);
  assert.equal(open.inv.getAmount(I.COINS), 5, "coins");
});

test("with six other types in it, the seed goes to the inventory", async (t) => {
  const ids = ["Marigold seed", "Guam seed", "Marrentill seed", "Tarromin seed", "Harralander seed", "Ranarr seed"].map((name) => Data.itemId(name));
  const f = actor(t, "Open seed box", Object.fromEntries(ids.map((id) => [id, 1])));
  drop(f, I.POTATO_SEED, 5);
  await take(f, I.POTATO_SEED);
  tick(f, 2);
  assert.equal(inBox(f, I.POTATO_SEED), 0, "no room for a seventh type");
  assert.equal(f.inv.getAmount(I.POTATO_SEED), 5, "the inventory");
  const known = ids[0];
  drop(f, known, 2);
  await take(f, known);
  tick(f, 2);
  assert.equal(inBox(f, known), 3, "a type it holds still goes in");
});

async function pickpocket(t, f) {
  const npc = core.NPC.create(core.NpcIdentifiers.MASTER_FARMER, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const clickType = npc.getCurrentDefinition().getActions().indexOf("Pickpocket") + 1;
  assert.ok(clickType > 0, "control: he can be pickpocketed");
  const real = Math.random;
  Math.random = () => 0.01;
  try {
    await send(f, { type: "npc_option", index: npc.getIndex(), clickType });
    tick(f, 4);
  } finally {
    Math.random = real;
  }
}

test("seeds pickpocketed from a Master Farmer go into an open box, and the steal is still said", async (t) => {
  const f = actor(t, "Open seed box");
  const spam = [];
  const say = f.p.getPacketSender().sendTypedMessage.bind(f.p.getPacketSender());
  t.mock.method(f.p.getPacketSender(), "sendTypedMessage", (type, text) => { spam.push(String(text)); return say(type, text); });
  const lines = [];
  const message = f.p.sendMessage.bind(f.p);
  t.mock.method(f.p, "sendMessage", (text) => { lines.push(String(text)); return message(text); });
  await pickpocket(t, f);
  const total = Object.values(f.box.getMetaValue(STORED) ?? {}).reduce((sum, amount) => sum + amount, 0);
  assert.ok(total > 0, `the seeds are in the box: ${JSON.stringify([...lines, ...spam])}`);
  assert.equal(f.inv.getValidItems().length, 1, "only the box is held");
  assert.ok([...lines, ...spam].some((text) => /You steal \d+ /.test(text)), "and it's said");
});

test("a closed box leaves them in the inventory", async (t) => {
  const f = actor(t, "Seed box");
  await pickpocket(t, f);
  assert.deepEqual(f.box.getMetaValue(STORED), {}, "the closed box");
  assert.ok(f.inv.getValidItems().length > 1, "control: the seeds are held");
});

function seaLoot(t, f, extra = []) {
  const npc = core.NPC.create(core.NpcIdentifiers.MASTER_FARMER, new core.Location(HOME[0] + 2, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); });
  const corpse = { owner: f.p, creature: { npc: npc.getId(), dead: npc.getId() }, damagers: [] };
  Loot.corpses.set(npc, corpse);
  seaSeeds = extra.length && extra[0].noSeed ? 0 : 7;
  seaExtra = extra.map(({ itemId, amount }) => ({ itemId, amount }));
  t.after(() => { seaSeeds = 0; seaExtra = []; });
  Loot.loot(f.p, npc, corpse);
  seaSeeds = 0;
  seaExtra = [];
}

test("seeds looted from a Sailing creature go into an open box, and stay out of a closed one", (t) => {
  const open = actor(t, "Open seed box");
  seaLoot(t, open);
  assert.equal(inBox(open, I.POTATO_SEED), 7, "in the box");
  assert.equal(open.inv.getAmount(I.POTATO_SEED), 0, "not the inventory");

  const closed = actor(t, "Seed box");
  seaLoot(t, closed);
  assert.equal(closed.inv.getAmount(I.POTATO_SEED), 7, "control: the inventory");
});

const onFloor = (id) => core.World.getItems().filter((item) => item.getItem().getId() === id)
  .reduce((sum, item) => sum + item.getItem().getAmount(), 0);

test("with a full bag at sea, the seed goes in the box and only the rest lands: no copy on the floor", (t) => {
  const f = actor(t, "Open seed box");
  for (let slot = 1; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BONES, 1));
  assert.equal(f.inv.getFreeSlots(), 0, "control: a full bag");
  const seeds = onFloor(I.POTATO_SEED);
  const coins = onFloor(I.COINS);
  seaLoot(t, f, [{ itemId: I.COINS, amount: 50 }]);
  assert.equal(inBox(f, I.POTATO_SEED), 7, "in the box");
  assert.equal(onFloor(I.POTATO_SEED), seeds, "and not on the floor too");
  assert.equal(onFloor(I.COINS), coins + 50, "control: the rest was placed");
  t.after(() => {
    for (const item of [...core.World.getItems()]) {
      if (item.getItem().getId() === I.COINS) core.ItemOnGroundManager.deregister(item);
    }
  });
});

test("sea loot isn't taken by another open container: a fish barrel leaves a sea creature's fish alone", (t) => {
  const f = actor(t, "Open seed box");
  f.inv.setItem(1, new core.Item(Data.itemId("Open fish barrel"), 1));
  const request = { player: f.p, itemId: I.RAW_SHARK, amount: 1, stored: 0 };
  PM.emitCustomEvent("storage:gather", request);
  assert.equal(request.stored, 1, "control: the open barrel does take a gathered fish");
  seaLoot(t, f, [{ itemId: I.RAW_SHARK, amount: 2, noSeed: true }]);
  assert.equal(f.inv.getAmount(I.RAW_SHARK), 2, "the looted fish are in the inventory");
});

test("the gather is for those sources: a stall's seed isn't taken", (t) => {
  const f = actor(t, "Open seed box");
  const request = { player: f.p, itemId: I.POTATO_SEED, amount: 3, stored: 0 };
  PM.emitCustomEvent("storage:gather", request);
  assert.equal(request.stored, 0, "no source, no seed box");
  assert.equal(inBox(f, I.POTATO_SEED), 0);
});
