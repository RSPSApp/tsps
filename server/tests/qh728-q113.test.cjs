// Tears of Guthix (q113) source-contract checks.
// From server/: node --test tests/qh728-q113.test.cjs (after the baseline build).
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/tearsofguthix/TearsOfGuthix.java
// at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// Registered-dispatch contract tests, not a live playthrough. The route test starts
// at fresh stage 0 and every quest stage, item and wire change comes from the
// plugin's own registered handlers. Transcript actions/menus use the real ids from
// data/definitions/npc-dialogues.json. The chasm tests read the real cache: the
// region is loaded, the clipping is read through RegionManager and the routes are
// the ones PathFinder would walk.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;

const PAGE = 'Tears of Guthix';
const START_HOOK = 'quest:tears-of-guthix:start';
const COMPLETE_ACTION = 'BitWHU';
const WIRE = 451;
const STORAGE_VARP = 449;
const JUNA = N.JUNA;
const JUNA_LOC_NAME = '<col=ffff00>Juna</col>';
/** Cache loc 3193 is Juna's multiloc, placed on the chasm floor at 3252,9516,2. */
const JUNA_MULTILOC_ID = 3193;
/** The Chasm of Tears cache region (50,148). */
const CHASM_PLANE = 2;

let transcripts = [];
runtime.startTranscript = (_api, _player, _npcId, page, variant) => {
  transcripts.push({ page, variant });
  return true;
};

const TearsOfGuthix = require('../plugins/quests/quests/TearsOfGuthix.Quest');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

function inventoryFixture(initial = new Map(), free = 28) {
  const items = new Map(initial);
  let freeSlots = free;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    adds(id, amount = 1) {
      for (let i = 0; i < amount; i++) {
        if (freeSlots <= 0 && !(items.get(id) > 0)) return false;
        if (!(items.get(id) > 0)) freeSlots--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
      return true;
    },
    forceAdd(player, item) {
      this.items.set(item.getId(), (this.items.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      const before = items.get(id) ?? 0;
      const after = Math.max(0, before - amount);
      if (after === 0 && before > 0) freeSlots++;
      items.set(id, after);
      return true;
    },
  };
}

function playerFixture(options = {}) {
  const attributes = new Map(Object.entries(options.attributes ?? {}));
  const inventory = inventoryFixture(new Map(options.items ?? []), options.freeSlots ?? 28);
  const messages = [];
  const moves = [];
  const varbits = new Map();
  const configs = new Map();
  const calls = [];
  const xp = [];
  const skills = { MINING: options.mining ?? 99, CRAFTING: options.crafting ?? 99 };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); calls.push(['varbit', id, value]); return sender; },
    sendConfig(id, value) { configs.set(id, value); calls.push(['config', id, value]); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return configs.get(id) ?? 0; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  return {
    attributes, inventory, messages, moves, varbits, configs, calls, xp,
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skills[String(skill.getName?.() ?? skill.name).toUpperCase()] ?? 99,
      getMaxLevel: (skill) => skills[String(skill.getName?.() ?? skill.name).toUpperCase()] ?? 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
      getExperience: () => 0,
    }),
    getPacketSender: () => sender,
    getUsername: () => 'qh728-q113',
    getLocation: () => options.location ?? new core.Location(3250, 9525, 2),
    moveTo(next) { moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation() {},
    sendMessage(text) { messages.push(text); },
    isRegistered: () => true,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues() {}, reset() {} }),
  };
}

