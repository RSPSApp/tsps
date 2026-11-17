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
const realCore = PluginManager.getCoreApi();
// Railing repairs run on a tick task; the test runs queued tasks itself.
const queuedTasks = [];
const core = { ...realCore, TaskManager: { submit: (task) => queuedTasks.push(task) } };
function runQueuedTasks() {
  while (queuedTasks.length) queuedTasks.shift().execute();
}
const { rolls } = require('../plugins/quests/quests/DwarfCannon.Quest')._test;
function withRolls(next, run) {
  const previous = rolls.next;
  rolls.next = next;
  try { return run(); } finally { rolls.next = previous; }
}

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
  const models = new Map();
  const interfaceAnimations = new Map();
  const xp = [];
  const animations = [];
  const chats = [];
  const dialogueText = [];
  const hits = [];
  const levels = new Map();
  let blocked = false;
  const movement = {
    reset: () => movement,
    setBlockMovement(value) { blocked = value; return movement; },
    isMovementBlocked: () => blocked,
  };
  let location = new core.Location(2567, 3460, 0);
  let manager;
  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendString(text) { dialogueText.push(text); return sender; },
    sendVarbit(id, value) { configs.set(id, value); return sender; },
    sendInterface(id) { interfaces.push(id); return sender; },
    sendInterfaceRawModel(uid, model) { models.set(uid, model); return sender; },
    sendInterfaceAnimation(uid, seq) { interfaceAnimations.set(uid, seq); return sender; },
    sendInterfaceRemoval() { interfaces.pop(); manager?.reset(); return sender; },
    getVarbit(id) { return configs.get(id) ?? 0; },
    closeSubInterface() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    inventory,
    messages,
    configs,
    interfaces,
    models,
    interfaceAnimations,
    xp,
    animations,
    chats,
    dialogueText,
    hits,
    getIndex: () => 1,
    performAnimation(animation) { animations.push(animation.getId?.() ?? animation.id); },
    forceChat(text) { chats.push(text); return player; },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.push(...damage) }) }),
    getUsername: () => 'qh728-q027', getDisplayName: () => 'qh728-q027',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getSkillManager: () => ({
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
      getCurrentLevel: (skill) => levels.get(skill) ?? 66,
      setCurrentLevel(skill, level) { levels.set(skill, level); },
    }),
    getLocation: () => location,
    getMovementQueue: () => movement,
    moveTo(target) { location = target; },
    getDialogueManager: () => manager,
    getPacketSender: () => sender,
    getInterfaceId: () => interfaces.at(-1) ?? -1,
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
    npcInteraction: PluginManager.npcInteractionHooks.length,
  };
  const customEvents = new Set();
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcInteraction') return PluginManager.createApi('DwarfCannonTest').onNpcInteraction;
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
      PluginManager.npcInteractionHooks.length = before.npcInteraction;
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
  const event = { player, npcId, stepId, text, kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
}

