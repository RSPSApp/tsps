const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

const valve = { x: 2807, y: 4496, z: 0 };
const lift = { x: 2807, y: 4492, z: 0 };

function entityAt(x, y) {
  const queue = {
    points: [],
    reset() { return queue; }, setRoute() { return queue; }, setPathX() { return queue; },
    setPathY() { return queue; }, addCheckpoint(tile) { queue.points.push([tile.getX(), tile.getY()]); return queue; },
    syncDestinationFlagToRoute() { return queue; },
  };
  return {
    queue,
    isPlayer: () => false,
    getAsPlayer: () => ({ getUsername: () => '' }),
    getLocation: () => new (require('../dist/game/model/Location').Location)(x, y, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
    getMovementQueue: () => queue,
  };
}

function route(from, to) {
  const entity = entityAt(from.x, from.y);
  const steps = require('../dist/game/model/movement/path/PathFinder').PathFinder.calculateRoute(
    entity, 0, to.x, to.y, 0, 0, 0, 0, false
  );
  return { steps, waypoints: entity.queue.points };
}

function setupQuest() {
  const hooks = { custom: new Map(), objects: [], deaths: [], logins: [], logouts: [], variants: [] };
  const tasks = [], spawned = [];
  let tick = 0;
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); } stop() {} },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); }, cancelTasks() {} },
    ObjectManager: { deregister() {} },
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition() {},
    onNpcInteraction() {},
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnObject() {},
    onItemAction() {},
    onNpcDeath(fn) { hooks.deaths.push(fn); },
    onCanTeleport() {},
    onPlayerLogin(fn) { hooks.logins.push(fn); },
    onPlayerLogout(fn) { hooks.logouts.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
    spawnNpc(def) {
      const npc = { def, getId: () => def.id, getContentId: () => def.id, getOwner: () => def.owner,
        isRegistered: () => true, getLocation: () => new core.Location(def.x, def.y, def.z ?? 0),
        moveTo(tile) { npc.tile = tile; }, getMovementQueue: () => ({ addFirstStep() {} }),
        forceChat(text) { npc.chat = text; }, performAnimation(animation) { npc.animation = animation?.id; },
        performGraphic() {}, setPositionToFace() {}, setArea() {}, getArea: () => null };
      spawned.push(npc); return npc;
    },
    removeNpc() {},
    getItemOnGroundManager() { return { registerLocation() {} }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/HauntedMine.Quest')(api);
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'haunted_mine').at(-1);
  const attrs = new Map(), inventory = new Map(), varbits = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig() { return sender; }, sendInterfaceRemoval() { return sender; }, sendJingle() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, sendMessage() {},
    getInventory: () => ({ getAmount: (id) => inventory.get(id) ?? 0,
      adds(id, n = 1) { inventory.set(id, (inventory.get(id) ?? 0) + n); },
      add(id, n = 1) { inventory.set(id, (inventory.get(id) ?? 0) + n); },
      deleteNumber(id, n) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - n)); },
      getFreeSlots: () => 28 }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences() {} }),
    getLocation: () => new core.Location(2807, 4496, 0), moveTo() {},
    getDialogueManager: () => ({ reset() {}, isActive: () => false, startDialogues() {} }),
    isPlayer: () => true, isNpc: () => false, isRegistered: () => true, isPlayerBot: () => false,
  };
  return { api, hooks, quest, attrs, inventory, spawned, tasks, varbits, player, core,
    tick(count) { while (count-- > 0) { tick++; for (const task of [...tasks]) if (!task.__done && task.due <= tick) { task.__done = true; task.run(); } } },
    action(stepId, kind = 'action') { const event = { player, stepId, kind, handled: false }; api.emitCustomEvent('npc-dialogue:action', event); return event; },
    object(objectId, x, y) { const event = { player, objectId, object: { getLocation: () => new core.Location(x, y, 0) }, handled: false }; for (const fn of hooks.objects) fn(event); return event; },
  };
}

test('captured valve->lift route exists under the real PathFinder and fits the ghost window', () => {
  const result = route(valve, { x: 2807, y: 4493, z: 0 });
  assert.ok(result.steps > 0, 'PathFinder finds a route around the solid lift sides');
  assert.ok(result.waypoints.length > 1, 'the route is the captured long way around');
  assert.deepEqual(result.waypoints.at(-1), [2805, 4493]);
  const runningTicks = Math.ceil(result.waypoints.length / 2);
  assert.ok(runningTicks < 41, `run distance ${runningTicks} ticks fits the captured 41-tick window`);
});

test('captured Haunted stairs that LocTeleports misses are owned with real cache ids', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const h = setupQuest();
  const emitted = [];
  h.api.onCustomEvent('ladders:climbUp', (event) => emitted.push({ dir: 'up', dest: event.destination }));
  h.api.onCustomEvent('ladders:climbDown', (event) => emitted.push({ dir: 'down', dest: event.destination }));
  for (const [id, x, y, dir, dx, dy] of [
    [4971, 2746, 4436, 'down', 2811, 4454],
    [4971, 2692, 4436, 'down', 2758, 4454],
    [4973, 2812, 4452, 'up', 2750, 4437],
  ]) {
    RegionManager.loadMapFiles(x, y);
    const object = (MapObjects.mapObjects.get(MapObjects.getHash(x, y, 0)) ?? []).find((candidate) => candidate.getId() === id);
    assert.ok(object, `real cache ${id}@${x},${y}`);
    assert.ok(ObjectDefinition.forId(id).getInteractions().some((action) => String(action).toLowerCase().includes(dir)));
    const event = { player: h.player, object, objectId: id, handled: false };
    h.api.emitCustomEvent('ladders:climb', event);
    assert.equal(event.handled, true);
    const landing = emitted.at(-1);
    assert.equal(landing.dir, dir);
    assert.deepEqual([landing.dest.getX(), landing.dest.getY()], [dx, dy]);
  }
});

test('captured ghost timer keeps the valve open 41 ticks and then closes it', () => {
  const h = setupQuest();
  h.quest.setStage(h.player, 3);
  h.player.setAttribute('quest.haunted_mine.bits', 0);
  h.action('TbCdkn', 'message');
  assert.equal(h.varbits.get(2394), 1, 'valve opens');
  h.tick(19);
  assert.equal(h.spawned.filter((npc) => npc.getId() === 3627).length, 0, 'ghost waits 20 captured ticks');
  h.tick(1);
  const ghost = h.spawned.find((npc) => npc.getId() === 3627);
  assert.ok(ghost, 'ghost appears at the captured tick');
  assert.equal(ghost.chat, 'Ooooo Wooooo Woo');
  assert.equal(ghost.animation, 5478);
  h.tick(20);
  assert.equal(h.varbits.get(2394), 1, 'valve still open before the ghost reaches it');
  h.tick(1);
  assert.equal(h.varbits.get(2394), 0, 'ghost closes the valve after the captured 21 ticks');
});
