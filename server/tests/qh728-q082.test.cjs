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
  const animations = [];
  const graphics = [];
  const sounds = [];
  let prayer = 50;
  let location = new core.Location(3442, 3340, 0);
  let wearingGhostspeak = true;

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
    sendSoundEffect(id, loops, delay) { sounds.push([id, loops, delay]); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const usedSlots = () => [...items.values()].filter((amount) => amount > 0).length;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    containsNumber: (id) => inventory.getAmount(id) > 0,
    getFreeSlots: () => 28 - usedSlots(),
    isFull: () => usedSlots() >= 28,
    getItems() {
      return [...items.entries()].map(([id, amount]) => ({
        getId: () => id,
        getAmount: () => amount,
        setId(next) { items.delete(id); items.set(next, amount); },
      }));
    },
    refreshItems() {},
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
    attrs, items, messages, xp, jingles, moves, configs, varbits, inventory, damage: [], animations, graphics, sounds,
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
      getCurrentLevel: () => prayer,
      getMaxLevel: () => 50,
      setCurrentLevels: (_skill, level) => { prayer = level; },
      updateSkill: noop,
    }),
    getPacketSender: () => sender,
    getCombat: () => ({
      getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits) }),
    }),
    getLocation: () => location,
    getPrivateArea: () => null,
    performAnimation: animation => animations.push(animation.getId()),
    performGraphic: graphic => graphics.push(graphic.getId()),
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

function harness({ nativeActors = false, player = makePlayer() } = {}) {
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
  const logouts = [];
  const deaths = [];
  const spawned = [];
  const removed = [];
  const registered = [];
  const deregistered = [];
  const worldObjects = [];
  const clock = { tick: 0 };
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
    World: { getObjects: () => worldObjects, getProcessCycle: () => clock.tick },
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
    onObjectInteraction: (nameOrHandler, actions) => objectHooks.push(typeof nameOrHandler === 'function' ? nameOrHandler : (event) => {
      const definition = core.CacheDefinitions.getObject(event.objectId);
      if (definition.name !== nameOrHandler) return;
      const option = event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1];
      const action = Object.keys(actions).find(key => key.toLowerCase() === String(option).toLowerCase());
      if (action && actions[action](event)) event.handled = true;
    }),
    onItemOnNpc: (handler) => itemOnNpc.push(handler),
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onItemAction: (handler) => itemActions.push(handler),
    onItemOnItem: (handler) => itemOnItem.push(handler),
    onGroundItemPickup: (handler) => groundPickups.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
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
    spawnNpc(definition) {
      const { id, x, y, z } = definition;
      if (nativeActors) {
        const npc = core.PluginManager.spawnNpc(definition);
        spawned.push(npc);
        return npc;
      }
      const npc = {
        id,
        location: new core.Location(x, y, z),
        getId() { return id; },
        getLocation() { return this.location; },
        performGraphic: noop,
        getCombat: () => ({ attack: target => { npc.target = target; } }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      removed.push(npc);
      if (nativeActors) core.PluginManager.removeNpc(npc);
    },
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
    player, custom, variants, conditions, objectHooks, itemOnNpc, itemOnObject,
    itemActions, itemOnItem, groundPickups, logins, logouts, deaths, spawned, removed, registered,
    deregistered, worldObjects, quest, clock, get area() { return area; },
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
  assert.equal(h.spawned.length, 0, 'entering the swamp does not summon Filliman');
  objectAction(h, { objectId: O.GROTTO, ...interaction(['Enter'], 1) });
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
  // Full native item-use conversations are covered in npc-dialogue-event-entrypoints.
  emit(h, 'npc-dialogue:line', { npcId: N.FILLIMAN_TARLOCK, text: 'It must be a sign...' }).after();
  assert.equal(h.quest.getStage(p), 25);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-talking-to-filliman-again-after-using-a-mirror-on-him');

  objectAction(h, { objectId: O.GROTTO_TREE, ...interaction(['Look-at', 'Search'], 2) });
  assert.equal(p.inventory.getAmount(JOURNAL), 1);
  emit(h, 'npc-dialogue:action', { npcId: N.FILLIMAN_TARLOCK, stepId: 'JPq1Gd', kind: 'message' });
  assert.equal(h.quest.getStage(p), 30);
  assert.equal(p.inventory.getAmount(JOURNAL), 0);
  assert.equal(p.inventory.getAmount(DRUIDIC_SPELL), 0);
  emit(h, 'npc-dialogue:line', { npcId: N.FILLIMAN_TARLOCK,
    text: "It is required if you're to cast this druid spell." }).after();
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
  assert.ok(h.spawned.some((npc) => npc.getId() === N.FILLIMAN_TARLOCK && npc.getLocation().y > 9000));
  assert.ok(h.removed.some((npc) => npc.getId() === N.FILLIMAN_TARLOCK));

  assert.equal(variant(h, N.NATURE_SPIRIT), 'entering-filliman-s-grove-talking-to-filliman-inside-his-grove');
  const transform = emit(h, 'npc-dialogue:line', { npcId: N.FILLIMAN_TARLOCK,
    text: "I must complete the transformation now. Just stand there and watch the show, apparently it's quite good!" });
  transform.after();
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

  h.clock.tick++;
  itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
  death(h, h.spawned.at(-1));
  assert.equal(h.quest.getStage(p), 100);
  h.clock.tick++;
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

test('uncharged ghast attacks rot food or damage without making the ghast attackable', () => {
  const player = makePlayer();
  const h = harness({ player });
  player.setLocation(new core.Location(3440, 3345, 0));
  const ghast = {
    getId: () => N.GHAST,
    getLocation: () => new core.Location(3441, 3345, 0),
  };
  player.localNpcs = [ghast];
  const random = Math.random;
  try {
    // First tick only schedules the first attempt; the roll happens on a later cycle.
    h.clock.tick = 0;
    h.area.process(player);
    player.inventory.adds(I.SHRIMPS, 1);
    h.clock.tick = 20;
    Math.random = () => 0.9; // not ignored, not a miss
    h.area.process(player);
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 0, 'the attack rots the food');
    assert.equal(player.inventory.getAmount(I.ROTTEN_FOOD), 1);
    assert.equal(h.spawned.length, 0, 'rotting food does not reveal an attackable ghast');
    assert.equal(player.damage.length, 0, 'rotting food replaces the damage');

    // With nothing to rot the same roll deals 1-3 damage.
    h.clock.tick = 200;
    Math.random = () => 0.9;
    h.area.process(player);
    assert.equal(player.damage.length, 1);
    assert.ok(player.damage[0].getDamage() >= 1 && player.damage[0].getDamage() <= 3);
    assert.equal(h.spawned.length, 0, 'an unprotected damaging hit does not reveal a ghast either');

    // 7/10 of attempts miss: no rot, no damage, no visible ghast.
    h.clock.tick = 400;
    Math.random = () => 0.1;
    const spawnedBefore = h.spawned.length;
    player.inventory.adds(I.SHRIMPS, 1);
    h.area.process(player);
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 1);
    assert.equal(player.damage.length, 1);
    assert.equal(h.spawned.length, spawnedBefore);
  } finally {
    Math.random = random;
  }
});

