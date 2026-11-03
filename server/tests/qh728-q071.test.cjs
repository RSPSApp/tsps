// Making History (q071) source-contract checks.
// From server/: node --test tests/qh728-q071.test.cjs (after yarn build).
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/makinghistory/MakingHistory.java
// at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// These are registered-dispatch contract tests, not a live playthrough. The
// route test starts at fresh stage 0 with fixture-set prerequisites and ordinary
// supplies; every Making History stage/attribute change comes from the plugin's
// own registered handlers. Transcript conditions/menus are dispatched with the
// real step ids from data/definitions/npc-dialogues.json.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const { World } = core;
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const QUEST_FILE = '../plugins/quests/quests/MakingHistory.Quest';
const PAGE = 'Making History';
const START_HOOK = 'quest:making-history:start';
const WIRE = 1383;
const TRADER_WIRE = 1384;
const WARR_WIRE = 1385;
const GHOST_WIRE = 1386;
const MUSEUM_WIRE = 1390;
const SLUG_MENACE_STAGE = 'quest.the_slug_menace.stage';

// The plugin captures startTranscript at module load. Record variants instead of
// replaying them; the tests dispatch the transcript actions those variants carry.
const transcripts = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, _npcId, _page, variant) => {
  transcripts.push(variant);
  return true;
};
const MakingHistory = require(QUEST_FILE);

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  // Runtime query listeners register once, as at real startup; keep them outside
  // the per-test quest callback cleanup.
  runtime.registerQuest(PluginManager.createApi('q071-shared-runtime'), {
    key: 'the_restless_ghost', name: 'The Restless Ghost',
    varpId: -1, startedValue: 1, completionValue: 2,
  });
});

function hookCounts() {
  return {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    login: PluginManager.loginHooks.length,
    logout: PluginManager.logoutHooks.length,
    custom: new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, hooks.length])),
  };
}

function restoreHooks(before) {
  PluginManager.npcDialogueVariantHooks.length = before.variant;
  PluginManager.npcDialogueConditionHooks.length = before.condition;
  PluginManager.npcInteractionHooks.length = before.interaction;
  PluginManager.itemOnItemHooks.length = before.itemOnItem;
  PluginManager.itemOnNpcHooks.length = before.itemOnNpc;
  PluginManager.itemActionHooks.length = before.itemAction;
  PluginManager.loginHooks.length = before.login;
  PluginManager.logoutHooks.length = before.logout;
  for (const [name, hooks] of PluginManager.customEventHooks) {
    const keep = before.custom.get(name) ?? 0;
    if (hooks.length > keep) hooks.length = keep;
    if (keep === 0) PluginManager.customEventHooks.delete(name);
  }
}

function inventoryFixture(initial = new Map(), freeSlots = 28, stackable = new Set([I.COINS])) {
  const items = new Map(initial);
  let free = freeSlots;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    adds(id, amount = 1) {
      if (stackable.has(id)) {
        items.set(id, (items.get(id) ?? 0) + amount);
        return;
      }
      for (let placed = 0; placed < amount; placed++) {
        if (free <= 0) return;
        free--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
    },
    forceAdd(ownerOrItem, maybeItem) {
      const item = maybeItem ?? ownerOrItem;
      if (this.isFull() && !(this.getAmount(item.getId()) > 0 && stackable.has(item.getId()))) {
        this.droppedItems ??= [];
        this.droppedItems.push(item);
        this.dropped = item;
        return;
      }
      this.adds(item.getId(), item.getAmount());
    },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) {
        if (items.delete(id) && !stackable.has(id)) free++;
      } else {
        items.set(id, left);
      }
    },
  };
}

