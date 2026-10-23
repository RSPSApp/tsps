// From server/: node --test tests/remaining-perilous-landings.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const O = core.ObjectIdentifiers;
let next = 1;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
  RegionManager.loadMapFiles(1440, 9640);
});

function harness() {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [];
  const api = new Proxy({ core: { ...core, World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: {
    submit(task) { task.setRunning?.(true); tasks.push(task); }, cancelTasks(key) { tasks.filter(t => t.key === key).forEach(t => t.stop?.()); },
  }, ObjectManager: { register: o => objects.push(o), deregister: () => {} } },
    getObjectManager: () => ({ register: () => {}, deregister: () => {} }),
    getItemOnGroundManager: () => ({ registerLocation: () => {} }),
    persistAttribute() {}, onCustomEvent(k, fn) { (events[k] ??= []).push(fn); },
    emitCustomEvent(k, e) { for (const fn of events[k] ?? []) fn(e); },
    onObjectInteraction(fn) { (hooks.object ??= []).push(fn); },
    spawnNpc(def) { let loc = new core.Location(def.x, def.y, def.z); const npc = { ...def, getLocation: () => loc, moveTo: to => { loc = to; }, remove: () => {}, isRegistered: () => true, isNpc: () => true, getAsNpc: () => npc, getIndex: () => next++, setOwner() {}, setMobileInteraction() {}, setPositionToFace() {}, getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }) }; npcs.push(npc); return npc; },
    removeNpc(npc) { npc.removed = true; removed.push(npc); },
  }, { get: (t, k) => t[k] ?? ((...args) => (hooks[k] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/PerilousMoons.Quest')(api);
  return { api, hooks, tasks, npcs, removed, objects, quest: runtime.getRegisteredQuests().at(-1) };
}
function player() {
  const attrs = new Map(), items = new Map();
  let loc = new core.Location(1440, 9620, 1);
  const inv = { getAmount: id => items.get(id) ?? 0, getFreeSlots: () => 28, adds(id, n) { items.set(id, (items.get(id) ?? 0) + n); }, deleteNumber(id, n) { items.set(id, (items.get(id) ?? 0) - n); } };
  const sender = new Proxy({ sendVarbit() { return sender; }, sendConfig() { return sender; }, sendInterfaceRemoval() { return sender; } }, { get: (t, k) => t[k] ?? (() => sender) });
  const p = { attrs, items, messages: [], getAttribute: k => attrs.get(k), setAttribute: (k, v) => attrs.set(k, v), getInventory: () => inv,
    getLocation: () => loc, moveTo: to => { loc = to; }, sendMessage: m => p.messages.push(m), getPacketSender: () => sender,
    getSkillManager: () => ({ getMaxLevel: () => 99 }), getEquipment: () => ({ get: () => null }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }), setUntargetable() {}, isRegistered: () => true,
    getDialogueManager: () => p.manager, getIndex: () => next++, isPlayer: () => true, isNpc: () => false };
  p.manager = new DialogueManager(p);
  return p;
}
function gate(h, p, id, x, y, z = 0) {
  const event = { player: p, objectId: id, location: new core.Location(x, y, z), clickType: 1, definition: { getInteractions: () => ['Pass-through'] } };
  for (const fn of h.hooks.object ?? []) fn(event);
  return event;
}
const pos = p => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

test('every captured mandatory entrance lands on its real destination', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 5); gate(h, p, O.ENTRANCE_15, 1435, 3129); assert.deepEqual(pos(p), [1439, 9509, 1]);
  h.quest.setStage(p, 7); gate(h, p, O.ENTRANCE_15, 1439, 9600, 1); assert.deepEqual(pos(p), [1440, 9615, 1]);
  h.quest.setStage(p, 27);
  gate(h, p, O.ENTRANCE_16, 1421, 9613, 1); assert.deepEqual(pos(p), [1388, 9575, 0]);
  gate(h, p, O.ENTRANCE_16, 1421, 9650, 1); assert.deepEqual(pos(p), [1403, 9717, 0]);
  gate(h, p, O.ENTRANCE_16, 1458, 9650, 1); assert.deepEqual(pos(p), [1481, 9669, 0]);
  gate(h, p, O.ENTRANCE_17, 1439, 9612, 1); assert.deepEqual(pos(p), [1439, 9599, 1]);
  gate(h, p, O.ENTRANCE_18, 1389, 9674); assert.deepEqual(pos(p), [1522, 9719, 0]);
  gate(h, p, O.ENTRANCE_18, 1521, 9720); assert.deepEqual(pos(p), [1522, 9719, 0]);
  gate(h, p, O.ENTRANCE_17, 1527, 9670); assert.deepEqual(pos(p), [1513, 9596, 0]);
  gate(h, p, O.ENTRANCE_17, 1512, 9560); assert.deepEqual(pos(p), [1355, 9538, 0]);
  gate(h, p, O.ENTRANCE_17, 1404, 9703); assert.deepEqual(pos(p), [1441, 9676, 0]);
  gate(h, p, O.ENTRANCE_15, 1388, 9589); assert.deepEqual(pos(p), [1418, 9632, 0]);
  gate(h, p, O.ENTRANCE_15, 1509, 9673); assert.deepEqual(pos(p), [1461, 9632, 0]);
});

