// From server/: node --test tests/qh728-q094.test.cjs (after yarn build).
// Focused Recipe for Disaster contracts: fresh start through the banquet opening,
// all eight rescue hand-ins, the Culinaromancer finale, and the scoped fixes for
// the Amik token drop, Wise Old Man ownership, goblin slop recovery, the Awowogei
// snake pit, and Traiborn's lost-ingredient recovery.
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

// Register only the quests this audit reads instead of the whole Quests.plugin
// list, so an unrelated in-flight quest source cannot make this scoped test fail.
const TEST_QUEST_MODULES = [
  'RecipeForDisaster',
  'CooksAssistant', 'FishingContest', 'GoblinDiplomacy', 'BigChompyBirdHunting',
  'Biohazard', 'DemonSlayer', 'MurderMystery', 'NatureSpirit', 'WitchsHouse',
  'GertrudesCat', 'ShadowOfTheStorm', 'MonkeyMadnessI', 'FamilyCrest', 'HeroesQuest',
  'LostCity', 'MerlinsCrystal', 'ShieldOfArrav', 'DragonSlayer', 'ShiloVillage',
  'JunglePotion', 'DruidicRitual', 'UndergroundPass', 'PlagueCity', 'WaterfallQuest',
  'DesertTreasureI', 'HorrorFromTheDeep', 'LegendsQuest', 'OneSmallFavour',
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const equipment = new Map();
  const messages = [];
  const moves = [];
  const xp = new Map();
  const log = [];
  let full = false;
  let location = new core.Location(3209, 3215, 0);
  let area = null;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        messages.push('Not enough space in your inventory.');
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount, getDefinition: () => ({ getWeight: () => 0 }) })),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  const skillManager = {
    getCurrentLevel: skill => xp.get(`level:${skill}`) ?? 99,
    getMaxLevel: skill => xp.get(`level:${skill}`) ?? 99,
    getExperience: skill => xp.get(`xp:${skill}`) ?? 0,
    addExperience: (skill, amount) => xp.set(`xp:${skill}`, (xp.get(`xp:${skill}`) ?? 0) + amount),
    addExperiences: (skill, amount) => xp.set(`xp:${skill}`, (xp.get(`xp:${skill}`) ?? 0) + amount),
    setCurrentLevelCombat: (skill, value) => xp.set(`level:${skill}`, value),
  };
  return {
    attrs, items, equipment, messages, moves, log, xp,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: slot => {
      const id = equipment.get(slot);
      return id === undefined ? null : { getId: () => id };
    } }),
    getSkillManager: () => skillManager,
    getUsername: () => 'rfd-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    getArea: () => area,
    setArea: next => { area = next; },
    getPrayerActive: () => [],
    getAsPlayer() { return this; },
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    setRunEnergy: noop,
    setSpecialPercentage: noop,
    isRegistered: () => true,
    isPlayer: () => true,
  };
}