function playerFixture(inventory = inventoryFixture(), location = new core.Location(2436, 3346, 0)) {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  let interfaceId = -1;
  let chatboxId = -1;
  let manager;
  const sender = new Proxy({
    sendInterface(id) { interfaceId = id; return sender; },
    sendInterfaceRemoval() { interfaceId = -1; chatboxId = -1; manager?.reset(); return sender; },
    sendChatboxInterface(id) { chatboxId = id; return sender; },
    isChatboxInterface: id => chatboxId === id,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    closeSubInterface() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    inventory,
    messages,
    varbits,
    xp,
    getUsername: () => 'qh728-q071', getDisplayName: () => 'qh728-q071',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => (slot === core.Equipment.AMULET_SLOT
        ? { getId: () => I.GHOSTSPEAK_AMULET }
        : null),
    }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    setLocation(next) { location = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId(id) { interfaceId = id; return player; },
    getDialogueManager: () => manager,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  manager = new DialogueManager(player);
  return player;
}

function setup() {
  const before = hookCounts();
  const spawned = [];
  const removed = [];
  const ground = [];
  const localHooks = { login: [], logout: [] };
  const queries = [];
  const api = new Proxy({
    core,
    persistAttribute() {},
    onInterfaceActionButton() {},
    onPlayerLogin: (handler) => localHooks.login.push(handler),
    onPlayerLogout: (handler) => localHooks.logout.push(handler),
    onCustomEvent(name, handler) {
      const list = PluginManager.customEventHooks.get(name) ?? [];
      list.push({ pluginName: 'MakingHistoryTest', handler });
      PluginManager.customEventHooks.set(name, list);
    },
    emitCustomEvent(name, event) {
      queries.push([name, event.key]);
      PluginManager.emitCustomEvent(name, event);
    },
    onNpcDialogueVariant: (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName: 'MakingHistoryTest', handler }),
    onNpcDialogueCondition: (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName: 'MakingHistoryTest', handler }),
    onNpcInteraction(handler) { PluginManager.npcInteractionHooks.push({ pluginName: 'MakingHistoryTest', handler }); },
    onItemOnItem(handler) { PluginManager.itemOnItemHooks.push({ pluginName: 'MakingHistoryTest', handler }); },
    onItemOnNpc(handler) { PluginManager.itemOnNpcHooks.push({ pluginName: 'MakingHistoryTest', handler }); },
    onItemAction(...args) {
      if (typeof args[0] === 'string') {
        const actions = args[1] ?? {};
        PluginManager.itemActionHooks.push({ pluginName: 'MakingHistoryTest', handler: (event) => {
          const action = actions[event.option];
          if (!action) return;
          if (action(event) !== false) event.handled = true;
        } });
      } else {
        PluginManager.itemActionHooks.push({ pluginName: 'MakingHistoryTest', handler: args[0] });
      }
    },
    getItemOnGroundManager: () => ({
      registerLocation: (owner, item, at) => ground.push({ owner, item, at }),
    }),
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        getOwner: () => definition.owner,
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        const handler = args.findLast(argument => typeof argument === 'function');
        if (handler) (target[key] ??= []).push(handler);
      };
    },
  });

  // Fixture prerequisite quests (ordinary state; not quest items):
  // The Restless Ghost started (not complete) and Priest in Peril complete,
  // matching Quest Helper's requirements.
  const restless = runtime.registerQuest(api, {
    key: 'the_restless_ghost', name: 'The Restless Ghost',
    varpId: -1, startedValue: 1, completionValue: 2,
  });
  const priest = runtime.registerQuest(api, {
    key: 'priest_in_peril', name: 'Priest in Peril',
    varpId: -1, startedValue: 1, completionValue: 2,
  });
  MakingHistory(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'making_history');
  return {
    api, quest, restless, priest, spawned, removed, ground, localHooks, queries,
    cleanup() {
      restoreHooks(before);
    },
  };
}

const line = (player, npcId, text) => {
  const event = { player, npcId, text, handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:line', event);
  return event;
};
const condition = (player, npcId, stepId) => PluginManager.emitNpcDialogueCondition({ player, npcId, stepId });
const action = (player, npcId, stepId, kind) => {
  const event = { player, npcId, stepId, kind, action: 'receive', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
};
const choice = (player, npcId, option) => PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npcId, option, handled: false });
const variant = (player, npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId });

