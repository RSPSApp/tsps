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

const EV = 'quest.murder_mystery.evidence';
const POISON = 'quest.murder_mystery.poison';
const MURDERER = 'quest.murder_mystery.murderer';
const THREAD_EVIDENCE = 1 << 1;
const FINGERPRINT_EVIDENCE = 1 << 2;
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
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

const setItems = (player, entries) => { for (const [id, amount] of entries) player.inventory.items.set(id, amount); };
const configValues = (player, id) => player.configs.filter((entry) => entry.id === id).map((entry) => entry.value);
const lastConfig = (player, id) => configValues(player, id).at(-1);

function firstClick(player, npcId) {
  const event = { player, npcId, clickType: 1, handled: false,
    npc: { getId: () => npcId }, definition: { getName: () => '', getActions: () => ['Talk-to'] } };
  PluginManager.emitNpcInteraction(event);
  return event;
}
function object(player, objectId) {
  const event = { player, objectId, location: new core.Location(0, 0, 0), clickType: 1, handled: false,
    object: { getId: () => objectId },
    definition: { getName: () => '', getActions: () => [null, 'Investigate', 'Break'] } };
  PluginManager.emitObjectInteraction(event);
  return event;
}
function itemOnItem(player, a, b) {
  const event = { player, usedItemId: a, usedWithItemId: b, handled: false };
  PluginManager.emitItemOnItem(event);
  return event;
}
function action(player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
}
function hook(player, npcId, name) {
  PluginManager.emitCustomEvent('npc-dialogue:hook', { player, npcId, hook: name, handled: false });
}
function choice(player, npcId, option) {
  PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npcId, option, stepId: null });
}
function line(player, npcId, text) {
  PluginManager.emitCustomEvent('npc-dialogue:line', { player, npcId, text });
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

test('all evidence: registered guard hand-in completes, takes the canonical evidence and rewards once', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1);
    player.attributes.set(EV, THREAD_EVIDENCE | FINGERPRINT_EVIDENCE);
    player.attributes.set(POISON, 3);
    setItems(player, [
      [I.CRIMINALS_THREAD_2, 1], [I.CRIMINALS_DAGGER, 1], [I.KILLERS_PRINT, 1],
      [I.SILVER_NECKLACE, 1], [I.PUNGENT_POT, 1], [I.FLYPAPER, 1],
    ]);
    transcripts.length = 0;

    firstClick(player, 6194);
    assert.deepEqual(transcripts.at(-1), {
      npcId: 6194, page: 'Murder Mystery',
      variant: 'presenting-the-evidence-talking-to-the-guard-with-all-evidence',
    });

    action(player, 6194, 'uvOs6C');
    assert.equal(stage(quest, player), 2, 'guard action completes stage 1 -> 2');
    assert.equal(lastConfig(player, 192), 2, 'canonical varp 192 reaches the cache threshold');
    assert.equal(lastConfig(player, 195), 0, 'completion clears the native suspect');
    assert.equal(player.attributes.get(MURDERER), 0);
    assert.equal(player.attributes.get(POISON), 0);
    assert.equal(player.attributes.get(EV), 0);
    assert.equal(player.inventory.getAmount(I.COINS), 2000, 'full 2,000 coin reward');
    assert.deepEqual(player.experience, [[core.Skill.CRAFTING, 1406]]);
    assert.equal(player.attributes.get('quest.points'), 3);
    for (const id of [I.CRIMINALS_THREAD_2, I.CRIMINALS_DAGGER, I.KILLERS_PRINT,
      I.SILVER_NECKLACE, I.PUNGENT_POT, I.FLYPAPER]) {
      assert.equal(player.inventory.getAmount(id), 0, `guard takes evidence ${id}`);
    }

    // The second dispatch is a completed quest: no duplicate reward.
    action(player, 6194, 'uvOs6C');
    assert.equal(player.inventory.getAmount(I.COINS), 2000);
    assert.deepEqual(player.experience, [[core.Skill.CRAFTING, 1406]]);

    player.configs.length = 0;
    loginReplay(player);
    assert.equal(lastConfig(player, 192), 2, 'completion survives login replay');
    assert.equal(lastConfig(player, 195), 0, 'cleared native suspect survives login replay');
  } finally {
    cleanup();
  }
});

test('dropping the silver item, dagger and pot does not block the all-evidence hand-in', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1);
    player.attributes.set(EV, THREAD_EVIDENCE | FINGERPRINT_EVIDENCE);
    player.attributes.set(POISON, 3);
    setItems(player, [[I.CRIMINALS_THREAD_2, 1], [I.KILLERS_PRINT, 1]]);
    assert.equal(variant(player, 6194), 'presenting-the-evidence-talking-to-the-guard-with-all-evidence');
    action(player, 6194, 'uvOs6C');
    assert.equal(stage(quest, player), 2, 'thread and killer print are enough to finish');
  } finally {
    cleanup();
  }
});