test('wrong-stage entrances do not move the player and 1493,9579 remains walk-through', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 6); gate(h, p, O.ENTRANCE_15, 1439, 9600, 1); assert.deepEqual(pos(p), [1440, 9620, 1]);
  h.quest.setStage(p, 27); gate(h, p, O.ENTRANCE_17, 1493, 9579); assert.deepEqual(pos(p), [1440, 9620, 1]);
});

test('cache placements, boss visibility areas and PathFinder show every arena is reachable and returnable', () => {
  const moons = require('../plugins/bosses/data/moons-of-peril.json').moons;
  const landings = { blue: [1441, 9676], blood: [1418, 9632], eclipse: [1461, 9632] };
  // Quest Helper's arena zones (PerilousMoon.java:266-268): landings are inside them.
  const qhZones = { blue: [1417, 1463, 9647, 9699], blood: [1373, 1421, 9614, 9650], eclipse: [1457, 1506, 9614, 9650] };
  const shipped = require('../data/definitions/npc-dialogues.json');
  const index = require('../data/definitions/npc-dialogue-index.json');
  for (const id of [12861, 12862, 12869]) assert.ok(index[String(id)]?.some(e => e.page === 'Transcript:Perilous Moons'));
  assert.ok(shipped['Perilous Moons'].variants['remnants-of-the-old-ones-talking-to-eyatlalli-with-the-items']);
  const queue = () => ({ reset() {}, setRoute() {}, syncDestinationFlagToRoute() {}, setPathX() { return this; }, setPathY() { return this; }, addCheckpoint() {}, hasRoute: () => false });
  const walker = (x, y) => ({ isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'PerilousRoute' }), getLocation: () => new core.Location(x, y, 0), getSize: () => 1, getPrivateArea: () => null, getMovementQueue: queue });
  for (const [moon, spec] of Object.entries(moons)) {
    const [lx, ly] = landings[moon];
    const [bx, by] = spec.tile;
    const [z1, z2, z3, z4] = qhZones[moon];
    assert.ok(lx >= z1 && lx <= z2 && ly >= z3 && ly <= z4, `${moon} landing inside QH arena zone`);
    RegionManager.loadMapFiles(bx, by);
    const gateId = moon === 'blue' ? [O.ENTRANCE_17, 1404, 9703] : moon === 'blood' ? [O.ENTRANCE_15, 1388, 9589] : [O.ENTRANCE_15, 1509, 9673];
    const object = MapObjects.get(gateId[0], new core.Location(gateId[1], gateId[2], 0), null);
    assert.ok(object, `${moon} gate is in the cache`);
    assert.equal(object.getDefinition().getInteractions()[0], 'Pass-through');
    assert.equal(RegionManager.blocked(new core.Location(lx, ly, 0), null), false, `${moon} landing walkable`);
    assert.equal(RegionManager.blocked(new core.Location(bx, by, 0), null), false, `${moon} boss tile walkable`);
    const approach = moon === 'blue' ? [bx, by] : moon === 'blood' ? [1412, 9632] : [1468, 9632];
    assert.ok(PathFinder.calculateWalkRoute(walker(lx, ly), approach[0], approach[1]) > 0, `${moon} arena approach`);
    const statue = moon === 'blue' ? [51373, 1439, 9659] : moon === 'blood' ? [51372, 1410, 9631] : [51374, 1467, 9631];
    const statueObject = MapObjects.get(statue[0], new core.Location(statue[1], statue[2], 0), null);
    assert.ok(statueObject, `${moon} statue is in the cache`);
    assert.ok(statueObject.getDefinition().getInteractions().includes('Use'));
    assert.equal(core.NpcDefinition.forId(moon === 'blue' ? 13013 : moon === 'blood' ? 13011 : 13012)?.getName?.(), spec.name);
  }
});