function harness() {
  const events = {};
  const variants = [];
  const conditions = [];
  const itemOnItem = [];
  const itemOnNpc = [];
  const objectInteraction = [];
  const npcRoutes = [];
  const login = [];
  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute() {},
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, event) => (events[name] ?? []).forEach((handler) => handler(event)),
    onItemOnItem: (handler) => itemOnItem.push(handler),
    onItemOnNpc: (handler) => itemOnNpc.push(handler),
    onObjectInteraction: (name, actions) => objectInteraction.push({ name, actions }),
    onNpcRoute: (handler) => npcRoutes.push(handler),
    onPlayerLogin: (handler) => login.push(handler),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  TearsOfGuthix(api);
  return {
    api, events, variants, conditions, itemOnItem, itemOnNpc, objectInteraction, npcRoutes, login,
    quest: runtime.getRegisteredQuests().findLast((entry) => entry.key === 'tears_of_guthix'),
    emit(name, event) { (events[name] ?? []).forEach((handler) => handler(event)); },
    routeNpc(event) { npcRoutes.forEach((handler) => handler(event)); },
    variant(npcId, player) {
      for (const handler of variants) {
        const result = handler({ player, npcId, npc: null });
        if (result) return result;
      }
      return null;
    },
  };
}

/**
 * Registers the plugin into the real PluginManager hook arrays, so a dispatch
 * goes through the production path (the object-interaction dispatcher the
 * packet listener calls) instead of the plugin's own handler.
 */
function realHarness() {
  const pluginName = 'TearsOfGuthixTest';
  const before = {
    object: PluginManager.objectInteractionHooks.length,
    order: PluginManager.nextObjectHookOrder,
    byName: new Map([...PluginManager.objectHooksByName].map(([key, hooks]) => [key, hooks.length])),
  };
  const api = new Proxy({ core }, { get: (target, key) => {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onObjectInteraction') return (handler, actions) => {
      const order = PluginManager.nextObjectHookOrder++;
      if (typeof handler === 'function') {
        PluginManager.objectInteractionHooks.push({ pluginName, order, handler });
        return;
      }
      const namedActions = new Map(Object.entries(actions ?? {}));
      const hooks = PluginManager.objectHooksByName.get(handler) ?? [];
      hooks.push({
        pluginName,
        order,
        handler: (event) => {
          if (!Number.isInteger(event.clickType) || event.clickType < 1 || event.clickType > 5) return;
          const action = namedActions.get(event.definition?.getInteractions()?.[event.clickType - 1]);
          if (action && action(event) !== false) event.handled = true;
        },
      });
      PluginManager.objectHooksByName.set(handler, hooks);
    };
    if (key === 'onCustomEvent') return (eventName, handler) => {
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    return () => {};
  } });
  TearsOfGuthix(api);
  return {
    cleanup() {
      PluginManager.objectInteractionHooks.length = before.object;
      PluginManager.nextObjectHookOrder = before.order;
      for (const [key, length] of before.byName) {
        const hooks = PluginManager.objectHooksByName.get(key) ?? [];
        hooks.length = length;
      }
    },
  };
}

/** The dispatch the object packet listener makes: the option is lower-cased. */
function dispatchObject(player, objectId, option) {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const definition = ObjectDefinition.forPlayer(objectId, player);
  const event = {
    player,
    object: { getId: () => objectId, getDefinition: () => definition },
    definition,
    objectId,
    clickType: 1,
    option,
    location: { x: 3239, y: 9498, z: CHASM_PLANE },
    handled: false,
  };
  return { handled: PluginManager.emitObjectInteraction(event), event };
}

const mine = (h, player, objectId = O.MAGICAL_ROCKS) => {
  const entry = h.objectInteraction.find((item) => item.name === 'Magical rocks');
  const event = { player, objectId, handled: false };
  entry.actions.Mine(event);
  return event;
};
const climb = (h, player, objectId = O.ROCKS_27) => {
  const event = { player, objectId, option: 'Climb', handled: false };
  h.objectInteraction.forEach((entry) => typeof entry.name === 'function' && entry.name(event));
  return event;
};
const lantern = (h, player, npcId = N.LIGHT_CREATURE_3, itemId = I.SAPPHIRE_LANTERN_3) => {
  const target = { getLocation: () => new core.Location(3226, 9518, CHASM_PLANE) };
  const event = { player, target, npcId, itemId, handled: false };
  h.itemOnNpc.forEach((handler) => handler(event));
  return event;
};
const chisel = (h, player, itemId = I.CHISEL, stoneId = I.MAGIC_STONE) => {
  const event = { player, usedItemId: itemId, usedWithItemId: stoneId, handled: false };
  h.itemOnItem.forEach((handler) => handler(event));
  return event;
};