function harness() {
  const events = {}, variants = [], conditions = [], npcInteraction = [];
  const itemOnItem = [], itemOnNpc = [], itemOnObject = [];
  const objectInteraction = [], npcDeath = [], custom = {};
  const spawned = [], ground = [], transcripts = [], transcriptCalls = [];
  const coreApi = Object.create(core);
  Object.defineProperty(coreApi, 'Boundary', { value: class Boundary {
    constructor(...values) { this.values = values; }
  } });
  Object.defineProperty(coreApi, 'PrivateArea', { value: class PrivateArea {
    constructor(boundaries) { this.boundaries = boundaries; this.members = new Set(); this.destroyed = false; }
    enter(mobile) { this.members.add(mobile); mobile.setArea?.(this); }
    leave(mobile) { this.members.delete(mobile); mobile.setArea?.(null); if (!this.members.size) this.destroyed = true; }
    hasMember(mobile) { return this.members.has(mobile); }
    isDestroyed() { return this.destroyed; }
    getTemplateObjects() { return []; }
  } });
  Object.defineProperty(coreApi, 'ItemOnGroundManager', { value: class extends core.ItemOnGroundManager {
    static registerLocation(player, item, position) {
      const floorItem = super.registerLocation(player, item, position);
      ground.push([player, item, position, floorItem]);
      return floorItem;
    }
  } });
  Object.defineProperty(coreApi, 'PrayerHandler', { value: { deactivatePrayers: noop } });
  const api = new Proxy({
    core: coreApi,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onItemOnItem: handler => itemOnItem.push(handler),
    onItemOnNpc: handler => itemOnNpc.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onObjectInteraction: (...args) => objectInteraction.push(args),
    onNpcInteraction: (...args) => npcInteraction.push(args),
    onNpcDeath: handler => npcDeath.push(handler),
    onPlayerLogin: noop,
    onPlayerLogout: noop,
    onCustomEvent: (key, handler) => (custom[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (custom[key] ??= []).forEach(handler => handler(event)),
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    spawnNpc: definition => {
      let area = null;
      let transform = definition.id;
      const npc = {
        definition,
        getId: () => transform,
        getLocation: () => new coreApi.Location(definition.x ?? 1900, definition.y ?? 5355, definition.z ?? 0),
        getArea: () => area,
        setArea: next => { area = next; },
        setNpcTransformationId: id => { transform = id; },
        getCombat: () => ({ getLastAttack: () => ({ reset: noop }) }),
        getSize: () => 1,
        isNpc: () => true,
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    getItemOnGroundManager: () => ({ register: (...args) => ground.push(args) }),
  }, { get: (target, key) => target[key] ?? noop });
  const originalStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (...args) => {
    transcriptCalls.push(args);
    transcripts.push(args.slice(3, 5));
    return true;
  };
  for (const moduleName of TEST_QUEST_MODULES) {
    require(`../plugins/quests/quests/${moduleName}.Quest`)(api);
  }
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'recipe_for_disaster');
  return { api, core: coreApi, quest, events, variants, conditions, npcInteraction,
    itemOnItem, itemOnNpc, itemOnObject, objectInteraction, npcDeath, custom, spawned, ground,
    transcripts, transcriptCalls, realStartTranscript: originalStartTranscript,
    restoreTranscripts: () => {
      runtime.startTranscript = originalStartTranscript;
      for (const [, , , floorItem] of ground) {
        const index = core.World.getItems().indexOf(floorItem);
        if (index !== -1) core.World.getItems().splice(index, 1);
      }
    } };
}

function completeQuest(h, player, key) {
  const entry = runtime.getRegisteredQuests().findLast(quest => quest.key === key);
  assert.ok(entry, `missing prerequisite quest ${key}`);
  entry.setStage(player, entry.completionValue);
}

function custom(h, name) {
  return h.custom[name] ?? [];
}

function findStepById(steps, id, found = []) {
  for (const step of steps ?? []) {
    if (!step || typeof step !== 'object') continue;
    if (step.id === id) found.push(step);
    findStepById(step.steps, id, found);
    for (const option of step.options ?? []) findStepById(option.steps, id, found);
  }
  return found;
}

function importedVariant(h, page, variant) {
  return runtime.loadTranscripts(h.api)[page].variants[variant];
}

function importedConditionText(h, page, variant, stepId) {
  const node = findStepById(importedVariant(h, page, variant), stepId)[0];
  assert.ok(node, `${page}/${variant} condition ${stepId}`);
  return node.text;
}

function assertLatestVarbit(player, id, expected, message = '') {
  const writes = player.log.filter(([method, varbitId]) => method === 'sendVarbit' && varbitId === id);
  assert.ok(writes.length, `varbit ${id} was sent`);
  assert.equal(writes.at(-1)[2], expected, message || `varbit ${id}`);
}

// Registers real quest sources into the real PluginManager NPC-interaction hooks,
// matching production registration order. Only NPC hooks are needed for the
// Rantz ownership regression.
function registerRealNpcHooks(names) {
  const beforeInteraction = PluginManager.npcInteractionHooks.length;
  const beforeVariant = PluginManager.npcDialogueVariantHooks.length;
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return noop;
    if (key === 'onNpcDialogueVariant') return handler => PluginManager.npcDialogueVariantHooks.push({ pluginName: 'qh728-q094', handler });
    if (key === 'onNpcInteraction') return (...args) => {
      const [name, actions] = args;
      if (typeof name === 'function') {
        PluginManager.npcInteractionHooks.push({ pluginName: 'qh728-q094', handler: name });
        return;
      }
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.npcInteractionHooks.push({ pluginName: 'qh728-q094', handler: event => {
          if (event.handled || event.definition?.getName?.() !== name) return;
          if (event.definition.getActions?.()[event.clickType - 1] !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'spawnNpc') return definition => ({ definition, getId: () => definition.id, isRegistered: () => true });
    return () => noop;
  } });
  for (const name of names) require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { cleanup() {
    PluginManager.npcInteractionHooks.length = beforeInteraction;
    PluginManager.npcDialogueVariantHooks.length = beforeVariant;
  } };
}

function dialoguePlayer() {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const p = makePlayer();
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  const packet = new Proxy({
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => { p.log.push([String(key), ...args]); return packet; }) });
  p.getPacketSender = () => packet;
  return p;
}

function withHarnessConditions(h, fn) {
  const original = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = event => {
    for (const handler of h.conditions) {
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

function runRegisteredTranscript(h, player, npcId, handler, choice = 'Ask about helping the Lumbridge Guide.') {
  const choices = Array.isArray(choice) ? choice : [choice];
  const texts = [];
  runtime.startTranscript = (...args) => {
    h.transcriptCalls.push(args);
    return h.realStartTranscript(...args);
  };
  const event = { player, npcId, clickType: 1, definition: { getActions: () => ['Talk-to'] }, handled: false };
  assert.equal(handler(event), true);
  assert.equal(event.handled, true);
  withHarnessConditions(h, () => {
    for (let step = 0; step < 300 && (player.manager.getCurrent() || player.prompt); step++) {
      if (player.prompt) {
        const prompt = player.prompt;
        const wanted = choices.find(option => prompt.options.includes(option));
        assert.ok(wanted, `missing choice ${choices.join(' / ')} in ${JSON.stringify(prompt.options)} after ${JSON.stringify(texts)}`);
        const index = prompt.options.indexOf(wanted);
        player.prompt = null;
        prompt.pairs[index * 2 + 1]();
        continue;
      }
      const current = player.manager.getCurrent();
      const text = current?.getText?.();
      if (text) texts.push(text);
      player.manager.advance();
    }
  });
  return texts;
}

function runImportedVariant(h, player, npcId, page, variant, choices = []) {
  const handler = event => {
    assert.equal(runtime.startTranscript(h.api, event.player, npcId, page, variant), true,
      `imported transcript exists: ${page}/${variant}`);
    event.handled = true;
    return true;
  };
  return runRegisteredTranscript(h, player, npcId, handler, choices);
}

test('fresh stage 0 starts, makes the dirty blast and opens the banquet', () => {
  const h = harness();
  try {
    const p = makePlayer();
    completeQuest(h, p, 'cooks_assistant');
    assert.deepEqual(h.variants.find(handler => handler.name === 'selectVariant')({ player: p, npcId: core.NpcIdentifiers.COOK,
      pages: [{ page: "Recipe for Disaster/Another Cook's Quest" }] }),
    { page: "Recipe for Disaster/Another Cook's Quest", variant: 'starting-out' });

    custom(h, 'npc-dialogue:hook').forEach(handler => handler({ player: p, npcId: core.NpcIdentifiers.COOK,
      hook: 'quest:recipe-for-disaster:start' }));
    assert.equal(h.quest.getStage(p), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.COINS), 100);

    p.items.set(core.ItemIdentifiers.FRUIT_BLAST, 1);
    p.items.set(core.ItemIdentifiers.ASHES, 1);
    const dirty = { player: p, stepId: 'kMq9sJ', action: 'receive', handled: false };
    custom(h, 'npc-dialogue:action').forEach(handler => handler(dirty));
    assert.equal(dirty.handled, true);
    assert.equal(p.items.get(core.ItemIdentifiers.FRUIT_BLAST) ?? 0, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.ASHES) ?? 0, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.DIRTY_BLAST), 1);

    for (const id of [core.ItemIdentifiers.EYE_OF_NEWT, core.ItemIdentifiers.GREENMANS_ALE,
      core.ItemIdentifiers.ROTTEN_TOMATO, core.ItemIdentifiers.DIRTY_BLAST]) p.items.set(id, 1);
    const opening = { player: p, stepId: '5j7eiW', handled: false };
    custom(h, 'npc-dialogue:action').forEach(handler => handler(opening));
    assert.equal(h.quest.getStage(p), 4);
    assert.equal(p.attrs.get('quest.points'), 1);
    for (const id of [core.ItemIdentifiers.EYE_OF_NEWT, core.ItemIdentifiers.GREENMANS_ALE,
      core.ItemIdentifiers.ROTTEN_TOMATO, core.ItemIdentifiers.DIRTY_BLAST]) assert.equal(p.items.get(id) ?? 0, 0);
  } finally {
    h.restoreTranscripts();
  }
});

test('fresh RFD replay sends the incomplete main varbit value', () => {
  const h = harness();
  try {
    const p = makePlayer();
    runtime.sendQuestVarps({ player: p });
    assert.ok(p.log.some(([method, id, value]) => method === 'sendVarbit' && id === 1850 && value === 0),
      'fresh stage zero must not appear as completed to Quest Helper');
  } finally {
    h.restoreTranscripts();
  }
});

test('Mountain Dwarf QH milestones follow canonical accepted dialogue and replay', () => {
  const h = harness();
  try {
    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    completeQuest(h, p, 'fishing_contest');
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    assert.ok(sync);
    sync({ player: p });
    assertLatestVarbit(p, 1892, 0);

    const aris = h.npcInteraction.find(([target]) => typeof target === 'function'
      && target.name === 'handleArisInteraction')?.[0];
    assert.ok(aris);
    const arisLines = runRegisteredTranscript(h, p, core.NpcIdentifiers.ARIS_3, aris, 'Free the Mountain Dwarf');
    assert.ok(arisLines.some(text => text.includes('His fondness for rock cakes could prove key in')),
      JSON.stringify(arisLines));
    assertLatestVarbit(p, 1892, 10);

    p.items.set(core.ItemIdentifiers.CHOCOLATE_BAR, 1);
    p.items.set(core.ItemIdentifiers.COINS, 50);
    const dwarfTalk = h.npcInteraction.find(([target]) => typeof target === 'function'
      && target.name === 'handleDwarfNpc')?.[0];
    assert.ok(dwarfTalk);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.EMILY, dwarfTalk, [
      'What can you tell me about dwarves and ale?',
      'I could offer you some in return, how about 100 gold?',
      'Goodbye.',
    ]);
    assertLatestVarbit(p, 1892, 10, 'declining bartender barter leaves its milestone unchanged');
    h.api.emitCustomEvent('npc-dialogue:line', { player: p, npcId: core.NpcIdentifiers.EMILY,
      text: 'Mmmmm... the secret is in the gold. Drop a gold coin into asgarnian ale and you\'ll get this weird golden ale that the dwarves seem to love, I think they\'re genetically attracted to gold.' });
    assertLatestVarbit(p, 1892, 20);
    assertLatestVarbit(p, 1891, 1);

    p.setAttribute('recipe-for-disaster:dwarf-state', 16 | 4);
    const rohakEvent = { player: p, npcId: core.NpcIdentifiers.ROHAK, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    // Selecting Rohak's conversation alone cannot advance the helper before its canonical price line.
    const originalStartTranscript = runtime.startTranscript;
    runtime.startTranscript = () => true;
    assert.equal(dwarfTalk(rohakEvent), true);
    runtime.startTranscript = originalStartTranscript;
    assertLatestVarbit(p, 1892, 20);

    runRegisteredTranscript(h, p, core.NpcIdentifiers.ROHAK, dwarfTalk);
    assertLatestVarbit(p, 1892, 30);
    p.items.set(core.ItemIdentifiers.COINS, 100);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.ROHAK, dwarfTalk);
    assertLatestVarbit(p, 1892, 40);

    const action = custom(h, 'npc-dialogue:action').find(handler => handler.name === 'handleAction');
    action({ player: p, npcId: core.NpcIdentifiers.ROHAK, stepId: 'wpCexm', handled: false });
    assertLatestVarbit(p, 1892, 50);
    p.items.set(core.ItemIdentifiers.DWARVEN_ROCK_CAKE_2, 1);
    const handIn = h.itemOnNpc.find(handler => handler.name === 'rescueByItem');
    handIn({ player: p, npcId: core.NpcIdentifiers.MOUNTAIN_DWARF,
      itemId: core.ItemIdentifiers.DWARVEN_ROCK_CAKE_2, handled: false });
    assertLatestVarbit(p, 1892, 60);
    sync({ player: p });
    assertLatestVarbit(p, 1892, 60);
    assertLatestVarbit(p, 1893, 4);
  } finally {
    h.restoreTranscripts();
  }
});

test('Goblin rescue QH milestones follow canonical dialogue and action boundaries', () => {
  const h = harness();
  try {
    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    completeQuest(h, p, 'goblin_diplomacy');
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1867, 0);

    const aris = h.npcInteraction.find(([target]) => typeof target === 'function'
      && target.name === 'handleArisInteraction')?.[0];
    runRegisteredTranscript(h, p, core.NpcIdentifiers.ARIS_3, aris, 'Free the goblin generals');
    assertLatestVarbit(p, 1867, 5);

    const goblinCook = h.npcInteraction.find(([name, actions]) => name === 'Goblin Cook'
      && actions?.['Talk-to']?.name === 'handleGoblinCook')?.[1]?.['Talk-to'];
    assert.ok(goblinCook);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.GOBLIN_COOK, goblinCook,
      ['I need your help...', 'What do you need? Maybe I can get it for you.']);
    assertLatestVarbit(p, 1867, 10);

    p.items.set(core.ItemIdentifiers.CHARCOAL, 1);
    const action = custom(h, 'npc-dialogue:action').find(handler => handler.name === 'handleAction');
    action({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, stepId: 'aDep1a', handled: false });
    assertLatestVarbit(p, 1867, 15);
    assertLatestVarbit(p, 1868, 1);

    runRegisteredTranscript(h, p, core.NpcIdentifiers.GOBLIN_COOK_3, goblinCook, 'I need your help...');
    assertLatestVarbit(p, 1867, 30);
    sync({ player: p });
    assertLatestVarbit(p, 1867, 30, 'the accepted recipe milestone replays after bootstrap');

    p.items.set(core.ItemIdentifiers.DYED_ORANGE, 1);
    p.items.set(core.ItemIdentifiers.SOGGY_BREAD, 1);
    p.items.set(core.ItemIdentifiers.SPICY_MAGGOTS, 1);
    action({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK_3, stepId: 'n9iLpk', handled: false });
    assertLatestVarbit(p, 1867, 35);
    p.items.set(core.ItemIdentifiers.SLOP_OF_COMPROMISE, 1);
    const handIn = h.itemOnNpc.find(handler => handler.name === 'rescueByItem');
    handIn({ player: p, npcId: core.NpcIdentifiers.GENERAL_WARTFACE_5,
      itemId: core.ItemIdentifiers.SLOP_OF_COMPROMISE, handled: false });
    assertLatestVarbit(p, 1867, 40);
    sync({ player: p });
    assertLatestVarbit(p, 1867, 40);
  } finally {
    h.restoreTranscripts();
  }
});

