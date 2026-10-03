// Run after `yarn build`: node --test tests/wooden-gate.test.cjs
//
// Wooden gates are two locs (hinge 12986 + extension 12987) that must swing together around
// the hinge post; opening replaces both with 12988/12989 on the perpendicular tile line.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Sounds } = require('../dist/game/Sounds');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');

const tileKey = (id, x, y, z) => `${id}@${x},${y},${z}`;

function buildHarness() {
  const world = new Map();
  const ops = [];
  const sounds = [];

  const originalGet = MapObjects.get;
  const originalSound = Sounds.sendSound;
  const originalGetObject = CacheDefinitions.getObject;
  const originalGetCounts = CacheDefinitions.getCounts;
  MapObjects.get = (id, location) =>
    world.get(tileKey(id, location.getX(), location.getY(), location.getZ())) ?? null;
  Sounds.sendSound = (...args) => sounds.push(args);
  CacheDefinitions.getObject = () => ({ name: 'Gate' });
  CacheDefinitions.getCounts = () => ({ npcs: 0, items: 0, objects: 0 });

  const handlers = new Map();
  const objectManager = {
    register: (o) => ops.push(['register', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
    deregister: (o) => ops.push(['deregister', o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]),
  };
  const taskManager = { submit: () => {}, cancelTasks: () => {} };
  const api = {
    // The plugin reads its engine classes from api.core; MapObjects/Sounds/CacheDefinitions
    // are the real classes with the static methods patched above.
    core: {
      CacheDefinitions, GameObject, Location, MapObjects, Sounds,
      ObjectIdentifiers: require('../dist/util/ObjectIdentifiers').ObjectIdentifiers,
      Sound: require('../dist/game/Sound').Sound,
      Task: require('../dist/game/task/Task').Task,
      ObjectManager: objectManager,
      TaskManager: taskManager,
    },
    getObjectManager: () => objectManager,
    getTaskManager: () => taskManager,
    emitCustomEvent: () => {},
    onObjectInteraction: (name, actions) => handlers.set(name, actions),
    onRegionLoaded: () => {},
    onPlayerProcess: () => {},
  };
  require('../plugins/objects/Doors.plugin').register(api);

  const place = (id, x, y, face) => {
    const object = new GameObject(id, new Location(x, y, 0), 0, face, null);
    world.set(tileKey(id, x, y, 0), object);
  };

  const click = (id, x, y, face, action = 'Open', name = 'Gate') => {
    const object = new GameObject(id, new Location(x, y, 0), 0, face, null);
    const location = object.getLocation();
    const player = {
      getUsername: () => 'tester',
      isPlayerBot: () => false,
      getPrivateArea: () => null,
      getLocation: () => location,
      getAttribute: () => 0,
      setAttribute: () => {},
      isNeedsPlacement: () => false,
      isAllowRegionChangePacket: () => false,
      getPacketSender: () => ({}),
    };
    ops.length = 0;
    handlers.get(name)[action]({ player, object, objectId: id, location });
    return ops.splice(0);
  };

  const restore = () => {
    MapObjects.get = originalGet;
    Sounds.sendSound = originalSound;
    CacheDefinitions.getObject = originalGetObject;
    CacheDefinitions.getCounts = originalGetCounts;
  };

  return { place, click, sounds, restore };
}

test('wooden gate swings hinge + extension panels open from a closed hinge click', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12986, 100, 100, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
    assert.equal(h.sounds.length, 1, 'gate open should play a sound');
  } finally {
    h.restore();
  }
});

