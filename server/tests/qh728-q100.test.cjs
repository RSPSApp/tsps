// Rum Deal (q100) source-contract checks.
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
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
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

test('login replays the saved stage and the patch transform', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const player = playerFixture();
    quest.setStage(player, 12);
    player.configs.length = 0;
    player.varbits.length = 0;
    PluginManager.emitPlayerLogin({ player });
    assert.ok(player.configs.some(([id, value]) => id === 600 && value === 12), 'saved stage is re-sent on login');

    player.setAttribute('quest.rum_deal.weeded', 1);
    player.setAttribute('quest.rum_deal.planted', 0);
    player.varbits.length = 0;
    PluginManager.emitPlayerLogin({ player });
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 3], 'a raked patch is restored as stage 3');

    player.setAttribute('quest.rum_deal.weeded', 0);
    player.setAttribute('quest.rum_deal.planted', Date.now() - 61000);
    player.varbits.length = 0;
    PluginManager.emitPlayerLogin({ player });
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 5], 'a grown patch is restored as stage 5');
  } finally {
    cleanup();
  }
});

test('Rum Deal runs every mandatory leg from fresh stage 0 to completion', () => {
  const { quest, spawned, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  const originalNow = Date.now;
  try {
    assert.ok(quest, 'Rum Deal registered');
    const I = core.ItemIdentifiers;
    const N = core.NpcIdentifiers;
    const inventory = inventoryFixture();
    const player = playerFixture(inventory);
    const e = eventApi(player);

    assert.equal(quest.getStage(player), 0);
    e.choice(N.PIRATE_PETE, 'Nonsense! Keep the money!');
    assert.equal(quest.getStage(player), 1, 'accepting the quest starts it');

    e.action(N.PIRATE_PETE, 'XU0tPW');
    assert.equal(quest.getStage(player), 2, 'Pete knocks the player out');
    e.action(N.PIRATE_PETE, 'ZTlTFa');
    assert.deepEqual(
      [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
      [2144, 5108, 1],
      'cutscene wake tile is next to Captain Braindeath'
    );

    assert.equal(e.variant(N.CAPTAIN_BRAINDEATH), 'setting-out-cutscene-1');
    e.action(N.CAPTAIN_BRAINDEATH, '3cIEz2');
    e.line(N.CAPTAIN_BRAINDEATH, "Try hecklin' 'em from a distance. Those Swabs may talk a good fight...");
    assert.equal(quest.getStage(player), 4, 'meeting hands over the blindweed seed');
    assert.equal(inventory.getAmount(I.BLINDWEED_SEED), 1);

    e.action(N.CAPTAIN_BRAINDEATH, 'NVQ0oi');
    e.action(N.CAPTAIN_BRAINDEATH, 'YTdGv2');
    assert.equal(inventory.getAmount(I.RAKE), 1);
    assert.equal(inventory.getAmount(I.SEED_DIBBER), 1);

    e.itemOnObject(I.RAKE, PATCH);
    assert.equal(player.getAttribute('quest.rum_deal.weeded'), 1);
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 3], 'raked patch uses the cache/helper stage 3');
    e.itemOnObject(I.BLINDWEED_SEED, PATCH);
    assert.equal(inventory.getAmount(I.BLINDWEED_SEED), 0);
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 4], 'planted patch uses the cache/helper stage 4');

    Date.now = () => originalNow() + 61000;
    e.object(10102, 1, ['Pick', 'Inspect', null, null, null]);
    Date.now = originalNow;
    assert.equal(quest.getStage(player), 5, 'harvesting the grown blindweed advances the quest');
    assert.equal(inventory.getAmount(I.BLINDWEED), 1);
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 0], 'harvesting clears the patch child');

    assert.equal(e.variant(N.CAPTAIN_BRAINDEATH), 'brewing-rum-talking-to-captain-braindeath-after-getting-blindweed');
    e.line(N.CAPTAIN_BRAINDEATH, 'Splendid, [lad/lass]! Go shove it in the Intake Hopper upstairs.');
    assert.equal(quest.getStage(player), 6);

    e.itemOnObject(I.BLINDWEED, HOPPER);
    assert.equal(quest.getStage(player), 7);
    assert.equal(inventory.getAmount(I.BLINDWEED), 0);
    e.line(N.CAPTAIN_BRAINDEATH, "Well, now ye've shoved the Blindweed into the mix, what we need is a bucket of stagnant water.");
    assert.equal(quest.getStage(player), 8);

    assert.equal(e.answer(N.CAPTAIN_BRAINDEATH, "If the player doesn't have an empty bucket:", 'pP1VEs'), true);
    e.action(N.CAPTAIN_BRAINDEATH, 'tiEDJT');
    assert.equal(inventory.getAmount(I.BUCKET), 1, 'Braindeath supplies the water bucket');

    e.itemOnObject(I.BUCKET, LAKE);
    assert.equal(quest.getStage(player), 9);
    assert.equal(inventory.getAmount(I.BUCKET_OF_WATER_3), 1);
    e.itemOnObject(I.BUCKET_OF_WATER_3, HOPPER);
    assert.equal(quest.getStage(player), 10);
    assert.equal(inventory.getAmount(I.BUCKET), 1, 'the hopper returns the empty bucket');

    assert.equal(e.variant(N.CAPTAIN_BRAINDEATH), 'sluglings-talking-to-captain-braindeath-after-using-the-water-on-the-hopper');
    assert.equal(e.answer(N.CAPTAIN_BRAINDEATH, 'If the player has inventory space:', 'Sy3jOe'), true);
    e.condition(N.CAPTAIN_BRAINDEATH, 'Sy3jOe');
    assert.equal(quest.getStage(player), 11);
    assert.equal(inventory.getAmount(I.FISHBOWL_AND_NET), 1);

    inventory.adds(I.SLUGLINGS, 5); // fixture: the five catches the fishing loop would land
    for (let i = 0; i < 5; i++) e.itemOnObject(I.SLUGLINGS, BARREL);
    assert.equal(player.getAttribute('quest.rum_deal.slugs'), 5);
    e.object(LEVER, 1, ['Pull', null, null, null, null]);
    assert.equal(quest.getStage(player), 12, 'pressurising the barrel advances the quest');
    assert.equal(player.getAttribute('quest.rum_deal.slugs'), 0);

    e.line(N.CAPTAIN_BRAINDEATH, 'Give the controls a couple of belts with this wrench.');
    assert.equal(quest.getStage(player), 13);
    assert.equal(inventory.getAmount(I.WRENCH), 1);

    assert.equal(e.variant(N.DAVEY), 'evil-spirit-talking-to-davey');
    assert.equal(e.answer(N.DAVEY, 'If the player does not have 47 Prayer points:', '-lUZ8N'), false);
    e.action(N.DAVEY, 'JGzwnf');
    assert.equal(inventory.getAmount(I.WRENCH), 0);
    assert.equal(inventory.getAmount(I.HOLY_WRENCH), 1, 'Davey blesses the wrench');

    e.itemOnObject(I.HOLY_WRENCH, CONTROL);
    assert.ok(spawned.some((npc) => npc.def.id === N.EVIL_SPIRIT), 'smiting the controls spawns the Evil Spirit');
    PluginManager.emitNpcDeath({ killer: player, npcId: N.EVIL_SPIRIT });
    assert.equal(quest.getStage(player), 14, 'killing the Evil Spirit advances the quest');

    e.line(N.CAPTAIN_BRAINDEATH, 'We need the body of a diseased Fever Spider!');
    assert.equal(quest.getStage(player), 15);
    PluginManager.emitNpcDeath({ killer: player, npcId: N.FEVER_SPIDER });
    assert.equal(inventory.getAmount(I.FEVER_SPIDER_BODY), 1);
    e.itemOnObject(I.FEVER_SPIDER_BODY, HOPPER);
    assert.equal(quest.getStage(player), 16);

    e.action(N.CAPTAIN_BRAINDEATH, 'YrOgJF');
    assert.equal(quest.getStage(player), 17, 'the brewing control rumbles');
    assert.ok(inventory.getAmount(I.BUCKET) >= 1);

    e.itemOnObject(I.BUCKET, TAP);
    assert.equal(inventory.getAmount(I.UNSANITARY_SWILL), 1);
    assert.equal(inventory.getAmount(I.BUCKET), 0);
    assert.equal(e.variant(N.CAPTAIN_DONNIE), 'dissolving-the-protest-talking-to-captain-donnie');
    e.action(N.CAPTAIN_DONNIE, 'fVhhrc');
    assert.equal(quest.getStage(player), 18, "Donnie drinks the 'rum'");
    assert.equal(inventory.getAmount(I.UNSANITARY_SWILL), 0, 'Donnie consumes the swill');

    assert.equal(e.variant(N.CAPTAIN_BRAINDEATH), 'dissolving-the-protest-talking-to-captain-braindeath-after-talking-to-captain-donnie');
    e.action(N.CAPTAIN_BRAINDEATH, '8lDSvO');
    assert.equal(quest.getStage(player), 19, 'completion reaches the cache threshold');
    assert.equal(quest.isComplete(player), true);
    assert.ok(player.configs.some(([id, value]) => id === 600 && value === 19), 'varp 600 is sent as 19');
    assert.equal(inventory.getAmount(I.HOLY_WRENCH), 1, 'completion does not duplicate the blessed wrench');
    assert.equal(player.experiences.filter(([skill, amount]) => amount === 7000).length, 3);
    assert.equal(Number(player.getAttribute('quest.points')), 2);

    const completedXp = player.experiences.length;
    const completedItems = inventory.getAmount(I.HOLY_WRENCH);
    e.action(N.CAPTAIN_BRAINDEATH, '8lDSvO');
    assert.equal(player.experiences.length, completedXp, 'repeat completion grants no more XP');
    assert.equal(inventory.getAmount(I.HOLY_WRENCH), completedItems, 'repeat completion grants no more items');
    assert.equal(Number(player.getAttribute('quest.points')), 2);
  } finally {
    Date.now = originalNow;
    cleanup();
  }
});

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

