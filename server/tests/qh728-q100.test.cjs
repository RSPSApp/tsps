// Rum Deal (q100) source-contract checks. The quest's legs, stages, scenes and words are checked against
// the user's revision 242 capture in tests/rum-deal-capture.test.cjs (real Player and packets); what stays
// here is the lost-blindweed replacement and Recipe for Disaster's share of Pirate Pete.
// From server/: node --test tests/qh728-q100.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.ObjectDefinition.init();
});

const BRAINDEATH = core.NpcIdentifiers.CAPTAIN_BRAINDEATH;
const PETE = core.NpcIdentifiers.PIRATE_PETE;
const DAVEY = core.NpcIdentifiers.DAVEY;
const DONNIE = core.NpcIdentifiers.CAPTAIN_DONNIE;
const PATCH = 10096;
const HOPPER = 10170;
const BARREL = 10171;
const LEVER = 10164;
const CONTROL = 10104;
const LAKE = 10105;
const TAP = 10148;

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    adds(id, amount = 1) {
      for (let placed = 0; placed < amount; placed++) {
        if (free <= 0) return;
        free--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) {
        if (items.delete(id)) free++;
      } else {
        items.set(id, left);
      }
    },
    forceAdd(id) { items.set(id, (items.get(id) ?? 0) + 1); },
  };
}

function playerFixture(inventory = inventoryFixture()) {
  const attributes = new Map();
  const messages = [];
  const varbits = [];
  const configs = [];
  const experiences = [];
  let location = new core.Location(3680, 3537, 0);
  const sender = new Proxy({}, {
    get(_target, key) {
      if (key === 'sendVarbit') return (id, value) => { varbits.push([id, value]); };
      if (key === 'sendConfig') return (id, value) => { configs.push([id, value]); };
      if (key === 'getVarbit') return (id) => varbits.filter(([entry]) => entry === id).at(-1)?.[1] ?? 0;
      if (key === 'getVarp') return (id) => configs.filter(([entry]) => entry === id).at(-1)?.[1] ?? 0;
      return () => sender;
    },
  });
  const player = {
    inventory,
    messages,
    varbits,
    configs,
    experiences,
    getUsername: () => 'qh728-q100',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      addExperiences(skill, amount) { experiences.push([skill, amount]); },
    }),
    getLocation: () => location,
    moveTo: (destination) => { location = destination; },
    performAnimation() {},
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    getSession: () => ({ isTileInScene: () => false }),
  };
  return player;
}

function snapshot() {
  return {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    object: PluginManager.objectInteractionHooks.length,
    death: PluginManager.npcDeathHooks.length,
    login: PluginManager.loginHooks.length,
    logout: PluginManager.logoutHooks.length,
    order: PluginManager.nextObjectHookOrder,
  };
}

// Registers real quest plugin sources into the real PluginManager hook arrays.
const START_QUESTS = new Set(['zogre_flesh_eaters', 'priest_in_peril']);

