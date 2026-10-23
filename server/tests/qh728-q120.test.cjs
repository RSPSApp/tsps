// From server/: node --test tests/qh728-q120.test.cjs (after the baseline build).
// Scoped Troll Stronghold (q120) contracts against Quest Helper 06da90f.
// The stage graph below fixture-sets a stage and starts at a handler edge; it is
// not a natural playthrough. Scene handoffs, death/key edges, the Dunstan hand-in,
// cache wire and post-quest Law talisman reclaim are dispatched through the real
// registered plugin handlers.
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
  const configs = [];
  const varbits = [];
  const skills = new Map();
  const banks = [];
  let full = false;
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return inventory;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return inventory;
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
  const sender = {
    sendConfig: (id, value) => { configs.push([id, value]); },
    sendVarbit: (id, value) => { varbits.push([id, value]); },
  };
  const proxy = new Proxy(sender, { get: (target, prop) => target[prop] ?? (() => proxy) });
  return {
    attrs, items, messages, moves, configs, varbits, banks,
    setFull(value) { full = value; },
    setSkill(skill, value) { skills.set(skill, value); },
    setCombatLevel(value) { skills.set('combat', value); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBank: () => ({ getAmount: () => 0 }),
    getBanks: () => banks,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: skill => skills.get(skill) ?? 99,
      getCombatLevel: () => skills.get('combat') ?? 3,
      addExperiences: (skill, amount) => skills.set(skill, (skills.get(skill) ?? 0) + amount),
    }),
    getUsername: () => 'troll-stronghold-test',
    getPrivateArea: () => null,
    getPacketSender: () => proxy,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness() {
  const events = {}, variants = [], conditions = [], npcDeath = [], logins = [];
  const objectActions = new Map(), npcActions = new Map();
  const objectManager = { deregistered: [], registered: [] };
  const testCore = Object.create(core);
  Object.defineProperty(testCore, 'ObjectManager', {
    value: {
      deregister: object => objectManager.deregistered.push(object.getId()),
      register: object => objectManager.registered.push({
        id: object.getId(),
        x: object.getLocation().getX(),
        y: object.getLocation().getY(),
        z: object.getLocation().getZ(),
      }),
    },
  });
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onObjectInteraction: (name, actions) => objectActions.set(name, actions),
    onNpcInteraction: (name, actions) => npcActions.set(name, actions),
    onNpcDeath: handler => npcDeath.push(handler),
    onPlayerLogin: handler => logins.push(handler),
    onInterfaceActionButton: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/TrollStronghold.Quest')(api);
  return {
    events, variants, conditions, npcDeath, logins, objectActions, npcActions, objectManager,
    quest: runtime.getRegisteredQuests().at(-1),
  };
}

const K = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const I = core.ItemIdentifiers;

function object(id, x, y, z = 0, type = 0, face = 0) {
  return {
    getId: () => id,
    getLocation: () => new core.Location(x, y, z),
    getType: () => type,
    getFace: () => face,
    getPrivateArea: () => null,
  };
}

function useObject(h, p, name, option, objectId, x, y, z = 0, type = 0, face = 0) {
  const actions = h.objectActions.get(name);
  assert.ok(actions && actions[option], `${name} ${option} is registered`);
  const event = { player: p, objectId, object: object(objectId, x, y, z, type, face), handled: false };
  const result = actions[option](event);
  if (result === true) event.handled = true;
  if (result === false) event.handled = false;
  return event;
}

function kill(h, p, npcId) {
  h.npcDeath.forEach(handler => handler({ killer: p, npcId }));
}

function action(h, p, npcId, stepId) {
  const event = { player: p, npcId, stepId, kind: 'message', handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(event));
  return event;
}

function variant(h, p, npcId) {
  return h.variants.at(-1)({ player: p, npcId });
}

function condition(h, p, text, npcId = K.DUNSTAN) {
  return h.conditions.at(-1)({ player: p, npcId, text });
}

