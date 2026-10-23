// From server/: node --test tests/qh728-q019.test.cjs (no build needed; plugins load from source).
// QH q019 The Depths of Despair: source-contract audit. The route test fixtures the
// prerequisites and starting stage 0, then dispatches the registered handlers and
// real transcript step ids in order. It is a handler contract test, not a live
// playthrough, and it does not prove travel, scene placement or the Java overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};
const { MovementQueue } = require(root + '/dist/game/model/movement/MovementQueue');
const { MapObjects } = require(root + '/dist/game/entity/impl/object/MapObjects');
const { ObjectDefinition } = require(root + '/dist/game/definition/ObjectDefinition');
const { RegionManager } = require(root + '/dist/game/collision/RegionManager');

const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const N = core.NpcIdentifiers;
const VARBIT_STAGE = 6027;
const VARBIT_REWARD = 6028;
const VARBIT_ARTUR_HOME = 12153;
const VARBIT_PAGE_ADDED = 7918;
const QUEST_STAGE_ATTRIBUTE = 'quest.the_depths_of_despair.stage';
// The native wire (Quest Helper's loadSteps keys) names the next action: 4 enter
// the caves, 6 descend them, 7 speak to Artur, 8 kill the snake, 9 search the
// chest, 10 return to the Lord, 11 complete.
const CANONICAL_WIRE = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 8, 6: 9, 7: 10, 8: 10, 9: 11 };
const transcripts = [];

// The obstacle/chest handlers hand the words to startTranscript. Capture the call
// so the chest recovery contract can be asserted without replaying the transcript.
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

let H;

before(async () => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  await CachePipeline.initialize(root);
  H = harness();
});

function makePlayer({ freeSlots = 28, levels = new Map(), clientOfKourend = true } = {}) {
  const attributes = new Map();
  const items = new Map();
  const sends = [];
  const varbits = new Map();
  const messages = [];
  const xp = [];
  const moves = [];
  const spawned = [];
  const removed = [];
  let location = new core.Location(1782, 3571, 0);
  let free = freeSlots;
  const sender = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'sendVarbit') {
        return (id, value) => { sends.push(['varbit', id, value]); varbits.set(id, value); return sender; };
      }
      if (prop === 'getVarbit') return (id) => varbits.get(id) ?? 0;
      return (...args) => { sends.push([String(prop), ...args]); return sender; };
    },
  });
  const p = {
    items, attrs: attributes, sends, varbits, messages, xp, moves, spawned, removed,
    clientOfKourend,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'QH q019',
    isPlayer: () => true,
    isNpc: () => false,
    getLocation: () => location,
    moveTo: (to) => { location = to; moves.push([to.getX(), to.getY(), to.getZ()]); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(String(message)),
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, reset: noop }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => levels.get(skill.getIndex()) ?? 99,
      getCurrentLevel: (skill) => levels.get(skill.getIndex()) ?? 99,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      isFull: () => free <= 0,
      getFreeSlots: () => free,
      getItems: () => [],
      adds: (id, amount = 1) => {
        if (!items.has(id)) {
          if (free <= 0) {
            messages.push("You couldn't hold all those items.");
            return;
          }
          free--;
        }
        items.set(id, (items.get(id) ?? 0) + amount);
      },
      forceAdd: (item) => items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()),
      deleteNumber: (id, amount = 1) => {
        const before = items.get(id) ?? 0;
        const after = Math.max(0, before - amount);
        if (before > 0 && after === 0) free++;
        items.set(id, after);
      },
    }),
    getEquipment: () => ({ get: () => null, getAmount: () => 0, getItems: () => [] }),
    setFreeSlots(value) { free = value; },
    setFull() { free = 0; },
  };
  return p;
}

const DEPTHS_PLUGIN = root + '/plugins/quests/quests/DepthsOfDespair.Quest';
const AKD_PLUGIN = root + '/plugins/quests/quests/AKingdomDivided.Quest';