/** The real cache clipping of a chasm tile. */
function clipped(x, y) {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  return (RegionManager.getClipping(x, y, CHASM_PLANE, null) & RegionManager.BLOCKED_TILE) !== 0;
}

/** The route PathFinder would walk between two chasm tiles (0 when there is none). */
function routeSteps(from, to) {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { Location } = require('../dist/game/model/Location');
  const queue = {
    points: [], reset() { return queue; }, setRoute() { return queue; },
    setPathX() { return queue; }, setPathY() { return queue; },
    addCheckpoint(tile) { queue.points.push([tile.getX(), tile.getY()]); return queue; },
    syncDestinationFlagToRoute() {},
  };
  const entity = {
    isPlayer: () => false, getAsPlayer: () => ({ getUsername: () => '' }),
    getLocation: () => new Location(from.x, from.y, from.z), getSize: () => 1,
    getPrivateArea: () => null, getMovementQueue: () => queue,
  };
  return PathFinder.calculateRoute(entity, 0, to.x, to.y, 0, 0, 0, 0, false);
}

/** Route to an NPC through the same range-aware PathFinder used by walkToEntity. */
function routeToNpcRange(from, target, range) {
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { Location } = require('../dist/game/model/Location');
  const queue = {
    points: [], reset() { queue.points.length = 0; return queue; }, setRoute() { return queue; },
    setPathX(value) { queue.endX = value; return queue; }, setPathY(value) { queue.endY = value; return queue; },
    addCheckpoint(tile) { queue.points.push(tile); return queue; },
    syncDestinationFlagToRoute() {},
  };
  const entity = {
    isPlayer: () => false, getAsPlayer: () => ({ getUsername: () => '' }),
    getLocation: () => new Location(from.x, from.y, from.z), getSize: () => 1,
    getPrivateArea: () => null, getMovementQueue: () => queue,
  };
  const targetEntity = {
    getLocation: () => new Location(target.x, target.y, target.z), getSize: () => 1,
  };
  const steps = PathFinder.calculateEntityRoute(entity, targetEntity, range);
  const regionBaseX = (Math.floor(from.x / 8) - 6) * 8;
  const regionBaseY = (Math.floor(from.y / 8) - 6) * 8;
  return { steps, points: queue.points, end: [queue.endX + regionBaseX, queue.endY + regionBaseY] };
}

test('cache contract: stage 1/2 write canonical varbit 451, not whole varp 449', () => {
  const h = harness();
  const player = playerFixture({ attributes: { 'quest.points': 43 } });
  assert.equal(h.quest.varbitId, WIRE);
  assert.equal(h.quest.completionValue, 2);

  h.emit('npc-dialogue:hook', { player, npcId: JUNA, hook: START_HOOK });
  assert.equal(h.quest.getStage(player), 1);
  assert.equal(player.varbits.get(WIRE), 1, 'start writes tog_juna_bowl 1');
  assert.equal(player.configs.has(STORAGE_VARP), false, 'the shared varp is not overwritten');

  h.quest.setStage(player, 2);
  assert.equal(player.varbits.get(WIRE), 2, 'completion writes the cache threshold 2');
  assert.equal(player.configs.has(STORAGE_VARP), false);
});

test('login replay sends the saved stage as varbit 451 and preserves durable saves', () => {
  const h = harness();
  for (const stage of [0, 1, 2]) {
    const player = playerFixture();
    player.setAttribute('quest.tears_of_guthix.stage', stage);
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(WIRE), stage, `saved stage ${stage} replays`);
    assert.equal(player.configs.has(STORAGE_VARP), false);
  }
  const completed = playerFixture();
  completed.setAttribute('quest.tears_of_guthix.stage', 2);
  assert.ok(h.login.length >= 1, 'the plugin registers a login hook');
  h.login.forEach((handler) => handler({ player: completed, username: completed.getUsername() }));
  runtime.sendQuestVarps({ player: completed });
  assert.equal(completed.varbits.get(WIRE), 2, 'login replay keeps the saved completion wire');
});