test('Evil Dave QH milestones follow his canonical conversation and stew result', () => {
  const h = harness();
  try {
    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    completeQuest(h, p, 'gertrudes_cat');
    completeQuest(h, p, 'shadow_of_the_storm');
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1878, 0);

    const aris = h.npcInteraction.find(([target]) => typeof target === 'function'
      && target.name === 'handleArisInteraction')?.[0];
    runRegisteredTranscript(h, p, core.NpcIdentifiers.ARIS_3, aris, 'Free Evil Dave');
    assertLatestVarbit(p, 1878, 1);

    const daveTalk = h.npcInteraction.find(([target]) => typeof target === 'function'
      && target.name === 'handleDaveTalk')?.[0];
    assert.ok(daveTalk);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.EVIL_DAVE_3, daveTalk, 'See you later.');
    assertLatestVarbit(p, 1878, 1, 'closing the conversation before disclosure leaves the stage unchanged');
    custom(h, 'npc-dialogue:line').find(handler => handler.name === 'handleDaveMilestoneLine')({
      player: p, npcId: core.NpcIdentifiers.EVIL_DAVE_3,
      text: 'Well it tasted like the stews my mum makes. She puts these spices in them. But it was like she\'d got the amounts totally right this time.',
    });
    assertLatestVarbit(p, 1878, 2, 'only reaching the canonical recipe disclosure advances Dave');
    const recipe = p.getAttribute('recipe-for-disaster:evil-dave-recipe');
    assert.ok(recipe && ['red', 'yellow', 'brown', 'orange'].every(color => recipe[color] >= 1 && recipe[color] <= 3));

    const dorisTalk = h.npcInteraction.find(([name, actions]) => name === 'Doris'
      && actions?.['Talk-to']?.name === 'handleDorisTalk')?.[1]?.['Talk-to'];
    assert.ok(dorisTalk);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.DORIS, dorisTalk);
    assertLatestVarbit(p, 1878, 3, 'the accepted Doris hell-rat line advances Dave');

    p.setAttribute('recipe-for-disaster:evil-dave-stew', { doses: { ...recipe } });
    p.items.set(core.ItemIdentifiers.SPICY_STEW, 1);
    const taste = h.itemOnNpc.find(handler => handler.name === 'handleDaveStewTaste');
    assert.ok(taste);
    taste({ player: p, npcId: core.NpcIdentifiers.EVIL_DAVE_3,
      itemId: core.ItemIdentifiers.SPICY_STEW, handled: false });
    assertLatestVarbit(p, 1878, 4, 'a matching stew advances only after its imported taste dialogue starts');
    for (const [color, current, target] of [['red',1879,1883],['yellow',1880,1884],['brown',1881,1885],['orange',1882,1886]]) {
      assertLatestVarbit(p, current, recipe[color]);
      assertLatestVarbit(p, target, recipe[color]);
    }
    sync({ player: p });
    assertLatestVarbit(p, 1878, 4, 'Dave progress and recipe varbits replay after bootstrap');
  } finally {
    h.restoreTranscripts();
  }
});

test('Lumbridge Guide QH progress replays the accepted help, enchantment and cake states', () => {
  const h = harness();
  try {
    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1896, 0);

    const aris = (event) => {
      runtime.startTranscript(h.api, event.player, event.npcId,
        'Recipe for Disaster/Freeing the Lumbridge Guide', 'starting-out-inspecting-the-lumbridge-guide');
      event.handled = true;
      return true;
    };
    const guideLine = h.custom['npc-dialogue:line'].find(handler => handler.name === 'handleGuideMilestoneLine');
    guideLine({ player: p, npcId: core.NpcIdentifiers.ARIS_3, text: "Okay, thanks, I'll get right on it!",
      pages: [{ page: 'Recipe for Disaster/Freeing Mountain Dwarf', variants: ['starting-out'] }] });
    assertLatestVarbit(p, 1896, 0, 'the shared Aris line from another rescue does not advance the Guide');
    const arisLines = runRegisteredTranscript(h, p, core.NpcIdentifiers.ARIS_3, aris,
      "Yes, I'm sure I can make a cake.");
    assert.ok(arisLines.some(text => text.includes('speak with Traiborn')));
    assertLatestVarbit(p, 1896, 1);

    const traiborn = h.npcInteraction.find(([name, actions]) => name === 'Wizard Traiborn'
      && actions?.['Talk-to']?.name === 'handleTraiborn')?.[1]?.['Talk-to'];
    assert.ok(traiborn);
    const traibornLines = runRegisteredTranscript(h, p, core.NpcIdentifiers.WIZARD_TRAIBORN,
      traiborn, 'Ask about helping the Lumbridge Guide.');
    assert.ok(traibornLines.some(text => text.toLowerCase().replace(/\s+/g, ' ').includes('bring me the basic ingredients')));
    assertLatestVarbit(p, 1896, 2);

    // These legacy saved flags prove all three canonical enchantments were earned.
    p.setAttribute('recipe-for-disaster:guide-state', 7);
    sync({ player: p });
    assertLatestVarbit(p, 1896, 3);
    assertLatestVarbit(p, 1894, 1);
    assertLatestVarbit(p, 1897, 1);
    assertLatestVarbit(p, 1898, 1);

    p.items.set(core.ItemIdentifiers.RAW_GUIDE_CAKE, 1);
    const bake = h.itemOnObject.find(handler => handler.name === 'handleGuideRange');
    assert.ok(bake);
    bake({ player: p, itemId: core.ItemIdentifiers.RAW_GUIDE_CAKE,
      objectId: core.ObjectIdentifiers.COOKING_RANGE, handled: false });
    assertLatestVarbit(p, 1896, 4);
    assert.equal(p.items.get(core.ItemIdentifiers.CAKE_OF_GUIDANCE), 1);

    for (const key of ['big_chompy_bird_hunting', 'biohazard', 'demon_slayer', 'murder_mystery',
      'nature_spirit', 'witchs_house']) completeQuest(h, p, key);
    p.items.set(core.ItemIdentifiers.CAKE_OF_GUIDANCE, 1);
    const handIn = h.itemOnNpc.find(handler => handler.name === 'rescueByItem');
    handIn({ player: p, npcId: core.NpcIdentifiers.LUMBRIDGE_GUIDE_4,
      itemId: core.ItemIdentifiers.CAKE_OF_GUIDANCE, handled: false });
    assertLatestVarbit(p, 1896, 5);
    sync({ player: p });
    assertLatestVarbit(p, 1896, 5);
  } finally {
    h.restoreTranscripts();
  }
});

