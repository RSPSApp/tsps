// Dwarf Cannon (q027) source-contract checks.
// From server/: node --test tests/qh728-q027.test.cjs (the plugin is JS; dist must already be built).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

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
      for (let placed = 0; placed < amount; placed++) {
        if (free <= 0) return;
        free--;
        items.set(id, (items.get(id) ?? 0) + 1);
      }
    },
    forceAdd(_player, item) { this.adds(item.getId(), item.getAmount()); },
    deleteNumber(id, amount = 1) {
      const left = Math.max(0, (items.get(id) ?? 0) - amount);
      if (left === 0) {
        if (items.delete(id)) free += Math.min(amount, 1);
      } else {
        items.set(id, left);
      }
    },
  };
}

function playerFixture(inventory = inventoryFixture()) {
  const attributes = new Map();
  const messages = [];
  const configs = new Map();
  const interfaces = [];
  const xp = [];
  let location = new core.Location(2567, 3460, 0);
  let manager;
  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { configs.set(id, value); return sender; },
    sendInterface(id) { interfaces.push(id); return sender; },
    sendInterfaceRemoval() { interfaces.pop(); manager?.reset(); return sender; },
    getVarbit(id) { return configs.get(id) ?? 0; },
    closeSubInterface() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    inventory,
    messages,
    configs,
    interfaces,
    xp,
    getUsername: () => 'qh728-q027',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getSkillManager: () => ({ addExperiences(skill, amount) { xp.push({ skill, amount }); } }),
    getLocation: () => location,
    moveTo(target) { location = target; },
    getDialogueManager: () => manager,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };
  manager = new DialogueManager(player);
  return player;
}

function registerQuestPlugin() {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    object: PluginManager.objectInteractionHooks.length,
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    interfaceActionClick: PluginManager.interfaceActionClickHooks.length,
    login: PluginManager.loginHooks.length,
  };
  const customEvents = new Set();
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName: 'DwarfCannonTest', handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName: 'DwarfCannonTest', handler });
    if (key === 'onObjectInteraction') return (handler) => PluginManager.objectInteractionHooks.push({ pluginName: 'DwarfCannonTest', order: ++PluginManager.nextObjectHookOrder, handler });
    if (key === 'onItemOnObject') return (handler) => PluginManager.itemOnObjectHooks.push({ pluginName: 'DwarfCannonTest', handler });
    if (key === 'onInterfaceActionClick') return (handler) => PluginManager.interfaceActionClickHooks.push({ pluginName: 'DwarfCannonTest', handler });
    if (key === 'onPlayerLogin') return (handler) => PluginManager.loginHooks.push({ pluginName: 'DwarfCannonTest', handler });
    if (key === 'onCustomEvent') return (eventName, handler) => {
      customEvents.add(eventName);
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName: 'DwarfCannonTest', handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    return () => {};
  } });
  require('../plugins/quests/quests/DwarfCannon.Quest')(api);
  return {
    quest: getRegisteredQuests().findLast((entry) => entry.key === 'dwarf_cannon'),
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.objectInteractionHooks.length = before.object;
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.interfaceActionClickHooks.length = before.interfaceActionClick;
      PluginManager.loginHooks.length = before.login;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== 'DwarfCannonTest');
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

function object(player, objectId, option, location) {
  return PluginManager.emitObjectInteraction({
    // ObjectActionPacketListener passes cache actions to generic hooks in lower case.
    player, objectId, option: String(option).toLowerCase(), location, sourceLocation: location,
    object: { getId: () => objectId }, definition: { getName: () => 'Dwarf Cannon object' },
    clickType: 1, handled: false,
  });
}

function action(player, npcId, stepId, text = '') {
  PluginManager.emitCustomEvent('npc-dialogue:action', { player, npcId, stepId, text, kind: 'message', handled: false });
}

function variant(player, npcId) {
  return PluginManager.emitNpcDialogueVariant({ player, npcId });
}

function condition(player, npcId, text) {
  return PluginManager.emitNpcDialogueCondition({ player, npcId, text });
}

