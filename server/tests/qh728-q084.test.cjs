// Observatory Quest (q084) source-contract regression.
// From server/: node --test tests/qh728-q084.test.cjs
//
// Fixture-driven handler graph: starting stage/inventory is set and the registered
// handlers are dispatched directly. This is not a live playthrough.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');

const core = PluginManager.getCoreApi();
before(async () => {
  await CachePipeline.initialize(process.cwd());
  RegionManager.init();
});
const transcripts = [];
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
const register = require('../plugins/quests/quests/ObservatoryQuest.Quest');

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const PAGE = 'Observatory Quest';
const VARP = 112;
const STACKABLE = new Set([I.WATER_RUNE, I.LAW_RUNE, I.TUNA]);
const CONSTELLATION = 'quest.observatory_quest.constellation';
const VIEWED = 'quest.observatory_quest.viewed';
const GUARD_AWAKE = 'quest.observatory_quest.guard_awake';

function setup() {
  transcripts.length = 0;
  const attributes = new Map();
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const ground = [];
  const xp = [];
  const transforms = [];
  let location = new core.Location(2442, 3186, 0);
  let freeSlots = 28;

  const slotsFor = (id, amount) =>
    items.has(id) && STACKABLE.has(id) ? 0 : STACKABLE.has(id) ? 1 : amount;

  function addItem(id, amount) {
    const needed = slotsFor(id, amount);
    if (needed > freeSlots) return false;
    freeSlots -= needed;
    items.set(id, (items.get(id) ?? 0) + amount);
    return true;
  }
  function deleteItem(id, amount) {
    const held = items.get(id) ?? 0;
    const removed = Math.min(held, amount);
    if (removed <= 0) return;
    const next = held - removed;
    if (next <= 0) {
      items.delete(id);
      freeSlots += STACKABLE.has(id) ? 1 : removed;
    } else {
      items.set(id, next);
      if (!STACKABLE.has(id)) freeSlots += removed;
    }
  }

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount) => addItem(id, amount),
    deleteNumber: deleteItem,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    forceAdd(player, item) {
      const id = item.getId?.() ?? item.id;
      const amount = item.getAmount?.() ?? item.amount;
      if (freeSlots <= 0 && !(items.has(id) && STACKABLE.has(id))) {
        ground.push({ id, amount });
        return;
      }
      addItem(id, amount);
    },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return varbits.get(id) ?? 0; },
  }, { get(target, prop) { return prop in target ? target[prop] : () => sender; } });

  const player = {
    getUsername: () => 'qh728-q084',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      getCombatLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage(message) { messages.push(message); },
  };

  const custom = new Map();
  const variantHooks = [];
  const conditionHooks = [];
  const objectFns = [];
  const itemOnItemFns = [];
  const npcHooks = new Map();
  const loginHooks = [];

  const coreForPlugin = {
    ...core,
    ObjectManager: { deregister() {} },
    MapObjects: { get: () => null },
  };
  const api = new Proxy({
    core: coreForPlugin,
    persistAttribute() {},
    onCustomEvent(name, fn) {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(fn);
    },
    emitCustomEvent(name, event) {
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    onNpcDialogueVariant(fn) { variantHooks.push(fn); },
    onNpcDialogueCondition(fn) { conditionHooks.push(fn); },
    onObjectInteraction(first, second) {
      if (typeof first === 'function') objectFns.push(first);
      else if (typeof first === 'string' && second) {
        for (const [option, fn] of Object.entries(second)) objectFns.push((event) => {
          const text = event.definition?.getInteractions?.()?.[event.clickType - 1];
          if (text === option) return fn(event);
        });
      }
    },
    onItemOnItem(fn) { itemOnItemFns.push(fn); },
    onNpcInteraction(first, second) {
      if (typeof first === 'string') npcHooks.set(first, second);
    },
    onPlayerLogin(fn) { loginHooks.push(fn); },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
  });

  register(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'observatory_quest');

  const variant = (npcId) => {
    for (const fn of variantHooks) {
      const result = fn({ player, npcId, definition: { getId: () => npcId }, pages: [{ page: PAGE }] });
      if (result) return typeof result === 'string' ? result : result.variant;
    }
    return null;
  };
  const condition = (text, npcId = N.OBSERVATORY_PROFESSOR) => {
    for (const fn of conditionHooks) {
      const result = fn({ player, npcId, text, definition: { getId: () => npcId } });
      if (result !== null && result !== undefined) return result;
    }
    return null;
  };
  const action = (stepId, npcId = N.OBSERVATORY_PROFESSOR, kind = 'action') => {
    const event = { player, npcId, stepId, kind, definition: { getId: () => npcId }, text: '', handled: false };
    api.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const hook = (name, npcId = N.OBSERVATORY_PROFESSOR) => {
    const event = { player, npcId, hook: name, definition: { getId: () => npcId } };
    api.emitCustomEvent('npc-dialogue:hook', event);
    return event;
  };
  const object = (objectId, option) => {
    const event = {
      player, objectId, clickType: 1, handled: false,
      object: { getId: () => objectId, getLocation: () => location },
      definition: { getId: () => objectId, getInteractions: () => [option], getActions: () => [option] },
    };
    for (const fn of objectFns) fn(event);
    return event;
  };
  const npc = (name, npcId, option = 'Prod') => {
    const actions = npcHooks.get(name);
    const npcObject = {
      setId(value) { transforms.push(value); },
      setNpcTransformationId(value) { transforms.push(value); },
      getContentId: () => npcId,
    };
    const event = {
      player, npcId, npc: npcObject, clickType: 1, handled: false,
      definition: { getId: () => npcId, getInteractions: () => [option], getActions: () => [option] },
    };
    if (actions?.[option]) {
      if (actions[option](event) !== false) event.handled = true;
    }
    return event;
  };
  const itemOnItem = (a, b) => {
    const event = { player, usedItemId: a, usedWithItemId: b, handled: false };
    for (const fn of itemOnItemFns) fn(event);
    return event;
  };
  const ladder = (objectId, x, y) => {
    const loc = new core.Location(x, y, 0);
    const request = {
      player, objectId, object: { getLocation: () => loc }, location: loc, handled: false,
    };
    api.emitCustomEvent('ladders:climb', request);
    return request;
  };
  const login = () => {
    for (const fn of loginHooks) fn({ player, username: player.getUsername() });
  };
  const give = (id, amount = 1) => {
    assert.equal(addItem(id, amount), true, `fixture item ${id} did not fit`);
  };

  return {
    player, quest, items, attributes, varbits, messages, ground, xp, transforms, transcripts,
    variant, condition, action, hook, object, npc, itemOnItem, ladder, login, give,
    stage: () => quest.getStage(player),
    setStage: (value) => quest.setStage(player, value),
    setFreeSlots: (value) => { freeSlots = value; },
    location: () => location,
  };
}

test('registered route: stage 0 through the canonical completion wire and wine claim', () => {
  const h = setup();
  assert.equal(h.quest.varpId, VARP);
  assert.equal(h.quest.completionValue, 7);

  h.login();
  assert.equal(h.varbits.get(VARP), 0, 'fresh stage 0 is replayed on login');
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'starting-off');

  h.hook('quest:observatory-quest:start');
  assert.equal(h.stage(), 1);
  assert.equal(h.varbits.get(VARP), 1);

  h.give(I.PLANK, 3);
  h.action('p1dp6a');
  assert.equal(h.stage(), 2);
  assert.equal(h.items.get(I.PLANK), undefined);
  assert.equal(h.varbits.get(VARP), 2);

  h.give(I.BRONZE_BAR, 1);
  h.action('7a36YD');
  assert.equal(h.stage(), 3);
  assert.equal(h.items.get(I.BRONZE_BAR), undefined);

  h.give(I.MOLTEN_GLASS, 1);
  h.action('Y5Z4-D');
  assert.equal(h.stage(), 4);
  assert.equal(h.items.get(I.MOLTEN_GLASS), undefined);

  assert.equal(h.object(O.CHEST_85, 'Open').handled, false, 'an unmarked chest is not the quest key chest');
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), undefined);
  const keyChest = h.object(O.CHEST_79, 'Open');
  assert.equal(keyChest.handled, true, 'marked dungeon chest is handled');
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), 1);

  const guard = h.npc('Sleeping guard', N.SLEEPING_GUARD);
  assert.equal(guard.handled, true);
  assert.equal(h.attributes.get(GUARD_AWAKE), 1);
  assert.deepEqual(h.transforms, [N.GOBLIN_GUARD]);

  const gate = h.object(O.KITCHEN_GATE, 'Open');
  assert.equal(gate.handled, true);
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), undefined, 'opening the gate consumes the key');

  const stove = h.object(O.GOBLIN_STOVE, 'Inspect');
  assert.equal(stove.handled, true);
  assert.equal(h.items.get(I.LENS_MOULD), 1);

  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'returning-with-the-lens-mould');
  h.action('JH15Z2');
  assert.equal(h.stage(), 5);
  assert.equal(h.items.get(I.MOLTEN_GLASS), 1, 'the professor returns molten glass');

  const crafted = h.itemOnItem(I.LENS_MOULD, I.MOLTEN_GLASS);
  assert.equal(crafted.handled, true);
  assert.equal(h.items.get(I.OBSERVATORY_LENS), 1);
  assert.equal(h.items.get(I.MOLTEN_GLASS), undefined);
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'returning-with-the-observatory-lens');

  h.action('p1dzXH');
  assert.equal(h.stage(), 6);
  assert.equal(h.items.get(I.OBSERVATORY_LENS), undefined);
  assert.equal(h.items.get(I.LENS_MOULD), undefined);
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'entering-the-observatory-talking-to-the-professor');

  const telescope = h.object(25591, 'View');
  assert.equal(telescope.handled, true);
  assert.equal(h.attributes.get(VIEWED), true);
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'after-viewing-the-telescope');

  h.attributes.set(CONSTELLATION, 'Aquarius');
  h.action('RZIxJd');
  assert.equal(h.stage(), 7, 'the completion action reaches 7');
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(VARP), 7, 'completion writes the canonical varp 112 = 7');
  assert.equal(h.items.get(I.UNCUT_SAPPHIRE), 1);
  assert.equal(h.items.get(I.WATER_RUNE), 25);
  assert.equal(h.attributes.get('quest.points'), 2);
  assert.ok(h.xp.some((entry) => entry.amount === 2250));

  const rewards = { sapphire: h.items.get(I.UNCUT_SAPPHIRE), water: h.items.get(I.WATER_RUNE), xp: h.xp.length };
  h.action('RZIxJd');
  assert.deepEqual(
    { sapphire: h.items.get(I.UNCUT_SAPPHIRE), water: h.items.get(I.WATER_RUNE), xp: h.xp.length },
    rewards,
    'replaying completion does not duplicate rewards'
  );
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'standard-dialogue-after-observatory-quest');

  const wine = h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(wine.handled, false);
  assert.equal(h.stage(), 8, 'the assistant wine claim is durable stage 8');
  assert.equal(h.items.get(I.JUG_OF_WINE), 1);
  assert.equal(h.varbits.get(VARP), 7, 'the post-quest wine stage does not raise the quest varp above completion');
  assert.equal(h.variant(N.OBSERVATORY_ASSISTANT), 'after-observatory-quest-subsequent-dialogue');

  h.login();
  assert.equal(h.stage(), 8, 'the durable wine claim survives login');
  assert.equal(h.varbits.get(VARP), 7, 'login replays the canonical post-quest varp 112 = 7');
});