test('Pirate Pete QH stages and verified underwater varbits follow the rescue route', () => {
  const h = harness();
  const p = makePlayer();
  try {
    h.quest.setStage(p, 4);
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1895, 0);
    assertLatestVarbit(p, 1875, 0);

    const choice = custom(h, 'npc-dialogue:choice').find(handler => handler.name === 'handlePirateChoice');
    choice({ player: p, npcId: core.NpcIdentifiers.MURPHY, option: 'Talk about Recipe for Disaster.' });
    assertLatestVarbit(p, 1895, 10);
    custom(h, 'npc-dialogue:line').find(handler => handler.name === 'handlePirateMilestoneLine')({
      player: p, npcId: core.NpcIdentifiers.MURPHY,
      text: "In the meantime I'll wait, and if you want me to take you diving I'll be ready.",
    });
    assertLatestVarbit(p, 1895, 20);

    p.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    const action = custom(h, 'npc-dialogue:action').find(handler => handler.name === 'handleAction');
    action({ player: p, npcId: core.NpcIdentifiers.MURPHY, pages: [{ page: 'Recipe for Disaster/Freeing Pirate Pete' }],
      stepId: 'FY6rCP', handled: false });
    assertLatestVarbit(p, 1895, 30);

    p.equipment.set(core.Equipment.HEAD_SLOT, core.ItemIdentifiers.FISHBOWL_HELMET);
    p.equipment.set(core.Equipment.CAPE_SLOT, core.ItemIdentifiers.DIVING_APPARATUS);
    action({ player: p, npcId: core.NpcIdentifiers.MURPHY, stepId: 'azBBMr', handled: false });
    assertLatestVarbit(p, 1895, 40);
    assertLatestVarbit(p, 1872, 1);
    assertLatestVarbit(p, 1871, 1);

    const rocks = h.objectInteraction.find(([handler]) => handler.name === 'handlePirateObjects')?.[0];
    assert.ok(rocks);
    const rockEvent = { player: p, objectId: core.ObjectIdentifiers.PILE_OF_ROCK_5, clickType: 1,
      definition: { getActions: () => ['Take'] }, handled: false };
    rocks(rockEvent);
    assert.equal(rockEvent.handled, true, `rock action route at ${p.getLocation().getX()},${p.getLocation().getY()},${p.getLocation().getZ()}`);
    assertLatestVarbit(p, 1895, 50, `rock pickup advances stage; messages=${p.messages.join('|')} items=${JSON.stringify([...p.items])}`);
    assertLatestVarbit(p, 1869, 1);

    p.items.set(core.ItemIdentifiers.MUDSKIPPER_HIDE, 5);
    const nung = h.itemOnNpc.find(handler => handler.name === 'handleNungItem');
    for (let i = 0; i < 5; i++) nung({ player: p, npcId: core.NpcIdentifiers.NUNG,
      itemId: core.ItemIdentifiers.MUDSKIPPER_HIDE, handled: false });
    assertLatestVarbit(p, 1895, 60);
    assertLatestVarbit(p, 1875, 5);
    custom(h, 'npc-dialogue:line').find(handler => handler.name === 'handlePirateNungMilestoneLine')({
      player: p, npcId: core.NpcIdentifiers.NUNG,
      text: "You's gotta go up to da topsies, and your gotta get a needly-thing and some wirey stuff.",
    });
    assertLatestVarbit(p, 1895, 70);
    p.items.set(core.ItemIdentifiers.NEEDLE, 1);
    p.items.set(core.ItemIdentifiers.BRONZE_WIRE, 3);
    nung({ player: p, npcId: core.NpcIdentifiers.NUNG, itemId: core.ItemIdentifiers.NEEDLE, handled: false });
    assertLatestVarbit(p, 1895, 80);
    sync({ player: p });
    assertLatestVarbit(p, 1895, 80, 'intermediate progress and auxiliary facts replay at login');
  } finally {
    h.restoreTranscripts();
  }
});

test('Skrach QH milestones require the imported accepted Rantz choices and replay after relog', () => {
  const h = harness();
  const p = dialoguePlayer();
  const declined = dialoguePlayer();
  try {
    h.quest.setStage(p, 4);
    h.quest.setStage(declined, 4);
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    assert.ok(sync);
    sync({ player: p });
    assertLatestVarbit(p, 1904, 0);
    sync({ player: declined });
    runImportedVariant(h, declined, core.NpcIdentifiers.ARIS_3,
      'Recipe for Disaster/Freeing Skrach Uglogwee', 'starting-off-inspecting-skrach-uglogwee',
      ['Nah, leave that Ogre in the frozen dimension!']);
    assertLatestVarbit(declined, 1904, 0, 'declining the imported route leaves the milestone at its prior value');

    runImportedVariant(h, p, core.NpcIdentifiers.ARIS_3,
      'Recipe for Disaster/Freeing Skrach Uglogwee', 'starting-off-inspecting-skrach-uglogwee',
      ['Yes, I\'m sure I can get some Jubbly Chompy.', 'Oh Ok then, I guess I\'ll talk to Rantz.']);
    assertLatestVarbit(p, 1904, 10, 'the accepted Aris branch advances to the first Rantz step');
    assertLatestVarbit(p, 1905, 1, 'Rantz becomes a helper target after the accepted Aris clue');
    sync({ player: p });
    assertLatestVarbit(p, 1904, 10, 'the accepted step persists across login replay');

    runImportedVariant(h, p, core.NpcIdentifiers.RANTZ,
      'Recipe for Disaster/Freeing Skrach Uglogwee', 'ranting-with-rantz-talking-to-rantz',
      ['I\'m trying to free Skrach, can you help?', 'Ok, I\'ll do it.']);
    assertLatestVarbit(p, 1904, 20, 'Rantz acceptance is a distinct milestone');
    assertLatestVarbit(p, 1908, 1, 'the Ogre boat becomes visible after Rantz accepts the route');
    const action = custom(h, 'npc-dialogue:action').find(handler => handler.name === 'handleAction');
    action({ player: p, npcId: core.NpcIdentifiers.RANTZ, stepId: 'AKuMx3', handled: false });
    assertLatestVarbit(p, 1906, 1, 'the imported tree-push action replays');
    action({ player: p, npcId: core.NpcIdentifiers.RANTZ, stepId: 'rPhLu8', handled: false });
    assertLatestVarbit(p, 1907, 1, 'the imported arrow action replays');
    runImportedVariant(h, p, core.NpcIdentifiers.RANTZ,
      'Recipe for Disaster/Freeing Skrach Uglogwee', 'ranting-with-rantz-talking-to-rantz-after-refusing-to-help-him',
      ['Actually, I don\'t need to talk to you...sorry.']);
    assertLatestVarbit(p, 1904, 20, 'closing the follow-up dialogue does not erase or advance a milestone');

    const line = custom(h, 'npc-dialogue:line').find(handler => handler.name === 'handleSkrachMilestoneLine');
    line({ player: p, npcId: core.NpcIdentifiers.RANTZ,
      text: "You's creatures says what Rantz need for da going over da big water to da over'der place." });
    assertLatestVarbit(p, 1904, 30);
    line({ player: p, npcId: core.NpcIdentifiers.RANTZ,
      text: "Is what me's says...you's creature no helpsies...just says Rantz saysies back!" });
    assertLatestVarbit(p, 1904, 40);
    const choice = custom(h, 'npc-dialogue:choice').find(handler => handler.name === 'handleSkrachChoice');
    choice({ player: p, npcId: core.NpcIdentifiers.OGRE_BOAT,
      option: "Yes please, I'll get a lift back with you." });
    assertLatestVarbit(p, 1909, 1, 'the accepted boat ride records the cache free-ride flag');
  } finally {
    h.restoreTranscripts();
  }
});

test('Sir Amik QH varbit advances at the imported Aris clue and Cook recipe boundaries', () => {
  const h = harness();
  const p = dialoguePlayer();
  try {
    h.quest.setStage(p, 4);
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1910, 0);

    runImportedVariant(h, p, core.NpcIdentifiers.ARIS_3,
      'Recipe for Disaster/Freeing Sir Amik Varze', 'starting-out-inspecting-sir-amik-varze');
    assertLatestVarbit(p, 1910, 5, 'the imported inspection explanation advances to the Cook step');

    runImportedVariant(h, p, core.NpcIdentifiers.COOK,
      'Recipe for Disaster/Freeing Sir Amik Varze', 'starting-out-talking-to-the-cook',
      ['Protecting the Dwarf', 'More...']);
    assertLatestVarbit(p, 1910, 5, 'opening a different rescue recipe does not advance Sir Amik');
    runImportedVariant(h, p, core.NpcIdentifiers.COOK,
      'Recipe for Disaster/Freeing Sir Amik Varze', 'starting-out-talking-to-the-cook',
      ['Protecting Sir Amik Varze', 'More...']);
    assertLatestVarbit(p, 1910, 10, 'the exact Sir Amik recipe branch reaches the later QH route');
    sync({ player: p });
    assertLatestVarbit(p, 1910, 10, 'the Cook milestone persists across login replay');
  } finally {
    h.restoreTranscripts();
  }
});

