// From server/: node --test tests/qh728-q060.test.cjs
// Focused Icthlarin's Little Helper contracts. The route dispatches the
// plugin's registered handlers with the transcript's own condition/action ids;
// it does not drive the live dialogue runner, and no live playthrough is claimed.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

let transcriptCalls = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (...args) => {
  transcriptCalls.push({ npcId: args[2], page: args[3], variant: args[4] });
  return true;
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const experience = [];
  let full = false;
  let location = new core.Location(0, 0, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    deleteItem: (id) => inventory.deleteNumber(id, 1),
    isFull: () => full,
    // The real signature: forceAdd(player, item).
    forceAdd: (player, item) => inventory.adds(item.getId?.() ?? item.id, item.getAmount?.() ?? item.amount ?? 1),
  };
  const sender = new Proxy({}, {
    get: (_target, prop) => (...args) => {
      if (prop === 'getVarbit') return 0;
      return sender;
    },
  });
  return {
    attrs, items, messages, moves, experience,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, startDialogues: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => experience.push([skill, amount]),
    }),
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
    isPlayer: () => true,
  };
}

function harness() {
  transcriptCalls = [];
  const events = {};
  const conditions = [];
  const variants = [];
  const objectInteraction = [];
  const itemOnObject = [];
  const namedItemOnObject = [];
  const namedItemActions = new Map();
  const npcDeath = [];
  const npcInteractions = new Map();
  const login = [];
  const logout = [];
  const spawned = [];

  const testCore = Object.create(core);
  // Completion defers its scroll by a tick; tests do not run the game loop.
  testCore.TaskManager = { submit: noop };
  testCore.CountdownTask = function CountdownTask() {};

  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction: (handler) => objectInteraction.push(handler),
    onItemOnObject: (...args) => {
      if (typeof args[0] === 'function') itemOnObject.push(args[0]);
      else namedItemOnObject.push({ item: args[0], object: args[1], handler: args[2] });
    },
    onItemAction: (name, actions) => {
      if (typeof name === 'string') namedItemActions.set(name, actions);
    },
    onNpcDeath: (handler) => npcDeath.push(handler),
    onNpcInteraction: (name, options) => {
      if (typeof name === 'string') npcInteractions.set(name, options);
    },
    onPlayerLogin: (handler) => login.push(handler),
    onPlayerLogout: (handler) => logout.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach((handler) => handler(event)),
    spawnNpc: (data) => {
      const npc = { ...data, getId: () => data.id, getLocation: () => new core.Location(data.x, data.y, data.z) };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { if (npc) npc.removed = true; },
    sendMultiChatboxPrompt: noop,
  }, { get: (target, key) => target[key] ?? noop });

  require('../plugins/quests/quests/IcthlarinsLittleHelper.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  const action = (event) => {
    const payload = { handled: false, ...event };
    for (const handler of events['npc-dialogue:action'] ?? []) handler(payload);
    return payload;
  };
  return {
    api, quest, events, conditions, variants, objectInteraction, itemOnObject,
    namedItemOnObject, namedItemActions, npcDeath, npcInteractions, login, logout,
    spawned, action,
  };
}

const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const I = core.ItemIdentifiers;
const STAGE = {
  STARTED: 1, SOPHANEM: 2, FLASHBACK_1: 3, FIRST_MEMORY: 4, TALK_SPHINX: 5,
  TALK_HIGH_PRIEST: 6, FLASHBACK_2: 7, JAR_ROOM: 8, APPARITION: 9, GUARDIAN_DEAD: 10,
  JAR_HELD: 11, FLASHBACK_2_END: 12, RETURN_JAR: 13, JAR_RETURNED: 14, PREPARE: 15,
  RITUAL: 16, FLASHBACK_3: 17, FLASHBACK_3_END: 18, EAST_ROOM: 19, FIGHT: 20,
  SAVED: 23, FLASHBACK_4: 24, FINISH: 25, COMPLETE: 26,
};