test('banked or dropped evidence cannot claim the all-evidence hand-in', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1);
    player.attributes.set(EV, THREAD_EVIDENCE | FINGERPRINT_EVIDENCE);
    player.attributes.set(POISON, 3);
    // Natural proof exists, but the killer's print and silver necklace are banked.
    setItems(player, [
      [I.CRIMINALS_THREAD_2, 1], [I.CRIMINALS_DAGGER, 1], [I.PUNGENT_POT, 1],
    ]);

    firstClick(player, 6194);
    assert.equal(transcripts.at(-1).variant,
      'presenting-the-evidence-talking-to-the-guard-with-some-but-not-all-evidence',
      'missing physical evidence falls back to the partial-evidence branch');

    player.configs.length = 0;
    action(player, 6194, 'uvOs6C');
    assert.equal(stage(quest, player), 1, 'stale hand-in action cannot complete');
    assert.equal(lastConfig(player, 192), undefined, 'no completion stage was written');
    assert.equal(player.inventory.getAmount(I.COINS), 0, 'no reward was paid');
    assert.equal(player.inventory.getAmount(I.CRIMINALS_THREAD_2), 1, 'held evidence was not confiscated');
    assert.ok(player.messages.at(-1).includes('bring all the evidence'));

    // Recovering the banked items restores the canonical route.
    setItems(player, [[I.KILLERS_PRINT, 1], [I.SILVER_NECKLACE, 1]]);
    firstClick(player, 6194);
    assert.equal(transcripts.at(-1).variant,
      'presenting-the-evidence-talking-to-the-guard-with-all-evidence');
    action(player, 6194, 'uvOs6C');
    assert.equal(stage(quest, player), 2, 'the full physical evidence set completes');
    assert.equal(player.inventory.getAmount(I.COINS), 2000);
  } finally {
    cleanup();
  }
});

test('flypaper can be collected repeatedly and respects ordinary inventory capacity', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1);

    object(player, O.SACKS_6);
    assert.equal(player.inventory.getAmount(I.FLYPAPER), 1);
    object(player, O.SACKS_6);
    assert.equal(player.inventory.getAmount(I.FLYPAPER), 2, 'second search grants the QH-required second piece');
    object(player, O.SACKS_6);
    object(player, O.SACKS_6);
    assert.equal(player.inventory.getAmount(I.FLYPAPER), 4, 'QH requiring two does not cap ordinary collection');

    player.inventory.items.delete(I.FLYPAPER);
    player.inventory.setFreeSlots(0);
    player.inventory.items.set(I.FLYPAPER, 1);
    object(player, O.SACKS_6);
    assert.equal(player.inventory.getAmount(I.FLYPAPER), 1, 'a full bag cannot take the second piece');
    assert.ok(player.messages.at(-1).includes('free inventory slot'));

    player.inventory.setFreeSlots(1);
    object(player, O.SACKS_6);
    assert.equal(player.inventory.getAmount(I.FLYPAPER), 2, 'the second piece is taken once a slot frees');
  } finally {
    cleanup();
  }
});

