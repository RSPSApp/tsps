// Run after `yarn build`: node --test tests/stash-noticeboard.test.cjs
// The STASH noticeboard in Watson's house (hidey_hole_noticeboard, Read) opens the hidey_holes chart as live
// does (rsprox.net rec 2804, rev 229, tick 5140): hh_inv (576) in full with each filled enum-1525 unit's
// items in its slot range, toplevel_mainmodal_open, hidey_holes (493) in the main modal, then hidey_build
// (1475) with the three filled bitmasks of the enum-1440 units. Real engine: every plugin loaded, a real
// Player and its PacketSender, the cache enums, and the board's own interaction handler as Stash registers it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let C;
let next = 9870;
let handlers = [];
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  C = core.CacheDefinitions;
  PM.emitServerStartup({});
  const real = PM.createApi("StashNoticeboardTest");
  Stash(new Proxy(real, { get: (target, key) => (key === "onBeforeObjectInteraction" ? (handler) => { handlers.push(handler); } : target[key]) }));
});
after(() => PM.emitServerShutdown({}));

const xz = (coord) => [(coord >> 14) & 0x3fff, coord & 0x3fff];

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("board" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(1644, 3576, 0));
  p.needsPlacement = false;
  const sent = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendInventory", (inventoryId, capacity, items, owner) => { sent.push({ inventory: inventoryId, capacity, items: [...items], owner }); return sender; });
  t.mock.method(sender, "sendInterfaceScript", (script, args) => { sent.push({ script, args }); return sender; });
  t.mock.method(sender, "sendInterface", (id) => { sent.push({ modal: id }); return sender; });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, sent };
}

function read(f, objectId = C.getLocId("hidey_hole_noticeboard")) {
  const event = { player: f.p, objectId, option: "Read", handled: false };
  for (const handler of handlers) handler(event);
  return event;
}

test("an empty chart: hh_inv, then mainmodal_open, the board and hidey_build, in live's order", (t) => {
  const f = actor(t);
  const event = read(f);
  assert.equal(event.handled, true);
  const capacity = Math.max(...[...C.getEnumValues(1525).values()].map((coord) => xz(Number(coord))[1])) + 1;
  assert.equal(f.sent.length, 4);
  assert.deepEqual({ ...f.sent[0], items: undefined }, { inventory: 576, capacity, items: undefined, owner: 493 });
  assert.equal(f.sent[0].items.filter(Boolean).length, 0);
  assert.deepEqual(f.sent.slice(1), [{ script: 2524, args: [-1, -1] }, { modal: 493 }, { script: 1475, args: [0, 0, 0] }]);
});

test("filled units: enum 1525 units put their items in their hh_inv slots, enum 1440 units set their bits", (t) => {
  const f = actor(t);
  const slotUnits = C.getEnumValues(1525);
  // The capture's first unit (28990, slots 0..2): mithril med helm, green d'hide chaps, ring of dueling(8).
  assert.deepEqual(xz(Number(slotUnits.get(28990))), [0, 2]);
  const bitUnits = [...C.getEnumValues(1440)];
  // Rec 2804's arguments: word 1 bits 29 and 31, word 2 bits 3, 7, 8, 9, 10 and 12.
  const wanted = [[1, 29], [1, 31], [2, 3], [2, 7], [2, 8], [2, 9], [2, 10], [2, 12]];
  const filled = { 28990: [1143, 1099, 2552] };
  for (const [word, bit] of wanted) {
    const entry = bitUnits.find(([, coord]) => { const [x, z] = xz(Number(coord)); return x === word && z === bit; });
    assert.ok(entry, `an enum 1440 unit on word ${word} bit ${bit}`);
    filled[entry[0]] = [995];
  }
  f.p.setAttribute(Stash.STORED_ATTRIBUTE, filled);
  read(f);
  const inv = f.sent[0].items;
  assert.deepEqual(inv.slice(0, 3).map((slot) => slot?.id), [1143, 1099, 2552]);
  assert.equal(inv.filter(Boolean).length, 3);
  assert.deepEqual(f.sent.at(-1), { script: 1475, args: [-1610612736, 6024, 0] });
});

test("an emptied unit (stored list cleared) charts as not filled", (t) => {
  const f = actor(t);
  f.p.setAttribute(Stash.STORED_ATTRIBUTE, { 28990: [] });
  read(f);
  assert.equal(f.sent[0].items.filter(Boolean).length, 0);
});

test("each enum 1525 unit charts filled in its own slot range, never spilling into the next unit's", (t) => {
  const units = Stash.stashes();
  for (const [locId, coord] of C.getEnumValues(1525)) {
    const unit = units.get(locId);
    if (!unit) continue;
    const f = actor(t);
    const outfit = unit.step.equipment.filter((requirement) => requirement.emptySlot == null).map((_, index) => 1000 + index);
    f.p.setAttribute(Stash.STORED_ATTRIBUTE, { [locId]: outfit });
    read(f);
    const [first, last] = xz(Number(coord));
    const used = f.sent[0].items.map((slot, index) => (slot ? index : -1)).filter((index) => index >= 0);
    assert.ok(used.length > 0 && used[0] === first, `unit ${locId} fills slot ${first}`);
    assert.ok(used.every((index) => index >= first && index <= last), `unit ${locId} stays in ${first}..${last}`);
  }
});

test("every unit's built varbit is the hh_constructed bit the chart reads (enum 1368)", () => {
  const tiers = ["easy", "medium", "hard", "elite", "master", "beginner"];
  for (const [locId, unit] of Stash.stashes()) {
    const coord = C.getEnumValues(1368).get(locId);
    assert.ok(coord != null, `unit ${locId} is charted`);
    const [tier, bit] = xz(Number(coord));
    const varbit = C.getVarbit(unit.varbit);
    assert.equal(varbit.baseVar, C.getVarpId(`hh_constructed_${tiers[tier - 1]}`), `unit ${locId}`);
    assert.equal(varbit.startBit, bit);
    assert.equal(varbit.endBit, bit);
  }
});

test("other locs are left alone", (t) => {
  const f = actor(t);
  const event = read(f, C.getLocId("hidey_hole_noticeboard") + 1);
  assert.equal(event.handled, false);
  assert.equal(f.sent.length, 0);
});