test('canonical wire: stage 0 start, letter steps 2/3 and cache completion 4', () => {
  const ctx = setup();
  try {
    const player = playerFixture(inventoryFixture(new Map([[I.SPADE, 1], [I.SAPPHIRE_AMULET, 1]])));
    ctx.restless.setStage(player, 1); // started, deliberately not complete
    ctx.priest.setStage(player, 2);

    // Fresh stage 0: the generic Jorral page owns the start conversation.
    assert.equal(ctx.quest.getStage(player), 0);
    assert.equal(variant(player, N.JORRAL), null);
    assert.equal(condition(player, N.JORRAL, 'zjWUw5'), false, 'requirements met');
    assert.equal(condition(player, N.JORRAL, 'QIdJ0k'), true, 'requirements met');
    assert.equal(condition(player, N.JORRAL, 'PwpLer'), false);

    PluginManager.emitCustomEvent('npc-dialogue:hook', { player, npcId: N.JORRAL, hook: START_HOOK });
    assert.equal(ctx.quest.getStage(player), 1);
    assert.equal(player.varbits.get(WIRE), 1, 'makinghistory_prog 1 at start');

    // Erin hands over the key.
    choice(player, N.SILVER_MERCHANT, 'Ask about the outpost.');
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 1);
    assert.equal(player.varbits.get(TRADER_WIRE), 1, 'native trader_prog 1 = key');

    // Dig at the chest tile, then the transcript's chest message.
    player.setLocation(new core.Location(2442, 3139, 0));
    assert.equal(PluginManager.emitItemAction({ player, itemId: I.SPADE, option: 'Dig', handled: false }), true);
    assert.ok(transcripts.includes('navigating-with-the-enchanted-key-finding-the-chest'));
    action(player, N.JORRAL, 'qDSqmk', 'message');
    assert.equal(player.inventory.getAmount(I.CHEST), 1);
    assert.equal(player.varbits.get(TRADER_WIRE), 2, 'native trader_prog 2 = chest');

    // Open the chest with the key and take the journal.
    assert.equal(PluginManager.emitItemOnItem({
      player, usedItemId: I.ENCHANTED_KEY, usedWithItemId: I.CHEST, handled: false,
    }), true);
    action(player, N.JORRAL, 'CpO-Pc', 'message');
    assert.equal(player.inventory.getAmount(I.CHEST), 0);
    action(player, N.JORRAL, 'RgX_fS');
    assert.equal(player.inventory.getAmount(I.JOURNAL_4), 1);
    assert.equal(player.varbits.get(TRADER_WIRE), 3, 'native trader_prog 3 = journal found');

    // Show the journal to Jorral.
    assert.equal(variant(player, N.JORRAL), 'navigating-with-the-enchanted-key-finding-the-chest');
    action(player, N.JORRAL, 'o3ZNzz', 'message');
    assert.equal(player.varbits.get(WIRE), 1, 'journal alone is still stage 1');
    assert.equal(player.varbits.get(TRADER_WIRE), 4, 'native trader_prog 4 = journal handed to Jorral');

    // Droalak -> Melina's sapphire amulet -> scroll -> Jorral.
    line(player, N.DROALAK_2, 'OK, well perhaps you could give her a strung sapphire amulet');
    assert.equal(player.varbits.get(GHOST_WIRE), 2, 'native ghost_prog 2 = Droalak');
    assert.equal(PluginManager.emitItemOnNpc({
      player, itemId: I.SAPPHIRE_AMULET, npcId: N.MELINA_2, handled: false,
    }), true);
    action(player, N.MELINA_2, 'Uu67E-');
    assert.equal(player.inventory.getAmount(I.SAPPHIRE_AMULET), 0);
    assert.equal(player.varbits.get(GHOST_WIRE), 4, 'native ghost_prog 4 = Melina has the amulet');
    action(player, N.DROALAK_2, 'RNo3Eh');
    assert.equal(player.inventory.getAmount(I.SCROLL), 1);
    assert.equal(player.varbits.get(GHOST_WIRE), 5, 'native ghost_prog 5 = scroll obtained');
    action(player, N.JORRAL, '-yT7qi', 'message');
    assert.equal(player.varbits.get(GHOST_WIRE), 6, 'native ghost_prog 6 = scroll handed to Jorral');

    // Blanin -> Dron -> report to Jorral.
    line(player, N.BLANIN, 'I know this sounds strange but Dron won\'t talk to anyone unless they know him well - he\'s a secretive guy.');
    assert.equal(player.varbits.get(WARR_WIRE), 2, 'native warr_prog 2 = Blanin');
    line(player, N.DRON, 'Very well, you seem to know me quite well, I\'ll answer your questions best I can.');
    assert.equal(player.varbits.get(WARR_WIRE), 3, 'native warr_prog 3 = Dron');
    line(player, N.JORRAL, "I've talked to the warrior.");
    assert.equal(player.varbits.get(WARR_WIRE), 4, 'native warr_prog 4 = Jorral told about Dron');
    line(player, N.JORRAL, 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.');
    assert.equal(player.varbits.get(WIRE), 1, 'all information done still reads stage 1 until the letter');

    // Jorral's letter: canonical wire 2, and King Lathas spawns for the window.
    assert.equal(variant(player, N.JORRAL), 'after-talking-to-the-last-person');
    action(player, N.JORRAL, 'pmH3ww');
    assert.equal(player.inventory.getAmount(I.LETTER_4), 1);
    assert.equal(player.varbits.get(WIRE), 2, 'makinghistory_prog 2 with Jorral\'s letter');
    assert.ok(ctx.spawned.some((npc) => npc.id === N.KING_LATHAS), 'King Lathas is present for the hand-in');

    // King Lathas's reply: canonical wire 3.
    action(player, N.KING_LATHAS, 'bbreqL');
    assert.equal(player.inventory.getAmount(I.LETTER_4), 0);
    assert.equal(player.inventory.getAmount(I.LETTER_5), 1);
    assert.ok(ctx.removed.some((npc) => npc.id === N.KING_LATHAS), 'the fallback King is removed after handing over the letter');
    assert.equal(player.varbits.get(WIRE), 3, 'makinghistory_prog 3 with the King\'s letter');

    // Final hand-in: canonical completion is the cache threshold 4.
    assert.equal(variant(player, N.JORRAL), 'delivering-the-letter-to-jorral');
    action(player, N.JORRAL, 'pMj4WQ');
    assert.equal(ctx.quest.isComplete(player), true);
    assert.equal(player.varbits.get(WIRE), 4, 'makinghistory_prog 4 >= cache completion threshold');
    assert.equal(player.inventory.getAmount(I.LETTER_5), 0);
    assert.equal(player.inventory.getAmount(I.COINS), 750, '750 coins rewarded once');
    assert.ok(player.xp.some((entry) => entry.skill === core.Skill.CRAFTING && entry.amount === 1000));
    assert.ok(player.xp.some((entry) => entry.skill === core.Skill.PRAYER && entry.amount === 1000));
    assert.ok(ctx.removed.some((npc) => npc.id === N.KING_LATHAS), 'the owner-only King copy is removed');
    assert.equal(player.varbits.get(MUSEUM_WIRE), 1, 'the outpost becomes the museum');

    // Relog: the native path varbits are replayed from the durable state.
    player.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 4, 'makinghistory_prog 4 after relog');
    assert.equal(player.varbits.get(TRADER_WIRE), 4, 'trader_prog 4 after relog');
    assert.equal(player.varbits.get(WARR_WIRE), 4, 'warr_prog 4 after relog');
    assert.equal(player.varbits.get(GHOST_WIRE), 6, 'ghost_prog 6 after relog');
    assert.equal(player.varbits.get(1387), 1, 'Melina stays gone after relog');
    assert.equal(player.varbits.get(MUSEUM_WIRE), 1, 'the museum switch survives relog');

    // Repeat completion does nothing.
    const coins = player.inventory.getAmount(I.COINS);
    action(player, N.JORRAL, 'pMj4WQ');
    assert.equal(player.inventory.getAmount(I.COINS), coins);
  } finally {
    ctx.cleanup();
  }
});