test('start is gated by 43 Quest Points and the first story variant is starting-off', () => {
  const h = harness();
  const player = playerFixture({ attributes: { 'quest.points': 42 } });
  assert.equal(h.variant(JUNA, player), 'starting-off');
  h.emit('npc-dialogue:hook', { player, npcId: JUNA, hook: START_HOOK });
  assert.equal(h.quest.getStage(player), 0);
  assert.ok(player.messages.some((text) => text.includes('43 Quest Points')));

  player.setAttribute('quest.points', 43);
  h.emit('npc-dialogue:hook', { player, npcId: JUNA, hook: START_HOOK });
  assert.equal(h.quest.getStage(player), 1);
  assert.equal(h.variant(JUNA, player), 'starting-off-talking-to-her-before-making-the-stone-bowl');
});

test('Juna story conditions query public quest state instead of private attributes', () => {
  const h = harness();
  const player = playerFixture({ attributes: {
    'quest.hazeel_cult.stage': 9,
    'quest.hazeel_cult.side': 1,
    'quest.dragon_slayer_ii.stage': 900,
    'quest.making_friends_with_my_arm.stage': 900,
    'quest.a_kingdom_divided.stage': 900,
  } });
  const publicState = {
    hazeel_cult: true,
    dragon_slayer_ii: true,
    making_friends_with_my_arm: false,
    a_kingdom_divided: false,
  };
  const queried = [];
  h.events['quest:is-complete'] = [(request) => {
    queried.push(request.key);
    if (Object.hasOwn(publicState, request.key)) request.complete = publicState[request.key];
  }];
  h.events['hazeel-cult:get-side'] = [(request) => { request.side = 0; }];
  const answer = text => h.conditions.at(-1)({ player, npcId: JUNA, text });

  assert.equal(answer('If the player stopped the cultists:'), true,
    'the Hazeel public side query selects the Carnillean ending despite contradictory private state');
  assert.equal(answer('If the player has finished Dragon Slayer II:'), true);
  assert.equal(answer('If the player has not completed Making Friends with My Arm:'), true,
    'the public incomplete state wins over a stale private stage');
  assert.equal(answer('If the player completed A Kingdom Divided:'), false,
    'a nonzero in-progress stage is not mistaken for quest completion');
  assert.deepEqual(queried, ['hazeel_cult', 'dragon_slayer_ii', 'making_friends_with_my_arm', 'a_kingdom_divided']);
});

test('mining the magical rocks requires 20 Mining, a pickaxe and a free slot', () => {
  const h = harness();
  const player = playerFixture({ mining: 19, items: [[I.BRONZE_PICKAXE, 1]] });
  h.quest.setStage(player, 1);
  mine(h, player);
  assert.equal(player.inventory.getAmount(I.MAGIC_STONE), 0);
  assert.ok(player.messages.some((text) => text.includes('Mining level of at least 20')));

  const noPick = playerFixture({ items: [] });
  h.quest.setStage(noPick, 1);
  mine(h, noPick);
  assert.equal(noPick.inventory.getAmount(I.MAGIC_STONE), 0);
  assert.ok(noPick.messages.some((text) => text.includes('pickaxe')));

  const full = playerFixture({ items: [[I.BRONZE_PICKAXE, 1]], freeSlots: 0 });
  h.quest.setStage(full, 1);
  mine(h, full);
  assert.equal(full.inventory.getAmount(I.MAGIC_STONE), 0);
  assert.ok(full.messages.some((text) => text.includes('free inventory space')));

  const miner = playerFixture({ items: [[I.BRONZE_PICKAXE, 1]] });
  h.quest.setStage(miner, 1);
  mine(h, miner);
  assert.equal(miner.inventory.getAmount(I.MAGIC_STONE), 1);
});