test('fresh stage 0 start and the complete synthetic stage graph to the canonical wire value', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.quest.getStage(p), 0);

  h.events['npc-dialogue:hook'].forEach(handler =>
    handler({ player: p, npcId: K.DENULTH, hook: 'quest:troll-stronghold:start' }));
  assert.equal(h.quest.getStage(p), 10, 'Denulth start hook');
  assert.ok(p.configs.some(([id, value]) => id === 317 && value === 10), 'start transmitted on varp 317');

  kill(h, p, K.DAD);
  assert.equal(h.quest.getStage(p), 20, 'Dad death');

  kill(h, p, K.TROLL_GENERAL);
  assert.equal(h.quest.getStage(p), 30, 'Troll General gives the prison key');
  assert.equal(p.items.get(I.PRISON_KEY), 1);

  action(h, p, K.TWIG_2, 'UsQIS6');
  assert.equal(p.items.get(I.CELL_KEY_1), 1, 'Twig transcript key');
  assert.equal(h.quest.getStage(p), 30);

  kill(h, p, K.BERRY);
  assert.equal(p.items.get(I.CELL_KEY_2), 1, 'Berry kill-route key');
  assert.equal(h.quest.getStage(p), 40, 'both cell keys');

  const godricDoor = useObject(h, p, 'Cell Door', 'Unlock', O.CELL_DOOR_5, 2832, 10078);
  assert.equal(godricDoor.handled, true);
  assert.equal(p.attrs.get('troll-stronghold:godric-freed'), true);
  assert.equal(p.items.get(I.CELL_KEY_1) ?? 0, 0, 'Godric cell key consumed');
  assert.equal(h.quest.getStage(p), 40, 'one prisoner still held');

  const eadgarDoor = useObject(h, p, 'Cell Door', 'Unlock', O.CELL_DOOR_4, 2832, 10082);
  assert.equal(eadgarDoor.handled, true);
  assert.equal(p.attrs.get('troll-stronghold:eadgar-freed'), true);
  assert.equal(h.quest.getStage(p), 45, 'both prisoners freed');

  action(h, p, K.DUNSTAN, 'GT_EpY');
  assert.equal(h.quest.getStage(p), 50, 'Dunstan hand-in');
  assert.ok(p.configs.some(([id, value]) => id === 317 && value === 50), 'canonical varp 317 completion value');
  assert.equal(p.items.get(I.LAW_TALISMAN), 1, 'Law talisman reward');

  action(h, p, K.DUNSTAN, 'GT_EpY');
  assert.equal(p.items.get(I.LAW_TALISMAN), 1, 'reward is once only');
});

test('login replay sends the completion wire and restores the freed-Eadgar helper bit', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 50);
  p.configs.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.ok(p.configs.some(([id, value]) => id === 317 && value === 50), 'bootstrap resends 317=50');
  p.setAttribute('troll-stronghold:eadgar-freed', true);
  p.varbits.length = 0;
  h.logins.forEach(handler => handler({ player: p }));
  assert.deepEqual(p.varbits.at(-1), [0, 1], 'login rebuilds cache varbit 0 from saved prisoner state');
  assert.equal(h.quest.getStage(p), 50, 'login leaves the durable save intact');
});

test('arena gates and cave/stronghold handoffs are registered and scoped', () => {
  const h = harness();
  const p = makePlayer();

  const arena = useObject(h, p, 'Arena Entrance', 'Open', O.ARENA_ENTRANCE_2, 2897, 3619);
  assert.equal(arena.handled, true);
  assert.equal(h.objectManager.deregistered.at(-1), O.ARENA_ENTRANCE_2);
  assert.deepEqual(h.objectManager.registered.at(-1), { id: 3784, x: 2897, y: 3619, z: 0 });

  const exit = useObject(h, p, 'Arena Exit', 'Open', O.ARENA_EXIT_2, 2916, 3629);
  assert.equal(exit.handled, true);
  assert.deepEqual(h.objectManager.registered.at(-1), { id: 3787, x: 2916, y: 3629, z: 0 });

  const caveSouth = useObject(h, p, 'Cave Entrance', 'Enter', O.CAVE_ENTRANCE_22, 2903, 3644);
  assert.equal(caveSouth.handled, true);
  assert.deepEqual(p.moves.at(-1), [2907, 10035, 0]);

  const caveNorth = useObject(h, p, 'Cave Entrance', 'Enter', O.CAVE_ENTRANCE_22, 2907, 3652);
  assert.equal(caveNorth.handled, true);
  assert.deepEqual(p.moves.at(-1), [2907, 10019, 0]);

  useObject(h, p, 'Cave Exit', 'Exit', O.CAVE_EXIT_11, 2906, 10036);
  assert.deepEqual(p.moves.at(-1), [2904, 3643, 0]);
  useObject(h, p, 'Cave Exit', 'Exit', O.CAVE_EXIT_11, 2906, 10017);
  assert.deepEqual(p.moves.at(-1), [2908, 3654, 0]);

  useObject(h, p, 'Stronghold', 'Enter', O.STRONGHOLD, 2839, 3689);
  assert.deepEqual(p.moves.at(-1), [2836, 10090, 2]);

  useObject(h, p, 'Exit', 'Leave', O.EXIT_3, 2838, 10089, 2);
  assert.deepEqual(p.moves.at(-1), [2841, 3690, 0]);

  const unrelated = useObject(h, p, 'Exit', 'Leave', 999, 100, 100, 0);
  assert.equal(unrelated.handled, false, 'unrelated Exit loc is not claimed');
});

