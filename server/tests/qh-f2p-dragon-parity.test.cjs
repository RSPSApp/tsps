// QH parity gaps for Dragon Slayer I: instruction gates, condition guards and the
// Crandor/Karamja shortcut. From server/: node --test tests/qh-f2p-dragon-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const ClimbLinks = require('../plugins/objects/ClimbLinks');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
let nextIndex = 1;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(2836, 9600, true);
  RegionManager.loadMapFiles(2556, 9844, true);
  RegionManager.loadMapFiles(3019, 9850, true);
  RegionManager.loadMapFiles(2932, 3240, true);
  RegionManager.loadMapFiles(2932, 9640, true);
});

function harness(withDoors = false, withLadders = false, withPrince = false) {
  const hooks = {}, events = {}, objects = [], ground = [], clicks = new Map(), interactions = new Map(), tasks = [], stageQueries = [];
  // QuestRuntime fixture for the quest:get-stage query: answer from registered quest metadata,
  // never from raw stage attributes.
  (events['quest:get-stage'] ??= []).push(request => {
    stageQueries.push({ player: request.player, key: request.key });
    request.stage = runtime.getRegisteredQuests().find(entry => entry.key === request.key)?.getStage?.(request.player) ?? 0;
  });
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { for (const task of tasks.filter(entry => entry.key === key)) task.stop(); },
  };
  const objectManager = {
    register: object => objects.push(object),
    deregister: object => { const index = objects.indexOf(object); if (index >= 0) objects.splice(index, 1); },
  };
  const api = new Proxy({
    core,
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    getTaskManager: () => taskManager,
    persistAttribute: () => {},
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onObjectInteraction: (name, actions) => {
      if (typeof name !== 'string' || !actions) return;
      const named = interactions.get(name) ?? {};
      for (const [option, action] of Object.entries(actions)) {
        named[option] = event => { if (action(event) !== false) event.handled = true; };
      }
      interactions.set(name, named);
    },
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
  }, {
    get: (target, key) => target[key] ?? ((...args) => {
      (hooks[key] ??= []).push(args.find(value => typeof value === 'function'));
    }),
  });
  require('../plugins/quests/quests/DragonSlayer.Quest')(api);
  if (withDoors) require('../plugins/objects/Doors.plugin').register(api);
  if (withLadders) require('../plugins/objects/Ladders.plugin').register(api);
  if (withPrince) require('../plugins/quests/quests/PrinceAliRescue.Quest')(api);
  return {
    hooks, events, objects, ground, clicks, interactions, stageQueries,
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    runTasks(cycles = 8) {
      let active = [...tasks];
      tasks.length = 0;
      for (let cycle = 0; cycle < cycles && active.length > 0; cycle++) {
        for (const task of active) task.tick();
        active = active.filter(task => task.isRunning());
      }
      tasks.push(...active);
      return active.length;
    },
    quest: runtime.getRegisteredQuests().at(-1),
  };
}

const doorToggle = (h, p, objectId, clickType = 1, interactions = ['Open']) => {
  const request = {
    player: p, objectId, location: { x: 0, y: 0, z: 0 }, clickType, handled: false,
    definition: { getInteractions: () => interactions },
    object: {
      getId: () => objectId,
      getLocation: () => new core.Location(0, 0, 0),
      getFace: () => 0,
      getType: () => 0,
      getPrivateArea: () => null,
    },
  };
  h.emit('door:toggle', request);
  return request;
};

function melzarFrontDoor() {
  const door = MapObjects.get(O.DOOR_91, new core.Location(2941, 3248, 0), null);
  assert.ok(door, 'real exterior Door 2595 at 2941,3248');
  assert.equal(door.getType(), 0, 'the current native front door is a straight wall');
  assert.equal(door.getFace(), 0, 'the current native front door blocks its west edge');
  return door;
}

function melzarFrontRequest(h, p, door, via = 'click') {
  const event = { player: p, object: door, objectId: O.DOOR_91,
    definition: door.getDefinition(), location: door.getLocation(), clickType: 1, handled: false };
  if (via === 'use') { event.itemId = I.MAZE_KEY; h.hooks.onItemOnObject[0](event); }
  else if (via === 'toggle') h.emit('door:toggle', event);
  else h.clicks.get(O.DOOR_91)(event);
  return event;
}

function finishMelzarWalk(p) {
  assert.ok(p.getForceMovement() instanceof core.ForceMovement, 'the native door walk must start');
  for (let turn = 0; turn < 8 && p.getForceMovement(); turn++) core.TaskManager.process();
  assert.equal(p.getForceMovement(), null, 'the existing door-walk task must complete within the bound');
}

function cleanMelzarPlayer(t, h, p) {
  t.after(() => { for (const cleanup of h.hooks.onPlayerLogout ?? []) cleanup({ player: p }); });
}

