// The Feud (q039) source-contract checks.
// From server/: node --test tests/qh728-q039.test.cjs (after yarn build).
//
// These tests dispatch the plugin's registered handlers. The transcript player is
// stubbed so the handler contract (stage edges, item operations, condition answers)
// is isolated; the generated condition/action ids dispatched below are read from
// npc-dialogues.json. This is not an end-to-end playthrough.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const Runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const transcriptCalls = [];
let worldNpcs = [];
Runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcriptCalls.push({ npcId, page, variant });
  return true;
};

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init();
});

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    adds(id, amount = 1) {
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) items.delete(id);
      else items.set(id, left);
    },
    forceAdd(player, item) {
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
    },
  };
}

function playerFixture({ inventory = inventoryFixture(), hands = null, head = null, weapon = null, thieving = 99 } = {}) {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const configs = new Map();
  const experiences = [];
  const dialogueStarts = [];
  let location = new core.Location(3361, 2956, 0);
  let packet;
  packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendConfig(id, value) { configs.set(id, value); return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => packet) });
  const dialogueManager = {
    startDialogues(chain) { dialogueStarts.push([...chain.getDialogues().values()]); },
    reset() {},
    isActive: () => false,
    getCurrent: () => null,
  };
  const player = {
    inventory,
    messages,
    varbits,
    configs,
    experiences,
    dialogueStarts,
    getUsername: () => 'qh728-q039',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => {
        if (slot === core.Equipment.HANDS_SLOT) return hands ? { getId: () => hands } : null;
        if (slot === core.Equipment.HEAD_SLOT) return head ? { getId: () => head } : null;
        if (slot === core.Equipment.WEAPON_SLOT) return weapon ? { getId: () => weapon } : null;
        return null;
      },
    }),
    getSkillManager: () => ({
      getCombatLevel: () => 99,
      getCurrentLevel: () => thieving,
      getMaxLevel: () => thieving,
      addExperiences(skill, amount) { experiences.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo: (to) => { location = to; },
    getDialogueManager: () => dialogueManager,
    getPacketSender: () => packet,
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

function villagerWorld(player) {
  return {
    getNpcs: () => [{
      getContentId: () => core.NpcIdentifiers.VILLAGER,
      getId: () => core.NpcIdentifiers.VILLAGER,
      getLocation: () => player.getLocation(),
    }],
  };
}

// Registers the real quest plugin into the real PluginManager hook arrays. Dispatch
// in the tests goes through PluginManager.emit*, not a copied selector.
function registerQuestPlugin() {
  const before = {
    interaction: PluginManager.npcInteractionHooks.length,
    objectInteraction: PluginManager.objectInteractionHooks.length,
    objectOrder: PluginManager.nextObjectHookOrder,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    npcDeath: PluginManager.npcDeathHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    login: PluginManager.loginHooks.length,
  };
  const pluginName = 'TheFeudTest';
  const spawned = [];
  const customEvents = new Set();
  const namedObjectInteractions = new Map();
  const namedNpcInteractions = new Map();
  const namedItemOnObject = [];
  const namedItemActions = new Map();
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcInteraction') return (names, actions) => {
      const wanted = new Set([].concat(names));
      for (const name of wanted) namedNpcInteractions.set(name, actions);
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: (event) => {
          if (event.handled) return;
          if (!wanted.has(event.definition?.getName?.())) return;
          if (event.definition.getActions?.()[event.clickType - 1] !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onNpcDialogueCondition') return (handler) => {
      PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    };
    if (key === 'onObjectInteraction') return (nameOrHandler, actions) => {
      PluginManager.nextObjectHookOrder += 1;
      if (typeof nameOrHandler === 'function') {
        PluginManager.objectInteractionHooks.push({ pluginName, handler: nameOrHandler });
        return;
      }
      namedObjectInteractions.set(nameOrHandler, actions);
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.objectInteractionHooks.push({ pluginName, handler: (event) => {
          if (event.handled) return;
          if (event.definition?.getName?.() !== nameOrHandler) return;
          const option = event.definition.getActions?.()[event.clickType - 1];
          if (option !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onItemOnObject') return (...args) => {
      if (typeof args[0] === 'function') {
        PluginManager.itemOnObjectHooks.push({ pluginName, handler: args[0] });
        return;
      }
      // Named registrations are recorded for contract checks; dispatch in these
      // tests goes through the plugin's generic fallback.
      namedItemOnObject.push({ item: args[0], object: args[1], handler: args[2] });
    };
    if (key === 'onItemAction') return (name, actions) => {
      if (typeof name === 'string') namedItemActions.set(name, actions);
    };
    if (key === 'onItemOnItem') return (handler) => {
      PluginManager.itemOnItemHooks.push({ pluginName, handler });
    };
    if (key === 'onItemOnNpc') return (handler) => {
      PluginManager.itemOnNpcHooks.push({ pluginName, handler });
    };
    if (key === 'onNpcDeath') return (handler) => {
      PluginManager.npcDeathHooks.push({ pluginName, handler });
    };
    if (key === 'onPlayerLogin') return (handler) => {
      PluginManager.loginHooks.push({ pluginName, handler });
    };
    if (key === 'onCustomEvent') return (eventName, handler) => {
      customEvents.add(eventName);
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    if (key === 'spawnNpc') return (def) => {
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, isRegistered: () => true };
      spawned.push(npc);
      return npc;
    };
    if (key === 'getWorld') return () => ({ getNpcs: () => worldNpcs });
    if (key === 'sendMultiChatboxPrompt') return () => true;
    return () => {};
  } });
  require('../plugins/quests/quests/TheFeud.Quest')(api);
  const quest = Runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_feud');
  return {
    quest,
    spawned,
    namedObjectInteractions,
    namedNpcInteractions,
    namedItemOnObject,
    namedItemActions,
    cleanup() {
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.objectInteractionHooks.length = before.objectInteraction;
      PluginManager.nextObjectHookOrder = before.objectOrder;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.itemOnNpcHooks.length = before.itemOnNpc;
      PluginManager.itemActionHooks.length = before.itemAction;
      PluginManager.itemOnItemHooks.length = before.itemOnItem;
      PluginManager.npcDeathHooks.length = before.npcDeath;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.loginHooks.length = before.login;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

/**
 * Registers the quest through the real createApi so named object hooks land in
 * PluginManager.objectHooksByName and are dispatched exactly as in game.
 */
function registerQuestPluginReal() {
  const snapshot = {
    npcInteraction: PluginManager.npcInteractionHooks.length,
    objectInteraction: PluginManager.objectInteractionHooks.length,
    objectByName: new Map([...PluginManager.objectHooksByName].map(([name, hooks]) => [name, hooks.length])),
    objectById: new Map([...PluginManager.objectHooksById].map(([id, hooks]) => [id, hooks.length])),
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    itemOnObjectFallback: PluginManager.itemOnObjectFallbackHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    npcDeath: PluginManager.npcDeathHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    login: PluginManager.loginHooks.length,
    nextObjectHookOrder: PluginManager.nextObjectHookOrder,
    custom: new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, hooks.length])),
  };
  const pluginName = 'TheFeudRealApiTest';
  require('../plugins/quests/quests/TheFeud.Quest')(PluginManager.createApi(pluginName));
  const quest = Runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_feud');
  return {
    quest,
    cleanup() {
      PluginManager.npcInteractionHooks.length = snapshot.npcInteraction;
      PluginManager.objectInteractionHooks.length = snapshot.objectInteraction;
      for (const [name, hooks] of [...PluginManager.objectHooksByName]) {
        const keep = snapshot.objectByName.get(name);
        if (keep === undefined) PluginManager.objectHooksByName.delete(name);
        else hooks.length = keep;
      }
      for (const [id, hooks] of [...PluginManager.objectHooksById]) {
        const keep = snapshot.objectById.get(id);
        if (keep === undefined) PluginManager.objectHooksById.delete(id);
        else hooks.length = keep;
      }
      PluginManager.itemOnObjectHooks.length = snapshot.itemOnObject;
      PluginManager.itemOnObjectFallbackHooks.length = snapshot.itemOnObjectFallback;
      PluginManager.itemOnItemHooks.length = snapshot.itemOnItem;
      PluginManager.itemOnNpcHooks.length = snapshot.itemOnNpc;
      PluginManager.itemActionHooks.length = snapshot.itemAction;
      PluginManager.npcDeathHooks.length = snapshot.npcDeath;
      PluginManager.npcDialogueConditionHooks.length = snapshot.condition;
      PluginManager.loginHooks.length = snapshot.login;
      PluginManager.nextObjectHookOrder = snapshot.nextObjectHookOrder;
      for (const [name, hooks] of [...PluginManager.customEventHooks]) {
        const keep = snapshot.custom.get(name);
        if (keep === undefined) PluginManager.customEventHooks.delete(name);
        else hooks.length = keep;
      }
    },
  };
}

function registerNpcDialogueRunner() {
  const before = {
    anyNpc: PluginManager.npcAnyInteractionHooks.length,
    custom: new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, hooks.length])),
  };
  const pluginName = 'NpcDialoguesQ039Test';
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'onAnyNpcInteraction') return (actions) => {
      PluginManager.npcAnyInteractionHooks.push({ pluginName, handler: (event) => {
        if (event.handled || event.clickType !== 1) return;
        const handler = actions[event.definition?.getActions?.()?.[event.clickType - 1]];
        if (handler && handler(event) !== false) event.handled = true;
      } });
    };
    if (key === 'onCustomEvent') return (name, handler) => {
      const hooks = PluginManager.customEventHooks.get(name) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(name, hooks);
    };
    if (key === 'emitCustomEvent') return (name, event) => PluginManager.emitCustomEvent(name, event);
    if (key === 'sendMultiChatboxPrompt') return () => true;
    return () => {};
  } });
  require('../plugins/npcs/NpcDialogues.plugin.js').register(api);
  return {
    cleanup() {
      PluginManager.npcAnyInteractionHooks.length = before.anyNpc;
      for (const [name, hooks] of [...PluginManager.customEventHooks]) {
        const kept = hooks.filter((hook) => hook.pluginName !== pluginName);
        const oldLength = before.custom.get(name) ?? 0;
        if (kept.length > oldLength) kept.splice(oldLength);
        if (kept.length) PluginManager.customEventHooks.set(name, kept);
        else PluginManager.customEventHooks.delete(name);
      }
    },
  };
}