test('one invisible ghast keeps one visible copy through repeat attacks, death and logout', () => {
  const player = makePlayer();
  const h = harness({ player });
  player.setLocation(new core.Location(3440, 3345, 0));
  const ghast = {
    getId: () => N.GHAST,
    getLocation: () => new core.Location(3441, 3345, 0),
  };
  player.localNpcs = [ghast];
  h.quest.setStage(player, 90);
  const visibleGhasts = () => h.spawned.filter((npc) => npc.getId() === N.GHAST_2);
  const random = Math.random;
  try {
    Math.random = () => 0.9; // never ignored, never a miss
    h.clock.tick = 0;
    h.area.process(player); // the first pass only schedules the attempt
    player.inventory.adds(I.SHRIMPS, 3);
    player.inventory.adds(FILLED_POUCH, 1);

    h.clock.tick = 20;
    h.area.process(player);
    assert.equal(visibleGhasts().length, 1);
    const first = h.spawned.at(-1);

    // The source stays in the player's local NPCs, so two more hits must reuse its one form.
    assert.ok(player.localNpcs.includes(ghast));
    h.clock.tick = 60;
    h.area.process(player);
    h.clock.tick = 100;
    h.area.process(player);
    assert.equal(visibleGhasts().length, 1, 'a revealed source does not spawn a second copy');
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 3, 'a pouch-revealed source does not rot food alongside melee combat');

    // Using the pouch on a source that is already visible costs nothing and adds no copy.
    player.inventory.adds(FILLED_POUCH, 1);
    h.clock.tick++;
    itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
    assert.equal(visibleGhasts().length, 1);
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 1, 'no charge is spent on a ghast already visible');

    // The form dying counts once and frees the source to be revealed again.
    death(h, first);
    assert.equal(h.quest.getStage(player), 95);
    death(h, first);
    assert.equal(h.quest.getStage(player), 95, 'one form cannot count twice');

    h.clock.tick++;
    itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
    const second = h.spawned.at(-1);
    assert.equal(second.getId(), N.GHAST_2);
    assert.notEqual(second, first, 'a dead form is replaced, not reused');
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 0);

    // Logout removes the tracked form, so the next visit starts with nothing lingering.
    for (const handler of h.logouts) handler({ player });
    assert.ok(h.removed.includes(second), 'logout removes the visible form it tracked');
    player.inventory.adds(FILLED_POUCH, 1);
    itemOnNpcAction(h, { npcId: N.GHAST, itemId: FILLED_POUCH, target: ghast });
    const third = h.spawned.at(-1);
    assert.equal(third.getId(), N.GHAST_2);
    assert.notEqual(third, second);
  } finally {
    Math.random = random;
  }
});