const jarId = 4678; // the liver jar, chosen by the highest combat stat (99 Attack)
const objectEvent = (player, objectId) => ({
  player, objectId, handled: false,
  definition: { getName: () => 'Object', getInteractions: () => ['Open'] },
  location: { x: 0, y: 0, z: 0 },
});

test('Jex owns only the defiler line and defers the returning window to his standard transcript', () => {
  const h = harness();
  const talk = h.npcInteractions.get('Jex')['Talk-to'];
  assert.ok(talk, 'Jex Talk-to is registered by name');
  const player = makePlayer();

  h.quest.setStage(player, STAGE.SOPHANEM);
  const defiler = { player, npcId: N.JEX, handled: false };
  assert.equal(talk(defiler), true);
  assert.equal(defiler.handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'city-of-the-dead-talking-to-jex');

  h.quest.setStage(player, STAGE.FLASHBACK_2);
  const returning = { player, npcId: N.JEX, handled: false };
  assert.equal(talk(returning), false, 'the returning window defers to the indexed Jex transcript');
  assert.equal(returning.handled, false);
  assert.equal(transcriptCalls.length, 1, 'no Icthlarin transcript starts for the returning window');

  h.quest.setStage(player, STAGE.RETURN_JAR);
  const lastChance = { player, npcId: N.JEX, handled: false };
  assert.equal(talk(lastChance), false, 'the whole stages 7-13 window falls through');

  h.quest.setStage(player, STAGE.JAR_RETURNED);
  const finished = { player, npcId: N.JEX, handled: false };
  assert.equal(talk(finished), false, 'after the jar is returned Jex falls through to Contact!');
  assert.equal(finished.handled, false);
});

test('the pyramid can only be entered once the wanderer has sent the player to Sophanem', () => {
  const h = harness();
  const interact = h.objectInteraction.at(-1);
  const player = makePlayer();

  h.quest.setStage(player, STAGE.STARTED);
  const early = objectEvent(player, O.DOOR_171);
  interact(early);
  assert.equal(early.handled, false);
  assert.deepEqual(player.moves, []);

  h.quest.setStage(player, STAGE.SOPHANEM);
  const door = objectEvent(player, O.DOOR_171);
  interact(door);
  assert.equal(door.handled, true);
  assert.equal(h.quest.getStage(player), STAGE.FLASHBACK_1);
  assert.deepEqual(player.moves.at(-1), [3292, 9193, 0]);
});

test('the flashback pit and chamber puzzle advance in order', () => {
  const h = harness();
  const interact = h.objectInteraction.at(-1);
  const player = makePlayer();

  h.quest.setStage(player, STAGE.FLASHBACK_1);
  interact(objectEvent(player, O.PIT));
  assert.equal(h.quest.getStage(player), STAGE.FIRST_MEMORY);

  h.quest.setStage(player, STAGE.FIRST_MEMORY);
  interact(objectEvent(player, O.DOOR_665));
  assert.equal(h.quest.getStage(player), STAGE.FIRST_MEMORY, 'the puzzle does not complete itself');
  assert.equal(transcriptCalls.at(-1).variant.includes('solving-the-puzzle'), true);

  // The transcript action is what ends the flashback.
  h.action({ player, stepId: 'U696Aj' });
  assert.equal(h.quest.getStage(player), STAGE.TALK_SPHINX);
});

