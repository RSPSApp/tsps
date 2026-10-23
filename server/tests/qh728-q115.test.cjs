// From server/: node --test tests/qh728-q115.test.cjs (after yarn build).
// Focused The Tourist Trap contracts: the Quest Helper stage graph, item
// hand-outs/consumption, the final hand-in and the cache completion wire.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogueData = require('../data/definitions/npc-dialogues.json');
const dialogueIndex = require('../data/definitions/npc-dialogue-index.json');
const core = PluginManager.getCoreApi();
const noop = () => {};
const STAGE_VERSION_ATTRIBUTE = 'the-tourist-trap:stage-version';
const LEGACY_STAGE_VERSION_ATTRIBUTE = 'quest.the_tourist_trap.stage-version';
const XP_CHOICES_ATTRIBUTE = 'the-tourist-trap:xp-choices';
const E = core.Equipment;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer(username = 'tourist-test') {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const xp = [];
  const varbits = new Map();
  const skillLevels = new Map();
  const equipped = new Map();
  let failAdds = false;
  let full = false;
  let location = new core.Location(3304, 3112, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (failAdds) return false;
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  const sender = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'getVarbit') return id => varbits.get(id) ?? 0;
      if (prop === 'sendVarbit') {
        return (id, value) => {
          varbits.set(id, value);
          log.push(['sendVarbit', id, value]);
          return sender;
        };
      }
      return (...args) => { log.push([String(prop), ...args]); return sender; };
    },
  });
  const skills = {
    getCurrentLevel: skill => skillLevels.get(skill) ?? 99,
    addExperiences: (skill, amount) => xp.push([skill, amount]),
  };
  return {
    attrs, items, messages, moves, log, xp, varbits,
    setFull(value) { full = value; },
    setFailAdds(value) { failAdds = value; },
    equip(id, slot) { equipped.set(slot, { getId: () => id }); },
    setSkillLevel(skill, level) { skillLevels.set(skill, level); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: slot => equipped.get(slot) ?? null }),
    getSkillManager: () => skills,
    getUsername: () => username,
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