test('chiselling needs stage 1 and 20 Crafting before the stone is consumed', () => {
  const h = harness();
  const early = playerFixture({ items: [[I.CHISEL, 1], [I.MAGIC_STONE, 1]] });
  chisel(h, early);
  assert.equal(early.inventory.getAmount(I.MAGIC_STONE), 1, 'stage 0 keeps the stone');
  assert.ok(early.messages.some((text) => text.includes('speak to Juna')));

  const low = playerFixture({ crafting: 19, items: [[I.CHISEL, 1], [I.MAGIC_STONE, 1]] });
  h.quest.setStage(low, 1);
  chisel(h, low);
  assert.equal(low.inventory.getAmount(I.MAGIC_STONE), 1, 'low Crafting keeps the stone');
  assert.equal(low.inventory.getAmount(I.STONE_BOWL), 0);
  assert.ok(low.messages.some((text) => text.includes('Crafting level of at least 20')));

  const crafty = playerFixture({ items: [[I.CHISEL, 1], [I.MAGIC_STONE, 1]] });
  h.quest.setStage(crafty, 1);
  chisel(h, crafty);
  assert.equal(crafty.inventory.getAmount(I.MAGIC_STONE), 0);
  assert.equal(crafty.inventory.getAmount(I.STONE_BOWL), 1);
  assert.equal(crafty.inventory.getAmount(I.CHISEL), 1, 'the chisel is kept');
});

test('light creature crossing, south-rock return and stone-on-Juna use the registered handlers', () => {
  const h = harness();
  const player = playerFixture({ items: [[I.SAPPHIRE_LANTERN_3, 1], [I.MAGIC_STONE, 1]] });
  h.quest.setStage(player, 1);

  lantern(h, player);
  assert.deepEqual(player.moves.at(-1), [3229, 9505, 2]);
  assert.ok(player.messages.some((text) => text.includes('carries you across')));

  climb(h, player);
  assert.deepEqual(player.moves.at(-1), [3241, 9525, 2]);

  transcripts = [];
  const stoneEvent = { player, npcId: JUNA, itemId: I.MAGIC_STONE, handled: false };
  h.itemOnNpc.forEach((handler) => handler(stoneEvent));
  assert.equal(stoneEvent.handled, true);
  assert.deepEqual(transcripts.at(-1), { page: PAGE, variant: 'starting-off-using-the-magic-stone-on-juna' });
});

test('the Climb option from the real dispatch path returns the player to Juna', () => {
  const h = realHarness();
  try {
    const player = playerFixture();
    h.quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'tears_of_guthix');
    h.quest.setStage(player, 1);

    const climb = dispatchObject(player, O.ROCKS_27, 'climb');
    assert.equal(climb.handled, true, 'the dispatcher reports the climb as handled');
    assert.deepEqual(player.moves.at(-1), [3241, 9525, 2], 'the player climbs back to Juna\'s ledge');

    const other = dispatchObject(player, O.ROCKS_27 + 1, 'climb');
    assert.equal(other.handled, false, 'another rock does not claim the climb');
    assert.deepEqual(player.moves.at(-1), [3241, 9525, 2], 'the player did not move again');

    const wrongOption = dispatchObject(player, O.ROCKS_27, 'mine');
    assert.equal(wrongOption.handled, false, 'another option on the rocks is not the climb');
  } finally {
    h.cleanup();
  }
});