/** A transcript line as NpcDialogues emits it: `before` runs as it shows, `after` as it closes. */
function line(player, npcId, text, step = { type: 'line', text }) {
  const event = { player, npcId, text, step, skip: false };
  PluginManager.emitCustomEvent('npc-dialogue:line', event);
  event.before?.();
  event.after?.();
  return event;
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
    const inventory = inventoryFixture(new Map([[I.HAMMER, 1]]));
    const player = playerFixture(inventory);
    const advanceAll = () => {
      for (let i = 0; i < 40 && player.getDialogueManager().isActive(); i++) player.getDialogueManager().advance();
    };

    assert.equal(quest.getStage(player), 0);
    line(player, N.CAPTAIN_LAWGOF, "That's the spirit! Now trooper, we have no time to waste");
    assert.equal(quest.getStage(player), 1, 'varp 0 is 1 on "That\'s the spirit!"');
    assert.equal(player.configs.get(0), 1, 'stage 1 is mirrored to canonical varp 0');
    const box = action(player, N.CAPTAIN_LAWGOF, 's7iFdl');
    assert.deepEqual(box.box, { items: [I.RAILING] }, 'six railings in an item box');
    assert.equal(inventory.getAmount(I.RAILING), 6);

    const railingIds = [15590, 15591, 15592, 15593, 15594, 15595];
    // "This railing is broken..." is a message box ({{tbox}}); its continue makes the attempt.
    const inspect = (objectId) => {
      const handled = object(player, objectId, 'Inspect', { x: 0, y: 0, z: 0 });
      if (player.getDialogueManager().isActive()) player.getDialogueManager().advance();
      return handled;
    };
    assert.equal(object(player, railingIds[0], 'Inspect', { x: 0, y: 0, z: 0 }), true);
    assert.ok(player.dialogueText.includes('This railing is broken and needs to be replaced.'), 'the box');
    player.getDialogueManager().advance();
    assert.equal(player.messages.at(-1), 'You attempt to repalce the broken railing...');
    // A failure: the roll misses, then a hit (crush: 2 damage) ends the attempt.
    const sequence = [0.99, 0.6];
    withRolls(() => sequence.shift() ?? 0.99, runQueuedTasks);
    assert.equal(player.animations.at(-1), 4190, 'mcannon_hammer_anim plays');
    assert.equal(player.messages.at(-1), 'You accidentally crush your hand in the railing.');
    assert.equal(player.chats.at(-1), 'Ow!');
    assert.equal(player.hits.at(-1).getDamage(), 2);
    assert.equal(inventory.getAmount(I.RAILING), 6, 'a failure keeps the railing');
    assert.equal(player.configs.get(2240), undefined);
    for (const objectId of railingIds) {
      assert.equal(inspect(objectId), true);
      withRolls(() => 0, runQueuedTasks);
      assert.equal(player.messages.at(-1), 'This railing is now fixed.');
      if (objectId === railingIds[0]) {
        assert.equal(player.configs.get(2240), 1, 'the cache-backed fixed railing varbit changes');
        const shown = player.dialogueText.length;
        assert.equal(object(player, objectId, 'Inspect', { x: 0, y: 0, z: 0 }), true);
        assert.ok(player.dialogueText.slice(shown).some((text) => String(text).includes("I've fixed all these railings now.")));
        advanceAll();
        assert.equal(inventory.getAmount(I.RAILING), 5, 're-inspecting one fixed railing does not consume a second spare');
      }
    }
    advanceAll();
    assert.equal(inventory.getAmount(I.RAILING), 0, 'six repairs consume six railings');
    assert.equal(player.configs.get(2246), 1, 'mcannon_taken_corpse comes with railing 6');
    assert.equal(quest.getStage(player), 1, 'live keeps varp 0 at 1 until the report');

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings',
    });
    line(player, N.CAPTAIN_LAWGOF, 'Excellent! I have two men there, the dwarf-in-charge is called Gilob');
    assert.equal(quest.getStage(player), 2, 'the report sets 2 on "Excellent!"');
    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon',
      variant: 'fixing-the-railings-talking-to-captain-lawgof-after-fixing-the-railings-talking-to-captain-lawgof-again-without-visiting-the-watchtower',
    });
    PluginManager.emitCustomEvent('loc-teleports:arrived', { player, objectId: 11, location: { x: 2570, y: 3443, z: 1 } });
    assert.equal(quest.getStage(player), 3, 'the top ladder of the watchtower sets 3');

    assert.equal(object(player, 0, 'Take', { x: 2567, y: 3444, z: 2 }), true);
    advanceAll();
    assert.equal(inventory.getAmount(I.DWARF_REMAINS), 1);
    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'finding-the-remains-talking-to-captain-lawgof-after-getting-the-remains',
    });
    const handIn = action(player, N.CAPTAIN_LAWGOF, 'KcffSR');
    assert.deepEqual(handIn.box, { items: [I.DWARF_REMAINS] });
    assert.equal(quest.getStage(player), 3, 'varp 0 moves on the box continue');
    handIn.after();
    assert.equal(inventory.getAmount(I.DWARF_REMAINS), 0);
    assert.equal(quest.getStage(player), 4);
    PluginManager.emitCustomEvent('loc-teleports:arrived', { player, objectId: 2, location: { x: 2622, y: 3392, z: 0 } });
    assert.equal(quest.getStage(player), 5, 'the cave entrance sets 5');

    object(player, 1, 'Search', { x: 2571, y: 9850, z: 0 });
    assert.equal(player.messages.at(-1), 'You search the crate...');
    assert.equal(quest.getStage(player), 5, 'untied on the timeline, not at the click');
    runQueuedTasks();
    assert.equal(quest.getStage(player), 6, 'varp 0 is 6 at "You untie the child."');
    action(player, N.LOLLK, 'VYQQX5');
    runQueuedTasks();
    advanceAll();

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'the-dwarf-child-talking-to-captain-lawgof-after-finding-lollk',
    });
    action(player, N.CAPTAIN_LAWGOF, 'dqO_5X');
    assert.equal(inventory.getAmount(I.TOOLKIT), 1);
    assert.equal(quest.getStage(player), 7);

    assert.equal(PluginManager.emitItemOnObject({
      player, objectId: 15597, itemId: I.TOOLKIT, itemSlot: 0,
      location: { x: 2562, y: 3461, z: 0 }, handled: false,
    }), true);
    assert.deepEqual(player.interfaces, [409], 'the cache multicannon repair interface opens');
    const cannonClick = (child) => PluginManager.emitInterfaceActionClick({
      player, buttonId: (409 << 16) | child, action: 1, handled: false,
    });
    cannonClick(2); // pliers
    cannonClick(8); // spring requires the hook, so this is rejected
    assert.equal(player.configs.get(2239), 0);
    cannonClick(3); // hook
    cannonClick(8); // spring
    assert.equal(player.configs.get(2239), 1);
    cannonClick(1); // toothed tool
    cannonClick(9); // gear cannot finish before the safety switch
    assert.equal(quest.getStage(player), 7);
    cannonClick(2); // pliers
    cannonClick(7); // safety switch
    cannonClick(1); // toothed tool
    cannonClick(9); // gear
    assert.equal(quest.getStage(player), 8);
    runQueuedTasks();
    assert.deepEqual(player.interfaces, [], 'the repaired cannon closes the puzzle');

    assert.deepEqual(variant(player, N.CAPTAIN_LAWGOF), {
      page: 'Dwarf Cannon', variant: 'fixing-the-cannon-talking-to-captain-lawgof-after-fixing-the-cannon',
    });
    action(player, N.CAPTAIN_LAWGOF, 'A9qG_N');
    assert.equal(inventory.getAmount(I.TOOLKIT), 0);
    assert.equal(quest.getStage(player), 8, 'the toolkit goes back before the player agrees');
    line(player, N.CAPTAIN_LAWGOF, "Okay, I'll see what I can do.", { player: "Okay, I'll see what I can do." });
    assert.equal(quest.getStage(player), 9);

    assert.deepEqual(variant(player, N.NULODION), {
      page: 'Dwarf Cannon', variant: 'fixing-the-cannon-talking-to-nulodion',
    });
    const given = action(player, N.NULODION, 'udZI3D');
    assert.deepEqual(given.box, { items: [I.NULODIONS_NOTES, I.AMMO_MOULD] });
    assert.equal(inventory.getAmount(I.NULODIONS_NOTES), 1);
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 1);
    assert.equal(quest.getStage(player), 10);

    const beforeXp = player.xp.length;
    action(player, N.CAPTAIN_LAWGOF, 'c8LrCL');
    assert.equal(quest.getStage(player), 11, 'completion is the cache completion threshold');
    assert.equal(player.configs.get(0), 11, 'canonical varp 0 carries the completion value');
    assert.equal(inventory.getAmount(I.NULODIONS_NOTES), 0, 'the notes are handed over');
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 0, 'the mould is handed over too');
    for (let varbit = 2240; varbit <= 2246; varbit++) assert.equal(player.configs.get(varbit), 0, `varbit ${varbit} cleared`);
    assert.equal(player.getAttribute('quest.points'), 1);
    assert.equal(player.xp.length, beforeXp + 1);
    assert.equal(player.xp.at(-1).skill.getIndex(), core.Skill.CRAFTING.getIndex());
    assert.equal(player.xp.at(-1).amount, 750);

    inventory.adds(I.NULODIONS_NOTES, 1);
    inventory.adds(I.AMMO_MOULD, 1);
    action(player, N.CAPTAIN_LAWGOF, 'c8LrCL');
    assert.equal(player.getAttribute('quest.points'), 1, 'repeat hand-in cannot award quest points twice');
    assert.equal(player.xp.length, beforeXp + 1, 'repeat hand-in cannot award XP twice');
    assert.equal(inventory.getAmount(I.AMMO_MOULD), 1, 'repeat hand-in takes nothing');

    player.configs.clear();
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
    assert.equal(player.configs.get(0), 11, 'login bootstrap re-sends the saved stage on canonical varp 0');
    assert.equal(player.configs.get(2240), undefined, 'the railings stay cleared after completion');
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
    quest.setStage(toolkitPlayer, 7);
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
    quest.setStage(player, 6);
    action(player, N.CAPTAIN_LAWGOF, 'dqO_5X');
    assert.equal(quest.getStage(player), 6, 'no toolkit means the repair leg has not started');
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