test('fresh stage 0 runs every mandatory Dwarf Cannon leg to the canonical varp 0 = 11', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const inventory = inventoryFixture();
    const player = playerFixture(inventory);

    assert.equal(quest.getStage(player), 0);
    PluginManager.emitCustomEvent('npc-dialogue:hook', {
      player, npcId: N.CAPTAIN_LAWGOF, hook: 'quest:dwarf-cannon:start',
    });
    assert.equal(quest.getStage(player), 1);
    assert.equal(inventory.getAmount(I.RAILING), 6, 'the start hand-out gives six railings');
    assert.equal(inventory.getAmount(I.HAMMER), 1);
    assert.equal(player.configs.get(0), 1, 'stage 1 is mirrored to canonical varp 0');

    const railingIds = [15590, 15591, 15592, 15593, 15594, 15595];
    for (const objectId of railingIds) {
      assert.equal(object(player, objectId, 'Inspect', { x: 0, y: 0, z: 0 }), true);
      if (objectId === railingIds[0]) {
        assert.equal(player.configs.get(2240), 1, 'the cache-backed fixed railing varbit changes');
        assert.equal(object(player, objectId, 'Inspect', { x: 0, y: 0, z: 0 }), true);
        assert.equal(inventory.getAmount(I.RAILING), 5, 're-inspecting one fixed railing does not consume a second spare');
        assert.equal(player.getAttribute('dwarf-cannon:rails-fixed'), 1, 're-inspecting does not increment the fixed count');
      }
    }
    assert.equal(inventory.getAmount(I.RAILING), 0, 'six repairs consume six railings');
    assert.equal(quest.getStage(player), 2);
    assert.equal(player.configs.get(0), 2);

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings',
    });
    assert.equal(quest.getStage(player), 3, 'the railings report opens the watchtower leg');
    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon',
      variant: 'fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings-talking-to-captain-lawgof-again-without-visiting-the-watchtower',
    });

    object(player, 0, 'Take', { x: 2567, y: 3444, z: 2 });
    assert.equal(inventory.getAmount(I.DWARF_REMAINS), 1);
    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains',
    });
    action(player, N.CAPTAIN_LAWGOF, 'KcffSR');
    assert.equal(inventory.getAmount(I.DWARF_REMAINS), 0);
    assert.equal(quest.getStage(player), 4);

    object(player, 1, 'Search', { x: 2571, y: 9850, z: 0 });
    assert.equal(quest.getStage(player), 4, 'the crate transcript must play before the rescue completes');
    action(player, N.LOLLK, 'VYQQX5');
    assert.equal(quest.getStage(player), 5);

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'the-dwarf-child-talking-to-captain-lawgof-after-finding-lollk',
    });
    action(player, N.CAPTAIN_LAWGOF, 'dqO_5X');
    assert.equal(inventory.getAmount(I.TOOLKIT), 1);
    assert.equal(quest.getStage(player), 6);

    assert.equal(PluginManager.emitItemOnObject({
      player, objectId: 15597, itemId: I.TOOLKIT, itemSlot: 0,
      location: { x: 2562, y: 3461, z: 0 }, handled: false,
    }), true);
    assert.equal(quest.getStage(player), 6, 'the toolkit opens the repair puzzle without awarding completion');
    assert.deepEqual(player.interfaces, [409], 'the cache multicannon repair interface opens');
    const cannonClick = (child) => PluginManager.emitInterfaceActionClick({
      player, buttonId: (409 << 16) | child, action: 1, handled: false,
    });
    cannonClick(2); // pliers
    cannonClick(8); // spring requires the hook, so this is rejected
    assert.equal(player.configs.get(2239), 0);
    cannonClick(3); // hook
    assert.equal(player.configs.get(2237), 1);
    cannonClick(8); // spring
    assert.equal(player.configs.get(2239), 1);
    cannonClick(1); // toothed tool
    cannonClick(9); // gear cannot finish before the safety switch
    assert.equal(quest.getStage(player), 6);
    cannonClick(2); // pliers
    cannonClick(7); // safety switch
    assert.equal(player.configs.get(2238), 1);
    cannonClick(1); // toothed tool
    cannonClick(9); // gear
    assert.equal(quest.getStage(player), 8);
    assert.deepEqual(player.interfaces, [], 'the repaired cannon closes the puzzle');
    assert.equal(inventory.getAmount(I.TOOLKIT), 1, 'the toolkit is returned in the next conversation');

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon',
    });
    action(player, N.CAPTAIN_LAWGOF, 'A9qG_N');
    assert.equal(inventory.getAmount(I.TOOLKIT), 0);
    assert.equal(quest.getStage(player), 9);

    assert.deepEqual(variant(player, N.NULODION), {
      page: 'Dwarf Cannon', variant: 'fixing-the-cannon-talking-to-nulodion',
    });
    action(player, N.NULODION, 'udZI3D');
    assert.equal(inventory.getAmount(I.NULODIONS_NOTES), 1);
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 1);
    assert.equal(quest.getStage(player), 10);

    const beforeXp = player.xp.length;
    action(player, N.CAPTAIN_LAWGOF, 'c8LrCL');
    assert.equal(quest.getStage(player), 11, 'completion is the cache completion threshold');
    assert.equal(player.configs.get(0), 11, 'canonical varp 0 carries the completion value');
    assert.equal(inventory.getAmount(I.NULODIONS_NOTES), 0, 'the notes are handed over');
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 1, 'Nulodion’s mould is retained without another completion grant');
    assert.equal(player.getAttribute('quest.points'), 1);
    assert.equal(player.xp.length, beforeXp + 1);
    assert.equal(player.xp.at(-1).skill.getIndex(), core.Skill.CRAFTING.getIndex());
    assert.equal(player.xp.at(-1).amount, 750);

    action(player, N.CAPTAIN_LAWGOF, 'c8LrCL');
    assert.equal(player.getAttribute('quest.points'), 1, 'repeat hand-in cannot award quest points twice');
    assert.equal(player.xp.length, beforeXp + 1, 'repeat hand-in cannot award XP twice');
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 1, 'repeat hand-in cannot duplicate the mould');

    player.configs.clear();
    PluginManager.emitPlayerLogin({ player });
    assert.equal(player.configs.get(0), 11, 'login bootstrap re-sends the saved stage on canonical varp 0');
    for (let varbit = 2240; varbit <= 2245; varbit++) {
      assert.equal(player.configs.get(varbit), 1, `login restores fixed railing varbit ${varbit}`);
    }
  } finally {
    cleanup();
  }
});