const NPC_IDS = {
  'Ali Morrisane': core.NpcIdentifiers.ALI_MORRISANE,
  'Ali the Operator': core.NpcIdentifiers.ALI_THE_OPERATOR,
  'Ali the Barman': core.NpcIdentifiers.ALI_THE_BARMAN,
  'Menaphite Thug': core.NpcIdentifiers.MENAPHITE_THUG,
  'Menaphite Leader': core.NpcIdentifiers.MENAPHITE_LEADER,
  'Bandit': core.NpcIdentifiers.BANDIT_7,
  'Bandit Leader': core.NpcIdentifiers.BANDIT_LEADER,
  'Street urchin': core.NpcIdentifiers.STREET_URCHIN,
  'Villager': core.NpcIdentifiers.VILLAGER,
  'Ali the Mayor': core.NpcIdentifiers.ALI_THE_MAYOR,
};

function npcEvent(player, name, action = 'Talk-to') {
  return {
    player,
    npc: {},
    npcId: NPC_IDS[name],
    definition: {
      getId: () => NPC_IDS[name],
      getName: () => name,
      getActions: () => [action, null, null, null, null],
    },
    clickType: 1,
    handled: false,
  };
}

function action(player, stepId) {
  const event = { player, stepId, handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
}

function condition(player, stepId) {
  return PluginManager.emitNpcDialogueCondition({ player, stepId });
}

test('The Feud start hook moves stage 0 to 1 and each beer is consumed', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers;
    const player = playerFixture({ inventory: inventoryFixture(new Map([[I.BEER, 3]])) });
    transcriptCalls.length = 0;

    assert.equal(quest.getStage(player), 0);
    PluginManager.emitCustomEvent('npc-dialogue:hook', {
      hook: 'quest:the-feud:start', npcId: core.NpcIdentifiers.ALI_MORRISANE, player,
    });
    assert.equal(quest.getStage(player), 1);
    assert.equal(transcriptCalls.length, 0);

    for (let beer = 1; beer <= 3; beer++) {
      const event = { player, npcId: core.NpcIdentifiers.DRUNKEN_ALI, itemId: I.BEER, handled: false };
      assert.equal(PluginManager.emitItemOnNpc(event), true);
      assert.equal(player.inventory.getAmount(I.BEER), 3 - beer, `beer ${beer} consumed`);
      assert.equal(player.getAttribute('quest.the_feud.beers'), beer);
    }
    assert.equal(quest.getStage(player), 2);
    assert.equal(transcriptCalls.at(-1).variant, 'asking-the-locals-talking-to-drunken-ali-using-the-third-beer-on-him');
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('Snake charming keeps its success/failure answer until the transcript branch runs', () => {
  const { quest, cleanup } = registerQuestPlugin();
  const realRandom = Math.random;
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const player = playerFixture({ inventory: inventoryFixture(new Map([
      [I.SNAKE_CHARM, 1], [I.SNAKE_BASKET, 1],
    ])) });
    quest.setStage(player, 18);
    transcriptCalls.length = 0;

    Math.random = () => 0.1;
    assert.equal(PluginManager.emitItemOnNpc({
      player, npcId: N.SNAKE_5, itemId: I.SNAKE_CHARM, handled: false,
    }), true);
    assert.equal(transcriptCalls.at(-1).variant, 'planning-a-murder-charming-a-snake');
    assert.equal(condition(player, 'GwLkqx'), true, 'successful attempt keeps its branch answer');
    assert.equal(condition(player, 'XaDmLM'), false);
    action(player, 'MzP-E3');
    assert.equal(player.inventory.getAmount(I.SNAKE_BASKET), 0);
    assert.equal(player.inventory.getAmount(I.SNAKE_BASKET_FULL), 1);

    player.inventory.items.set(I.SNAKE_BASKET, 1);
    Math.random = () => 0.9;
    PluginManager.emitItemOnNpc({ player, npcId: N.SNAKE_5, itemId: I.SNAKE_CHARM, handled: false });
    assert.equal(condition(player, 'XaDmLM'), true, 'failed attempt answers the failure branch');
    assert.equal(condition(player, 'GwLkqx'), false);
  } finally {
    Math.random = realRandom;
    cleanup();
  }
});

test('A coin on the snake charmer money pot is consumed and the charm kit still comes from the transcript', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers;
    const player = playerFixture({ inventory: inventoryFixture(new Map([[I.COINS, 2]])) });
    quest.setStage(player, 18);
    transcriptCalls.length = 0;

    const event = { player, objectId: core.ObjectIdentifiers.MONEY_POT, itemId: I.COINS, handled: false };
    assert.equal(PluginManager.emitItemOnObject(event), true);
    assert.equal(player.inventory.getAmount(I.COINS), 1);
    assert.deepEqual(transcriptCalls.at(-1), {
      npcId: core.NpcIdentifiers.ALI_THE_SNAKE_CHARMER,
      page: 'Ali the Snake Charmer',
      variant: 'standard-dialogue-using-a-coin-on-the-money-pot',
    });
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('The Tough Guy uses its normal willow drop and the champion then rewards the scimitar', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const player = playerFixture();
    quest.setStage(player, 24);
    PluginManager.emitNpcDeath({ killer: player, npcId: N.TOUGH_GUY });
    assert.equal(player.inventory.getAmount(I.WILLOW_BLACKJACK), 0,
      'the quest handler leaves the cache-defined 100% drop to the normal drop system');
    player.inventory.adds(I.WILLOW_BLACKJACK, 1); // Simulate picking up the normal NPC drop.
    PluginManager.emitNpcDeath({ killer: player, npcId: N.TOUGH_GUY });
    assert.equal(player.inventory.getAmount(I.WILLOW_BLACKJACK), 1, 'quest death handling does not duplicate it');

    quest.setStage(player, 25);
    PluginManager.emitNpcDeath({ killer: player, npcId: N.BANDIT_CHAMPION });
    assert.equal(player.inventory.getAmount(I.ADAMANT_SCIMITAR), 1, 'champion drops the scimitar when the willow blackjack is held');
    assert.equal(quest.getStage(player), 26);
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('Completion and saved stages replay canonical varbit 334 through login', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    // The test harness removes the shared QuestRuntime login hook between tests;
    // re-register the same function here so this exercises the real replay path.
    const replay = { pluginName: 'QuestRuntimeReplay', handler: Runtime.sendQuestVarps };
    PluginManager.loginHooks.push(replay);
    try {
      quest.setStage(player, 27);
      assert.equal(player.varbits.get(334), 27);
      player.varbits.clear();
      PluginManager.emitPlayerLogin({ player });
      assert.equal(player.varbits.get(334), 27, 'stage 27 login replay');

      quest.setStage(player, 28);
      player.varbits.clear();
      PluginManager.emitPlayerLogin({ player });
      assert.equal(player.varbits.get(334), 28, 'completed save login replay');

      quest.setStage(player, 0);
      player.varbits.clear();
      PluginManager.emitPlayerLogin({ player });
      assert.equal(player.varbits.get(334), 0, 'unstarted save login replay');
    } finally {
      PluginManager.loginHooks.splice(PluginManager.loginHooks.indexOf(replay), 1);
    }
  } finally {
    cleanup();
  }
});

test('feud_var carries Quest Helper step numbers, not the saved stage, where they differ (#1711)', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    // [saved stage, feud_var Quest Helper reads for the step that comes next]
    const expected = [
      [1, 1], [5, 5], [6, 6], [7, 7],
      [8, 9],   // get the blackjack from Ali
      [9, 9], [10, 10],
      [11, 12], // talk to Ali for the second job
      [12, 13], // hide behind the cactus
      [13, 14], [14, 14], // the heist (door open is varbit 320)
      [15, 15], [16, 16],
      [17, 16], // traitor found (varbit 342), tell Ali
      [18, 17], [19, 18],
      [20, 22], // poison the drink
      [22, 23], [23, 24], [24, 25], [25, 26], [26, 27], [27, 27], [28, 28],
    ];
    for (const [stage, wire] of expected) {
      quest.setStage(player, stage);
      assert.equal(quest.getStage(player), stage, `stage ${stage} is saved as is`);
      assert.equal(player.varbits.get(334), wire, `stage ${stage} sends feud_var ${wire}`);
    }
  } finally {
    cleanup();
  }
});

