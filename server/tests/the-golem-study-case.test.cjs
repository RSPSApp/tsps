// Run after `yarn build`: node --test tests/the-golem-study-case.test.cjs
//
// #2559: Study on the Varrock Museum's display 30 (loc 24626). No capture opens this interface. What
// the test holds, and where it comes from:
// - Cache (Joshua-F/osrs-dumps 44e1ff8): loc 24626 is vm_timeline_terracotta_statue, a multiloc on
//   golem_retrieved_statuette, to 24627 (model 25576) and vm_timeline_no_display (model 25568), both
//   with op1 Study. Interface 534 is vm_timeline: 534:2 the text, 534:84 the number, and a model
//   component per display, 534:49 for this one and 534:35 for no display.
// - Rsprox 1723 (rev 227, tick 14869), Study on the sibling digsite display 36 (interface 528): the
//   text and number by if_settext, if_setmodel with the model of the display's own loc, script 65
//   [0, 5, 0, component], script 2524 [0, 100], if_opensub 164:16, sequence 6383, varbit 12393 on
//   opening and off on closing.
// - Wiki (Varrock Museum, displays table): the wording. How its two paragraphs are split on the
//   interface is inferred.
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

const HOME = [3222, 3218];
const CASE = 24626;
const GROUP = 534;
const RETRIEVED = "quest.the_golem.retrieved_statuette";
const uid = (child) => (GROUP << 16) | child;
const DESCRIPTION = "This statuette was found in an underground temple in the ruined city of Uzer, which was "
  + "destroyed late in the 3rd Age, suddenly, due to causes unknown. It probably represents one of the clay golems "
  + "that the craftsmen of the city built as warriors and servants. The statuette was originally part of a "
  + "mechanism whose purpose is unknown.";
const STOLEN = "Recently this display was stolen and its whereabouts are unknown.";

let core;
let I;
let next = 7200;

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
  p.setUsername("caseqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const sender = p.getPacketSender();
  const seen = { strings: new Map(), models: [], scripts: [], busy: [] };
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => { record(...args); return original(...args); });
  };
  wrap("sendString", (text, id) => seen.strings.set(id, text));
  wrap("sendInterfaceRawModel", (id, model) => seen.models.push([id, model]));
  wrap("sendClientScript", (id, ...args) => seen.scripts.push([id, ...args]));
  wrap("sendVarbit", (id, value) => { if (id === 12393) seen.busy.push(value); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, inv: p.getInventory(), seen };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function click(t, f, clickType, action) {
  const [x, y] = [HOME[0] + 1, HOME[1]];
  const object = new core.GameObject(CASE, new core.Location(x, y, 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => core.ObjectManager.deregister(object, true));
  await send(f, { type: "object_option", id: CASE, x, y, clickType, action });
  ticks(f, 3);
}

test("Study on the full case opens vm_timeline with the statuette, its number and its description", async (t) => {
  const f = actor(t);
  await click(t, f, 1, "Study");
  assert.equal(f.p.getInterfaceId(), GROUP, "interface 534 is open");
  assert.equal(f.seen.strings.get(uid(84)), "30", "display_num");
  assert.equal(f.seen.strings.get(uid(2)), `3rd Age - yr 3000-4000<br><br>${DESCRIPTION}`);
  assert.deepEqual(f.seen.models, [[uid(49), 25576]], "the statuette's own model");
  assert.ok(f.seen.scripts.some(([id, a, b, c, com]) => id === 65 && a === 0 && b === 5 && c === 0 && com === uid(49)), "it spins");
  assert.deepEqual(f.seen.busy, [1], "busy while it is open");
  assert.equal(f.inv.getAmount(I.STATUETTE), 0, "studying takes nothing");

  await send(f, { type: "interface_close" });
  assert.notEqual(f.p.getInterfaceId(), GROUP, "the generic close closes it");
  assert.deepEqual(f.seen.busy, [1, 0], "and clears busy");
});

test("the interface's own Close button (534:1, a transmit op) closes it and clears busy", async (t) => {
  const f = actor(t);
  await click(t, f, 1, "Study");
  assert.equal(f.p.getInterfaceId(), GROUP, "control: it is open");
  await send(f, { type: "widget_action", widgetId: uid(1), groupId: GROUP, childId: 1, buttonNum: 1 });
  assert.notEqual(f.p.getInterfaceId(), GROUP, "the X closes it");
  assert.deepEqual(f.seen.busy, [1, 0], "and clears busy");
});

test("Study on the empty case shows no statuette, and says it was stolen", async (t) => {
  const f = actor(t);
  f.p.setAttribute(RETRIEVED, true);
  await click(t, f, 1, "Study");
  assert.equal(f.p.getInterfaceId(), GROUP, "interface 534 is open");
  assert.equal(f.seen.strings.get(uid(2)), `3rd Age - yr 3000-4000<br><br>${DESCRIPTION}<br><br>${STOLEN}`);
  assert.deepEqual(f.seen.models, [[uid(35), 25568]], "the empty display's model");
});

test("control: Study with the key takes nothing, and Open still gives the statuette", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(I.DISPLAY_CABINET_KEY), false);
  await click(t, f, 1, "Study");
  assert.equal(f.inv.getAmount(I.STATUETTE), 0, "Study takes nothing");
  await send(f, { type: "interface_close" });
  await click(t, f, 2, "Open");
  assert.equal(f.inv.getAmount(I.STATUETTE), 1, "Open gives it");
});
