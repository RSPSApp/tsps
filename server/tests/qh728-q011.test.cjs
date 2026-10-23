// From server/: node --test tests/qh728-q011.test.cjs (after yarn build).
// Focused Clock Tower contracts: black-cog water branch, one-slot receive,
// ground-item removal, and the four cog/spindle mappings.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogues = require('../data/definitions/npc-dialogues.json');
const dialogueIndex = require('../data/definitions/npc-dialogue-index.json');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const drops = [];
  const equipment = new Map();
  let location = new core.Location(0, 0, 0);
  const isFull = () => inventory.getFreeSlots() <= 0;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      const id = item.getId();
      const amount = item.getAmount();
      if (isFull() && !(id === core.ItemIdentifiers.COINS && items.has(id))) {
        drops.push([id, amount]);
        return;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, messages, moves, log, drops,
    setFull(value) {
      const fillers = [...Array(28).keys()].map(index => 900000 + index);
      if (value) {
        for (const id of fillers) {
          if (inventory.getFreeSlots() <= 0) break;
          if (!items.has(id)) items.set(id, 1);
        }
      } else {
        for (const id of fillers) items.delete(id);
      }
    },
    setEquipment(slot, itemId) { equipment.set(slot, itemId ? { getId: () => itemId } : null); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: slot => equipment.get(slot) ?? null }),
    getUsername: () => 'clock-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness(options = {}) {
  const events = {}, emitted = [], variants = [], conditions = [], itemOnObject = [], itemOnGroundItem = [], groundPickup = [], objectInteraction = [];
  const deregistered = [];
  const submittedTasks = [];
  const spawned = [];
  const removedNpcs = [];
  const logins = [];
  const npcs = options.npcs ?? [];
  const objectState = { objects: new Map(), registered: [], deregistered: [] };
  const objectKey = (id, location) => `${id}:${location.x ?? location.getX()},${location.y ?? location.getY()},${location.z ?? location.getZ()}`;
  const testCore = {
    ...core,
    TaskManager: { submit: task => submittedTasks.push(task) },
    MapObjects: {
      get: (id, location) => objectState.objects.get(objectKey(id, location)) ?? null,
    },
    ObjectManager: {
      register: object => {
        objectState.registered.push(object);
        objectState.objects.set(objectKey(object.getId(), object.getLocation()), object);
      },
      deregister: object => {
        objectState.deregistered.push(object);
        objectState.objects.delete(objectKey(object.getId(), object.getLocation()));
      },
    },
  };
  const manager = {
    getGroundItem: () => null,
    deregister: item => { deregistered.push(item); item.removed = true; },
  };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemOnGroundItem: handler => itemOnGroundItem.push(handler),
    onGroundItemPickup: handler => groundPickup.push(handler),
    onObjectInteraction: handler => objectInteraction.push(handler),
    onPlayerLogin: handler => logins.push(handler),
    onInterfaceActionButton: noop,
    getItemOnGroundManager: () => manager,
    getWorld: () => ({ getNpcs: () => npcs }),
    spawnNpc: definition => { spawned.push(definition); return definition; },
    removeNpc: npc => {
      removedNpcs.push(npc);
      const index = npcs.indexOf(npc);
      if (index >= 0) npcs.splice(index, 1);
    },
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => {
      emitted.push({ name: key, event });
      (events[key] ?? []).forEach(handler => handler(event));
    },
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/ClockTower.Quest')(api);
  return { events, emitted, variants, conditions, itemOnObject, itemOnGroundItem, groundPickup, objectInteraction, deregistered,
    submittedTasks, spawned, removedNpcs, npcs, objectState, logins, quest: runtime.getRegisteredQuests().at(-1) };
}