function harness() {
  const events = {}, variants = [], conditions = [], itemOnNpc = [], itemOnObject = [], itemOnItem = [];
  const deaths = [], objectActions = new Map(), npcActions = new Map(), logins = [];
  const persistedDefaults = new Map();
  const testCore = { ...core };
  const api = new Proxy({
    core: testCore,
    persistAttribute: (key, value) => persistedDefaults.set(key, value),
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onItemOnNpc: handler => itemOnNpc.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemOnItem: handler => itemOnItem.push(handler),
    onNpcDeath: handler => deaths.push(handler),
    onObjectInteraction: (name, actions) => {
      if (typeof name !== 'string' || !actions) throw new Error('unexpected generic object hook');
      objectActions.set(name, actions);
    },
    onNpcInteraction: (name, actions) => {
      if (typeof name !== 'string' || !actions) throw new Error('unexpected generic npc hook');
      npcActions.set(name, actions);
    },
    onPlayerLogin: handler => logins.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/TouristTrap.Quest')(api);
  const quest = runtime.getRegisteredQuests().find(entry => entry.key === 'the_tourist_trap');
  return { events, variants, conditions, itemOnNpc, itemOnObject, itemOnItem, deaths, objectActions, npcActions, logins, persistedDefaults, quest };
}

function object(h, npcName, option, event) {
  const handler = h.objectActions.get(npcName)?.[option];
  assert.ok(handler, `${npcName} ${option} is registered`);
  handler(event);
  return event;
}

function action(h, event) {
  h.events['npc-dialogue:action'].forEach(handler => handler(event));
  return event;
}

function hook(h, event) {
  h.events['npc-dialogue:hook'].forEach(handler => handler(event));
  return event;
}

function choice(h, event) {
  h.events['npc-dialogue:choice'].forEach(handler => handler(event));
  return event;
}

function stage(h, p) {
  return h.quest.getStage(p);
}

/** A varbit the plugin never had to change still reads as 0. */
function varbit(p, id) {
  return p.varbits.get(id) ?? 0;
}

function seedStage(h, p, value) {
  p.setAttribute('quest.the_tourist_trap.stage', value);
  p.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
}

function runRegisteredTranscript(h, player, npcId) {
  const events = {};
  const npcApi = new Proxy({
    core,
    onAnyNpcInteraction: noop,
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/npcs/NpcDialogues.plugin').register(npcApi);
  const hooks = PluginManager.npcDialogueVariantHooks;
  const before = hooks.length;
  hooks.push({ pluginName: 'qh728-q115-runner', handler: h.variants.at(-1) });
  try {
    const manager = new DialogueManager(player);
    player.getDialogueManager = () => manager;
    const request = { player, npcId, handled: false };
    events['npc-dialogue:start'].forEach(handler => handler(request));
    assert.equal(request.handled, true, `the runner resolves a transcript for ${npcId}`);
    return manager.getCurrent();
  } finally {
    hooks.length = before;
  }
}

test('fresh stage 0 starts, the captain drops the metal key, and the slave trade swaps the desert outfit', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  assert.equal(stage(h, p), 0);

  hook(h, { player: p, npcId: core.NpcIdentifiers.IRENA, hook: 'quest:the-tourist-trap:start' });
  assert.equal(stage(h, p), 1);

  p.isPlayer = () => true;
  h.deaths.forEach(handler => handler({ npcId: core.NpcIdentifiers.MERCENARY_CAPTAIN, killer: p }));
  assert.equal(p.items.get(K.METAL_KEY), 1, 'the captain drops the camp key');
  assert.equal(stage(h, p), 2);

  // Fixture: the player has entered the camp and brought the required outfit.
  seedStage(h, p, 4);
  p.items.set(K.DESERT_SHIRT, 1);
  p.items.set(K.DESERT_ROBE, 1);
  p.items.set(K.DESERT_BOOTS, 1);
  const trade = action(h, { player: p, npcId: 4670, stepId: 'Q30ZW_' });
  assert.equal(p.items.get(K.DESERT_SHIRT), 0);
  assert.equal(p.items.get(K.DESERT_ROBE), 0);
  assert.equal(p.items.get(K.DESERT_BOOTS), 0);
  assert.equal(p.items.get(K.SLAVE_SHIRT), 1);
  assert.equal(p.items.get(K.SLAVE_ROBE), 1);
  assert.equal(p.items.get(K.SLAVE_BOOTS), 1);
  assert.equal(stage(h, p), 7);
});

test('the selector binds male slaves to the quest page and female slaves to their canonical page', () => {
  const h = harness();
  const p = makePlayer();
  const selector = h.variants.at(-1);
  const maleIds = [core.NpcIdentifiers.MALE_SLAVE, core.NpcIdentifiers.MALE_SLAVE_2, core.NpcIdentifiers.MALE_SLAVE_3];
  const femaleIds = [core.NpcIdentifiers.FEMALE_SLAVE, core.NpcIdentifiers.FEMALE_SLAVE_2, core.NpcIdentifiers.FEMALE_SLAVE_3];

  for (const npcId of maleIds) {
    const variant = selector({ player: p, npcId });
    assert.equal(variant, 'inside-the-camp-talking-to-male-slave-by-the-mine-door-entrance', `male ${npcId} at stage 0`);
    assert.ok(dialogueData['The Tourist Trap'].variants[variant], `male ${npcId} uses the quest page`);
  }
  for (const npcId of femaleIds) {
    const choice = selector({ player: p, npcId });
    assert.deepEqual(choice, { page: 'Female slave', variant: 'overhead-dialogue-when-spoken-to' }, `female ${npcId} at stage 0`);
    assert.ok(dialogueData['Female slave'].variants[choice.variant], `female ${npcId} uses the female page`);
    assert.ok(dialogueIndex[String(npcId)].some(entry => entry.page === 'Transcript:Female slave'));
    assert.equal(dialogueData['Female slave'].variants[choice.variant][0].npc,
      "Hey leave me alone, can't you see that I'm busy?");
  }

  seedStage(h, p, 7);
  assert.deepEqual(selector({ player: p, npcId: core.NpcIdentifiers.FEMALE_SLAVE_2 }),
    { page: 'Female slave', variant: 'overhead-dialogue-when-spoken-to' }, 'female slave at the neighbouring stage');
  p.items.set(core.ItemIdentifiers.DESERT_SHIRT, 1);
  p.items.set(core.ItemIdentifiers.DESERT_ROBE, 1);
  p.items.set(core.ItemIdentifiers.DESERT_BOOTS, 1);
  assert.equal(selector({ player: p, npcId: core.NpcIdentifiers.MALE_SLAVE_2 }),
    'inside-the-camp-talking-to-the-male-slave-after-he-offers-to-trade', 'male slave at the neighbouring stage');
});

test('the registered runner plays the female overhead transcript rather than the male quest page', () => {
  const h = harness();
  const female = makePlayer('tourist-female');
  const femaleCurrent = runRegisteredTranscript(h, female, core.NpcIdentifiers.FEMALE_SLAVE_2);
  assert.ok(!(femaleCurrent instanceof NpcDialogue), 'female slave does not start the male slave conversation');

  const male = makePlayer('tourist-male');
  const maleCurrent = runRegisteredTranscript(h, male, core.NpcIdentifiers.MALE_SLAVE_2);
  assert.ok(maleCurrent instanceof NpcDialogue, 'male slave starts a spoken line');
  assert.match(maleCurrent.getText(), /You look like a new 'recruit'/, 'male slave uses the quest transcript');
});

test('the gate and mine door only let a keyed, dressed player through', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 2);
  p.items.set(K.METAL_KEY, 1);
  p.items.set(K.DESERT_SHIRT, 1);
  p.items.set(K.DESERT_ROBE, 1);
  p.items.set(K.DESERT_BOOTS, 1);
  const gate = object(h, 'Gate', 'Open', { player: p, objectId: 2673, handled: false });
  assert.equal(gate.handled, true);
  assert.equal(stage(h, p), 4);

  p.items.delete(K.DESERT_SHIRT);
  p.setLocation(3271, 3029, 0);
  const refused = object(h, 'Gate', 'Open', { player: p, objectId: 2674, handled: false });
  assert.equal(refused.handled, true);
  assert.ok(p.messages.some(text => text.includes('desert clothes')));

  p.items.set(K.SLAVE_SHIRT, 1);
  p.items.set(K.SLAVE_ROBE, 1);
  p.items.set(K.SLAVE_BOOTS, 1);
  const moveCountBeforeMine = p.moves.length;
  const carriedOnly = object(h, 'Mine door entrance', 'Open', { player: p, objectId: 2675, handled: false });
  assert.equal(carriedOnly.handled, true);
  assert.equal(p.moves.length, moveCountBeforeMine, 'carrying the slave clothes does not satisfy the mine disguise check');
  p.equip(K.SLAVE_SHIRT, E.BODY_SLOT);
  p.equip(K.SLAVE_ROBE, E.LEG_SLOT);
  p.equip(K.SLAVE_BOOTS, E.FEET_SLOT);
  const mine = object(h, 'Mine door entrance', 'Open', { player: p, objectId: 2675, handled: false });
  assert.equal(mine.handled, true);
  assert.ok(p.moves.length > 0, 'the mine door moves the player underground');
});

test('the Desert Clothes trade requires the carried set, while worn desert gear still passes the camp gate', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 4);
  p.equip(K.DESERT_SHIRT, E.BODY_SLOT);
  p.equip(K.DESERT_ROBE, E.LEG_SLOT);
  p.equip(K.DESERT_BOOTS, E.FEET_SLOT);
  action(h, { player: p, npcId: 4670, stepId: 'Q30ZW_' });
  assert.equal(p.items.get(K.SLAVE_SHIRT) ?? 0, 0, 'worn desert clothes are not consumed by the trade');

  p.items.set(K.METAL_KEY, 1);
  const gate = object(h, 'Gate', 'Open', { player: p, objectId: 2673, handled: false });
  assert.equal(gate.handled, true);
  assert.deepEqual(p.moves.at(-1), [3274, 3029, 0], 'the worn desert set counts as the entry outfit');
});