function harness(plugins = [DEPTHS_PLUGIN]) {
  const hooks = {};
  const spawned = [];
  const removed = [];
  const questsBefore = new Set(runtime.getRegisteredQuests());
  const api = new Proxy({
    core: { ...core, TaskManager: undefined },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (hooks[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => {
      if (key === 'quest:is-complete' && event?.key === 'client_of_kourend') {
        event.complete = H?.player?.clientOfKourend ?? true;
        return;
      }
      if (key === 'quest:get-stage' && event?.player) {
        const quest = runtime.getRegisteredQuests().find((entry) =>
          !questsBefore.has(entry) && entry.key === event.key);
        if (quest) event.stage = quest.getStage(event.player);
      }
      (hooks[key] ?? []).forEach((fn) => fn(event));
    },
    spawnNpc: (definition) => {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        isRegistered: () => true,
        getOwner: () => definition.owner ?? null,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { removed.push(npc); },
  }, {
    get: (target, key) => target[key] ?? ((...args) => {
      const fn = args.find((arg) => typeof arg === 'function');
      (hooks[key] ??= []).push({ args, fn });
    }),
  });
  // The registered order matters: Quests.plugin.js registers A Kingdom Divided
  // before The Depths of Despair, so AKD answers the shared NPCs first.
  for (const plugin of plugins) require(plugin)(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_depths_of_despair');
  const call = (key, event) => {
    for (const entry of hooks[key] ?? []) (typeof entry === 'function' ? entry : entry.fn)?.(event);
  };
  return { api, hooks, spawned, removed, quest, call, player: null };
}

/** PluginManager.emitNpcDialogueVariant: the first registered plugin that answers wins. */
function dispatchVariant(harnessRef, event) {
  for (const entry of harnessRef.hooks.onNpcDialogueVariant ?? []) {
    const result = (typeof entry === 'function' ? entry : entry.fn)?.(event);
    if (result) return result;
  }
  return null;
}

function npcAt(x, y, z = 0) {
  return { getLocation: () => new core.Location(x, y, z) };
}

function questIdOf(player) {
  return H.quest.getStage(player);
}

test('Lord hand-in completes on canonical varbit 6027 = 11 and rewards once', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 8);
  p.items.set(I.ROYAL_ACCORD_OF_TWILL, 1);
  p.sends.length = 0;

  const action = { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, stepId: '2AuI1C', handled: false };
  H.call('npc-dialogue:action', action);

  assert.equal(action.handled, true);
  assert.equal(questIdOf(p), 9, 'durable stage 9');
  assert.equal(p.varbits.get(VARBIT_STAGE), 11, 'cache completion threshold is 11');
  assert.equal(p.varbits.get(VARBIT_REWARD), 1, 'reward flag 6028 is sent');
  assert.equal(p.items.get(I.ROYAL_ACCORD_OF_TWILL) ?? 0, 0, 'the Accord is taken');
  assert.equal(p.items.get(I.COINS) ?? 0, 4000);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 1);
  assert.deepEqual(p.xp, [[core.Skill.AGILITY.getIndex(), 1500]]);
  assert.equal(p.getAttribute(runtime.QUEST_POINTS_ATTRIBUTE), 1);

  H.call('npc-dialogue:action', { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, stepId: '2AuI1C', handled: false });
  assert.equal(p.items.get(I.COINS) ?? 0, 4000, 'repeat adds no coins');
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 1, 'repeat adds no page');
  assert.equal(p.xp.length, 1, 'repeat adds no XP');
});