test('Awowogei QH stages follow imported dialogue and earned meal items', () => {
  const h = harness();
  const p = dialoguePlayer();
  const itemId = core.ItemIdentifiers;
  try {
    h.quest.setStage(p, 4);
    const sync = custom(h, 'player:bootstrap-complete').find(handler => handler.name === 'syncQuestState'
      && handler.toString().includes('syncRescueQuestVarbits'));
    sync({ player: p });
    assertLatestVarbit(p, 1914, 0);

    runImportedVariant(h, p, core.NpcIdentifiers.AWOWOGEI,
      'Recipe for Disaster/Freeing King Awowogei', 'ape-atoll-king-awowogei');
    assertLatestVarbit(p, 1914, 5);
    runImportedVariant(h, p, core.NpcIdentifiers.MIZARU,
      'Recipe for Disaster/Freeing King Awowogei', 'ape-atoll-talking-to-the-three-wise-monkeys',
      ['Do you know anything about the King\'s favourite dish?', "That's all for the moment."]);
    assertLatestVarbit(p, 1914, 10);

    p.equipment.set(core.Equipment.AMULET_SLOT, itemId.MSPEAK_AMULET);
    p.items.set(itemId.BANANA, 1);
    p.items.set(itemId.MONKEY_NUTS, 1);
    const offer = h.itemOnNpc.find(handler => handler.name === 'handleAwowogeiOffer');
    assert.ok(offer);
    offer({ player: p, npcId: core.NpcIdentifiers.MIZARU, itemId: itemId.BANANA, handled: false });
    offer({ player: p, npcId: core.NpcIdentifiers.MIZARU, itemId: itemId.MONKEY_NUTS, handled: false });
    assertLatestVarbit(p, 1914, 15, 'both canonical ingredient handovers reveal the recipe');
    assertLatestVarbit(p, 1915, 10);
    assertLatestVarbit(p, 1916, 10);

    const death = h.npcDeath.find(handler => handler.name === 'handleBigSnakeDeath');
    death({ killer: p, npcId: core.NpcIdentifiers.BIG_SNAKE });
    assertLatestVarbit(p, 1914, 20);
    assertLatestVarbit(p, 1917, 10, 'the source-named snake fact survives independently of inventory');
    p.items.set(itemId.SLICED_RED_BANANA, 1);
    const items = h.itemOnItem.find(handler => handler.name === 'handleAwowogeiItems');
    items({ player: p, usedItemId: itemId.SNAKE_CORPSE, usedWithItemId: itemId.SLICED_RED_BANANA, handled: false });
    assertLatestVarbit(p, 1914, 30);

    p.equipment.set(core.Equipment.WEAPON_SLOT, itemId.ZOMBIE_MONKEY_GREEGREE);
    p.setLocation(3055, 5484, 0);
    const roast = h.objectInteraction.find(([handler]) => handler.name === 'handleAwowogeiObjects')?.[0];
    const roastEvent = { player: p, objectId: 16077, itemId: itemId.RAW_STUFFED_SNAKE,
      object: { getDefinition: () => ({ getName: () => 'Hot rocks', getExamine: () => 'Hot cooking rocks' }) }, handled: false };
    roast(roastEvent);
    assert.equal(roastEvent.handled, true);
    assertLatestVarbit(p, 1914, 40);
    sync({ player: p });
    assertLatestVarbit(p, 1914, 40, 'prepared-dish progress is durable across login replay');
  } finally {
    h.restoreTranscripts();
  }
});

test('all eight rescue hand-ins reach the Culinaromancer and complete once', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('quest.points', 167);
    for (const key of ['fishing_contest', 'goblin_diplomacy', 'big_chompy_bird_hunting', 'biohazard',
      'demon_slayer', 'murder_mystery', 'nature_spirit', 'witchs_house', 'gertrudes_cat',
      'shadow_of_the_storm', 'monkey_madness_i', 'family_crest', 'heroes_quest', 'lost_city',
      'merlins_crystal', 'shield_of_arrav', 'dragon_slayer_i', 'shilo_village', 'jungle_potion',
      'druidic_ritual', 'underground_pass', 'plague_city', 'waterfall_quest', 'desert_treasure_i',
      'horror_from_the_deep']) completeQuest(h, p, key);
    runtime.getRegisteredQuests().findLast(entry => entry.key === 'legends_quest')?.setStage(p, 5);

    const handIn = h.itemOnNpc.find(handler => handler.name === 'rescueByItem');
    assert.ok(handIn);
    const ids = core.ItemIdentifiers;
    p.equipment.set(core.Equipment.AMULET_SLOT, ids.MSPEAK_AMULET);
    p.attrs.set('recipe-for-disaster:evil-dave-recipe', { red: 1, orange: 1, brown: 1, yellow: 1 });
    p.attrs.set('recipe-for-disaster:evil-dave-stew', { doses: { red: 1, orange: 1, brown: 1, yellow: 1 } });
    p.attrs.set('recipe-for-disaster:evil-dave-state', 4);
    const legs = [
      [core.NpcIdentifiers.MOUNTAIN_DWARF, ids.DWARVEN_ROCK_CAKE_2, 1],
      [core.NpcIdentifiers.GENERAL_WARTFACE_5, ids.SLOP_OF_COMPROMISE, 2],
      [core.NpcIdentifiers.PIRATE_PETE_3, ids.COOKED_FISHCAKE, 4],
      [core.NpcIdentifiers.LUMBRIDGE_GUIDE_4, ids.CAKE_OF_GUIDANCE, 8],
      [core.NpcIdentifiers.EVIL_DAVE_3, ids.SPICY_STEW, 16],
      [core.NpcIdentifiers.SKRACH_UGLOGWEE, ids.COOKED_JUBBLY, 32],
      [core.NpcIdentifiers.SIR_AMIK_VARZE_3, ids.BRULEE_SUPREME, 64],
      [core.NpcIdentifiers.AWOWOGEI, ids.STUFFED_SNAKE, 128],
    ];
    let flags = 0;
    const rescueKeys = [
      'mountain-dwarf', 'goblins', 'pirate-pete', 'lumbridge-guide',
      'evil-dave', 'skrach-uglogwee', 'sir-amik', 'king-awowogei',
    ];
    const rescueVarbits = [
      [1892, 60], [1867, 40], [1895, 110], [1896, 5],
      [1878, 5], [1904, 170], [1910, 20], [1914, 50],
    ];
    const incomplete = { player: p, rescue: 'king-awowogei', complete: false };
    h.api.emitCustomEvent('recipe-for-disaster:rescue-status', incomplete);
    assert.equal(incomplete.complete, false, 'unrescued member remains incomplete');
    for (const [npcId, itemId, flag] of legs) {
      p.items.set(itemId, 1);
      const event = { player: p, npcId, itemId, handled: false };
      handIn(event);
      assert.equal(event.handled, true, `hand-in for flag ${flag}`);
      assert.equal(p.items.get(itemId) ?? 0, 0, `item consumed for flag ${flag}`);
      flags |= flag;
      assert.equal(Number(p.attrs.get('recipe-for-disaster:rescues')), flags);
      const index = Math.log2(flag);
      assert.ok(p.log.some(([method, varbit, value]) => method === 'sendVarbit'
        && varbit === rescueVarbits[index][0] && value === rescueVarbits[index][1]),
      `QH rescue varbit for ${rescueKeys[index]} reaches its completion endpoint`);
      const query = { player: p, rescue: rescueKeys[index], complete: false };
      h.api.emitCustomEvent('recipe-for-disaster:rescue-status', query);
      assert.equal(query.complete, true, `public rescue query reports ${rescueKeys[index]}`);
    }
    assert.equal(flags, 255);
    assert.equal(p.attrs.get('quest.points'), 175);

    const action = h.custom['npc-dialogue:action'].find(handler => handler.name === 'handleAction');
    action({ player: p, stepId: 'LCDDwN', handled: false });
    assert.equal(p.attrs.get('recipe-for-disaster:culinaromancer-wave'), -1);

    const portal = h.objectInteraction.find(([name]) => name === 'Portal')?.[1];
    assert.ok(portal?.Use);
    assert.equal(portal.Use({ player: p, action: 'Use', location: { x: 3209, y: 3218, z: 0 } }), true);
    const death = h.npcDeath.find(handler => handler.name === 'handleNpcDeath');
    assert.ok(death);
    for (let wave = 1; wave <= 6; wave++) {
      const active = h.spawned.at(-1);
      assert.ok(active, `wave ${wave} spawned`);
      death({ killer: p, npc: active, npcId: active.getId() });
    }
    assert.equal(p.attrs.get('recipe-for-disaster:culinaromancer-defeated'), true);
    action({ player: p, stepId: 'ILo79M', handled: false });
    assert.equal(h.quest.getStage(p), 5);
    assert.equal(p.attrs.get('quest.points'), 176);
    assert.equal(p.items.get(core.ItemIdentifiers.ANTIQUE_LAMP_3), 1);
    action({ player: p, stepId: 'ILo79M', handled: false });
    assert.equal(p.attrs.get('quest.points'), 176);
    assert.equal(p.items.get(core.ItemIdentifiers.ANTIQUE_LAMP_3), 1);
  } finally {
    h.restoreTranscripts();
  }
});