test('The cactus answers at every stage and only the safe job advances (#1711)', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers;
    const player = playerFixture({ hands: 1059, head: I.DESERT_DISGUISE });
    const hide = () => {
      const event = {
        player, objectId: core.ObjectIdentifiers.CACTUS_7, object: {},
        definition: ObjectDefinition.forId(core.ObjectIdentifiers.CACTUS_7), clickType: 1, handled: false,
      };
      PluginManager.emitObjectInteraction(event);
      return event;
    };
    for (const stage of [0, 11, 16, 28]) {
      quest.setStage(player, stage);
      transcriptCalls.length = 0;
      assert.equal(hide().handled, true, `stage ${stage} plays the cactus transcript`);
      assert.equal(transcriptCalls.at(-1)?.variant, 'staking-out-the-house-hiding-behind-the-cactus');
      assert.equal(condition(player, 'SN-vhR'), true, `stage ${stage} takes the "feel a little silly" branch`);
      action(player, 'KMB_VR');
      assert.equal(quest.getStage(player), stage, `stage ${stage} is not advanced by the cactus`);
    }
    quest.setStage(player, 12);
    assert.equal(hide().handled, true);
    assert.equal(condition(player, 'SN-vhR'), false);
    assert.equal(condition(player, '3PO7Fj'), true);
    action(player, 'KMB_VR');
    assert.equal(quest.getStage(player), 13);
    assert.equal(player.varbits.get(334), 14, 'Quest Helper moves on to opening the door');
  } finally {
    cleanup();
  }
});

