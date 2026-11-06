// Run after `yarn build`: node --test tests/gem-bag-pickup.test.cjs
//
// An open gem bag's ground pickup, by Take packet. Pickup hooks stop at the first handled one. Run
// opus-test-20261105T171928Z-23932 printed the order: StorageItems 2, Ironman 6, LootingBag 40. So the
// gem bag runs before the Ironman rule, and the looting bag after it and after the gem bag.
// Ironman's refusal line is captured (tests/ironman.test.cjs). No capture shows a bag at either.
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
const { State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const Storage = require("../plugins/items/storage/Common.StorageItems");

const HOME = [3222, 3218];
/** Level 1-ish Wilderness, north of the ditch, in the open. */
const WILDERNESS = [3100, 3540];
const OPEN_LOOTING_BAG = 22586;
const REFUSED = "You're an Ironman, so you can't take items that other players have dropped.";
const STRAIGHT_IN = "You put it straight into your open gem bag.";

let core;
let I;
let family;
let OPEN_GEM_BAG;
let next = 9800;
const pickupPolicies = new WeakMap();
const pickupEvents = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  family = Storage.FAMILIES.get("gem-bag");
  OPEN_GEM_BAG = core.CacheDefinitions.getObjId("gem_bag_open");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  core.RegionManager.loadMapFiles(...WILDERNESS);
  PM.emitServerStartup({});
  PM.createApi("GemPickupPolicyTest").onCustomEvent("ground-items:take", (event) => pickupPolicies.get(event.player)?.(event));
  PM.createApi("GemPickupEventTest").onCustomEvent("ground-items:taken", (event) => pickupEvents.get(event.player)?.push({ amount: event.amount, discarded: event.discarded, source: event.source }));

});
after(() => PM.emitServerShutdown({}));

function actor(t, at = HOME, gemBag = true) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pickqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  if (gemBag) p.getInventory().add(new core.Item(OPEN_GEM_BAG), true);
  return { p, c, inv: p.getInventory(), messages };
}

/** A gem on the player's own tile; `owner` null means theirs, else another player's gone public. */
function gemHere(t, f, owner = null) {
  const pile = core.ItemOnGroundManager.registers(f.p, new core.Item(I.UNCUT_RUBY, 1));
  if (owner) {
    pile.owner = owner;
    pile.setState(State.SEEN_BY_EVERYONE);
  }
  t.after(() => {
    if (!pile.isPendingRemoval()) core.ItemOnGroundManager.deregister(pile);
  });
  return pile;
}

async function take(f) {
  const at = f.p.getLocation();
  await f.c.dispatch([{ type: "ground_item_action", itemId: I.UNCUT_RUBY, x: at.getX(), y: at.getY(), option: "Take" }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 4; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const stored = (f) => Storage.amountOf(f.p, family, I.UNCUT_RUBY);
const setIron = (f) => f.p.setAttribute("ironman:mode", "ironman");

function watchPickupSounds(t, f) {
  const sounds = [];
  const sendSound = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (player, sound) => {
    if (player === f.p) sounds.push(sound.getId());
    return sendSound(player, sound);
  });
  return sounds;
}

for (const kind of ["bag", "sack"]) {
  test(`a successful ${kind} pickup plays the normal pickup sound once`, async (t) => {
    const f = actor(t, HOME, kind === "bag");
    if (kind === "sack") f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
    const pile = gemHere(t, f), events = [], sounds = watchPickupSounds(t, f);
    pickupEvents.set(f.p, events);
    await take(f);
    const target = Storage.FAMILIES.get(`gem-${kind}`);
    assert.equal(Storage.amountOf(f.p, target, I.UNCUT_RUBY), 1);
    assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
    assert.equal(pile.isPendingRemoval(), true);
    assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
    assert.deepEqual(sounds, [core.Sound.PICK_UP_ITEM.getId()]);
  });
}

test("an open bag takes the player's own gem (control)", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
  assert.ok(f.messages.includes(STRAIGHT_IN), JSON.stringify(f.messages));
});

test("a denied ground take cannot put a gem in the bag", async (t) => {
  const f = actor(t);
  const sounds = watchPickupSounds(t, f);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => { event.allow = false; });
  await take(f);
  assert.equal(stored(f), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("a failed gem store leaves the ground item and plays no pickup sound", async (t) => {
  const f = actor(t), pile = gemHere(t, f), sounds = watchPickupSounds(t, f), events = [];
  pickupEvents.set(f.p, events);
  const store = Storage.store.bind(Storage);
  let attempts = 0;
  t.mock.method(Storage, "store", (player, ...args) => {
    if (player === f.p) { attempts++; return 0; }
    return store(player, ...args);
  });
  await take(f);
  assert.equal(attempts, 1, "the native pickup reached the injected failed store");
  assert.equal(stored(f), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("an allowed bag pickup emits the credited ground-item event once", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(pile.isPendingRemoval(), true);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("a gem with metadata follows ordinary pickup and keeps that metadata", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  pile.getItem().setMetaValue("gem-test:marker", 17);
  await take(f);
  assert.equal(stored(f), 0);
  const held = f.inv.getValidItems().find((entry) => entry.getId() === I.UNCUT_RUBY);
  assert.equal(held?.getMetaValue("gem-test:marker"), 17);
  assert.equal(pile.isPendingRemoval(), true);
});

test("a nested pickup during the take policy cannot duplicate the gem", async (t) => {
  const f = actor(t);
  const pile = gemHere(t, f);
  const events = [];
  pickupEvents.set(f.p, events);
  let calls = 0;
  pickupPolicies.set(f.p, () => {
    calls++;
    if (calls === 1) core.ItemOnGroundManager.pickup(f.p, pile);
  });
  await take(f);
  assert.equal(calls, 1);
  assert.equal(stored(f), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("an open sack stores the player's own gem once", async (t) => {
  const f = actor(t, HOME, false);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  const pile = gemHere(t, f);
  await take(f);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_RUBY), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
  assert.ok(f.messages.includes("You put it straight into your open gem sack."), JSON.stringify(f.messages));
  assert.equal(f.messages.includes(STRAIGHT_IN), false);
});

test("an Ironman's open sack cannot take another player's gem", async (t) => {
  const f = actor(t, HOME, false);
  const sounds = watchPickupSounds(t, f);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  setIron(f);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  const sack = Storage.FAMILIES.get("gem-sack");
  assert.ok(sack);
  assert.equal(Storage.amountOf(f.p, sack, I.UNCUT_RUBY), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
  assert.deepEqual(sounds, []);
});

function sackActor(t) {
  const f = actor(t, HOME, false);
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("gem_sack_open")), true);
  return f;
}

test("ground take policy can refuse a gem for an open sack", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  const sounds = watchPickupSounds(t, f);
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => { event.allow = false; });
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), false);
  assert.deepEqual(events, []);
  assert.deepEqual(sounds, []);
});

test("sack pickup emits the credited ground-item event once", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  pickupEvents.set(f.p, events);
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 1);
  assert.equal(pile.isPendingRemoval(), true);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("metadata gem bypasses sack storage and keeps metadata", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f);
  pile.getItem().setMetaValue("gem-test:marker", 17);
  await take(f);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 0);
  const held = f.inv.getValidItems().find((entry) => entry.getId() === I.UNCUT_RUBY);
  assert.equal(held?.getMetaValue("gem-test:marker"), 17);
});