test('RFD Rantz yields to Big Chompy until the Skrach prerequisite is complete', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    const rantz = h.npcInteraction.find(([name, actions]) => name === 'Rantz'
      && actions?.['Talk-to']?.name === 'handleRantzTalk')?.[1]?.['Talk-to'];
    assert.ok(rantz);
    const event = { player: p, npcId: core.NpcIdentifiers.RANTZ, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(rantz(event), false, 'RFD does not own Rantz before Big Chompy');
    assert.equal(event.handled, false);
    const chompyVariants = h.variants.filter(handler => handler.name === 'selectVariant')
      .map(handler => handler({ player: p, npcId: core.NpcIdentifiers.RANTZ, pages: [] }))
      .filter(Boolean);
    assert.ok(chompyVariants.some(choice => choice.page === 'Big Chompy Bird Hunting'),
      'the generic Big Chompy Rantz variant remains selectable');

    completeQuest(h, p, 'big_chompy_bird_hunting');
    const rfd = { player: p, npcId: core.NpcIdentifiers.RANTZ, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(rantz(rfd), true, 'RFD claims Rantz in its canonical rescue window');
    assert.equal(rfd.handled, true);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5),
      ['Recipe for Disaster/Freeing Skrach Uglogwee', 'ranting-with-rantz-talking-to-rantz']);
  } finally {
    h.restoreTranscripts();
  }
});

test('Amik black dragon yields the token before the brulee exists and never loses it on a full bag', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:amik-state', 1);
    p.setLocation(2461, 4367, 0);
    const death = h.npcDeath.find(handler => handler.name === 'handleAmikCombatDrop');
    assert.ok(death);
    const dragon = { getId: () => core.NpcIdentifiers.BLACK_DRAGON };
    death({ killer: p, npc: dragon, npcId: core.NpcIdentifiers.BLACK_DRAGON });
    assert.equal(p.items.get(core.ItemIdentifiers.DRAGON_TOKEN), 1);
    assertLatestVarbit(p, 1912, 1, 'the dragon-drop auxiliary state survives independently of pickup');
    assert.equal(p.items.get(core.ItemIdentifiers.BRULEE_3) ?? 0, 0);

    p.items.delete(core.ItemIdentifiers.DRAGON_TOKEN);
    p.setFull(true);
    death({ killer: p, npc: dragon, npcId: core.NpcIdentifiers.BLACK_DRAGON });
    assert.equal(p.items.get(core.ItemIdentifiers.DRAGON_TOKEN) ?? 0, 0);
    assert.equal(h.ground.length, 1);
    assert.equal(h.ground[0][1].getId(), core.ItemIdentifiers.DRAGON_TOKEN);
    assert.ok(core.World.getItems().includes(h.ground[0][3]), 'the real manager registers a recoverable ground item');
  } finally {
    h.restoreTranscripts();
  }
});

test('imported Murphy fishbowl branch grants the diving gear through registered dispatch', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:pirate-state', 1);
    p.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    const murphy = h.npcInteraction.find(([name]) => name === 'Murphy')?.[1]?.['Talk-to'];
    assert.ok(murphy);
    const event = { player: p, npcId: core.NpcIdentifiers.MURPHY, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(murphy(event), true);
    assert.equal(event.handled, true);
    const call = h.transcriptCalls.at(-1);
    const page = 'Recipe for Disaster/Freeing Pirate Pete';
    const variant = 'asking-about-giant-crabs-talking-to-murphy-again';
    assert.deepEqual(call.slice(3, 5), [page, variant]);
    const raw = importedVariant(h, page, variant);
    assert.ok(!JSON.stringify(raw).includes('2UA9Sd'), 'the current import no longer has the obsolete marker');
    const importedNode = findStepById(raw, 'FY6rCP')[0];
    assert.ok(importedNode, 'the imported variant carries the FY6rCP node');
    assert.equal(importedNode.type, 'message');
    assert.match(importedNode.text, /attaches some tubes/);
    assert.equal(call.length, 5, 'the canonical transcript tree is used unchanged');
    const answer = h.conditions.find(handler => handler.name === 'answerCondition');
    const pages = [{ page }];
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.MURPHY,
      text: 'If the player has a fishbowl:', pages }), true);
    p.items.delete(core.ItemIdentifiers.EMPTY_FISHBOWL);
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.MURPHY,
      text: 'If the player has a fishbowl:', pages }), false);
    p.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    const action = h.custom['npc-dialogue:action'].find(handler => handler.name === 'handleAction');
    assert.ok(action);
    const fit = { player: p, npcId: core.NpcIdentifiers.MURPHY, pages: [{ page }], stepId: 'FY6rCP', handled: false };
    action(fit);
    assert.equal(p.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL) ?? 0, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET), 1);
    assert.equal(Number(p.attrs.get('recipe-for-disaster:pirate-state')) & 2, 2);

    const full = makePlayer();
    h.quest.setStage(full, 4);
    full.attrs.set('recipe-for-disaster:pirate-state', 1);
    full.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    full.setFull(true);
    const blocked = { player: full, npcId: core.NpcIdentifiers.MURPHY, pages: [{ page }], stepId: 'FY6rCP', handled: false };
    action(blocked);
    assert.equal(blocked.handled, true);
    assert.equal(blocked.end, true);
    assert.equal(full.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL), 1, 'fishbowl preserved without space');
    assert.equal(full.items.get(core.ItemIdentifiers.DIVING_APPARATUS) ?? 0, 0);
  } finally {
    h.restoreTranscripts();
  }
});

test('imported Murphy lost-gear branches restore each item independently without a fishbowl', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:pirate-state', 3);
    const murphy = h.npcInteraction.find(([name]) => name === 'Murphy')?.[1]?.['Talk-to'];
    const answer = h.conditions.find(handler => handler.name === 'answerCondition');
    const line = h.custom['npc-dialogue:line'].find(handler => handler.name === 'handleMurphyGearReceipt');
    assert.ok(murphy && answer && line);
    const page = 'Recipe for Disaster/Freeing Pirate Pete';
    const variant = 'asking-about-giant-crabs-talking-to-murphy-again-again';
    const pages = [{ page }];
    const lostHelmet = importedConditionText(h, page, variant, 'quMxI5');
    const lostApparatus = importedConditionText(h, page, variant, 'JH1Rzn');
    const fullHelmet = importedConditionText(h, page, variant, '2hAlI1');
    const fullApparatus = importedConditionText(h, page, variant, '0EUWB6');
    const branch = () => {
      h.transcriptCalls.length = 0;
      const event = { player: p, npcId: core.NpcIdentifiers.MURPHY, clickType: 1,
        definition: { getActions: () => ['Talk-to'] }, handled: false };
      assert.equal(murphy(event), true);
      assert.equal(event.handled, true);
      const call = h.transcriptCalls.at(-1);
      assert.deepEqual(call.slice(3, 5), [page, variant]);
      return importedVariant(h, page, variant);
    };
    const ask = text => answer({ player: p, npcId: core.NpcIdentifiers.MURPHY, text, pages });
    const dispatch = text => {
      const event = { player: p, npcId: core.NpcIdentifiers.MURPHY, pages, text, handled: false };
      line(event);
      return event;
    };
    const stage = h.quest.getStage(p);

    // Lost helmet only: apparatus is still held, and no fishbowl is needed.
    p.items.set(core.ItemIdentifiers.DIVING_APPARATUS, 1);
    branch();
    assert.equal(ask(lostHelmet), true);
    assert.equal(ask(lostApparatus), false);
    assert.equal(ask(fullHelmet), false);
    dispatch("Sure, here you go. Try not to lose this one, I'm not a very good glassblower.");
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL) ?? 0, 0);
    assert.equal(h.quest.getStage(p), stage);
    assert.equal(Number(p.attrs.get('recipe-for-disaster:rescues')) || 0, 0);

    // Full bag: no item, no stage/flag change, and the same branch works later.
    p.items.delete(core.ItemIdentifiers.FISHBOWL_HELMET);
    p.setFull(true);
    assert.equal(ask(fullHelmet), true);
    dispatch("Sure, here you go. Try not to lose this one, I'm not a very good glassblower.");
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET) ?? 0, 0);
    assert.equal(h.quest.getStage(p), stage);
    p.setFull(false);
    dispatch("Sure, here you go. Try not to lose this one, I'm not a very good glassblower.");
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET), 1);

    // Lost apparatus only: helmet is still held, no fishbowl is consumed.
    p.items.delete(core.ItemIdentifiers.DIVING_APPARATUS);
    branch();
    assert.equal(ask(lostHelmet), false);
    assert.equal(ask(lostApparatus), true);
    assert.equal(ask(fullApparatus), false);
    dispatch('Here, have this one. Only dropped once!');
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL) ?? 0, 0);

    // Full bag on the apparatus branch is equally retryable.
    p.items.delete(core.ItemIdentifiers.DIVING_APPARATUS);
    p.setFull(true);
    assert.equal(ask(fullApparatus), true);
    dispatch('Here, have this one. Only dropped once!');
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS) ?? 0, 0);
    assert.equal(h.quest.getStage(p), stage);
    p.setFull(false);
    dispatch('Here, have this one. Only dropped once!');
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS), 1);
    assert.equal(h.quest.getStage(p), stage);
    assert.equal(Number(p.attrs.get('recipe-for-disaster:rescues')) || 0, 0);
  } finally {
    h.restoreTranscripts();
  }
});

