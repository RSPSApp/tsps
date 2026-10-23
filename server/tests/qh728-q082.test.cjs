// Nature Spirit (q082) route contract. From server/: node --test tests/qh728-q082.test.cjs
// The route test starts at fresh stage 0 with the two setup quests fixtured complete, then
// dispatches the real registered handlers. It proves those handler contracts, not a natural
// playthrough. The recovery/relog tests fixture-set a labelled durable stage.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;

const VARP_NATURE_SPIRIT = 307;
const GHOSTSPEAK = I.GHOSTSPEAK_AMULET;
const SILVER_SICKLE = I.SILVER_SICKLE;
const BLESSED_SICKLE = I.SILVER_SICKLE_B_;
const MIRROR = I.MIRROR;
const JOURNAL = I.JOURNAL;
const DRUIDIC_SPELL = I.DRUIDIC_SPELL;
const USED_SPELL = I.A_USED_SPELL;
const FUNGUS = I.MORT_MYRE_FUNGUS;
const EMPTY_POUCH = I.DRUID_POUCH;
const FILLED_POUCH = I.DRUID_POUCH_2;
const WASHING_BOWL = I.WASHING_BOWL;

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const xp = [];
  const jingles = [];
  const moves = [];
  const configs = new Map();
  const varbits = new Map();
  let location = new core.Location(3442, 3340, 0);
  let wearingGhostspeak = true;

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const usedSlots = () => [...items.values()].filter((amount) => amount > 0).length;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    containsNumber: (id) => inventory.getAmount(id) > 0,
    getFreeSlots: () => 28 - usedSlots(),
    isFull: () => usedSlots() >= 28,
    adds(id, amount = 1) {
      items.set(id, inventory.getAmount(id) + amount);
      return inventory;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
      return inventory;
    },
    forceAdd(_player, item) {
      return inventory.adds(item.getId(), item.getAmount());
    },
  };

  const player = {
    attrs, items, messages, xp, jingles, moves, configs, varbits, inventory,
    localNpcs: [],
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => slot === core.Equipment.AMULET_SLOT && wearingGhostspeak
        ? { getId: () => GHOSTSPEAK }
        : null,
    }),
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getCombatLevel: () => 20,
    }),
    getPacketSender: () => sender,
    getLocation: () => location,
    setLocation: (next) => { location = next; },
    moveTo: (next) => moves.push([next.getX(), next.getY(), next.getZ()]),
    sendMessage: (message) => messages.push(message),
    getDialogueManager: () => ({ isActive: () => false }),
    getArea: () => null,
    getIndex: () => 1,
    isPlayer: () => true,
    getAsPlayer: () => player,
    isRegistered: () => true,
    getUsername: () => 'qh728-q082',
    getLocalNpcs: () => player.localNpcs,
    calculateDistance: (npc) => {
      const other = npc.getLocation();
      return Math.max(Math.abs(other.getX() - location.getX()), Math.abs(other.getY() - location.getY()));
    },
    setWearingGhostspeak(value) { wearingGhostspeak = value; },
  };
  return player;
}

let firstHarness = null;