test('Post-quest Ali the Operator falls through to the registered standard dialogue runner', () => {
  const { quest, cleanup } = registerQuestPlugin();
  const dialogueRunner = registerNpcDialogueRunner();
  try {
    const player = playerFixture();
    quest.setStage(player, 28);
    transcriptCalls.length = 0;
    const event = npcEvent(player, 'Ali the Operator');
    assert.equal(PluginManager.emitNpcInteraction(event), true);
    assert.equal(event.handled, true);
    assert.equal(transcriptCalls.length, 0, 'post-quest Talk-to does not replay a quest-specific transcript');
    const npcLines = player.dialogueStarts.flatMap((chain) => chain)
      .filter((dialogue) => typeof dialogue.getText === 'function')
      .map((dialogue) => dialogue.getText());
    assert.ok(npcLines.includes('What do you want?'),
      'after the quest hook yields, the real dialogue plugin resolves the canonical standard page');
  } finally {
    dialogueRunner.cleanup();
    cleanup();
  }
});

test('A leader can summon its guard again after a relog while a living guard is not duplicated', () => {
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const N = core.NpcIdentifiers;
    const player = playerFixture();
    quest.setStage(player, 24);
    worldNpcs = [];
    action(player, 'AsCtr4');
    assert.equal(spawned.length, 1);
    action(player, 'AsCtr4');
    assert.equal(spawned.length, 2, 'a lost guard is summoned again by the leader');

    worldNpcs = [{
      getContentId: () => N.TOUGH_GUY,
      getOwner: () => player,
      getLocation: () => player.getLocation(),
    }];
    action(player, 'AsCtr4');
    assert.equal(spawned.length, 2, 'a living guard is not summoned twice');
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('A leader ignores another player’s owner-only guard when summoning their own', () => {
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const N = core.NpcIdentifiers;
    const player = playerFixture();
    const otherPlayer = playerFixture();
    quest.setStage(player, 24);
    worldNpcs = [{
      getContentId: () => N.TOUGH_GUY,
      getOwner: () => otherPlayer,
      getLocation: () => otherPlayer.getLocation(),
    }];

    action(player, 'AsCtr4');
    assert.equal(spawned.length, 1, 'the other player’s guard does not satisfy this encounter');
    assert.equal(spawned[0].getOwner(), player);

    worldNpcs.push(spawned[0]);
    action(player, 'AsCtr4');
    assert.equal(spawned.length, 1, 'the player’s existing guard still prevents a duplicate');
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('Registered handler edges cover the mandatory stage graph from the gang talks to completion', () => {
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;
    const player = playerFixture({
      inventory: inventoryFixture(new Map([[I.COINS, 500], [I.OAK_BLACKJACK, 1]])),
      hands: 1059, head: I.DESERT_DISGUISE, weapon: I.OAK_BLACKJACK,
    });
    worldNpcs = villagerWorld(player).getNpcs();
    transcriptCalls.length = 0;

    // Gang talks, camel purchase, receipts to both gangs -> joined.
    quest.setStage(player, 2);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Menaphite Thug'));
    assert.equal(quest.getStage(player), 2);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Bandit'));
    assert.equal(quest.getStage(player), 3);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Camel Man'));
    action(player, '1JYri1');
    assert.equal(quest.getStage(player), 4);
    assert.equal(player.inventory.getAmount(I.RECEIPT), 2);
    assert.equal(player.inventory.getAmount(I.COINS), 0);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Menaphite Thug'));
    action(player, '-Jb-bz');
    assert.equal(player.inventory.getAmount(I.RECEIPT), 1);
    assert.equal(quest.getStage(player), 4);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Bandit'));
    action(player, 'pHGlPz');
    assert.equal(player.inventory.getAmount(I.RECEIPT), 0);
    assert.equal(quest.getStage(player), 5);

    // Join, first failed pocket, operator advice, urchin, second pocket.
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    PluginManager.emitCustomEvent('npc-dialogue:choice', {
      player, npcId: N.ALI_THE_OPERATOR, option: 'Yes, of course, those bandits should be taught a lesson.',
    });
    assert.equal(quest.getStage(player), 6);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager', 'Pickpocket'));
    assert.equal(quest.getStage(player), 6, 'the scripted first pickpocket fails');
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    assert.equal(quest.getStage(player), 7);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Street urchin'));
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager', 'Pickpocket'));
    assert.equal(quest.getStage(player), 8);
    assert.equal(player.inventory.getAmount(I.COINS), 15);

    // Blackjack, knock-out, third pocket, second job.
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    action(player, 'S1K0jh');
    assert.equal(player.inventory.getAmount(I.OAK_BLACKJACK), 1, 'the equipped blackjack is not duplicated');
    assert.equal(quest.getStage(player), 9);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager', 'Knock-Out'));
    assert.equal(quest.getStage(player), 10);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager', 'Pickpocket'));
    assert.equal(quest.getStage(player), 11);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    assert.equal(quest.getStage(player), 12);

    // Cactus, keys, safe, jewels.
    PluginManager.emitObjectInteraction({
      player, objectId: O.CACTUS_7,
      definition: { getActions: () => ['Hide-behind', null, null, null, null] }, clickType: 1, handled: false,
    });
    action(player, 'KMB_VR');
    assert.equal(quest.getStage(player), 13);
    player.inventory.adds(I.KEYS, 1);
    PluginManager.emitItemOnObject({
      player, objectId: O.DOOR_165, itemId: I.KEYS, handled: false,
    });
    action(player, 'sxI5_2');
    assert.equal(quest.getStage(player), 14);
    PluginManager.emitObjectInteraction({
      player, objectId: O.LANDSCAPE_3,
      definition: { getActions: () => ['Search', null, null, null, null] }, clickType: 1, handled: false,
    });
    action(player, 'Tj1PIq');
    assert.equal(quest.getStage(player), 15);
    assert.equal(player.inventory.getAmount(I.JEWELS), 1);

    // Jewels, traitor, poison chain.
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    action(player, '9K8uBx');
    assert.equal(player.inventory.getAmount(I.JEWELS), 0);
    assert.equal(quest.getStage(player), 16);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Menaphite Thug'));
    assert.equal(quest.getStage(player), 17);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    assert.equal(quest.getStage(player), 18);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Barman'));
    player.inventory.adds(I.SNAKE_BASKET_FULL, 1);
    action(player, 'nEt0jL');
    assert.equal(quest.getStage(player), 19);
    player.inventory.adds(I.UGTHANKI_DUNG, 1);
    action(player, 'TiFd_S');
    assert.equal(quest.getStage(player), 20);
    assert.equal(player.inventory.getAmount(I.HAGS_POISON), 1);
    action(player, 'rQTsZU');
    assert.equal(quest.getStage(player), 22);
    assert.equal(player.inventory.getAmount(I.HAGS_POISON), 0);

    // Report, Tough Guy, Bandit champion, mayor, Ali Morrisane.
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Operator'));
    assert.equal(quest.getStage(player), 23);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Menaphite Leader'));
    assert.equal(quest.getStage(player), 24);
    action(player, 'AsCtr4');
    assert.equal(spawned.length, 1);
    PluginManager.emitNpcDeath({ killer: player, npcId: N.TOUGH_GUY });
    assert.equal(player.inventory.getAmount(I.WILLOW_BLACKJACK), 0,
      'the quest handler does not duplicate the normal NPC drop');
    player.inventory.adds(I.WILLOW_BLACKJACK, 1); // Simulate picking up its cache-defined drop.
    assert.equal(player.inventory.getAmount(I.WILLOW_BLACKJACK), 1);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager'));
    assert.equal(quest.getStage(player), 25);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Bandit Leader'));
    action(player, 'byv5b1');
    PluginManager.emitNpcDeath({ killer: player, npcId: N.BANDIT_CHAMPION });
    assert.equal(quest.getStage(player), 26);
    assert.equal(player.inventory.getAmount(I.ADAMANT_SCIMITAR), 1);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Villager'));
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali the Mayor'));
    assert.equal(quest.getStage(player), 27);
    PluginManager.emitNpcInteraction(npcEvent(player, 'Ali Morrisane'));
    action(player, '_jFbux');
    assert.equal(quest.getStage(player), 28);
    assert.equal(quest.isComplete(player), true);
    assert.equal(player.varbits.get(334), 28, 'the registered completion edge writes canonical varbit 334 = 28');
    assert.equal(player.inventory.getAmount(I.COINS), 530, 'two 15-coin pockets plus the 500-coin reward');
    assert.deepEqual(player.experiences, [{ skill: core.Skill.THIEVING, amount: 15000 }]);
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

const plain = (line) => String(line).replace(/<\/?str>/g, '');
const objectiveText = [
  'Travel to Pollnivneach and question Drunken Ali.',
  'Infiltrate the Pollnivneach gangs and complete the blackjack and Thieving tasks.',
  "Enter the mayor's house in the desert disguise and steal the jewels.",
];

test('The journal lists the three objectives in order and completes them only at their stage edges', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    const journal = (stage) => {
      quest.setStage(player, stage);
      return quest.buildJournal(player, quest);
    };

    const start = journal(0).slice(0, 3);
    assert.deepEqual(start.map(plain), objectiveText);
    assert.ok(start.every((line) => !line.startsWith('<str>')), 'nothing is complete before the quest starts');

    const travelled = journal(2).slice(0, 3);
    assert.equal(travelled[0], `<str>${objectiveText[0]}</str>`);
    assert.equal(travelled[1], objectiveText[1]);
    assert.equal(travelled[2], objectiveText[2]);

    const gang = journal(12).slice(0, 3);
    assert.equal(gang[0], `<str>${objectiveText[0]}</str>`);
    assert.equal(gang[1], `<str>${objectiveText[1]}</str>`);
    assert.equal(gang[2], objectiveText[2]);

    const jewels = journal(15).slice(0, 3);
    assert.deepEqual(jewels, objectiveText.map((text) => `<str>${text}</str>`));

    const complete = journal(28).slice(0, 3);
    assert.deepEqual(complete, objectiveText.map((text) => `<str>${text}</str>`));
  } finally {
    cleanup();
  }
});

test('The start conversation refuses to advance below 30 Thieving', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const hook = (player) => PluginManager.emitCustomEvent('npc-dialogue:hook', {
      hook: 'quest:the-feud:start', npcId: core.NpcIdentifiers.ALI_MORRISANE, player,
    });

    const low = playerFixture({ thieving: 29 });
    hook(low);
    assert.equal(quest.getStage(low), 0);
    assert.ok(low.messages.some((message) => message.includes('30')));

    const ready = playerFixture({ thieving: 30 });
    hook(ready);
    assert.equal(quest.getStage(ready), 1);
  } finally {
    cleanup();
  }
});

test('Early objectives cannot be completed out of order', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers;
    const O = core.ObjectIdentifiers;

    // Camels are bought only after both gang talks.
    const camelBuyer = playerFixture({
      inventory: inventoryFixture(new Map([[I.COINS, 500]])),
    });
    quest.setStage(camelBuyer, 2);
    action(camelBuyer, '1JYri1');
    assert.equal(quest.getStage(camelBuyer), 2, 'the camel purchase needs STAGE_GANGS');
    assert.equal(camelBuyer.inventory.getAmount(I.COINS), 500);
    assert.equal(camelBuyer.inventory.getAmount(I.RECEIPT), 0);
    quest.setStage(camelBuyer, 3);
    action(camelBuyer, '1JYri1');
    assert.equal(quest.getStage(camelBuyer), 4);
    assert.equal(camelBuyer.inventory.getAmount(I.RECEIPT), 2);

    // A receipt cannot be handed over before the camel receipts exist.
    const receipt = playerFixture({
      inventory: inventoryFixture(new Map([[I.RECEIPT, 1]])),
    });
    quest.setStage(receipt, 3);
    action(receipt, '-Jb-bz');
    assert.equal(quest.getStage(receipt), 3);
    assert.equal(receipt.inventory.getAmount(I.RECEIPT), 1, 'the out-of-order hand-in consumes nothing');

    // The blackjack is handed out only after the two pockets.
    const blackjack = playerFixture();
    quest.setStage(blackjack, 7);
    action(blackjack, 'S1K0jh');
    assert.equal(quest.getStage(blackjack), 7);
    assert.equal(blackjack.inventory.getAmount(I.OAK_BLACKJACK), 0);
    quest.setStage(blackjack, 8);
    action(blackjack, 'S1K0jh');
    assert.equal(quest.getStage(blackjack), 9);
    assert.equal(blackjack.inventory.getAmount(I.OAK_BLACKJACK), 1);

    // Joining the gang is its own step: robbing before it does not advance.
    const joined = playerFixture();
    quest.setStage(joined, 5);
    PluginManager.emitNpcInteraction(npcEvent(joined, 'Villager', 'Pickpocket'));
    assert.equal(quest.getStage(joined), 5);

    // The stake-out needs gloves and the disguise.
    const staking = playerFixture();
    quest.setStage(staking, 12);
    action(staking, 'KMB_VR');
    assert.equal(quest.getStage(staking), 12);
    const disguised = playerFixture({ hands: 1059, head: I.DESERT_DISGUISE });
    quest.setStage(disguised, 12);
    action(disguised, 'KMB_VR');
    assert.equal(quest.getStage(disguised), 13);

    // The door needs the keys and the correct stage.
    const door = playerFixture();
    quest.setStage(door, 13);
    action(door, 'sxI5_2');
    assert.equal(quest.getStage(door), 13);
    door.inventory.adds(I.KEYS, 1);
    action(door, 'sxI5_2');
    assert.equal(quest.getStage(door), 14);

    const lockedDoor = playerFixture();
    quest.setStage(lockedDoor, 12);
    const earlyDoor = {
      player: lockedDoor, objectId: O.DOOR_165, object: {}, clickType: 1, handled: false,
      definition: { getName: () => 'Door', getActions: () => ['Open', null, null, null, null] },
    };
    PluginManager.emitObjectInteraction(earlyDoor);
    assert.equal(earlyDoor.handled, true, 'the mayor door stays locked before the stake-out');
    assert.ok(lockedDoor.messages.some((message) => message.includes('locked')));

    // The safe's jewels only come from the interior stage.
    const safe = playerFixture();
    quest.setStage(safe, 13);
    action(safe, 'Tj1PIq');
    assert.equal(quest.getStage(safe), 13);
    assert.equal(safe.inventory.getAmount(I.JEWELS), 0);
    quest.setStage(safe, 14);
    action(safe, 'Tj1PIq');
    assert.equal(quest.getStage(safe), 15);
    assert.equal(safe.inventory.getAmount(I.JEWELS), 1);

    // The jewels hand-in needs them in the inventory.
    const jewels = playerFixture();
    quest.setStage(jewels, 14);
    action(jewels, '9K8uBx');
    assert.equal(quest.getStage(jewels), 14);
    jewels.inventory.adds(I.JEWELS, 1);
    quest.setStage(jewels, 15);
    action(jewels, '9K8uBx');
    assert.equal(quest.getStage(jewels), 16);
    assert.equal(jewels.inventory.getAmount(I.JEWELS), 0);

    // The champion and the final reward refuse later/earlier stages.
    const champion = playerFixture();
    quest.setStage(champion, 24);
    PluginManager.emitNpcDeath({ killer: champion, npcId: core.NpcIdentifiers.BANDIT_CHAMPION });
    assert.equal(quest.getStage(champion), 24);
    assert.equal(champion.inventory.getAmount(I.ADAMANT_SCIMITAR), 0);
    quest.setStage(champion, 25);
    PluginManager.emitNpcDeath({ killer: champion, npcId: core.NpcIdentifiers.BANDIT_CHAMPION });
    assert.equal(quest.getStage(champion), 26);

    const finisher = playerFixture();
    quest.setStage(finisher, 26);
    action(finisher, '_jFbux');
    assert.equal(quest.getStage(finisher), 26);
    assert.equal(quest.isComplete(finisher), false);
    quest.setStage(finisher, 27);
    action(finisher, '_jFbux');
    assert.equal(quest.getStage(finisher), 28);
    assert.equal(quest.isComplete(finisher), true);
  } finally {
    worldNpcs = [];
    cleanup();
  }
});

