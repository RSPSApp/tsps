// From server/: node --test tests/qh-f2p-basics-parity.test.cjs
// QH f2p-basics: Cook's Assistant, Doric's Quest, Sheep Shearer, Imp Catcher.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const transcripts = require(root + '/data/definitions/npc-dialogues.json');
const noop = () => {};

before(async () => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader');
  await CachePipeline.initialize(root);
  new NpcDefinitionLoader().load();
});

function player(items = [], attrs = [], skillLevel = 99) {
  const attributes = new Map(attrs), inventory = new Map(items);
  const packet = new Proxy({
    sendInterfaceRemoval() { p.manager?.reset(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const p = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: id => inventory.get(id) ?? 0,
      contains: id => inventory.has(id),
      isFull: () => false,
      getFreeSlots: () => 28,
      getItems: () => [],
      getValidItems: () => [],
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    }),
    getEquipment: () => ({ get: () => null, getAmount: () => 0 }),
    getSkillManager: () => ({
      getCurrentLevel: () => skillLevel,
      getMaxLevel: () => 99,
      getCombatLevel: () => 3,
      addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => packet,
    getLocation: () => new core.Location(3210, 3220),
    getBanks: () => [],
    getUsername: () => 'QH basics',
    getUpdateFlag: () => ({ flag: noop }),
    messages: [],
    xp: [],
    sendMessage(message) { p.messages.push(message); },
    performAnimation: noop,
    items: inventory,
    attrs: attributes,
  };
  return p;
}

function questHarness(name) {
  const hooks = {};
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: noop, cancelTasks: noop } },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (hooks[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (hooks[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
  }, { get: (target, key) => target[key] ?? ((...args) => {
    if (key === 'onObjectInteraction') {
      (hooks[key] ??= []).push(args[1]);
      return;
    }
    (hooks[key] ??= []).push(args.find(arg => typeof arg === 'function'));
  }) });
  require(root + '/plugins/quests/quests/' + name + '.Quest')(api);
  const { getRegisteredQuests } = require(root + '/plugins/quests/QuestRuntime');
  return { api, hooks, quest: getRegisteredQuests().at(-1) };
}

function dialoguePlayer(items, attrs) {
  const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
  const p = player(items, attrs);
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  return p;
}
function capacityPlayer() {
  const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
  const { Inventory } = require(root + '/dist/game/model/container/impl/Inventory');
  const p = player();
  const inventory = new Inventory(p);
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(core.ItemIdentifiers.BUCKET, 1));
  p.getInventory = () => inventory;
  p.inventory = inventory;
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  return p;
}

function withConditions(hooks, fn) {
  const { PluginManager } = require(root + '/dist/plugins/PluginManager');
  const original = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = event => {
    for (const handler of hooks.onNpcDialogueCondition ?? []) {
      const answer = handler(event);
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  try {
    return fn();
  } finally {
    PluginManager.emitNpcDialogueCondition = original;
  }
}

function continueToMenu(p) {
  for (let step = 0; step < 400; step++) {
    if (p.prompt) return;
    if (!p.manager.getCurrent()) return;
    p.manager.advance();
  }
  throw new Error('dialogue did not reach a menu');
}

function choose(p, text) {
  const prompt = p.prompt;
  assert.ok(prompt, 'no menu for ' + text);
  const index = prompt.options.findIndex(option => option === text);
  assert.ok(index >= 0, 'missing ' + text + ' in ' + JSON.stringify(prompt.options));
  p.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

function conditionText(page, stepId) {
  let result;
  (function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'condition' && value.id === stepId) result = value.text;
    Object.values(value).forEach(visit);
  })(transcripts[page]);
  assert.ok(result, page + ' condition ' + stepId);
  return result;
}

test('shearing changes each sheep into the same-colour sheared gameval npc', () => {
  const { CacheDefinitions } = require(root + '/dist/game/cache/CacheDefinitions');
  // The client gamevals are the authoritative unsheared/sheared pairs.
  const gameval = fs.readFileSync(path.resolve(__dirname, '../../client/runelite/api/gameval/NpcID.ts'), 'utf8');
  const ids = new Map([...gameval.matchAll(/^export const (\w+) = (\d+);$/gm)].map(match => [match[1], Number(match[2])]));
  const pairs = [['SHEEPUNSHEERED', 'SHEEPSHEERED'], ['SHEEPUNSHEEREDG', 'SHEEPSHEEREDG'],
    ['SHEEPUNSHEEREDW', 'SHEEPSHEEREDW'], ['SHEEPUNSHEERED2', 'SHEEPSHEERED2'],
    ['SHEEPUNSHEERED2G', 'SHEEPSHEERED2G'], ['SHEEPUNSHEERED2W', 'SHEEPSHEERED2W'],
    ['SHEEPUNSHEERED3', 'SHEEPSHEERED3'], ['SHEEPUNSHEERED3G', 'SHEEPSHEERED3G'],
    ['SHEEPUNSHEERED3W', 'SHEEPSHEERED3W'], ['SHEEPUNSHEEREDSHAGGY', 'SHEEPSHEEREDSHAGGY'],
    ['SHEEPUNSHEEREDSHAGGY2', 'SHEEPSHEEREDSHAGGY2']];

  const { hooks } = questHarness('SheepShearer');
  const shear = hooks.onNpcInteraction[0];
  const I = core.ItemIdentifiers;
  for (const [unshearedName, shearedName] of pairs) {
    const unshearedId = ids.get(unshearedName), shearedId = ids.get(shearedName);
    assert.ok(unshearedId && shearedId, unshearedName + '/' + shearedName);
    assert.ok(CacheDefinitions.getNpc(unshearedId).actions.includes('Shear'), unshearedName + ' is shearable');
    assert.ok(!CacheDefinitions.getNpc(shearedId).actions.includes('Shear'), shearedName + ' is sheared');

    const p = player([[I.SHEARS, 1]]);
    const transforms = [];
    const npc = { getDefinition: () => ({ getId: () => unshearedId }), setNpcTransformationId: id => transforms.push(id), isRegistered: () => true };
    const event = { player: p, npc, npcId: unshearedId, clickType: 1, definition: { getActions: () => ['Shear'] } };
    shear(event);
    assert.equal(event.handled, true);
    assert.equal(p.items.get(I.WOOL), 1);
    assert.deepEqual(transforms, [shearedId], unshearedName + ' -> ' + shearedName);
  }
});

test('Sheep Shearer fills the remaining-wool blanks through the real partial hand-in dialogue', () => {
  const runtime = require(root + '/plugins/quests/QuestRuntime');
  const { api, quest } = questHarness('SheepShearer');
  const p = dialoguePlayer([[core.ItemIdentifiers.BALL_OF_WOOL, 5]]);
  quest.setStage(p, 8);

  runtime.startTranscript(api, p, core.NpcIdentifiers.FRED_THE_FARMER,
    'Sheep Shearer', 'handing-in-any-balls-of-wool');
  const texts = [];
  for (let step = 0; step < 80 && p.manager.getCurrent(); step++) {
    const current = p.manager.getCurrent();
    if (typeof current?.getText === 'function') texts.push(current.getText());
    p.manager.advance();
  }
  assert.equal(quest.getStage(p), 13);
  assert.equal(p.items.get(core.ItemIdentifiers.BALL_OF_WOOL), 0);
  assert.ok(texts.includes('I have some.'));
  assert.ok(texts.includes('I need 8 more before I can pay you.'), JSON.stringify(texts));
  assert.ok(!texts.some(text => text.includes('[1-19]')), JSON.stringify(texts));
});

test('Sheep does not start when Fred cannot hand over shears on a full inventory', () => {
  const runtime = require(root + '/plugins/quests/QuestRuntime');
  const { api, hooks, quest } = questHarness('SheepShearer');
  const I = core.ItemIdentifiers;
  withConditions(hooks, () => {
    const p = capacityPlayer();
    const start = () => {
      const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: core.NpcIdentifiers.FRED_THE_FARMER })).find(Boolean);
      assert.ok(choice);
      runtime.startTranscript(api, p, core.NpcIdentifiers.FRED_THE_FARMER, choice.page, choice.variant);
      continueToMenu(p);
      choose(p, "I'm looking for a quest.");
      continueToMenu(p);
      choose(p, 'Yes.');
      continueToMenu(p);
    };
    start();
    assert.equal(quest.getStage(p), 0, 'full inventory must not commit the start');
    assert.equal(p.inventory.getAmount(I.SHEARS), 0);
    assert.ok(p.messages.some(message => /couldn't hold|Not enough space|free inventory slot/i.test(message)));

    p.prompt = null;
    p.manager.reset();
    p.inventory.setItem(27, new core.Item(-1, 0));
    start();
    assert.equal(quest.getStage(p), 1);
    assert.equal(p.inventory.getAmount(I.SHEARS), 1);
  });
});

test('Doric starts from the shipped Talk-to and anvil-refusal graphs', () => {
  const runtime = require(root + '/plugins/quests/QuestRuntime');
  const { PluginManager } = require(root + '/dist/plugins/PluginManager');
  const originalCondition = PluginManager.emitNpcDialogueCondition;
  const { api, hooks, quest } = questHarness('DoricsQuest');
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  try {
    const talk = dialoguePlayer();
    const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: talk, npcId: core.NpcIdentifiers.DORIC })).find(Boolean);
    assert.ok(choice);
    runtime.startTranscript(api, talk, core.NpcIdentifiers.DORIC, choice.page, choice.variant);
    continueToMenu(talk);
    choose(talk, 'I wanted to use your anvils.');
    continueToMenu(talk);
    choose(talk, 'Yes.');
    continueToMenu(talk);
    assert.equal(quest.getStage(talk), 10);
    assert.equal(talk.items.get(core.ItemIdentifiers.BRONZE_PICKAXE), 1);
    assert.ok(talk.prompt.options.includes('Where can I find those?'));

    const anvil = dialoguePlayer();
    const object = new core.GameObject(2031, new core.Location(2952, 3452, 0));
    const event = { player: anvil, objectId: 2031, object };
    hooks.onObjectInteraction.find(actions => actions.Smith).Smith(event);
    assert.equal(event.handled, true);
    assert.equal(event.denied, true);
    continueToMenu(anvil);
    choose(anvil, 'Sorry, would it be OK if I used your anvils?');
    continueToMenu(anvil);
    choose(anvil, 'Yes, I will get you materials.');
    continueToMenu(anvil);
    assert.equal(quest.getStage(anvil), 10);
    assert.equal(anvil.items.get(core.ItemIdentifiers.BRONZE_PICKAXE), 1);
    assert.ok(anvil.messages.some(message => message.includes("started a new quest")));
    assert.ok(anvil.prompt.options.includes('Where can I find those?'));

    const fast = dialoguePlayer([[core.ItemIdentifiers.CLAY, 6], [core.ItemIdentifiers.COPPER_ORE, 4], [core.ItemIdentifiers.IRON_ORE, 2]]);
    const fastEvent = { player: fast, objectId: 2031, object: new core.GameObject(2031, new core.Location(2952, 3452, 0)) };
    hooks.onObjectInteraction.find(actions => actions.Smith).Smith(fastEvent);
    continueToMenu(fast);
    choose(fast, 'Sorry, would it be OK if I used your anvils?');
    continueToMenu(fast);
    choose(fast, 'Yes, I will get you materials.');
    for (let step = 0; step < 400 && quest.getStage(fast) !== 100; step++) {
      assert.ok(fast.manager.getCurrent(), 'fast anvil route ended early');
      fast.manager.advance();
    }
    assert.equal(quest.getStage(fast), 100);
    assert.equal(fast.items.get(core.ItemIdentifiers.COINS), 180);
    assert.equal(fast.items.get(core.ItemIdentifiers.CLAY), 0);
    assert.deepEqual(fast.xp, [[core.Skill.MINING.getIndex(), 1300]]);
  } finally {
    PluginManager.emitNpcDialogueCondition = originalCondition;
  }
});