function harness() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const itemOnNpc = [];
  const itemOnObject = [];
  const itemActions = [];
  const itemOnItem = [];
  const groundPickups = [];
  const logins = [];
  const deaths = [];
  const spawned = [];
  const removed = [];
  const registered = [];
  const deregistered = [];
  const worldObjects = [];
  let area = null;

  class FakeGameObject {
    constructor(id, location, type, face, privateArea) {
      this.id = id;
      this.location = location;
      this.type = type;
      this.face = face;
      this.privateArea = privateArea;
    }
    getId() { return this.id; }
    getLocation() { return this.location; }
    getType() { return this.type; }
    getFace() { return this.face; }
    getPrivateArea() { return this.privateArea; }
  }

  const fakeCore = {
    ...core,
    TaskManager: { submit: noop, cancelTasks: noop },
    World: { getObjects: () => worldObjects },
    MapObjects: { mapObjects: new Map(), getHash: (x, y, z) => `${x},${y},${z}` },
    RegionManager: { loadMapFiles: noop },
    GameObject: FakeGameObject,
    ObjectManager: {
      register: (object) => registered.push(object),
      deregister: (object) => deregistered.push(object),
    },
    ItemOnGroundManager: {
      getGroundItem: () => ({}),
      registerLocation: noop,
    },
  };

  const api = new Proxy({
    core: fakeCore,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectHooks.push(handler),
    onItemOnNpc: (handler) => itemOnNpc.push(handler),
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onItemAction: (handler) => itemActions.push(handler),
    onItemOnItem: (handler) => itemOnItem.push(handler),
    onGroundItemPickup: (handler) => groundPickups.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onNpcDeath: (handler) => deaths.push(handler),
    onCustomEvent(key, handler) {
      const handlers = custom.get(key) ?? [];
      handlers.push(handler);
      custom.set(key, handlers);
    },
    emitCustomEvent(key, event) {
      if (key === 'quest:is-complete') {
        const prerequisite = runtime.getRegisteredQuests().findLast(entry => entry.key === event.key);
        if (prerequisite) event.complete = prerequisite.isComplete(event.player);
      }
      for (const handler of custom.get(key) ?? []) handler(event);
    },
    registerArea(next) { area = next; },
    spawnNpc({ id, x, y, z }) {
      const npc = {
        id,
        location: new core.Location(x, y, z),
        getId() { return id; },
        getLocation() { return this.location; },
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  // Use the actual prerequisite registrations so a misspelled saved key cannot pass.
  const prerequisiteApi = new Proxy({
    core: fakeCore,
    onCustomEvent(key, handler) {
      if (key === 'player:bootstrap-complete') api.onCustomEvent(key, handler);
    },
  }, { get: (target, key) => target[key] ?? noop });
  require(root + '/plugins/quests/quests/RestlessGhost.Quest')(prerequisiteApi);
  require(root + '/plugins/quests/quests/PriestInPeril.Quest')(prerequisiteApi);
  require(root + '/plugins/quests/quests/NatureSpirit.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'nature_spirit');
  const h = {
    player: makePlayer(), custom, variants, conditions, objectHooks, itemOnNpc, itemOnObject,
    itemActions, itemOnItem, groundPickups, logins, deaths, spawned, removed, registered,
    deregistered, worldObjects, quest, get area() { return area; },
  };
  if (!firstHarness) firstHarness = h;
  return h;
}

function emit(h, key, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.custom.get(key) ?? []) handler(request);
  return request;
}

function variant(h, npcId) {
  for (const handler of h.variants) {
    const value = handler({ player: h.player, npcId });
    if (value) return value;
  }
  return null;
}

function condition(h, npcId, text) {
  for (const handler of h.conditions) {
    const value = handler({ player: h.player, npcId, text });
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function objectAction(h, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.objectHooks) handler(request);
  return request;
}

function itemOnNpcAction(h, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.itemOnNpc) handler(request);
  return request;
}

function itemOnObjectAction(h, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.itemOnObject) handler(request);
  return request;
}

function itemAction(h, event) {
  const request = { player: h.player, handled: false, ...event };
  for (const handler of h.itemActions) handler(request);
  return request;
}

function death(h, npc) {
  for (const handler of h.deaths) handler({ npc, killer: h.player });
}

function interaction(eventName, clickType) {
  return { clickType, definition: { getInteractions: () => eventName } };
}

function plant(h, id, x, y) {
  const object = {
    id,
    location: new core.Location(x, y, 0),
    getId() { return id; },
    getLocation() { return this.location; },
    getType() { return 10; },
    getFace() { return 0; },
    getPrivateArea() { return null; },
  };
  h.worldObjects.push(object);
  return object;
}

test('setup requirements gate the Nature Spirit start', () => {
  const h = harness();
  assert.equal(condition(h, N.DREZEL, 'If the player does not meet the requirements for Nature Spirit:'), true);
  assert.equal(condition(h, N.DREZEL, 'If the player meets the requirements for Nature Spirit:'), false);

  emit(h, 'npc-dialogue:hook', { npcId: N.DREZEL, hook: 'quest:nature-spirit:start' });
  assert.equal(h.quest.getStage(h.player), 0, 'the hook also enforces prerequisites');
  h.player.setAttribute('quest.restless_ghost.stage', 5);
  h.player.setAttribute('quest.priest_in_peril.stage', 60);
  assert.equal(condition(h, N.DREZEL, 'If the player meets the requirements for Nature Spirit:'), false,
    'an unrelated misspelled attribute cannot satisfy the registered quest');
  h.player.setAttribute('quest.priest_in_peril.stage', 0);
  h.player.setAttribute('quest.the_restless_ghost.stage', 5);
  assert.equal(condition(h, N.DREZEL, 'If the player does not meet the requirements for Nature Spirit:'), true);

  h.player.setAttribute('quest.priest_in_peril.stage', 60);
  assert.equal(condition(h, N.DREZEL, 'If the player does not meet the requirements for Nature Spirit:'), false);
  assert.equal(condition(h, N.DREZEL, 'If the player meets the requirements for Nature Spirit:'), true);

  // While Priest in Peril is still running, its own Drezel conversation owns the NPC.
  h.player.setAttribute('quest.priest_in_peril.stage', 30);
  assert.equal(variant(h, N.DREZEL), null);
});

test('mandatory source route reaches completion through the registered handlers', () => {
  const h = harness();
  const p = h.player;
  p.setAttribute('quest.the_restless_ghost.stage', 5);
  p.setAttribute('quest.priest_in_peril.stage', 60);

  assert.equal(variant(h, N.DREZEL), 'starting-off-talking-to-drezel');
  emit(h, 'npc-dialogue:hook', { npcId: N.DREZEL, hook: 'quest:nature-spirit:start' });
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(variant(h, N.DREZEL), 'starting-off-talking-to-drezel-again');

  emit(h, 'door:toggle', { objectId: O.GATE_72 });
  assert.equal(h.quest.getStage(p), 10);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.FILLIMAN_TARLOCK));

  p.setWearingGhostspeak(false);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-talking-to-filliman');
  assert.equal(h.quest.getStage(p), 15);
  p.setWearingGhostspeak(true);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-talking-to-filliman');
  assert.equal(h.quest.getStage(p), 20);

  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-subsequent-dialogue-with-filliman');

  for (const handler of h.groundPickups) {
    handler({ player: p, groundItemId: WASHING_BOWL, location: { x: 3437, y: 3337 } });
  }
  assert.equal(p.inventory.getAmount(MIRROR), 1);
  itemOnNpcAction(h, { npcId: N.FILLIMAN_TARLOCK, itemId: MIRROR });
  assert.equal(h.quest.getStage(p), 25);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-talking-to-filliman-again-after-using-a-mirror-on-him');

  objectAction(h, { objectId: O.GROTTO_TREE, ...interaction(['Look-at', 'Search'], 2) });
  assert.equal(p.inventory.getAmount(JOURNAL), 1);
  itemOnNpcAction(h, { npcId: N.FILLIMAN_TARLOCK, itemId: JOURNAL });
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.inventory.getAmount(JOURNAL), 0);
  assert.equal(p.inventory.getAmount(DRUIDIC_SPELL), 1);

  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-subsequent-dialogue-with-filliman-2');
  assert.equal(h.quest.getStage(p), 35);
  assert.equal(variant(h, N.DREZEL), 'talking-to-drezel');
  assert.equal(h.quest.getStage(p), 40);

  p.setLocation(new core.Location(3438, 3337, 0));
  const log = plant(h, O.ROTTING_LOG, 3438, 3337);
  itemAction(h, { itemId: DRUIDIC_SPELL, option: 'Cast' });
  assert.equal(h.quest.getStage(p), 45);
  assert.equal(p.inventory.getAmount(DRUIDIC_SPELL), 0);
  assert.equal(p.inventory.getAmount(USED_SPELL), 1);
  const fungi = h.registered.at(-1);
  assert.equal(fungi.getId(), O.FUNGI_ON_LOG);
  assert.ok(log);

  objectAction(h, { objectId: O.FUNGI_ON_LOG, object: fungi, ...interaction([null, 'Pick'], 2) });
  assert.equal(h.quest.getStage(p), 50);
  assert.equal(p.inventory.getAmount(FUNGUS), 1);
  assert.equal(h.registered.at(-1).getId(), O.ROTTING_LOG);

  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'talking-to-filliman');
  assert.equal(h.quest.getStage(p), 55);
  itemOnObjectAction(h, { objectId: O.STONE, itemId: FUNGUS });
  itemOnObjectAction(h, { objectId: O.STONE_3, itemId: USED_SPELL });
  assert.equal(p.inventory.getAmount(FUNGUS), 0);
  assert.equal(p.inventory.getAmount(USED_SPELL), 0);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'talking-to-filliman-talking-to-filliman-again-on-the-orange-stone');
  assert.equal(h.quest.getStage(p), 60);

  objectAction(h, { objectId: O.GROTTO, ...interaction(['Enter'], 1) });
  assert.equal(h.quest.getStage(p), 65);
  assert.deepEqual(p.moves.at(-1), [3441, 9736, 0]);
  assert.ok(h.spawned.some((npc) => npc.getId() === N.NATURE_SPIRIT));
  assert.ok(h.removed.some((npc) => npc.getId() === N.FILLIMAN_TARLOCK));

  assert.equal(variant(h, N.NATURE_SPIRIT), 'entering-filliman-s-grove-talking-to-filliman-inside-his-grove');
  assert.equal(h.quest.getStage(p), 70);
  assert.equal(variant(h, N.NATURE_SPIRIT), 'entering-filliman-s-grove-talking-to-filliman-inside-his-grotto-again');

  p.inventory.adds(SILVER_SICKLE, 1);
  emit(h, 'npc-dialogue:action', { npcId: N.NATURE_SPIRIT, stepId: 'zcAIZC', kind: 'message' });
  assert.equal(h.quest.getStage(p), 75);
  assert.equal(p.inventory.getAmount(SILVER_SICKLE), 0);
  assert.equal(p.inventory.getAmount(BLESSED_SICKLE), 1);
  emit(h, 'npc-dialogue:action', { npcId: N.NATURE_SPIRIT, stepId: 'bf6r0R', kind: 'message' });
  assert.equal(h.quest.getStage(p), 90);
  assert.equal(p.inventory.getAmount(EMPTY_POUCH), 1);

  p.inventory.adds(FUNGUS, 3);
  itemAction(h, { itemId: EMPTY_POUCH, option: 'Fill' });
  assert.equal(p.inventory.getAmount(FUNGUS), 0);
  assert.equal(p.inventory.getAmount(EMPTY_POUCH), 0);
  assert.equal(p.inventory.getAmount(FILLED_POUCH), 3);

  const ghast = { getLocation: () => new core.Location(3440, 3345, 0) };
  itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
  const firstVisible = h.spawned.at(-1);
  assert.equal(firstVisible.getId(), N.GHAST_2);
  assert.equal(p.inventory.getAmount(FILLED_POUCH), 2);
  death(h, firstVisible);
  assert.equal(h.quest.getStage(p), 95);

  itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
  death(h, h.spawned.at(-1));
  assert.equal(h.quest.getStage(p), 100);
  itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
  death(h, h.spawned.at(-1));
  assert.equal(h.quest.getStage(p), 105);
  assert.equal(p.inventory.getAmount(EMPTY_POUCH), 1);

  assert.equal(variant(h, N.NATURE_SPIRIT), 'returning-to-filliman-s-grove');
  emit(h, 'npc-dialogue:action', { npcId: N.NATURE_SPIRIT, stepId: 'b8LYWU', kind: 'action' });
  assert.equal(h.quest.getStage(p), 110);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.configs.get(VARP_NATURE_SPIRIT), 110, 'completion is the canonical varp 307 = 110');
  assert.deepEqual(p.xp, [
    [core.Skill.CRAFTING.getIndex(), 3000],
    [core.Skill.HITPOINTS.getIndex(), 2000],
    [core.Skill.DEFENCE.getIndex(), 2000],
  ]);
  assert.equal(p.jingles.length, 1);
  assert.equal(p.inventory.getAmount(BLESSED_SICKLE), 1, 'completion must not grant a second blessed sickle');

  const drezel = variant(h, N.DREZEL);
  assert.deepEqual(drezel, {
    page: 'Drezel',
    variant: 'standard-dialogue-after-priest-in-peril-after-nature-spirit',
  });
  assert.equal(variant(h, N.NATURE_SPIRIT), 'returning-to-filliman-s-grove-attempting-to-talk-to-him-again-before-he-disappears');
});