test('login replays a durable partial stage and an already-complete save', () => {
  const h = setup();
  h.setStage(4);
  h.login();
  assert.equal(h.varbits.get(VARP), 4);
  h.setStage(6);
  h.login();
  assert.equal(h.varbits.get(VARP), 6);
  h.setStage(7);
  h.login();
  assert.equal(h.varbits.get(VARP), 7);
});

test('dungeon marked-chest recovery reissues the key after the gate key was consumed', () => {
  const h = setup();
  h.setStage(5);
  const chest = h.object(O.CHEST_83, 'Search');
  assert.equal(chest.handled, true);
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), 1);
  assert.equal(h.stage(), 5, 'recovering a lost key does not rewind the lens stage');

  const again = h.object(O.CHEST_84, 'Search');
  assert.equal(again.handled, true);
  assert.equal(h.items.get(I.LENS_MOULD), undefined, 'the stove, not a chest, is the mould source');

  h.object(O.GOBLIN_STOVE, 'Inspect');
  assert.equal(h.items.get(I.LENS_MOULD), 1);
});

test('surface stairs enter beside the north dungeon stairs, which return to the surface', () => {
  transcripts.length = 0;
  const h = setup();
  h.setStage(6);

  const surface = h.ladder(O.STAIRS_129, 2458, 3186);
  assert.equal(surface.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2355, 9394, 0]);
  assert.equal(RegionManager.blocked(h.location(), null), false, 'the landing tile is walkable in the cache');

  const south = h.ladder(O.STAIRS_127, 2335, 9351);
  assert.equal(south.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2443, 3158, 0]);
  assert.equal(transcripts.at(-1)?.variant, 'entering-the-observatory', 'the canonical cutscene plays when entering the Observatory');

  const north = h.ladder(O.STAIRS_127, 2355, 9395);
  assert.equal(north.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2458, 3185, 0]);

  const unrelated = h.ladder(O.STAIRS_127, 2400, 9395);
  assert.equal(unrelated.handled, false);
});

