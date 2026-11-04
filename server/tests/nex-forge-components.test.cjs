// Run after `yarn build`: node --test tests/nex-forge-components.test.cjs
//
// The Ancient Forge: rec 819 shows the armour and its components change in one inventory update,
// three ticks after Yes, so nothing can be lost in between. The forge's click goes through the real
// object hook, and the answer and item changes through ClientConnection.dispatch; the logout is a
// test helper, not the world's logout path. A native fixture.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

const FORGE = 42966;
const HOME = [3222, 3218];
const WORN_HEAD = 15;
const YES = 1;
const MELT_TICKS = 3;
const NO_ROOM = "You require more inventory space to do that.";

let core;
let I;
let next = 4400;

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

function actor(t, armourId = I.BANDOS_CHESTPLATE) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("forgeqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 99, false).setCurrentLevels(core.Skill.DEFENCE, 99, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  let loggedOut = false;
  const logOut = () => {
    if (loggedOut) return;
    loggedOut = true;
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  };
  t.after(() => {
    logOut();
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const f = { p, c, inv: p.getInventory(), messages, armourId, logOut };
  f.inv.setItem(0, new core.Item(armourId, 1));
  return f;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

/** The forge's first option through the real object hook; the walk to it isn't what's under test. */
function clickForge(f) {
  const location = new core.Location(f.p.getLocation().getX() + 1, f.p.getLocation().getY(), 0);
  const object = new core.GameObject(FORGE, location, 10, 0, null);
  const handled = PM.emitObjectInteraction({
    player: f.p, object, objectId: FORGE, clickType: 1, option: "use",
    location: { x: location.getX(), y: location.getY(), z: 0 },
    sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z: 0 },
    handled: false,
  });
  assert.ok(handled, "the forge's hook took the click");
}

function useForge(f) {
  clickForge(f);
  assert.ok(core.MultiChatboxPrompt.getPending(f.p), "the prompt is open");
}

const answerYes = (f) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: YES,
});

async function melt(f) {
  useForge(f);
  await answerYes(f);
}

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

function floor(f, id) {
  const found = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), f.p.getPrivateArea?.());
  return found ? found.getItem().getAmount() : 0;
}

function state(f) {
  const armourWorn = f.p.getEquipment().getItems()[core.Equipment.BODY_SLOT]?.getId() === f.armourId ? 1 : 0;
  return {
    armour: f.inv.getAmount(f.armourId) + floor(f, f.armourId) + armourWorn,
    components: f.inv.getAmount(I.BANDOSIAN_COMPONENTS) + floor(f, I.BANDOSIAN_COMPONENTS),
  };
}

function fillTo(f, freeSlots) {
  while (f.inv.getFreeSlots() > freeSlots) f.inv.add(new core.Item(I.RAKE, 1), false);
  f.inv.refreshItems();
  assert.equal(f.inv.getFreeSlots(), freeSlots);
}

test("the armour stays until the components come, in the same tick, as rec 819 shows", async (t) => {
  const f = actor(t);
  await melt(f);
  assert.deepEqual(state(f), { armour: 1, components: 0 }, "nothing changes at Yes");
  assert.ok(f.messages.includes("You use the forge to melt the armour down into some components."));
  ticks(MELT_TICKS - 1);
  assert.deepEqual(state(f), { armour: 1, components: 0 }, "nor before the third tick");
  ticks(1);
  assert.deepEqual(state(f), { armour: 0, components: 3 });
});

test("tassets melt the same way, into two", async (t) => {
  const f = actor(t, I.BANDOS_TASSETS);
  await melt(f);
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 0, components: 2 });
});

test("the inventory filling after Yes keeps the armour and loses no component", async (t) => {
  const control = actor(t);
  control.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.RUNE_FULL_HELM, 1));
  fillTo(control, 2);
  await melt(control);
  ticks(MELT_TICKS);
  assert.deepEqual(state(control), { armour: 0, components: 3 }, "control: exactly enough room");

  const f = actor(t);
  f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.RUNE_FULL_HELM, 1));
  fillTo(f, 2);
  await melt(f);
  const widgetId = (387 << 16) | WORN_HEAD;
  await send(f, { type: "widget_action", widgetId, groupId: 387, childId: WORN_HEAD, buttonNum: 1 });
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), -1, "the helm came off into the inventory");
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 1, components: 0 });
  assert.equal(f.messages.at(-1), NO_ROOM);
});

test("too little room refuses at the click with no prompt, as rec 819 cycle 10153 shows", async (t) => {
  const enough = actor(t);
  fillTo(enough, 2);
  useForge(enough);

  const tassets = actor(t, I.BANDOS_TASSETS);
  fillTo(tassets, 1);
  useForge(tassets);

  const f = actor(t);
  fillTo(f, 1);
  clickForge(f);
  assert.equal(core.MultiChatboxPrompt.getPending(f.p), null, "no prompt");
  assert.equal(f.messages.at(-1), NO_ROOM);
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 1, components: 0 });
});

test("logging out after Yes keeps the armour", async (t) => {
  const f = actor(t);
  await melt(f);
  f.logOut();
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 1, components: 0 });
});

test("armour wielded after Yes isn't melted, and nothing is made", async (t) => {
  const f = actor(t);
  await melt(f);
  await send(f, { type: "inventory_action", slot: 0, itemId: f.armourId, widgetId: 3214, option: "Wear" });
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.BODY_SLOT].getId(), f.armourId, "it was worn");
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 1, components: 0 });
});

test("melting one chestplate twice in the window makes one set of components", async (t) => {
  const f = actor(t);
  await melt(f);
  ticks(1);
  await melt(f);
  ticks(MELT_TICKS);
  assert.deepEqual(state(f), { armour: 0, components: 3 });
});