test('Dron quiz keeps the Wiki menu order with Lunch in Quest Helper slot 2', () => {
  const ctx = setup();
  const prior = PluginManager.customEventHooks.get('npc-dialogue:start') ?? [];
  let started;
  const capture = { pluginName: 'MakingHistoryTestCapture', handler: event => { started = event; } };
  PluginManager.customEventHooks.set('npc-dialogue:start', [...prior, capture]);
  try {
    const player = playerFixture();
    ctx.quest.setStage(player, 1);
    player.setAttribute('quest.making_history.warr', 1);
    PluginManager.emitNpcInteraction({
      player, npcId: N.DRON, npc: { getId: () => N.DRON }, clickType: 1,
      definition: { getActions: () => ['Talk-to'] }, handled: false,
    });
    assert.equal(started?.variant, 'talking-to-dron-talking-to-dron-again');
    const transcript = require('../data/definitions/npc-dialogues.json')['Making History'].variants[started.variant];
    assert.equal(started.select, undefined, 'canonical quiz needs no runtime repair');
    const findMenu = steps => {
      for (const step of steps ?? []) {
        if (step.type === 'choice' && step.options?.length === 2 && step.options[0].text === 'Tea' && step.options[1].text === 'Lunch') return step;
        for (const option of step.options ?? []) {
          const nested = findMenu(option.steps);
          if (nested) return nested;
        }
        const nested = findMenu(step.steps);
        if (nested) return nested;
      }
      return null;
    };
    assert.deepEqual(findMenu(transcript)?.options.map(option => option.text), ['Tea', 'Lunch']);
  } finally {
    const now = PluginManager.customEventHooks.get('npc-dialogue:start') ?? [];
    PluginManager.customEventHooks.set('npc-dialogue:start', now.filter(hook => hook !== capture));
    if (prior.length === 0) PluginManager.customEventHooks.delete('npc-dialogue:start');
    ctx.cleanup();
  }
});

test('requirements: Restless Ghost only needs to be started', () => {
  const ctx = setup();
  try {
    const player = playerFixture();
    ctx.priest.setStage(player, 2);
    ctx.restless.setStage(player, 1);
    assert.equal(condition(player, N.JORRAL, 'PwpLer'), false);
    assert.equal(condition(player, N.JORRAL, 'vVZ0NF'), true);

    ctx.restless.setStage(player, 0);
    assert.equal(condition(player, N.JORRAL, 'PwpLer'), true, 'not started is not enough');
    assert.equal(condition(player, N.JORRAL, 'vVZ0NF'), false);

    ctx.restless.setStage(player, 1);
    ctx.priest.setStage(player, 1);
    assert.equal(condition(player, N.JORRAL, 'PwpLer'), true, 'Priest in Peril must be complete');
  } finally {
    ctx.cleanup();
  }
});

test('login replays the canonical letter/completion wire and keeps legacy saves', () => {
  const ctx = setup();
  try {
    const player = playerFixture();
    // Fresh cleared wire: login sends 0.
    player.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 0, 'unstarted login replays 0');

    // All information gathered but no letter yet is still 1.
    ctx.quest.setStage(player, 1);
    line(player, N.JORRAL, 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.');
    player.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 1, 'full story without the letter is still 1');

    // Jorral's letter received -> 2, replayed on login even after losing it.
    action(player, N.JORRAL, 'pmH3ww');
    player.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 2);
    player.inventory.deleteNumber(I.LETTER_4, 1);
    player.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 2, 'wire 2 persists after losing the letter');

    // King's letter received -> 3.
    action(player, N.KING_LATHAS, 'bbreqL');
    player.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 3);

    // An existing durable save at stage 2 (complete) must still replay as 4.
    const legacy = playerFixture();
    ctx.quest.setStage(legacy, 2);
    legacy.varbits.delete(WIRE);
    ctx.localHooks.login.forEach((handler) => handler({ player: legacy }));
    assert.equal(legacy.varbits.get(WIRE), 4, 'legacy complete save maps to canonical 4');
    assert.equal(ctx.quest.isComplete(legacy), true);
  } finally {
    ctx.cleanup();
  }
});

