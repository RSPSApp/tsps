// Biohazard (q007) source-contract checks.
// Fixture starting states are set explicitly through quest stage attributes and
// inventory/equipment. Ground items (pigeon cage 424, rotten apple 1984) and the
// mourner key 423 are fixtures for shared pickup/drop systems; every quest-local
// object, item, NPC and transcript handler exercised here is the production one.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');

const PLUGIN_PATH = path.resolve(__dirname, '../plugins/quests/quests/Biohazard.Quest');
const REAL_CORE = PluginManager.getCoreApi();
const { Location, NpcIdentifiers: N, ItemIdentifiers: I } = REAL_CORE;
const BIOHAZARD_STAGE = 'quest.biohazard.stage';
const PLAGUE_CITY_STAGE = 'quest.plague_city.stage';
const FREE_GOWN_ATTRIBUTE = 'biohazard:free-gown-given';
const GIVEN_VIALS_ATTRIBUTE = 'biohazard:given-vials';
const CHANCY_REFUND_ATTRIBUTE = 'biohazard:chancy-refunds';
const COINS = I.COINS;
const ELENA_CAPACITY_REFUSAL = "Elena tries to give you some items but you don't have enough room for them.";

function setup({ stage = 0, completed = [], freeSlots = 28 } = {}) {
  const completedKeys = new Set(completed);
  const questStages = new Map();
  const questRequests = [];
  const attributes = new Map([[BIOHAZARD_STAGE, stage]]);
  const items = new Map();
  const equipment = new Map();
  const messages = [];
  const messageSources = [];
  const lineEvents = [];
  let actionDispatchDepth = 0;
  const moves = [];
  const xp = [];
  const replacements = [];
  let location = new Location(3200, 3200, 0);
  let slots = freeSlots;

  const inventory = {
    getAmount: (itemId) => items.get(itemId) ?? 0,
    adds(itemId, amount) {
      if (!items.has(itemId) && slots > 0) slots--;
      items.set(itemId, (items.get(itemId) ?? 0) + amount);
      return inventory;
    },
    deleteNumber(itemId, amount) {
      const left = Math.max(0, (items.get(itemId) ?? 0) - amount);
      if (left === 0 && items.has(itemId)) {
        items.delete(itemId);
        slots++;
      } else if (items.has(itemId)) {
        items.set(itemId, left);
      }
      return inventory;
    },
    isFull: () => slots <= 0,
    getFreeSlots: () => slots,
  };
  const packetSender = new Proxy({}, { get: () => () => packetSender });
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) }),
    getPacketSender: () => packetSender,
    getLocation: () => location,
    moveTo: (next) => {
      location = next;
      moves.push(next);
    },
    sendMessage: (message) => {
      messages.push(message);
      messageSources.push(actionDispatchDepth > 0 ? 'action' : 'runner');
    },
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getUsername: () => 'Q007',
  };

  const handlers = {
    variant: [],
    condition: [],
    custom: new Map(),
    objects: new Map(),
    itemActions: new Map(),
    itemOnObject: [],
    zoneEnter: [],
    zoneExit: [],
    login: [],
    npcDeath: null,
  };
  const api = {
    core: {
      ...REAL_CORE,
      CountdownTask: undefined,
      ObjectManager: { deregister() {}, register: (object) => replacements.push(object) },
      GameObject: class {
        constructor(id, at, type, face, privateArea) {
          Object.assign(this, { id, at, type, face, privateArea });
        }
      },
    },
    persistAttribute() {},
    onInterfaceActionButton() {},
    onNpcDialogueVariant: (handler) => handlers.variant.push(handler),
    onNpcDialogueCondition: (handler) => handlers.condition.push(handler),
    onCustomEvent(name, handler) {
      const list = handlers.custom.get(name) ?? [];
      list.push(handler);
      handlers.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      // Registered-dispatch stand-in for QuestRuntime's quest:is-complete answer.
      if (name === 'quest:is-complete') {
        questRequests.push({ key: event?.key });
        event.complete = completedKeys.has(event?.key);
      }
      if (name === 'quest:get-stage') {
        questRequests.push({ key: event?.key, stage: true });
        event.stage = questStages.has(event?.key) ? questStages.get(event.key) : null;
      }
      const action = name === 'npc-dialogue:action';
      if (action) actionDispatchDepth++;
      try {
        if (name === 'npc-dialogue:line') lineEvents.push(event);
        for (const handler of handlers.custom.get(name) ?? []) handler(event);
      } finally {
        if (action) actionDispatchDepth--;
      }
    },
    onObjectInteraction(name, actions) {
      handlers.objects.set(name, actions);
    },
    onItemOnObject(handler) {
      handlers.itemOnObject.push(handler);
    },
    onItemAction(name, actions) {
      handlers.itemActions.set(name, actions);
    },
    onZoneEnter(zone, handler) {
      handlers.zoneEnter.push({ zone, handler });
    },
    onZoneExit(zone, handler) {
      handlers.zoneExit.push({ zone, handler });
    },
    onPlayerLogin(handler) {
      handlers.login.push(handler);
    },
    onNpcDeath(handler) {
      handlers.npcDeath = handler;
    },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
  };

  const runtime = require('../plugins/quests/QuestRuntime');
  const originalStartTranscript = runtime.startTranscript;
  const transcriptCalls = [];
  runtime.startTranscript = (apiArg, playerArg, npcId, page, variant) => {
    transcriptCalls.push({ npcId, page, variant, player: playerArg });
    return true;
  };
  delete require.cache[require.resolve(PLUGIN_PATH)];
  require(PLUGIN_PATH)(api);
  runtime.startTranscript = originalStartTranscript;

  const invoke = {
    variant: (npcId) => handlers.variant.at(-1)({ player, npcId }),
    condition: (text, stepId = 'test', pages = [{ page: 'Biohazard' }]) =>
      handlers.condition.at(-1)({ player, text, stepId, pages }),
    line: (npcId, text, pages = [{ page: 'Biohazard' }]) => {
      const event = { player, npcId, text, pages };
      handlers.custom.get('npc-dialogue:line').at(-1)(event);
      return event;
    },
    hook: (npcId, hook = 'quest:biohazard:start') =>
      handlers.custom.get('npc-dialogue:hook').at(-1)({ player, npcId, hook }),
    action: (npcId, stepId, text, action) => {
      const event = { player, npcId, stepId, text, action, handled: false };
      handlers.custom.get('npc-dialogue:action').at(-1)(event);
      return event;
    },
    object: (name, option, event) => {
      const handler = handlers.objects.get(name)?.[option];
      if (!handler) return undefined;
      return handler({ player, handled: false, ...event });
    },
    itemAction: (name, option, event) => {
      const handler = handlers.itemActions.get(name)?.[option];
      if (!handler) return undefined;
      return handler({ player, handled: false, ...event });
    },
    itemOnObject: (event) => {
      handlers.itemOnObject.at(-1)({ player, handled: false, ...event });
    },
    doorToggle: (event) => {
      const request = { player, handled: false, ...event };
      handlers.custom.get('door:toggle').at(-1)(request);
      return request;
    },
    zoneEnter: (index = 0) => handlers.zoneEnter[index].handler({ player }),
    zoneExit: (index = 0) => handlers.zoneExit[index].handler({ player }),
    npcDeath: (event) => handlers.npcDeath(event),
  };

  return {
    api, attributes, items, equipment, messages, messageSources, lineEvents, moves, xp, player, handlers, invoke, replacements, transcriptCalls, inventory, questRequests,
    setEquipment(slot, itemId) { equipment.set(slot, { getId: () => itemId }); },
    setLocation(x, y, z = 0) { location = new Location(x, y, z); },
    setFreeSlots(value) { slots = value; },
    setCompleted(key, value = true) {
      if (value) completedKeys.add(key);
      else completedKeys.delete(key);
    },
    setQuestStage(key, value) {
      questStages.set(key, value);
    },
  };
}