test('prison door unlock needs the prison key and persists the unlock', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 30);

  const missing = useObject(h, p, 'Prison Door', 'Unlock', O.PRISON_DOOR_9, 2848, 10107, 1);
  assert.equal(missing.handled, true);
  assert.ok(p.messages.includes('You need a key to unlock this door.'));
  assert.equal(h.objectManager.registered.length, 0);

  p.items.set(I.PRISON_KEY, 1);
  const unlocked = useObject(h, p, 'Prison Door', 'Unlock', O.PRISON_DOOR_9, 2848, 10107, 1);
  assert.equal(unlocked.handled, true);
  assert.equal(p.attrs.get('troll-stronghold:prison-door-unlocked'), true);
  assert.deepEqual(h.objectManager.registered.at(-1), { id: 3781, x: 2848, y: 10107, z: 1 });
});

test('full bag on the Troll General keeps the key step recoverable', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 20);
  p.setFull(true);

  kill(h, p, K.TROLL_GENERAL);
  assert.equal(p.items.get(I.PRISON_KEY) ?? 0, 0, 'no key with a full bag');
  assert.equal(h.quest.getStage(p), 20, 'stage is not advanced past the missing key');

  p.setFull(false);
  kill(h, p, K.TROLL_GENERAL);
  assert.equal(p.items.get(I.PRISON_KEY), 1, 'another general yields the key');
  assert.equal(h.quest.getStage(p), 30);
});

test('combat warning uses combat level, and failed item insertion never charges coins', () => {
  const h = harness();
  const p = makePlayer();
  p.setSkill(core.Skill.HITPOINTS, 1);
  p.setCombatLevel(55);
  assert.equal(condition(h, p, 'If the player\'s combat level is lower than 50:'), false);
  p.setCombatLevel(49);
  assert.equal(condition(h, p, 'If the player\'s combat level is lower than 50:'), true);

  h.quest.setStage(p, 50);
  p.items.set(I.COINS, 1000);
  const inventory = p.getInventory();
  const adds = inventory.adds;
  inventory.adds = (itemId, amount) => itemId === I.LAW_TALISMAN ? inventory : adds(itemId, amount);
  action(h, p, K.DUNSTAN, 'JpNnpQ');
  assert.equal(p.items.get(I.COINS), 1000, 'a failed talisman receipt does not spend the coins');
  assert.equal(p.items.get(I.LAW_TALISMAN) ?? 0, 0);
  inventory.adds = adds;
  action(h, p, K.DUNSTAN, 'JpNnpQ');
  assert.equal(p.items.get(I.COINS), 0);
  assert.equal(p.items.get(I.LAW_TALISMAN), 1);
});