test('black cog with a bucket of water selects the water branch, grants the cog once, and removes the ground item', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  const groundItem = { id: core.ItemIdentifiers.BLACK_COG, removed: false };
  const pickup = { player: p, groundItem, groundItemId: core.ItemIdentifiers.BLACK_COG, handled: false };
  h.groundPickup.forEach(handler => handler(pickup));
  assert.equal(pickup.handled, true, 'the plugin owns the black-cog pickup');

  const condition = h.conditions.at(-1);
  const text = 'If the player does not have a bucket of water or ice gloves equipped:';
  const hasWaterText = 'If the player has a bucket of water or ice gloves equipped:';
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.BROTHER_KOJO, text }), false);
  assert.equal(condition({ player: p, npcId: core.NpcIdentifiers.BROTHER_KOJO, text: hasWaterText }), true);

  const action = { player: p, npcId: core.NpcIdentifiers.BROTHER_KOJO, stepId: 'PVgrzA', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(action));
  assert.equal(action.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.BUCKET_OF_WATER) ?? 0, 0, 'the water is poured out');
  assert.equal(p.items.get(core.ItemIdentifiers.BUCKET) ?? 0, 1, 'the empty bucket remains');
  assert.equal(p.items.get(core.ItemIdentifiers.BLACK_COG) ?? 0, 1, 'exactly one black cog is granted');
  assert.equal(groundItem.removed, true, 'the taken black cog is removed from the ground');
  assert.equal(h.deregistered.length, 1);
});

test('black cog with a full bag is refused without consuming the water or the ground item', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  p.setFull(true);
  const groundItem = { id: core.ItemIdentifiers.BLACK_COG, removed: false };
  const pickup = { player: p, groundItem, groundItemId: core.ItemIdentifiers.BLACK_COG, handled: false };
  h.groundPickup.forEach(handler => handler(pickup));
  assert.equal(pickup.handled, true);
  assert.ok(p.messages.includes('Not enough space in your inventory.'));
  assert.equal(p.items.get(core.ItemIdentifiers.BUCKET_OF_WATER) ?? 0, 1);
  assert.equal(p.items.get(core.ItemIdentifiers.BLACK_COG) ?? 0, 0);
  assert.equal(groundItem.removed, false);
  assert.equal(h.deregistered.length, 0);
});

test('each cog is consumed only by its matching cache spindle and advances one stage', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  const expected = [
    [core.ItemIdentifiers.RED_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_5],
    [core.ItemIdentifiers.BLACK_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_6],
    [core.ItemIdentifiers.WHITE_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_7],
    [core.ItemIdentifiers.BLUE_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_8],
  ];
  for (const [itemId, objectId] of expected) {
    const before = h.quest.getStage(p);
    p.items.set(itemId, 1);
    const use = { player: p, itemId, objectId, handled: false };
    h.itemOnObject.forEach(handler => handler(use));
    assert.equal(use.handled, true);
    assert.equal(p.items.get(itemId) ?? 0, 0, `cog ${itemId} is consumed`);
    assert.equal(h.quest.getStage(p), before + 1, `placing cog ${itemId} advances the stage`);
    assert.ok(p.messages.includes('The cog fits perfectly.'));
  }

  p.items.set(core.ItemIdentifiers.RED_COG, 1);
  const wrong = { player: p, itemId: core.ItemIdentifiers.RED_COG, objectId: core.ObjectIdentifiers.CLOCK_SPINDLE_6, handled: false };
  h.itemOnObject.forEach(handler => handler(wrong));
  assert.equal(p.items.get(core.ItemIdentifiers.RED_COG), 1, 'a wrong spindle does not consume the cog');
  assert.ok(p.messages.includes("The cog doesn't seem to fit."));
  assert.equal(h.quest.getStage(p), 5);
});