test('a failed inventory insert does not consume the prototype dart or advance the pineapple leg', () => {
  const h = harness();
  const p = makePlayer();
  seedStage(h, p, 16);
  p.items.set(core.ItemIdentifiers.PROTOTYPE_DART, 1);
  p.setFailAdds(true);
  action(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, stepId: 'NJ2t2J' });
  assert.equal(stage(h, p), 16);
  assert.equal(p.items.get(core.ItemIdentifiers.PROTOTYPE_DART), 1);
  assert.equal(p.items.get(core.ItemIdentifiers.TENTI_PINEAPPLE) ?? 0, 0);
});

test('recovery: lost Bedabin key, lost pineapple and a lost metal key are reobtainable', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;

  seedStage(h, p, 10);
  const lostKeyVariant = h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.AL_SHABIM });
  assert.equal(lostKeyVariant, 'the-quest-for-tenti-s-after-losing-the-bedabin-key');
  action(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, stepId: 'AgNSAO' });
  assert.equal(p.items.get(K.BEDABIN_KEY), 1);

  seedStage(h, p, 16);
  const lostPineappleVariant = h.variants.at(-1)({ player: p, npcId: core.NpcIdentifiers.AL_SHABIM });
  assert.equal(lostPineappleVariant, 'the-quest-for-tenti-s-talking-to-al-shabim-after-losing-the-pineapple');
  choice(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, option: 'I am looking for a pineapple.' });
  assert.equal(p.items.get(K.TENTI_PINEAPPLE), 1);

  seedStage(h, p, 2);
  p.items.delete(K.METAL_KEY);
  p.isPlayer = () => true;
  h.deaths.forEach(handler => handler({ npcId: 4656, killer: p }));
  assert.equal(p.items.get(K.METAL_KEY), 1);
});