const cupboardObject = (x, y) => ({
  getLocation: () => new Location(x, y, 0),
  getType: () => 10,
  getFace: () => 1,
  getPrivateArea: () => null,
});

const HANDOUTS = [
  {
    name: 'Vpxjql', npcId: N.ELENA_2, stage: 10,
    variant: 'delivering-the-samples-talking-to-elena-with-the-distillator', path: [7],
    text: 'Elena gives you a plague sample along with three vials.',
    expected: [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE],
  },
  {
    name: 'iL_fQb', npcId: N.ELENA_2, stage: 12,
    variant: 'delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist',
    path: [1, 'options', 1, 'steps', 2, 'steps', 2],
    text: 'Elena replaces your lost items.',
    expected: [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE],
  },
  {
    name: 'CQkuOd', npcId: N.CHEMIST, stage: 12,
    variant: 'visiting-the-chemist-house-in-rimmington-talking-to-chemist',
    path: [0, 'options', 1, 'steps', 10], text: 'The chemist gives you some touch paper.',
    expected: [I.TOUCH_PAPER],
  },
  {
    name: '9S8xcG', npcId: N.CHEMIST, stage: 12,
    variant: 'visiting-the-chemist-house-in-rimmington-talking-to-the-chemist-again',
    path: [0, 'options', 1, 'steps', 3, 'steps', 2], text: 'The chemist gives you some touch paper.',
    expected: [I.TOUCH_PAPER],
  },
  {
    name: 'K6WP1U', npcId: N.ASYFF, stage: 12,
    variant: 'visiting-south-east-varrock-talking-to-asyff',
    path: [4, 'options', 1, 'steps', 4], text: 'You are given a Priest Gown.',
    expected: [I.PRIEST_GOWN, I.PRIEST_GOWN_3],
  },
];

function canonicalHandoutNode({ variant, path }) {
  let node = require('../data/definitions/npc-dialogues.json')['Biohazard'].variants[variant];
  for (const segment of path) node = node[segment];
  return node;
}

function runCanonicalHandout(run, handout) {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  const runtime = require('../plugins/quests/QuestRuntime');
  const node = canonicalHandoutNode(handout);
  return runtime.startTranscript(run.api, run.player, handout.npcId, 'Biohazard', handout.variant, () => [node]);
}

test('Biohazard defers Elena to the registered Plague City completion, not a raw stage', () => {
  const incomplete = setup({ stage: 0 });
  assert.equal(
    incomplete.invoke.variant(N.ELENA_2),
    null,
    'unfinished Plague City must keep ownership of Elena'
  );
  incomplete.invoke.hook(N.ELENA_2);
  assert.equal(incomplete.attributes.get(BIOHAZARD_STAGE), 0, 'Biohazard cannot start early');
  assert.ok(
    incomplete.questRequests.some((request) => request.key === 'plague_city'),
    'Biohazard asks the shared quest registry for plague_city'
  );

  // The old raw stage attribute must not be enough on its own.
  const rawOnly = setup({ stage: 0 });
  rawOnly.attributes.set(PLAGUE_CITY_STAGE, 29);
  assert.equal(rawOnly.invoke.variant(N.ELENA_2), null);
  rawOnly.invoke.hook(N.ELENA_2);
  assert.equal(rawOnly.attributes.get(BIOHAZARD_STAGE), 0, 'raw quest.plague_city.stage is ignored');

  // An answer for some other quest key also does not count.
  const wrongKey = setup({ stage: 0, completed: ['plague_city_wrong'] });
  assert.equal(wrongKey.invoke.variant(N.ELENA_2), null);
  wrongKey.invoke.hook(N.ELENA_2);
  assert.equal(wrongKey.attributes.get(BIOHAZARD_STAGE), 0);

  const complete = setup({ stage: 0, completed: ['plague_city'] });
  assert.equal(complete.invoke.variant(N.ELENA_2), 'getting-started-talking-to-elena');
  complete.invoke.hook(N.ELENA_2);
  assert.equal(complete.attributes.get(BIOHAZARD_STAGE), 1);

  // Completion comes from the registry even when the raw attribute is still 0.
  const completeRawZero = setup({ stage: 0, completed: ['plague_city'] });
  completeRawZero.attributes.set(PLAGUE_CITY_STAGE, 0);
  completeRawZero.invoke.hook(N.ELENA_2);
  assert.equal(completeRawZero.attributes.get(BIOHAZARD_STAGE), 1);
});