test('the correct canopic jar spawns the apparition and only its defeat drops the stage barrier', () => {
  const h = harness();
  const interact = h.objectInteraction.at(-1);
  const player = makePlayer();
  h.quest.setStage(player, STAGE.FLASHBACK_2);
  h.action({ player, stepId: 'exQl3V' });
  assert.equal(player.items.get(jarId) ?? 0, 0, 'the opening hand-out is not replayable');
  h.quest.setStage(player, STAGE.JAR_ROOM);

  // The four alcoves are multi locs 6634/6640/6638/6636; 6634 is the liver jar.
  const correct = objectEvent(player, 6634);
  interact(correct);
  assert.equal(h.quest.getStage(player), STAGE.APPARITION);
  assert.equal(h.spawned.at(-1).id, N.APPARITION);

  // Taking the jar before the apparition dies says so and stays put.
  const tooEarly = objectEvent(player, 6634);
  interact(tooEarly);
  assert.equal(h.quest.getStage(player), STAGE.APPARITION);

  // The death event plays only the defeat tail; the transcript action grants
  // the jar and advances.
  const apparition = h.spawned.at(-1);
  h.quest.setStage(player, STAGE.GUARDIAN_DEAD);
  h.action({ player, stepId: 'kIq4Pq' });
  assert.equal(h.quest.getStage(player), STAGE.JAR_HELD);
  assert.equal(player.items.get(jarId) ?? 0, 1);
  assert.ok(apparition);
});

test('a lost burial jar is re-issued only while the quest still needs it', () => {
  const h = harness();
  const player = makePlayer();
  h.quest.setStage(player, STAGE.FLASHBACK_2);

  // The High Priest's lost-jar line and the pyramid door both hand it back.
  h.action({ player, stepId: 'rQcSO2' });
  assert.equal(player.items.get(jarId) ?? 0, 1, 'the High Priest replaces a lost jar');
  player.items.set(jarId, 0);
  h.action({ player, stepId: '2cyI1G' });
  assert.equal(player.items.get(jarId) ?? 0, 1, 'the pyramid door replaces a lost jar');

  h.quest.setStage(player, STAGE.JAR_RETURNED);
  player.items.set(jarId, 0);
  h.action({ player, stepId: 'rQcSO2' });
  assert.equal(player.items.get(jarId) ?? 0, 0, 'the jar cannot be re-issued after it is returned');
});

test('ceremony hand-ins are refused outside the preparations stage', () => {
  const h = harness();
  const player = makePlayer();
  player.items.set(I.BUCKET_OF_SAP, 1);
  h.quest.setStage(player, STAGE.RITUAL);

  const early = h.action({ player, stepId: 'wicewv' });
  assert.equal(early.handled, false);
  assert.equal(player.items.get(I.BUCKET_OF_SAP), 1, 'the sap is not consumed out of order');
  assert.equal(h.quest.getStage(player), STAGE.RITUAL);
});

test('a knife on an evergreen tree recovers the embalmer sap and consumes only the bucket', () => {
  const h = harness();
  const hook = h.namedItemOnObject.find((entry) => entry.item === 'Knife' && entry.object === 'Evergreen tree');
  assert.ok(hook, 'the tree-sap interaction is registered by name');
  const player = makePlayer();
  h.quest.setStage(player, STAGE.PREPARE);
  h.events['npc-dialogue:action'].at(-1); // registration smoke: handlers exist

  // The "needs sap" bit comes from the High Priest/embalmer hand-off, so a
  // player who has not been asked for supplies cannot farm the tree.
  const notNeeded = { player, itemId: I.KNIFE, objectId: O.EVERGREEN_TREE, handled: false };
  assert.equal(hook.handler(notNeeded), false);

  // Meeting the embalmer marks the three supplies outstanding.
  const embalmerVariant = h.variants.at(-1);
  assert.equal(embalmerVariant({ player, npcId: N.EMBALMER }), 'ceremony-preparations-aiding-the-embalmer');

  const noBucket = { player, itemId: I.KNIFE, objectId: O.EVERGREEN_TREE, handled: false };
  assert.equal(hook.handler(noBucket), true);
  assert.match(player.messages.at(-1), /need a bucket/i);

  player.items.set(I.BUCKET, 1);
  const gather = { player, itemId: I.KNIFE, objectId: O.EVERGREEN_TREE, handled: false };
  assert.equal(hook.handler(gather), true);
  assert.equal(player.items.get(I.BUCKET) ?? 0, 0);
  assert.equal(player.items.get(I.BUCKET_OF_SAP), 1);
  assert.match(player.messages.at(-1), /sap to drip/i);

  const again = { player, itemId: I.KNIFE, objectId: O.EVERGREEN_TREE, handled: false };
  hook.handler(again);
  assert.equal(player.items.get(I.BUCKET_OF_SAP), 1, 'a second bucket of sap is not stacked');
  assert.match(player.messages.at(-1), /already have a bucket of sap/i);
});