test('login replays canonical wire values for every existing durable stage', () => {
  for (let stage = 0; stage <= 9; stage++) {
    const p = makePlayer();
    p.attrs.set(QUEST_STAGE_ATTRIBUTE, stage);
    p.sends.length = 0;
    for (const hook of H.hooks.onPlayerLogin ?? []) hook.fn?.({ player: p });
    assert.equal(p.varbits.get(VARBIT_STAGE), CANONICAL_WIRE[stage], `stage ${stage} -> varbit ${CANONICAL_WIRE[stage]}`);
    assert.equal(p.varbits.get(VARBIT_ARTUR_HOME), stage >= 8 ? 1 : 0, `Artur visibility at stage ${stage}`);
    assert.equal(p.varbits.get(VARBIT_REWARD), stage >= 9 ? 1 : 0, `reward flag at stage ${stage}`);
  }
});

test('requirements gate the start hook and its prose conditions', () => {
  const p = makePlayer({ levels: new Map([[core.Skill.AGILITY.getIndex(), 18]]), clientOfKourend: false });
  H.player = p;
  const start = () => H.call('npc-dialogue:hook', { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, hook: 'quest:the-depths-of-despair:start' });

  start();
  assert.equal(questIdOf(p), 0, 'missing Client of Kourend cannot start');
  p.clientOfKourend = true;
  p.getSkillManager = () => ({ getMaxLevel: () => 17, getCurrentLevel: () => 17, addExperiences: noop });
  start();
  assert.equal(questIdOf(p), 0, '17 Agility cannot start');
  p.getSkillManager = () => ({ getMaxLevel: () => 18, getCurrentLevel: () => 18, addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]) });
  start();
  assert.equal(questIdOf(p), 1, '18 Agility plus Client of Kourend starts');

  const condition = H.hooks.onNpcDialogueCondition.at(-1).fn;
  assert.equal(condition({ player: p, stepId: 'TrbpPj' }), true);
  assert.equal(condition({ player: p, stepId: 'Kac5Aj' }), false);
  p.items.set(I.VARLAMORE_ENVOY, 1);
  assert.equal(condition({ player: p, stepId: 'WQKVh4' }), true);
  p.items.set(I.ROYAL_ACCORD_OF_TWILL, 1);
  assert.equal(condition({ player: p, stepId: 'AsCy-M' }), true);
  assert.equal(condition({ player: p, stepId: 'ke_p6B' }), false);
  p.setFull();
  assert.equal(condition({ player: p, stepId: '5rX0VQ' }), true);
});