test('lost prison key is re-obtainable until the door is unlocked; early kills grant nothing', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 10);
  kill(h, p, K.TROLL_GENERAL);
  assert.equal(p.items.get(I.PRISON_KEY) ?? 0, 0, 'general before Dad grants nothing');
  assert.equal(h.quest.getStage(p), 10);

  h.quest.setStage(p, 30);
  p.items.set(I.PRISON_KEY, 1);
  p.items.delete(I.PRISON_KEY);
  kill(h, p, K.TROLL_GENERAL);
  assert.equal(p.items.get(I.PRISON_KEY), 1, 'lost key replaced');

  p.attrs.set('troll-stronghold:prison-door-unlocked', true);
  p.items.delete(I.PRISON_KEY);
  kill(h, p, K.TROLL_GENERAL);
  assert.equal(p.items.get(I.PRISON_KEY) ?? 0, 0, 'unlocked door no longer needs a key');
});

test('early Twig/Berry kills and pickpockets do not leak cell keys', () => {
  const h = harness();
  const p = makePlayer();
  kill(h, p, K.TWIG_2);
  assert.equal(p.items.get(I.CELL_KEY_1) ?? 0, 0);

  const actions = h.npcActions.get('Twig');
  actions.Pickpocket({ player: p, npcId: K.TWIG_2 });
  assert.equal(p.items.get(I.CELL_KEY_1) ?? 0, 0);

  h.quest.setStage(p, 30);
  kill(h, p, K.TWIG_3);
  assert.equal(p.items.get(I.CELL_KEY_1), 1);
});

test('talking with both cell keys frees both prisoners and consumes only the cell keys', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 30);
  p.items.set(I.PRISON_KEY, 1);
  p.items.set(I.CELL_KEY_1, 1);
  p.items.set(I.CELL_KEY_2, 1);

  assert.equal(variant(h, p, K.GODRIC), 'entering-the-prison-freeing-eadgar-and-godric');
  assert.equal(p.attrs.get('troll-stronghold:godric-freed'), true);
  assert.equal(p.attrs.get('troll-stronghold:eadgar-freed'), true);
  assert.equal(h.quest.getStage(p), 45);
  assert.ok(p.varbits.some(([id, value]) => id === 0 && value === 1), 'the Eadgar-free QH flag is sent');
  assert.ok(p.configs.some(([id, value]) => id === 317 && value === 40), 'both-free state uses QH exact varp value 40');
  assert.equal(p.items.get(I.CELL_KEY_1) ?? 0, 0);
  assert.equal(p.items.get(I.CELL_KEY_2) ?? 0, 0);
  assert.equal(p.items.get(I.PRISON_KEY), 1, 'the prison key is not a cell key');
});

test('post-quest speakers defer to their canonical pages and Dunstan re-sells the talisman', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 50);

  assert.equal(variant(h, p, K.DUNSTAN), null, 'Dunstan reclaim page owns post-quest');
  assert.deepEqual(variant(h, p, K.DENULTH), {
    page: 'Denulth', variant: 'standard-dialogue-after-completing-troll-stronghold',
  });
  assert.equal(variant(h, p, K.DAD), null);
  assert.equal(variant(h, p, K.EADGAR), null);

  p.items.set(I.COINS, 1000);
  action(h, p, K.DUNSTAN, 'JpNnpQ');
  assert.equal(p.items.get(I.COINS) ?? 0, 0);
  assert.equal(p.items.get(I.LAW_TALISMAN), 1);

  p.items.set(I.COINS, 999);
  p.items.delete(I.LAW_TALISMAN);
  action(h, p, K.DUNSTAN, 'JpNnpQ');
  assert.equal(p.items.get(I.LAW_TALISMAN) ?? 0, 0, '999 coins is not enough');
  assert.equal(p.items.get(I.COINS), 999);

  assert.equal(condition(h, p, 'If the player has less than five law talismans in their bank and inventory:'), true);
  p.items.set(I.LAW_TALISMAN, 5);
  assert.equal(condition(h, p, 'If the player has less than five law talismans in their bank and inventory:'), false);
  p.items.set(I.COINS, 0);
  assert.equal(condition(h, p, 'If the player does not have enough coins:'), true);
  assert.equal(condition(h, p, 'If the player does not have enough inventory space:'), false);
  assert.equal(condition(h, p, 'If the player does not have enough coins:', 9999), null,
    'Dunstan pricing prose is not answered on another NPC page');
  assert.equal(condition(h, p, 'If the player does not have enough inventory space:', 9999), null,
    'Dunstan inventory prose is not answered on another NPC page');
});