test('the mine guard conversation advances the route and the camp can be left for Al Shabim', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 7);
  p.items.set(K.SLAVE_SHIRT, 1);
  p.items.set(K.SLAVE_ROBE, 1);
  p.items.set(K.SLAVE_BOOTS, 1);
  p.equip(K.SLAVE_SHIRT, E.BODY_SLOT);
  p.equip(K.SLAVE_ROBE, E.LEG_SLOT);
  p.equip(K.SLAVE_BOOTS, E.FEET_SLOT);

  action(h, { player: p, npcId: 4667, stepId: 'jZJCvV' });
  assert.equal(stage(h, p), 8);

  object(h, 'Mine door entrance', 'Open', { player: p, objectId: 2690, handled: false });
  assert.equal(stage(h, p), 9);
  assert.deepEqual(p.moves.at(-1), [3279, 3029, 0]);

  const gate = object(h, 'Gate', 'Open', { player: p, objectId: 2673, handled: false });
  assert.equal(gate.handled, true);
  assert.deepEqual(p.moves.at(-1), [3272, 3029, 0]);
});

test('Al Shabim, Siad, the chest, the anvil and the feathers build the prototype dart and pineapple', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 9);

  action(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, stepId: 'pdpFAf' });
  assert.equal(p.items.get(K.BEDABIN_KEY), 1);
  assert.equal(stage(h, p), 10);

  const bookcase = object(h, 'Bookcase', 'Search', { player: p, objectId: 2678, handled: false });
  assert.equal(bookcase.handled, true);
  assert.equal(p.getAttribute('the-tourist-trap:searched-bookcase'), true);

  action(h, { player: p, npcId: core.NpcIdentifiers.CAPTAIN_SIAD, stepId: 'HorYZZ' });
  assert.equal(p.getAttribute('the-tourist-trap:distracted-siad'), true);
  assert.equal(stage(h, p), 11);

  const chest = object(h, 'Chest', 'Open', { player: p, objectId: 2677, handled: false });
  assert.equal(chest.handled, true);
  assert.equal(p.items.get(K.TECHNICAL_PLANS), 1);
  assert.equal(stage(h, p), 12);

  p.items.set(K.HAMMER, 1);
  p.items.set(K.BRONZE_BAR, 3);
  p.items.set(K.FEATHER, 10);
  const anvil = object(h, 'An experimental anvil', 'Use', { player: p, objectId: 2672, handled: false });
  assert.equal(anvil.handled, true);
  assert.equal(p.items.get(K.BRONZE_BAR), 0, 'all three bronze bars are spent');
  assert.equal(p.items.get(K.PROTOTYPE_DART_TIP), 1);
  assert.equal(stage(h, p), 13);

  const fletch = { player: p, itemId: K.FEATHER, otherItemId: K.PROTOTYPE_DART_TIP, handled: false };
  h.itemOnItem.forEach(handler => handler(fletch));
  assert.equal(fletch.handled, true);
  assert.equal(p.items.get(K.FEATHER), 0);
  assert.equal(p.items.get(K.PROTOTYPE_DART_TIP), 0);
  assert.equal(p.items.get(K.PROTOTYPE_DART), 1);
  assert.equal(stage(h, p), 15);

  action(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, stepId: 'NJ2t2J' });
  assert.equal(p.items.get(K.PROTOTYPE_DART), 0, 'the prototype dart is handed over');
  assert.equal(p.items.get(K.TECHNICAL_PLANS), 1, 'the technical plans stay with the player');
  assert.equal(p.items.get(K.TENTI_PINEAPPLE), 1);
  assert.equal(stage(h, p), 16);
});