test('a filled druid pouch spends a charge to reveal an attacking ghast instead of food or damage', () => {
  const player = makePlayer();
  const h = harness({ player });
  player.setLocation(new core.Location(3440, 3345, 0));
  const ghast = {
    getId: () => N.GHAST,
    getLocation: () => new core.Location(3441, 3345, 0),
  };
  player.localNpcs = [ghast];
  h.quest.setStage(player, 90);
  const visibleGhasts = () => h.spawned.filter((npc) => npc.getId() === N.GHAST_2);
  const random = Math.random;
  try {
    Math.random = () => 0.9; // never ignored, never a miss
    h.clock.tick = 0;
    h.area.process(player); // the first pass only schedules the attempt
    player.inventory.adds(I.SHRIMPS, 1);
    player.inventory.adds(FILLED_POUCH, 3);

    // Food in the pack: one charge reveals the ghast, and the food survives.
    h.clock.tick = 20;
    h.area.process(player);
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 2, 'the pouch spends one charge');
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 1, 'the protected food is not rotted');
    assert.equal(player.inventory.getAmount(I.ROTTEN_FOOD), 0);
    assert.equal(player.damage.length, 0, 'a revealed attacker deals no damage');
    assert.equal(visibleGhasts().length, 1);

    // The revealed source keeps attacking through its one form: no second charge or copy.
    h.clock.tick = 60;
    h.area.process(player);
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 2, 'no charge is spent on a ghast already visible');
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 1);
    assert.equal(visibleGhasts().length, 1);

    // No food either: the pouch still protects, spending the next charge on a fresh reveal.
    death(h, h.spawned.at(-1));
    player.inventory.deleteNumber(I.SHRIMPS, 1);
    h.clock.tick = 100;
    h.area.process(player);
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 1, 'the pouch spends a charge with no food to rot');
    assert.equal(player.damage.length, 0, 'no food does not mean damage while the pouch is charged');
    assert.equal(visibleGhasts().length, 2, 'the dead form is replaced by a fresh reveal');

    // The last charge goes the same way and leaves the empty pouch behind.
    death(h, h.spawned.at(-1));
    player.inventory.adds(I.SHRIMPS, 1);
    h.clock.tick = 140;
    h.area.process(player);
    assert.equal(player.inventory.getAmount(FILLED_POUCH), 0);
    assert.equal(player.inventory.getAmount(EMPTY_POUCH), 1, 'the spent pouch becomes the empty pouch');
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 1);
    assert.equal(visibleGhasts().length, 3);

    // An empty pouch is no protection: the food rots again.
    death(h, h.spawned.at(-1));
    h.clock.tick = 180;
    h.area.process(player);
    assert.equal(player.inventory.getAmount(I.SHRIMPS), 0, 'without a charged pouch the food rots');
    assert.equal(player.inventory.getAmount(I.ROTTEN_FOOD), 1);
    assert.equal(visibleGhasts().length, 3, 'the empty pouch leaves the next attacker invisible');
  } finally {
    Math.random = random;
  }
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
  assert.equal(condition(h, N.FILLIMAN_TARLOCK, 'If the player uses his journal on Filliman without wearing the ghostspeak amulet:'), true);
  h.player.setWearingGhostspeak(true);
  assert.equal(condition(h, N.FILLIMAN_TARLOCK, 'If the player uses his journal on Filliman without wearing the ghostspeak amulet:'), false);
  assert.equal(h.quest.getStage(h.player), 20);
});