test('the Lollk rescue and toolkit receipt send their native varp 0 values on bootstrap', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 6);
    assert.equal(player.configs.get(0), 6, 'QH stage6 returns to Lawgof');
    player.configs.delete(0);
    require('../plugins/quests/QuestRuntime').sendQuestVarps({ player });
    assert.equal(player.configs.get(0), 6);
    action(player, core.NpcIdentifiers.CAPTAIN_LAWGOF, 'dqO_5X');
    assert.equal(quest.getStage(player), 7);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.TOOLKIT), 1);
    assert.equal(player.configs.get(0), 7, 'QH stage7 repairs the multicannon');
    player.configs.delete(0);
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
    require('../plugins/quests/QuestRuntime').sendQuestVarps({ player });
    assert.equal(player.configs.get(0), 7);
  } finally { cleanup(); }
});

test('a stage 7 save can complete the registered repair interface', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture(inventoryFixture(new Map([[core.ItemIdentifiers.TOOLKIT, 1]])));
    quest.setStage(player, 7);
    assert.equal(PluginManager.emitItemOnObject({ player, objectId: 15597,
      itemId: core.ItemIdentifiers.TOOLKIT, itemSlot: 0,
      location: { x: 2562, y: 3461, z: 0 }, handled: false }), true);
    assert.deepEqual(player.interfaces, [409]);
    for (const child of [2, 7, 3, 8, 1, 9]) {
      PluginManager.emitInterfaceActionClick({ player, buttonId: (409 << 16) | child, action: 1, handled: false });
    }
    assert.equal(quest.getStage(player), 8);
    assert.equal(player.configs.get(0), 8);
    assert.deepEqual(player.interfaces, [409], 'open while the mechanism works');
    runQueuedTasks();
    assert.deepEqual(player.interfaces, [], 'closed 4 ticks after the gear');
  } finally { cleanup(); }
});