test('a bucket lost after the spider step is replaced at the swill stage', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const inventory = inventoryFixture();
    const player = playerFixture(inventory);
    const e = eventApi(player);
    quest.setStage(player, 17);

    e.line(BRAINDEATH, "And don't ferget the 'rum'!");
    assert.equal(inventory.getAmount(I.BUCKET), 1);
    assert.equal(quest.getStage(player), 17);
  } finally {
    cleanup();
  }
});

test('Captain Donnie consumes the unsanitary swill he drinks', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const inventory = inventoryFixture(new Map([[I.UNSANITARY_SWILL, 1]]));
    const player = playerFixture(inventory);
    const e = eventApi(player);
    quest.setStage(player, 17);

    e.action(DONNIE, 'fVhhrc');
    assert.equal(quest.getStage(player), 18);
    assert.equal(inventory.getAmount(I.UNSANITARY_SWILL), 0, 'the swill is not kept after the hand-in');
  } finally {
    cleanup();
  }
});

test('completion does not duplicate the holy wrench and rewards once', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const inventory = inventoryFixture(new Map([[I.HOLY_WRENCH, 1]]));
    const player = playerFixture(inventory);
    const e = eventApi(player);
    quest.setStage(player, 18);

    e.action(BRAINDEATH, '8lDSvO');
    assert.equal(quest.isComplete(player), true);
    assert.equal(inventory.getAmount(I.HOLY_WRENCH), 1, 'the blessed wrench is not granted a second time');
    assert.equal(player.experiences.filter(([, amount]) => amount === 7000).length, 3);
    assert.equal(Number(player.getAttribute('quest.points')), 2);

    e.action(BRAINDEATH, '8lDSvO');
    assert.equal(inventory.getAmount(I.HOLY_WRENCH), 1);
    assert.equal(player.experiences.filter(([, amount]) => amount === 7000).length, 3, 'repeat completion rewards nothing');
    assert.equal(Number(player.getAttribute('quest.points')), 2);
  } finally {
    cleanup();
  }
});