test('evidence gathering: both barrel placements, window full-bag guard, recipes and print match', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1); // Anna, green thread

    object(player, 25723); // newer placement of Anna's barrel
    assert.equal(player.inventory.getAmount(I.SILVER_NECKLACE), 1);

    player.inventory.setFreeSlots(0);
    object(player, 25724); // Bob's newer barrel while full
    assert.equal(player.inventory.getAmount(I.SILVER_CUP), 0);
    assert.ok(player.messages.at(-1).includes('free inventory slot'));

    object(player, 26123); // smashed study window multi
    assert.equal(player.inventory.getAmount(I.CRIMINALS_THREAD_2), 0);
    assert.equal(player.attributes.get(EV) ?? 0, 0, 'no thread evidence without the thread');
    player.inventory.setFreeSlots(28);
    object(player, 26123);
    assert.equal(player.inventory.getAmount(I.CRIMINALS_THREAD_2), 1);
    assert.equal(player.attributes.get(EV) & THREAD_EVIDENCE, THREAD_EVIDENCE);

    setItems(player, [[I.POT, 1]]);
    object(player, O.BARREL_OF_FLOUR_2);
    assert.equal(player.inventory.getAmount(I.POT), 0);
    assert.equal(player.inventory.getAmount(I.POT_OF_FLOUR), 1);
    setItems(player, [[I.CRIMINALS_DAGGER, 1]]);
    itemOnItem(player, I.POT_OF_FLOUR, I.CRIMINALS_DAGGER);
    assert.equal(player.inventory.getAmount(I.CRIMINALS_DAGGER_2), 1);
    assert.equal(player.inventory.getAmount(I.POT), 1);
    setItems(player, [[I.FLYPAPER, 1]]);
    itemOnItem(player, I.FLYPAPER, I.CRIMINALS_DAGGER_2);
    assert.equal(player.inventory.getAmount(I.UNKNOWN_PRINT), 1);
    assert.equal(player.inventory.getAmount(I.CRIMINALS_DAGGER), 1);

    // Wrong print clears the suspect but does not count as fingerprint evidence.
    setItems(player, [[I.BOBS_PRINT, 1]]);
    itemOnItem(player, I.UNKNOWN_PRINT, I.BOBS_PRINT);
    assert.equal(player.inventory.getAmount(I.BOBS_PRINT), 0);
    assert.equal(player.inventory.getAmount(I.UNKNOWN_PRINT), 1);
    assert.equal(player.attributes.get(EV) & FINGERPRINT_EVIDENCE, 0);

    // Anna's silver -> dusted -> Anna's print -> compare -> killer's print.
    setItems(player, [[I.SILVER_NECKLACE, 1], [I.POT_OF_FLOUR, 1]]);
    itemOnItem(player, I.POT_OF_FLOUR, I.SILVER_NECKLACE);
    setItems(player, [[I.FLYPAPER, 1]]);
    itemOnItem(player, I.FLYPAPER, I.SILVER_NECKLACE_2);
    assert.equal(player.inventory.getAmount(I.ANNAS_PRINT), 1);
    itemOnItem(player, I.UNKNOWN_PRINT, I.ANNAS_PRINT);
    assert.equal(player.inventory.getAmount(I.KILLERS_PRINT), 1);
    assert.equal(player.attributes.get(EV) & FINGERPRINT_EVIDENCE, FINGERPRINT_EVIDENCE);
  } finally {
    cleanup();
  }
});

test('poison proof and post-quest variants use the same spawned guards and family ids', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const player = playerFixture();
    quest.setStage(player, 1);
    player.attributes.set(MURDERER, 1);

    line(player, N.POISON_SALESMAN, 'Anna, Bob, Carol, David, Elizabeth and Frank all bought a bottle! In fact they bought the last of my supplies!');
    assert.equal(player.attributes.get(POISON), 1);
    line(player, 6195, "That useless Gardener Stanford has let his compost heap fester. It's an eyesore to the garden! So I bought some poison from a travelling salesman so that I could kill off some of the wildlife living in it.");
    assert.equal(player.attributes.get(POISON), 2);

    object(player, O.SINCLAIR_FAMILY_BEEHIVE); // Bob's location, not Anna's
    assert.equal(player.attributes.get(POISON), 2);
    assert.ok(player.messages.at(-1).includes('traces of recently used poison'));
    object(player, O.SINCLAIR_FAMILY_COMPOST_HEAP);
    assert.equal(player.attributes.get(POISON), 3);
    assert.equal(variant(player, 6194), 'presenting-the-evidence-talking-to-the-guard-with-some-but-not-all-evidence');
    setItems(player, [
      [I.CRIMINALS_THREAD_2, 1], [I.CRIMINALS_DAGGER, 1], [I.KILLERS_PRINT, 1],
      [I.SILVER_NECKLACE, 1], [I.PUNGENT_POT, 1],
    ]);
    player.attributes.set(EV, THREAD_EVIDENCE | FINGERPRINT_EVIDENCE);
    assert.equal(variant(player, 6194), 'presenting-the-evidence-talking-to-the-guard-with-all-evidence');

    quest.setStage(player, 2);
    transcripts.length = 0;
    firstClick(player, 6195);
    assert.equal(transcripts.at(-1).variant, 'post-quest-talking-to-anna-after-the-quest');
    firstClick(player, 6194);
    assert.equal(transcripts.at(-1).variant, 'post-quest-talking-to-the-guard-after-the-quest');
    assert.equal(variant(player, N.POISON_SALESMAN), 'post-quest-talking-to-the-poison-salesman-after-the-quest');
  } finally {
    cleanup();
  }
});