test('fresh stage 0 reaches completion through the mandatory quest-local handler graph', () => {
  const h = harness();
  const player = playerFixture({
    attributes: { 'quest.points': 43 },
    items: [[I.BRONZE_PICKAXE, 1], [I.CHISEL, 1], [I.SAPPHIRE_LANTERN_3, 1]],
  });

  assert.equal(h.quest.getStage(player), 0);
  h.emit('npc-dialogue:hook', { player, npcId: JUNA, hook: START_HOOK });
  assert.equal(h.quest.getStage(player), 1);

  mine(h, player, O.MAGICAL_ROCKS_2);
  assert.equal(player.inventory.getAmount(I.MAGIC_STONE), 1);
  chisel(h, player);
  assert.equal(player.inventory.getAmount(I.STONE_BOWL), 1);

  lantern(h, player);
  assert.equal(player.varbits.get(WIRE), 1, 'crossing does not advance the quest');
  climb(h, player);

  assert.equal(h.variant(JUNA, player), 'returning-with-a-stone-bowl');
  h.emit('npc-dialogue:action', { player, npcId: JUNA, stepId: COMPLETE_ACTION, handled: false, end: false });
  assert.equal(h.quest.isComplete(player), true);
  assert.equal(player.varbits.get(WIRE), 2);
  assert.equal(player.inventory.getAmount(I.STONE_BOWL), 0, 'Juna keeps the bowl');
  assert.equal(player.getAttribute('quest.points'), 44);
  assert.ok(player.xp.some((entry) => entry.skill === core.Skill.CRAFTING && entry.amount === 1000));

  h.emit('npc-dialogue:action', { player, npcId: JUNA, stepId: COMPLETE_ACTION, handled: false, end: false });
  assert.equal(player.getAttribute('quest.points'), 44, 'repeating the action cannot pay twice');
  assert.equal(player.xp.filter((entry) => entry.skill === core.Skill.CRAFTING).length, 1);
});

test('a lost bowl can be recovered from another magic stone before completion', () => {
  const h = harness();
  const player = playerFixture({ items: [[I.BRONZE_PICKAXE, 1], [I.CHISEL, 1]] });
  h.quest.setStage(player, 1);
  assert.equal(h.variant(JUNA, player), 'starting-off-talking-to-her-before-making-the-stone-bowl');
  mine(h, player);
  chisel(h, player);
  assert.equal(player.inventory.getAmount(I.STONE_BOWL), 1);
});

test('Juna is the placed multiloc that resolves to the talkable Juna loc by varbit 451', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { Location } = require('../dist/game/model/Location');
  RegionManager.loadMapFiles(3225, 9517);

  const placed = MapObjects.get(JUNA_MULTILOC_ID, new Location(3252, 9516, CHASM_PLANE), null);
  assert.ok(placed, 'the cache places Juna on the chasm floor, on the player\'s plane');

  const player = playerFixture({ attributes: { 'quest.points': 43 } });
  const before = ObjectDefinition.forPlayer(JUNA_MULTILOC_ID, player);
  assert.equal(before.getName(), JUNA_LOC_NAME, 'the multiloc resolves to the Juna loc');
  assert.equal(before.getInteractions()[0], 'Talk-to', 'Juna can be talked to');

  player.varbits.set(WIRE, 2);
  const after = ObjectDefinition.forPlayer(JUNA_MULTILOC_ID, player);
  assert.equal(after.getName(), JUNA_LOC_NAME);
  assert.equal(after.getInteractions()[1], 'Story', 'a completed quest shows her Story option');
});

test('Juna refuses a player without 43 Quest Points instead of playing her acceptance', () => {
  const h = harness();
  const started = [];
  h.events['npc-dialogue:start'] = [(request) => started.push(request)];
  const juna = h.objectInteraction.find((entry) => entry.name === JUNA_LOC_NAME);
  assert.ok(juna, 'the plugin hooks Talk-to on Juna\'s loc name');

  const player = playerFixture({ attributes: { 'quest.points': 42 } });
  juna.actions['Talk-to']({ player });
  assert.equal(started.length, 0, 'her transcript does not start');
  assert.ok(player.messages.some((text) => text.includes('43 Quest Points')));
  assert.equal(h.quest.getStage(player), 0);

  player.setAttribute('quest.points', 43);
  juna.actions['Talk-to']({ player });
  assert.equal(started.length, 1, 'an eligible player gets her transcript');
  assert.equal(started[0].npcId, JUNA);
});