test('the guard distraction, barrel route and escape reach the Shantay Pass with Ana', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 16);
  p.items.set(K.TENTI_PINEAPPLE, 1);

  const distraction = { player: p, npcId: 4667, itemId: K.TENTI_PINEAPPLE, handled: false };
  h.itemOnNpc.forEach(handler => handler(distraction));
  assert.equal(distraction.handled, true);
  assert.equal(p.items.get(K.TENTI_PINEAPPLE), 0);
  assert.equal(stage(h, p), 17);

  object(h, 'Mine cave', 'Walk through', { player: p, objectId: 2698, handled: false });
  assert.equal(stage(h, p), 18);

  object(h, 'Barrel', 'Search', { player: p, objectId: 2680, handled: false });
  assert.equal(p.items.get(K.BARREL), 1);
  assert.equal(stage(h, p), 19);

  object(h, 'Mine Cart', 'Search', { player: p, objectId: 2684, handled: false });
  assert.equal(stage(h, p), 20);

  const ana = { player: p, npcId: core.NpcIdentifiers.ANA, itemId: K.BARREL, handled: false };
  h.itemOnNpc.forEach(handler => handler(ana));
  assert.equal(ana.handled, true);
  assert.equal(p.items.get(K.BARREL), 0);
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 1);
  assert.equal(stage(h, p), 21);

  const anaOnCart = { player: p, objectId: 2684, itemId: K.ANA_IN_A_BARREL, handled: false };
  h.itemOnObject.forEach(handler => handler(anaOnCart));
  assert.equal(anaOnCart.handled, true);
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 0, 'Ana is put on the mine cart');
  assert.equal(stage(h, p), 22);

  object(h, 'Mine Cart', 'Search', { player: p, objectId: 2684, handled: false });
  assert.equal(stage(h, p), 23);
  object(h, 'Winch bucket', 'Use', { player: p, objectId: 18951, handled: false });
  assert.equal(stage(h, p), 23);
  object(h, 'Winch', 'Operate', { player: p, objectId: 18888, handled: false });
  assert.equal(stage(h, p), 24);
  object(h, 'Barrel', 'Search', { player: p, objectId: 18962, handled: false });
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 1);
  object(h, 'Wooden cart', 'Search', { player: p, objectId: 18958, handled: false });
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 0);
  assert.equal(stage(h, p), 25);

  const driver = { player: p, npcId: core.NpcIdentifiers.MINE_CART_DRIVER, handled: false };
  const driverResult = h.npcActions.get('Mine cart driver')['Talk-to'](driver);
  assert.equal(driverResult, false, 'the transcript still plays');
  assert.equal(stage(h, p), 26);

  object(h, 'Wooden cart', 'Search', { player: p, objectId: 18958, handled: false });
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 1);
  assert.equal(stage(h, p), 27);
  assert.deepEqual(p.moves.at(-1), [3304, 3112, 0]);
});

test('Irena grants two 4,650 XP choices, completes on the canonical varp 197 = 30, and grants nothing twice', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 27);
  p.items.set(K.ANA_IN_A_BARREL, 1);
  const selectIrena = h.variants.at(-1);
  assert.equal(selectIrena({ player: p, npcId: core.NpcIdentifiers.IRENA_2 }),
    'finishing-up-talking-to-irena-while-holding-ana-in-a-barrel');

  choice(h, { player: p, npcId: core.NpcIdentifiers.IRENA_2, option: 'Agility.' });
  assert.equal(p.getAttribute(XP_CHOICES_ATTRIBUTE), 1);
  assert.equal(selectIrena({ player: p, npcId: core.NpcIdentifiers.IRENA_2 }),
    'finishing-up-talking-to-irena-after-choosing-the-first-skill',
  'reopening after the first reward skips the first menu and preserves the second choice');
  choice(h, { player: p, npcId: core.NpcIdentifiers.IRENA_2, option: 'Smithing.' });
  choice(h, { player: p, npcId: core.NpcIdentifiers.IRENA_2, option: 'Thieving.' });
  assert.deepEqual(p.xp, [[core.Skill.AGILITY, 4650], [core.Skill.SMITHING, 4650]]);

  const complete = action(h, { player: p, npcId: core.NpcIdentifiers.IRENA_2, stepId: 'ByiIGp' });
  assert.equal(complete.handled, true);
  assert.equal(stage(h, p), 30);
  assert.equal(h.quest.completionValue, 30);
  assert.equal(h.quest.varpId, 197);
  assert.ok(p.log.some(entry => entry[0] === 'sendConfig' && entry[1] === 197 && entry[2] === 30));
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 0);
  assert.equal(p.items.get(K.SLAVE_ROBE) ?? 0, 0, 'the quest does not hand out a slave robe as a reward');
  assert.equal(p.attrs.get('quest.points'), 2);

  action(h, { player: p, npcId: core.NpcIdentifiers.IRENA_2, stepId: 'ByiIGp' });
  assert.equal(p.attrs.get('quest.points'), 2, 'completion is not repeatable');
  assert.equal(p.xp.length, 2);
});

test('login migrates the old plugin stages without renumbering completed saves and resends varp 197', () => {
  const h = harness();
  const p = makePlayer();
  p.setAttribute('quest.the_tourist_trap.stage', 20);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(stage(h, p), 10, 'old stage 20 becomes the Al Shabim task stage');
  assert.equal(p.getAttribute(STAGE_VERSION_ATTRIBUTE), 1);
  runtime.sendQuestVarps({ player: p });
  assert.ok(p.log.some(entry => entry[0] === 'sendConfig' && entry[1] === 197 && entry[2] === 10));

  const disguised = makePlayer('tourist-disguised');
  disguised.setAttribute('quest.the_tourist_trap.stage', 10);
  h.logins.forEach(handler => handler({ player: disguised }));
  assert.equal(stage(h, disguised), 7, 'old stage 10 becomes the slave-clothes stage');

  const carrying = makePlayer('tourist-carrying');
  carrying.setAttribute('quest.the_tourist_trap.stage', 25);
  h.logins.forEach(handler => handler({ player: carrying }));
  assert.equal(stage(h, carrying), 21, 'old stage 25 becomes Ana in a barrel');

  const done = makePlayer('tourist-done');
  done.setAttribute('quest.the_tourist_trap.stage', 30);
  h.logins.forEach(handler => handler({ player: done }));
  assert.equal(stage(h, done), 30);
  runtime.sendQuestVarps({ player: done });
  assert.ok(done.log.some(entry => entry[0] === 'sendConfig' && entry[1] === 197 && entry[2] === 30));
});