test("nested sack pickup cannot duplicate a gem", async (t) => {
  const f = sackActor(t), pile = gemHere(t, f), events = [];
  pickupEvents.set(f.p, events);
  let calls = 0;
  pickupPolicies.set(f.p, () => { calls++; if (calls === 1) core.ItemOnGroundManager.pickup(f.p, pile); });
  await take(f);
  assert.equal(calls, 1);
  assert.equal(Storage.amountOf(f.p, Storage.FAMILIES.get("gem-sack"), I.UNCUT_RUBY), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.deepEqual(events, [{ amount: 1, discarded: 0, source: "pickup" }]);
});

test("an Ironman's open bag doesn't take another player's gem, and it stays on the ground", async (t) => {
  const f = actor(t);
  const sounds = watchPickupSounds(t, f);
  setIron(f);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(stored(f), 0, "not in the bag");
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0, "not in the pack");
  assert.equal(pile.isPendingRemoval(), false, "still on the ground");
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
  assert.deepEqual(sounds, []);
});

test("an Ironman's open bag still takes their own gem (control)", async (t) => {
  const f = actor(t);
  setIron(f);
  gemHere(t, f);
  await take(f);
  assert.equal(stored(f), 1);
  assert.equal(f.messages.includes(REFUSED), false, JSON.stringify(f.messages));
});

test("a normal player's open bag takes another player's public gem (control)", async (t) => {
  const f = actor(t);
  gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(stored(f), 1);
});

test("an open looting bag and an open gem bag: the gem goes into one, once (control)", async (t) => {
  const f = actor(t, WILDERNESS);
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f);
  await take(f);
  // The gem bag's hook comes first. Which should win on live isn't known; here only once matters.
  assert.equal(stored(f), 1);
  assert.equal(f.messages.some((text) => /in your Looting bag/i.test(text)), false, JSON.stringify(f.messages));
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 0);
  assert.equal(pile.isPendingRemoval(), true);
});

test("an Ironman's open looting bag doesn't take another player's gem: the rule runs first (control)", async (t) => {
  const f = actor(t, WILDERNESS, false);
  f.p.setAttribute("ironman:mode", "ironman");
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f, "OtherPlayer");
  await take(f);
  assert.equal(f.messages.some((text) => /in your Looting bag/i.test(text)), false, JSON.stringify(f.messages));
  assert.equal(pile.isPendingRemoval(), false, "still on the ground");
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
});

test("an Ironman's open looting bag still takes their own gem (control)", async (t) => {
  const f = actor(t, WILDERNESS, false);
  f.p.setAttribute("ironman:mode", "ironman");
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), true);
  const pile = gemHere(t, f);
  await take(f);
  assert.ok(f.messages.some((text) => /in your Looting bag/i.test(text)), JSON.stringify(f.messages));
  assert.equal(pile.isPendingRemoval(), true);
});