function player() {
  const attrs = new Map(), items = new Map(), varbits = new Map(), messages = [], sounds = [];
  let location = new core.Location(3210, 3220, 0), privateArea = null, movementBlocked = false, forceMovement = null;
  const steps = [];
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendConfig(id, value) { varbits.set(`config:${id}`, value); return packet; },
    sendSoundEffect(id) { sounds.push(id); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    isFull: () => false,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { items.set(id, (items.get(id) ?? 0) - amount); },
  };
  return {
    attrs, items, varbits, messages, sounds, steps,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getSkillManager: () => ({ getCombatLevel: () => 99, getCurrentLevel: () => 99 }),
    getLocation: () => location,
    moveTo: to => { location = to; },
    getPrivateArea: () => privateArea,
    setPrivateArea: value => { privateArea = value; },
    getArea: () => null,
    getHitpoints: () => 99,
    getMovementQueue: () => ({
      isMovementBlocked: () => movementBlocked,
      setBlockMovement(value) { movementBlocked = value; return this; },
      reset() { return this; },
      addSteps(to) { steps.push([to.getX(), to.getY()]); },
      didMovePreviousCycle: () => false,
    }),
    performAnimation: () => {},
    getCombat: () => ({ reset() {} }),
    setForceMovement: movement => { forceMovement = movement; },
    getForceMovement: () => forceMovement,
    setUntargetable: () => {},
    sendMessage: text => messages.push(text),
    getUsername: () => 'Parity',
    isPlayerBot: () => false,
    index: nextIndex++,
  };
}

const variant = (h, p, npcId) =>
  (h.hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
const answer = (h, p, npcId, text) =>
  (h.hooks.onNpcDialogueCondition ?? []).map(fn => fn({ player: p, npcId, text }))
    .find(value => value !== null && value !== undefined);

test('Dragon Slayer only offers the Oracle and Wormbrain map branches after the matching Guildmaster answer', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 2);
  p.attrs.set('dragon-slayer:instructions', 31);
  assert.equal(variant(h, p, N.ORACLE), undefined);
  assert.equal(variant(h, p, N.WORMBRAIN), undefined);

  p.attrs.set('dragon-slayer:instructions', 31 & ~(1 << 1));
  assert.match(variant(h, p, N.ORACLE).variant, /thalzar-s-map-piece/);

  p.attrs.set('dragon-slayer:instructions', 31 & ~(1 << 2));
  assert.match(variant(h, p, N.WORMBRAIN).variant, /lozar-s-map-piece/);
});

test('Dragon Slayer answers the Pandemonium and Murder Mystery guards instead of letting them default true', () => {
  const h = harness(), p = player();
  assert.equal(answer(h, p, N.GUILDMASTER, 'If the player has completed Pandemonium:'), false);
  assert.equal(answer(h, p, N.OZIACH, 'If Murder Mystery has been completed:'), false);
});

test('Dragon Slayer only drops Wormbrain\'s map piece after the Lozar answer', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 2);
  p.attrs.set('dragon-slayer:instructions', 31);
  h.hooks.onNpcDeath[0]({ killer: p, npcId: N.WORMBRAIN, location: { x: 3016, y: 3188, z: 0 } });
  assert.equal(h.ground.length, 0);

  const asked = player();
  h.quest.setStage(asked, 2);
  asked.attrs.set('dragon-slayer:instructions', 31 & ~(1 << 2));
  h.hooks.onNpcDeath[0]({ killer: asked, npcId: N.WORMBRAIN, location: { x: 3016, y: 3188, z: 0 } });
  assert.equal(h.ground.length, 1);
});

/** Collect the door:open requests the quest hands to Doors (the captured pass-through wall opens and shuts there). */
const watchDoorOpen = h => { const seen = []; (h.events['door:open'] ??= []).push(request => seen.push(request)); return seen; };
const crandorWall = () => MapObjects.get(O.WALL_9, new core.Location(2836, 9600, 0), null);
const clickCrandorWall = (h, p) => {
  const wall = crandorWall();
  assert.ok(wall, 'the real closed wall is still on the map');
  assert.equal(wall.getDefinition().getInteractions()[0], 'Open');
  const request = {
    player: p, objectId: O.WALL_9, object: wall, location: { x: 2836, y: 9600, z: 0 },
    clickType: 1, handled: false, definition: wall.getDefinition(),
  };
  h.emit('door:toggle', request);
  return request;
};

test('Dragon Slayer hands the real shared Crandor wall to Doors both ways without owner scenery or a teleport', () => {
  const h = harness(), p = player(), opened = watchDoorOpen(h);
  h.quest.setStage(p, 9);
  p.moveTo(new core.Location(2836, 9601, 0));

  const first = clickCrandorWall(h, p);
  assert.equal(first.handled, true);
  assert.equal(p.attrs.get('dragon-slayer.shortcut'), true);
  assert.equal(p.varbits.get(3741), 1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2836, 9601], 'the player is not teleported');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].object, crandorWall(), 'Doors is asked to open the real wall');
  assert.equal(h.objects.length, 0, 'no persistent synthetic wall is registered');
  assert.deepEqual(MapObjects.ownerObjectsInScene(p, 2816, 9600, 128), []);
  assert.ok(crandorWall(), 'the same wall remains targetable from the south');

  const back = clickCrandorWall(h, p);
  assert.equal(back.handled, true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2836, 9601]);
  assert.equal(opened.length, 2);

  h.hooks.onPlayerLogout[0]({ player: p });
  RegionManager.loadMapFiles(2836, 9600, true);
  const reloaded = crandorWall();
  assert.ok(reloaded, 'scene reload restores the shared closed wall');
  assert.equal(reloaded.getDefinition().getInteractions()[0], 'Open');
  assert.deepEqual(MapObjects.ownerObjectsInScene(p, 2816, 9600, 128), []);
  assert.equal(h.objects.length, 0);
});

