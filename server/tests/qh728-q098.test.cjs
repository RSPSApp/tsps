// Source-contract checks for Roving Elves (Quest Helper q098).
// Run from server/: node --test tests/qh728-q098.test.cjs
//
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper at
// 06da90f982518a093f2fe1c9cfac5547fa7053d3,
// src/main/java/com/questhelper/helpers/quests/rovingelves/RovingElves.java.
//
// The route test starts at fresh stage 0 with only the prerequisite quests
// fixture-set (Regicide/Waterfall) and fixture-sets ordinary inventory items
// before the handlers that consume them. Every stage change comes from a real
// registered handler (hook, variant selector, ground-item pickup, action, item
// action, choice, completion). This proves the handler/stage/wire contract, not
// a live playthrough or the visual Quest Helper overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const runtime = require(root + '/plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(root);
});

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const transcripts = [];
runtime.startTranscript = (_api, player, npcId, page, variant) => {
  transcripts.push({ player, npcId, page, variant });
  return true;
};

function makeHarness({ both = false, completed = [] } = {}) {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const itemOnObjects = [];
  const itemActions = [];
  const pickups = [];
  const logins = [];
  const logouts = [];
  const spawned = [];
  const removed = [];
  const configs = new Map();
  const varbits = new Map();
  const messages = [];
  const xp = [];
  const attributes = new Map();
  const inventory = new Map();
  const completedQuests = new Set(completed);
  const levels = new Map();
  let location = new core.Location(2289, 3146, 0);
  let full = false;

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendJingle() { return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => inventoryApi.getAmount(id) > 0,
    isFull: () => full,
    getFreeSlots: () => (full ? 0 : 28 - [...inventory.values()].filter((amount) => amount > 0).length),
    adds(id, amount = 1) {
      inventory.set(id, (inventory.get(id) ?? 0) + amount);
      return inventoryApi;
    },
    forceAdd(_player, item) {
      inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount());
    },
    deleteNumber(id, amount = 1) {
      const left = (inventory.get(id) ?? 0) - amount;
      if (left > 0) inventory.set(id, left);
      else inventory.delete(id);
      return inventoryApi;
    },
    getItems: () => [...inventory].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getMaxLevel: (skill) => levels.get(skill.getName?.().toUpperCase()) ?? 99,
      getCurrentLevel: (skill) => levels.get(skill.getName?.().toUpperCase()) ?? 99,
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({
      isActive: () => false,
      reset: noop,
      getCurrent: () => null,
      advance: noop,
      startDialogues: noop,
    }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    sendMessage: (message) => messages.push(message),
    getUsername: () => 'qh728-q098',
    getIndex: () => 1,
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };

  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => task.execute(), cancelTasks: noop },
    },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onItemOnObject: (handler) => itemOnObjects.push(handler),
    onItemAction: (handler) => itemActions.push(handler),
    onGroundItemPickup: (handler) => pickups.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
    onCustomEvent(name, handler) {
      const list = custom.get(name) ?? [];
      list.push(handler);
      custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
      // QuestRuntime registers its event answers once per process; later test
      // harnesses get the same answers from the registered quest handles.
      const target = event.player
        ? runtime.getRegisteredQuests().findLast((entry) => entry.key === event.key)
        : null;
      if (name === 'quest:is-complete' && event.complete == null && target) {
        event.complete = target.isComplete(event.player);
      }
      if (name === 'quest:is-complete' && event.complete == null && completedQuests.has(event.key)) {
        event.complete = true;
      }
      if (name === 'quest:get-stage' && typeof event.stage !== 'number' && target) {
        event.stage = target.getStage(event.player);
      }
    },
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => true,
        remove: noop,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) removed.push(npc); },
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  if (both) require(root + '/plugins/quests/quests/MourningsEndPartI.Quest')(api);
  require(root + '/plugins/quests/quests/RovingElves.Quest')(api);

  const registered = runtime.getRegisteredQuests();
  const roving = registered.findLast((entry) => entry.key === 'roving_elves');
  const mep1 = both ? registered.findLast((entry) => entry.key === 'mournings_end_part_i') : null;
  assert.ok(roving, 'Roving Elves registered');
  if (both) assert.ok(mep1, "Mourning's End Part I registered");

  const fire = (name, event = {}) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(name) ?? []) handler(request);
    return request;
  };
  const variant = (npcId) => {
    const picked = variants.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;
    return typeof picked === 'string' ? { variant: picked } : picked;
  };
  // PluginManager's condition dispatch takes the first boolean, in registration order.
  const condition = (stepId, npcId, text) => {
    for (const handler of conditions) {
      const answer = handler({ player, npcId, stepId, text });
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  const itemAction = (itemId, option = 'Plant') => {
    const event = { player, itemId, option, handled: false };
    for (const handler of itemActions) handler(event);
    return event;
  };
  const itemOnObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, location, handled: false };
    for (const handler of itemOnObjects) handler(event);
    return event;
  };
  const pickup = (groundItemId) => {
    const event = { player, groundItemId, handled: false };
    for (const handler of pickups) handler(event);
    return event;
  };
  const login = () => { for (const handler of logins) handler({ player }); };
  const logout = () => { for (const handler of logouts) handler({ player }); };

  return {
    both, player, roving, mep1, fire, variant, condition, itemAction, itemOnObject,
    pickup, login, logout, attributes, inventory, configs, varbits, messages, xp,
    spawned, removed, transcripts, completedQuests,
    setFull: (value) => { full = value; },
    setLevel: (skill, value) => { levels.set(skill.toUpperCase(), value); },
    setLocation: (next) => { location = next; },
    stage: () => roving.getStage(player),
    mep1Stage: () => (mep1 ? mep1.getStage(player) : null),
  };
}

