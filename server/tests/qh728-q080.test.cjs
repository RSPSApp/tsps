// Murder Mystery (q080) source-contract checks.
// From server/: node --test tests/qh728-q080.test.cjs
//
// The quest plugin registers through the real PluginManager hook arrays and the
// tests dispatch through PluginManager.emit* / emitCustomEvent. Transcript
// playback itself is shared NpcDialogues code and is intercepted by the
// module-level recorder. Fixture-started stages/attributes are labelled; live
// playthrough and the visual Quest Helper overlay are not claimed.
//
// The shared guard regression registers King's Ransom first and proves it
// yields guard4218 until Murder Mystery completes. Spawned mansion ids6194–6200
// use Murder Mystery's explicit first-click transcript handler.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const transcripts = [];
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
after(() => { runtime.startTranscript = originalStartTranscript; });

const MURDERER = 'quest.murder_mystery.murderer';
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const PLUGIN = 'MurderMysteryTest';
const STACKABLE = new Set([I.COINS]);

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  for (const id of items.keys()) if (!STACKABLE.has(id)) free--;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    // This fixture has no slot order, so an item's id stands in for its slot.
    getSlot: (slot) => ((items.get(slot) ?? 0) > 0 ? slot : -1),
    getSlotForItemId: (id) => ((items.get(id) ?? 0) > 0 ? id : -1),
    setItem(slot, item) {
      this.deleteNumber(slot, 1);
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + 1);
      if (!STACKABLE.has(item.getId())) free--;
      return this;
    },
    refreshItems() { return this; },
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    setFreeSlots: (value) => { free = value; },
    adds(id, amount = 1) {
      if (STACKABLE.has(id)) {
        items.set(id, (items.get(id) ?? 0) + amount);
        return true;
      }
      let placed = 0;
      for (; placed < amount && free > 0; placed++) {
        free--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
      return placed === amount;
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) {
        if (items.delete(id) && !STACKABLE.has(id)) free++;
      } else {
        items.set(id, left);
      }
      return true;
    },
    forceAdd(_player, item) {
      const id = item.getId();
      const amount = item.getAmount();
      if (STACKABLE.has(id) && items.has(id)) {
        items.set(id, items.get(id) + amount);
        return true;
      }
      if (free > 0 || STACKABLE.has(id)) {
        if (!STACKABLE.has(id)) free--;
        items.set(id, (items.get(id) ?? 0) + amount);
        return true;
      }
      return false;
    },
  };
}

function registerMurderMystery({ kingsRansomFirst = false } = {}) {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    object: PluginManager.objectInteractionHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    login: PluginManager.loginHooks.length,
  };
  const customEvents = new Set();
  const questCore = { ...core, CountdownTask: undefined, TaskManager: undefined };
  const api = new Proxy({ core: questCore }, {
    get(target, key) {
      if (key in target) return target[key];
      switch (key) {
        case 'persistAttribute':
          return () => {};
        case 'onNpcDialogueVariant':
          return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName: PLUGIN, handler });
        case 'onNpcDialogueCondition':
          return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName: PLUGIN, handler });
        case 'onNpcInteraction':
          return PluginManager.createApi(PLUGIN).onNpcInteraction;
        case 'onNpcFirstClick':
          return (npcIds, handler) => {
            const ids = new Set(Array.isArray(npcIds) ? npcIds : [npcIds]);
            PluginManager.npcInteractionHooks.push({
              pluginName: PLUGIN,
              handler: (event) => {
                if (!event || event.handled || event.clickType !== 1 || !ids.has(event.npcId)) return;
                if (handler(event) !== false) event.handled = true;
              },
            });
          };
        case 'onObjectInteraction':
          return (handler) => PluginManager.objectInteractionHooks.push({
            pluginName: PLUGIN,
            order: ++PluginManager.nextObjectHookOrder,
            handler,
          });
        case 'onItemOnItem':
          return (handler) => PluginManager.itemOnItemHooks.push({ pluginName: PLUGIN, handler });
        case 'onItemOnObject':
          return PluginManager.createApi(PLUGIN).onItemOnObject;
        case 'onPlayerLogin':
          return (handler) => PluginManager.loginHooks.push({ pluginName: PLUGIN, handler });
        case 'onCustomEvent':
          return (eventName, handler) => {
            customEvents.add(eventName);
            const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
            hooks.push({ pluginName: PLUGIN, handler });
            PluginManager.customEventHooks.set(eventName, hooks);
          };
        case 'emitCustomEvent':
          return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
        default:
          return () => {};
      }
    },
  });

  if (kingsRansomFirst) require('../plugins/quests/quests/KingsRansom.Quest')(api);
  require('../plugins/quests/quests/MurderMystery.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'murder_mystery');

  return {
    quest,
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.objectInteractionHooks.length = before.object;
      PluginManager.itemOnItemHooks.length = before.itemOnItem;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.loginHooks.length = before.login;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== PLUGIN);
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

function playerFixture(inventory = inventoryFixture()) {
  const attributes = new Map();
  const messages = [];
  const configs = [];
  const experience = [];
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === 'sendConfig') return (id, value) => { configs.push({ id, value }); return sender; };
    if (key === 'sendVarbit') return (id, value) => { configs.push({ id, value, varbit: true }); return sender; };
    return () => sender;
  } });
  const player = {
    inventory,
    attributes,
    messages,
    configs,
    experience,
    getUsername: () => 'qh728-q080',
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues() {} }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => experience.push([skill, amount]) }),
    getLocation: () => new core.Location(2741, 3561, 0),
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