test('repair tools visibly select their native models and stale clicks cannot repair a closed interface', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture(inventoryFixture(new Map([[core.ItemIdentifiers.TOOLKIT, 1]])));
    quest.setStage(player, 7);
    const click = child => PluginManager.emitInterfaceActionClick({ player,
      buttonId: (409 << 16) | child, action: 1, handled: false });
    assert.equal(click(3), false, 'cannot select a tool before opening the puzzle');
    PluginManager.emitItemOnObject({ player, objectId: 15597,
      itemId: core.ItemIdentifiers.TOOLKIT, handled: false });
    assert.deepEqual([1, 2, 3].map(c => player.models.get((409 << 16) | c)), [15328, 15330, 15332]);
    click(3);
    assert.deepEqual([1, 2, 3].map(c => player.models.get((409 << 16) | c)), [15328, 15330, 15331]);
    click(8);
    assert.equal(player.configs.get(2239), 1);
    assert.equal(player.interfaceAnimations.get((409 << 16) | 5), 3202, 'mcannon_interface_gun_attach_spring (captured)');
    assert.equal(player.models.get((409 << 16) | 3), 15331, 'the hooked tool stays selected');
    click(2);
    assert.equal(player.models.get((409 << 16) | 2), 15329);
    click(7);
    assert.equal(player.interfaceAnimations.get((409 << 16) | 5), 3198, 'mcannon_interface_gun_safety_off_with_spring (captured)');
    player.getPacketSender().sendInterfaceRemoval();
    click(1); click(9);
    assert.equal(quest.getStage(player), 7, 'closing the puzzle prevents delayed completion clicks');
    PluginManager.emitItemOnObject({ player, objectId: 15597,
      itemId: core.ItemIdentifiers.TOOLKIT, handled: false });
    assert.equal(player.configs.get(2238), 0, 'reopening clears the prior repair state');
    assert.equal(player.configs.get(2239), 0);
    assert.equal(player.interfaceAnimations.get((409 << 16) | 5), 3196);
    for (const c of [3, 8, 2, 7, 1, 9]) click(c);
    assert.equal(quest.getStage(player), 8);
    assert.equal(click(9), false, 'completion is not repeatable');
  } finally { cleanup(); }
});

test('Lawgof repeats the Lollk rescue instructions after accepting the remains', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 4);
    const npc = core.NPC.create(core.NpcIdentifiers.CAPTAIN_LAWGOF, new core.Location(2567, 3460, 0));
    assert.equal(PluginManager.emitNpcInteraction({ player, npc,
      npcId: npc.getId(), definition: npc.getDefinition(), clickType: 1, handled: false }), true);
    for (let i = 0; i < 20 && player.getDialogueManager().isActive(); i++) player.getDialogueManager().advance();
    assert.equal(quest.getStage(player), 4);
    assert.ok(player.dialogueText.join(' ').includes('Lollk'),
      'the canonical rescue dialogue is played');
    assert.ok(!player.dialogueText.join(' ').includes('any news from the watchman'));
  } finally { cleanup(); }
});