test('stage-0 handler graph reaches completion with the helper leg wire values', () => {
  const p = makePlayer({ levels: new Map([[core.Skill.AGILITY.getIndex(), 18]]) });
  H.player = p;
  const wire = () => p.varbits.get(VARBIT_STAGE);

  H.call('npc-dialogue:hook', { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, hook: 'quest:the-depths-of-despair:start' });
  assert.equal(questIdOf(p), 1); assert.equal(wire(), 1);

  H.call('npc-dialogue:line', { player: p, npcId: N.CHEF_OLIVIA, text: "He's been spending a lot of time in the Arceuus Library recently" });
  assert.equal(questIdOf(p), 2); assert.equal(wire(), 2);

  H.call('npc-dialogue:line', { player: p, npcId: N.GALANA, text: 'It details how the original Accord was lost.' });
  assert.equal(questIdOf(p), 3); assert.equal(wire(), 3);

  p.items.set(I.VARLAMORE_ENVOY, 1);
  const read = { player: p, itemId: I.VARLAMORE_ENVOY, option: 'Read', handled: false };
  H.call('onItemAction', read);
  assert.equal(read.handled, true);
  assert.equal(questIdOf(p), 4); assert.equal(wire(), 4);

  const entrance = { player: p, objectId: O.CAVE_58, handled: false };
  H.call('onObjectInteraction', entrance);
  assert.equal(entrance.handled, true);
  H.call('npc-dialogue:action', { player: p, stepId: 'GL3IJy', handled: false });
  assert.equal(wire(), 6, 'inside the caves is helper stage 6');

  const tunnel = { player: p, objectId: O.TUNNEL_ENTRANCE_2, handled: false };
  H.call('onObjectInteraction', tunnel);
  H.call('npc-dialogue:action', { player: p, stepId: 'Y4ZprR', handled: false });
  assert.equal(wire(), 7, 'Artur waits downstairs, helper stage 7');

  const caveArtur = npcAt(1681, 9748, 0);
  H.call('npc-dialogue:line', { player: p, npcId: N.ARTUR_HOSIDIUS, npc: caveArtur, text: "Typical. Fine, I'll kill the snake. Just wait here." });
  assert.equal(questIdOf(p), 5); assert.equal(wire(), 8, 'met Artur, so the snake is next: helper stage 8');

  H.call('onZoneEnter', { player: p });
  const snake = H.spawned.find((npc) => npc.id === N.SAND_SNAKE_2);
  assert.ok(snake, 'the Sand Snake is owner-spawned in the cave');
  H.call('onNpcDeath', { player: p, npcId: N.SAND_SNAKE_2, killer: p, npc: snake });
  assert.equal(questIdOf(p), 6); assert.equal(wire(), 9, 'snake killed, so the chest is next: helper stage 9');

  const chest = { player: p, stepId: 'b_bfNd', handled: false };
  H.call('npc-dialogue:action', chest);
  assert.equal(p.items.get(I.ROYAL_ACCORD_OF_TWILL) ?? 0, 1);
  assert.equal(questIdOf(p), 7); assert.equal(wire(), 10, 'Accord looted, so the Lord is next: helper stage 10');

  H.call('npc-dialogue:line', { player: p, npcId: N.ARTUR_HOSIDIUS, npc: caveArtur, text: "Eugh. Fine, I'll go home. But you'd better not run off with the Accord." });
  assert.equal(questIdOf(p), 8); assert.equal(wire(), 10, 'Artur home, still the Lord: helper stage 10');

  H.call('npc-dialogue:action', { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, stepId: '2AuI1C', handled: false });
  assert.equal(questIdOf(p), 9); assert.equal(wire(), 11, 'final hand-in meets the cache threshold');
});