test('The Feud registers named NPC, object, item and item-on-object interactions', () => {
  const { namedNpcInteractions, namedObjectInteractions, namedItemOnObject, namedItemActions, cleanup } = registerQuestPlugin();
  try {
    for (const name of ['Ali Morrisane', 'Drunken Ali', 'Bandit', 'Menaphite Thug', 'Rug Merchant', 'Villager']) {
      assert.ok(namedNpcInteractions.has(name), `${name} is registered by name`);
    }
    assert.ok(namedNpcInteractions.get('Villager')['Knock-Out']);
    assert.ok(namedNpcInteractions.get('Villager').Lure);

    assert.ok(namedObjectInteractions.get('Cactus')['Hide-behind']);
    assert.ok(namedObjectInteractions.get('Study desk').Search);
    assert.ok(namedObjectInteractions.get('Bed').Search);
    assert.ok(namedObjectInteractions.get('Landscape').Search);
    assert.ok(namedObjectInteractions.get('Door').Open);
    assert.ok(namedObjectInteractions.get('Dung')['Pick-up']);

    assert.ok(namedItemOnObject.some((entry) => entry.item === 'Coins' && entry.object === 'Money Pot'));
    assert.ok(namedItemOnObject.some((entry) => entry.item === 'Red hot sauce' && entry.object === 'Trough'));
    assert.ok(namedItemOnObject.some((entry) => entry.item === 'Bucket' && entry.object === 'Dung'));
    assert.ok(namedItemOnObject.some((entry) => entry.item === 'Hag\'s poison' && entry.object === 'Table'));
    assert.ok(namedItemOnObject.some((entry) => entry.item === 'Keys' && entry.object === 'Door'));

    assert.ok(namedItemActions.get('Oak blackjack').Wield);
    assert.ok(namedItemActions.get('Willow blackjack').Wield);
    assert.ok(namedItemActions.get('Desert disguise').Wear);
    assert.ok(namedItemActions.get('Snake charm').Play);
  } finally {
    cleanup();
  }
});