test('Doric does not start when the pickaxe handout cannot fit on a full inventory', () => {
  const runtime = require(root + '/plugins/quests/QuestRuntime');
  const { api, hooks, quest } = questHarness('DoricsQuest');
  const I = core.ItemIdentifiers;
  withConditions(hooks, () => {
    const p = capacityPlayer();
    const start = () => {
      const choice = hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: core.NpcIdentifiers.DORIC })).find(Boolean);
      assert.ok(choice);
      runtime.startTranscript(api, p, core.NpcIdentifiers.DORIC, choice.page, choice.variant);
      continueToMenu(p);
      choose(p, 'I wanted to use your anvils.');
      continueToMenu(p);
      choose(p, 'Yes.');
      continueToMenu(p);
    };
    start();
    assert.equal(quest.getStage(p), 0, 'full inventory must not commit the start');
    assert.equal(p.inventory.getAmount(I.BRONZE_PICKAXE), 0);
    assert.ok(p.messages.some(message => /couldn't hold|Not enough space/i.test(message)));

    p.prompt = null;
    p.manager.reset();
    p.inventory.setItem(27, new core.Item(-1, 0));
    start();
    assert.equal(quest.getStage(p), 10);
    assert.equal(p.inventory.getAmount(I.BRONZE_PICKAXE), 1);
  });
});