test('shared NPCs: Jorral yields to Slug Menace and King Lathas yields post-quest', () => {
  const ctx = setup();
  try {
    // A second plugin owning Jorral, registered after Making History (the real
    // load order), with the shipped Slug Menace quest key and stage range.
    const slug = runtime.registerQuest(ctx.api, {
      key: 'the_slug_menace', name: 'The Slug Menace',
      varpId: -1, startedValue: 1, completionValue: 14,
    });
    ctx.api.onNpcDialogueVariant(({ player }) => {
      const stage = slug.getStage(player);
      return stage === 5 || stage === 6 ? 'the-pages-talking-to-jorral' : null;
    });

    const player = playerFixture();
    // Unstarted Making History must not shadow Jorral's generic start page.
    assert.equal(variant(player, N.JORRAL), null);

    // Slug Menace's page-translation window (stages 5 and 6) owns Jorral.
    ctx.quest.setStage(player, 1);
    slug.setStage(player, 5);
    assert.equal(variant(player, N.JORRAL), 'the-pages-talking-to-jorral', 'Slug Menace stage 5');
    slug.setStage(player, 6);
    assert.equal(variant(player, N.JORRAL), 'the-pages-talking-to-jorral', 'Slug Menace stage 6');

    // Outside that window Making History owns Jorral again.
    slug.setStage(player, 4);
    assert.equal(variant(player, N.JORRAL), 'starting-off-talking-to-jorral-again-after-getting-the-information');
    slug.setStage(player, 7);
    assert.equal(variant(player, N.JORRAL), 'starting-off-talking-to-jorral-again-after-getting-the-information');

    // The yield is keyed on the registered stage attribute, not a look-alike.
    slug.setStage(player, 0);
    player.setAttribute('quest.slug_menace.stage', 5);
    assert.equal(variant(player, N.JORRAL), 'starting-off-talking-to-jorral-again-after-getting-the-information',
      'a non-existent attribute key must not yield Jorral');
    player.setAttribute('quest.slug_menace.stage', 0);
    slug.setStage(player, 5);
    assert.equal(variant(player, N.JORRAL), 'the-pages-talking-to-jorral', 'the real key does yield Jorral');

    // Post-quest Jorral stays on the Making History page.
    ctx.quest.setStage(player, 2);
    slug.setStage(player, 0);
    assert.deepEqual(variant(player, N.JORRAL), { page: 'Jorral', variant: 'after-making-history' });

    // A completing Slug Menace still owns Jorral over the post-quest page.
    slug.setStage(player, 6);
    assert.equal(variant(player, N.JORRAL), 'the-pages-talking-to-jorral');

    // King Lathas is only claimed during the letter window; afterwards other
    // quests (Regicide/Underground Pass) get the generic dialogue.
    const active = playerFixture();
    ctx.quest.setStage(active, 1);
    assert.equal(variant(active, N.KING_LATHAS), null, 'no claim before the last-person meeting');
    line(active, N.JORRAL, 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.');
    assert.equal(variant(active, N.KING_LATHAS), 'talking-to-king-lathas');
    ctx.quest.setStage(active, 2);
    assert.equal(variant(active, N.KING_LATHAS), null, 'post-quest yields King Lathas');
  } finally {
    ctx.cleanup();
  }
});

test('recovery: full bag dig, lost/full scroll, and letter guards', () => {
  const ctx = setup();
  try {
    const player = playerFixture(inventoryFixture(new Map([
      [I.ENCHANTED_KEY, 1],
      [I.SPADE, 1],
    ]), 0));
    ctx.quest.setStage(player, 1);
    player.setLocation(new core.Location(2442, 3139, 0));
    const dig = { player, itemId: I.SPADE, option: 'Dig', handled: false };
    PluginManager.emitItemAction(dig);
    assert.equal(dig.handled, true);
    assert.equal(player.inventory.getAmount(I.CHEST), 0);
    assert.ok(player.messages.some((message) => /inventory space/.test(message)));

    // Droalak's full-bag branch drops the scroll on the ground.
    const full = playerFixture(inventoryFixture(new Map(), 0));
    ctx.quest.setStage(full, 1);
    action(full, N.DROALAK_2, 'zc9Rw_');
    assert.equal(ctx.ground.length, 1);
    assert.equal(ctx.ground[0].item.getId(), I.SCROLL);
    assert.equal(full.varbits.get(GHOST_WIRE), 5, 'native ghost_prog 5 = scroll obtained');

    // Presence varbits survive the login bootstrap.
    full.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player: full }));
    assert.equal(full.varbits.get(1387), 1, 'Melina stays gone after the amulet');
    assert.equal(full.varbits.get(1388), 0, 'Droalak remains until the post-quest fade');
    action(full, N.DROALAK_2, 'tsNvdU');
    assert.equal(full.varbits.get(1388), 1);
    full.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player: full }));
    assert.equal(full.varbits.get(1388), 1, 'the Droalak fade persists across login');

    // Lost scroll is replaced by the real transcript action.
    const lost = playerFixture(inventoryFixture(new Map(), 5));
    ctx.quest.setStage(lost, 1);
    action(lost, N.DROALAK_2, 'bAPjYf');
    assert.equal(lost.inventory.getAmount(I.SCROLL), 1);

    // Recovering a lost scroll with a full bag drops it instead of losing it.
    const lostFull = playerFixture(inventoryFixture(new Map(), 0));
    ctx.quest.setStage(lostFull, 1);
    action(lostFull, N.DROALAK_2, 'bAPjYf');
    assert.equal(lostFull.inventory.getAmount(I.SCROLL), 0);
    assert.equal(ctx.ground.length, 2);
    assert.equal(ctx.ground[1].item.getId(), I.SCROLL);

    // Erin replaces the key after it is lost while the quest still needs it.
    const withoutKey = playerFixture(inventoryFixture(new Map(), 4));
    ctx.quest.setStage(withoutKey, 1);
    choice(withoutKey, N.SILVER_MERCHANT, 'Ask about the outpost.');
    assert.equal(withoutKey.inventory.getAmount(I.ENCHANTED_KEY), 1);
    withoutKey.inventory.deleteNumber(I.ENCHANTED_KEY, 1);
    choice(withoutKey, N.SILVER_MERCHANT, 'Ask about the outpost.');
    assert.equal(withoutKey.inventory.getAmount(I.ENCHANTED_KEY), 1, 'another key after loss');
    const fullForKey = inventoryFixture(new Map(), 0);
    const noRoom = playerFixture(fullForKey);
    ctx.quest.setStage(noRoom, 1);
    choice(noRoom, N.SILVER_MERCHANT, 'Ask about the outpost.');
    assert.equal(noRoom.inventory.getAmount(I.ENCHANTED_KEY), 0);
    assert.ok(noRoom.messages.some((message) => /inventory space/.test(message)));

    // No room for Jorral's letter: the transcript condition refuses it.
    const tight = playerFixture(inventoryFixture(new Map(), 0));
    ctx.quest.setStage(tight, 1);
    line(tight, N.JORRAL, 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.');
    assert.equal(condition(tight, N.JORRAL, '3M2GSi'), true);
    assert.equal(condition(tight, N.JORRAL, 'SbiDA6'), false);
    assert.equal(tight.inventory.getAmount(I.LETTER_4), 0);

    // Completed quest without the King's letter: deliver variant tells the
    // player to get another; only the letter-held condition completes.
    const noLetter = playerFixture();
    ctx.quest.setStage(noLetter, 1);
    line(noLetter, N.JORRAL, 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.');
    action(noLetter, N.KING_LATHAS, 'bbreqL');
    noLetter.inventory.deleteNumber(I.LETTER_5, 1);
    assert.equal(variant(noLetter, N.JORRAL), 'delivering-the-letter-to-jorral');
    assert.equal(condition(noLetter, N.JORRAL, '2f-Nnz'), true, 'lost-letter guard');
    assert.equal(condition(noLetter, N.JORRAL, 'Dr9Mvh'), false, 'no completion without the letter');
  } finally {
    ctx.cleanup();
  }
});