test('The desert disguise is rebuilt without duplication and quest leftovers are cleaned up', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers;
    const player = playerFixture({
      inventory: inventoryFixture(new Map([
        [I.KHARIDIAN_HEADPIECE, 1], [I.FAKE_BEARD, 1],
      ])),
    });

    PluginManager.emitItemOnItem({
      player, usedItemId: I.KHARIDIAN_HEADPIECE, usedWithItemId: I.FAKE_BEARD, handled: false,
    });
    assert.equal(player.inventory.getAmount(I.DESERT_DISGUISE), 1);
    assert.equal(player.inventory.getAmount(I.KHARIDIAN_HEADPIECE), 0);
    assert.equal(player.inventory.getAmount(I.FAKE_BEARD), 0);

    // A second pair while the disguise is carried does not duplicate or consume it.
    player.inventory.adds(I.KHARIDIAN_HEADPIECE, 1);
    player.inventory.adds(I.FAKE_BEARD, 1);
    PluginManager.emitItemOnItem({
      player, usedItemId: I.KHARIDIAN_HEADPIECE, usedWithItemId: I.FAKE_BEARD, handled: false,
    });
    assert.equal(player.inventory.getAmount(I.DESERT_DISGUISE), 1);
    assert.equal(player.inventory.getAmount(I.KHARIDIAN_HEADPIECE), 1);
    assert.equal(player.inventory.getAmount(I.FAKE_BEARD), 1);
    assert.ok(player.messages.some((message) => message.includes('already have a desert disguise')));

    // Completion keeps the rewards and destroys the quest-only leftovers.
    const completed = playerFixture({
      inventory: inventoryFixture(new Map([
        [I.KEYS, 1], [I.JEWELS, 1], [I.RECEIPT, 1], [I.NOTE, 1], [I.NOTE_2, 1],
        [I.UGTHANKI_DUNG, 1], [I.HAGS_POISON, 1], [I.RED_HOT_SAUCE, 1],
        [I.SNAKE_BASKET_FULL, 1], [I.DESERT_DISGUISE, 1], [I.OAK_BLACKJACK, 1],
      ])),
    });
    quest.setStage(completed, 27);
    action(completed, '_jFbux');
    assert.equal(quest.getStage(completed), 28);
    for (const itemId of [
      I.KEYS, I.JEWELS, I.RECEIPT, I.NOTE, I.NOTE_2,
      I.UGTHANKI_DUNG, I.HAGS_POISON, I.RED_HOT_SAUCE, I.SNAKE_BASKET_FULL,
    ]) {
      assert.equal(completed.inventory.getAmount(itemId), 0, `leftover ${itemId} is cleaned up`);
    }
    assert.equal(completed.inventory.getAmount(I.DESERT_DISGUISE), 1, 'the disguise is a reward');
    assert.equal(completed.inventory.getAmount(I.OAK_BLACKJACK), 1, 'the blackjack is a reward');

    // A save completed before this cleanup hook is cleaned on login too.
    const oldSave = playerFixture({ inventory: inventoryFixture(new Map([[I.KEYS, 1]])) });
    quest.setStage(oldSave, 28);
    PluginManager.emitPlayerLogin({ player: oldSave });
    assert.equal(oldSave.inventory.getAmount(I.KEYS), 0);

    // A player who somehow reached the end without the disguise still gets the
    // quest's disguise reward, once.
    const noDisguise = playerFixture();
    quest.setStage(noDisguise, 27);
    action(noDisguise, '_jFbux');
    assert.equal(noDisguise.inventory.getAmount(I.DESERT_DISGUISE), 1);
  } finally {
    cleanup();
  }
});

