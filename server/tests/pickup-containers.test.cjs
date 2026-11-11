// Run after `yarn build`: node --test tests/pickup-containers.test.cjs
//
// Settings > Gameplay > "Rune-picking behaviour" (306), through the real Take packet, every
// plugin's pickup hooks and the Fire Altar. The cache's row text: runes picked up or made by
// Runecrafting "will attempt to go into your rune pouch, if it contains matching runes".
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

const HOME = [3222, 3218];
const RUNES = "rune-pouch:runes";
const REFUSED = "You're an Ironman, so you can't take items that other players have dropped.";

let core;
let I;
let next = 9900;
const taken = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  PM.createApi("PickupContainersTest").onCustomEvent("ground-items:taken", (event) => taken.get(event.player)?.push(event.amount));
});
after(() => PM.emitServerShutdown({}));

function actor(t, { runes = true, ammo = false } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("pickc" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  if (runes) PM.emitCustomEvent("settings:set", { player: p, settingId: 306, value: 1 });
  if (ammo) PM.emitCustomEvent("settings:set", { player: p, settingId: 305, value: 1 });
  const events = [];
  taken.set(p, events);
  return { p, c, inv: p.getInventory(), messages, events };
}

function pile(t, f, itemId, amount, owner = null) {
  const ground = core.ItemOnGroundManager.registers(f.p, new core.Item(itemId, amount));
  if (owner) {
    ground.owner = owner;
    ground.setState(State.SEEN_BY_EVERYONE);
  }
  t.after(() => { if (!ground.isPendingRemoval()) core.ItemOnGroundManager.deregister(ground); });
  return ground;
}

async function take(f, itemId) {
  const at = f.p.getLocation();
  await f.c.dispatch([{ type: "ground_item_action", itemId, x: at.getX(), y: at.getY(), option: "Take" }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 4; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

function withPouch(f, slots) {
  f.inv.add(new core.Item(I.RUNE_POUCH, 1), true);
  f.p.setAttribute(RUNES, slots);
}

const pouchAmount = (f, runeId) => (f.p.getAttribute(RUNES) ?? []).reduce((sum, slot) => sum + (slot?.[0] === runeId ? slot[1] : 0), 0);

test("row 306 is a toggle on take_runes_toggle, off by default, and the setting sets it", (t) => {
  const settings = require("../plugins/interface/data/settings.json").settings;
  assert.deepEqual(settings[306], { name: "Rune-picking behaviour", varbit: core.CacheDefinitions.getVarbitId("take_runes_toggle") });
  const f = actor(t);
  assert.equal(f.p.getPacketSender().getVarbit(5698), 1);
});

test("picked-up runes go into a pouch slot that already holds them", async (t) => {
  const f = actor(t);
  withPouch(f, [[I.AIR_RUNE, 100], [I.LAW_RUNE, 5], null, null]);
  const ground = pile(t, f, I.AIR_RUNE, 25);
  await take(f, I.AIR_RUNE);
  assert.equal(pouchAmount(f, I.AIR_RUNE), 125);
  assert.equal(f.inv.getAmount(I.AIR_RUNE), 0);
  assert.equal(ground.isPendingRemoval(), true);
  assert.deepEqual(f.events, [25], "the pickup is reported once, as an ordinary pickup is");
});

test("runes the pouch doesn't already hold go to the inventory, even with an empty slot", async (t) => {
  const f = actor(t);
  withPouch(f, [[I.AIR_RUNE, 100], null, null, null]);
  pile(t, f, I.FIRE_RUNE, 25);
  await take(f, I.FIRE_RUNE);
  assert.equal(pouchAmount(f, I.FIRE_RUNE), 0);
  assert.equal(f.inv.getAmount(I.FIRE_RUNE), 25);
});

test("a stack that would overfill the pouch slot goes to the inventory whole", async (t) => {
  const f = actor(t);
  withPouch(f, [[I.AIR_RUNE, 15990], null, null, null]);
  pile(t, f, I.AIR_RUNE, 25);
  await take(f, I.AIR_RUNE);
  assert.equal(pouchAmount(f, I.AIR_RUNE), 15990);
  assert.equal(f.inv.getAmount(I.AIR_RUNE), 25);
});

test("with the setting off, picked-up runes go to the inventory", async (t) => {
  const f = actor(t, { runes: false });
  withPouch(f, [[I.AIR_RUNE, 100], null, null, null]);
  pile(t, f, I.AIR_RUNE, 25);
  await take(f, I.AIR_RUNE);
  assert.equal(pouchAmount(f, I.AIR_RUNE), 100);
  assert.equal(f.inv.getAmount(I.AIR_RUNE), 25);
});

test("an Ironman still can't take another player's runes into the pouch", async (t) => {
  const f = actor(t);
  f.p.setAttribute("ironman:mode", "ironman");
  withPouch(f, [[I.AIR_RUNE, 100], null, null, null]);
  const ground = pile(t, f, I.AIR_RUNE, 25, "someoneelse");
  await take(f, I.AIR_RUNE);
  assert.equal(pouchAmount(f, I.AIR_RUNE), 100);
  assert.equal(f.inv.getAmount(I.AIR_RUNE), 0);
  assert.equal(ground.isPendingRemoval(), false);
  assert.ok(f.messages.includes(REFUSED), JSON.stringify(f.messages));
});

function craftFire(f) {
  f.p.getSkillManager().setCurrentLevels(core.Skill.RUNECRAFTING, 14);
  const objectId = core.ObjectIdentifiers.ALTAR_37;
  const object = new core.GameObject(objectId, f.p.getLocation(), 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(objectId, f.p);
  const at = f.p.getLocation();
  return PM.emitObjectInteraction({
    player: f.p, object, objectId, definition, clickType: 1, option: "Craft-rune",
    location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false,
  });
}

test("runes crafted at an altar go into a pouch slot that holds them", (t) => {
  const f = actor(t);
  withPouch(f, [[I.FIRE_RUNE, 10], null, null, null]);
  f.inv.add(new core.Item(I.PURE_ESSENCE, 5), true);
  assert.equal(craftFire(f), true);
  assert.equal(f.inv.getAmount(I.PURE_ESSENCE), 0);
  assert.equal(f.inv.getAmount(I.FIRE_RUNE), 0);
  assert.equal(pouchAmount(f, I.FIRE_RUNE), 15);
});

test("crafted runes stay in the inventory with the setting off or without that rune in the pouch", (t) => {
  for (const [runes, slots] of [[false, [[I.FIRE_RUNE, 10], null, null, null]], [true, [[I.AIR_RUNE, 10], null, null, null]]]) {
    const f = actor(t, { runes });
    withPouch(f, slots);
    f.inv.add(new core.Item(I.PURE_ESSENCE, 5), true);
    craftFire(f);
    assert.equal(f.inv.getAmount(I.FIRE_RUNE), 5);
  }
});