test('bootstrap resend keeps the canonical letter progress', () => {
  const ctx = setup();
  try {
    const player = playerFixture();
    ctx.quest.setStage(player, 1);

    // Jorral's letter held: the canonical wire is 2.
    action(player, N.JORRAL, 'pmH3ww');
    assert.equal(player.varbits.get(WIRE), 2);

    // The login bootstrap re-sends every quest's wire value after the login
    // hooks (QuestRuntime.sendQuestVarps); it must publish the same value.
    player.varbits.clear();
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(WIRE), 2, 'the bootstrap resend must not replay stage 1');

    player.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 2, 'the login hook keeps the letter progress');

    // King's letter held: the canonical wire is 3.
    action(player, N.KING_LATHAS, 'bbreqL');
    assert.equal(player.varbits.get(WIRE), 3);
    player.varbits.clear();
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(WIRE), 3, 'the bootstrap resend must not replay stage 1');
    player.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 3);

    // Completion stays 4 across the same two paths.
    action(player, N.JORRAL, 'pMj4WQ');
    assert.equal(ctx.quest.isComplete(player), true);
    player.varbits.clear();
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(WIRE), 4, 'completion survives the bootstrap resend');
    player.varbits.clear();
    ctx.localHooks.login.forEach((handler) => handler({ player }));
    assert.equal(player.varbits.get(WIRE), 4);
  } finally {
    ctx.cleanup();
  }
});

test('no duplicate King Lathas while the cache spawn is in the throne room', () => {
  const ctx = setup();
  const originalGetNpcsNear = World.getNpcsNear;
  const lastPerson = 'It all makes sense now, I never realised there was quite so much history to this place, it was more than I could have hoped.';
  try {
    // The cache spawns npc 9228 in the throne room; the client's transform
    // varbit turns it into 9005 "King Lathas".
    World.getNpcsNear = () => [{
      getId: () => 9228,
      getContentId: () => 9005,
      getOwner: () => undefined,
      isRegistered: () => true,
      isVisible: () => true,
    }];
    const player = playerFixture();
    ctx.quest.setStage(player, 1);
    line(player, N.JORRAL, lastPerson);
    action(player, N.JORRAL, 'pmH3ww');
    assert.equal(ctx.spawned.length, 0, 'no owner-only copy next to the canonical King Lathas');

    World.getNpcsNear = () => [{
      getId: () => 9228,
      getContentId: () => 9006,
      getOwner: () => undefined,
      isRegistered: () => true,
      isVisible: () => true,
    }];
    const thoros = playerFixture();
    ctx.quest.setStage(thoros, 1);
    line(thoros, N.JORRAL, lastPerson);
    action(thoros, N.JORRAL, 'pmH3ww');
    assert.ok(ctx.spawned.some((npc) => npc.id === N.KING_LATHAS),
      'the raw throne-room spawn resolving to King Thoros does not suppress King Lathas');

    // Without the canonical NPC the owner-only copy is still spawned.
    World.getNpcsNear = () => [];
    const other = playerFixture();
    ctx.quest.setStage(other, 1);
    line(other, N.JORRAL, lastPerson);
    action(other, N.JORRAL, 'pmH3ww');
    assert.ok(ctx.spawned.some((npc) => npc.id === N.KING_LATHAS),
      'the owner-only copy is the fallback');
  } finally {
    World.getNpcsNear = originalGetNpcsNear;
    ctx.cleanup();
  }
});