test('A full inventory drops the completion disguise through the real container API', () => {
  const { quest, cleanup } = registerQuestPluginReal();
  const realTaskManager = core.TaskManager;
  core.TaskManager = { submit() {} };
  try {
    const player = new Player(null);
    player.setUsername('feud-full-inventory');
    player.setLocation(new core.Location(3361, 2956, 0));
    player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
    player.sendMessage = () => {};

    const inventory = player.getInventory();
    // 27 non-stackable items plus a coin stack fill all 28 slots.
    for (let index = 0; index < 27; index++) inventory.adds(core.ItemIdentifiers.BONES, 1);
    inventory.adds(core.ItemIdentifiers.COINS, 1000);
    assert.equal(inventory.getFreeSlots(), 0, 'the inventory starts full');

    quest.setStage(player, 27);
    PluginManager.emitCustomEvent('npc-dialogue:action', { player, stepId: '_jFbux', handled: false });

    assert.equal(quest.getStage(player), 28);
    assert.equal(inventory.getAmount(core.ItemIdentifiers.DESERT_DISGUISE), 0,
      'a full inventory keeps the reward on the ground');
    const ground = ItemOnGroundManager.getGroundItem(
      player.getUsername(),
      core.ItemIdentifiers.DESERT_DISGUISE,
      player.getLocation(),
      player.getPrivateArea(),
    );
    assert.ok(ground, 'forceAdd(player, item) registers the disguise at the reward location');
    assert.equal(ground.getItem().getAmount(), 1);
  } finally {
    core.TaskManager = realTaskManager;
    cleanup();
  }
});