test('login replays the saved stage in varp 307, including a fresh stage 0', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 110);
  p.configs.clear();
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.configs.get(VARP_NATURE_SPIRIT), 110);

  p.configs.clear();
  emit(firstHarness, 'player:bootstrap-complete', { player: p });
  assert.equal(p.configs.get(VARP_NATURE_SPIRIT), 110);

  const fresh = harness();
  fresh.player.configs.clear();
  runtime.sendQuestVarps({ player: fresh.player });
  assert.equal(fresh.player.configs.get(VARP_NATURE_SPIRIT), 0);
});

test('a replacement silver sickle can be blessed after stage 75 without moving the stage back', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 90);
  p.inventory.adds(SILVER_SICKLE, 1);

  emit(h, 'npc-dialogue:action', { npcId: N.NATURE_SPIRIT, stepId: 'zcAIZC', kind: 'message' });
  assert.equal(p.inventory.getAmount(SILVER_SICKLE), 0);
  assert.equal(p.inventory.getAmount(BLESSED_SICKLE), 1);
  assert.equal(h.quest.getStage(p), 90, 're-blessing must not downgrade the ghast stage');
});

test('the cache completion contract is a direct varp 307 = 110 wire', () => {
  const h = harness();
  assert.equal(h.quest.varpId, VARP_NATURE_SPIRIT);
  assert.equal(h.quest.completionValue, 110);
  assert.equal(h.quest.varbitId, undefined);
});