test('Dragon Slayer keeps the shared Crandor wall blocked for another player until their own unlock', () => {
  const h = harness(), unlocked = player(), locked = player(), opened = watchDoorOpen(h);
  h.quest.setStage(unlocked, 9);
  h.quest.setStage(locked, 1);
  unlocked.moveTo(new core.Location(2836, 9601, 0));
  locked.moveTo(new core.Location(2836, 9601, 0));

  clickCrandorWall(h, unlocked);
  assert.deepEqual(opened.map(request => request.player), [unlocked]);
  assert.equal(unlocked.attrs.get('dragon-slayer.shortcut'), true);
  assert.ok(crandorWall());
  assert.deepEqual(MapObjects.ownerObjectsInScene(unlocked, 2816, 9600, 128), []);

  const blocked = clickCrandorWall(h, locked);
  assert.equal(blocked.handled, true);
  assert.deepEqual(opened.map(request => request.player), [unlocked], 'the locked player never reaches Doors');
  assert.deepEqual([locked.getLocation().getX(), locked.getLocation().getY()], [2836, 9601]);
  assert.equal(locked.attrs.get('dragon-slayer.shortcut'), undefined);
  assert.equal(locked.varbits.get(3741), undefined);
  assert.ok(crandorWall(), 'the wall stays present for the locked player');

  h.quest.setStage(locked, 9);
  clickCrandorWall(h, locked);
  assert.equal(locked.attrs.get('dragon-slayer.shortcut'), true);
  assert.deepEqual(opened.map(request => request.player), [unlocked, locked]);
  assert.equal(h.objects.length, 0);
});

test('Dragon Slayer claims the Doors toggle so the maze and magic doors still require their unlocks', (t) => {
  const h = harness(), p = player();
  cleanMelzarPlayer(t, h, p);
  h.quest.setStage(p, 2);

  let request = doorToggle(h, p, O.MAGIC_DOOR_6);
  assert.equal(request.handled, true);
  assert.match(p.messages.at(-1), /can't see any way to open the door/);

  const frontDoor = melzarFrontDoor();
  p.moveTo(new core.Location(2942, 3248, 0));
  request = melzarFrontRequest(h, p, frontDoor, 'toggle');
  assert.equal(request.handled, true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2942, 3248]);
  assert.equal(p.getForceMovement(), null, 'the locked front door does not start a crossing');
  p.items.set(I.MAZE_KEY, 1);
  request = melzarFrontRequest(h, p, frontDoor, 'toggle');
  assert.equal(request.handled, true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2942, 3248],
    'the valid key starts a walk rather than an immediate move');
  finishMelzarWalk(p);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2940, 3248]);
  assert.equal(p.items.get(I.MAZE_KEY), 1, 'the reusable front-door key is not spent');
  assert.equal(h.quest.getStage(p), 2);

  request = doorToggle(h, p, O.RED_DOOR);
  assert.equal(request.handled, true);
  assert.equal(p.items.get(I.KEY_3), undefined);
  p.items.set(I.KEY_3, 1);
  p.moveTo(new core.Location(1, 0, 0));
  request = doorToggle(h, p, O.RED_DOOR);
  assert.equal(p.items.get(I.KEY_3), 1, 'the key is spent when the walk through the door lands');
  core.TaskManager.process();
  assert.equal(p.items.get(I.KEY_3), 1, 'two tiles take two ticks');
  core.TaskManager.process();
  assert.equal(p.items.get(I.KEY_3), 0);
  assert.match(p.messages.at(-1), /disintegrates/);

  p.items.set(I.KEY_3, 1);
  const close = doorToggle(h, p, O.RED_DOOR, 2, ['Open', 'Close']);
  assert.equal(close.handled, false, 'Close belongs to Doors, not the quest key handler');
  assert.equal(p.items.get(I.KEY_3), 1);
});

