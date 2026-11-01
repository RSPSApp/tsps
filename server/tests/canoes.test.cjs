// After yarn build: node --test tests/canoes.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Skill } = require("../dist/game/model/Skill");
const { Animation } = require("../dist/game/model/Animation");
const { Location } = require("../dist/game/model/Location");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { Item } = require("../dist/game/model/Item");
const plugin = require("../plugins/world/Canoes.plugin");
const { stations, TYPES, CHOP_DELAY_TICKS } = plugin._test;
const spawned = [];
const axe = { id: 1359, requiredLevel: 41, tier: 6, animationId: 867 };
const tasks = [];
const events = [];
let members = true;
let tick = 0;
class CountdownTask {
  constructor(key, ticks, run) { Object.assign(this, { key, due: tick + ticks, run }); }
}
class PrivateArea {
  enter(player) { player.area = this; }
  add() {}
  leave(player) { player.area = null; }
  postLeave() {}
}
function advance(ticks) {
  for (let n = 0; n < ticks; n++) {
    tick++;
    for (const task of [...tasks]) if (task.due <= tick && tasks.includes(task)) {
      tasks.splice(tasks.indexOf(task), 1);
      task.run();
    }
  }
}
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  plugin.register({
    core: {
      CacheDefinitions, Skill, Animation, Location, GameObject, CountdownTask, PrivateArea, Item,
      DialogueChainBuilder: class { add() { return this; } }, NpcDialogue: class {},
      Boundary: class {},
      TaskManager: { submit: (task) => tasks.push(task), cancelTasks: (key) => { for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].key === key) tasks.splice(i, 1); } },
      WorldDefinition: { isMembersWorld: () => members },
    },
    persistAttribute() {}, onObjectInteraction() {}, onNpcsInteraction() {}, onNpcDialogueCondition() {}, onInterfaceActionClick() {}, onCustomEvent() {}, onPlayerLogin() {}, onPlayerLogout() {},
    spawnNpc: (spawn) => {
      const npc = { spawn, flags: new Set(), steps: [], getMovementQueue: () => ({ addSteps: (at) => npc.steps.push(at) }), setFlag: (flag) => npc.flags.add(flag), isRegistered: () => false };
      spawned.push(npc);
      return npc;
    },
    removeNpc() {},
    emitCustomEvent: (name, event) => {
      if (name === "woodcutting:axe") event.axe = (event.itemId ? event.itemId === axe.id : event.player.hasAxe) ? axe : null;
      else events.push({ name, ...event });
    },
  });
});
function player(station = stations[0], woodcutting = 99) {
  const attrs = new Map();
  const vars = new Map();
  const p = {
    hasAxe: true, location: new Location(...station.tree, 0), messages: [], xp: 0, interfaceId: -1, blocked: false, animation: -1,
    getAttribute: (key, fallback) => attrs.has(key) ? attrs.get(key) : fallback,
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => p.location, moveTo: (at) => { p.location = at; },
    getArea: () => p.area,
    setUntargetable() {}, setPositionToFace() {},
    setInterfaceId: (id) => { p.interfaceId = id; }, getInterfaceId: () => p.interfaceId,
    sendMessage: (text) => p.messages.push(text), isRegistered: () => true, getHitpoints: () => 99,
    performAnimation: (animation) => { p.animation = animation.getId(); },
    getMovementQueue: () => movement,
    getSkillManager: () => ({ getCurrentLevel: () => woodcutting, addExperience: (skill, xp) => { p.xp += xp; } }),
    getPacketSender: () => sender,
  };
  const movement = { reset: () => movement, setBlockMovement: (value) => { p.blocked = value; return movement; } };
  const sender = new Proxy({ sendVarbit: (id, value) => vars.set(id, value), getVarbit: (id) => vars.get(id) ?? 0 }, { get: (o, key) => o[key] ?? (() => sender) });
  return p;
}
function object(station) {
  return new GameObject(CacheDefinitions.getLocId(station.loc), new Location(...station.tree, 0), 10, 3);
}
function choose(p, group, child) { plugin._test.select({ player: p, buttonId: (group << 16) | child, opId: 1 }); }
function make(p, station, type) {
  const oldRandom = Math.random;
  Math.random = () => 0;
  try {
    plugin._test.chop({ player: p, object: object(station) }); advance(CHOP_DELAY_TICKS + 2);
    plugin._test.shape({ player: p, object: object(station) }); choose(p, 416, type.button); advance(4);
    plugin._test.float({ player: p, object: object(station) }); advance(2);
  } finally { Math.random = oldRandom; }
}