test('fresh stage 0 reaches completion through the mandatory helper legs', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.NpcIdentifiers.BROTHER_KOJO;
  // Fixture: only supplies/prerequisites are added below. Cogs and poison are
  // injected where the core ground-item pickup would hand them to the player.
  p.items.set(core.ItemIdentifiers.BUCKET_OF_WATER, 1);
  p.setLocation(2576, 9631, 0);

  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');
  const start = { player: p, npcId: K, hook: 'quest:clock-tower:start', handled: false };
  h.events['npc-dialogue:hook'].forEach(handler => handler(start));
  assert.equal(h.quest.getStage(p), 1, 'Kojo start hook');

  const wall = { player: p, objectId: core.ObjectIdentifiers.WALL_5, location: { x: 2575, y: 9631, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(wall));
  assert.equal(wall.handled, true, 'the blue-cog cell wall is pushable');
  assert.deepEqual(p.moves.at(-1), [2574, 9631, 0], 'pushing the wall enters the cell');
  const otherWall = { player: p, objectId: core.ObjectIdentifiers.WALL_5, location: { x: 2643, y: 9892, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(otherWall));
  assert.equal(otherWall.handled, false, 'the shared Wall id is scoped to the Clock Tower tile');

  const pick = id => {
    const pickup = { player: p, groundItem: { id }, groundItemId: id, handled: false };
    h.groundPickup.forEach(handler => handler(pickup));
    assert.equal(pickup.handled, false, `cog ${id} pickup stays with the core inventory pickup`);
    p.items.set(id, 1);
  };
  const place = (itemId, objectId) => {
    const use = { player: p, itemId, objectId, handled: false };
    h.itemOnObject.forEach(handler => handler(use));
    assert.equal(use.handled, true);
    assert.equal(p.items.get(itemId) ?? 0, 0, `cog ${itemId} is consumed`);
  };

  pick(core.ItemIdentifiers.RED_COG);
  place(core.ItemIdentifiers.RED_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_5);
  assert.equal(h.quest.getStage(p), 2, 'red cog placed');

  pick(core.ItemIdentifiers.BLUE_COG);
  place(core.ItemIdentifiers.BLUE_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_8);
  assert.equal(h.quest.getStage(p), 3, 'blue cog placed');

  const blackGround = { id: core.ItemIdentifiers.BLACK_COG, removed: false };
  const blackPickup = { player: p, groundItem: blackGround, groundItemId: core.ItemIdentifiers.BLACK_COG, handled: false };
  h.groundPickup.forEach(handler => handler(blackPickup));
  assert.equal(blackPickup.handled, true);
  const condition = h.conditions.at(-1);
  assert.equal(condition({ player: p, npcId: K, text: 'If the player does not have a bucket of water or ice gloves equipped:' }), false);
  assert.equal(condition({ player: p, npcId: K, text: 'If the player has a bucket of water or ice gloves equipped:' }), true);
  const receive = { player: p, npcId: K, stepId: 'PVgrzA', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(receive));
  assert.equal(p.items.get(core.ItemIdentifiers.BLACK_COG), 1);
  assert.equal(blackGround.removed, true);
  place(core.ItemIdentifiers.BLACK_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_6);
  assert.equal(h.quest.getStage(p), 4, 'black cog placed');

  p.items.set(core.ItemIdentifiers.RAT_POISON, 1);
  const earlyTrough = { player: p, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { x: 2586, y: 9654, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(earlyTrough));
  assert.equal(earlyTrough.handled, true);
  assert.ok(p.messages.includes('The rat cage is still closed. Pull the lever first.'));
  assert.equal(p.items.get(core.ItemIdentifiers.RAT_POISON), 1, 'unpulled lever does not consume poison');

  const cageGate = { player: p, objectId: core.ObjectIdentifiers.GATE, location: { x: 2595, y: 9657, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(cageGate));
  assert.equal(cageGate.handled, false, 'ordinary cage gates stay with Doors');

  const leverLocation = new core.Location(2591, 9661, 0);
  h.objectState.objects.set('33:2591,9661,0', {
    getId: () => core.ObjectIdentifiers.LEVER,
    getType: () => 4,
    getFace: () => 3,
    getLocation: () => leverLocation,
  });
  const lever = { player: p, objectId: core.ObjectIdentifiers.LEVER, location: { x: 2591, y: 9661, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(lever));
  assert.equal(lever.handled, true);
  assert.equal(h.objectState.objects.has('33:2591,9661,0'), false, 'lever A base object is replaced');
  assert.equal(h.objectState.objects.get('35:2591,9661,0')?.getId(), 35, 'QH CTLEVERA2 is now present');

  const wrongTroughs = [
    { x: 1574, y: 3140 },
    { x: 1579, y: 3138 },
  ];
  for (const at of wrongTroughs) {
    const wrongTrough = { player: p, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { ...at, z: 0 }, handled: false };
    h.itemOnObject.forEach(handler => handler(wrongTrough));
    assert.equal(wrongTrough.handled, false, `unrelated Food trough ${at.x},${at.y} is not Clock Tower's`);
  }
  assert.equal(p.items.get(core.ItemIdentifiers.RAT_POISON), 1, 'unrelated troughs do not consume the poison');
  const trough = { player: p, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { x: 2586, y: 9654, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(trough));
  assert.equal(trough.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.RAT_POISON) ?? 0, 0, 'poison is consumed');

  p.setLocation(2580, 9656, 0);
  const gateLocation = new core.Location(2579, 9656, 0);
  h.objectState.objects.set('39:2579,9656,0', {
    getId: () => core.ObjectIdentifiers.GATE_3,
    getType: () => 0,
    getFace: () => 0,
    getLocation: () => gateLocation,
  });
  const movesBeforeGate = p.moves.length;
  const whiteGate = { player: p, objectId: core.ObjectIdentifiers.GATE_3, location: { x: 2579, y: 9656, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(whiteGate));
  assert.equal(whiteGate.handled, true);
  const doorCondition = { player: p, npcId: K, stepId: 'D5rCfO', handled: false };
  h.events['npc-dialogue:condition'].forEach(handler => handler(doorCondition));
  assert.equal(p.moves.length, movesBeforeGate, 'the unhinged gate is not a teleport');
  assert.equal(h.objectState.objects.has('39:2579,9656,0'), false, 'the unhinged gate object is removed');
  p.setLocation(2578, 9656, 0); // fixture: walk through the removed gate

  pick(core.ItemIdentifiers.WHITE_COG);
  p.setLocation(2576, 9655, 0);
  const movesBeforeLadder = p.moves.length;
  const exitLadder = { player: p, objectId: 17385, location: { x: 2575, y: 9655, z: 0 }, option: 'Climb-up', handled: false };
  h.objectInteraction.forEach(handler => handler(exitLadder));
  assert.equal(exitLadder.handled, true, 'the white-cog surface ladder is handled');
  assert.equal(p.moves.length, movesBeforeLadder, 'the quest handler does not teleport directly');
  const climb = h.emitted.find(entry => entry.name === 'ladders:climbUp');
  assert.deepEqual(climb?.event.destination, new core.Location(2575, 3255, 0), 'one-way exit goes to the surface trapdoor');
  const otherLadder = { player: p, objectId: 17385, location: { x: 2566, y: 9642, z: 0 }, option: 'Climb-up', handled: false };
  h.objectInteraction.forEach(handler => handler(otherLadder));
  assert.equal(otherLadder.handled, false, 'the ladder route is scoped to the white-cog exit');
  p.setLocation(2575, 3255, 0); // fixture after the shared Ladders dispatch
  place(core.ItemIdentifiers.WHITE_COG, core.ObjectIdentifiers.CLOCK_SPINDLE_7);
  assert.equal(h.quest.getStage(p), 5, 'all four cogs placed');

  const complete = { player: p, npcId: K, stepId: 'ihG17v', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(complete));
  assert.equal(complete.handled, true);
  assert.equal(complete.end, true);
  assert.equal(h.quest.getStage(p), 6, 'quest complete');
  assert.equal(p.items.get(core.ItemIdentifiers.COINS), 500, '500 coins rewarded');
  const completionWire = p.log.filter(row => row[0] === 'sendConfig' && row[1] === 10).at(-1)?.[2];
  assert.equal(completionWire, 8, 'completion is sent on varp 10 at the cached threshold');
  assert.deepEqual(
    h.variants.at(-1)({ player: p, npcId: K }),
    { page: 'Brother Kojo', variant: 'after-clock-tower' },
    'completed players get the canonical post-quest page/variant'
  );

  const repeat = { player: p, npcId: K, stepId: 'ihG17v', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(repeat));
  assert.equal(p.items.get(core.ItemIdentifiers.COINS), 500, 'completion grants the reward once');
  assert.equal(h.quest.getStage(p), 6);
});


test('Brother Kojo watch route uses the canonical chart/sextant variant and grants the watch', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.NpcIdentifiers.BROTHER_KOJO;
  const selector = h.variants.at(-1);
  // Fixture: the chart and sextant are prerequisites for the watch dialogue.
  p.items.set(core.ItemIdentifiers.SEXTANT, 1);
  p.items.set(core.ItemIdentifiers.CHART, 1);

  assert.deepEqual(
    selector({ player: p, npcId: K }),
    { page: 'Brother Kojo', variant: 'with-a-chart-and-sextant-in-the-inventory' },
    'the watch route wins before the quest starts'
  );

  const page = dialogues['Brother Kojo'];
  assert.ok(page.variants['with-a-chart-and-sextant-in-the-inventory'].some(step => step.text === 'Brother Kojo has given you a watch.'));
  assert.ok(dialogueIndex['3606'].some(entry => entry.page === 'Transcript:Brother Kojo' &&
    entry.variants.includes('with-a-chart-and-sextant-in-the-inventory')), 'the generated index exposes the natural page/variant');

  const receive = { player: p, npcId: K, stepId: '-2P78v', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(receive));
  assert.equal(receive.handled, true);
  assert.equal(p.items.get(core.ItemIdentifiers.WATCH), 1, 'the watch is granted once');

  h.quest.setStage(p, 6);
  assert.deepEqual(
    selector({ player: p, npcId: K }),
    { page: 'Brother Kojo', variant: 'after-clock-tower' },
    'an owned watch falls back to the post-quest dialogue'
  );
});

test('black cog water path accepts the cache jug of water and returns the empty jug', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.NpcIdentifiers.BROTHER_KOJO;
  h.quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.JUG_OF_WATER, 1);
  const groundItem = { id: core.ItemIdentifiers.BLACK_COG, removed: false };
  const pickup = { player: p, groundItem, groundItemId: core.ItemIdentifiers.BLACK_COG, handled: false };
  h.groundPickup.forEach(handler => handler(pickup));
  assert.equal(pickup.handled, true);
  const condition = h.conditions.at(-1);
  assert.equal(condition({ player: p, npcId: K, text: 'If the player does not have a bucket of water or ice gloves equipped:' }), false);
  assert.equal(condition({ player: p, npcId: K, text: 'If the player has a bucket of water or ice gloves equipped:' }), true);
  const receive = { player: p, npcId: K, stepId: 'PVgrzA', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(receive));
  assert.equal(p.items.get(core.ItemIdentifiers.JUG_OF_WATER) ?? 0, 0);
  assert.equal(p.items.get(core.ItemIdentifiers.JUG) ?? 0, 1, 'the empty jug is returned');
  assert.equal(p.items.get(core.ItemIdentifiers.BLACK_COG), 1);
  assert.equal(groundItem.removed, true);
});

test('Smiths gloves (i) are accepted as the equipped cool-cog alternative', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.setEquipment(core.Equipment.HANDS_SLOT, core.ItemIdentifiers.SMITHS_GLOVES_I_);
  const pickup = { player: p, groundItem: { id: core.ItemIdentifiers.BLACK_COG }, groundItemId: core.ItemIdentifiers.BLACK_COG, handled: false };
  h.groundPickup.forEach(handler => handler(pickup));
  assert.equal(pickup.handled, false, 'core pickup takes the cooled cog');
  assert.ok(p.messages.includes('The ice gloves cool down the cog. You can carry it now.'));
});

test('500-coin reward is delivered exactly once, including a full bag', () => {
  const K = core.NpcIdentifiers.BROTHER_KOJO;
  const completeAction = (h, p) => {
    const complete = { player: p, npcId: K, stepId: 'ihG17v', handled: false };
    h.events['npc-dialogue:action'].forEach(handler => handler(complete));
    return complete;
  };

  const dropped = harness();
  const fullPlayer = makePlayer();
  dropped.quest.setStage(fullPlayer, 5);
  fullPlayer.setFull(true);
  completeAction(dropped, fullPlayer);
  assert.deepEqual(fullPlayer.drops, [[core.ItemIdentifiers.COINS, 500]], 'one 500-coin stack drops');
  assert.equal(fullPlayer.items.get(core.ItemIdentifiers.COINS) ?? 0, 0, 'nothing is added to the full bag');
  completeAction(dropped, fullPlayer);
  assert.deepEqual(fullPlayer.drops, [[core.ItemIdentifiers.COINS, 500]], 'repeating the completion action adds no second reward');

  const merged = harness();
  const stackedPlayer = makePlayer();
  merged.quest.setStage(stackedPlayer, 5);
  stackedPlayer.items.set(core.ItemIdentifiers.COINS, 100);
  stackedPlayer.setFull(true);
  completeAction(merged, stackedPlayer);
  assert.equal(stackedPlayer.items.get(core.ItemIdentifiers.COINS), 600, 'an existing coin stack receives the whole reward');
  assert.deepEqual(stackedPlayer.drops, [], 'no ground drop when a coin stack can absorb the reward');
});

test('both levers use the cache transforms and replay from durable bits on login', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  for (const [id, x] of [[33, 2591], [34, 2593]]) {
    h.objectState.objects.set(`${id}:${x},9661,0`, {
      getId: () => id,
      getType: () => 4,
      getFace: () => 3,
      getLocation: () => new core.Location(x, 9661, 0),
    });
    const lever = { player: p, objectId: id, location: { x, y: 9661, z: 0 }, handled: false };
    h.objectInteraction.forEach(handler => handler(lever));
    assert.equal(lever.handled, true);
  }
  assert.equal(h.objectState.objects.get('35:2591,9661,0')?.getId(), 35);
  assert.equal(h.objectState.objects.get('36:2593,9661,0')?.getId(), 36);
  assert.equal((Number(p.getAttribute('quest.clock_tower.bits')) & 0x40), 0x40, 'lever A bit');
  assert.equal((Number(p.getAttribute('quest.clock_tower.bits')) & 0x80), 0x80, 'lever B bit');

  // A fresh world replays both transformed objects from the same durable player.
  const replay = harness();
  replay.objectState.objects.set('33:2591,9661,0', {
    getId: () => 33, getType: () => 4, getFace: () => 3,
    getLocation: () => new core.Location(2591, 9661, 0),
  });
  replay.objectState.objects.set('34:2593,9661,0', {
    getId: () => 34, getType: () => 4, getFace: () => 3,
    getLocation: () => new core.Location(2593, 9661, 0),
  });
  replay.logins.forEach(handler => handler({ player: p }));
  assert.equal(replay.objectState.objects.get('35:2591,9661,0')?.getId(), 35);
  assert.equal(replay.objectState.objects.get('36:2593,9661,0')?.getId(), 36);
});