test('Dragon Slayer auto-unlocks only after actually leaving Crandor and never inside its scenes', () => {
  const h = harness(), left = player();
  h.quest.setStage(left, 9);
  h.hooks.onPlayerLogin[0]({ player: left });
  assert.equal(left.attrs.get('dragon-slayer.shortcut'), true);
  assert.equal(left.varbits.get(3741), 1);

  const mapped = player();
  h.quest.setStage(mapped, 9);
  mapped.moveTo(new core.Location(2836, 9650, 0));
  h.hooks.onPlayerMapSquareChange[0]({ player: mapped });
  assert.equal(mapped.attrs.get('dragon-slayer.shortcut'), undefined, 'north of the wall is still Crandor');

  const scene = player();
  h.quest.setStage(scene, 9);
  scene.moveTo(new core.Location(8209, 1656, 0));
  scene.setPrivateArea({});
  h.hooks.onPlayerLogin[0]({ player: scene });
  assert.equal(scene.attrs.get('dragon-slayer.shortcut'), undefined, 'instance tiles are not the island');

  const south = player();
  h.quest.setStage(south, 9);
  south.moveTo(new core.Location(2836, 9590, 0));
  h.hooks.onPlayerLogin[0]({ player: south });
  assert.equal(south.attrs.get('dragon-slayer.shortcut'), true, 'Karamja side means Crandor was left');

  const roped = player();
  h.quest.setStage(roped, 9);
  roped.moveTo(new core.Location(2833, 3256, 0));
  h.clicks.get(O.CLIMBING_ROPE_13)({ player: roped });
  assert.equal(roped.attrs.get('dragon-slayer.shortcut'), undefined);
});

test('Dragon Slayer refuses ship repairs once the Karamja shortcut is known', () => {
  const h = harness(), p = player();
  h.quest.setStage(p, 9);
  p.attrs.set('dragon-slayer.shortcut', true);
  h.clicks.get(25036)({ player: p });
  assert.match(p.messages.at(-1), /secret passage from Karamja/);
});

test('the real Doors route walks the unlocked player in from the south through the captured wall while another player stays blocked', () => {
  const h = harness(true), unlocked = player(), locked = player();
  const swaps = [], sounds = [], discoveries = [];
  (h.events['dragon-slayer:crandor-wall'] ??= []).push(event => discoveries.push(event.player));
  const original = [core.ObjectManager.register, core.ObjectManager.deregister, core.Sounds.sendSound];
  core.ObjectManager.register = object => swaps.push(['register', object.getId(), object.getLocation().getX(), object.getLocation().getY()]);
  core.ObjectManager.deregister = object => swaps.push(['deregister', object.getId(), object.getLocation().getX(), object.getLocation().getY()]);
  core.Sounds.sendSound = (_player, sound) => sounds.push(sound.getId());
  const click = p => {
    const wall = crandorWall();
    assert.ok(wall, 'real closed wall exists before the click');
    assert.equal(wall.getDefinition().getInteractions()[0], 'Open');
    const event = {
      player: p, object: wall, objectId: O.WALL_9, definition: wall.getDefinition(),
      location: wall.getLocation(), clickType: 1, handled: false,
    };
    h.interactions.get('Wall').Open(event);
    return event;
  };
  try {
    h.quest.setStage(unlocked, 9);
    h.quest.setStage(locked, 1);
    unlocked.moveTo(new core.Location(2836, 9599, 0));
    locked.moveTo(new core.Location(2836, 9601, 0));

    assert.equal(click(unlocked).handled, true);
    assert.deepEqual([unlocked.getLocation().getX(), unlocked.getLocation().getY()], [2836, 9599], 'no teleport');
    assert.deepEqual(unlocked.steps.splice(0), [], 'the opener is carried, not sent through collision-checked steps');
    const carry = unlocked.getForceMovement();
    assert.ok(carry, 'carried in from the south as captured (RSProx 2951)');
    assert.deepEqual([carry.getStart().getX(), carry.getStart().getY(), carry.getEnd().getX(), carry.getEnd().getY()], [2836, 9599, 0, 1]);
    assert.deepEqual(swaps.splice(0), [['deregister', O.WALL_9, 2836, 9600], ['register', 25039, 2836, 9599], ['register', 38848, 2836, 9600]]);
    assert.deepEqual(sounds, [2410]);
    assert.deepEqual(discoveries, [unlocked], 'eligible wall click also emits diary discovery');
    assert.equal(unlocked.attrs.get('dragon-slayer.shortcut'), true);
    assert.equal(h.objects.length, 0);

    assert.equal(click(locked).handled, true);
    assert.deepEqual(locked.steps, [], 'the locked player is refused before Doors');
    assert.deepEqual(swaps, []);
    assert.equal(locked.attrs.get('dragon-slayer.shortcut'), undefined);
    assert.deepEqual(discoveries, [unlocked], 'refused wall click never earns diary discovery');
  } finally {
    [core.ObjectManager.register, core.ObjectManager.deregister, core.Sounds.sendSound] = original;
  }
});

function ladderHarness() {
  const hooks = {}, events = {}, interactions = new Map(), tasks = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { for (const task of tasks.filter(entry => entry.key === key)) task.stop(); },
  };
  const api = new Proxy({
    core,
    persistAttribute: () => {},
    getTaskManager: () => taskManager,
    onObjectInteraction: (name, actions) => {
      if (typeof name !== 'string' || !actions) return;
      const named = interactions.get(name) ?? {};
      for (const [option, action] of Object.entries(actions)) {
        named[option] = event => { if (action(event) !== false) event.handled = true; };
      }
      interactions.set(name, named);
    },
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
  }, {
    get: (target, key) => target[key] ?? ((...args) => {
      (hooks[key] ??= []).push(args.find(value => typeof value === 'function'));
    }),
  });
  require('../plugins/quests/quests/RovingElves.Quest')(api);
  require('../plugins/objects/Ladders.plugin').register(api);
  return {
    hooks, events, interactions,
    emit: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    runTasks(cycles = 8) {
      let active = [...tasks];
      tasks.length = 0;
      for (let cycle = 0; cycle < cycles && active.length > 0; cycle++) {
        for (const task of active) task.tick();
        active = active.filter(task => task.isRunning());
      }
      tasks.push(...active);
      return active.length;
    },
  };
}

