// From server/: node --test tests/qh728-q062.test.cjs
// Focused In Search of the Myreque contracts. The route dispatches the plugin's
// registered handlers with the transcript's own condition/action/choice ids and
// the cache object ids actually placed in this revision. It does not drive the
// live dialogue runner, and no live playthrough is claimed. The bridge rung
// repair is fixture-seeded because cache 241 places no broken-rung objects.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const experience = [];
  const packetCalls = [];
  const equipment = new Map();
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
    getFreeSlots: () => 28 - [...items.values()].filter((amount) => amount > 0).length,
    isFull: () => false,
    getItems: () => [...items.entries()].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const sender = new Proxy({}, {
    get: (_target, prop) => (...args) => {
      packetCalls.push([prop, ...args]);
      return sender;
    },
  });
  return {
    attrs, items, messages, moves, experience, packetCalls, equipment,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) }),
    getUsername: () => 'q062-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    getSkillManager: () => ({ getMaxLevel: () => 99, addExperiences: (skill, amount) => experience.push([skill, amount]) }),
    getAppearance: () => ({ isMale: () => true }),
    performAnimation: noop,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
    isPlayer: () => true,
  };
}

function harness() {
  const events = {};
  const conditions = [];
  const choices = [];
  const actions = [];
  const hooks = [];
  const lines = [];
  const objectInteraction = [];
  const npcDeath = [];
  const login = [];
  const logout = [];
  const variants = [];
  const conditionAnswers = [];
  const spawned = [];
  const completedQuests = new Set();

  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditionAnswers.push(handler),
    onObjectInteraction: (handler) => objectInteraction.push(handler),
    onNpcDeath: (handler) => npcDeath.push(handler),
    onPlayerLogin: (handler) => login.push(handler),
    onPlayerLogout: (handler) => logout.push(handler),
    onCustomEvent: (key, handler) => {
      (events[key] ??= []).push(handler);
      if (key === 'npc-dialogue:condition') conditions.push(handler);
      if (key === 'npc-dialogue:choice') choices.push(handler);
      if (key === 'npc-dialogue:action') actions.push(handler);
      if (key === 'npc-dialogue:hook') hooks.push(handler);
      if (key === 'npc-dialogue:line') lines.push(handler);
    },
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach((handler) => handler(event)),
    spawnNpc: (data) => {
      const npc = { ...data, getId: () => data.id, getLocation: () => new core.Location(data.x, data.y, data.z) };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { if (npc) npc.removed = true; },
    sendMultiChatboxPrompt: noop,
  }, { get: (target, key) => target[key] ?? noop });

  (events['quest:is-complete'] ??= []).push((event) => {
    event.complete = completedQuests.has(event.key);
  });
  require(process.env.Q062_PLUGIN || '../plugins/quests/quests/InSearchOfTheMyreque.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const fire = (key, event) => (events[key] ?? []).forEach((handler) => handler(event));
  const start = (player, npcId = 5056) => {
    const event = { player, npcId, hook: 'quest:in-search-of-the-myreque:start', handled: false };
    hooks.forEach((handler) => handler(event));
  };
  const condition = (player, stepId, pages = [{ page: 'In Search of the Myreque' }]) => {
    const event = { player, stepId, pages };
    conditions.forEach((handler) => handler(event));
    return event;
  };
  const action = (player, stepId, npcId = -1) => {
    const event = { player, npcId, stepId, handled: false, kind: 'message' };
    actions.forEach((handler) => handler(event));
    return event;
  };
  const choice = (player, option, npcId = -1) => {
    const event = { player, npcId, option, stepId: null };
    choices.forEach((handler) => handler(event));
    return event;
  };
  const interact = (player, objectId, location = { x: 0, y: 0, z: 0 }) => {
    const event = { player, objectId, location, handled: false };
    objectInteraction.forEach((handler) => handler(event));
    return event;
  };
  const kill = (player, npcId) => npcDeath.forEach((handler) => handler({ killer: player, npcId, npc: {} }));
  const line = (player, npcId, text) => {
    const event = { player, npcId, text, skip: false };
    lines.forEach((handler) => handler(event));
    return event;
  };
  const variant = (player, npcId) => variants.map((handler) => handler({ player, npcId })).find((value) => value !== undefined);
  const loginPlayer = (player) => login.forEach((handler) => handler({ player }));

  return {
    quest, completedQuests, spawned,
    start, condition, action, choice, interact, kill, line, variant, loginPlayer,
    answer: (payload) => conditionAnswers.map((handler) => handler(payload)).find((value) => value !== undefined),
  };
}

const stage = (h, p) => h.quest.getStage(p);
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;

const WEAPONS = [
  [I.STEEL_LONGSWORD, 1],
  [I.STEEL_SWORD, 2],
  [I.STEEL_DAGGER, 1],
  [I.STEEL_MACE, 1],
  [I.STEEL_WARHAMMER, 1],
];

