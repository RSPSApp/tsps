// Run after `yarn build`: node --test tests/ring-of-endurance-unequip.test.cjs
//
// Wiki (Ring of endurance): a doubled stamina effect "is immediately halved if the ring is unequipped".
// Native fixture: every plugin loaded, a real Player, and the client's packets through
// ClientConnection.dispatch: Drink from the inventory, Remove from the worn tab, Wear to put it back.
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
const CHARGES = "ring-of-endurance";
/** The worn tab (387): the ring slot's Remove. */
const WORN_RING = { groupId: 387, childId: 24 };
const MINUTE = 60_000;

let core;
let I;
let next = 6100;

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

function actor(t, { ring = true } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("endurance" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  // The ring is worn from 70 Agility (its equip requirement).
  p.getSkillManager().setMaxLevels(core.Skill.AGILITY, 99, false).setCurrentLevels(core.Skill.AGILITY, 99, false);
  const c = new ClientConnection(channel);
  c.player = p;
  const worn = new core.Item(I.RING_OF_ENDURANCE, 1);
  worn.setMetaValue(CHARGES, 100);
  if (ring) p.getEquipment().setItem(core.Equipment.RING_SLOT, worn);
  p.getInventory().setItem(0, new core.Item(I.STAMINA_POTION_4_, 1));
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  core.TaskManager.process();
}

const drink = (f) => send(f, { type: "inventory_action", slot: f.p.getInventory().getSlotForItemId(I.STAMINA_POTION_4_), itemId: I.STAMINA_POTION_4_, widgetId: 3214, option: "Drink" });
const remove = (f) => send(f, { type: "widget_action", widgetId: (WORN_RING.groupId << 16) | WORN_RING.childId, ...WORN_RING, slot: -1, buttonNum: 1 });
async function wear(f, id) {
  const slot = f.p.getInventory().getSlotForItemId(id);
  const ring = f.p.getInventory().getItems()[slot];
  await send(f, { type: "inventory_action", slot, itemId: id, widgetId: 3214, option: "Wear" });
  assert.equal(f.p.getEquipment().get(core.Equipment.RING_SLOT).getMetaValue(CHARGES), ring.getMetaValue(CHARGES), "the ring is worn");
}
const left = (f) => Number(f.p.getAttribute("potions:stamina:end")) - Date.now();
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 5_000, `${what}: about ${expected} ms, got ${actual}`);

test("taking the ring off halves what is left of the effect it doubled", async (t) => {
  const f = actor(t);
  await drink(f);
  near(left(f), 4 * MINUTE, "doubled to four minutes");
  await remove(f);
  assert.equal(f.p.getEquipment().get(core.Equipment.RING_SLOT).getId(), -1, "the ring came off");
  near(left(f), 2 * MINUTE, "halved on removal");

  await wear(f, I.RING_OF_ENDURANCE);
  near(left(f), 2 * MINUTE, "putting it back on doesn't double it again");
  await remove(f);
  near(left(f), 2 * MINUTE, "nor does a second removal halve it again");
});

test("an effect drunk without the ring isn't touched when a ring comes off", async (t) => {
  const f = actor(t, { ring: false });
  await drink(f);
  near(left(f), 2 * MINUTE, "not doubled");
  const ring = new core.Item(I.RING_OF_ENDURANCE, 1);
  ring.setMetaValue(CHARGES, 100);
  f.p.getInventory().setItem(5, ring);
  await wear(f, I.RING_OF_ENDURANCE);
  await remove(f);
  near(left(f), 2 * MINUTE, "unchanged");
});

// #4865 review: the Egniol potion's stamina effect replaces the doubled one, so taking the ring off leaves it alone.
test("an Egniol potion drunk over the doubled effect isn't halved when the ring comes off", async (t) => {
  const f = actor(t);
  await drink(f);
  near(left(f), 4 * MINUTE, "doubled to four minutes");
  f.p.getInventory().setItem(6, new core.Item(I.EGNIOL_POTION_4_, 1));
  f.p.getTimers().cancel(require("../dist/util/timers/TimerKey").TimerKey.POTION); // the 3-tick delay between drinks
  await send(f, { type: "inventory_action", slot: 6, itemId: I.EGNIOL_POTION_4_, widgetId: 3214, option: "Drink" });
  near(left(f), 2 * MINUTE, "the Egniol potion's own, undoubled effect");
  assert.equal(f.p.getAttribute("ring-of-endurance:doubled"), null, "the ring forgets the effect it doubled");
  await remove(f);
  assert.equal(f.p.getEquipment().get(core.Equipment.RING_SLOT).getId(), -1, "the ring came off");
  near(left(f), 2 * MINUTE, "not halved");
});

test("a ring that runs out on the dose stays worn and keeps the doubled effect", async (t) => {
  const f = actor(t);
  f.p.getEquipment().get(core.Equipment.RING_SLOT).setMetaValue(CHARGES, 1);
  await drink(f);
  assert.equal(f.p.getEquipment().get(core.Equipment.RING_SLOT).getId(), I.RING_OF_ENDURANCE_UNCHARGED_);
  near(left(f), 4 * MINUTE, "still doubled");
  await remove(f);
  near(left(f), 2 * MINUTE, "halved once it comes off");
});

test("putting a second ring of endurance on over it halves the effect too", async (t) => {
  const f = actor(t);
  await drink(f);
  near(left(f), 4 * MINUTE, "doubled");
  const second = new core.Item(I.RING_OF_ENDURANCE, 1);
  second.setMetaValue(CHARGES, 50);
  f.p.getInventory().setItem(5, second);
  await wear(f, I.RING_OF_ENDURANCE);
  near(left(f), 2 * MINUTE, "halved: the ring that doubled it came off");
  const first = f.p.getInventory().getItems().find((item) => item?.getId?.() === I.RING_OF_ENDURANCE);
  assert.equal(first.getMetaValue(CHARGES), 99, "the first ring went back to the inventory");
  assert.equal(first.getMetaValue("ring-of-endurance:doubled"), undefined, "and keeps no stale mark");
});