test('Bloom grows every adjacent plant once, charges Prayer once and observes the animation delay', () => {
  const h = harness(), p = h.player, skills = p.getSkillManager();
  h.quest.setStage(p, 90);
  p.setLocation(new core.Location(3440, 3345, 0));
  p.inventory.adds(BLESSED_SICKLE, 1);
  plant(h, O.ROTTING_LOG, 3439, 3345);
  plant(h, O.ROTTING_BRANCH, 3441, 3345);
  plant(h, O.SMALL_BUSH, 3440, 3346);
  plant(h, O.ROTTING_LOG, 3442, 3345); // outside the adjacent square
  const random = Math.random;
  try {
    let rolls = 0;
    Math.random = () => rolls++ === 0 ? 0.99 : 0.1;
    itemAction(h, {itemId: BLESSED_SICKLE, option: 'Cast Bloom'});
    assert.deepEqual(h.registered.map(o => o.getId()).sort((a, b) => a - b),
      [O.FUNGI_ON_LOG, O.BUDDING_BRANCH, O.GOLDEN_PEAR_BUSH].sort((a, b) => a - b));
    assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 44, 'one 1-6 Prayer roll covers the whole cast');
    assert.deepEqual(p.animations, [1100]);
    assert.deepEqual(p.graphics, [264]);
    assert.deepEqual(p.sounds, [[1493, 35, 0]]);
    itemAction(h, {itemId: BLESSED_SICKLE, option: 'Bloom'});
    assert.equal(h.registered.length, 3);
    assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 44, 'repeat input during the animation costs nothing');
    h.clock.tick = 3;
    skills.setCurrentLevels(core.Skill.PRAYER, 1);
    rolls = 0;
    itemAction(h, {itemId: BLESSED_SICKLE, option: 'Cast Bloom'});
    assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 0, 'Prayer cannot go negative');
    h.clock.tick = 6;
    const before = h.registered.length;
    itemAction(h, {itemId: BLESSED_SICKLE, option: 'Cast Bloom'});
    assert.equal(h.registered.length, before, 'zero Prayer cannot grow plants');
    skills.setCurrentLevels(core.Skill.PRAYER, 50);
    Math.random = () => 0.99;
    itemAction(h, {itemId: BLESSED_SICKLE, option: 'Cast Bloom'});
    assert.equal(h.registered.length, before, 'each eligible plant can fail its growth roll');
    assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 44, 'an unsuccessful cast still spends Prayer');
  } finally { Math.random = random; }
});

test('transformation waits for its line, uses the green chathead and completion opens the finished grotto', () => {
  const h = harness(), p = h.player;
  h.quest.setStage(p, 65);
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'entering-filliman-s-grove-talking-to-filliman-inside-his-grove');
  assert.equal(h.quest.getStage(p), 65, 'selecting a dialogue cannot complete the transformation');
  const line = emit(h, 'npc-dialogue:line', {npcId: N.FILLIMAN_TARLOCK,
    text: "I must complete the transformation now. Just stand there and watch the show, apparently it's quite good!"});
  line.after();
  assert.equal(h.quest.getStage(p), 70);
  const green = emit(h, 'npc-dialogue:line', {npcId: N.FILLIMAN_TARLOCK, text: 'Hmmm, good, the transformation is complete.'});
  assert.equal(green.speakerId, N.NATURE_SPIRIT);
  h.quest.setStage(p, 105);
  p.setLocation(new core.Location(3441, 9736, 0));
  emit(h, 'npc-dialogue:action', {npcId: N.NATURE_SPIRIT, stepId: 'b8LYWU'});
  assert.deepEqual(p.moves.at(-1), [3441, 9736, 1]);
  assert.equal(core.CacheDefinitions.getObject(O.ALTAR_OF_NATURE).actions[0], 'Pray-at');
  p.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 0);
  objectAction(h, {objectId: O.ALTAR_OF_NATURE, option: 'Pray-at'});
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 52);
});