test('an already-transformed shared lever lets a second player poison the canonical trough', () => {
  const h = harness();
  const a = makePlayer();
  h.quest.setStage(a, 1);
  h.objectState.objects.set('33:2591,9661,0', {
    getId: () => 33, getType: () => 4, getFace: () => 3,
    getLocation: () => new core.Location(2591, 9661, 0),
  });
  const lever = { player: a, objectId: 33, location: { x: 2591, y: 9661, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(lever));
  assert.equal(h.objectState.objects.get('35:2591,9661,0')?.getId(), 35, 'player A raised the shared lever');

  const b = makePlayer();
  h.quest.setStage(b, 1);
  b.items.set(core.ItemIdentifiers.RAT_POISON, 1);
  assert.equal(Number(b.getAttribute('quest.clock_tower.bits')) || 0, 0, 'player B has no personal lever bit');
  const trough = { player: b, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { x: 2586, y: 9654, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(trough));
  assert.equal(trough.handled, true);
  assert.equal(b.items.get(core.ItemIdentifiers.RAT_POISON) ?? 0, 0, 'player B poisons the canonical trough');
  assert.equal((Number(b.getAttribute('quest.clock_tower.bits')) & 0x20), 0x20, 'player B gets only the rat-poison bit');
  assert.equal((Number(b.getAttribute('quest.clock_tower.bits')) & 0x40), 0, 'player B still has no lever bit');
});

test('the trough is refused while the shared lever is down, even with a personal bit', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.RAT_POISON, 1);
  p.setAttribute('quest.clock_tower.bits', 1 << 6); // personal stale bit, world lever down
  const trough = { player: p, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { x: 2587, y: 9654, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(trough));
  assert.equal(trough.handled, true);
  assert.ok(p.messages.includes('The rat cage is still closed. Pull the lever first.'));
  assert.equal(p.items.get(core.ItemIdentifiers.RAT_POISON), 1);
  assert.equal((Number(p.getAttribute('quest.clock_tower.bits')) & 0x20), 0);
});

test('poisoned dungeon rats play their death animation, die, and respawn after 25 ticks', () => {
  const animations = [];
  const rat = (id, x, y) => ({
    getId: () => id,
    getLocation: () => new core.Location(x, y, 0),
    getCurrentDefinition: () => ({ getDeathAnim: () => 4935, getDeathTicks: () => 2 }),
    performAnimation: animation => animations.push([id, animation.getId()]),
    getMovementQueue: () => ({ setBlockMovement: noop, reset: noop }),
    getCombat: () => ({ reset: noop }),
  });
  const rats = [rat(3607, 2579, 9655), rat(3608, 2581, 9656)];
  const h = harness({ npcs: rats });
  const p = makePlayer();
  h.quest.setStage(p, 1);
  p.items.set(core.ItemIdentifiers.RAT_POISON, 1);

  h.objectState.objects.set('33:2591,9661,0', {
    getId: () => core.ObjectIdentifiers.LEVER,
    getType: () => 4,
    getFace: () => 3,
    getLocation: () => new core.Location(2591, 9661, 0),
  });
  const lever = { player: p, objectId: core.ObjectIdentifiers.LEVER, location: { x: 2591, y: 9661, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(lever));
  const trough = { player: p, itemId: core.ItemIdentifiers.RAT_POISON, objectId: core.ObjectIdentifiers.FOOD_TROUGH, location: { x: 2586, y: 9654, z: 0 }, handled: false };
  h.itemOnObject.forEach(handler => handler(trough));

  assert.deepEqual(animations, [[3607, 4935], [3608, 4935]], 'dungeon rat death animation 4935');
  assert.equal(h.removedNpcs.length, 0, 'rats stay in the world for the death animation');
  assert.equal(h.submittedTasks.length, 1);
  assert.equal(h.submittedTasks[0].getDelay(), 2, 'engine death ticks');
  h.submittedTasks[0].execute();
  assert.equal(h.removedNpcs.length, 2, 'all Clock Tower dungeon rats die');
  assert.equal(h.submittedTasks.length, 2);
  assert.equal(h.submittedTasks[1].getDelay(), 23, 'remaining ticks to the Wiki 25-tick respawn');
  h.submittedTasks[1].execute();
  assert.deepEqual(h.spawned, [
    { id: 3607, x: 2579, y: 9655, z: 0, wanderRadius: 0 },
    { id: 3608, x: 2581, y: 9656, z: 0, wanderRadius: 0 },
  ]);
});

test('Clock Tower helper stage keys map to durable stages and varp 10 edges and login replay', () => {
  const h = harness();
  const p = makePlayer();
  const wire = () => p.log.filter(row => row[0] === 'sendConfig' && row[1] === 10).at(-1)?.[2];
  // Helper loadSteps keys: 0 start, 1-4 in progress, 5/6/7 finish. The plugin
  // owns durable 0-6, with 5 = all cogs and 6 = complete. Cache DB row 14
  // column 19 requires native varp 10 >= 8 for completion.
  for (let stage = 0; stage <= 5; stage++) {
    h.quest.setStage(p, stage);
    assert.equal(h.quest.varpValue(stage, p), stage);
    assert.equal(wire(), stage, `stage ${stage} is mirrored to varp 10`);
  }
  h.quest.setStage(p, 6);
  assert.equal(h.quest.varpValue(6, p), 8);
  assert.equal(wire(), 8, 'durable completion stage 6 is sent as native varp 10 = 8');
  assert.equal(h.quest.varbitId, undefined, 'Clock Tower is a varp stage, not a varbit');
  assert.equal(h.quest.isComplete(p), true);

  // A save that already holds helper key 7 must remain complete and replay at 8.
  h.quest.setStage(p, 7);
  assert.equal(wire(), 8);
  assert.equal(h.quest.isComplete(p), true);

  h.quest.setStage(p, 6);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wire(), 8, 'login replay maps old durable completion stage 6 to native 8');
});