test('Roving Elves claims only its cache-placed tomb ladder; the shared Dwarven Mine ladder keeps the canonical Ice Mountain Climb-up exit', () => {
  const h = ladderHarness();
  const tomb = MapObjects.get(17387, new core.Location(2556, 9844, 0), null);
  const mine = MapObjects.get(17387, new core.Location(3019, 9850, 0), null);
  assert.ok(tomb, 'real Glarial tomb ladder 17387 at 2556,9844');
  assert.ok(mine, 'real Dwarven Mine Oracle ladder 17387 at 3019,9850');
  assert.equal(tomb.getDefinition().getName(), 'Ladder');
  assert.equal(mine.getDefinition().getName(), 'Ladder');
  assert.equal(tomb.getDefinition().getInteractions()[0], 'Climb-up');
  assert.equal(mine.getDefinition().getInteractions()[0], 'Climb-up');

  const tombPlayer = player();
  tombPlayer.moveTo(new core.Location(2556, 9845, 0));
  const tombEvent = {
    player: tombPlayer, object: tomb, objectId: 17387, definition: tomb.getDefinition(),
    location: tomb.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-up'](tombEvent);
  assert.equal(tombEvent.handled, true);
  assert.deepEqual([tombPlayer.getLocation().getX(), tombPlayer.getLocation().getY(), tombPlayer.getLocation().getZ()], [2557, 3445, 0]);

  const minePlayer = player();
  const mineFrom = new core.Location(3019, 9851, 0);
  minePlayer.moveTo(mineFrom);
  const expectedMineExit = ClimbLinks.destination(mine, ClimbLinks.UP, mineFrom, null, false);
  assert.ok(expectedMineExit, 'real ClimbLinks has the normal mine exit');
  assert.deepEqual([expectedMineExit.getX(), expectedMineExit.getY(), expectedMineExit.getZ()], [3018, 3450, 0], 'Ice Mountain surface');
  const mineEvent = {
    player: minePlayer, object: mine, objectId: 17387, definition: mine.getDefinition(),
    location: mine.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-up'](mineEvent);
  assert.equal(h.runTasks(), 0, 'the bounded Ladders climb task completed');
  assert.deepEqual([minePlayer.getLocation().getX(), minePlayer.getLocation().getY(), minePlayer.getLocation().getZ()], [3018, 3450, 0],
    'the Oracle-room ladder exits normally to Ice Mountain');

  const request = { player: minePlayer, object: mine, objectId: 17387, clickType: 1, handled: false };
  h.emit('ladders:climb', request);
  assert.equal(request.handled, false, 'Roving Elves does not claim the mine ladder');
});

test('Dragon Slayer routes Melzar FUNLADDERTOP 2605 into the real basement and keeps the normal maze exits', () => {
  const h = harness(false, true);
  const ladder = MapObjects.get(O.LADDER_21, new core.Location(2932, 3240, 0), null);
  assert.ok(ladder, 'real Melzar basement-entry ladder 2605 at 2932,3240');
  assert.equal(ladder.getDefinition().getInteractions()[0], 'Climb-down');
  assert.equal(RegionManager.blocked({ getX: () => 2932, getY: () => 9640, getZ: () => 0 }, null), false,
    'real basement landing 2932,9640 is walkable');

  const p = player();
  p.moveTo(new core.Location(2932, 3241, 0));
  const descent = {
    player: p, object: ladder, objectId: O.LADDER_21, definition: ladder.getDefinition(),
    location: ladder.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-down'](descent);
  assert.equal(descent.handled, true);
  assert.equal(h.runTasks(), 0, 'real Ladders climb task completed');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2932, 9640, 0]);

  const fake = new core.GameObject(O.LADDER_21, new core.Location(3000, 3000, 0), 10, 1, null);
  const unrelated = player();
  unrelated.moveTo(new core.Location(3000, 3001, 0));
  const unrelatedEvent = {
    player: unrelated, object: fake, objectId: O.LADDER_21, definition: fake.getDefinition(),
    location: fake.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-down'](unrelatedEvent);
  h.runTasks();
  assert.deepEqual([unrelated.getLocation().getX(), unrelated.getLocation().getY(), unrelated.getLocation().getZ()], [3000, 3001, 0],
    'an unrelated 2605 placement is not claimed for the Melzar basement');

  const ascentLadder = MapObjects.get(O.LADDER_216, new core.Location(2939, 9657, 0), null);
  assert.ok(ascentLadder, 'real basement exit ladder 17385 at 2939,9657');
  const ascentPlayer = player();
  ascentPlayer.moveTo(new core.Location(2939, 9656, 0));
  const expectedAscent = ClimbLinks.destination(ascentLadder, ClimbLinks.UP, ascentPlayer.getLocation(), null, false);
  assert.ok(expectedAscent);
  const ascent = {
    player: ascentPlayer, object: ascentLadder, objectId: O.LADDER_216, definition: ascentLadder.getDefinition(),
    location: ascentLadder.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-up'](ascent);
  assert.equal(h.runTasks(), 0);
  assert.deepEqual([ascentPlayer.getLocation().getX(), ascentPlayer.getLocation().getY(), ascentPlayer.getLocation().getZ()],
    [expectedAscent.getX(), expectedAscent.getY(), expectedAscent.getZ()]);

  const wrongTurn = MapObjects.get(O.LADDER_215, new core.Location(2924, 3250, 0), null);
  assert.ok(wrongTurn, 'real wrong-turn ladder 17384 at 2924,3250');
  const trapped = player();
  trapped.moveTo(new core.Location(2924, 3251, 0));
  const expectedDown = ClimbLinks.destination(wrongTurn, ClimbLinks.DOWN, trapped.getLocation(), null, false);
  assert.ok(expectedDown);
  const down = {
    player: trapped, object: wrongTurn, objectId: O.LADDER_215, definition: wrongTurn.getDefinition(),
    location: wrongTurn.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-down'](down);
  assert.equal(h.runTasks(), 0);
  assert.deepEqual([trapped.getLocation().getX(), trapped.getLocation().getY(), trapped.getLocation().getZ()],
    [expectedDown.getX(), expectedDown.getY(), expectedDown.getZ()]);

  const returnLadder = MapObjects.get(O.LADDER_216, new core.Location(2924, 9650, 0), null);
  assert.ok(returnLadder, 'real wrong-turn return ladder 17385 at 2924,9650');
  const expectedReturn = ClimbLinks.destination(returnLadder, ClimbLinks.UP, trapped.getLocation(), null, false);
  assert.ok(expectedReturn);
  const back = {
    player: trapped, object: returnLadder, objectId: O.LADDER_216, definition: returnLadder.getDefinition(),
    location: returnLadder.getLocation(), clickType: 1, handled: false,
  };
  h.interactions.get('Ladder')['Climb-up'](back);
  assert.equal(h.runTasks(), 0);
  assert.deepEqual([trapped.getLocation().getX(), trapped.getLocation().getY(), trapped.getLocation().getZ()],
    [expectedReturn.getX(), expectedReturn.getY(), expectedReturn.getZ()]);

  const exitDoor = MapObjects.get(O.EXIT_DOOR, new core.Location(2938, 3252, 0), null);
  assert.ok(exitDoor, 'real ground-floor Exit door 2602 at 2938,3252');
  const clickExit = (p, door) => {
    const event = {
      player: p, object: door, objectId: O.EXIT_DOOR, definition: door.getDefinition(),
      location: door.getLocation(), handled: false,
    };
    h.clicks.get(O.EXIT_DOOR)(event);
    return event;
  };

  const leaving = player();
  leaving.moveTo(new core.Location(2939, 3252, 0));
  assert.equal(clickExit(leaving, exitDoor).handled, true);
  core.TaskManager.process(); core.TaskManager.process();
  assert.deepEqual([leaving.getLocation().getX(), leaving.getLocation().getY()], [2937, 3252],
    'ground NE ladder room exits into the maze');

  const groundReturn = player();
  groundReturn.moveTo(new core.Location(2937, 3252, 0));
  assert.equal(clickExit(groundReturn, exitDoor).handled, false);
  assert.deepEqual([groundReturn.getLocation().getX(), groundReturn.getLocation().getY()], [2937, 3252],
    'the maze cannot re-enter the ground ladder room');

  const exits = [
    [2931, 9640, [2932, 9640], [2930, 9640], 'zombie room'],
    [2927, 9649, [2928, 9649], [2926, 9649], 'Melzar room'],
    [2924, 9654, [2924, 9655], [2923, 9654], 'demon room'],
  ];
  for (const [x, y, from, to, label] of exits) {
    const door = MapObjects.get(O.EXIT_DOOR, new core.Location(x, y, 0), null);
    assert.ok(door, `real ${label} brown exit door 2602 at ${x},${y}`);
    const out = player();
    out.moveTo(new core.Location(from[0], from[1], 0));
    assert.equal(clickExit(out, door).handled, true, `${label} can leave`);
    core.TaskManager.process(); core.TaskManager.process();
    assert.deepEqual([out.getLocation().getX(), out.getLocation().getY()], to, `${label} exits west`);

    const back = player();
    back.moveTo(new core.Location(to[0], to[1], 0));
    assert.equal(clickExit(back, door).handled, false, `${label} exit corridor cannot reverse`);
    assert.deepEqual([back.getLocation().getX(), back.getLocation().getY()], to,
      `${label} reverse is refused without restarting the maze`);
  }

  const unrelatedDoor = new core.GameObject(O.EXIT_DOOR, new core.Location(3000, 3000, 0), 0, 0, null);
  const unrelatedExit = player();
  unrelatedExit.moveTo(new core.Location(2999, 3000, 0));
  assert.equal(clickExit(unrelatedExit, unrelatedDoor).handled, false);
  assert.deepEqual([unrelatedExit.getLocation().getX(), unrelatedExit.getLocation().getY()], [2999, 3000],
    'no generic Exit door handler exists outside the four cache placements');
});

test('Dragon Slayer walks through the Melzar front door in both directions and keeps it locked without the key', (t) => {
  const h = harness();
  const door = melzarFrontDoor();
  const click = p => melzarFrontRequest(h, p, door);

  // The ladder from the basement chest lands in the north-east room, west of
  // this door; the Exit doors only lead into the maze, so this is the way out.
  const leaving = player();
  cleanMelzarPlayer(t, h, leaving);
  leaving.moveTo(new core.Location(2940, 3248, 0));
  const leavingStage = h.quest.getStage(leaving);
  assert.equal(click(leaving).handled, true);
  assert.deepEqual([leaving.getLocation().getX(), leaving.getLocation().getY()], [2940, 3248],
    'the keyless ladder-room exit starts with a walk');
  finishMelzarWalk(leaving);
  assert.deepEqual([leaving.getLocation().getX(), leaving.getLocation().getY(), leaving.getLocation().getZ()],
    [2942, 3248, 0], 'the ladder room exits to the building east side');
  assert.equal(leaving.getInventory().getAmount(I.MAZE_KEY), 0);
  assert.equal(h.quest.getStage(leaving), leavingStage);

  const entering = player();
  cleanMelzarPlayer(t, h, entering);
  h.quest.setStage(entering, 2);
  entering.items.set(I.MAZE_KEY, 1);
  entering.moveTo(new core.Location(2942, 3248, 0));
  assert.equal(click(entering).handled, true);
  assert.deepEqual([entering.getLocation().getX(), entering.getLocation().getY()], [2942, 3248],
    'the valid-key entry does not teleport into the building');
  finishMelzarWalk(entering);
  assert.deepEqual([entering.getLocation().getX(), entering.getLocation().getY()],
    [2940, 3248], 'the exterior side with the maze key reaches the tile across the real door');
  assert.equal(entering.items.get(I.MAZE_KEY), 1);
  assert.equal(h.quest.getStage(entering), 2);

  const locked = player();
  cleanMelzarPlayer(t, h, locked);
  locked.moveTo(new core.Location(2942, 3248, 0));
  assert.equal(click(locked).handled, true);
  assert.deepEqual([locked.getLocation().getX(), locked.getLocation().getY()], [2942, 3248],
    'the exterior side without the key keeps the door locked');
  // RSProx 468 ticks 6449-6450 and 6732-6733: "This door is securely locked." with sound 2402.
  assert.deepEqual(locked.messages, ['This door is securely locked.']);
  assert.deepEqual(locked.sounds, [2402]);
  assert.equal(locked.getForceMovement(), null);
  assert.equal(locked.getInventory().getAmount(I.MAZE_KEY), 0);
  assert.equal(h.quest.getStage(locked), 0);
});

test('Melzar front-key item use walks across the real wall even when standing on its tile', (t) => {
  const h = harness(), door = melzarFrontDoor();
  for (const startX of [2942, 2941]) {
    const p = player(); cleanMelzarPlayer(t, h, p);
    h.quest.setStage(p, 2); p.items.set(I.MAZE_KEY, 1);
    p.moveTo(new core.Location(startX, 3248, 0));
    melzarFrontRequest(h, p, door, 'use');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [startX, 3248],
      'item-on-door input does not teleport before its movement task');
    finishMelzarWalk(p);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2940, 3248]);
    assert.equal(p.items.get(I.MAZE_KEY), 1);
    assert.equal(h.quest.getStage(p), 2);
  }
});

test('Melzar front door keeps the stage and actual inventory key gates for click and item use', (t) => {
  const h = harness(), door = melzarFrontDoor();
  for (const via of ['click', 'use']) for (const [stage, keys] of [[0, 1], [2, 0]]) {
    const p = player(); cleanMelzarPlayer(t, h, p);
    h.quest.setStage(p, stage); if (keys) p.items.set(I.MAZE_KEY, keys);
    p.moveTo(new core.Location(2942, 3248, 0));
    melzarFrontRequest(h, p, door, via);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2942, 3248]);
    assert.equal(p.getForceMovement(), null, 'failed entry gates never start a crossing');
    assert.equal(p.getInventory().getAmount(I.MAZE_KEY), keys);
    assert.equal(h.quest.getStage(p), stage);
  }
});