test('poison alibi needs the actual culprit final line; shared salesman hook yields after completion', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const p = playerFixture(); quest.setStage(p, 1); p.attributes.set(MURDERER, 2);
    choice(p, N.POISON_SALESMAN, 'Who did you sell Poison to at the house?');
    assert.equal(p.attributes.get(POISON) ?? 0, 0, 'opening the question does not finish the answer');
    line(p, N.POISON_SALESMAN, 'Anna, Bob, Carol, David, Elizabeth and Frank all bought a bottle! In fact they bought the last of my supplies!');
    line(p, 6195, 'I bought some poison so that I could kill off some of the wildlife living in it.');
    assert.equal(p.attributes.get(POISON), 1, 'another suspect cannot supply the culprit alibi');
    line(p, 6196, "What's it to you anyway?");
    assert.equal(p.attributes.get(POISON), 1, 'interrupted culprit answer is incomplete');
    line(p, 6196, 'If you absolutely must know, we had a problem with the beehive in the garden, and as all of our servants are so pathetically useless, I decided I would deal with it myself. So I did.');
    assert.equal(p.attributes.get(POISON), 2);
    const e = { player: p, npcId: N.POISON_SALESMAN, npc: {}, clickType: 1, handled: false,
      definition: { getName: () => 'Poison Salesman', getActions: () => ['Talk-to'] } };
    assert.equal(PluginManager.emitNpcInteraction(e), true);
    assert.equal(transcripts.at(-1).page, 'Murder Mystery');
    quest.setStage(p, 2); e.handled = false;
    assert.equal(PluginManager.emitNpcInteraction(e), false, 'completed Murder Mystery releases the shared NPC');
  } finally { cleanup(); }
});


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

const FLOUR_LINES = ['You take some flour from the barrel.', "There's still plenty of flour left."];

test('a full bag can exchange its empty pot for flour because consumption frees its slot', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const inventory = slottedInventory(Array(28).fill(I.COINS).map((id, index) => (index === 5 ? I.POT : id)));
    const p = playerFixture(inventory);
    quest.setStage(p, 1);
    assert.equal(p.inventory.getFreeSlots(), 0);
    object(p, O.BARREL_OF_FLOUR_2);
    assert.equal(p.inventory.getAmount(I.POT), 0);
    assert.equal(inventory.slots[5], I.POT_OF_FLOUR);
    assert.deepEqual(p.messages, FLOUR_LINES);
  } finally { cleanup(); }
});

test('an empty pot used on the barrel becomes a pot of flour in its own slot (recs 1001551, 1001930, 1001958)', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const inventory = slottedInventory([I.POT, I.COINS, I.POT, I.POT]);
    const p = playerFixture(inventory);
    quest.setStage(p, 1);
    const event = potOnObject(p, I.POT, 2);
    assert.equal(event.handled, true);
    assert.deepEqual(inventory.slots.slice(0, 4), [I.POT, I.COINS, I.POT_OF_FLOUR, I.POT]);
    assert.deepEqual(p.messages, FLOUR_LINES);
  } finally { cleanup(); }
});

test('the barrel keeps giving flour before and after the quest', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    for (const stage of [0, 2]) {
      const inventory = slottedInventory([I.POT, I.POT]);
      const p = playerFixture(inventory);
      quest.setStage(p, stage);
      assert.equal(potOnObject(p, I.POT, 1).handled, true);
      object(p, O.BARREL_OF_FLOUR_2);
      assert.deepEqual(inventory.slots.slice(0, 2), [I.POT_OF_FLOUR, I.POT_OF_FLOUR], `stage ${stage}`);
      assert.deepEqual(p.messages, [...FLOUR_LINES, ...FLOUR_LINES], `stage ${stage}`);
    }
  } finally { cleanup(); }
});

test('Take-from without a pot asks for something to put the flour in', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    const p = playerFixture(slottedInventory([I.COINS]));
    quest.setStage(p, 1);
    assert.equal(object(p, O.BARREL_OF_FLOUR_2).handled, true);
    assert.deepEqual(p.messages, ['You need something to put the flour in.']);
  } finally { cleanup(); }
});

test('the crime-scene pots are refused with the evidence line and keep their slot', () => {
  const { quest, cleanup } = registerMurderMystery();
  try {
    for (const pot of [I.SILVER_POT, I.SILVER_POT_2, I.PUNGENT_POT]) {
      const inventory = slottedInventory([pot, I.POT]);
      const p = playerFixture(inventory);
      quest.setStage(p, 1);
      assert.equal(potOnObject(p, pot, 0).handled, true);
      assert.deepEqual(inventory.slots.slice(0, 2), [pot, I.POT]);
      assert.deepEqual(p.messages, ["You probably shouldn't use evidence from a crime scene to keep flour in..."]);
    }
  } finally { cleanup(); }
});

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