test('the pool keeps its cache clipping after quest registration', () => {
  const h = harness();
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.loadMapFiles(3225, 9517);
  assert.equal(clipped(3225, 9517), true, 'the cache clips the light creature spawn');
  assert.equal(clipped(3227, 9519), true, 'the cache clips the shore that reaches it');
  assert.equal(h.npcRoutes.length, 1, 'the quest uses the generic NPC route hook for lantern targeting');
  assert.equal(clipped(3225, 9517), true, 'registering the quest does not make the pool walkable');
  assert.equal(clipped(3227, 9519), true, 'registering the quest does not change shore collision');
});

test('the lantern route ends at a collision-valid ledge tile within item-use reach', () => {
  const h = harness();
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.loadMapFiles(3225, 9517);

  const tunnel = { x: 3219, y: 9532, z: CHASM_PLANE };
  const ledge = { x: 3239, y: 9525, z: CHASM_PLANE };
  const junaSide = { x: 3241, y: 9525, z: CHASM_PLANE };
  const juna = { x: 3251, y: 9516, z: CHASM_PLANE };
  const rockSide = { x: 3229, y: 9505, z: CHASM_PLANE };
  const target = { x: 3226, y: 9518, z: CHASM_PLANE };

  assert.ok(routeSteps(tunnel, ledge) > 0, 'the tunnel reaches the chasm ledge');
  assert.ok(routeSteps(junaSide, juna) > 0, 'the ledge reaches Juna on her platform');
  assert.equal(routeSteps(tunnel, rockSide), 0, 'the chasm still blocks the rock side without the lantern');

  const player = playerFixture({ items: [[I.SAPPHIRE_LANTERN_3, 1]] });
  h.quest.setStage(player, 1);
  const route = { player, npc: {}, npcId: N.LIGHT_CREATURE_3, clickType: 0,
    itemId: I.SAPPHIRE_LANTERN_3, range: 1, ignoreProjectileClip: false,
    location: { x: 3226, y: 9518, z: CHASM_PLANE } };
  h.routeNpc(route);
  assert.equal(route.range, 8, 'the quest grants only the canonical lantern-on-creature route extended reach');
  assert.equal(route.ignoreProjectileClip, true, 'the pool blocks projectile line of sight, not the lantern use');
  const unrelatedItem = { ...route, itemId: I.MAGIC_STONE, range: 1, ignoreProjectileClip: false };
  h.routeNpc(unrelatedItem);
  assert.equal(unrelatedItem.range, 1, 'other item-on-creature routes retain normal reach');
  assert.equal(unrelatedItem.ignoreProjectileClip, false);
  const unrelatedCreature = { ...route, npcId: N.LIGHT_CREATURE_3, location: { x: 3000, y: 4000, z: 0 },
    range: 1, ignoreProjectileClip: false };
  h.routeNpc(unrelatedCreature);
  assert.equal(unrelatedCreature.range, 1, 'other spawns of this NPC id keep the normal route');
  const beforeQuest = { ...route, player: playerFixture({ items: [[I.SAPPHIRE_LANTERN_3, 1]] }),
    range: 1, ignoreProjectileClip: false };
  h.routeNpc(beforeQuest);
  assert.equal(beforeQuest.range, 1, 'the extended route is disabled before the bowl stage');
  assert.equal(beforeQuest.ignoreProjectileClip, false);

  const approach = routeToNpcRange(ledge, target, route.range);
  assert.ok(approach.steps > 0, 'the route planner finds a walkable approach to the NPC reach area');
  const [endX, endY] = approach.end;
  assert.ok(!clipped(endX, endY), 'the route endpoint remains on a collision-valid tile');
  assert.ok(Math.max(Math.abs(endX - target.x), Math.abs(endY - target.y)) <= route.range,
    `the endpoint ${endX},${endY} is inside the approved range of the selected northern light creature`);
});