test('lost sickles are re-blessed through the grotto and altar without replaying a dialogue action', () => {
  for (const [stage, objectId] of [[90, O.GROTTO_2], [110, O.ALTAR_OF_NATURE]]) {
    const h = harness();
    h.quest.setStage(h.player, stage);
    h.player.inventory.adds(SILVER_SICKLE, 1);
    const event = itemOnObjectAction(h, { objectId, itemId: SILVER_SICKLE });
    assert.equal(event.handled, true);
    assert.equal(h.player.inventory.getAmount(SILVER_SICKLE), 0);
    assert.equal(h.player.inventory.getAmount(BLESSED_SICKLE), 1);
    assert.equal(h.quest.getStage(h.player), stage);
    itemOnObjectAction(h, { objectId, itemId: SILVER_SICKLE });
    assert.equal(h.player.inventory.getAmount(BLESSED_SICKLE), 1, 'no item is created without another silver sickle');
  }
  const early = harness();
  early.quest.setStage(early.player, 70);
  early.player.inventory.adds(SILVER_SICKLE, 1);
  itemOnObjectAction(early, { objectId: O.ALTAR_OF_NATURE, itemId: SILVER_SICKLE });
  assert.equal(early.player.inventory.getAmount(SILVER_SICKLE), 1);
  assert.equal(early.player.inventory.getAmount(BLESSED_SICKLE), 0);
});

test('Filliman repeat talk selects the ghostspeak conversation before the mirror-use branch', () => {
  const h = harness();
  h.quest.setStage(h.player, 20);
  const text = 'If the player talks to him again after speaking to him with a ghostspeak amulet:';
  assert.equal(condition(h, N.FILLIMAN_TARLOCK, text), true);
  h.player.setWearingGhostspeak(false);
  assert.equal(condition(h, N.FILLIMAN_TARLOCK, text), false);
  assert.equal(condition(h, N.FILLIMAN_TARLOCK, 'Without wearing a ghostspeak amulet:'), true);
  assert.equal(h.quest.getStage(h.player), 20);
});