test('canonical stepping-stone banks dispatch the ordinary Cross action through MovementQueue', async (t) => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  const { TaskManager } = require(root + '/dist/game/task/TaskManager');
  const { World } = require(root + '/dist/game/World');

  await CachePipeline.initialize(root);
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(1709, 9800, true);

  const eastBank = new core.Location(1709, 9800, 0);
  const stone = MapObjects.get(O.STEPPING_STONE_38, new core.Location(1706, 9800, 0), null);
  assert.ok(stone, 'the real map places the east stepping stone at 1706,9800');
  assert.equal(stone.getType(), 22);
  assert.equal(ObjectDefinition.forId(O.STEPPING_STONE_38).getInteractions()[0], 'Cross');
  assert.equal(RegionManager.canMovestart(new core.Location(1708, 9800, 0), eastBank, 1, 1, null), true,
    'the actual east bank tile is reachable over cache collision');
  assert.equal(RegionManager.canMovestart(new core.Location(1702, 9800, 0), new core.Location(1701, 9800, 0), 1, 1, null), true,
    'the actual west bank tile is reachable over cache collision');

  const H = harness();
  const routeHandler = H.hooks.onObjectRoute.at(-1).fn;
  const p = makePlayer();
  p.setLocation(1708, 9800, 0);
  const setPlayerLocation = p.setLocation.bind(p);
  H.player = p;
  H.quest.setStage(p, 4);
  Object.assign(p, {
    isPlayer: () => true, isNpc: () => false, getAsPlayer() { return this; },
    getIndex: () => 19019, getSize: () => 1, getPrivateArea: () => null,
    getHitpoints: () => 99, getRights: () => -1, isPlayerBot: () => false,
    getInventory: () => ({ capacity: () => 28, getItems: () => [] }),
    getFollowing: () => null, getTimers: () => ({ has: () => false }),
    getCombat: () => ({ setCastSpell: noop, reset: noop }),
    getSkillManager: () => ({ stopSkillable: noop }),
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    setPositionToFace: noop, setDirection: noop, setWalkingDirection: noop, setRunningDirection: noop,
    setLocation(location) { setPlayerLocation(location.getX(), location.getY(), location.getZ()); },
    sendMessage: noop, isRunningReturn: () => false, setRunning: noop,
  });

  t.mock.method(PluginManager, 'emitObjectRoute', (event) => routeHandler(event));
  const oldCycle = World.processCycle;
  t.after(() => { World.processCycle = oldCycle; TaskManager.cancelTasks(p.getIndex()); });
  const queue = new MovementQueue(p);
  p.getMovementQueue = () => queue;
  queue.getMobility = () => ({ canMove: () => true });
  queue.checkDestination = () => true;
  queue.walkToReset = noop;
  queue.handleRegionChange = noop;
  queue.syncWildernessStateForMovedPlayer = noop;
  queue.drainRunEnergy = noop;

  const dispatched = { player: p, objectId: stone.getId(), clickType: 1, option: 'cross', handled: false };
  queue.walkToObject(stone, { execute: () => H.call('onObjectInteraction', dispatched) }, 1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1708, 9800],
    'the one-tile bank approach is not teleported by the route hook');
  assert.equal(queue.points.length > 0 || queue.hasPendingWork(), true,
    'MovementQueue performs an ordinary collision-checked walk to the canonical bank');
  const tick = () => {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle();
    if (queue.hasPendingWork()) queue.process();
    TaskManager.processWalkTo(p.getIndex());
  };
  World.processCycle = 100;
  for (let i = 0; i < 10 && !dispatched.handled; i++) tick();
  assert.deepEqual(dispatched, { player: p, objectId: O.STEPPING_STONE_38, clickType: 1, option: 'cross', handled: true });
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1709, 9800],
    'the same action first reaches the actual east bank by ordinary movement');
  assert.deepEqual(transcripts.at(-1), {
    npcId: N.ARTUR_HOSIDIUS,
    page: 'The Depths of Despair',
    variant: 'the-envoy-to-varlamore-crossing-the-stepping-stone',
  }, 'the ordinary Cross action starts the real obstacle transcript');

  H.call('npc-dialogue:action', { player: p, npcId: N.ARTUR_HOSIDIUS, stepId: 'oY3wLB', handled: false });
  assert.deepEqual(p.moves.at(-1), [1701, 9800, 0], 'the transcript crosses to the opposite bank normally');
  assert.equal(p.varbits.get(VARBIT_STAGE), 6, 'the native wire still reflects the cave location');

  // A click issued while already on the authored bank uses the same destination
  // route but executes immediately, preserving the ordinary interaction path.
  setPlayerLocation(1709, 9800, 0);
  const alreadyAtBank = { player: p, objectId: stone.getId(), clickType: 1, option: 'cross', handled: false };
  queue.walkToObject(stone, { execute: () => H.call('onObjectInteraction', alreadyAtBank) }, 1);
  assert.equal(alreadyAtBank.handled, true);
  H.call('npc-dialogue:action', { player: p, npcId: N.ARTUR_HOSIDIUS, stepId: 'oY3wLB', handled: false });
  assert.deepEqual(p.moves.at(-1), [1701, 9800, 0]);

  const distantRoute = {
    objectId: O.STEPPING_STONE_38,
    sourceLocation: { x: 1711, y: 9800, z: 0 },
    clickType: 1,
    object: stone,
    destination: null,
  };
  routeHandler(distantRoute);
  assert.deepEqual(distantRoute.destination, { x: 1709, y: 9800, z: 0 },
    'a distant click still routes normally to the east bank; the tile path enforces collision');

  for (const invalid of [
    { sourceLocation: { x: 1709, y: 9800, z: 1 }, clickType: 1, objectX: 1706, objectY: 9800 },
    { sourceLocation: { x: 1709, y: 9800, z: 0 }, clickType: 0, objectX: 1706, objectY: 9800 },
    { sourceLocation: { x: 1709, y: 9800, z: 0 }, clickType: 1, objectX: 1705, objectY: 9800 },
  ]) {
    const event = {
      objectId: O.STEPPING_STONE_38,
      sourceLocation: invalid.sourceLocation,
      clickType: invalid.clickType,
      object: { getLocation: () => new core.Location(invalid.objectX, invalid.objectY, 0) },
      destination: null,
    };
    routeHandler(event);
    assert.equal(event.destination, null, 'nearby, wrong-plane, non-Cross, and wrong-placement routes remain blocked');
  }
  const itemUse = { objectId: O.STEPPING_STONE_38, sourceLocation: { x: 1709, y: 9800, z: 0 }, clickType: 0,
    object: stone, destination: null };
  routeHandler(itemUse);
  assert.equal(itemUse.destination, null, 'item-on-object use does not acquire the route shortcut');
  const unrelatedObject = { objectId: O.CREVICE_31, sourceLocation: { x: 1709, y: 9800, z: 0 }, clickType: 1,
    object: stone, destination: null };
  routeHandler(unrelatedObject);
  assert.equal(unrelatedObject.destination, null, 'unrelated objects do not acquire the stepping-stone route');
});