test('pouch use is limited to one reveal per game tick across every invisible ghast variant', () => {
  const h = harness(), p = h.player;
  h.quest.setStage(p, 90);
  p.inventory.adds(FILLED_POUCH, 3);
  const ghast = x => ({getLocation: () => new core.Location(x, 3345, 0)});
  itemOnNpcAction(h, {npcId: N.GHAST_3, itemId: FILLED_POUCH, target: ghast(3440)});
  itemOnNpcAction(h, {npcId: N.GHAST_4, itemId: FILLED_POUCH, target: ghast(3441)});
  assert.equal(h.spawned.length, 1);
  assert.equal(p.inventory.getAmount(FILLED_POUCH), 2);
  assert.equal(h.spawned[0].target, p, 'a revealed ghast engages the player');
  h.clock.tick++;
  itemOnNpcAction(h, {npcId: N.GHAST_4, itemId: FILLED_POUCH, target: ghast(3441)});
  assert.equal(h.spawned.length, 2);
  assert.equal(p.inventory.getAmount(FILLED_POUCH), 1);
});

test('native revealed ghasts keep separate source tiles and a mobile combat target', () => {
  const h = harness({ nativeActors: true }), p = h.player;
  h.quest.setStage(p, 90);
  p.inventory.adds(FILLED_POUCH, 3);
  try {
    for (const [index, id] of [N.GHAST, N.GHAST_3, N.GHAST_4].entries()) {
      h.clock.tick++;
      const source = core.NPC.create(id, new core.Location(3440 + index, 3345, 0));
      itemOnNpcAction(h, {npcId: id, itemId: FILLED_POUCH, target: source});
      const visible = h.spawned.at(-1);
      assert.equal(visible.getLocation().getX(), 3440 + index);
      assert.ok(visible.getMovementCoordinator().getRadius() > 0, 'the real NPC is not pinned to its spawn');
      assert.equal(visible.getCombat().getTarget(), p, 'normal NPC combat owns the revealed attack');
    }
    assert.equal(new Set(h.spawned.map(n => n.getLocation().getX())).size, 3);
  } finally {
    for (const handler of h.logouts) handler({player: p});
  }
});

test('re-summoned Filliman occupies the ritual tile between the three stones', t => {
  const h = harness({ nativeActors: true });
  t.after(() => { for (const handler of h.logouts) handler({ player: h.player }); });
  h.quest.setStage(h.player, 50);
  objectAction(h, { objectId: O.GROTTO, ...interaction(['Enter'], 1) });
  const at = h.spawned[0].getLocation();
  assert.deepEqual([at.x, at.y, at.z], [3440, 3336, 0]);
});