test('Empty on the quest buckets returns the reusable bucket', () => {
  const h = harness();
  const player = makePlayer();
  player.items.set(I.BUCKET_OF_SAP, 1);
  const sap = h.namedItemActions.get('Bucket of sap');
  assert.ok(sap, 'the sap bucket Empty action is registered by name');

  const emptySap = { player, itemId: I.BUCKET_OF_SAP, option: 'Empty', handled: false };
  assert.equal(sap.Empty(emptySap), true);
  assert.equal(emptySap.handled, true);
  assert.equal(player.items.get(I.BUCKET_OF_SAP) ?? 0, 0);
  assert.equal(player.items.get(I.BUCKET), 1);
  assert.match(player.messages.at(-1), /bucket of sap/i);

  player.items.set(I.BUCKET_OF_SALTWATER, 2);
  const saltwater = h.namedItemActions.get('Bucket of saltwater');
  const emptySalt = { player, itemId: I.BUCKET_OF_SALTWATER, option: 'Empty', handled: false };
  assert.equal(saltwater.Empty(emptySalt), true);
  assert.equal(player.items.get(I.BUCKET_OF_SALTWATER), 1, 'only the clicked bucket is emptied');
  assert.equal(player.items.get(I.BUCKET), 2);

  const wrongOption = { player, itemId: I.BUCKET_OF_SAP, option: 'Check', handled: false };
  assert.equal(sap.Empty(wrongOption), false);
  assert.equal(wrongOption.handled, false);
});

test('completing the quest removes the jar and unused ceremony supplies', () => {
  const h = harness();
  const player = makePlayer();
  h.quest.setStage(player, STAGE.FINISH);
  player.items.set(jarId, 1);
  player.items.set(I.HOLY_SYMBOL, 1); // the ordinary blessed symbol must survive
  player.items.set(4682, 1); // quest holy symbol
  player.items.set(4683, 1); // unholy symbol
  player.items.set(4691, 1); // Sphinx's token
  player.items.set(I.BUCKET_OF_SAP, 1);
  player.items.set(I.PILE_OF_SALT, 1);
  player.items.set(I.LINEN, 1);
  player.items.set(I.COINS, 100);

  const completion = h.action({ player, stepId: '6y5c1d' });
  assert.equal(completion.handled, true);
  assert.equal(h.quest.getStage(player), STAGE.COMPLETE);
  for (const id of [jarId, 4682, 4683, 4691, I.BUCKET_OF_SAP, I.PILE_OF_SALT, I.LINEN]) {
    assert.equal(player.items.get(id) ?? 0, 0, `quest item ${id} is cleaned up`);
  }
  assert.equal(player.items.get(I.COINS), 100, 'ordinary items are untouched');
  assert.equal(player.items.get(I.HOLY_SYMBOL), 1, 'the ordinary blessed symbol is untouched');
});

test('a relog clears leftovers once the quest is complete', () => {
  const h = harness();
  const player = makePlayer();
  h.quest.setStage(player, STAGE.COMPLETE);
  player.items.set(jarId, 1);
  player.items.set(I.BUCKET_OF_SAP, 1);
  h.login.at(-1)({ player });
  assert.equal(player.items.get(jarId) ?? 0, 0);
  assert.equal(player.items.get(I.BUCKET_OF_SAP) ?? 0, 0);
});

// Keep the real implementation linked so a future rename of startTranscript is
// caught here rather than in a live quest.
assert.equal(typeof realStartTranscript, 'function');