test('Named mayor-house searches ignore same-named objects outside Pollnivneach', () => {
  const { quest, cleanup } = registerQuestPluginReal();
  try {
    const player = playerFixture();
    quest.setStage(player, 14);
    transcriptCalls.length = 0;

    const emit = (objectId, definition, clickType) => {
      const event = { player, objectId, object: {}, definition, clickType, handled: false };
      PluginManager.emitObjectInteraction(event);
      return event;
    };
    const synthetic = (name, action) => ({
      getName: () => name,
      getInteractions: () => [action, null, null, null, null],
    });

    // Cache-backed same-name locs: Bed 2907 (second-click Search) and Study
    // desk 2714 are not the mayor's house objects.
    const unrelatedBed = ObjectDefinition.forId(2907);
    assert.equal(unrelatedBed.getName(), 'Bed');
    assert.equal(unrelatedBed.getInteractions()[1], 'Search');
    assert.equal(emit(2907, unrelatedBed, 2).handled, false);
    assert.equal(emit(2714, ObjectDefinition.forId(2714), 1).handled, false);
    assert.equal(transcriptCalls.length, 0);

    // The other names have no second quest loc with the same action, so
    // exercise the id guard with the registered name/action shape.
    assert.equal(emit(891, synthetic('Landscape', 'Search'), 1).handled, false);
    assert.equal(emit(608, synthetic('Study desk', 'Search'), 1).handled, false);
    assert.equal(emit(417, synthetic('Bed', 'Search'), 1).handled, false);
    assert.equal(transcriptCalls.length, 0);

    // The canonical mayor's-house objects still play their transcripts. The
    // landscape's first search opens the safe dial, so it only proves handled.
    assert.equal(emit(6274, ObjectDefinition.forId(6274), 1).handled, true);
    assert.equal(transcriptCalls.at(-1).variant, 'breaking-and-entering-searching-the-mayor-s-bed');
    assert.equal(emit(6275, ObjectDefinition.forId(6275), 1).handled, true);
    assert.equal(transcriptCalls.at(-1).variant, 'breaking-and-entering-searching-the-mayor-s-study-desk');
    assert.equal(emit(6276, ObjectDefinition.forId(6276), 1).handled, true);
    assert.ok(player.messages.some((message) => message.includes('nondescript picture')));

    // The cactus is only usable during the stake-out stages.
    quest.setStage(player, 13);
    assert.equal(emit(1396, synthetic('Cactus', 'Hide-behind'), 1).handled, false);
    assert.equal(transcriptCalls.length, 2);
    assert.equal(emit(6277, ObjectDefinition.forId(6277), 1).handled, true);
    assert.equal(transcriptCalls.at(-1).variant, 'staking-out-the-house-hiding-behind-the-cactus');
  } finally {
    cleanup();
  }
});