test('clicking the closed extension opens the same way as the hinge', () => {
  const h = buildHarness();
  try {
    h.place(12986, 100, 100, 0);
    h.place(12987, 100, 101, 0);
    const ops = h.click(12987, 100, 101, 0);
    assert.deepEqual(ops, [
      ['deregister', 12986, 100, 100, 0],
      ['deregister', 12987, 100, 101, 0],
      ['register', 12988, 99, 100, 3],
      ['register', 12989, 98, 100, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('open wooden gate closes back onto its original tiles', () => {
  const h = buildHarness();
  try {
    h.place(12988, 99, 100, 3);
    h.place(12989, 98, 100, 3);
    const ops = h.click(12988, 99, 100, 3);
    assert.deepEqual(ops, [
      ['deregister', 12988, 99, 100, 3],
      ['deregister', 12989, 98, 100, 3],
      ['register', 12986, 100, 100, 0],
      ['register', 12987, 100, 101, 0],
    ]);
  } finally {
    h.restore();
  }
});

test('wooden gate open + close round-trips for a north-facing (rotation 1) gate', () => {
  const h = buildHarness();
  try {
    h.place(12986, 200, 200, 1);
    h.place(12987, 201, 200, 1);
    const opened = h.click(12986, 200, 200, 1);
    assert.deepEqual(opened, [
      ['deregister', 12986, 200, 200, 1],
      ['deregister', 12987, 201, 200, 1],
      ['register', 12988, 200, 201, 0],
      ['register', 12989, 200, 202, 0],
    ]);
    h.place(12988, 200, 201, 0);
    h.place(12989, 200, 202, 0);
    const closed = h.click(12988, 200, 201, 0);
    assert.deepEqual(closed, [
      ['deregister', 12988, 200, 201, 0],
      ['deregister', 12989, 200, 202, 0],
      ['register', 12986, 200, 200, 1],
      ['register', 12987, 201, 200, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('newly catalogued gates (47/48, 883/23917, 15514/15516) swing to their open ids', () => {
  const h = buildHarness();
  try {
    h.place(47, 300, 300, 0);
    h.place(48, 300, 301, 0);
    assert.deepEqual(h.click(47, 300, 300, 0), [
      ['deregister', 47, 300, 300, 0],
      ['deregister', 48, 300, 301, 0],
      ['register', 49, 299, 300, 3],
      ['register', 50, 298, 300, 3],
    ]);

    h.place(883, 310, 310, 0);
    h.place(23917, 310, 311, 0);
    assert.deepEqual(h.click(883, 310, 310, 0), [
      ['deregister', 883, 310, 310, 0],
      ['deregister', 23917, 310, 311, 0],
      ['register', 23918, 309, 310, 3],
      ['register', 23919, 308, 310, 3],
    ]);

    h.place(15514, 320, 320, 0);
    h.place(15516, 320, 321, 0);
    assert.deepEqual(h.click(15514, 320, 320, 0), [
      ['deregister', 15514, 320, 320, 0],
      ['deregister', 15516, 320, 321, 0],
      ['register', 15511, 319, 320, 3],
      ['register', 15513, 318, 320, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('gates with a Release action swing open (60763/60760)', () => {
  const h = buildHarness();
  try {
    h.place(60763, 400, 400, 0);
    h.place(60760, 400, 401, 0);
    assert.deepEqual(h.click(60763, 400, 400, 0, 'Release'), [
      ['deregister', 60763, 400, 400, 0],
      ['deregister', 60760, 400, 401, 0],
      ['register', 60761, 399, 400, 3],
      ['register', 60762, 398, 400, 3],
    ]);
  } finally {
    h.restore();
  }
});

test('Castle Wars large doors swing both leaves to the open ids and back', () => {
  const h = buildHarness();
  try {
    // Saradomin: west leaf 4423 / east 4424, one row south when open.
    h.place(4423, 2426, 3088, 3);
    h.place(4424, 2427, 3088, 3);
    assert.deepEqual(h.click(4423, 2426, 3088, 3, 'Open', 'Large door'), [
      ['deregister', 4423, 2426, 3088, 3],
      ['deregister', 4424, 2427, 3088, 3],
      ['register', 4425, 2426, 3087, 0],
      ['register', 4426, 2427, 3087, 2],
    ], 'west leaf is left: it opens to face 0, the east leaf mirrors to face 2');
    h.place(4425, 2426, 3087, 0);
    h.place(4426, 2427, 3087, 2);
    assert.deepEqual(h.click(4425, 2426, 3087, 0, 'Close', 'Large door'), [
      ['deregister', 4425, 2426, 3087, 0],
      ['deregister', 4426, 2427, 3087, 2],
      ['register', 4423, 2426, 3088, 3],
      ['register', 4424, 2427, 3088, 3],
    ]);

    // Zamorak: ids run east to west, so 4428 is the west/left leaf.
    h.place(4428, 2372, 3119, 1);
    h.place(4427, 2373, 3119, 1);
    assert.deepEqual(h.click(4428, 2372, 3119, 1, 'Open', 'Large door'), [
      ['deregister', 4428, 2372, 3119, 1],
      ['deregister', 4427, 2373, 3119, 1],
      ['register', 4430, 2372, 3120, 0],
      ['register', 4429, 2373, 3120, 2],
    ]);
    h.place(4430, 2372, 3120, 0);
    h.place(4429, 2373, 3120, 2);
    assert.deepEqual(h.click(4430, 2372, 3120, 0, 'Close', 'Large door'), [
      ['deregister', 4430, 2372, 3120, 0],
      ['deregister', 4429, 2373, 3120, 2],
      ['register', 4428, 2372, 3119, 1],
      ['register', 4427, 2373, 3119, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('1727/1728 metal gates open from either leaf order (west leaf is left)', () => {
  // Both open into the shared 1571/1572 leaves.
  const h = buildHarness();
  try {
    // Usual order: 1727 west of 1728.
    h.place(1727, 3100, 3500, 1);
    h.place(1728, 3101, 3500, 1);
    assert.deepEqual(h.click(1728, 3101, 3500, 1), [
      ['deregister', 1727, 3100, 3500, 1],
      ['deregister', 1728, 3101, 3500, 1],
      ['register', 1571, 3100, 3501, 0],
      ['register', 1572, 3101, 3501, 2],
    ]);

    // Reversed: 1728 west of 1727 must still swing the west leaf as the left one, open and closed.
    h.place(1728, 3200, 3500, 1);
    h.place(1727, 3201, 3500, 1);
    assert.deepEqual(h.click(1727, 3201, 3500, 1), [
      ['deregister', 1728, 3200, 3500, 1],
      ['deregister', 1727, 3201, 3500, 1],
      ['register', 1572, 3200, 3501, 0],
      ['register', 1571, 3201, 3501, 2],
    ]);
    h.place(1572, 3200, 3501, 0);
    h.place(1571, 3201, 3501, 2);
    assert.deepEqual(h.click(1571, 3201, 3501, 2, 'Close'), [
      ['deregister', 1572, 3200, 3501, 0],
      ['deregister', 1571, 3201, 3501, 2],
      ['register', 1728, 3200, 3500, 1],
      ['register', 1727, 3201, 3500, 1],
    ]);
  } finally {
    h.restore();
  }
});

test('reversed large doors (1513 south of 1511, as cached at 3287,3172) pick the left leaf by position', () => {
  const h = buildHarness();
  try {
    h.place(1511, 3287, 3172, 0);
    h.place(1513, 3287, 3171, 0);
    assert.deepEqual(h.click(1511, 3287, 3172, 0, 'Open', 'Large door'), [
      ['deregister', 1513, 3287, 3171, 0],
      ['deregister', 1511, 3287, 3172, 0],
      ['register', 1516, 3286, 3171, 3],
      ['register', 1512, 3286, 3172, 1],
    ]);
  } finally {
    h.restore();
  }
});

// --- Al Kharid toll gate -----------------------------------------------------
// Open a guard dialogue, answer the 10gp conditions, and on payment swing the
// two leaves for that player only, force-walk them through and shut the gate again.

const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');

const AL_KHARID_LEAF_SOUTH = 44598;
const AL_KHARID_LEAF_NORTH = 44599;

// The plugin starts guard conversations through QuestRuntime.startTranscript;
// stub it so these tests only exercise the gate's own logic.
function loadAlKharidGatePlugin(startTranscript) {
  const runtimePath = require.resolve('../plugins/quests/QuestRuntime');
  const pluginPath = require.resolve('../plugins/objects/AlKharidGate.plugin');
  const previous = require.cache[runtimePath];
  delete require.cache[pluginPath];
  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true, exports: { startTranscript } };
  try {
    return require(pluginPath);
  } finally {
    if (previous) require.cache[runtimePath] = previous;
    else delete require.cache[runtimePath];
  }
}

function buildAlKharidHarness() {
  const dialogues = [];
  const submitted = [];
  const handlers = { custom: new Map(), object: new Map(), conditions: [] };
  const plugin = loadAlKharidGatePlugin((api, player, npcId, page, variant) => {
    dialogues.push({ npcId, page, variant });
  });
  plugin.register({
    core: PluginManager.getCoreApi(),
    getTaskManager: () => ({
      submit: (task) => {
        submitted.push(task);
        if (task.isImmediate?.()) task.execute();
      },
    }),
    onCustomEvent: (name, handler) => handlers.custom.set(name, handler),
    onObjectInteraction: (name, actions) => handlers.object.set(name, actions),
    onNpcDialogueCondition: (handler) => handlers.conditions.push(handler),
  });

  // Everyone created by alKharidPlayer has the gate in view.
  viewers = [];
  const originalForEachNetworkPlayer = World.forEachNetworkPlayer;
  World.forEachNetworkPlayer = (consumer) => viewers.forEach(consumer);
  const originalMapGet = MapObjects.get;
  MapObjects.get = (id, location) => {
    if (location.getZ() !== 0 || location.getX() !== 3268) return null;
    if (id === AL_KHARID_LEAF_SOUTH && location.getY() === 3227) return new GameObject(id, location.clone(), 0, 0, null);
    if (id === AL_KHARID_LEAF_NORTH && location.getY() === 3228) return new GameObject(id, location.clone(), 0, 0, null);
    return null;
  };

  return {
    dialogues, submitted, handlers,
    restore: () => {
      MapObjects.get = originalMapGet;
      World.forEachNetworkPlayer = originalForEachNetworkPlayer;
    },
  };
}

let viewers = [];

function alKharidPlayer(coins, x, y) {
  const attributes = new Map();
  const packets = [];
  const messages = [];
  const steps = [];
  let location = new Location(x, y, 0);
  const player = {
    getInventory: () => ({
      getAmount: (id) => (id === ItemIdentifiers.COINS ? coins : 0),
      deleteNumber: (id, amount) => { if (id === ItemIdentifiers.COINS) coins = Math.max(0, coins - amount); },
    }),
    getCoins: () => coins,
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    getLocation: () => location,
    setLocation: (next) => { location = next; steps.push([next.getX(), next.getY()]); },
    setWalkingDirection: () => {},
    getPacketSender: () => ({
      sendObject: (object) => packets.push(['add', object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]),
      sendObjectRemoval: (object) => packets.push(['del', object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]),
    }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: () => {}, handleRegionChange: () => {} }),
    getForceMovement: () => null,
    setSkillAnimation: () => {},
    performAnimation: () => {},
    getUpdateFlag: () => ({ flag: () => {} }),
    getPrivateArea: () => null,
    getSession: () => ({ isTileInScene: () => true }),
    isRegistered: () => true,
    getHitpoints: () => 10,
    sendMessage: (message) => messages.push(message),
    packets,
    messages,
    steps,
  };
  viewers.push(player);
  return player;
}

/** Ticks a crossing until its walk ends, returning the tiles stepped onto each tick. */
function walkCrossing(task, player) {
  const ticks = [];
  for (let tick = 0; tick < 10 && !task.finished; tick++) {
    const before = player.steps.length;
    task.execute();
    ticks.push(player.steps.slice(before));
  }
  return ticks;
}

const GATE_OPEN_PACKETS = [
  ['del', AL_KHARID_LEAF_SOUTH, 3268, 3227, 0],
  ['del', AL_KHARID_LEAF_NORTH, 3268, 3228, 0],
  ['add', 1571, 3267, 3227, 3],
  ['add', 1572, 3267, 3228, 1],
];
const GATE_CLOSE_PACKETS = [
  ['del', 1571, 3267, 3227, 3],
  ['del', 1572, 3267, 3228, 1],
  ['add', AL_KHARID_LEAF_SOUTH, 3268, 3227, 0],
  ['add', AL_KHARID_LEAF_NORTH, 3268, 3228, 0],
];

function payAtGate(h, player, npcId) {
  h.handlers.custom.get('door:toggle')({
    player, objectId: AL_KHARID_LEAF_SOUTH, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227), handled: false,
  });
  const action = { player, npcId, stepId: 'hyXjU_', handled: false, end: false };
  h.handlers.custom.get('npc-dialogue:action')(action);
  return action;
}

const gateLeaf = (id, y) => new GameObject(id, new Location(3268, y, 0), 0, 0, null);

test('opening the Al Kharid gate talks to the border guard', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(50, 3267, 3227);
    const event = { player, objectId: AL_KHARID_LEAF_SOUTH, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227), handled: false };
    h.handlers.custom.get('door:toggle')(event);
    assert.equal(event.handled, true);
    assert.deepEqual(h.dialogues, [{
      npcId: NpcIdentifiers.BORDER_GUARD, page: 'Border Guard',
      variant: 'before-completing-prince-ali-rescue-quest',
    }]);

    const afterQuest = alKharidPlayer(0, 3269, 3228);
    afterQuest.setAttribute('quest.prince_ali_rescue.stage', 110);
    h.dialogues.length = 0;
    h.handlers.custom.get('door:toggle')({
      player: afterQuest, objectId: AL_KHARID_LEAF_NORTH, object: gateLeaf(AL_KHARID_LEAF_NORTH, 3228), handled: false,
    });
    assert.deepEqual(h.dialogues, [{
      npcId: NpcIdentifiers.BORDER_GUARD_2, page: 'Border Guard',
      variant: 'after-completing-prince-ali-rescue-quest',
    }]);

    const otherDoor = { player, objectId: 12345, object: gateLeaf(12345, 3227), handled: false };
    h.handlers.custom.get('door:toggle')(otherDoor);
    assert.equal(otherDoor.handled, false, 'other doors are left to the Doors plugin');
  } finally {
    h.restore();
  }
});

test('the toll condition reads the backpack coins', () => {
  const h = buildAlKharidHarness();
  try {
    const condition = h.handlers.conditions[0];
    const rich = alKharidPlayer(10, 3267, 3227);
    const poor = alKharidPlayer(9, 3267, 3227);
    assert.equal(condition({ player: rich, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player has 10gp:' }), true);
    assert.equal(condition({ player: rich, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player does not have 10gp:' }), false);
    assert.equal(condition({ player: poor, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player has 10gp:' }), false);
    assert.equal(condition({ player: poor, npcId: NpcIdentifiers.BORDER_GUARD, text: 'If the player does not have 10gp:' }), true);
    assert.equal(condition({ player: rich, npcId: 9999, text: 'If the player has 10gp:' }), null);
  } finally {
    h.restore();
  }
});

test('paying the toll walks the player one tile past the gate line, then shuts it', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3267, 3227);
    const action = payAtGate(h, player, NpcIdentifiers.BORDER_GUARD);
    assert.equal(player.getCoins(), 0);
    assert.equal(action.handled, true);
    assert.deepEqual(player.packets, GATE_OPEN_PACKETS);
    assert.deepEqual(player.steps, [], 'no step on submit, even from a dialogue packet');
    assert.equal(player.getAttribute('agility.obstacle') != null, true, 'the player is locked while crossing');

    const [walk] = h.submitted;
    assert.deepEqual(walkCrossing(walk, player), [[[3268, 3227]], []], 'one tile, onto the leaf tile');
    assert.equal(player.getAttribute('agility.obstacle'), null);
    assert.equal(player.packets.length, 4, 'the gate is still open on arrival');

    const close = h.submitted[1];
    assert.equal(close.getDelay(), 2);
    close.execute();
    assert.deepEqual(player.packets.slice(4), GATE_CLOSE_PACKETS);
  } finally {
    h.restore();
  }
});

test('the gate swings for everyone in view and stays open until the last crossing', () => {
  const h = buildAlKharidHarness();
  try {
    const bystander = alKharidPlayer(0, 3266, 3227);
    const first = alKharidPlayer(10, 3267, 3227);
    const second = alKharidPlayer(10, 3269, 3228);
    payAtGate(h, first, NpcIdentifiers.BORDER_GUARD);
    assert.deepEqual(bystander.packets, GATE_OPEN_PACKETS, 'a bystander sees the gate open');
    payAtGate(h, second, NpcIdentifiers.BORDER_GUARD_2);
    assert.equal(bystander.packets.length, 4, 'an open gate is not re-sent');

    walkCrossing(h.submitted[0], first);
    h.submitted.at(-1).execute();
    assert.equal(bystander.packets.length, 4, 'still open while the second player crosses');

    walkCrossing(h.submitted[1], second);
    h.submitted.at(-1).execute();
    assert.deepEqual(bystander.packets.slice(4), GATE_CLOSE_PACKETS, 'shut after the last one');
  } finally {
    h.restore();
  }
});

test('a player parked on the gate tile from the east walks one tile west', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3268, 3227);
    const action = payAtGate(h, player, NpcIdentifiers.BORDER_GUARD_2);
    assert.equal(action.handled, true);
    assert.deepEqual(walkCrossing(h.submitted[0], player), [[[3267, 3227]], []]);
  } finally {
    h.restore();
  }
});

test('a cancelled crossing still shuts the gate', () => {
  const h = buildAlKharidHarness();
  try {
    const player = alKharidPlayer(10, 3267, 3227);
    payAtGate(h, player, NpcIdentifiers.BORDER_GUARD);
    h.submitted[0].stop();
    assert.equal(player.getAttribute('agility.obstacle'), null);
    h.submitted[1].execute();
    assert.deepEqual(player.packets.slice(4), GATE_CLOSE_PACKETS);
  } finally {
    h.restore();
  }
});

test('clicking Pay-toll pays directly and refuses when the backpack is short', () => {
  const h = buildAlKharidHarness();
  try {
    const handler = h.handlers.object.get('Gate')['Pay-toll(10gp)'];
    const rich = alKharidPlayer(10, 3269, 3227);
    handler({ player: rich, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227) });
    assert.equal(rich.getCoins(), 0);
    assert.equal(rich.packets.length, 4);
    walkCrossing(h.submitted[0], rich);
    assert.deepEqual(rich.steps, [[3268, 3227], [3267, 3227]], 'an east-side player crosses west');

    const poor = alKharidPlayer(4, 3269, 3227);
    const sent = poor.packets.length;
    handler({ player: poor, object: gateLeaf(AL_KHARID_LEAF_SOUTH, 3227) });
    assert.equal(poor.getCoins(), 4);
    assert.equal(poor.packets.length, sent, 'the gate does not open');
    assert.deepEqual(poor.steps, []);
    assert.deepEqual(poor.messages, ["You don't have enough coins."]);
  } finally {
    h.restore();
  }
});