test('the real item-on-NPC packet carries quest route policy into MovementQueue', () => {
  const h = harness();
  const player = playerFixture({ items: [[I.SAPPHIRE_LANTERN_3, 1]] });
  h.quest.setStage(player, 1);
  const targetIndex = 18;
  const target = {
    getCurrentDefinition: () => null,
    getContentId: () => N.LIGHT_CREATURE_3,
    getLocation: () => new core.Location(3226, 9518, CHASM_PLANE),
  };
  const movement = [];
  player.getInventory = () => ({ capacity: () => 28, getItems: () => [new core.Item(I.SAPPHIRE_LANTERN_3, 1)] });
  player.getMovementQueue = () => ({
    walkToEntity(entity, callback, range, ignoreProjectileClip, allowOverlappingTiles) {
      movement.push({ entity, callback, range, ignoreProjectileClip, allowOverlappingTiles });
    },
  });
  player.setPositionToFace = () => {};

  const { World } = require('../dist/game/World');
  const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
  const oldGetNpcs = World.getNpcs;
  const oldEmitNpcRoute = PluginManager.emitNpcRoute;
  const oldEmitItemOnNpc = PluginManager.emitItemOnNpc;
  World.getNpcs = () => ({ get: (index) => index === targetIndex ? target : null });
  PluginManager.emitNpcRoute = (event) => h.routeNpc(event);
  PluginManager.emitItemOnNpc = (event) => h.itemOnNpc.forEach((handler) => handler(event));
  try {
    UseItemPacketListener.itemOnNpc(player, 0, targetIndex, I.SAPPHIRE_LANTERN_3, 0);
    assert.equal(movement.length, 1);
    assert.equal(movement[0].range, 8);
    assert.equal(movement[0].ignoreProjectileClip, true);
    assert.equal(movement[0].allowOverlappingTiles, true);
    movement[0].callback();
  } finally {
    World.getNpcs = oldGetNpcs;
    PluginManager.emitNpcRoute = oldEmitNpcRoute;
    PluginManager.emitItemOnNpc = oldEmitItemOnNpc;
  }

  assert.deepEqual(player.moves.at(-1), [3229, 9505, 2], 'the lantern transition runs once the route arrives');
});

test('the lantern crossing and the rock climb only fire on their own target and option', () => {
  const h = harness();
  const player = playerFixture({ items: [[I.SAPPHIRE_LANTERN_3, 1]] });
  h.quest.setStage(player, 1);

  const wrongNpc = lantern(h, player, N.JUNA);
  assert.equal(wrongNpc.handled, false);
  assert.equal(player.moves.length, 0);

  const wrongLocation = { player, npcId: N.LIGHT_CREATURE_3, itemId: I.SAPPHIRE_LANTERN_3,
    target: { getLocation: () => new core.Location(3000, 4000, 0) }, handled: false };
  h.itemOnNpc.forEach((handler) => handler(wrongLocation));
  assert.equal(wrongLocation.handled, false, 'another creature with the same cache id cannot trigger this crossing');
  assert.equal(player.moves.length, 0);

  const wrongItem = lantern(h, player, N.LIGHT_CREATURE_3, I.MAGIC_STONE);
  assert.equal(wrongItem.handled, false);
  assert.equal(player.moves.length, 0);

  const crossing = lantern(h, player);
  assert.equal(crossing.handled, true);
  assert.deepEqual(player.moves.at(-1), [3229, 9505, 2]);

  const wrongRock = climb(h, player, O.ROCKS_27 + 1);
  assert.equal(wrongRock.handled, false);
  assert.deepEqual(player.moves.at(-1), [3229, 9505, 2], 'the climb did not move the player');
});

test('the completion scroll lists the real rewards and no consumed bowl', () => {
  const h = harness();
  assert.equal(h.quest.scrollItemId, undefined, 'the stone bowl is not a reward');
  assert.equal(h.quest.rewardItemId, undefined, 'no item is granted');
  assert.equal(h.quest.questPoints, 1);
  assert.deepEqual(h.quest.xpRewards, [{ skillId: core.Skill.CRAFTING.getIndex(), amount: 1000, label: 'Crafting' }]);
  assert.deepEqual(h.quest.otherRewards, ['Access to the Tears of Guthix']);
});