test('King Lathas letter handovers survive full bags and release the fallback NPC', () => {
  const ctx = setup();
  try {
    const full = playerFixture(inventoryFixture(new Map([[I.LETTER_4, 1]]), 0));
    ctx.quest.setStage(full, 1);
    action(full, N.KING_LATHAS, 'bbreqL');
    assert.equal(full.inventory.getAmount(I.LETTER_4), 0);
    assert.equal(full.inventory.getAmount(I.LETTER_5), 1, 'using Jorral\'s letter leaves its slot for the King\'s');

    const reissue = playerFixture(inventoryFixture(new Map(), 0));
    ctx.quest.setStage(reissue, 1);
    line(reissue, N.KING_LATHAS, 'Very well, take another.');
    assert.equal(reissue.inventory.getAmount(I.LETTER_5), 0);
    assert.ok(reissue.inventory.droppedItems.some(item => item.getId() === I.LETTER_5),
      'a full bag drops the reissued letter instead of losing it');
  } finally {
    ctx.cleanup();
  }
});

test('the enchanted key is rewarded and can be bought back', () => {
  const ctx = setup();
  try {
    // Completing without the key hands the advertised reward over.
    const player = playerFixture(inventoryFixture(new Map(), 5));
    ctx.quest.setStage(player, 1);
    action(player, N.JORRAL, 'pMj4WQ');
    assert.equal(ctx.quest.isComplete(player), true);
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 1, 'the key is the quest reward');
    assert.equal(player.inventory.getAmount(I.COINS), 750);

    // A full bag drops the reward at the reward location.
    const full = playerFixture(inventoryFixture(new Map(), 0));
    ctx.quest.setStage(full, 1);
    action(full, N.JORRAL, 'pMj4WQ');
    assert.equal(full.inventory.getAmount(I.ENCHANTED_KEY), 0);
    assert.ok(full.inventory.droppedItems.some(item => item.getId() === I.ENCHANTED_KEY),
      'the full-bag reward preserves the enchanted key on the ground');
    assert.ok(full.inventory.droppedItems.some(item => item.getId() === I.COINS && item.getAmount() === 749),
      'the full-bag reward preserves all 750 coins on the ground');

    // A player who still holds the key does not get a second one.
    const keeps = playerFixture(inventoryFixture(new Map([[I.ENCHANTED_KEY, 1]]), 5));
    ctx.quest.setStage(keeps, 1);
    action(keeps, N.JORRAL, 'pMj4WQ');
    assert.equal(keeps.inventory.getAmount(I.ENCHANTED_KEY), 1);

    // The silver merchant's post-quest conversation sells the key back for
    // 500 coins (the wiki's own lines).
    const lost = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 5));
    ctx.quest.setStage(lost, 2);
    assert.deepEqual(variant(lost, N.SILVER_MERCHANT), { page: 'Silver merchant', variant: 'after-making-history' });
    assert.equal(condition(lost, N.SILVER_MERCHANT, 'q_Kz9y'), true, 'without the key he sells it back');
    assert.equal(condition(lost, N.SILVER_MERCHANT, 'PaZHfR'), false, 'enough coins');
    assert.equal(condition(lost, N.SILVER_MERCHANT, 'PkuYso'), false, 'room in the bag');
    assert.equal(condition(lost, N.SILVER_MERCHANT, 'q4Kcl6'), true);
    action(lost, N.SILVER_MERCHANT, '57gscX');
    assert.equal(lost.inventory.getAmount(I.COINS), 1000, 'payment waits for the canonical receipt');
    action(lost, N.SILVER_MERCHANT, 'uDpunX');
    assert.equal(lost.inventory.getAmount(I.ENCHANTED_KEY), 1, 'the key comes back');
    assert.equal(lost.inventory.getAmount(I.COINS), 500, 'a verified receipt costs 500 coins');
    assert.equal(condition(lost, N.SILVER_MERCHANT, '9kVLlg'), true, 'with the key he only comments');

    // Not enough coins and no room are the wiki's other branches.
    const poor = playerFixture(inventoryFixture(new Map(), 5));
    ctx.quest.setStage(poor, 2);
    assert.equal(condition(poor, N.SILVER_MERCHANT, 'PaZHfR'), true);
    assert.equal(condition(poor, N.SILVER_MERCHANT, 'q4Kcl6'), false);
    const crowded = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 0));
    ctx.quest.setStage(crowded, 2);
    assert.equal(condition(crowded, N.SILVER_MERCHANT, 'PkuYso'), true);
    assert.equal(condition(crowded, N.SILVER_MERCHANT, 'q4Kcl6'), false);
  } finally {
    ctx.cleanup();
  }
});

// Restore the shared function after the file's tests have registered the module.
process.on('exit', () => { runtime.startTranscript = realStartTranscript; });

test('requirements and Jorral ownership use registered public quest queries', () => {
  const ctx = setup();
  try {
    const player = playerFixture();
    ctx.restless.setStage(player, 1);
    ctx.priest.setStage(player, 2);
    condition(player, N.JORRAL, 'zjWUw5');
    assert.ok(ctx.queries.some(([name, key]) => name === 'quest:is-started' && key === 'the_restless_ghost'));
    assert.ok(ctx.queries.some(([name, key]) => name === 'quest:is-complete' && key === 'priest_in_peril'));
    const slug = runtime.registerQuest(ctx.api, { key: 'the_slug_menace', name: 'The Slug Menace',
      varpId: -1, startedValue: 1, completionValue: 14 });
    ctx.quest.setStage(player, 1);
    slug.setStage(player, 5);
    variant(player, N.JORRAL);
    assert.ok(ctx.queries.some(([name, key]) => name === 'quest:get-stage' && key === 'the_slug_menace'));
  } finally { ctx.cleanup(); }
});