test('native swamp attacks keep the original unattackable NPC_INFO until a pouch charge is spent', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const session = new PlayerSession({ kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
  const player = new Player(session); session.setPlayer(player);
  player.setIndex(102); player.setUsername('ghastvisibility'); player.setRegistered(true);
  player.setLocation(new core.Location(3440, 3345)); player.needsPlacement = false;
  const h = harness({ nativeActors: true, player }); h.quest.setStage(player, 90);
  const source = core.PluginManager.spawnNpc({ id: N.GHAST, x: 3441, y: 3345, z: 0, wanderRadius: 0 });
  source.needsPlacement = false;
  const views = [], old = core.PluginManager.customEventHooks.get('network:sync-views');
  core.PluginManager.createApi('ghast-native-info-test').onCustomEvent('network:sync-views', event => {
    if (event.player === player) views.push(event.npcs.map(npc => npc.typeId));
  });
  t.after(() => {
    for (const handler of h.logouts) handler({ player });
    core.PluginManager.removeNpc(source); player.setRegistered(false);
    if (old) core.PluginManager.customEventHooks.set('network:sync-views', old);
    else core.PluginManager.customEventHooks.delete('network:sync-views');
  });
  t.mock.method(Math, 'random', () => 0.9);
  let tick = 0;
  const publish = () => {
    core.World.updateLocalNpcs(player, [source, ...h.spawned.filter(npc => npc.isRegistered())]);
    session.flush(++tick); session.flush(++tick);
    return views.at(-1);
  };
  assert.deepEqual(publish(), [N.GHAST]);
  assert.ok(!source.getCurrentDefinition(player).getActions().includes('Attack'));
  player.getInventory().add(new core.Item(I.SHRIMPS));
  h.area.process(player); h.clock.tick = 20; h.area.process(player);
  assert.equal(player.getInventory().getAmount(I.ROTTEN_FOOD), 1);
  assert.deepEqual(publish(), [N.GHAST], 'rotting food leaves the actual native NPC unattackable');
  h.clock.tick = 60; h.area.process(player);
  assert.deepEqual(publish(), [N.GHAST], 'an unprotected damaging attack does not send a visible form');
  player.getInventory().add(new core.Item(FILLED_POUCH));
  h.clock.tick = 100; h.area.process(player);
  assert.equal(player.getInventory().getAmount(FILLED_POUCH), 0);
  assert.ok(publish().includes(N.GHAST_2), 'automatic pouch protection does reveal the attackable form');
  assert.ok(h.spawned[0].getCurrentDefinition(player).getActions().includes('Attack'));
});

test('native early grotto clicks keep Filliman reachable, recover via the exit and preserve later entry', async t => {
  const { PluginManager } = core;
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3440, 3337);
  core.RegionManager.loadMapFiles(3441, 9736);
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session); session.setPlayer(player);
  player.setIndex(101); player.setUsername('grottoearly'); player.setRegistered(true);
  player.setLocation(new core.Location(3440, 3336, 0)); player.needsPlacement = false;
  player.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(GHOSTSPEAK, 1));
  const h = harness({ nativeActors: true, player });
  const connection = new ClientConnection(channel); connection.player = player;
  const hookStart = PluginManager.objectInteractionHooks.length;
  const views = [];
  const previousSync = PluginManager.customEventHooks.get('network:sync-views');
  const api = PluginManager.createApi('nature-spirit-native-test');
  for (const handler of h.objectHooks) api.onObjectInteraction(handler);
  api.onCustomEvent('network:sync-views', event => { if (event.player === player) views.push(event.npcs); });
  t.after(() => {
    for (const handler of h.logouts) handler({ player });
    for (const npc of h.spawned) PluginManager.removeNpc(npc);
    PluginManager.objectInteractionHooks.length = hookStart;
    if (previousSync) PluginManager.customEventHooks.set('network:sync-views', previousSync);
    else PluginManager.customEventHooks.delete('network:sync-views');
    core.TaskManager.cancelTasks(player.getIndex()); player.setRegistered(false); session.flushPackets();
  });
  const position = () => [player.getLocation().x, player.getLocation().y, player.getLocation().z];
  const click = async (id, x, y) => {
    await connection.dispatch([{ type: 'object_option', id, x, y, clickType: 1 }]);
    connection.processTurnPackets();
    for (let tick = 0; tick < 8; tick++) {
      core.World.processCycle++; core.TaskManager.process();
      player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    }
    publish(); player.needsPlacement = false; // The next input follows the placement's sync.
  };
  let tick = 0;
  const publish = () => {
    const live = h.spawned.filter(npc => npc.isRegistered());
    for (const npc of live) npc.needsPlacement = false;
    core.World.updateLocalNpcs(player, live);
    session.flush(++tick); session.flush(++tick);
    return views.at(-1).map(npc => npc.typeId);
  };
  h.quest.setStage(player, 5);
  await click(O.GROTTO, 3440, 3337);
  assert.ok(player.getLocation().y < 4000, 'before the swamp gate, Enter does not move underground');
  assert.deepEqual(publish(), [], 'no Filliman is granted before the required gate progression');
  emit(h, 'door:toggle', { objectId: O.GATE_72 });
  assert.equal(h.quest.getStage(player), 10);
  assert.deepEqual(publish(), [], 'passing the swamp gate alone does not summon the ghost');
  for (const handler of h.logins) handler({ player });
  assert.deepEqual(publish(), [], 'logging in before the first entrance click does not summon him');
  await click(O.GROTTO, 3440, 3337);
  assert.ok(player.getLocation().y < 4000, 'early Enter summons Filliman instead of leaving him in another scene');
  assert.deepEqual(publish(), [N.FILLIMAN_TARLOCK], 'the owner actually receives Filliman in native session views');
  const outside = h.spawned.find(npc => npc.isRegistered());
  assert.deepEqual([outside.getLocation().x, outside.getLocation().y, outside.getLocation().z],
    [3440, 3336, 0], 'Filliman stands between the three ritual stones');
  await click(O.GROTTO, 3440, 3337);
  assert.equal(h.spawned.filter(npc => npc.isRegistered()).length, 1, 'repeat Enter does not duplicate Filliman');
  assert.equal(variant(h, N.FILLIMAN_TARLOCK), 'finding-filliman-talking-to-filliman');
  assert.equal(h.quest.getStage(player), 20, 'the still-reachable ghost advances the existing dialogue');

  // Players saved underground by the old handler can leave and resume at the entrance.
  player.moveTo(new core.Location(3441, 9736, 0)); player.needsPlacement = false;
  await click(O.GROTTO_3, 3442, 9733);
  assert.deepEqual(position(), [3443, 3338, 0]);
  await click(O.GROTTO, 3440, 3337);
  assert.deepEqual(publish(), [N.FILLIMAN_TARLOCK]);
  for (const handler of h.logouts) handler({ player });
  assert.equal(h.spawned.filter(npc => npc.isRegistered()).length, 0);
  for (const handler of h.logins) handler({ player });
  assert.equal(h.spawned.filter(npc => npc.isRegistered()).length, 0, 'the exterior ghost must be summoned again after relog');
  await click(O.GROTTO, 3440, 3337);
  assert.deepEqual(publish(), [N.FILLIMAN_TARLOCK], 'relogin restores exactly one usable owner actor');
  h.quest.setStage(player, 60);
  await click(O.GROTTO, 3440, 3337);
  assert.deepEqual(position(), [3441, 9736, 0]);
  assert.equal(h.quest.getStage(player), 65);
  assert.deepEqual(publish(), [N.FILLIMAN_TARLOCK], 'the inside actor stays a ghost until the transformation');
  h.quest.setStage(player, 110);
  await click(O.GROTTO_3, 3442, 9733);
  await click(O.GROTTO, 3440, 3337);
  assert.deepEqual(position(), [3441, 9736, 1]);
  assert.equal(h.quest.getStage(player), 110, 'post-quest entry cannot lower progress');
  player.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 0);
  await click(O.ALTAR_OF_NATURE, 3441, 9740);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER),
    player.getSkillManager().getMaxLevel(core.Skill.PRAYER) + 2, 'the actual plane-1 altar restores and boosts Prayer');
  await click(O.GROTTO_4, 3442, 9733);
  assert.equal(player.getLocation().z, 0, 'the finished grotto has a working native exit');
});