function giveRouteItems(p) {
  for (const [id, amount] of WEAPONS) p.items.set(id, amount);
  p.items.set(I.PLANK, 6);
  p.items.set(I.STEEL_NAILS, 225);
  p.items.set(I.HAMMER, 1);
  p.items.set(I.DRUID_POUCH, 5);
  p.items.set(I.COINS, 10);
}

test('fresh stage 0 reaches cache completion 105 through the placed route', () => {
  const h = harness();
  const p = makePlayer();
  h.loginPlayer(p);
  assert.equal(stage(h, p), 0, 'fresh stage 0');

  assert.equal(h.answer({ player: p, text: 'If the player does not have the correct weapons:' }), true,
    'no weapons at the start');
  h.start(p);
  assert.equal(stage(h, p), 5, 'Vanstrom start hook');

  giveRouteItems(p);
  assert.equal(h.answer({ player: p, text: 'If the player does not have a druid pouch in their inventory:' }), false);
  assert.equal(h.answer({ player: p, text: 'If the player has a Druid Pouch in their inventory:' }), true);
  h.choice(p, "Well, I guess they'll just die without weapons.", N.CYREG_PADDLEHORN);
  assert.equal(stage(h, p), 10, 'Cyreg conversation reaches the refusal leg');
  h.action(p, 'BKpf08');
  assert.equal(stage(h, p), 15, 'druid pouch shown to Cyreg');
  assert.equal(h.answer({ player: p, text: 'If the player does have the weapons:' }), true);

  h.action(p, 'DsO5TF');
  assert.equal(stage(h, p), 20, 'three planks given for the boat');
  assert.equal(p.items.get(I.PLANK), 3, 'three planks remain for the bridge');

  h.interact(p, O.SWAMP_BOATY_2, { x: 3523, y: 3284, z: 0 });
  assert.equal(stage(h, p), 25, 'boat reaches the Hollows');
  assert.deepEqual(p.moves.at(-1), [3498, 3380, 0]);
  assert.equal(p.items.get(I.COINS) ?? 0, 0, 'the ten-coin fare is paid');

  // Fixture: the helper repair leg, because cache 241 places no broken-rung locs.
  p.setAttribute('quest.in_search_of_the_myreque.bridge', 0b111);
  p.setLocation(3502, 3426, 0);
  h.interact(p, 5003, { x: 3502, y: 3426, z: 0 });
  assert.deepEqual(p.moves.at(-1), [3503, 3431, 0], 'raw tree multi-loc crosses the repaired bridge');

  h.choice(p, "I've come to help the Myreque. I've brought weapons.", N.CURPILE_FYOD);
  assert.equal(stage(h, p), 52, 'Curpile accepts the weapons');
  h.action(p, 'sXzRb_');
  h.choice(p, 'Dialogue 1', N.CURPILE_FYOD);
  h.choice(p, 'Sani Piliu.', N.CURPILE_FYOD);
  h.condition(p, '3l6Jxc');
  assert.equal(stage(h, p), 55, 'quiz pass condition');

  h.interact(p, O.WOODEN_DOORS_8, { x: 3509, y: 3447, z: 0 });
  assert.equal(stage(h, p), 55, 'surface doors enter the cave without skipping to the hideout');
  assert.deepEqual(p.moves.at(-1), [3500, 9812, 0]);
  h.interact(p, O.CAVE_ENTRANCE_27, { x: 3505, y: 9831, z: 0 });
  assert.equal(stage(h, p), 60, 'hidden cave entrance enters the hideout');
  assert.deepEqual(p.moves.at(-1), [3505, 9832, 0]);

  assert.equal(h.variant(p, N.VELIAF_HURTZ_2), 'myreque-hideout-talking-to-veliaf');
  h.condition(p, 'k_vzYt');
  h.condition(p, '_g5SY-');
  h.condition(p, '25JBP_');
  h.condition(p, 'C5YuIy');
  assert.equal(stage(h, p), 65, 'members are introduced before the last flag');
  h.condition(p, 'KI2Pb0');
  assert.equal(stage(h, p), 67, 'all five members introduced; weapons can be handed in');

  h.action(p, 'OVBQEv', N.VELIAF_HURTZ_2);
  h.condition(p, 'VLPyT3');
  assert.equal(stage(h, p), 70, 'weapons handed to Veliaf');
  for (const [id] of WEAPONS) assert.equal(p.items.get(id) ?? 0, 0, `weapon ${id} consumed`);
  h.action(p, 'bLWS_j');
  assert.equal(stage(h, p), 80, 'cutscene summons the Skeleton Hellhound');
  assert.equal(h.spawned.length, 1, 'one owner-only hellhound spawned');
  h.kill(p, N.SKELETON_HELLHOUND);
  assert.equal(stage(h, p), 85, 'hellhound defeated');

  h.condition(p, 'a8YEIJ');
  assert.equal(stage(h, p), 90, 'first-time Veliaf page releases the exit leg');

  h.interact(p, O.WALL_17, { x: 3480, y: 9837, z: 0 });
  assert.equal(stage(h, p), 95, 'hidden wall opens the inn basement');
  h.interact(p, O.LADDER_54, { x: 3477, y: 9846, z: 0 });
  assert.equal(stage(h, p), 97, 'ladder reaches Canifis');

  h.line(p, N.STRANGER_2, 'I definitely have!');
  assert.equal(stage(h, p), 105, 'cache completion threshold reached');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.getAttribute('quest.points'), 2);
  assert.deepEqual(p.experience.map(([, amount]) => amount), [600, 600, 600, 600, 600]);
  const completionWire = p.packetCalls.filter(([name, id, value]) => name === 'sendConfig' && id === 387 && value === 105);
  assert.ok(completionWire.length >= 1, 'completion sends canonical varp 387 = 105');

  h.loginPlayer(p);
  assert.equal(stage(h, p), 105, 'completion persists across login');
  h.line(p, N.STRANGER_2, 'I definitely have!');
  assert.deepEqual(p.experience.map(([, amount]) => amount), [600, 600, 600, 600, 600],
    'replaying the final line does not pay the reward twice');
});

