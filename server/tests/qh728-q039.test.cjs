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

function playerFixture({ inventory = inventoryFixture(), hands = null, head = null, weapon = null } = {}) {
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
      getMaxLevel: () => 99,
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
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    npcDeath: PluginManager.npcDeathHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    login: PluginManager.loginHooks.length,
  };
  const pluginName = 'TheFeudTest';
  const spawned = [];
  const customEvents = new Set();
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcInteraction') return (names, actions) => {
      const wanted = new Set([].concat(names));
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
    if (key === 'onObjectInteraction') return (handler) => {
      PluginManager.objectInteractionHooks.push({ pluginName, handler });
    };
    if (key === 'onItemOnObject') return (handler) => {
      PluginManager.itemOnObjectHooks.push({ pluginName, handler });
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
    cleanup() {
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.objectInteractionHooks.length = before.objectInteraction;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.itemOnNpcHooks.length = before.itemOnNpc;
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
    action(player, 'nEt0jL');
    assert.equal(quest.getStage(player), 19);
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