test('the swamp Area reports successful player entry independently of quest stage', () => {
  const h = harness();
  const entries = [];
  h.custom.set('mort-myre:entered', [event => entries.push(event.player)]);
  h.area.postEnter({ isPlayer: () => false });
  assert.deepEqual(entries, []);
  h.area.enter(h.player);
  assert.deepEqual(entries, [h.player]);
  h.player.getPrivateArea = () => ({});
  h.area.postEnter(h.player);
  assert.equal(entries.length, 1, 'private areas do not count as swamp entry');
});


test('walking through an already-open swamp gate records entry without crediting exits or teleports (#2852)', () => {
  const cases = [
    { from: [3443, 3459], to: [3443, 3457], expected: 10, name: 'running south through the gate' },
    { from: [3444, 3458], to: [3444, 3457], expected: 10, name: 'walking south through the gate' },
    { from: [3443, 3457], to: [3443, 3459], expected: 5, name: 'leaving the swamp' },
    { from: [3443, 3458], to: [3443, 3457], expected: 5, teleport: true, name: 'teleporting just inside' },
    { from: [3443, 3459], to: [3440, 3336], expected: 5, name: 'teleporting to the grotto' },
    { from: [3446, 3459], to: [3446, 3457], expected: 5, name: 'crossing elsewhere' },
  ];
  for (const entry of cases) {
    const h = harness(), p = h.player;
    h.quest.setStage(p, 5);
    p.setLocation(new core.Location(...entry.from, 0));
    h.area.process(p);
    p.setLocation(new core.Location(...entry.to, 0));
    p.needsPlacement = Boolean(entry.teleport);
    h.area.process(p);
    assert.equal(h.quest.getStage(p), entry.expected, entry.name);
    assert.equal(h.spawned.length, 0, 'crossing never auto-summons the ghost');
    objectAction(h, { objectId: O.GROTTO, ...interaction(['Enter'], 1) });
    assert.equal(h.spawned.some(npc => npc.getId() === N.FILLIMAN_TARLOCK),
      entry.expected === 10, entry.name + ': only legitimate entry unlocks the existing summon');
  }
});