test('the bridge tree raw id 5003 is blocked until the rungs are repaired', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 25);
  p.setLocation(3502, 3426, 0);
  h.interact(p, 5003, { x: 3502, y: 3426, z: 0 });
  assert.deepEqual(p.moves, [], 'an unrepaired bridge cannot be crossed');
  assert.ok(p.messages.some((message) => message.includes('bridge looks')));
  p.setAttribute('quest.in_search_of_the_myreque.bridge', 0b111);
  h.interact(p, 5003, { x: 3502, y: 3426, z: 0 });
  assert.deepEqual(p.moves.at(-1), [3503, 3431, 0], 'repaired bridge crosses');
});

test('the Mort\'ton boat needs its ten-coin fare unless a Ring of Charos(a) is worn', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 20);
  h.interact(p, O.SWAMP_BOATY_2, { x: 3523, y: 3284, z: 0 });
  assert.deepEqual(p.moves, [], 'no fare, no boat');
  assert.ok(p.messages.some((message) => message.includes('10 coins')));
  p.items.set(I.RING_OF_CHAROS_A_, 1);
  h.interact(p, O.SWAMP_BOATY_2, { x: 3523, y: 3284, z: 0 });
  assert.deepEqual(p.moves, [], 'a carried ring does not charm the boatman');
  p.items.delete(I.RING_OF_CHAROS_A_);
  p.equipment.set(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));
  h.interact(p, O.SWAMP_BOATY_2, { x: 3523, y: 3284, z: 0 });
  assert.equal(stage(h, p), 25, 'the activated ring skips the fare');
  assert.deepEqual(p.moves.at(-1), [3498, 3380, 0]);
});

test('surface doors and the hidden entrance stay locked before Curpile passes you', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 25);
  h.interact(p, O.WOODEN_DOORS_8, { x: 3509, y: 3447, z: 0 });
  assert.deepEqual(p.moves, [], 'surface doors do not open before the quiz');
  h.interact(p, O.CAVE_ENTRANCE_27, { x: 3505, y: 9831, z: 0 });
  assert.deepEqual(p.moves, [], 'hidden entrance does not open before the quiz');
  assert.equal(stage(h, p), 25);
});

test('a failed Curpile quiz knocks the player back without losing the stage leg', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 52);
  assert.equal(h.answer({ player: p, text: 'If the player answered zero out of three questions correctly:' }), true);
  h.action(p, 'kDZQpN');
  assert.deepEqual(p.moves.at(-1), [3522, 3285, 0], 'knocked out back to Mort\'ton');
  assert.equal(stage(h, p), 52, 'the retry page stays available');
  h.action(p, 'sXzRb_');
  h.choice(p, 'Dialogue 5', N.CURPILE_FYOD);
  h.choice(p, 'Cyreg Paddlehorn.', N.CURPILE_FYOD);
  h.condition(p, '3l6Jxc');
  assert.equal(stage(h, p), 55, 'a correct retry passes');
});

test('post-quest Myreque members use the canonical named page, not the grief page', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 85);
  assert.equal(h.variant(p, N.RADIGAD_PONFIT), 'myreque-hideout-after-defeating-the-skeleton-hellhound-radigad-ponfit');
  h.quest.setStage(p, 105);
  assert.equal(h.variant(p, N.RADIGAD_PONFIT), null, 'completed quest falls through to the standard page');
  assert.equal(h.variant(p, N.POLMAFI_FERDYGRIS), null);
  assert.equal(h.variant(p, N.IVAN_STROM), null);
});

test('a completed quest still hands in nothing and keeps the canonical wire value', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 105);
  h.condition(p, 'VLPyT3');
  assert.equal(stage(h, p), 105, 'hand-in cannot lower or re-complete');
  assert.equal(h.variant(p, N.VELIAF_HURTZ_2), null, 'Veliaf falls through after completion');
});