test('stage migration keeps a previously versioned save when the namespaced key replaces the legacy key', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.persistedDefaults.get(LEGACY_STAGE_VERSION_ATTRIBUTE), 0,
    'PlayerSave only restores registered keys, including the legacy migration input');
  p.setAttribute('quest.the_tourist_trap.stage', 10);
  p.setAttribute(LEGACY_STAGE_VERSION_ATTRIBUTE, 1);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(stage(h, p), 10, 'current stage 10 is not reinterpreted as an old stage');
  assert.equal(p.getAttribute(STAGE_VERSION_ATTRIBUTE), 1, 'the current namespaced version key is written');
  assert.equal(p.getAttribute(LEGACY_STAGE_VERSION_ATTRIBUTE), 0, 'the migrated input is omitted from future saves');
  assert.equal(h.persistedDefaults.get(STAGE_VERSION_ATTRIBUTE), 0);
});

test('a full bag refuses the captain key without advancing', () => {
  const h = harness();
  const p = makePlayer();
  seedStage(h, p, 1);
  p.setFull(true);
  p.isPlayer = () => true;
  h.deaths.forEach(handler => handler({ npcId: core.NpcIdentifiers.MERCENARY_CAPTAIN, killer: p }));
  assert.equal(p.items.get(core.ItemIdentifiers.METAL_KEY) ?? 0, 0);
  assert.equal(stage(h, p), 1);
  assert.ok(p.messages.some(text => text.includes('no space')));
});

test('the cache transforms the quest NPCs and locs by the varbits the plugin sets', () => {
  // The cache keeps the tourist trap's characters as transform parents; the
  // real model, name and options only appear with the matching varbit.
  const barrel = CacheDefinitions.getObject(18963);
  assert.equal(barrel.transformVarbit, 2808);
  assert.deepEqual(barrel.transforms, [-1, 18962, -1], 'the winch-side barrel turns into Ana\'s barrel');
  const cart = CacheDefinitions.getObject(2682);
  assert.equal(cart.transformVarbit, 2809);
  assert.deepEqual(cart.transforms, [18958, 18959, -1], 'the flatback cart turns into the wooden cart');
  const slave = CacheDefinitions.getNpc(6232);
  assert.equal(slave.transformVarbit, 2803);
  assert.deepEqual(slave.transforms, [4632, 4633, -1], 'the camp slave becomes the escaping slave');
  const irena = CacheDefinitions.getNpc(6233);
  assert.equal(irena.transformVarbit, 2807);
  assert.deepEqual(irena.transforms, [4640, -1]);
  assert.equal(CacheDefinitions.getNpc(4636).transformVarbit, 19501);
  assert.deepEqual(CacheDefinitions.getNpc(4636).transforms, [15049, -1], 'the camp captain is Captain Siad');
  assert.equal(CacheDefinitions.getNpc(4633).name, 'Escaping slave');
});

test('the quest varbits put those transforms in step with the route', () => {
  const h = harness();
  const p = makePlayer();

  seedStage(h, p, 4);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(varbit(p, 2803), 0, 'the camp slave is still the male slave');
  assert.equal(varbit(p, 2807), 0, 'Irena is still sad');
  assert.equal(varbit(p, 2808), 0);
  assert.equal(varbit(p, 2809), 0);

  seedStage(h, p, 7);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(varbit(p, 2803), 1, 'the traded slave walks out as the escaping slave');
  assert.equal(varbit(p, 2807), 0);

  seedStage(h, p, 24);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(varbit(p, 2808), 1, 'Ana is in the barrel west of the winch');
  assert.equal(varbit(p, 2809), 0);

  seedStage(h, p, 27);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(varbit(p, 2807), 1, 'Irena is happy once Ana is back');
  assert.equal(varbit(p, 2809), 2, 'the camp cart is gone once the player escaped');
});