test('completed Nulodion releases his generic page and stops quest-only notes and mould recovery', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 10);
    action(player, core.NpcIdentifiers.NULODION, 'vxwzuL');
    action(player, core.NpcIdentifiers.NULODION, '3LMqqz');
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.NULODIONS_NOTES), 1);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.AMMO_MOULD), 1);
    quest.setStage(player, 11);
    assert.equal(variant(player, core.NpcIdentifiers.NULODION), null, 'completed quest yields the generic NPC page');
    player.inventory.deleteNumber(core.ItemIdentifiers.NULODIONS_NOTES);
    player.inventory.deleteNumber(core.ItemIdentifiers.AMMO_MOULD);
    action(player, core.NpcIdentifiers.NULODION, 'vxwzuL');
    action(player, core.NpcIdentifiers.NULODION, '3LMqqz');
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.NULODIONS_NOTES), 0);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.AMMO_MOULD), 0);
  } finally { cleanup(); }
});

test('real postquest Nulodion dispatch retains the shared cannon shop and lost-cannon owner', () => {
  let quest, cleanup = () => {};
  const customBefore = new Map([...PluginManager.customEventHooks].map(([name, hooks]) => [name, [...hooks]]));
  const conditionBefore = PluginManager.npcDialogueConditionHooks.length;
  const interactionBefore = PluginManager.npcAnyInteractionHooks.length;
  const Cannon = require('../plugins/items/dwarfcannon/Common.DwarfCannon');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const api = PluginManager.createApi('q027-real-nulodion');
  try {
    Cannon.init(api);
    require('../plugins/items/dwarfcannon/Nulodion.DwarfCannon')(api);
    require('../plugins/npcs/NpcDialogues.plugin').register(api);
    // The shared item/NPC services load before the quest plugins in production.
    ({ quest, cleanup } = registerQuestPlugin());
    const player = playerFixture(inventoryFixture(new Map([[core.ItemIdentifiers.COINS, 750000]])));
    player.getPrivateArea = () => null;
    player.inventory.add = item => player.inventory.adds(item.getId(), item.getAmount());
    player.inventory.delete = (id, amount) => player.inventory.deleteNumber(id, amount);
    quest.setStage(player, 11);
    const npc = core.NPC.create(core.NpcIdentifiers.NULODION, new core.Location(3012, 3453, 0));
    const definition = npc.getCurrentDefinition(player);
    assert.equal(definition.getName(), 'Nulodion');
    const talk = () => PluginManager.emitNpcInteraction({ player, npc,
      npcId: npc.getContentId(player), definition, clickType: 1, handled: false });
    const menu = () => {
      for (let n = 0; n < 30 && player.getDialogueManager().isActive(); n++) player.getDialogueManager().advance();
      const prompt = MultiChatboxPrompt.getPending(player);
      assert.ok(prompt, 'actual transcript produces its canonical menu');
      return prompt.options;
    };
    const choose = label => {
      const options = menu();
      const index = options.indexOf(label);
      assert.ok(index >= 0, `missing canonical option ${label}`);
      assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player,
        buttonId: (219 << 16) | 1, slot: index + 1 }), true);
    };
    assert.equal(talk(), true);
    choose('I was hoping you might sell me a cannon.');
    choose("Okay, I'll take a cannon please.");
    for (let n = 0; n < 30 && player.getDialogueManager().isActive(); n++) player.getDialogueManager().advance();
    for (const id of [...Cannon.KINDS.plain.parts, core.ItemIdentifiers.AMMO_MOULD, core.ItemIdentifiers.INSTRUCTION_MANUAL]) {
      assert.equal(player.inventory.getAmount(id), 1, 'shared shop supplies every purchased item once');
    }
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.COINS), 0);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.NULODIONS_NOTES), 0);
    assert.equal(quest.getStage(player), 11);

    player.setAttribute(Cannon.LOST_ATTRIBUTE, { kind: 'plain', stage: 4 });
    for (const id of Cannon.KINDS.plain.parts) player.inventory.deleteNumber(id);
    assert.equal(talk(), true);
    choose("I've lost my cannon.");
    for (let n = 0; n < 30 && player.getDialogueManager().isActive(); n++) player.getDialogueManager().advance();
    for (const id of Cannon.KINDS.plain.parts) assert.equal(player.inventory.getAmount(id), 1);
    assert.equal(player.getAttribute(Cannon.LOST_ATTRIBUTE), null, 'the genuine shared owner consumes its recovery fact');
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.AMMO_MOULD), 1, 'lost cannon recovery does not invoke quest mould recovery');
  } finally {
    cleanup();
    PluginManager.npcDialogueConditionHooks.length = conditionBefore;
    PluginManager.npcAnyInteractionHooks.length = interactionBefore;
    PluginManager.customEventHooks = customBefore;
  }
});