test('real imported Murphy run grants gear from FY6rCP and leaves the no-fishbowl branch alone', () => {
  const h = harness();
  try {
    const murphy = h.npcInteraction.find(([name]) => name === 'Murphy')?.[1]?.['Talk-to'];
    assert.ok(murphy);
    const choice = ['Talk about Recipe for Disaster.', 'Not just yet.'];

    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:pirate-state', 1);
    p.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    runRegisteredTranscript(h, p, core.NpcIdentifiers.MURPHY, murphy, choice);
    assert.ok(p.messages.some(text => text.includes('Murphy attaches some tubes')), JSON.stringify(p.messages));
    assert.equal(p.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL) ?? 0, 0);
    assert.equal(p.items.get(core.ItemIdentifiers.DIVING_APPARATUS), 1);
    assert.equal(p.items.get(core.ItemIdentifiers.FISHBOWL_HELMET), 1);
    assert.equal(Number(p.attrs.get('recipe-for-disaster:pirate-state')) & 2, 2);
    assert.equal(h.quest.getStage(p), 4);

    const noFishbowl = dialoguePlayer();
    h.quest.setStage(noFishbowl, 4);
    noFishbowl.attrs.set('recipe-for-disaster:pirate-state', 1);
    const noFishbowlTexts = runRegisteredTranscript(h, noFishbowl, core.NpcIdentifiers.MURPHY, murphy, choice);
    assert.ok(noFishbowlTexts.some(text => text.includes('whenever you want me to get you some diving')),
      JSON.stringify(noFishbowlTexts));
    assert.ok(!noFishbowl.messages.some(text => text.includes('Murphy attaches some tubes')));
    assert.equal(noFishbowl.items.get(core.ItemIdentifiers.DIVING_APPARATUS) ?? 0, 0);
    assert.equal(noFishbowl.items.get(core.ItemIdentifiers.FISHBOWL_HELMET) ?? 0, 0);
    assert.equal(Number(noFishbowl.attrs.get('recipe-for-disaster:pirate-state')), 1);

    const full = dialoguePlayer();
    h.quest.setStage(full, 4);
    full.attrs.set('recipe-for-disaster:pirate-state', 1);
    full.items.set(core.ItemIdentifiers.EMPTY_FISHBOWL, 1);
    full.setFull(true);
    runRegisteredTranscript(h, full, core.NpcIdentifiers.MURPHY, murphy, choice);
    assert.ok(full.messages.some(text => text.includes('Make room and bring Murphy a fishbowl')), JSON.stringify(full.messages));
    assert.equal(full.items.get(core.ItemIdentifiers.EMPTY_FISHBOWL), 1, 'fishbowl is kept when the bag is full');
    assert.equal(full.items.get(core.ItemIdentifiers.DIVING_APPARATUS) ?? 0, 0);
    assert.equal(full.items.get(core.ItemIdentifiers.FISHBOWL_HELMET) ?? 0, 0);
    assert.equal(Number(full.attrs.get('recipe-for-disaster:pirate-state')), 1);
    assert.equal(h.quest.getStage(full), 4);
  } finally {
    h.restoreTranscripts();
  }
});

test('the Wise Old Man briefing replays after cancel and claims only its accepted boundary', () => {
  const h = harness();
  try {
    const p = dialoguePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:amik-state', 1);
    const wise = h.npcInteraction.find(([name]) => name === 'Wise Old Man')?.[1]?.['Talk-to'];
    assert.ok(wise);
    const variant = h.variants.find(handler => handler.name === 'selectVariant');
    const pages = [{ page: 'Recipe for Disaster/Freeing Sir Amik Varze' }];
    assert.deepEqual(variant({ player: p, npcId: core.NpcIdentifiers.WISE_OLD_MAN, pages }), {
      page: 'Recipe for Disaster/Freeing Sir Amik Varze',
      variant: 'finding-the-lair-talking-to-the-wise-old-man',
    });
    runtime.startTranscript = (...args) => {
      h.transcriptCalls.push(args);
      return h.realStartTranscript(...args);
    };
    const event = { player: p, npcId: core.NpcIdentifiers.WISE_OLD_MAN, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(wise(event), true);
    assert.equal(event.handled, true);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5), ['Recipe for Disaster/Freeing Sir Amik Varze',
      'finding-the-lair-talking-to-the-wise-old-man']);
    assert.equal(p.attrs.get('recipe-for-disaster:amik-wom-briefed'), undefined,
      'opening the conversation does not consume the briefing');
    const cancelBriefing = () => {
      p.getPacketSender().sendInterfaceRemoval();
      custom(h, 'interface:closed').forEach(handler => handler({ player: p }));
    };
    cancelBriefing();
    const reopened = { player: p, npcId: core.NpcIdentifiers.WISE_OLD_MAN, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(wise(reopened), true, 'cancel leaves the accepted briefing available');
    assert.ok(p.manager.getCurrent(), 'reopening starts the imported transcript again');
    cancelBriefing();
    runRegisteredTranscript(h, p, core.NpcIdentifiers.WISE_OLD_MAN, wise,
      ['Could I have some free stuff, please?', 'Ok, what do you want me to do?']);
    assert.equal(p.attrs.get('recipe-for-disaster:amik-wom-briefed'), undefined,
      'the repeated text in the different free-stuff branch is not the accepted briefing');
    const lines = runRegisteredTranscript(h, p, core.NpcIdentifiers.WISE_OLD_MAN, wise,
      'Is there anything I can do for you?');
    assert.ok(lines.some(text => text.replace(/\s+/g, ' ').includes("This won't be a quest")), JSON.stringify(lines));
    assert.equal(p.attrs.get('recipe-for-disaster:amik-wom-briefed'), 1);
    const later = { player: p, npcId: core.NpcIdentifiers.WISE_OLD_MAN, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false };
    assert.equal(wise(later), false, 'later quest hooks can use the Wise Old Man after the brief');
    assert.equal(later.handled, false);
    assert.equal(variant({ player: p, npcId: core.NpcIdentifiers.WISE_OLD_MAN, pages }), null);
  } finally {
    h.restoreTranscripts();
  }
});