test('Melzar front walks keep one movement token and allow retry after logout cancellation', (t) => {
  const h = harness(), door = melzarFrontDoor();
  for (const via of ['click', 'use']) {
    const p = player(); cleanMelzarPlayer(t, h, p);
    h.quest.setStage(p, 2); p.items.set(I.MAZE_KEY, 1);
    p.moveTo(new core.Location(2942, 3248, 0));
    melzarFrontRequest(h, p, door, via);
    const first = p.getForceMovement();
    assert.ok(first instanceof core.ForceMovement);
    melzarFrontRequest(h, p, door, via);
    assert.equal(p.getForceMovement(), first, 'a repeated input cannot arm another movement');
    for (const cleanup of h.hooks.onPlayerLogout ?? []) cleanup({ player: p });
    for (let turn = 0; turn < 8; turn++) core.TaskManager.process();
    assert.equal(p.getForceMovement(), null);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2942, 3248]);
    assert.equal(p.items.get(I.MAZE_KEY), 1);
    assert.equal(h.quest.getStage(p), 2);
    melzarFrontRequest(h, p, door, via);
    assert.notEqual(p.getForceMovement(), first, 'a fresh input gets a new movement after cancellation');
    finishMelzarWalk(p);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2940, 3248]);
    assert.equal(p.items.get(I.MAZE_KEY), 1);
    assert.equal(h.quest.getStage(p), 2);
  }
});