test('fresh stage 0 -> completion: start, seed, enchant, plant, hand-in, wire and login replay', () => {
  const h = makeHarness({ completed: ['regicide', 'waterfall_quest'] });

  h.login();
  assert.deepEqual(h.spawned.map((npc) => npc.id).sort((a, b) => a - b),
    [N.ILFEEN, N.ELUNED, N.ISLWYN].sort((a, b) => a - b));

  assert.equal(h.stage(), 0);
  assert.equal(h.variant(N.ISLWYN).variant, 'roving-elves-talking-to-islwyn-or-eluned');
  h.fire('npc-dialogue:hook', { npcId: N.ISLWYN, hook: 'quest:roving-elves:start' });
  assert.equal(h.stage(), 1);
  assert.equal(h.configs.get(402), 1);

  assert.equal(h.variant(N.ELUNED).variant, 'consecrating-the-tomb-talking-to-eluned');
  assert.equal(h.stage(), 2);

  h.pickup(I.CONSECRATION_SEED);
  h.inventory.set(I.CONSECRATION_SEED, 1);
  assert.equal(h.stage(), 3);
  assert.equal(h.variant(N.ELUNED).variant, 'enchanting-the-seed-talking-to-eluned-with-the-crystal-seed');

  h.fire('npc-dialogue:action', { npcId: N.ELUNED, stepId: 'MCntL9' });
  assert.equal(h.inventory.get(I.CONSECRATION_SEED) ?? 0, 0);
  h.fire('npc-dialogue:action', { npcId: N.ELUNED, stepId: 'Bt02mM' });
  assert.equal(h.inventory.get(I.CONSECRATION_SEED_2), 1);
  assert.equal(h.stage(), 4);
  assert.equal(h.configs.get(402), 4);

  const withoutSpade = h.itemAction(I.CONSECRATION_SEED_2);
  assert.equal(withoutSpade.handled, true);
  assert.equal(h.transcripts.at(-1).variant,
    'rest-in-peace-planting-the-seed-trying-to-plant-the-seed-without-a-spade');
  assert.equal(h.stage(), 4);
  assert.equal(h.inventory.get(I.CONSECRATION_SEED_2), 1);

  h.inventory.set(I.SPADE, 1);
  h.setLocation(new core.Location(3200, 3200, 0));
  h.itemAction(I.CONSECRATION_SEED_2);
  assert.equal(h.transcripts.at(-1).variant,
    'rest-in-peace-planting-the-seed-trying-to-plant-the-seed-at-an-incorrect-location');
  assert.equal(h.stage(), 4);

  h.setLocation(new core.Location(2603, 9910, 0));
  h.itemAction(I.CONSECRATION_SEED_2);
  assert.equal(h.transcripts.at(-1).variant,
    'rest-in-peace-planting-the-seed-planting-the-seed-in-the-chalice-of-eternity-cavern');
  assert.equal(h.stage(), 5);
  assert.equal(h.configs.get(402), 5);
  assert.equal(h.inventory.get(I.CONSECRATION_SEED_2) ?? 0, 0);
  assert.equal(h.inventory.get(I.SPADE), 1);

  assert.equal(h.variant(N.ISLWYN).variant, 'rest-in-peace-talking-to-islwyn');
  h.fire('npc-dialogue:choice', {
    npcId: N.ISLWYN,
    option: 'I don\'t like running and hiding behind mushrooms. Shield please!',
  });
  h.fire('npc-dialogue:action', { npcId: N.ISLWYN, stepId: 'xMZIqj' });
  assert.equal(h.stage(), 6);
  assert.equal(h.configs.get(402), 6);
  assert.equal(h.inventory.get(I.NEW_CRYSTAL_SHIELD), 1);
  assert.equal(h.roving.scrollItemId(h.player), I.NEW_CRYSTAL_SHIELD, 'the completion scroll matches the chosen shield');
  assert.equal(h.xp.filter(([skill, amount]) => skill === core.Skill.STRENGTH.getIndex() && amount === 10000).length, 1);

  h.fire('npc-dialogue:action', { npcId: N.ISLWYN, stepId: 'xMZIqj' });
  assert.equal(h.inventory.get(I.NEW_CRYSTAL_SHIELD), 1);
  assert.equal(h.xp.length, 1);

  h.configs.delete(402);
  h.login();
  assert.equal(h.configs.get(402), 6);
  assert.equal(h.spawned.length, 3, 'login replay does not duplicate the owner NPCs');
});