test('the chest can be searched again after Artur goes home when the Accord was lost', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 8);
  transcripts.length = 0;

  const chest = { player: p, objectId: O.CHEST_109, handled: false };
  H.call('onObjectInteraction', chest);
  assert.equal(chest.handled, true);
  assert.ok(!p.messages.includes('You have already recovered the Accord.'), 'the chest is not refused at stage 8');
  assert.equal(transcripts.at(-1)?.variant, 'the-envoy-to-varlamore-looting-the-chest');

  H.call('npc-dialogue:action', { player: p, stepId: 'b_bfNd', handled: false });
  assert.equal(p.items.get(I.ROYAL_ACCORD_OF_TWILL) ?? 0, 1, 'the lost Accord is recovered');
  assert.equal(questIdOf(p), 8, 'recovery does not rewind or skip stage 8');
});

test('a full bag does not create or advance the Accord', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 6);
  p.setFull();
  H.call('npc-dialogue:action', { player: p, stepId: 'b_bfNd', handled: false });
  assert.equal(p.items.get(I.ROYAL_ACCORD_OF_TWILL) ?? 0, 0);
  assert.equal(questIdOf(p), 6);
});

test('shared Hosidius NPCs yield to A Kingdom Divided and use its post-quest variants', () => {
  const h = harness([AKD_PLUGIN, DEPTHS_PLUGIN]);
  const p = makePlayer();
  H.player = p;
  const akd = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'a_kingdom_divided');
  h.quest.setStage(p, 9);
  p.items.set(I.LUNCH_BY_THE_LANCALLIUMS, 1);
  const house = npcAt(1782, 3571, 0);
  const select = (npcId) => dispatchVariant(h, { player: p, npcId, npc: house });

  akd.setStage(p, 100);
  assert.equal(select(N.LORD_KANDUR_HOSIDIUS), 'standard-dialogue',
    'A Kingdom Divided only owns the Lord in the stages it plays him in');

  akd.setStage(p, 110);
  assert.equal(select(N.LORD_KANDUR_HOSIDIUS), 'the-houses-of-kourend-talking-to-lord-kandur-hosidius',
    'A Kingdom Divided owns Lord Kandur in its own stage window');

  akd.setStage(p, 150);
  assert.equal(select(N.LORD_KANDUR_HOSIDIUS), 'standard-dialogue');
  assert.equal(select(N.ELENA_HOSIDIUS),
    'standard-dialogue-after-completing-a-kingdom-divided');
  assert.equal(select(N.BUTLER_JARVIS), 'after-completing-a-kingdom-divided');
  assert.equal(select(N.CHEF_OLIVIA),
    'standard-dialogue-after-completing-a-kingdom-divided');
  assert.equal(select(N.ARTUR_HOSIDIUS),
    'standard-dialogue-after-the-completion-of-a-kingdom-divided');
});