test('Biohazard stage 0 route reaches completion through its real handlers', () => {
  const run = setup({ stage: 0, completed: ['plague_city'] });

  run.invoke.variant(N.ELENA_2);
  run.invoke.hook(N.ELENA_2);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 1);

  assert.equal(run.invoke.variant(N.JERICO), 'getting-started-talking-to-jerico');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 2);

  assert.equal(run.invoke.object('Cupboard', 'Open', {
    objectId: 2056, object: cupboardObject(2611, 3326),
  }), true);
  assert.equal(run.invoke.object('Cupboard', 'Search', { objectId: 2057 }), true);
  assert.equal(run.items.get(I.BIRD_FEED), 1);

  run.items.set(I.PIGEON_CAGE, 1); // ground spawn 424 at 2618,3323-3325
  run.setLocation(2562, 3301);
  assert.equal(run.invoke.object('Watchtower', 'Investigate', { objectId: 37328 }), true);
  assert.equal(run.items.get(I.BIRD_FEED), undefined);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 3);

  assert.equal(run.invoke.itemAction('Pigeon cage', 'Open', { itemId: I.PIGEON_CAGE }), true);
  assert.equal(run.items.get(I.PIGEON_CAGE), undefined);
  assert.equal(run.items.get(I.PIGEON_CAGE_2), 1);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 4);

  assert.equal(run.invoke.variant(N.OMART), 'getting-started-talking-to-omart-after-freeing-the-birds');
  assert.equal(run.invoke.condition('If the player is not wearing a gas mask:'), true);
  run.setEquipment(REAL_CORE.Equipment.HEAD_SLOT, I.GAS_MASK);
  assert.equal(run.invoke.condition('If the player is not wearing a gas mask:'), false);
  run.invoke.action(N.OMART, 'v1MvBF');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 5);
  assert.equal(run.moves.at(-1).getX(), 2554);

  run.setLocation(2540, 3331);
  assert.equal(run.invoke.object('Fence', 'Squeeze-through', {
    objectId: 2068, location: new Location(2541, 3331, 0),
  }), true);
  assert.equal(run.moves.at(-1).getX(), 2542);

  run.items.set(I.ROTTEN_APPLE, 1); // ground spawn 1984 at 2549,3332
  run.invoke.itemOnObject({ itemId: I.ROTTEN_APPLE, objectId: 37327 });
  assert.equal(run.items.get(I.ROTTEN_APPLE), undefined);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 6);

  assert.equal(run.invoke.object('Cupboard', 'Open', {
    objectId: 2062, object: cupboardObject(2517, 3276),
  }), true);
  assert.equal(run.invoke.object('Cupboard', 'Search', { objectId: 2063 }), true);
  assert.equal(run.items.get(I.MEDICAL_GOWN), 1);

  assert.equal(run.invoke.doorToggle({
    objectId: 2036, location: new Location(2551, 3320, 0),
  }).handled, true);
  assert.match(run.messages.at(-1), /medical gown/);
  run.setEquipment(REAL_CORE.Equipment.BODY_SLOT, I.MEDICAL_GOWN);
  assert.equal(run.invoke.doorToggle({
    objectId: 2036, location: new Location(2551, 3320, 0),
  }).handled, false);

  assert.equal(run.invoke.doorToggle({ objectId: 2058 }).handled, true);
  assert.match(run.messages.at(-1), /need a key/);
  run.items.set(I.KEY_2, 1); // 9008's guaranteed drop
  assert.equal(run.invoke.doorToggle({ objectId: 2058 }).handled, false);
  assert.equal(run.invoke.object('Crate', 'Search', { objectId: 2064 }), true);
  assert.equal(run.items.get(I.DISTILLATOR), 1);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 7);

  assert.equal(run.invoke.variant(N.KILRON), 'infiltrating-the-mourner-hq-talking-to-kilron');
  run.invoke.action(N.KILRON, 'PIRzeQ');
  assert.equal(run.moves.at(-1).getX(), 2560);

  assert.equal(run.invoke.variant(N.ELENA_2), 'delivering-the-samples-talking-to-elena-with-the-distillator');
  assert.equal(run.items.get(I.DISTILLATOR), undefined);
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 10);
  run.invoke.action(N.ELENA_2, 'Vpxjql');
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    assert.equal(run.items.get(itemId), 1);
  }

  assert.equal(run.invoke.variant(N.CHEMIST), 'visiting-the-chemist-house-in-rimmington-talking-to-chemist');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 12);
  run.invoke.action(N.CHEMIST, 'CQkuOd');
  assert.equal(run.items.get(I.TOUCH_PAPER), 1);

  assert.equal(
    run.invoke.variant(N.HOPS),
    'visiting-the-chemist-house-in-rimmington-talking-to-hops-in-rimmington-after-talking-to-the-chemist'
  );
  run.invoke.action(N.HOPS, '4GZLie', 'You give him the vial of sulphuric broline.');
  assert.equal(run.items.get(I.SULPHURIC_BROLINE), undefined);
  assert.equal(
    run.invoke.variant(N.HOPS),
    'visiting-the-chemist-house-in-rimmington-talking-to-hops-in-rimmington-after-giving-him-a-vial'
  );
  run.invoke.action(N.CHANCY, 'WpMYWa', 'You give him the vial of liquid honey.');
  run.invoke.action(N.DA_VINCI, 'Ay-Sr-', 'You give him the vial of ethenea.');
  assert.equal(run.attributes.get(GIVEN_VIALS_ATTRIBUTE), 'hops:417,chancy:416,da-vinci:415');

  assert.equal(run.invoke.variant(N.HOPS_2), 'visiting-south-east-varrock-talking-to-hops-in-varrock-after-giving-him-broline');
  run.invoke.action(N.HOPS_2, '3WsEpt', 'He gives you the vial of sulphuric broline.');
  assert.equal(run.items.get(I.SULPHURIC_BROLINE), 1);
  assert.equal(run.invoke.variant(N.HOPS_2), 'visiting-south-east-varrock-talking-to-hops-in-varrock-before-talking-to-the-chemist');
  run.invoke.action(N.CHANCY_2, 'v7xtry', 'He gives you the vial of liquid honey.');
  run.invoke.action(N.DA_VINCI_2, 'PE3VqH', 'He gives you the vial of ethenea.');

  assert.equal(run.invoke.variant(N.ASYFF), 'visiting-south-east-varrock-talking-to-asyff');
  run.invoke.action(N.ASYFF, 'K6WP1U');
  assert.equal(run.items.get(I.PRIEST_GOWN), 1);
  assert.equal(run.items.get(I.PRIEST_GOWN_3), 1);
  assert.equal(run.attributes.get(FREE_GOWN_ATTRIBUTE), 1);
  run.setEquipment(REAL_CORE.Equipment.BODY_SLOT, I.PRIEST_GOWN);
  run.setEquipment(REAL_CORE.Equipment.LEG_SLOT, I.PRIEST_GOWN_3);

  assert.equal(
    run.invoke.variant(N.JULIE),
    'visiting-south-east-varrock-talking-to-julie-while-wearing-priest-gown-top-and-bottom'
  );
  const closedBedroomDoor = { ...cupboardObject(3282, 3382), getFace: () => 2 };
  assert.equal(run.invoke.object('Bedroom door', 'Open', {
    objectId: 2032, object: closedBedroomDoor,
  }), true);
  assert.equal(run.replacements.at(-1).id, 2033);
  assert.equal(run.replacements.at(-1).face, 3);

  assert.equal(run.invoke.variant(N.GUIDOR), 'visiting-south-east-varrock-talking-to-guidor');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 12, 'opening Guidor does not advance the quest');
  run.invoke.line(N.GUIDOR, 'This result can only mean one thing... there is no plague. It seems that someone has been lying about all of it. The only question is... why?');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 14);

  assert.equal(run.invoke.variant(N.ELENA_2), 'return-to-ardougne-talking-to-elena-after-talking-to-guidor');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 15);

  assert.equal(
    run.invoke.variant(N.KING_LATHAS),
    'return-to-ardougne-talking-to-king-lathas-after-talking-to-elena-about-the-plague'
  );
  run.invoke.action(N.KING_LATHAS, 'vxKtyO');
  assert.equal(run.attributes.get(BIOHAZARD_STAGE), 16);
  assert.equal(run.attributes.get('quest.points'), 3);
  assert.equal(run.xp.at(-1)[0], REAL_CORE.Skill.THIEVING);
  assert.equal(run.xp.at(-1)[1], 1250);
  assert.equal(run.invoke.variant(N.KING_LATHAS), null);
});