test('early tomb entry: a seed picked up before speaking to Eluned is still enchantable', () => {
  const h = makeHarness({ completed: ['regicide', 'waterfall_quest'] });
  h.roving.setStage(h.player, 1);
  h.inventory.set(I.CONSECRATION_SEED, 1);

  h.pickup(I.CONSECRATION_SEED);
  assert.equal(h.stage(), 3);
  assert.equal(h.variant(N.ELUNED).variant, 'enchanting-the-seed-talking-to-eluned-with-the-crystal-seed');
  assert.equal(h.stage(), 3);

  h.inventory.delete(I.CONSECRATION_SEED);
  assert.equal(h.variant(N.ELUNED).variant, 'consecrating-the-tomb-talking-to-eluned-again');
  assert.equal(h.stage(), 3);
});

test('completing Regicide online spawns the roving pair without a relog', () => {
  const h = makeHarness({ completed: [] });
  h.login();
  assert.equal(h.spawned.length, 0);

  h.completedQuests.add('regicide');
  h.fire('quest:completed', { key: 'regicide' });
  assert.equal(h.spawned.length, 3);
});

test('full bag at the completion action keeps the quest planted so the reward is not lost', () => {
  const h = makeHarness({ completed: ['regicide', 'waterfall_quest'] });
  h.roving.setStage(h.player, 5);
  h.setFull(true);

  h.fire('npc-dialogue:choice', {
    npcId: N.ISLWYN,
    option: 'Shields are for wimps! Give me the bow!',
  });
  h.fire('npc-dialogue:action', { npcId: N.ISLWYN, stepId: 'xMZIqj' });
  assert.equal(h.stage(), 5);
  assert.equal(h.inventory.get(I.NEW_CRYSTAL_BOW) ?? 0, 0);
  assert.equal(h.xp.length, 0);

  h.setFull(false);
  h.fire('npc-dialogue:action', { npcId: N.ISLWYN, stepId: 'xMZIqj' });
  assert.equal(h.stage(), 6);
  assert.equal(h.inventory.get(I.NEW_CRYSTAL_BOW), 1);
});

test('MEP1 handoff: actual MEP1 requirements select the start branch and reach its owner hook', () => {
  const h = makeHarness({ both: true, completed: [
    'regicide', 'waterfall_quest', 'big_chompy_bird_hunting', 'sheep_herder',
  ] });
  h.roving.setStage(h.player, 6);
  assert.equal(h.mep1Stage(), 0);
  const requirements = h.fire('mournings-end-part-i:start-requirements');
  assert.equal(requirements.meetsRequirements, true, 'the MEP1 owner reports its own actual prerequisites');
  assert.equal(requirements.started, false);

  const withoutIslwyn = 'Without the requirements for Mourning\'s End Part I:';
  const withIslwyn = 'With the requirements for Mourning\'s End Part I:';
  assert.equal(h.condition('XLUhNA', N.ISLWYN, withoutIslwyn), false);
  assert.equal(h.condition('nDR_Pf', N.ISLWYN, withIslwyn), true);
  assert.equal(h.condition('4d3Hd1', N.ELUNED, withoutIslwyn), false);
  assert.equal(h.condition('neOkYC', N.ELUNED, withIslwyn), true);

  h.transcripts.length = 0;
  h.fire('npc-dialogue:hook', { npcId: N.ISLWYN, hook: 'quest:mourning-s-end-part-i:start' });
  assert.equal(h.mep1Stage(), 1);
  assert.equal(h.transcripts.at(-1)?.variant, 'in-need-of-your-skills');
});