test('banked enchanted keys select their canonical condition and prevent recovery duplicates', () => {
  const ctx = setup();
  try {
    const player = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 5));
    player.getBanks = () => [null, { getAmount: id => id === I.ENCHANTED_KEY ? 1 : 0 }, null];
    ctx.quest.setStage(player, 2);
    assert.equal(condition(player, N.SILVER_MERCHANT, 'q_Kz9y'), false, 'banked key is not lost');
    assert.equal(condition(player, N.SILVER_MERCHANT, 'hiIg7x'), true, 'canonical banked-key branch');
    action(player, N.SILVER_MERCHANT, '57gscX');
    action(player, N.SILVER_MERCHANT, 'uDpunX');
    assert.equal(player.inventory.getAmount(I.COINS), 1000);
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 0);
    const active = playerFixture();
    active.getBanks = player.getBanks;
    ctx.quest.setStage(active, 1);
    choice(active, N.SILVER_MERCHANT, 'Ask about the outpost.');
    assert.equal(active.inventory.getAmount(I.ENCHANTED_KEY), 0, 'quest recovery also respects a banked key');
  } finally { ctx.cleanup(); }
});

test('paid key receipt validates current funds and space and charges only a verified addition', () => {
  const ctx = setup();
  try {
    const player = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 0));
    ctx.quest.setStage(player, 2);
    action(player, N.SILVER_MERCHANT, '57gscX');
    action(player, N.SILVER_MERCHANT, 'uDpunX');
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'full bag retains payment');
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 0);
    player.inventory.adds = () => {};
    player.inventory.getFreeSlots = () => 1;
    action(player, N.SILVER_MERCHANT, 'uDpunX');
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'failed actual addition retains payment');
    const poor = playerFixture(inventoryFixture(new Map([[I.COINS, 499]]), 5));
    ctx.quest.setStage(poor, 2);
    action(poor, N.SILVER_MERCHANT, 'uDpunX');
    assert.equal(poor.inventory.getAmount(I.ENCHANTED_KEY), 0, 'stale receipt cannot bypass the price');
  } finally { ctx.cleanup(); }
});

test('the real Silver merchant runner preserves cancel, banked-key and full-bag retry branches', () => {
  const ctx = setup();
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  try {
    ctx.api.sendMultiChatboxPrompt = PluginManager.createApi('q071-real-reclaim').sendMultiChatboxPrompt;
    const start = player => realStartTranscript(ctx.api, player, N.SILVER_MERCHANT,
      'Silver merchant', 'after-making-history');
    const drainToMenu = player => {
      const manager = player.getDialogueManager();
      for (let n = 0; n < 20 && manager.isActive() && !MultiChatboxPrompt.getPending(player); n++) manager.advance();
      assert.deepEqual(MultiChatboxPrompt.getPending(player)?.options, ['Yes please.', 'No thanks.']);
      return manager;
    };
    const player = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 5));
    ctx.quest.setStage(player, 2);
    assert.equal(start(player), true);
    const manager = drainToMenu(player);
    MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: (219 << 16) | 1, slot: 2 });
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'No thanks does not pay');
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 0);
    start(player);
    drainToMenu(player);
    player.getPacketSender().sendInterfaceRemoval();
    assert.equal(MultiChatboxPrompt.getPending(player), null);
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'closing the menu does not pay');

    // Conditions are evaluated again after the player's Yes line, before receipt.
    start(player);
    drainToMenu(player);
    assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: (219 << 16) | 1, slot: 1 }), true);
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'selection alone is not a receipt');
    const actualFreeSlots = player.inventory.getFreeSlots;
    player.inventory.getFreeSlots = () => 0;
    manager.advance();
    assert.equal(player.inventory.getAmount(I.COINS), 1000, 'a now-full bag keeps its coins');
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 0);
    manager.reset();
    player.inventory.getFreeSlots = actualFreeSlots;
    start(player);
    drainToMenu(player);
    assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: (219 << 16) | 1, slot: 1 }), true);
    manager.advance();
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 1);
    assert.equal(player.inventory.getAmount(I.COINS), 500);
    manager.reset();
    start(player);
    for (let n = 0; n < 20 && manager.isActive(); n++) manager.advance();
    assert.equal(player.inventory.getAmount(I.ENCHANTED_KEY), 1, 'repeat talk does not duplicate');
    assert.equal(player.inventory.getAmount(I.COINS), 500);

    const banked = playerFixture(inventoryFixture(new Map([[I.COINS, 1000]]), 5));
    banked.getBanks = () => [null, { getAmount: id => id === I.ENCHANTED_KEY ? 1 : 0 }];
    ctx.quest.setStage(banked, 2);
    start(banked);
    const bankManager = banked.getDialogueManager();
    for (let n = 0; n < 20 && bankManager.isActive(); n++) {
      assert.equal(MultiChatboxPrompt.getPending(banked), null, 'banked-key branch never offers a purchase');
      bankManager.advance();
    }
    assert.equal(banked.inventory.getAmount(I.COINS), 1000);
    assert.equal(banked.inventory.getAmount(I.ENCHANTED_KEY), 0);
  } finally { ctx.cleanup(); }
});
