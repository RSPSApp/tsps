// Run after `yarn build`: node --test tests/pickup-containers.test.cjs
//
// Settings > Gameplay > "Rune-picking behaviour" (306) and "Ammo-picking behaviour" (305), through
// the real Take packet, every plugin's pickup hooks and the Fire Altar. The cache's row texts:
// runes picked up or made by Runecrafting "will attempt to go into your rune pouch, if it contains
// matching runes"; ammo "will attempt to equip itself to your quiver".
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
const QUIVER = "dizanas-quiver";
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

function wearQuiver(f, stored, worn = null) {
  const equipment = f.p.getEquipment();
  equipment.set(core.Equipment.CAPE_SLOT, new core.Item(I.DIZANAS_QUIVER, 1));
  if (worn) equipment.set(core.Equipment.AMMUNITION_SLOT, new core.Item(worn[0], worn[1]));
  f.p.setAttribute(QUIVER, { id: stored[0], amount: stored[1] });
}

test("ammo matching a worn Dizana's quiver goes into it", async (t) => {
  const f = actor(t, { runes: false, ammo: true });
  wearQuiver(f, [I.IRON_ARROW, 50], [I.BRONZE_ARROW, 30]);
  const ground = pile(t, f, I.IRON_ARROW, 7);
  await take(f, I.IRON_ARROW);
  assert.deepEqual(f.p.getAttribute(QUIVER), { id: I.IRON_ARROW, amount: 57 });
  assert.equal(f.inv.getAmount(I.IRON_ARROW), 0);
  assert.equal(ground.isPendingRemoval(), true);
  assert.equal(f.p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount(), 30);
});

test("ammo matching the worn ammo slot still goes there first", async (t) => {
  const f = actor(t, { runes: false, ammo: true });
  wearQuiver(f, [I.IRON_ARROW, 50], [I.IRON_ARROW, 30]);
  pile(t, f, I.IRON_ARROW, 7);
  await take(f, I.IRON_ARROW);
  assert.equal(f.p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount(), 37);
  assert.deepEqual(f.p.getAttribute(QUIVER), { id: I.IRON_ARROW, amount: 50 });
});

test("a quiver that is only carried, or the setting off, leaves the ammo to the inventory", async (t) => {
  for (const [ammo, wear] of [[true, false], [false, true]]) {
    const f = actor(t, { runes: false, ammo });
    if (wear) wearQuiver(f, [I.IRON_ARROW, 50]);
    else {
      f.inv.add(new core.Item(I.DIZANAS_QUIVER, 1), true);
      f.p.setAttribute(QUIVER, { id: I.IRON_ARROW, amount: 50 });
    }
    pile(t, f, I.IRON_ARROW, 7);
    await take(f, I.IRON_ARROW);
    assert.equal(f.inv.getAmount(I.IRON_ARROW), 7);
    assert.equal(f.p.getAttribute(QUIVER).amount, 50);
  }
});