const configValues = (player, id) => player.configs.filter((entry) => entry.id === id).map((entry) => entry.value);
const lastConfig = (player, id) => configValues(player, id).at(-1);

function firstClick(player, npcId) {
  const event = { player, npcId, clickType: 1, handled: false,
    npc: { getId: () => npcId }, definition: { getName: () => '', getActions: () => ['Talk-to'] } };
  PluginManager.emitNpcInteraction(event);
  return event;
}
function hook(player, npcId, name) {
  PluginManager.emitCustomEvent('npc-dialogue:hook', { player, npcId, hook: name, handled: false });
}
const variant = (player, npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId });

test('King\'s Ransom registered first leaves the mansion guard to unfinished Murder Mystery', () => {
  const { quest, cleanup } = registerMurderMystery({ kingsRansomFirst: true });
  try {
    const player = playerFixture();
    player.attributes.set('quest.kings_ransom.stage', 5);
    quest.setStage(player, 1);
    transcripts.length = 0;
    assert.equal(firstClick(player, 4218).handled, false);
    assert.equal(player.attributes.get('quest.kings_ransom.stage'), 5);
    assert.equal(transcripts.length, 0);
    assert.equal(variant(player, 4218), 'getting-started-talking-to-the-guard-after-starting-the-quest');

    quest.setStage(player, 2);
    assert.equal(firstClick(player, 4218).handled, true);
    assert.equal(transcripts.at(-1).page, "King's Ransom");
    assert.equal(transcripts.at(-1).variant, 'peril-at-the-end-house-talking-to-the-guard');
  } finally { cleanup(); }
});
const stage = (quest, player) => quest.getStage(player);
const loginReplay = (player) => {
  runtime.sendQuestVarps({ player });
  PluginManager.emitPlayerLogin({ player });
};
const bootstrapReplay = (player) => {
  PluginManager.emitCustomEvent('player:bootstrap-complete', { player });
};

test('fresh stage 0: mansion ids play the quest page, guard starts, varps 192/195 replay on login and bootstrap', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    transcripts.length = 0;
    assert.equal(stage(quest, player), 0, 'fresh stage 0');

    // The mansion family are spawned as 6195-6200; npc-dialogue-index has no entry.
    firstClick(player, 6195);
    assert.deepEqual(transcripts.at(-1), {
      npcId: 6195, page: 'Murder Mystery', variant: 'before-starting-talking-to-anna-carol-mary-or-elizabeth',
    });
    firstClick(player, 6194);
    assert.deepEqual(transcripts.at(-1), {
      npcId: 6194, page: 'Murder Mystery', variant: 'getting-started-talking-to-guard',
    });

    hook(player, 6194, 'quest:murder-mystery:start');
    assert.equal(stage(quest, player), 1, 'start hook sets the durable stage');
    const murderer = player.attributes.get(MURDERER);
    assert.ok(murderer >= 1 && murderer <= 6);
    assert.equal(lastConfig(player, 192), 1, 'varp 192 carries the started stage');
    assert.equal(lastConfig(player, 195), murderer, 'varp 195 carries the chosen suspect');

    player.configs.length = 0;
    loginReplay(player);
    assert.equal(lastConfig(player, 192), 1, 'login re-sends saved stage');
    assert.equal(lastConfig(player, 195), murderer, 'login re-sends the native suspect');

    player.configs.length = 0;
    bootstrapReplay(player);
    assert.equal(lastConfig(player, 195), murderer, 'bootstrap-complete re-sends the native suspect');
    assert.equal(stage(quest, player), 1, 'relog does not renumber the durable stage');
  } finally {
    cleanup();
  }
});

// The quest's gameplay (the hand-in, evidence, poison, flour and prints) is checked against the
// captures in murder-mystery-capture.test.cjs, with real objects; the fixture cases that stood in
// for it here are gone.

/** A slot-by-slot inventory, so the barrel's in-place pot swap can be checked. */
function slottedInventory(ids) {
  const slots = Array(28).fill(-1);
  ids.forEach((id, index) => { slots[index] = id; });
  return {
    slots,
    getAmount: (id) => slots.filter((slot) => slot === id).length,
    getFreeSlots: () => slots.filter((slot) => slot < 0).length,
    getSlot: (slot) => slots[slot] ?? -1,
    getSlotForItemId: (id) => slots.indexOf(id),
    setItem(slot, item) { slots[slot] = item.getId(); return this; },
    refreshItems() { return this; },
  };
}

function potOnObject(player, itemId, itemSlot, objectId = O.BARREL_OF_FLOUR_2) {
  const event = { player, objectId, itemId, itemSlot, item: { getId: () => itemId },
    object: { getId: () => objectId }, interfaceType: 0, location: { x: 2733, y: 3582, z: 0 }, handled: false };
  PluginManager.emitItemOnObject(event);
  return event;
}

test('other items and other barrels are left to their own handlers', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const p = playerFixture(slottedInventory([I.POT, I.BUCKET]));
    quest.setStage(p, 1);
    assert.equal(potOnObject(p, I.BUCKET, 1).handled, false);
    assert.equal(potOnObject(p, I.POT, 0, O.BARREL_OF_FLOUR_3).handled, false);
    assert.deepEqual(p.messages, []);
  } finally { cleanup(); }
});