test('goblin slop can be recovered after the first one is lost', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.attrs.set('recipe-for-disaster:goblin-state', 6);
    const page = 'Recipe for Disaster/Freeing the Goblin generals';
    const variant = 'finishing-up-talking-to-the-burnt-goblin-cook-after-receiving-the-slop-of-compromise';
    const answer = h.conditions.find(handler => handler.name === 'answerCondition');
    const pages = [{ page }];
    const still = importedConditionText(h, page, variant, 'B1T4-s');
    const lost = importedConditionText(h, page, variant, 'wBHjhm');
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, text: still, pages }), false);
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, text: lost, pages }), true,
      'an empty inventory naturally selects the lost-slop branch');
    assert.deepEqual(h.variants.find(handler => handler.name === 'selectVariant')({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK,
      pages }), { page, variant });
    const receive = { player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, stepId: 'jKFpD-', handled: false };
    custom(h, 'npc-dialogue:action').forEach(handler => handler(receive));
    assert.equal(receive.handled, true);
    assert.equal(p.items.get(core.ItemIdentifiers.SLOP_OF_COMPROMISE), 1);
    assert.equal(Number(p.attrs.get('recipe-for-disaster:goblin-state')) & 4, 4);
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, text: still, pages }), true);
    assert.equal(answer({ player: p, npcId: core.NpcIdentifiers.GOBLIN_COOK, text: lost, pages }), false);
  } finally {
    h.restoreTranscripts();
  }
});

test('the Awowogei snake pit entrance and rope exit move the player', () => {
  const h = harness();
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    p.setLocation(2922, 2722, 0);
    const handler = h.objectInteraction.find(([name]) => typeof name === 'function' && name.name === 'handleAwowogeiSnakePit')?.[0];
    assert.ok(handler);
    const enter = { player: p, objectId: core.ObjectIdentifiers.PIT_3, clickType: 1,
      definition: { getActions: () => ['Enter'] }, handled: false };
    assert.equal(handler(enter), true);
    assert.equal(enter.handled, true);
    assert.deepEqual(p.moves.at(-1), [3019, 5485, 0]);
    p.setLocation(3024, 5489, 0);
    const exit = { player: p, objectId: core.ObjectIdentifiers.ROPE_21, clickType: 1,
      definition: { getActions: () => ['Climb'] }, handled: false };
    assert.equal(handler(exit), true);
    assert.equal(exit.handled, true);
    assert.deepEqual(p.moves.at(-1), [2922, 2722, 0]);
  } finally {
    h.restoreTranscripts();
  }
});

test('imported Traiborn lost-milk and lost-flour branches select independently', () => {
  const h = harness();
  try {
    const traiborn = h.npcInteraction.find(([name]) => name === 'Wizard Traiborn')?.[1]?.['Talk-to'];
    assert.ok(traiborn);
    const page = 'Recipe for Disaster/Freeing the Lumbridge Guide';
    const variant = 'finishing-up-talking-to-wizard-traiborn-again';
    assert.equal(importedConditionText(h, page, variant, 'OjKquk'), 'If the player lost the enchanted milk');
    assert.equal(importedConditionText(h, page, variant, 'FJEB5g'), 'If the player lost the enchanted flour');

    // Milk only: guide-state bit 2, no milk, and no raw milk to restart the quiz.
    const milk = dialoguePlayer();
    h.quest.setStage(milk, 4);
    milk.attrs.set('recipe-for-disaster:guide-state', 2);
    const milkTexts = runRegisteredTranscript(h, milk, core.NpcIdentifiers.WIZARD_TRAIBORN, traiborn);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5), [page, variant],
      'milk-only loss selects the imported finishing-up variant');
    assert.ok(milkTexts.includes('I lost the milk!'), JSON.stringify(milkTexts));
    assert.ok(!milkTexts.includes('I lost the flour!'), 'milk-only loss must not take the flour branch');
    assert.equal(milk.items.get(core.ItemIdentifiers.ENCHANTED_MILK), 1);
    assert.equal(milk.items.get(core.ItemIdentifiers.ENCHANTED_FLOUR) ?? 0, 0);
    assert.equal(milk.attrs.get('recipe-for-disaster:guide-state'), 2);

    // Flour only: guide-state bit 4, no flour. Milk is also absent but was never
    // enchanted, so the milk condition must stay false.
    const flour = dialoguePlayer();
    h.quest.setStage(flour, 4);
    flour.attrs.set('recipe-for-disaster:guide-state', 4);
    const flourTexts = runRegisteredTranscript(h, flour, core.NpcIdentifiers.WIZARD_TRAIBORN, traiborn);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5), [page, variant]);
    assert.ok(flourTexts.includes('I lost the flour!'), JSON.stringify(flourTexts));
    assert.ok(!flourTexts.includes('I lost the milk!'), 'flour-only loss must not take the milk branch');
    assert.equal(flour.items.get(core.ItemIdentifiers.ENCHANTED_FLOUR), 1);
    assert.equal(flour.items.get(core.ItemIdentifiers.ENCHANTED_MILK) ?? 0, 0);
    assert.equal(flour.attrs.get('recipe-for-disaster:guide-state'), 4);
  } finally {
    h.restoreTranscripts();
  }
});

test('Rantz ownership: OSF stages win, including after Skrach starts, and RFD resumes after', () => {
  const h = harness();
  const hooks = registerRealNpcHooks(['RecipeForDisaster', 'BigChompyBirdHunting', 'OneSmallFavour']);
  try {
    const p = makePlayer();
    h.quest.setStage(p, 4);
    const osf = runtime.getRegisteredQuests().findLast(entry => entry.key === 'one_small_favour');
    assert.ok(osf);
    const osfPage = 'One Small Favour';
    const event = () => ({ player: p, npc: { getId: () => 1470 }, npcId: 1470, clickType: 1,
      definition: { getId: () => 1470, getName: () => 'Rantz', getActions: () => ['Talk-to'] }, handled: false });
    const cases = [
      [17, 'the-various-favours-are-asked-asking-rantz-the-ogre-for-a-mattress'],
      [18, 'the-various-favours-are-asked-asking-rantz-the-ogre-for-a-mattress-returning-to-rantz-without-completing-the-favour'],
      [20, 'heading-back-to-complete-the-favours-rantz-after-helping-with-the-gnome-glider'],
      [21, 'heading-back-to-complete-the-favours-rantz-after-losing-the-comfy-mattress'],
    ];

    // Big Chompy is incomplete; the canonical One Small Favour Rantz transcript
    // still owns its own stages (the wiki page offers no combined Big Chompy menu).
    for (const [stage, variant] of cases) {
      osf.setStage(p, stage);
      p.attrs.delete('recipe-for-disaster:skrach-state');
      h.transcriptCalls.length = 0;
      assert.equal(PluginManager.emitNpcInteraction(event()), true, `OSF stage ${stage} is handled`);
      assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5), [osfPage, variant]);
      assert.ok(!h.transcriptCalls.some(call => String(call[3]).startsWith('Recipe for Disaster')),
        `RFD does not claim Rantz at OSF stage ${stage}`);
    }

    // When OSF leaves its Rantz stages while Big Chompy is still incomplete, no
    // named hook claims Rantz and Big Chompy's generic variant remains selectable.
    osf.setStage(p, 19);
    const left = event();
    h.transcriptCalls.length = 0;
    assert.equal(PluginManager.emitNpcInteraction(left), false);
    assert.equal(left.handled, false);
    assert.equal(h.transcriptCalls.length, 0);
    const chompy = PluginManager.emitNpcDialogueVariant({
      player: p, npcId: 1470, pages: [{ page: 'Big Chompy Bird Hunting', variants: [] }],
    });
    assert.deepEqual(chompy, { page: 'Big Chompy Bird Hunting', variant: 'starting-off' },
      'the generic Big Chompy Rantz selector is reachable after OSF leaves');

    completeQuest(h, p, 'big_chompy_bird_hunting');

    // After Skrach is accepted, OSF still owns its mandatory Rantz stages.
    osf.setStage(p, 17);
    p.attrs.set('recipe-for-disaster:skrach-state', 1);
    h.transcriptCalls.length = 0;
    assert.equal(PluginManager.emitNpcInteraction(event()), true);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5), [osfPage, cases[0][1]],
      'OSF wins at stage 17 even with RFD Skrach started');

    // OSF leaves the stage: RFD resumes its own Skrach dialogue.
    osf.setStage(p, 19);
    h.transcriptCalls.length = 0;
    assert.equal(PluginManager.emitNpcInteraction(event()), true);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5),
      ['Recipe for Disaster/Freeing Skrach Uglogwee', 'ranting-with-rantz-talking-to-rantz-near-his-cave-after-agreeing-to-help-him'],
      'RFD resumes after OSF advances');

    p.attrs.delete('recipe-for-disaster:skrach-state');
    osf.setStage(p, osf.completionValue);
    h.transcriptCalls.length = 0;
    assert.equal(PluginManager.emitNpcInteraction(event()), true);
    assert.deepEqual(h.transcriptCalls.at(-1).slice(3, 5),
      ['Recipe for Disaster/Freeing Skrach Uglogwee', 'ranting-with-rantz-talking-to-rantz']);
  } finally {
    hooks.cleanup();
    h.restoreTranscripts();
  }
});