test('the 50% Luke gate pass-through only runs at the water stage', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const player = playerFixture();
    const gate = { x: 2120, y: 5098, z: 0 };
    const click = () => PluginManager.emitObjectInteraction({
      player,
      object: { getId: () => 10172, getDefinition: () => ({ getName: () => 'Gate', getActions: () => ['Open', null, null, null, null], getInteractions: () => ['Open', null, null, null, null] }) },
      objectId: 10172,
      clickType: 1,
      definition: { getName: () => 'Gate', getActions: () => ['Open', null, null, null, null], getInteractions: () => ['Open', null, null, null, null] },
      location: gate,
      handled: false,
    });

    quest.setStage(player, 7);
    assert.equal(click(), false, 'the gate is not owned before the water step');
    assert.equal(player.getLocation().getY(), 3537);

    quest.setStage(player, 8);
    assert.equal(click(), true, 'the gate passes the player at the water stage');
    assert.equal(player.getLocation().getY(), 5099);
  } finally {
    cleanup();
  }
});

test('the blindweed patch root resolves to its grown child before Inspect/Pick', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const player = playerFixture();
    quest.setStage(player, 4);
    player.setAttribute('quest.rum_deal.weeded', 1);
    player.setAttribute('quest.rum_deal.planted', Date.now() - 61000);
    PluginManager.emitPlayerLogin({ player });
    assert.deepEqual(player.varbits.filter(([id]) => id === 1366).at(-1), [1366, 5]);

    const rootDefinition = {
      getName: () => 'null',
      getActions: () => [null, null, null, null, null],
      getInteractions: () => [null, null, null, null, null],
    };
    const click = (clickType) => PluginManager.emitObjectInteraction({
      player,
      object: { getId: () => PATCH, getDefinition: () => rootDefinition },
      objectId: PATCH,
      clickType,
      definition: rootDefinition,
      location: new core.Location(2162, 5069, 0),
      handled: false,
    });

    click(2);
    assert.equal(quest.getStage(player), 4, 'Inspect on the root does not pick the crop');
    assert.equal(player.inventory.getAmount(I.BLINDWEED), 0);
    assert.ok(player.messages.some((message) => message.includes('fully grown')));

    click(1);
    assert.equal(quest.getStage(player), 5, 'Pick on the root harvests via the resolved child');
    assert.equal(player.inventory.getAmount(I.BLINDWEED), 1);
  } finally {
    cleanup();
  }
});

test('a full bag keeps the seed and the stage at the no-room state', () => {
  const { quest, cleanup } = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const I = core.ItemIdentifiers;
    const inventory = inventoryFixture(new Map([[core.ItemIdentifiers.BONES, 28]]), 0);
    const player = playerFixture(inventory);
    const e = eventApi(player);
    quest.setStage(player, 2);

    e.line(BRAINDEATH, "Try hecklin' 'em from a distance. Those Swabs may talk a good fight...");
    assert.equal(quest.getStage(player), 3, 'no room records the met-Braindeath state');
    assert.equal(inventory.getAmount(I.BLINDWEED_SEED), 0);
  } finally {
    cleanup();
  }
});

test('Recipe for Disaster keeps the shared Pirate Pete hand-in', () => {
  const rfd = registerQuestPlugin('RecipeForDisaster', 'RfdTest', 'recipe_for_disaster');
  const rum = registerQuestPlugin('RumDeal', 'RumDealTest', 'rum_deal');
  try {
    const player = playerFixture();
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