test('the registered Lord dialogue belongs to A Kingdom Divided only in its own stage windows', () => {
  // Quests.plugin.js registers A Kingdom Divided before The Depths of Despair,
  // so AKD answers first and the Depths variants are the fallback.
  const h = harness([AKD_PLUGIN, DEPTHS_PLUGIN]);
  const p = makePlayer();
  H.player = p;
  const house = npcAt(1782, 3571, 0);
  const talk = (akdStage, depthsStage) => {
    p.attrs.set('quest.a_kingdom_divided.stage', akdStage);
    h.quest.setStage(p, depthsStage);
    return dispatchVariant(h, { player: p, npcId: N.LORD_KANDUR_HOSIDIUS_4, npc: house });
  };

  const publicStage = { player: p, key: 'a_kingdom_divided', stage: null };
  h.api.emitCustomEvent('quest:get-stage', publicStage);
  assert.equal(publicStage.stage, 0, 'the registered public query reports the current AKD stage');

  // Inside AKD's stage ranges AKD owns the conversation.
  assert.equal(talk(110, 8), 'the-houses-of-kourend-talking-to-lord-kandur-hosidius',
    'AKD stage 110 is the Houses of Kourend window');
  const stage110 = { player: p, key: 'a_kingdom_divided', stage: null };
  h.api.emitCustomEvent('quest:get-stage', stage110);
  assert.equal(stage110.stage, 110, 'A Kingdom Divided supplies its stage through the public query');
  assert.equal(talk(138, 8), 'the-new-royal-accord-talking-to-lord-hosidius',
    'AKD stage 138 is the new Royal Accord window');
  const accord = talk(146, 8);
  assert.equal(accord, 'the-new-royal-accord-talking-to-lord-hosidius-talking-to-lord-hosidius-again',
    'AKD stage 146 is the arrest window');
  // Outside them AKD declines and the Depths of Despair keeps the Lord.
  for (const akdStage of [1, 50, 100, 119, 120, 121]) {
    assert.equal(talk(akdStage, 8), 'finishing-up-returning-to-lord-hosidius',
      `the Depths hand-in stays available at A Kingdom Divided stage ${akdStage}`);
    assert.equal(talk(akdStage, 0), 'starting-off',
      `the Depths start stays available at A Kingdom Divided stage ${akdStage}`);
  }
});

test('without the public A Kingdom Divided responder, the Lord uses its public stage default', () => {
  const p = makePlayer();
  H.player = p;
  const house = npcAt(1782, 3571, 0);
  const select = H.hooks.onNpcDialogueVariant.at(-1).fn;
  p.attrs.set('quest.a_kingdom_divided.stage', 110);
  assert.equal(select({ player: p, npcId: N.LORD_KANDUR_HOSIDIUS, npc: house }), null,
    'Depths ignores another plugin\'s private player attribute when no public responder is registered');
});

test('the native wire names the next action inside the caves', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 4); // the Envoy was read, the caves are next
  const wire = () => p.varbits.get(VARBIT_STAGE);
  assert.equal(wire(), 4, 'on the surface the next action is entering the caves');

  const click = (objectId) => {
    const event = { player: p, objectId, handled: false };
    H.call('onObjectInteraction', event);
    assert.equal(event.handled, true, `object ${objectId} is handled`);
  };
  const step = (stepId) => H.call('npc-dialogue:action', { player: p, stepId, handled: false });

  click(O.CAVE_58);
  step('GL3IJy');
  assert.equal(wire(), 6, 'inside the caves the next action is the descent');

  click(O.CREVICE_31);
  step('liq8sV');
  assert.equal(wire(), 6, 'the crevice is part of the descent');
  click(O.STEPPING_STONE_38);
  step('oY3wLB');
  assert.equal(wire(), 6, 'the stepping stones are part of the descent');
  click(O.ROCKS_33);
  step('0QAGMq');
  assert.equal(wire(), 6, 'the rocks are part of the descent');

  click(O.TUNNEL_ENTRANCE_2);
  step('Y4ZprR');
  assert.equal(wire(), 7, 'Artur waits in the chamber, so speaking to him is next');

  click(O.ROPE_8);
  step('aXacAX');
  assert.equal(wire(), 6, 'back up the rope the descent continues');

  click(O.SAND_PILE_2);
  step('IAW0EN');
  assert.equal(wire(), 4, 'back on the surface the caves are next again');
});