test('the placed winch barrel and camp cart carry Ana out of the camp', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 21);
  p.items.set(K.ANA_IN_A_BARREL, 1);

  const anaOnMineCart = { player: p, objectId: 2684, itemId: K.ANA_IN_A_BARREL, handled: false };
  h.itemOnObject.forEach(handler => handler(anaOnMineCart));
  assert.equal(stage(h, p), 22);

  object(h, 'Mine Cart', 'Search', { player: p, objectId: 2684, handled: false });
  assert.equal(stage(h, p), 23);
  object(h, 'Winch bucket', 'Use', { player: p, objectId: 18951, handled: false });
  assert.equal(stage(h, p), 23);
  object(h, 'Winch', 'Operate', { player: p, objectId: 18888, handled: false });
  assert.equal(stage(h, p), 24);
  assert.equal(varbit(p, 2808), 1, 'the barrel with Ana appears west of the winch');

  // The map places the transform parent 18963; the cache turns it into 18962.
  object(h, 'Barrel', 'Search', { player: p, objectId: 18963, handled: false });
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 1, 'Ana is found in the barrel');
  assert.equal(varbit(p, 2808), 0);

  // The map places the transform parent 2682; the cache turns it into the cart.
  const anaOnCampCart = { player: p, objectId: 2682, itemId: K.ANA_IN_A_BARREL, handled: false };
  h.itemOnObject.forEach(handler => handler(anaOnCampCart));
  assert.equal(anaOnCampCart.handled, true);
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 0);
  assert.equal(stage(h, p), 25);
  assert.equal(varbit(p, 2809), 1, 'Ana rides the flatback cart');

  const driver = { player: p, npcId: core.NpcIdentifiers.MINE_CART_DRIVER, handled: false };
  assert.equal(h.npcActions.get('Mine cart driver')['Talk-to'](driver), false);
  assert.equal(stage(h, p), 26);

  object(h, 'Wooden cart', 'Search', { player: p, objectId: 2682, handled: false });
  assert.equal(p.items.get(K.ANA_IN_A_BARREL), 1);
  assert.equal(stage(h, p), 27);
  assert.deepEqual(p.moves.at(-1), [3304, 3112, 0]);
  assert.equal(varbit(p, 2809), 2, 'the cart leaves with the player');
  assert.equal(varbit(p, 2807), 1, 'Irena waits happily at the Shantay Pass');
});

test('the prototype dart hand-in keeps the technical plans the anvil needs', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 15);
  p.items.set(K.PROTOTYPE_DART, 1);
  p.items.set(K.TECHNICAL_PLANS, 1);
  p.items.set(K.HAMMER, 1);
  p.items.set(K.BRONZE_BAR, 3);

  const selector = h.variants.at(-1);
  assert.equal(selector({ player: p, npcId: core.NpcIdentifiers.AL_SHABIM }),
    'the-quest-for-tenti-s-talking-to-al-shabim-while-holding-the-prototype-dart');

  action(h, { player: p, npcId: core.NpcIdentifiers.AL_SHABIM, stepId: 'NJ2t2J' });
  assert.equal(p.items.get(K.PROTOTYPE_DART), 0, 'the prototype dart is handed over');
  assert.equal(p.items.get(K.TECHNICAL_PLANS), 1, 'the technical plans stay with the player');
  assert.equal(p.items.get(K.TENTI_PINEAPPLE), 1);
  assert.equal(stage(h, p), 16);
  assert.equal(selector({ player: p, npcId: core.NpcIdentifiers.AL_SHABIM }),
    'the-quest-for-tenti-s-talking-to-al-shabim-while-holding-the-technical-plans',
    'the plans are still held, so the canonical plans dialogue stays reachable');

  const anvil = object(h, 'An experimental anvil', 'Use', { player: p, objectId: 2672, handled: false });
  assert.equal(anvil.handled, true);
  assert.equal(p.items.get(K.PROTOTYPE_DART_TIP), 1, 'the dart tip can be forged again');
});

test('dart crafting enforces the actual Smithing and Fletching requirements without consuming supplies', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 12);
  p.items.set(K.TECHNICAL_PLANS, 1);
  p.items.set(K.HAMMER, 1);
  p.items.set(K.BRONZE_BAR, 3);
  p.setSkillLevel(core.Skill.SMITHING, 19);
  h.objectActions.get('An experimental anvil').Use({ player: p, objectId: 2672, handled: false });
  assert.equal(p.items.get(K.BRONZE_BAR), 3, 'low Smithing leaves the bars intact');
  assert.equal(stage(h, p), 12);

  p.setSkillLevel(core.Skill.SMITHING, 20);
  h.objectActions.get('An experimental anvil').Use({ player: p, objectId: 2672, handled: false });
  assert.equal(p.items.get(K.PROTOTYPE_DART_TIP), 1);
  assert.equal(p.items.get(K.BRONZE_BAR), 0);
  p.items.set(K.FEATHER, 10);
  p.setSkillLevel(core.Skill.FLETCHING, 9);
  const combine = { player: p, itemId: K.FEATHER, otherItemId: K.PROTOTYPE_DART_TIP, handled: false };
  h.itemOnItem.forEach(handler => handler(combine));
  assert.equal(combine.handled, true);
  assert.equal(p.items.get(K.FEATHER), 10, 'low Fletching leaves feathers intact');
  assert.equal(p.items.get(K.PROTOTYPE_DART_TIP), 1);
  assert.equal(stage(h, p), 13);

  p.setSkillLevel(core.Skill.FLETCHING, 10);
  h.itemOnItem.forEach(handler => handler({ ...combine, handled: false }));
  assert.equal(p.items.get(K.PROTOTYPE_DART), 1);
  assert.equal(stage(h, p), 15);
});