test('a one-slot completion keeps both the sapphire and the constellation item', () => {
  const h = setup();
  h.setStage(6);
  h.attributes.set(VIEWED, true);
  h.attributes.set(CONSTELLATION, 'Aquarius');
  h.setFreeSlots(1);

  h.action('RZIxJd');
  assert.equal(h.stage(), 7);
  assert.equal(h.items.get(I.UNCUT_SAPPHIRE), 1);
  const water = h.items.get(I.WATER_RUNE) ?? h.ground.find((entry) => entry.id === I.WATER_RUNE)?.amount;
  assert.equal(water, 25, 'the constellation reward is not silently lost when the sapphire takes the last slot');
});

test('a full bag leaves the assistant wine claimable instead of advancing without the jug', () => {
  const h = setup();
  h.setStage(7);
  h.setFreeSlots(0);
  h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(h.stage(), 7);
  assert.equal(h.items.get(I.JUG_OF_WINE), undefined);

  h.setFreeSlots(1);
  h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(h.stage(), 8);
  assert.equal(h.items.get(I.JUG_OF_WINE), 1);
});

test('prose conditions select the observed constellation and inventory-space branches', () => {
  const h = setup();
  h.setStage(6);
  h.attributes.set(CONSTELLATION, 'Aquarius');
  assert.equal(h.condition('If the player did see Aquarius:'), true);
  assert.equal(h.condition('If the player did see Aries:'), false);
  assert.equal(h.condition('If the player has inventory space:'), true);
  h.setFreeSlots(0);
  assert.equal(h.condition('If the player has inventory space:'), false);
  assert.equal(h.condition('If the player has no free inventory space:'), true);
});