test('the full quest registry dispatches the f2p-basics variants and conditions to their quests', () => {
  const conditions = [], variants = [];
  let registering = '';
  const api = new Proxy({ core,
    onNpcDialogueCondition(fn) { conditions.push({ quest: registering, fn }); },
    onNpcDialogueVariant(fn) { variants.push({ quest: registering, fn }); },
    onCustomEvent: noop,
    emitCustomEvent: noop,
    getWorld: () => core.World,
  }, { get: (target, key) => target[key] ?? noop });
  const Tutorial = require(root + '/plugins/areas/tutorialisland/Common.TutorialIsland');
  Tutorial.init(api);
  require(root + '/plugins/areas/tutorialisland/Instructors.TutorialIsland')(api);
  for (const quest of require(root + '/plugins/quests/Quests.plugin').QUESTS) {
    registering = quest;
    require(root + '/plugins/quests/quests/' + quest + '.Quest')(api);
  }
  const resolve = (page, stepId, npcId, p) => {
    const request = { player: p, npcId, stepId, text: conditionText(page, stepId), pages: [{ page, variants: [] }] };
    for (const condition of conditions) {
      let answer;
      try {
        answer = condition.fn(request);
      } catch {
        continue;
      }
      if (typeof answer === 'boolean') return { quest: condition.quest, answer };
    }
    return { quest: null, answer: null };
  };
  const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
  const allIngredients = [[I.BUCKET_OF_MILK, 1], [I.EGG, 1], [I.POT_OF_FLOUR, 1]];
  const allBeads = [[I.RED_BEAD, 1], [I.BLACK_BEAD, 1], [I.WHITE_BEAD, 1], [I.YELLOW_BEAD, 1]];
  const allMaterials = [[I.CLAY, 6], [I.COPPER_ORE, 4], [I.IRON_ORE, 2]];

  const cases = [
    ["Cook's Assistant", 'vci6DY', N.COOK_7, player(), ['CooksAssistant', false]],
    ["Cook's Assistant", 'QDPNgE', N.COOK_7, player(), ['CooksAssistant', true]],
    ["Cook's Assistant", 'YUVvh3', N.COOK_7, player([], [['cooks-assistant:delivered-ingredients', 1]]), ['CooksAssistant', true]],
    ["Cook's Assistant", 'YUVvh3', N.COOK_7, player([[I.EGG, 1]], [['cooks-assistant:delivered-ingredients', 1]]), ['CooksAssistant', false]],
    ["Cook's Assistant", 'ZJGbmd', N.COOK_7, player([[I.EGG, 1]]), ['CooksAssistant', true]],
    ["Cook's Assistant", 'OYHTNa', N.COOK_7, player([[I.EGG, 1]]), ['CooksAssistant', true]],
    ["Cook's Assistant", '_FB4HO', N.COOK_7, player(allIngredients), ['CooksAssistant', true]],
    ["Cook's Assistant", '_FB4HO', N.COOK_7, player([[I.EGG, 1]]), ['CooksAssistant', false]],
    ["Doric's Quest", 'aaa-pe', N.DORIC, player(), ['DoricsQuest', true]],
    ["Doric's Quest", 'qv9cGD', N.DORIC, player(allMaterials), ['DoricsQuest', true]],
    ["Doric's Quest", 'FgVDzP', N.DORIC, player(allMaterials), ['DoricsQuest', true]],
    ["Doric's Quest", 'FgVDzP', N.DORIC, player([...allMaterials, [I.CLAY, 1]]), ['DoricsQuest', false]],
    ["Doric's Quest", '8Tgk_i', N.DORIC, player([], [], 10), ['DoricsQuest', true]],
    ["Doric's Quest", '8Tgk_i', N.DORIC, player([], [], 15), ['DoricsQuest', false]],
    ['Imp Catcher', '4IIsgs', 5005, player(allBeads), ['ImpCatcher', true]],
    ['Imp Catcher', 'UpevmT', 5005, player(), ['ImpCatcher', true]],
    ['Wizard Mizgog', '1d3gWH', N.WIZARD_MIZGOG, player(allBeads), ['ImpCatcher', true]],
    ['Wizard Mizgog', 'Ss41sr', N.WIZARD_MIZGOG, player(), ['ImpCatcher', true]],
    ['Sheep Shearer', 'br3A1e', N.FRED_THE_FARMER, player(), ['SheepShearer', false]],
    ['Sheep Shearer', 'JlC38d', N.FRED_THE_FARMER, player([[I.BALL_OF_WOOL, 20]]), ['SheepShearer', true]],
    ['Sheep Shearer', 'HK3p0J', N.FRED_THE_FARMER, player(), ['SheepShearer', true]],
    ['Sheep Shearer', '4-ne12', N.FRED_THE_FARMER, player([[I.SHEARS, 1]]), ['SheepShearer', true]],
  ];
  for (const [page, stepId, npcId, p, [quest, answer]] of cases) {
    assert.deepEqual(resolve(page, stepId, npcId, p), { quest, answer }, page + ' ' + stepId);
  }

  const variant = (npcId, p) => {
    const request = { player: p, npcId };
    for (const entry of variants) {
      let result;
      try {
        result = entry.fn(request);
      } catch {
        continue;
      }
      if (result) return { quest: entry.quest, result };
    }
    return null;
  };
  const stage = (key, value) => player([], [['quest.' + key + '.stage', value]]);
  const expects = [
    [N.COOK_7, stage('cooks_assistant', 0), 'CooksAssistant', 'starting-off'],
    [N.COOK_7, stage('cooks_assistant', 1), 'CooksAssistant', 'talking-to-the-cook-again'],
    [N.COOK_7, stage('cooks_assistant', 2), 'CooksAssistant', 'standard-dialogue-after-cook-s-assistant'],
    [N.DORIC, stage('dorics_quest', 0), 'DoricsQuest', { page: "Doric's Quest", variant: 'starting-off' }],
    [N.DORIC, stage('dorics_quest', 10), 'DoricsQuest', { page: "Doric's Quest", variant: 'starting-off-talking-to-doric-without-all-of-the-materials' }],
    [N.DORIC, stage('dorics_quest', 100), 'DoricsQuest', { page: 'Doric', variant: 'after-doric-s-quest' }],
    [N.FRED_THE_FARMER, stage('sheep_shearer', 0), 'SheepShearer', { page: 'Sheep Shearer', variant: 'starting-off' }],
    [N.FRED_THE_FARMER, stage('sheep_shearer', 1), 'SheepShearer', { page: 'Sheep Shearer', variant: 'starting-off-before-delivering-any-balls-of-wool' }],
    [N.FRED_THE_FARMER, stage('sheep_shearer', 21), 'SheepShearer', { page: 'Fred the Farmer', variant: 'after-sheep-shearer' }],
    [5005, stage('imp_catcher', 0), 'ImpCatcher', { page: 'Imp Catcher', variant: 'starting-out-talking-to-wizard-mizgog' }],
    [N.WIZARD_MIZGOG, stage('imp_catcher', 1), 'ImpCatcher', { page: 'Imp Catcher', variant: 'finding-the-beads-speaking-to-wizard-mizgog-with-no-beads' }],
    [N.WIZARD_MIZGOG, stage('imp_catcher', 2), 'ImpCatcher', { page: 'Wizard Mizgog', variant: 'after-imp-catcher' }],
    [N.WIZARD_GRAYZAG, stage('imp_catcher', 1), 'ImpCatcher', { page: 'Imp Catcher', variant: 'finding-the-beads-speaking-to-wizard-grayzag' }],
  ];
  for (const [npcId, p, quest, result] of expects) {
    assert.deepEqual(variant(npcId, p), { quest, result }, 'npc ' + npcId + ' variant');
  }
});