test('Nahta/Blacksmith capture spawns and exact RSMOD routes out of the shop to the forge', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const nahta = spawns.find(spawn => spawn.id === 13036);
  const smith = spawns.find(spawn => spawn.id === 13038);
  assert.deepEqual([nahta.x, nahta.y, nahta.level], [1428, 9565, 1], 'RSProx 1693 Nahta add, not QH WorldPoint 1424,9568');
  assert.deepEqual([smith.x, smith.y, smith.level], [1448, 9582, 1], 'RSProx 1693 Blacksmith add, not QH WorldPoint 1448,9584');
  RegionManager.loadMapFiles(1421, 9569);
  RegionManager.loadMapFiles(1448, 9584);
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const escape = route.findRoute({ level: 1, srcX: 1421, srcY: 9569, srcSize: 1,
    destX: 1425, destY: 9567, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(escape.success, true, 'continuous cache route 1421,9569 -> 1425,9567');
  assert.equal(escape.endX, 1425); assert.equal(escape.endY, 9567);
  const throughClosedShop = route.findRoute({ level: 1, srcX: 1425, srcY: 9567, srcSize: 1,
    destX: 1448, destY: 9584, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(throughClosedShop.success, false, 'no false continuous claim through the shop door');
  const beforeDoor = route.findRoute({ level: 1, srcX: 1421, srcY: 9569, srcSize: 1,
    destX: 1430, destY: 9568, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(beforeDoor.success, true); assert.equal(beforeDoor.endX, 1430); assert.equal(beforeDoor.endY, 9568);
  const forge = route.findRoute({ level: 1, srcX: 1435, srcY: 9575, srcSize: 1,
    destX: 1448, destY: 9584, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(forge.success, true, 'continuous cache route outside shop -> blacksmith interaction tile');
  assert.equal(forge.endX, 1448); assert.equal(forge.endY, 9584);
});

test('shop Squeeze-through 51005 is a captured two-way transition and the real object interaction reaches the Blacksmith', () => {
  const data = require('../plugins/world/data/loc-teleports.json').locs
    .find(entry => entry.id === 51005 && entry.x === 1431 && entry.y === 9567 && entry.z === 1);
  assert.deepEqual(data.sides, [
    { from: [1430, 9567, 1], to: [1432, 9567, 1] },
    { from: [1432, 9568, 1], to: [1430, 9568, 1] },
  ], 'RSProx 1693 west->east and east->west destinations');
  assert.equal(data.anim, 6103); assert.equal(data.animTick, 3); assert.equal(data.tick, 4);
  assert.equal(data.sound, 2452);

  RegionManager.loadMapFiles(1431, 9567);
  const door = MapObjects.get(51005, new core.Location(1431, 9567, 1), null);
  assert.ok(door, 'raw cache MapObject 51005 at 1431,9567,1');
  assert.equal(door.getDefinition().getInteractions()[0], 'Squeeze-through');

  let objectHook;
  const api = { core, persistAttribute() {}, onObjectInteraction(fn) { objectHook = fn; }, onItemOnObject() {}, onCustomEvent() {} };
  require('../plugins/world/LocTeleports.plugin').register(api);
  const p = player();
  p.performAnimation = animation => { p.animation = animation.getId(); };
  p.getHitpoints = () => 99;
  p.getPrivateArea = () => null;
  p.getMovementQueue = () => ({ blocked: false, isMovementBlocked() { return this.blocked; }, setBlockMovement(value) { this.blocked = value; return this; }, reset() { return this; } });

  const click = (x, y) => {
    p.moveTo(new core.Location(x, y, 1));
    objectHook({ player: p, object: door, clickType: 1 });
  };

  click(1430, 9568);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(p.animation, 6103, 'captured animation before the move');
  assert.deepEqual(pos(p), [1430, 9568, 1], 'still on the west side before the captured move tick');
  core.TaskManager.process();
  assert.deepEqual(pos(p), [1432, 9567, 1], 'west->east landing');

  click(1432, 9568);
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  assert.deepEqual(pos(p), [1430, 9568, 1], 'east->west landing');

  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  const toSmith = route.findRoute({ level: 1, srcX: 1432, srcY: 9567, srcSize: 1, destX: 1448, destY: 9584, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(toSmith.success, true); assert.equal(toSmith.endX, 1448); assert.equal(toSmith.endY, 9584);
  const fromSmith = route.findRoute({ level: 1, srcX: 1448, srcY: 9584, srcSize: 1, destX: 1432, destY: 9568, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(fromSmith.success, true); assert.equal(fromSmith.endX, 1432); assert.equal(fromSmith.endY, 9568);
  const backInside = route.findRoute({ level: 1, srcX: 1430, srcY: 9568, srcSize: 1, destX: 1421, destY: 9569, moveNear: false, maxWaypoints: 80, privateArea: null });
  assert.equal(backInside.success, true); assert.equal(backInside.endX, 1421); assert.equal(backInside.endY, 9569);
});