test('MEP1 handoff checks requirements and keeps an already-started quest on its continuation branch', () => {
  const incomplete = makeHarness({ both: true, completed: ['regicide', 'waterfall_quest'] });
  incomplete.roving.setStage(incomplete.player, 5);
  assert.equal(incomplete.mep1Stage(), 0);
  assert.equal(incomplete.condition('XLUhNA', N.ISLWYN, 'Without the requirements for Mourning\'s End Part I:'), true);
  assert.equal(incomplete.condition('nDR_Pf', N.ISLWYN, 'With the requirements for Mourning\'s End Part I:'), false);

  const missingMEPRequirements = makeHarness({ both: true, completed: ['regicide', 'waterfall_quest'] });
  missingMEPRequirements.roving.setStage(missingMEPRequirements.player, 6);
  assert.equal(missingMEPRequirements.condition('XLUhNA', N.ISLWYN, 'Without the requirements for Mourning\'s End Part I:'), true);
  assert.equal(missingMEPRequirements.condition('nDR_Pf', N.ISLWYN, 'With the requirements for Mourning\'s End Part I:'), false);

  const lowLevel = makeHarness({ both: true, completed: [
    'regicide', 'waterfall_quest', 'big_chompy_bird_hunting', 'sheep_herder',
  ] });
  lowLevel.roving.setStage(lowLevel.player, 6);
  lowLevel.setLevel('RANGED', 59);
  assert.equal(lowLevel.condition('XLUhNA', N.ISLWYN, 'Without the requirements for Mourning\'s End Part I:'), true);

  const started = makeHarness({ both: true, completed: ['regicide', 'waterfall_quest'] });
  started.roving.setStage(started.player, 6);
  started.mep1.setStage(started.player, 1);
  assert.equal(started.condition('XLUhNA', N.ISLWYN, 'Without the requirements for Mourning\'s End Part I:'), false);
  assert.equal(started.condition('nDR_Pf', N.ISLWYN, 'With the requirements for Mourning\'s End Part I:'), true);
  started.fire('npc-dialogue:hook', { npcId: N.ISLWYN, hook: 'quest:mourning-s-end-part-i:start' });
  assert.equal(started.mep1Stage(), 1, 'reopening the shared dialogue does not reset MEP1');
});

test('a full-bag seed pickup does not advance the stage before the item is received', () => {
  const h = makeHarness({ completed: ['regicide', 'waterfall_quest'] });
  h.roving.setStage(h.player, 2);
  h.setFull(true);
  h.pickup(I.CONSECRATION_SEED);
  assert.equal(h.stage(), 2, 'the engine has not delivered the non-stackable seed');

  h.setFull(false);
  h.pickup(I.CONSECRATION_SEED);
  assert.equal(h.stage(), 3, 'the stage advances once inventory space is available');
});

test('completion scroll icons follow each player’s persisted bow or shield choice', () => {
  const h = makeHarness({ completed: ['regicide', 'waterfall_quest'] });
  const makePlayer = (name) => {
    const attrs = new Map([['quest.roving_elves.stage', 6]]);
    return {
      getAttribute: (key) => attrs.get(key),
      setAttribute: (key, value) => attrs.set(key, value),
      getInventory: () => ({ getAmount: () => 0 }),
      name,
    };
  };
  const bowPlayer = makePlayer('bow');
  const shieldPlayer = makePlayer('shield');
  h.fire('npc-dialogue:choice', { player: bowPlayer, npcId: N.ISLWYN, option: 'Bow please.' });
  h.fire('npc-dialogue:choice', { player: shieldPlayer, npcId: N.ISLWYN, option: 'Shield please.' });

  assert.equal(h.roving.scrollItemId(bowPlayer), I.NEW_CRYSTAL_BOW);
  assert.equal(h.roving.scrollItemId(shieldPlayer), I.NEW_CRYSTAL_SHIELD);
  const legacyShieldPlayer = {
    getAttribute: () => undefined,
    getInventory: () => ({ getAmount: (itemId) => itemId === I.NEW_CRYSTAL_SHIELD ? 1 : 0 }),
  };
  assert.equal(h.roving.scrollItemId(legacyShieldPlayer), I.NEW_CRYSTAL_SHIELD, 'older shield rewards still show the matching icon');
});