test('a relog republishes the native wire for the player\'s place', () => {
  for (const [x, y, expected] of [[1782, 3571, 4], [1646, 9847, 6], [1678, 9748, 7]]) {
    const p = makePlayer();
    H.player = p;
    H.quest.setStage(p, 4);
    p.setLocation(x, y, 0);
    p.sends.length = 0;
    for (const hook of H.hooks.onPlayerLogin ?? []) hook.fn?.({ player: p });
    assert.equal(p.varbits.get(VARBIT_STAGE), expected, `relog at ${x},${y} publishes ${expected}`);
  }
});

test('completed Lord dialogue uses standard-dialogue and reclaims a lost page only before it is added to the memoirs', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 9);
  p.items.set(I.KHAREDSTS_MEMOIRS, 1);
  const lord = npcAt(1782, 3571, 0);
  const select = H.hooks.onNpcDialogueVariant.at(-1).fn;
  const line = { player: p, npcId: N.LORD_KANDUR_HOSIDIUS, npc: lord, text: "I assume you're after that reward I promised you. Here you go." };

  assert.equal(select({ player: p, npcId: N.LORD_KANDUR_HOSIDIUS, npc: lord }),
    'if-the-player-lost-the-memoir-page-before-using-it-on-the-memoir');
  H.call('npc-dialogue:line', line);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 1, 'the lost page is replaced');

  const use = { player: p, usedItemId: I.LUNCH_BY_THE_LANCALLIUMS, usedWithItemId: I.KHAREDSTS_MEMOIRS, handled: false };
  H.call('onItemOnItem', use);
  assert.equal(use.handled, true);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 0, 'the page is consumed by the memoir');
  assert.equal(p.varbits.get(VARBIT_PAGE_ADDED), 1);
  p.varbits.delete(VARBIT_PAGE_ADDED);
  for (const hook of H.hooks.onPlayerLogin ?? []) hook.fn?.({ player: p });
  assert.equal(p.varbits.get(VARBIT_PAGE_ADDED), 1, 'the memoir page unlock survives login');

  assert.equal(select({ player: p, npcId: N.LORD_KANDUR_HOSIDIUS, npc: lord }), 'standard-dialogue');
  H.call('npc-dialogue:line', line);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 0, 'a recorded page is not replaced again');
});

test('lost memoir page recovery waits for inventory space and can be retried', () => {
  const p = makePlayer();
  H.player = p;
  H.quest.setStage(p, 9);
  p.items.set(I.KHAREDSTS_MEMOIRS, 1);
  const lord = npcAt(1782, 3571, 0);
  const line = {
    player: p,
    npcId: N.LORD_KANDUR_HOSIDIUS,
    npc: lord,
    text: "I assume you're after that reward I promised you. Here you go.",
  };

  p.setFull();
  H.call('npc-dialogue:line', line);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS) ?? 0, 0, 'the full bag does not silently lose the page');
  assert.ok(p.messages.some((message) => message.includes('free inventory slot')));

  p.setFreeSlots(1);
  H.call('npc-dialogue:line', line);
  assert.equal(p.items.get(I.LUNCH_BY_THE_LANCALLIUMS), 1, 'the page is available after making room');
});