test("cache station transforms, native interfaces and every axe carving animation exist", () => {
  for (const s of stations.filter((s) => s.tree)) {
    const definition = CacheDefinitions.getObject(CacheDefinitions.getLocId(s.loc));
    assert.equal(definition.transformVarbit, CacheDefinitions.getVarbitId(s.state));
    assert.equal(CacheDefinitions.getObject(definition.transforms[10]).actions[0], "Shape-Canoe");
    assert.equal(CacheDefinitions.getObject(definition.transforms[14]).actions[0], "Paddle Canoe");
  }
  assert.equal(CacheDefinitions.getInterfaceId("canoe_map_lum"), 953);
  assert.equal(CacheDefinitions.getInterfaceId("canoe_map_dougne"), 952);
  for (const a of require("../plugins/skills/Woodcutting.plugin").AXES) {
    const name = CacheDefinitions.getSeqName(a.animationId)?.replace("woodcutting", "canoeing_carve");
    assert.ok(CacheDefinitions.getSeqId(name) != null, `${a.id}: ${name}`);
  }
});

test("all route pairs enforce distance, separate rivers and Waka-only Wilderness destinations", () => {
  for (const from of stations.filter((s) => s.tree)) for (const to of stations) for (const type of TYPES) {
    const expected = from.id !== to.id && from.river === to.river && (type.id === 4 || (to.id !== 0 && to.id !== 5 && Math.abs(from.id - to.id) <= type.id));
    assert.equal(plugin._test.canTravel(from, to, type), expected, `${from.id}>${to.id}, ${type.id}`);
  }
  assert.equal(plugin._test.canTravel(stations[4], stations[3], TYPES[0]), true, "a log can leave Ferox for Edgeville");
});

test("level, axe and membership requirements stop construction without state changes", () => {
  for (const [woodcutting, hasAxe] of [[11, true], [99, false]]) {
    const p = player(stations[0], woodcutting); p.hasAxe = hasAxe;
    plugin._test.chop({ player: p, object: object(stations[0]) });
    assert.equal(plugin._test.state(p, stations[0]), 0); assert.equal(p.blocked, false);
    assert.equal(p.messages.length, 1);
  }
  members = false;
  const p = player(stations[6]); plugin._test.chop({ player: p, object: object(stations[6]) });
  assert.match(p.messages[0], /members world/); assert.equal(p.blocked, false);
  members = true;
});

test("chop, shape, float and paddle follow native state, award XP once and reject repeated choices", () => {
  const s = stations[3]; const p = player(s);
  make(p, s, TYPES[3]);
  assert.equal(plugin._test.state(p, s), 14); assert.equal(p.xp, 150); assert.equal(p.blocked, false);
  choose(p, 416, 11); assert.equal(p.xp, 150);
  plugin._test.paddle({ player: p, object: object(s) }); assert.equal(p.interfaceId, 953);
  assert.ok(events.some((e) => e.name === "diary:task" && e.task === "make-a-waka-canoe-near-edgeville"));
  plugin._test.logout({ player: p }); assert.equal(plugin._test.state(p, s), 0);
});

test("a real map choice rows privately, lands, consumes the canoe and releases controls", () => {
  const from = stations[6]; const to = stations[7]; const p = player(from);
  make(p, from, TYPES[3]);
  plugin._test.paddle({ player: p, object: object(from) }); choose(p, 952, 12);
  spawned.length = 0;
  let faced = null;
  p.setPositionToFace = (at) => { faced = at; };
  const varbit = (name) => p.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));
  advance(2); assert.equal(p.location.getX(), 1817); assert.equal(p.blocked, true);
  assert.deepEqual([faced.getX(), faced.getY()], [1816, 4515], "rowing faces west");
  assert.equal(varbit("fov_clamp"), 1); assert.equal(varbit("draw_distance_max_override"), 1);
  assert.equal(spawned.length, 4);
  assert.ok(spawned.every((npc) => npc.flags.has("movement:ignore-clipping")));
  advance(7);
  assert.deepEqual(spawned.slice(4).map((npc) => [npc.spawn.x, npc.spawn.y]), [[1821, 4500]], "scenery_1 returns south on +7");
  advance(3);
  assert.deepEqual(spawned.slice(5).map((npc) => [npc.spawn.x, npc.spawn.y]).sort(), [[1819, 4505], [1820, 4501]]);
  advance(16);
  assert.equal(varbit("fov_clamp"), 0); assert.equal(varbit("draw_distance_max_override"), 0);
  assert.deepEqual([p.location.getX(), p.location.getY()], to.landing);
  assert.equal(p.area, null); assert.equal(p.blocked, false); assert.equal(plugin._test.state(p, from), 0);
  assert.match(p.messages.at(-1), /Your canoe sinks/);
});