function registerQuestPlugin(name, pluginName, questKey) {
  const before = snapshot();
  const customEvents = new Set();
  const spawned = [];
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    if (key === 'onNpcInteraction') return (...args) => {
      const [names, actions] = args;
      if (typeof names === 'function') {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: names });
        return;
      }
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: (event) => {
          if (event.handled || event.definition?.getName?.() !== names) return;
          if (event.definition.getActions?.()[event.clickType - 1] !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onObjectInteraction') return (...args) => {
      const [names, actions] = args;
      const order = PluginManager.nextObjectHookOrder++;
      if (typeof names === 'function') {
        PluginManager.objectInteractionHooks.push({ pluginName, order, handler: names });
        return;
      }
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.objectInteractionHooks.push({ pluginName, order, handler: (event) => {
          if (event.handled) return;
          if (event.definition?.getInteractions?.()[event.clickType - 1] !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onItemOnObject') return (handler) => PluginManager.itemOnObjectHooks.push({ pluginName, handler });
    if (key === 'onItemOnItem') return (handler) => PluginManager.itemOnItemHooks.push({ pluginName, handler });
    if (key === 'onItemOnNpc') return (handler) => PluginManager.itemOnNpcHooks.push({ pluginName, handler });
    if (key === 'onItemAction') return (...args) => {
      if (typeof args[0] === 'string') {
        const actions = args[1] ?? {};
        PluginManager.itemActionHooks.push({ pluginName, handler: (event) => {
          const action = actions[event.option];
          if (!action) return;
          if (action(event) !== false) event.handled = true;
        } });
      } else {
        PluginManager.itemActionHooks.push({ pluginName, handler: args[0] });
      }
    };
    if (key === 'onNpcDeath') return (handler) => PluginManager.npcDeathHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogin') return (handler) => PluginManager.loginHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogout') return (handler) => PluginManager.logoutHooks.push({ pluginName, handler });
    if (key === 'onCustomEvent') return (eventName, handler) => {
      customEvents.add(eventName);
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => {
      // Zogre Flesh Eaters and Priest in Peril are the start requirements.
      if (eventName === 'quest:is-complete' && START_QUESTS.has(payload?.key)) {
        payload.complete = true;
        return;
      }
      PluginManager.emitCustomEvent(eventName, payload);
    };
    if (key === 'spawnNpc') return (def) => {
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, isRegistered: () => true };
      spawned.push(npc);
      return npc;
    };
    if (key === 'removeNpc') return () => {};
    if (key === 'getTaskManager') return () => ({ submit: () => {} });
    if (key === 'getWorld') return () => ({ getNpcs: () => new Map() });
    return () => {};
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return {
    spawned,
    quest: getRegisteredQuests().findLast((entry) => entry.key === questKey),
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.itemOnItemHooks.length = before.itemOnItem;
      PluginManager.itemOnNpcHooks.length = before.itemOnNpc;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.itemActionHooks.length = before.itemAction;
      PluginManager.objectInteractionHooks.length = before.object;
      PluginManager.npcDeathHooks.length = before.death;
      PluginManager.loginHooks.length = before.login;
      PluginManager.logoutHooks.length = before.logout;
      PluginManager.nextObjectHookOrder = before.order;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

function eventApi(player) {
  return {
    line: (npcId, text) => {
      const event = { player, npcId, text, handled: false };
      PluginManager.emitCustomEvent('npc-dialogue:line', event);
      return event;
    },
    action: (npcId, stepId) => {
      const event = { player, npcId, stepId, handled: false };
      PluginManager.emitCustomEvent('npc-dialogue:action', event);
      return event;
    },
    condition: (npcId, stepId) => {
      const event = { player, npcId, stepId, handled: false };
      PluginManager.emitCustomEvent('npc-dialogue:condition', event);
      return event;
    },
    choice: (npcId, option) => PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npcId, option, handled: false }),
    variant: (npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId }),
    answer: (npcId, text, stepId) => PluginManager.emitNpcDialogueCondition({ player, npcId, text, stepId }),
    itemOnObject: (itemId, objectId) => PluginManager.emitItemOnObject({
      player, itemId, objectId, object: { getId: () => objectId }, handled: false,
    }),
    object: (objectId, clickType, interactions) => PluginManager.emitObjectInteraction({
      player,
      object: { getId: () => objectId, getDefinition: () => ({ getName: () => 'Fixture object', getActions: () => interactions, getInteractions: () => interactions }) },
      objectId,
      clickType,
      definition: { getName: () => 'Fixture object', getActions: () => interactions, getInteractions: () => interactions },
      location: new core.Location(2162, 5069, 0),
      handled: false,
    }),
  };
}

test('lost blindweed before the hopper is replaced by Braindeath', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const inventory = inventoryFixture();
    const player = playerFixture(inventory);
    const e = eventApi(player);
    quest.setStage(player, 6);

    e.line(BRAINDEATH, "Here, I was savin' a little fer an emergency, so take this and shove it in the hopper before I bung ye in there and turn the handle!");
    assert.equal(inventory.getAmount(I.BLINDWEED), 1);
    assert.equal(quest.getStage(player), 6, 'the replacement does not skip the hopper step');
  } finally {
    cleanup();
  }
});

test('Recipe for Disaster keeps the shared Pirate Pete hand-in', () => {
  const rfd = registerQuestPlugin('RecipeForDisaster', 'RfdTest', 'recipe_for_disaster');
  const rum = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const player = playerFixture();
    // The frozen council only answers in the RFD dining room (beside Pete at 1862,5347).
    player.moveTo(new core.Location(1862, 5346, 0));
    rfd.quest.setStage(player, 4);
    rum.quest.setStage(player, 1);
    const pages = [
      { page: 'Recipe for Disaster/Freeing Pirate Pete', variants: ['starting-out-inspecting-pirate-pete'] },
      { page: 'Rum Deal', variants: ['setting-out-talking-to-pirate-pete-talking-to-pete-again'] },
    ];
    const variant = PluginManager.emitNpcDialogueVariant({
      player, npcId: core.NpcIdentifiers.PIRATE_PETE_3, pages,
    });
    assert.equal(variant?.page, 'Recipe for Disaster/Freeing Pirate Pete');
    assert.equal(variant?.variant, 'starting-out-inspecting-pirate-pete');
  } finally {
    rum.cleanup();
    rfd.cleanup();
  }
});