test('Biohazard recovery, full-bag and guard-search branches use the real handlers', () => {
  const run = setup({ stage: 10, completed: ['plague_city'] });

  assert.equal(
    run.invoke.variant(N.ELENA_2),
    'delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist'
  );
  run.invoke.action(N.ELENA_2, 'iL_fQb');
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    assert.equal(run.items.get(itemId), 1);
  }

  const elenaStage10 = setup({ stage: 10, completed: ['plague_city'] });
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) elenaStage10.items.set(itemId, 1);
  assert.equal(elenaStage10.invoke.condition('If the player has all the items:'), true);
  assert.equal(elenaStage10.invoke.condition('If the player is missing items:'), false);
  elenaStage10.invoke.action(N.ELENA_2, 'iL_fQb');
  assert.equal(elenaStage10.items.get(I.TOUCH_PAPER), undefined, 'Elena never grants touch paper');
  assert.ok(!elenaStage10.messages.some((message) => /replaces your lost items/.test(message)));

  const elenaStage12 = setup({ stage: 12, completed: ['plague_city'] });
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) elenaStage12.items.set(itemId, 1);
  assert.equal(elenaStage12.invoke.condition('If the player has all the items:'), true);
  elenaStage12.invoke.action(N.ELENA_2, 'iL_fQb');
  assert.equal(elenaStage12.items.get(I.TOUCH_PAPER), undefined);

  const wrongActor = setup({ stage: 12, completed: ['plague_city'] });
  wrongActor.invoke.action(N.GUIDOR, 'iL_fQb');
  assert.equal(wrongActor.items.get(I.PLAGUE_SAMPLE), undefined, 'Elena recovery is actor-guarded');
  wrongActor.invoke.action(N.ELENA_2, '9S8xcG');
  assert.equal(wrongActor.items.get(I.TOUCH_PAPER), undefined, 'the Chemist receipt id is not Elena recovery');

  run.attributes.set(BIOHAZARD_STAGE, 12);
  run.items.delete(I.TOUCH_PAPER);
  const touchPaper = run.invoke.action(N.CHEMIST, '9S8xcG');
  assert.equal(run.items.get(I.TOUCH_PAPER), 1);
  assert.equal(touchPaper.handled, false);

  const fullChemist = setup({ stage: 12, completed: ['plague_city'], freeSlots: 0 });
  const fullChemistAction = fullChemist.invoke.action(N.CHEMIST, '9S8xcG');
  assert.equal(fullChemist.items.get(I.TOUCH_PAPER), undefined);
  assert.equal(fullChemistAction.handled, true);
  assert.equal(fullChemistAction.end, true);
  assert.ok(!fullChemist.messages.some((message) => /gives you some touch paper/.test(message)));
  fullChemist.setFreeSlots(1);
  fullChemist.invoke.action(N.CHEMIST, '9S8xcG');
  assert.equal(fullChemist.items.get(I.TOUCH_PAPER), 1);

  const stage7 = setup({ stage: 7, completed: ['plague_city'] });
  assert.equal(stage7.invoke.object('Crate', 'Search', { objectId: 2064 }), true);
  assert.equal(stage7.items.get(I.DISTILLATOR), 1);
  assert.equal(stage7.attributes.get(BIOHAZARD_STAGE), 7);
  stage7.items.delete(I.DISTILLATOR);
  assert.equal(stage7.invoke.object('Cupboard', 'Search', { objectId: 2063 }), true);
  assert.equal(stage7.items.get(I.MEDICAL_GOWN), 1, 'stage-7 lost gown is recoverable');

  const stage7Full = setup({ stage: 7, completed: ['plague_city'], freeSlots: 0 });
  assert.equal(stage7Full.invoke.object('Crate', 'Search', { objectId: 2064 }), true);
  assert.equal(stage7Full.items.get(I.DISTILLATOR), undefined);
  assert.match(stage7Full.messages.at(-1), /don't have enough room/);

  const lateCrate = setup({ stage: 10, completed: ['plague_city'] });
  assert.equal(lateCrate.invoke.object('Crate', 'Search', { objectId: 2064 }), true);
  assert.equal(lateCrate.items.get(I.DISTILLATOR), undefined, 'the used crate cannot re-grant after the hand-in');

  const courierRecovery = setup({ stage: 12, completed: ['plague_city'] });
  courierRecovery.items.set(I.PLAGUE_SAMPLE, 1);
  courierRecovery.items.set(I.TOUCH_PAPER, 1);
  for (const itemId of [I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) courierRecovery.items.set(itemId, 1);
  courierRecovery.invoke.action(N.DA_VINCI, 'Ay-Sr-', 'You give him the vial of ethenea.');
  courierRecovery.invoke.action(N.CHANCY, 'WpMYWa', 'You give him the vial of liquid honey.');
  courierRecovery.invoke.action(N.HOPS, '4GZLie', 'You give him the vial of sulphuric broline.');
  assert.equal(courierRecovery.invoke.condition('If the player has all the items:'), true);
  courierRecovery.invoke.action(N.ELENA_2, 'iL_fQb');
  for (const itemId of [I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    assert.equal(courierRecovery.items.get(itemId), undefined, 'Elena must not duplicate a courier-held vial');
  }
  assert.ok(!courierRecovery.messages.some((message) => /replaces your lost items/.test(message)));
  assert.equal(courierRecovery.attributes.get(GIVEN_VIALS_ATTRIBUTE), 'da-vinci:415,chancy:416,hops:417');
  courierRecovery.invoke.action(N.DA_VINCI_2, 'PE3VqH', 'He gives you the vial of ethenea.');
  courierRecovery.invoke.action(N.CHANCY_2, 'v7xtry', 'He gives you the vial of liquid honey.');
  courierRecovery.invoke.action(N.HOPS_2, '3WsEpt', 'He gives you the vial of sulphuric broline.');
  for (const itemId of [I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    assert.equal(courierRecovery.items.get(itemId), 1);
  }
  assert.equal(courierRecovery.attributes.get(GIVEN_VIALS_ATTRIBUTE), '');

  const fence = setup({ stage: 5, completed: ['plague_city'] });
  fence.setLocation(2540, 3331);
  assert.equal(fence.invoke.object('Fence', 'Squeeze-through', {
    objectId: 2068, location: new Location(2541, 3331, 0),
  }), true);
  assert.equal(fence.moves.at(-1).getX(), 2542);
  const beforeUnrelatedMove = fence.moves.length;
  const unrelated = { player: fence.player, objectId: 2068, location: new Location(2648, 4607, 3), handled: false };
  assert.equal(fence.handlers.objects.get('Fence')['Squeeze-through'](unrelated), false);
  assert.equal(unrelated.handled, false, 'unrelated Fence 2068 stays unhandled');
  assert.equal(fence.moves.length, beforeUnrelatedMove);

  const chancy = setup({ stage: 12, completed: ['plague_city'] });
  chancy.invoke.action(N.CHANCY_2, 'dzf0rc', '10 coins', 'receive');
  assert.equal(chancy.items.get(COINS), 10);
  assert.match(String(chancy.attributes.get(CHANCY_REFUND_ATTRIBUTE)), /^chancy:/);
  chancy.invoke.action(N.CHANCY_2, 'D3bNsS', '10 coins', 'receive');
  assert.equal(chancy.items.get(COINS), 10, 'the wrong-vial refund is only paid once');
  const chancyAlt = setup({ stage: 12, completed: ['plague_city'] });
  chancyAlt.invoke.action(N.CHANCY_2, 'D3bNsS', '10 coins', 'receive');
  assert.equal(chancyAlt.items.get(COINS), 10);

  const fullBag = setup({ stage: 6, completed: ['plague_city'], freeSlots: 0 });
  assert.equal(fullBag.invoke.object('Cupboard', 'Search', { objectId: 2063 }), true);
  assert.equal(fullBag.items.get(I.MEDICAL_GOWN), undefined);
  assert.match(fullBag.messages.at(-1), /don't have enough room/);
  assert.equal(fullBag.invoke.object('Crate', 'Search', { objectId: 2064 }), true);
  assert.equal(fullBag.items.get(I.DISTILLATOR), undefined);
  assert.match(fullBag.messages.at(-1), /don't have enough room/);

  const guard = setup({ stage: 12, completed: ['plague_city'] });
  for (const itemId of [I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) guard.items.set(itemId, 1);
  guard.invoke.zoneEnter();
  assert.deepEqual(guard.transcriptCalls.at(-1), {
    npcId: N.GUARD_19,
    page: 'Biohazard',
    variant: 'visiting-south-east-varrock-entering-south-east-varrock',
    player: guard.player,
  });
  assert.ok(!guard.messages.some((message) => /Halt\. I need to conduct a search/.test(message)), 'guard speech is not copied into a system message');
  for (const [stepId, itemId] of [['FXDpRm', I.ETHENEA], ['vIH9dQ', I.LIQUID_HONEY], ['A8JLmw', I.SULPHURIC_BROLINE]]) {
    assert.equal(guard.invoke.condition(`If the player has ${itemId === I.ETHENEA ? 'ethenea' : itemId === I.LIQUID_HONEY ? 'liquid honey' : 'sulphuric broline'}:`, stepId), true);
    guard.invoke.action(N.GUARD_19, stepId, '');
    assert.equal(guard.items.get(itemId), undefined);
  }
  guard.items.set(I.ETHENEA, 1);
  guard.invoke.zoneExit();
  assert.deepEqual(guard.transcriptCalls.at(-1), {
    npcId: N.GUARD_19,
    page: 'Biohazard',
    variant: 'visiting-south-east-varrock-exiting-south-east-varrock-while-holding-the-vials',
    player: guard.player,
  });
  assert.ok(
    !guard.messages.some((message) => message.includes('talk to Guidor before leaving')),
    'the exit line is not copied into a system message'
  );

  const voucher = setup({ stage: 12, completed: ['plague_city'], freeSlots: 0 });
  voucher.attributes.set(GIVEN_VIALS_ATTRIBUTE, 'hops:417');
  assert.equal(
    voucher.invoke.variant(N.HOPS_2),
    'visiting-south-east-varrock-talking-to-hops-in-varrock-after-giving-him-broline'
  );
  voucher.invoke.action(N.HOPS_2, '3WsEpt', 'He gives you the vial of sulphuric broline.');
  assert.equal(voucher.items.get(I.SULPHURIC_BROLINE), undefined);
  assert.equal(voucher.attributes.get(GIVEN_VIALS_ATTRIBUTE), 'hops:417');
});

test('a failed courier loan is cleared once Elena replaces that vial', () => {
  const run = setup({ stage: 12, completed: ['plague_city'] });
  run.attributes.set(
    GIVEN_VIALS_ATTRIBUTE,
    `hops:${I.SULPHURIC_BROLINE},chancy:${I.ETHENEA}`
  );

  // Chancy consumed the wrong vial in Varrock and refunded the player.
  run.invoke.action(N.CHANCY_2, 'dzf0rc', '10 coins', 'receive');
  assert.equal(run.items.get(COINS), 10);
  assert.equal(
    run.attributes.get(GIVEN_VIALS_ATTRIBUTE),
    `hops:${I.SULPHURIC_BROLINE},chancy:${I.ETHENEA}`,
    'the wrong loan is still recorded until recovery'
  );
  assert.equal(
    run.invoke.variant(N.CHANCY),
    'visiting-the-chemist-house-in-rimmington-talking-to-chancy-in-rimmington-after-giving-him-a-vial',
    'the failed loan still blocks Chancy before recovery'
  );

  run.invoke.action(N.ELENA_2, 'iL_fQb');
  assert.equal(run.items.get(I.LIQUID_HONEY), 1, 'Elena replaces the missing honey');
  assert.equal(run.items.get(I.PLAGUE_SAMPLE), 1);
  assert.equal(run.items.get(I.ETHENEA), 1);
  assert.equal(run.items.get(I.SULPHURIC_BROLINE), undefined, 'the valid Hops loan is not re-granted');
  assert.equal(
    run.attributes.get(GIVEN_VIALS_ATTRIBUTE),
    `hops:${I.SULPHURIC_BROLINE}`,
    'only the failed Chancy reservation is cleared'
  );
  assert.equal(
    run.invoke.variant(N.CHANCY),
    'visiting-the-chemist-house-in-rimmington-talking-to-chancy-in-rimmington-after-talking-to-the-chemist',
    'Chancy can accept the correct replacement after recovery'
  );
  assert.equal(
    run.invoke.variant(N.HOPS),
    'visiting-the-chemist-house-in-rimmington-talking-to-hops-in-rimmington-after-giving-him-a-vial',
    'the valid pending Hops loan still counts as given'
  );

  run.invoke.action(N.CHANCY, 'WpMYWa', 'You give him the vial of liquid honey.');
  assert.equal(run.items.get(I.LIQUID_HONEY), undefined);
  assert.equal(
    run.attributes.get(GIVEN_VIALS_ATTRIBUTE),
    `hops:${I.SULPHURIC_BROLINE},chancy:${I.LIQUID_HONEY}`
  );
});

test("Guidor's bedroom door plays the canonical entry conversation", () => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const run = setup({ stage: 12, completed: ['plague_city'] });
  run.setEquipment(REAL_CORE.Equipment.BODY_SLOT, I.PRIEST_GOWN);
  run.setEquipment(REAL_CORE.Equipment.LEG_SLOT, I.PRIEST_GOWN_3);
  assert.equal(run.invoke.object('Bedroom door', 'Open', {
    objectId: 2032,
    object: { ...cupboardObject(3282, 3382), getFace: () => 2 },
  }), true);
  assert.deepEqual(run.transcriptCalls.at(-1), {
    npcId: N.JULIE,
    page: 'Biohazard',
    variant: 'visiting-south-east-varrock-talking-to-julie-while-wearing-priest-gown-top-and-bottom',
    player: run.player,
  });
  // The played conversation is the canonical acceptance, not the refusal.
  const acceptance = dialogues['Biohazard'].variants[
    'visiting-south-east-varrock-talking-to-julie-while-wearing-priest-gown-top-and-bottom'
  ];
  assert.equal(
    acceptance[0].text,
    "A priest! thank goodness! My husband is very ill! Perhaps you could read him his last rites?",
    'the imported conversation accepts the priest'
  );
  assert.equal(run.replacements.at(-1).id, 2033, 'the door still opens');
  assert.equal(run.replacements.at(-1).face, 3);

  // Without the priest gown Julie refuses, which is the other imported page.
  const withoutGown = setup({ stage: 12, completed: ['plague_city'] });
  assert.equal(withoutGown.invoke.object('Bedroom door', 'Open', {
    objectId: 2032,
    object: { ...cupboardObject(3282, 3382), getFace: () => 2 },
  }), true);
  assert.deepEqual(withoutGown.transcriptCalls.at(-1), {
    npcId: N.JULIE,
    page: 'Julie',
    variant: 'opening-bedroom-door-without-priest-gown-equipped',
    player: withoutGown.player,
  });
  assert.equal(
    dialogues['Julie'].variants['opening-bedroom-door-without-priest-gown-equipped'][0].npc,
    "Please leave my husband alone. He's very sick, and I don't want anyone bothering him."
  );
});

test('the south-east Varrock exit offers the canonical "Leave anyway?" choice', async () => {
  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const run = setup({ stage: 12, completed: ['plague_city'] });
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const runtime = require('../plugins/quests/QuestRuntime');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  assert.equal(
    runtime.startTranscript(
      run.api,
      run.player,
      N.GUARD_19,
      'Biohazard',
      'visiting-south-east-varrock-exiting-south-east-varrock-while-holding-the-vials'
    ),
    true
  );
  let guard = 50;
  while (!run.player.prompt && manager.getCurrent?.() && guard-- > 0) manager.advance();
  assert.ok(run.player.prompt, 'the exit conversation asks the canonical question');
  assert.equal(run.player.prompt.title, 'Leave anyway?');
  assert.deepEqual(run.player.prompt.options, ['Yes.', 'No.']);
});

test('the sickest mourner death plays the canonical key-drop message', () => {
  const run = setup({ stage: 6, completed: ['plague_city'] });
  run.invoke.npcDeath({ killer: run.player, npcId: N.MOURNER_14 });
  assert.deepEqual(run.transcriptCalls.at(-1), {
    npcId: N.MOURNER_14,
    page: 'Biohazard',
    variant: 'infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs-when-the-sickest-mourner-dies',
    player: run.player,
  });

  const otherMourner = setup({ stage: 6, completed: ['plague_city'] });
  otherMourner.invoke.npcDeath({ killer: otherMourner.player, npcId: N.MOURNER_9 });
  assert.equal(otherMourner.transcriptCalls.length, 0, 'other mourners stay silent');

  const beforeTheHq = setup({ stage: 5, completed: ['plague_city'] });
  beforeTheHq.invoke.npcDeath({ killer: beforeTheHq.player, npcId: N.MOURNER_14 });
  assert.equal(beforeTheHq.transcriptCalls.length, 0, 'the message belongs to the Mourner HQ route');
});

test('the wrong-vial refund is retryable per failed courier transaction', () => {
  const run = setup({ stage: 12, completed: ['plague_city'] });
  run.items.set(I.PLAGUE_SAMPLE, 1);
  run.items.set(I.ETHENEA, 1);
  run.items.set(I.SULPHURIC_BROLINE, 1);

  // Chancy gets the wrong vial; the Varrock Chancy refunds it once.
  run.invoke.action(N.CHANCY, 'WpMYWa', 'You give him the vial of ethenea.');
  assert.equal(run.attributes.get(GIVEN_VIALS_ATTRIBUTE), `chancy:${I.ETHENEA}`);
  run.invoke.action(N.CHANCY_2, 'dzf0rc', '10 coins', 'receive');
  assert.equal(run.items.get(COINS), 10);
  run.invoke.action(N.CHANCY_2, 'dzf0rc', '10 coins', 'receive');
  assert.equal(run.items.get(COINS), 10, 'one payment per failed transaction');

  // Elena replaces the vials the failed hand-over swallowed.
  run.invoke.action(N.ELENA_2, 'iL_fQb');
  assert.equal(run.items.get(I.ETHENEA), 1);
  assert.equal(run.items.get(I.LIQUID_HONEY), 1);
  assert.equal(run.attributes.get(GIVEN_VIALS_ATTRIBUTE), '', 'the failed loan is resolved');

  // A second failed hand-over is a new transaction and is paid again.
  run.invoke.action(N.CHANCY, 'WpMYWa', 'You give him the vial of ethenea.');
  run.invoke.action(N.CHANCY_2, 'dzf0rc', '10 coins', 'receive');
  assert.equal(run.items.get(COINS), 20, 'the retry of a failed transaction pays again');
});

test('Bedroom door open leaf is passable in both directions against cache geometry', async () => {
  const run = setup({ stage: 12, completed: ['plague_city'] });
  run.setEquipment(REAL_CORE.Equipment.BODY_SLOT, I.PRIEST_GOWN);
  run.setEquipment(REAL_CORE.Equipment.LEG_SLOT, I.PRIEST_GOWN_3);
  assert.equal(run.invoke.object('Bedroom door', 'Open', {
    objectId: 2032,
    object: { ...cupboardObject(3282, 3382), getFace: () => 2 },
  }), true);
  const replacement = run.replacements.at(-1);
  assert.equal(replacement.id, 2033);
  assert.equal(replacement.face, 3);

  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  RegionManager.init();
  const door = new Location(3282, 3382, 0);
  RegionManager.loadMapFiles(door.getX(), door.getY());
  const closed = MapObjects.get(2032, door, null);
  ObjectManager.deregister(closed, true);
  ObjectManager.register(new GameObject(2033, door, closed.getType(), replacement.face, null), true);
  const canMove = (x, y, direction) => RegionManager.canMoveIsBlocked(new Location(x, y, 0), direction, null);
  assert.equal(canMove(3281, 3382, 4), true, 'west room -> doorway');
  assert.equal(canMove(3282, 3382, 4), true, 'doorway -> east room');
  assert.equal(canMove(3283, 3382, 3), true, 'east room -> doorway');
  assert.equal(canMove(3282, 3382, 3), true, 'doorway -> west room');
});

function runVariantWithChoice(run, npcId, variant, chooseText) {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const runtime = require('../plugins/quests/QuestRuntime');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  run.player.prompt = null;
  const originalCondition = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const handler of run.handlers.condition) {
      const answer = handler(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  try {
    runtime.startTranscript(run.api, run.player, npcId, 'Biohazard', variant);
    let guard = 100;
    while (!run.player.prompt && manager.getCurrent() && guard-- > 0) manager.advance();
    assert.ok(run.player.prompt, `${variant} prompt is shown`);
    const index = run.player.prompt.options.indexOf(chooseText);
    assert.ok(index >= 0, `missing option ${chooseText}`);
    const choose = run.player.prompt.pairs[index * 2 + 1];
    run.player.prompt = null;
    choose();
    let remaining = 200;
    while (manager.getCurrent?.() && remaining-- > 0) manager.advance();
    return manager;
  } finally {
    PluginManager.emitNpcDialogueCondition = originalCondition;
  }
}

function openGuidorTranscript(run, chooseText) {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const runtime = require('../plugins/quests/QuestRuntime');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  run.player.prompt = null;
  const originalCondition = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const handler of run.handlers.condition) {
      const answer = handler(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  try {
    runtime.startTranscript(run.api, run.player, N.GUIDOR, 'Biohazard', 'visiting-south-east-varrock-talking-to-guidor');
    let guard = 100;
    while (!run.player.prompt && manager.getCurrent() && guard-- > 0) manager.advance();
    if (chooseText) {
      assert.ok(run.player.prompt, 'Guidor choice is shown');
      const index = run.player.prompt.options.indexOf(chooseText);
      assert.ok(index >= 0, `missing Guidor option ${chooseText}`);
      const choose = run.player.prompt.pairs[index * 2 + 1];
      run.player.prompt = null;
      choose();
      let remaining = 100;
      while (manager.getCurrent?.() && remaining-- > 0) manager.advance();
    }
    return manager;
  } finally {
    PluginManager.emitNpcDialogueCondition = originalCondition;
  }
}

function guidorReadyRun() {
  const run = setup({ stage: 12, completed: ['plague_city'] });
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE, I.TOUCH_PAPER]) {
    run.items.set(itemId, 1);
  }
  run.setEquipment(REAL_CORE.Equipment.BODY_SLOT, I.PRIEST_GOWN);
  run.setEquipment(REAL_CORE.Equipment.LEG_SLOT, I.PRIEST_GOWN_3);
  return run;
}

test('imported Chancy wrong-vial transcript pays each refund branch once', () => {
  require('../dist/Server').Server.installProductionPathResolver();
  const variant = 'visiting-south-east-varrock-talking-to-chancy-in-varrock-after-giving-him-the-wrong-vial';

  const first = setup({ stage: 12, completed: ['plague_city'] });
  runVariantWithChoice(first, N.CHANCY_2, variant, 'No! Nothing could be further from the truth!');
  assert.equal(first.items.get(COINS), 10);
  assert.match(String(first.attributes.get(CHANCY_REFUND_ATTRIBUTE)), /^chancy:/);
  first.invoke.action(N.CHANCY_2, 'D3bNsS', '10 coins', 'receive');
  assert.equal(first.items.get(COINS), 10, 'the sibling refund branch cannot pay twice');

  const second = setup({ stage: 12, completed: ['plague_city'] });
  runVariantWithChoice(second, N.CHANCY_2, variant, 'You have no idea what you have just done!');
  assert.equal(second.items.get(COINS), 10);
  assert.match(String(second.attributes.get(CHANCY_REFUND_ATTRIBUTE)), /^chancy:/);
});

test('imported mourner-death message renders without inventing the shared key drop', () => {
  require('../dist/Server').Server.installProductionPathResolver();
  const run = setup({ stage: 6, completed: ['plague_city'] });
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const runtime = require('../plugins/quests/QuestRuntime');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  assert.equal(
    runtime.startTranscript(
      run.api,
      run.player,
      N.MOURNER_14,
      'Biohazard',
      'infiltrating-the-mourner-hq-talking-to-sickest-mourner-upstairs-when-the-sickest-mourner-dies'
    ),
    true
  );
  let guard = 20;
  while (manager.getCurrent?.() && guard-- > 0) manager.advance();
  assert.equal(
    run.messages.filter((message) => message === 'The mourner drops a key as he dies.').length,
    1
  );
  assert.equal(run.items.get(I.KEY_2), undefined, 'the message does not duplicate the guaranteed drop');
});

test('Guidor revelation line advances stage 14; opening or blessing does not', () => {
  const cancelled = guidorReadyRun();
  assert.equal(cancelled.invoke.variant(N.GUIDOR), 'visiting-south-east-varrock-talking-to-guidor');
  assert.equal(cancelled.attributes.get(BIOHAZARD_STAGE), 12);
  openGuidorTranscript(cancelled);
  assert.equal(cancelled.attributes.get(BIOHAZARD_STAGE), 12, 'closing without a choice keeps stage 12');

  const blessed = guidorReadyRun();
  openGuidorTranscript(blessed, "I was just going to bless your room and I've done that now.");
  assert.equal(blessed.attributes.get(BIOHAZARD_STAGE), 12, 'blessing response keeps stage 12');

  const revealed = guidorReadyRun();
  openGuidorTranscript(revealed, "I've come to ask your assistance in stopping a plague.");
  assert.ok(revealed.lineEvents.some((event) => /This result can only mean one thing/.test(event.text)),
    JSON.stringify(revealed.lineEvents.map((event) => event.text)));
  assert.equal(revealed.attributes.get(BIOHAZARD_STAGE), 14, 'canonical revelation advances to 14');
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE, I.TOUCH_PAPER]) {
    assert.equal(revealed.items.get(itemId), undefined, `Guidor consumes reagent ${itemId} on analysis`);
  }
  revealed.invoke.line(N.GUIDOR, 'This result can only mean one thing... there is no plague.');
  assert.equal(revealed.attributes.get(BIOHAZARD_STAGE), 14, 'revelation advance is idempotent');

  const otherNpc = guidorReadyRun();
  otherNpc.invoke.line(N.ELENA_2, 'This result can only mean one thing... there is no plague.');
  assert.equal(otherNpc.attributes.get(BIOHAZARD_STAGE), 12, 'the line is Guidor-only');

  const otherPage = guidorReadyRun();
  otherPage.invoke.line(
    N.GUIDOR,
    'This result can only mean one thing... there is no plague.',
    [{ page: 'Plague City' }]
  );
  assert.equal(otherPage.attributes.get(BIOHAZARD_STAGE), 12, 'the line is Biohazard-page-only');

  const earlyStage = guidorReadyRun();
  earlyStage.attributes.set(BIOHAZARD_STAGE, 10);
  earlyStage.invoke.line(N.GUIDOR, 'This result can only mean one thing... there is no plague.');
  assert.equal(earlyStage.attributes.get(BIOHAZARD_STAGE), 10, 'neighbouring pre-Guidor stage does not advance');

  const missingItem = guidorReadyRun();
  missingItem.items.delete(I.TOUCH_PAPER);
  missingItem.invoke.line(N.GUIDOR, 'This result can only mean one thing... there is no plague.');
  assert.equal(missingItem.attributes.get(BIOHAZARD_STAGE), 12, 'missing touch paper blocks the advance');
});

test('canonical handout messages render exactly once after a successful grant', () => {
  for (const handout of HANDOUTS) {
    const run = setup({ stage: handout.stage, completed: ['plague_city'] });
    const before = run.messages.length;
    assert.equal(runCanonicalHandout(run, handout), true, handout.name);
    for (const itemId of handout.expected) assert.equal(run.items.get(itemId), 1, `${handout.name} item ${itemId}`);
    const receiptIndexes = run.messages
      .map((message, index) => [message, index])
      .filter(([message]) => message === handout.text)
      .map(([, index]) => index);
    assert.equal(receiptIndexes.length, 1, `${handout.name} canonical message once`);
    assert.equal(run.messageSources[receiptIndexes[0]], 'runner', `${handout.name} receipt comes from transcript runner`);
    assert.equal(run.messages.length, before + 1, `${handout.name} emits only the canonical receipt`);
  }
});

test('capacity-blocked handout messages are not emitted falsely', () => {
  for (const handout of HANDOUTS) {
    const run = setup({ stage: handout.stage, completed: ['plague_city'], freeSlots: 0 });
    const before = run.messages.length;
    assert.equal(runCanonicalHandout(run, handout), true, handout.name);
    for (const itemId of handout.expected) assert.equal(run.items.get(itemId), undefined, `${handout.name} item blocked`);
    assert.ok(!run.messages.some((message) => message === handout.text), `${handout.name} receipt suppressed`);
    for (const message of run.messages.slice(before)) {
      assert.equal(message, ELENA_CAPACITY_REFUSAL, `${handout.name} only the imported capacity refusal is shown`);
    }
  }
});

test('Elena partial-capacity handouts refuse canonically and retry after freeing space', () => {
  const refusal = ELENA_CAPACITY_REFUSAL;
  const vpxjql = HANDOUTS.find((handout) => handout.name === 'Vpxjql');
  const elenaItems = [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE];

  const stage10 = setup({ stage: 10, completed: ['plague_city'], freeSlots: 2 });
  assert.equal(runCanonicalHandout(stage10, vpxjql), true);
  for (const itemId of elenaItems) assert.equal(stage10.items.get(itemId), undefined, `stage 10 refuses ${itemId}`);
  assert.equal(stage10.messages.filter((message) => message === refusal).length, 1);
  assert.ok(!stage10.messages.includes(vpxjql.text), 'stage 10 does not claim delivery');
  stage10.setFreeSlots(4);
  assert.equal(runCanonicalHandout(stage10, vpxjql), true);
  for (const itemId of elenaItems) assert.equal(stage10.items.get(itemId), 1, `stage 10 retry grants ${itemId}`);
  assert.equal(stage10.messages.filter((message) => message === vpxjql.text).length, 1);
  assert.equal(stage10.messages.filter((message) => message === refusal).length, 1);

  const variant = 'delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist';
  const lostText = "I'm afraid I've lost some of the stuff that you gave me...";
  const stage12 = setup({ stage: 12, completed: ['plague_city'], freeSlots: 2 });
  runVariantWithChoice(stage12, N.ELENA_2, variant, lostText);
  for (const itemId of elenaItems) assert.equal(stage12.items.get(itemId), undefined, `stage 12 refuses ${itemId}`);
  assert.equal(stage12.messages.filter((message) => message === refusal).length, 1);
  assert.ok(!stage12.messages.includes('Elena replaces your lost items.'), 'stage 12 does not claim delivery');
  stage12.setFreeSlots(4);
  runVariantWithChoice(stage12, N.ELENA_2, variant, lostText);
  for (const itemId of elenaItems) assert.equal(stage12.items.get(itemId), 1, `stage 12 retry grants ${itemId}`);
  assert.equal(stage12.messages.filter((message) => message === 'Elena replaces your lost items.').length, 1);
  assert.equal(stage12.messages.filter((message) => message === refusal).length, 1);
});

test('Elena lost-item recovery follows the canonical all-items and missing-items branches', () => {
  const lostText = "I'm afraid I've lost some of the stuff that you gave me...";
  const variant = 'delivering-the-samples-talking-to-elena-again-before-visiting-the-chemist';

  const allItems = setup({ stage: 12, completed: ['plague_city'] });
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    allItems.items.set(itemId, 1);
  }
  runVariantWithChoice(allItems, N.ELENA_2, variant, lostText);
  assert.equal(allItems.items.get(I.TOUCH_PAPER), undefined, 'Elena recovery never grants touch paper');
  assert.ok(
    !allItems.messages.some((message) => /replaces your lost items/.test(message)),
    'the all-items branch ends on its canonical line, not a copied message'
  );
  assert.equal(allItems.messages.length, 0, 'the all-items branch emits no system message');

  const missingItems = setup({ stage: 12, completed: ['plague_city'] });
  missingItems.items.set(I.PLAGUE_SAMPLE, 1);
  runVariantWithChoice(missingItems, N.ELENA_2, variant, lostText);
  for (const itemId of [I.PLAGUE_SAMPLE, I.ETHENEA, I.LIQUID_HONEY, I.SULPHURIC_BROLINE]) {
    assert.equal(missingItems.items.get(itemId), 1, `Elena grants ${itemId}`);
  }
  assert.equal(missingItems.items.get(I.TOUCH_PAPER), undefined);
  assert.equal(
    missingItems.messages.filter((message) => message === 'Elena replaces your lost items.').length,
    1,
    'the canonical replacement message renders once'
  );
  assert.equal(
    missingItems.messageSources[missingItems.messages.indexOf('Elena replaces your lost items.')],
    'runner'
  );
});

test('Biohazard only gives the free priest gown once', () => {
  const run = setup({ stage: 12, completed: ['plague_city'] });
  run.invoke.action(N.ASYFF, 'K6WP1U');
  assert.equal(run.items.get(I.PRIEST_GOWN), 1);
  assert.equal(run.items.get(I.PRIEST_GOWN_3), 1);
  assert.equal(run.invoke.variant(N.ASYFF), null);
  run.invoke.action(N.ASYFF, 'K6WP1U');
  assert.equal(run.items.get(I.PRIEST_GOWN), 1);
  assert.equal(run.items.get(I.PRIEST_GOWN_3), 1);
});

test('Asyff is shared with Eagles\' Peak and yields while its costume is outstanding', () => {
  const index = require('../data/definitions/npc-dialogue-index.json');
  assert.ok(
    index['2887'].some((entry) => entry.page === "Transcript:Eagles' Peak" && entry.variants.includes('getting-a-bird-costume')),
    "the Eagles' Peak costume conversation is indexed for Asyff"
  );

  // Met Nikolaus (4) and disguise made (5): the eagle costume (or a spare) is
  // still outstanding, so Eagles' Peak owns Asyff.
  for (const stage of [4, 5]) {
    const run = setup({ stage: 12, completed: ['plague_city'] });
    run.setQuestStage('eagles_peak', stage);
    assert.equal(
      run.invoke.variant(N.ASYFF),
      null,
      `Eagles' Peak stage ${stage} keeps Asyff for its own conversation`
    );
    assert.ok(
      run.questRequests.some((request) => request.key === 'eagles_peak' && request.stage),
      "Biohazard asks the shared quest registry for Eagles' Peak's stage"
    );
  }

  // The costume is obtained (6) or Eagles' Peak was never started: Biohazard
  // may take Asyff for the free priest gown.
  for (const stage of [0, 6, 7, 8]) {
    const run = setup({ stage: 12, completed: ['plague_city'] });
    run.setQuestStage('eagles_peak', stage);
    assert.equal(
      run.invoke.variant(N.ASYFF),
      'visiting-south-east-varrock-talking-to-asyff',
      `Eagles' Peak stage ${stage} leaves Asyff to Biohazard`
    );
  }

  // Outside the gown window Biohazard does not claim Asyff at all.
  const early = setup({ stage: 10, completed: ['plague_city'] });
  assert.equal(early.invoke.variant(N.ASYFF), null);
});

test('the Combat Training Camp stays locked until Biohazard is complete', () => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const refusal = 'standard-dialogue-attempting-to-enter-the-camp-before-biohazard';
  assert.ok(dialogues['Guard (Combat Training Camp)'].variants[refusal], 'the refusal is imported');

  const before = setup({ stage: 12, completed: ['plague_city'] });
  for (const npcId of [1111, 1112, 1113]) {
    assert.equal(before.invoke.variant(npcId), refusal, `camp guard ${npcId} refuses entry`);
  }

  const after = setup({ stage: 16, completed: ['plague_city'] });
  for (const npcId of [1111, 1112, 1113]) {
    assert.equal(after.invoke.variant(npcId), null, `camp guard ${npcId} lets the player in`);
  }

  // The camp entrance gate is locked until the quest is done.
  const gate = before.invoke.doorToggle({ objectId: 2039, location: new Location(2517, 3356, 0) });
  assert.equal(gate.handled, true);
  assert.equal(before.messages.at(-1), 'The gates are locked.');
  assert.equal(
    before.invoke.doorToggle({ objectId: 2041, location: new Location(2518, 3356, 0) }).handled,
    true
  );
  assert.equal(
    after.invoke.doorToggle({ objectId: 2039, location: new Location(2517, 3356, 0) }).handled,
    false,
    'the gate opens once Biohazard is complete'
  );
  assert.equal(
    before.invoke.doorToggle({ objectId: 2039, location: new Location(2517, 3356, 1) }).handled,
    false,
    'an unrelated placement of the gate id is untouched'
  );
});

test('the camp guard refusal renders the canonical transcript', async () => {
  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const run = setup({ stage: 12, completed: ['plague_city'] });
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const runtime = require('../plugins/quests/QuestRuntime');
  const manager = new DialogueManager(run.player);
  run.player.getDialogueManager = () => manager;
  assert.equal(
    runtime.startTranscript(
      run.api,
      run.player,
      1111,
      'Guard (Combat Training Camp)',
      'standard-dialogue-attempting-to-enter-the-camp-before-biohazard'
    ),
    true
  );
  let guard = 50;
  while (manager.getCurrent?.() && guard-- > 0) manager.advance();
  assert.equal(
    run.messages.filter((message) => message === 'The gates are locked.').length,
    1,
    'the canonical locked-gate message renders once'
  );
});