test('Dragon Slayer Ned selector defers to Prince Ali wig while preserving DS voyage', () => {
  const h = harness(false, false, true);
  const ds = runtime.getRegisteredQuests().find(entry => entry.key === 'dragon_slayer_i');
  const prince = runtime.getRegisteredQuests().find(entry => entry.key === 'prince_ali_rescue');
  assert.ok(ds && prince, 'Dragon Slayer and Prince Ali Rescue are registered');
  const pick = (p, npcId = N.NED) =>
    (h.hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
  const setStages = (p, dsStage, princeStage) => {
    ds.setStage(p, dsStage);
    prince.setStage(p, princeStage);
  };
  const isPrinceWig = choice => choice?.page === 'Prince Ali Rescue'
    && choice.variant === 'preparations-for-rescue-talking-to-ned';

  // DS complete must never permanently shadow the reachable Prince wig request.
  const complete = player();
  setStages(complete, 10, 20);
  assert.ok(isPrinceWig(pick(complete)), 'DS complete defers Ned to Prince wig');

  const crandor = player();
  setStages(crandor, 8, 20);
  crandor.moveTo(new core.Location(3098, 3257, 0));
  assert.ok(isPrinceWig(pick(crandor)), 'DS Ned-ready on land defers to Prince wig');
  assert.ok(h.stageQueries.some(query => query.key === 'prince_ali_rescue' && query.player === crandor),
    'Ned priority used the registered quest:get-stage query');

  const afterReach = player();
  setStages(afterReach, 9, 20);
  afterReach.moveTo(new core.Location(3098, 3257, 0));
  assert.ok(isPrinceWig(pick(afterReach)), 'DS after-Crandor land dialogue defers to Prince wig');

  const onShip = player();
  setStages(onShip, 8, 20);
  onShip.moveTo(new core.Location(3048, 3207, 1));
  const shipChoice = pick(onShip);
  assert.equal(shipChoice.page, 'Dragon Slayer I');
  assert.equal(shipChoice.variant, 'the-dragon-of-crandor-talking-to-ned-on-the-lady-lumbridge');

  const early = player();
  setStages(early, 2, 20);
  early.moveTo(new core.Location(3098, 3257, 0));
  assert.ok(isPrinceWig(pick(early)), 'active DS instructions defer to a missing Prince wig');

  const earlyWithWig = player();
  setStages(earlyWithWig, 2, 20);
  earlyWithWig.moveTo(new core.Location(3098, 3257, 0));
  earlyWithWig.items.set(I.WIG_2, 1);
  assert.equal(pick(earlyWithWig).page, 'Dragon Slayer I');

  const withWig = player();
  setStages(withWig, 8, 20);
  withWig.moveTo(new core.Location(3098, 3257, 0));
  withWig.items.set(I.WIG_2, 1);
  const dsChoice = pick(withWig);
  assert.equal(dsChoice.page, 'Dragon Slayer I');
  assert.equal(dsChoice.variant, 'the-dragon-of-crandor-talking-to-ned-after-giving-him-the-crandor-map');

  const completeWithWig = player();
  setStages(completeWithWig, 10, 20);
  completeWithWig.items.set(I.WIG_2, 1);
  assert.equal(pick(completeWithWig), undefined, 'DS complete does not claim Ned even when Prince has the wig');

  const inactive = player();
  setStages(inactive, 0, 20);
  assert.ok(isPrinceWig(pick(inactive)), 'inactive DS already defers to Prince wig');
});


test('Crandor diary route credits climbing from the dungeon to the surface only', () => {
  const h = harness(), p = player();
  const arrivals = [];
  (h.events['dragon-slayer:crandor-visited'] ??= []).push(event => arrivals.push(event));
  p.attrs.set('dragon-slayer.shortcut', true);
  p.moveTo(new core.Location(2832, 9657, 0));
  h.clicks.get(25213)({ player: p });
  assert.ok(p.getLocation().getY() < 6400);
  assert.equal(arrivals.length, 1);
  h.clicks.get(25213)({ player: p });
  assert.ok(p.getLocation().getY() >= 6400);
  assert.equal(arrivals.length, 1);
});