test("a second station clears the previous canoe; logout cancels work and an interrupted ride returns safely", () => {
  const p = player(stations[0]); make(p, stations[0], TYPES[0]);
  p.location = new Location(...stations[1].tree, 0);
  plugin._test.chop({ player: p, object: object(stations[1]) });
  assert.equal(plugin._test.state(p, stations[0]), 0);
  plugin._test.logout({ player: p }); advance(8); assert.equal(p.blocked, false); assert.equal(p.xp, 30);
  p.location = new Location(...stations[6].tree, 0); make(p, stations[6], TYPES[3]);
  plugin._test.paddle({ player: p, object: object(stations[6]) }); choose(p, 952, 12); advance(2);
  plugin._test.logout({ player: p }); advance(30);
  assert.deepEqual([p.location.getX(), p.location.getY()], stations[6].tree);
  assert.equal(p.blocked, false); assert.equal(p.area, null);
});

test("shaping success uses Wiki interpolation and caps above 100 percent", () => {
  assert.equal(plugin._test.chance(1, [32, 100]), 33 / 256);
  assert.equal(plugin._test.chance(99, [32, 100]), 101 / 256);
  assert.equal(plugin._test.chance(99, [112, 350]), 1);
});

test("death or logout before the rowing scene clears recovery instead of teleporting on relog", () => {
  const from = stations[3];
  for (const interruption of ["death", "logout"]) {
    const p = player(from);
    make(p, from, TYPES[3]);
    plugin._test.paddle({ player: p, object: object(from) }); choose(p, 953, 17);
    assert.ok(p.getAttribute("canoes:return"));
    let closedFade = false;
    const sender = p.getPacketSender();
    sender.closeSubInterface = () => { closedFade = true; return sender; };
    if (interruption === "death") p.getHitpoints = () => 0;
    else plugin._test.logout({ player: p });
    advance(2);
    assert.equal(p.getAttribute("canoes:return"), null, interruption);
    assert.equal(p.blocked, false);
    assert.equal(closedFade, true);
    p.location = new Location(3222, 3218, 0);
    p.getHitpoints = () => 99;
    plugin._test.restore({ player: p });
    assert.deepEqual([p.location.getX(), p.location.getY()], [3222, 3218], interruption);
  }
});

test("carving rechecks its axe and location at the award tick", () => {
  const s = stations[0];
  for (const interrupt of [(p) => { p.hasAxe = false; }, (p) => { p.location = new Location(3000, 3000, 0); }]) {
    const p = player(s);
    const random = Math.random; Math.random = () => 0;
    try {
      plugin._test.chop({ player: p, object: object(s) }); advance(CHOP_DELAY_TICKS + 2);
      plugin._test.shape({ player: p, object: object(s) }); choose(p, 416, 11);
      interrupt(p); advance(4);
      assert.equal(p.xp, 0); assert.equal(plugin._test.state(p, s), 10); assert.equal(p.blocked, false);
      assert.equal(p.getPacketSender().getVarbit(CacheDefinitions.getVarbitId("canoe_avoid_if")), 0);
    } finally { Math.random = random; }
  }
});

test("assistant storage preserves exact item metadata and refuses withdrawal into a full inventory", () => {
  const p = player();
  const original = new Item(axe.id, 1, { charges: { left: 25 } });
  const items = [original];
  let full = false;
  p.getDialogueManager = () => ({ startDialogues() {} });
  p.getInventory = () => ({
    getItems: () => items, contains: (id) => items.some((item) => item.getId() === id),
    deleteAtSlot: (slot) => { items.splice(slot, 1); p.hasAxe = false; },
    isFull: () => full,
    add: (item) => { items.push(item); p.hasAxe = true; },
  });
  const npc = { getId: () => 1325 };
  plugin._test.storeAxe({ player: p, npc });
  assert.equal(items.length, 0); assert.equal(plugin._test.axeFor(p), axe, "stored axe works without being carried");
  original.getMeta().charges.left = 99;
  full = true; plugin._test.storeAxe({ player: p, npc });
  assert.equal(items.length, 0); assert.ok(p.getAttribute("canoes:stored-axe"));
  full = false; plugin._test.storeAxe({ player: p, npc });
  assert.equal(items.length, 1); assert.deepEqual(items[0].getMeta(), { charges: { left: 25 } });
  assert.equal(p.getAttribute("canoes:stored-axe"), null);
});