test('a lost slave outfit is recovered the canonical way', () => {
  const h = harness();
  const p = makePlayer();
  const K = core.ItemIdentifiers;
  seedStage(h, p, 7);
  p.items.set(K.METAL_KEY, 1);
  p.items.set(K.SLAVE_SHIRT, 1);
  p.items.set(K.SLAVE_ROBE, 1);
  p.items.set(K.SLAVE_BOOTS, 1);
  const selector = h.variants.at(-1);

  // The outfit is lost inside the camp.
  p.items.delete(K.SLAVE_SHIRT);
  p.items.delete(K.SLAVE_ROBE);
  p.items.delete(K.SLAVE_BOOTS);
  assert.equal(selector({ player: p, npcId: core.NpcIdentifiers.MALE_SLAVE }),
    'inside-the-camp-talking-to-the-male-slave-after-losing-the-slave-clothes');
  assert.ok(dialogueData['The Tourist Trap'].variants['inside-the-camp-talking-to-the-male-slave-after-losing-the-slave-clothes']);

  // The gate lets the player out of the camp again.
  p.setLocation(3280, 3029, 0);
  const leave = object(h, 'Gate', 'Open', { player: p, objectId: 2673, handled: false });
  assert.equal(leave.handled, true);
  assert.deepEqual(p.moves.at(-1), [3272, 3029, 0], 'the player leaves the camp');

  // A new desert outfit from the Shantay Pass shop, then the trade again.
  p.items.set(K.DESERT_SHIRT, 1);
  p.items.set(K.DESERT_ROBE, 1);
  p.items.set(K.DESERT_BOOTS, 1);
  const enter = object(h, 'Gate', 'Open', { player: p, objectId: 2673, handled: false });
  assert.equal(enter.handled, true);
  assert.deepEqual(p.moves.at(-1), [3274, 3029, 0], 'the player gets back into the camp');

  choice(h, { player: p, npcId: core.NpcIdentifiers.MALE_SLAVE, option: "Yes, I'll trade." });
  assert.equal(p.items.get(K.DESERT_SHIRT), 0);
  assert.equal(p.items.get(K.DESERT_ROBE), 0);
  assert.equal(p.items.get(K.DESERT_BOOTS), 0);
  assert.equal(p.items.get(K.SLAVE_SHIRT), 1, 'the slave robes are handed back');
  assert.equal(p.items.get(K.SLAVE_ROBE), 1);
  assert.equal(p.items.get(K.SLAVE_BOOTS), 1);

  // The traded outfit is carried until it is equipped.
  const mine = object(h, 'Mine door entrance', 'Open', { player: p, objectId: 2675, handled: false });
  assert.equal(mine.handled, true);
  assert.deepEqual(p.moves.at(-1), [3274, 3029, 0], 'the carried outfit alone does not enter the mine');
  p.equip(K.SLAVE_SHIRT, E.BODY_SLOT);
  p.equip(K.SLAVE_ROBE, E.LEG_SLOT);
  p.equip(K.SLAVE_BOOTS, E.FEET_SLOT);
  const wornMine = object(h, 'Mine door entrance', 'Open', { player: p, objectId: 2675, handled: false });
  assert.equal(wornMine.handled, true);
  assert.deepEqual(p.moves.at(-1), [3279, 9420, 0]);
});

test('the escaping slave owns his own transcript and turns back into a male slave', () => {
  const h = harness();
  const p = makePlayer();
  const selector = h.variants.at(-1);
  seedStage(h, p, 7);
  h.logins.forEach(handler => handler({ player: p }));
  assert.equal(varbit(p, 2803), 1, 'the traded slave is the escaping slave');

  const variant = selector({ player: p, npcId: core.NpcIdentifiers.ESCAPING_SLAVE });
  assert.equal(variant, 'inside-the-camp-talking-to-the-escaping-slave');
  assert.ok(dialogueData['The Tourist Trap'].variants[variant]);
  assert.ok(dialogueIndex[String(core.NpcIdentifiers.ESCAPING_SLAVE)]
    .some(entry => entry.page === 'Transcript:The Tourist Trap' && entry.variants.includes(variant)));

  action(h, { player: p, npcId: core.NpcIdentifiers.ESCAPING_SLAVE, stepId: 'nxSDg3' });
  assert.equal(varbit(p, 2803), 0, 'the caught escaping slave turns back into a male slave');
});