test('lost-item and durable-save recovery routes restore the missing quest item', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;

    const railingPlayer = playerFixture(inventoryFixture(new Map([[I.HAMMER, 1]])));
    quest.setStage(railingPlayer, 1);
    action(railingPlayer, N.CAPTAIN_LAWGOF, '09BKsq');
    assert.equal(railingPlayer.inventory.getAmount(I.RAILING), 1);

    const toolkitPlayer = playerFixture(inventoryFixture());
    quest.setStage(toolkitPlayer, 6);
    action(toolkitPlayer, N.CAPTAIN_LAWGOF, 'R6x03x');
    assert.equal(toolkitPlayer.inventory.getAmount(I.TOOLKIT), 1);

    const notesPlayer = playerFixture(inventoryFixture(new Map([[I.AMMO_MOULD, 1]])));
    quest.setStage(notesPlayer, 10);
    action(notesPlayer, N.NULODION, 'vxwzuL');
    assert.equal(notesPlayer.inventory.getAmount(I.NULODIONS_NOTES), 1);
    assert.equal(notesPlayer.inventory.getAmount(I.AMMO_MOULD), 1);

    const mouldPlayer = playerFixture(inventoryFixture(new Map([[I.NULODIONS_NOTES, 1]])));
    quest.setStage(mouldPlayer, 10);
    action(mouldPlayer, N.NULODION, '3LMqqz');
    assert.equal(mouldPlayer.inventory.getAmount(I.NULODIONS_NOTES), 1);
    assert.equal(mouldPlayer.inventory.getAmount(I.AMMO_MOULD), 1);

    // A durable stage-10 save that already has both items keeps them and can
    // still complete; no stage renumbering is involved.
    const completePlayer = playerFixture(inventoryFixture(new Map([
      [I.NULODIONS_NOTES, 1], [I.AMMO_MOULD, 1],
    ])));
    quest.setStage(completePlayer, 10);
    action(completePlayer, N.CAPTAIN_LAWGOF, 'c8LrCL');
    assert.equal(quest.getStage(completePlayer), 11);
  } finally {
    cleanup();
  }
});

test('a full bag at the tool kit hand-out keeps the repair stage and leaves room to recover', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const player = playerFixture(inventoryFixture(new Map(), 0));
    quest.setStage(player, 5);
    action(player, N.CAPTAIN_LAWGOF, 'dqO_5X');
    assert.equal(quest.getStage(player), 5, 'no toolkit means the repair leg has not started');
    assert.equal(player.inventory.getAmount(I.TOOLKIT), 0);
  } finally {
    cleanup();
  }
});

test('Nulodion gives the notes and mould atomically when two slots are needed', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const oneSlot = playerFixture(inventoryFixture(new Map(), 1));
    quest.setStage(oneSlot, 9);
    assert.equal(condition(oneSlot, N.NULODION, 'If the player has no inventory space:'), true);
    action(oneSlot, N.NULODION, 'udZI3D');
    assert.equal(oneSlot.inventory.getAmount(I.NULODIONS_NOTES), 0, 'the failed hand-out does not take the only slot');
    assert.equal(oneSlot.inventory.getAmount(I.AMMO_MOULD), 0);
    assert.equal(quest.getStage(oneSlot), 9);

    const oneMissing = playerFixture(inventoryFixture(new Map([[I.NULODIONS_NOTES, 1]]), 1));
    quest.setStage(oneMissing, 9);
    assert.equal(condition(oneMissing, N.NULODION, 'If the player has no inventory space:'), false);
    action(oneMissing, N.NULODION, 'udZI3D');
    assert.equal(oneMissing.inventory.getAmount(I.NULODIONS_NOTES), 1);
    assert.equal(oneMissing.inventory.getAmount(I.AMMO_MOULD), 1);
    assert.equal(quest.getStage(oneMissing), 10);
  } finally {
    cleanup();
  }
});
