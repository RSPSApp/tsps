// Varrock Museum wall maps: Look-at opens vm_museum_map with live's packets, the stairs switch
// floors a tick later, and closing it clears busy and the ponder pose.
// From server/: node --test tests/museum-map.test.cjs
//
// Recorded in rsprox 1757 (ticks 10075-10088), 1723 (ticks 14929-14969), local 1000153 (ticks
// 1995-2022) and local 1000808 (ticks 593-601), rev 227-228. The empty exhibits below are the
// ones each recording marked, for that recording's display varbits.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");

let core;
const events = new Map();
const hooks = { buttons: new Map() };

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onCustomEvent: (name, fn) => { (events.get(name) ?? events.set(name, []).get(name)).push(fn); },
    onObjectInteraction: (name, actions) => { (hooks[name] ??= []).push(actions); },
    onInterfaceActionButton: (uid, fn) => hooks.buttons.set(uid, fn),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/world/Museum.plugin").register(api);
});

const defs = () => core.CacheDefinitions;
const component = (name) => defs().getComponentId(`vm_museum_map:${name}`);
const MAP_INTERFACE = 527;
const EMPTY = "Empty<br>display";

function player(t, varbits = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const p = new Player(null);
  p.out = [];
  p.anims = [];
  const sender = p.getPacketSender();
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, "performAnimation", (a) => p.anims.push(a.getId()));
  for (const [name, value] of Object.entries(varbits)) sender.sendVarbit(defs().getVarbitId(name), value);
  t.mock.method(sender, "sendVarbit", (id, v) => { p.out.push(["varbit", id, v]); return sender; });
  t.mock.method(sender, "sendInterfaceDisplayState", (uid, hide) => { p.out.push(["hide", uid & 0xffff, hide]); return sender; });
  t.mock.method(sender, "sendString", (text, uid) => { p.out.push(["text", uid & 0xffff, text]); return sender; });
  t.mock.method(sender, "sendInterfaceScript", (id, args) => { p.out.push(["script", id, args]); return sender; });
  t.mock.method(sender, "sendInterface", (id) => { p.out.push(["open", id]); return sender; });
  t.mock.method(sender, "sendInterfaceRemoval", () => { p.out.push(["close"]); return sender; });
  return p;
}

function lookAt(p, gameval = "vm_museum_wallmounted_map_03") {
  const objectId = defs().getLocId(gameval);
  for (const actions of hooks.Map) {
    if (actions["Look-at"]({ player: p, objectId })) return true;
  }
  return false;
}

const emptyOf = (p) => p.out.filter(([kind, , text]) => kind === "text" && text === EMPTY).map(([, child]) => child);

test("Look-at sends busy, the ponder pose, the Dig Site floor, the empty exhibits, then the modal", (t) => {
  // rsprox 1757 tick 10075: the symbols, the Senntisten coin and Excalibur are filled.
  const p = player(t, {
    vm_digsite_symbol_anc: 1, vm_digsite_symbol_old: 1, vm_digsite_coin_senn: 1, vm_excalibur: 1,
  });
  assert.equal(lookAt(p), true);
  assert.deepEqual(p.anims, [defs().getSeqId("vm_display_case_ponder")]);
  assert.deepEqual(p.out[0], ["varbit", defs().getVarbitId("busy"), 1]);
  assert.deepEqual(p.out.slice(1, 5), [["hide", 196, true], ["hide", 39, false], ["hide", 114, true], ["hide", 151, true]]);
  // 1757's own set, in live's order: Saranthium coin, tablet, talisman, staff, knights' helms,
  // observatory, Robert the Strong, Surok's tomb.
  assert.deepEqual(emptyOf(p), [7, 25, 28, 67, 83, 97, 79, 150]);
  assert.deepEqual(p.out.at(-2), ["script", 2524, [12632226, 150]]);
  assert.deepEqual(p.out.at(-1), ["open", MAP_INTERFACE]);
});

test("each recording's empty exhibits follow its display varbits", (t) => {
  // 1723 tick 14929: only the Senntisten coin is filled.
  let p = player(t, { vm_digsite_coin_senn: 1 });
  lookAt(p, "vm_museum_wallmounted_map_01");
  assert.deepEqual(emptyOf(p), [7, 19, 22, 25, 28, 67, 83, 97, 79, 150, 124]);
  // local 1000153 tick 1995: the ancient symbol and the Saranthium coin.
  p = player(t, { vm_digsite_symbol_anc: 1, vm_digsite_coin_sara: 1 });
  lookAt(p, "vm_museum_wallmounted_map_02");
  assert.deepEqual(emptyOf(p), [10, 22, 25, 28, 67, 83, 97, 79, 150, 124]);
  // local 1000808 tick 593: everything but the observatory, with The Golem's statuette taken.
  p = player(t, {
    vm_digsite_coin_sara: 1, vm_digsite_coin_senn: 1, vm_digsite_symbol_anc: 1, vm_digsite_symbol_old: 1,
    vm_digsite_tablet: 1, vm_digsite_talisman: 1, vm_staff_of_armadyl: 1, vm_salveknights: 2,
    vm_robert: 1, vm_surok: 1, vm_excalibur: 1, golem_retrieved_statuette: 1,
  });
  lookAt(p);
  assert.deepEqual(emptyOf(p), [97, 71]);
});

test("other locs named Map are left to their own handlers", (t) => {
  const p = player(t);
  for (const actions of hooks.Map) {
    assert.equal(actions["Look-at"]({ player: p, objectId: defs().getLocId("vm_museum_wallmounted_map_03") + 100 }), false);
  }
  assert.deepEqual(p.out, []);
});

test("the stairs show their floor on the next tick", async (t) => {
  const p = player(t);
  lookAt(p);
  p.out.length = 0;
  // rsprox 1757 tick 10085 -> 10086: lvl0_level_up.
  assert.equal(hooks.buttons.get(component("lvl0_level_up"))({ player: p, buttonId: component("lvl0_level_up") }), true);
  assert.deepEqual(p.out, []);
  TaskManager.process();
  assert.deepEqual(p.out, [["hide", 39, true], ["hide", 114, false], ["hide", 151, true], ["hide", 196, true]]);
  p.out.length = 0;
  const down = component("lvl0_level_down_1");
  hooks.buttons.get(down)({ player: p, buttonId: down });
  TaskManager.process();
  assert.deepEqual(p.out, [["hide", 39, true], ["hide", 114, true], ["hide", 151, true], ["hide", 196, false]]);
});

test("a stairs button does nothing with the map closed", (t) => {
  const p = player(t);
  const up = component("lvl0_level_up_1");
  assert.equal(hooks.buttons.get(up)({ player: p, buttonId: up }), false);
  TaskManager.process();
  assert.deepEqual(p.out, []);
});

test("Close closes it; any close clears busy and the pose", (t) => {
  const p = player(t);
  lookAt(p);
  p.out.length = 0;
  p.anims.length = 0;
  const close = component("vm_map_close");
  assert.equal(hooks.buttons.get(close)({ player: p, buttonId: close }), true);
  assert.deepEqual(p.out, [["close"]]);
  for (const fn of events.get("interface:closed")) fn({ player: p, interfaceId: MAP_INTERFACE });
  assert.deepEqual(p.out.slice(1), [["varbit", defs().getVarbitId("busy"), 0]]);
  assert.deepEqual(p.anims, [-1]);
  // A second close event (another interface) leaves it alone.
  for (const fn of events.get("interface:closed")) fn({ player: p, interfaceId: MAP_INTERFACE });
  assert.equal(p.out.length, 2);
});
