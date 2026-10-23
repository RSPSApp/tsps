// Animal Magnetism (q001) source-contract checks.
// From server/: node --test tests/qh728-q001.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

const AM = 'Animal Magnetism';
const PAGE = AM;

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  return {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    // Mirrors ItemContainer.add: non-stackables need one slot each and a full
    // container keeps whatever fitted before reporting that it could not hold
    // the rest.
    adds(id, amount = 1) {
      if (id === core.ItemIdentifiers.ECTO_TOKEN) {
        items.set(id, (items.get(id) ?? 0) + amount);
        return;
      }
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
  };
}

function playerFixture(inventory = inventoryFixture(), ranged = 30) {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const interfaceDisplayStates = [];
  const xp = [];
  let interfaceId = -1;
  let manager;
  const sender = new Proxy({
    sendInterface(id) { interfaceId = id; return sender; },
    sendInterfaceDisplayState(id, hide) { interfaceDisplayStates.push({ id, hide }); return sender; },
    sendInterfaceRemoval() { interfaceId = -1; manager?.reset(); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    closeSubInterface() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  let location = new core.Location(2978, 3240, 0);
  // Contract fixture: this direction is assigned, not produced by walking.
  let facing = core.Direction.NORTH;
  const player = {
    inventory,
    messages,
    varbits,
    interfaceDisplayStates,
    xp,
    getUsername: () => 'qh728-q001',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => (slot === core.Equipment.AMULET_SLOT
        ? { getId: () => core.ItemIdentifiers.GHOSTSPEAK_AMULET }
        : null),
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === core.Skill.RANGED ? ranged : 99),
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    getFacingDirection: () => facing,
    setFacing: (direction) => { facing = direction; },
    getInterfaceId: () => interfaceId,
    setInterfaceId(id) { interfaceId = id; return player; },
    getDialogueManager: () => manager,
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };
  manager = new DialogueManager(player);
  return player;
}

// Registers a real quest plugin into the real PluginManager hooks; dispatch in the
// tests goes through PluginManager.emit*, not a copied selector.
function registerQuestPlugin(name, pluginName, questKey) {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    itemOnItem: PluginManager.itemOnItemHooks.length,
    itemOnNpc: PluginManager.itemOnNpcHooks.length,
    itemAction: PluginManager.itemActionHooks.length,
    canEquip: PluginManager.canEquipHooks.length,
    login: PluginManager.loginHooks.length,
    logout: PluginManager.logoutHooks.length,
    interfaceAction: PluginManager.interfaceActionClickHooks.length,
  };
  const customEvents = new Set();
  const spawned = [];
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    if (key === 'onNpcInteraction') return (names, actions) => {
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
    if (key === 'onCanEquip') return (handler) => PluginManager.canEquipHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogin') return (handler) => PluginManager.loginHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogout') return (handler) => PluginManager.logoutHooks.push({ pluginName, handler });
    if (key === 'onInterfaceActionButton') return (buttonIds, handler) => {
      const ids = new Set((Array.isArray(buttonIds) ? buttonIds : [buttonIds]).filter(Number.isInteger));
      PluginManager.interfaceActionClickHooks.push({ pluginName, handler: (event) => {
        if (event.handled || !ids.has(event.buttonId)) return;
        if (handler(event) !== false) event.handled = true;
      } });
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
    if (key === 'removeNpc') return () => {};
    if (key === 'getWorld') return () => ({ getNpcs: () => [] });
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
      PluginManager.itemActionHooks.length = before.itemAction;
      PluginManager.canEquipHooks.length = before.canEquip;
      PluginManager.loginHooks.length = before.login;
      PluginManager.logoutHooks.length = before.logout;
      PluginManager.interfaceActionClickHooks.length = before.interfaceAction;
      for (const eventName of customEvents) {
        const kept = (PluginManager.customEventHooks.get(eventName) ?? [])
          .filter((hook) => hook.pluginName !== pluginName);
        if (kept.length) PluginManager.customEventHooks.set(eventName, kept);
        else PluginManager.customEventHooks.delete(eventName);
      }
    },
  };
}

function line(player, npcId, text) {
  const event = { player, npcId, text, handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:line', event);
  return event;
}

test('a lost container can be rebuilt at stage 230 and handed back to Ava', () => {
  // Fixture starting state: stage 230 (container delivered / lost), no pattern and
  // no container; the player holds the other two container parts.
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    assert.ok(quest, 'Animal Magnetism registered');
    const player = playerFixture(inventoryFixture(new Map([
      [core.ItemIdentifiers.HARD_LEATHER, 1],
      [core.ItemIdentifiers.POLISHED_BUTTONS, 1],
    ])));
    quest.setStage(player, 230);

    const variant = PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.AVA });
    assert.equal(variant, 'the-final-component-handing-in-the-notes-talking-to-ava-having-lost-the-container-or-having-it-in-the-bank');
    line(player, core.NpcIdentifiers.AVA,
      "It's only the final, vital step in your quest that you decided to leave who-knows-where. Don't worry, I have plenty of spares.");
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.A_PATTERN), 1, 'Ava replaces the pattern');

    const worked = PluginManager.emitItemOnItem({
      player,
      usedItemId: core.ItemIdentifiers.A_PATTERN,
      usedWithItemId: core.ItemIdentifiers.HARD_LEATHER,
      handled: false,
    });
    assert.equal(worked, true, 'the combine handler runs at the recovery stage');
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.A_CONTAINER), 1, 'a new container is built');
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.A_PATTERN), 0);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.HARD_LEATHER), 0);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.POLISHED_BUTTONS), 0);

    assert.equal(
      PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.AVA }),
      'the-final-component-delivering-the-container'
    );
    line(player, core.NpcIdentifiers.AVA,
      'Wow, great, now the arrow manufacturer is ready for use...there you are! Talk to me if you need more information later.');
    assert.equal(quest.isComplete(player), true);
    assert.equal(player.inventory.getAmount(core.ItemIdentifiers.AVAS_ATTRACTOR), 1);
  } finally {
    cleanup();
  }
});

test('buying two undead chickens never keeps the ecto-tokens without the birds', () => {
  // Fixture starting state: stage 100, a full inventory whose only ecto-token
  // stack is the 20 tokens about to be spent.
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    const inventory = inventoryFixture(new Map([[core.ItemIdentifiers.ECTO_TOKEN, 20]]), 0);
    const player = playerFixture(inventory);
    quest.setStage(player, 100);

    const event = {
      player,
      npcId: core.NpcIdentifiers.MALCOLM,
      stepId: 'haQZnJ',
      action: 'receive',
      handled: false,
    };
    PluginManager.emitCustomEvent('npc-dialogue:action', event);

    const chickens = inventory.getAmount(core.ItemIdentifiers.UNDEAD_CHICKEN);
    const tokens = inventory.getAmount(core.ItemIdentifiers.ECTO_TOKEN);
    assert.ok(
      tokens === 20 && chickens === 0,
      `a full bag must not take payment for chickens it cannot deliver (tokens=${tokens}, chickens=${chickens})`
    );
  } finally {
    cleanup();
  }
});

test('Animal Magnetism stops owning the Old crone after its amulet leg', () => {
  const am = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  const ghosts = registerQuestPlugin('GhostsAhoy', 'GhostsAhoyTest', 'ghosts_ahoy');
  try {
    // Fixture starting state: Animal Magnetism stage 230, Ghosts Ahoy stage 3
    // (sent to the Old crone). Both quests are active; Ghosts Ahoy needs her.
    const player = playerFixture();
    am.quest.setStage(player, 230);
    ghosts.quest.setStage(player, 3);

    assert.equal(
      PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.OLD_CRONE }),
      'talking-to-the-old-crone',
      'Ghosts Ahoy keeps the crone once Animal Magnetism no longer needs her'
    );
  } finally {
    ghosts.cleanup();
    am.cleanup();
  }
});

test('Animal Magnetism runs every mandatory leg from a fresh stage 0 to completion', () => {
  // Fixture starting state: fresh stage 0, the three prerequisite quests are
  // answered complete by a fixture hook, all base skills are 99 except Ranged
  // 30, and the inventory holds only the ordinary quest supplies/parts.
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  const prereq = {
    pluginName: 'PrereqFixture',
    handler: (request) => {
      if (['the_restless_ghost', 'ernest_the_chicken', 'priest_in_peril'].includes(request.key)) {
        request.complete = true;
      }
    },
  };
  const prereqHooks = PluginManager.customEventHooks.get('quest:is-complete') ?? [];
  prereqHooks.push(prereq);
  PluginManager.customEventHooks.set('quest:is-complete', prereqHooks);
  const originalRandom = Math.random;
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    const inventory = inventoryFixture(new Map([
      [I.ECTO_TOKEN, 20],
      [I.HAMMER, 1],
      [I.MITHRIL_AXE, 1],
      [I.HOLY_SYMBOL, 1],
      [I.IRON_BAR, 5],
      [I.HARD_LEATHER, 1],
      [I.POLISHED_BUTTONS, 1],
    ]));
    const player = playerFixture(inventory);
    const line = (npcId, text) => PluginManager.emitCustomEvent('npc-dialogue:line', { player, npcId, text, handled: false });
    const condition = (npcId, stepId) => PluginManager.emitCustomEvent('npc-dialogue:condition', { player, npcId, stepId, handled: false });
    const action = (npcId, stepId) => PluginManager.emitCustomEvent('npc-dialogue:action', { player, npcId, stepId, action: 'receive', handled: false });
    const choice = (npcId, option) => PluginManager.emitCustomEvent('npc-dialogue:choice', { player, npcId, option, handled: false });
    const variant = (npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId });
    const treeEvent = () => {
      const npc = { getId: () => N.UNDEAD_TREE, getContentId: () => N.UNDEAD_TREE };
      return {
        player,
        npc,
        npcId: N.UNDEAD_TREE,
        definition: { getName: () => 'Undead tree', getActions: () => ['Chop', null, null, null, null] },
        clickType: 1,
        handled: false,
      };
    };

    assert.equal(quest.getStage(player), 0);
    choice(N.AVA, 'I would be happy to make your home a better place.');
    assert.equal(quest.getStage(player), 10, 'Ava starts the quest');

    assert.equal(variant(N.MALCOLM), 'the-alive-undead-chickens-the-problem-a-matter-of-love-talking-to-malcolm');
    condition(N.MALCOLM, '11YShB');
    assert.equal(quest.getStage(player), 20, 'Malcolm tells his side with ghostspeak equipped');

    line(N.ALICE, 'I have a message from your husband. He wants you to know that he still loves you, despite his ghostly state.');
    line(N.MALCOLM, 'Your wife says she needs the family cash and wants to know what you did with it.');
    line(N.ALICE, 'Your husband says he put the cash in the bank.');
    line(N.MALCOLM, 'You may not believe me, but she wants me to find your bank pass now.');
    line(N.ALICE, 'What if I gave some sort of altered ghostspeak amulet to him - surely that would work?');
    assert.equal(quest.getStage(player), 70, 'the Alice/Malcolm loop reaches the Old crone');

    action(N.OLD_CRONE, '-6EpYR');
    assert.equal(quest.getStage(player), 73);
    assert.equal(variant(N.OLD_CRONE), 'the-alive-undead-chickens-obtaining-the-amulet-speaking-to-the-old-crone-again');
    line(N.OLD_CRONE, 'I most certainly am; there you go.');
    assert.equal(quest.getStage(player), 76);
    assert.equal(inventory.getAmount(I.CRONE_MADE_AMULET), 1);

    choice(N.MALCOLM, 'Okay, you need it more than I do, I suppose.');
    assert.equal(quest.getStage(player), 80);
    assert.equal(inventory.getAmount(I.CRONE_MADE_AMULET), 0);

    // The Malcolm cutscene is started by the real interaction hook; only the
    // stage effect is asserted here (the transcript playback itself is shared
    // NpcDialogues code).
    const cutscene = {
      player,
      npc: { getId: () => N.MALCOLM_2, getContentId: () => N.MALCOLM_2 },
      npcId: N.MALCOLM_2,
      definition: { getName: () => 'Malcolm', getActions: () => ['Talk-to', null, null, null, null] },
      clickType: 1,
      handled: false,
    };
    PluginManager.emitNpcInteraction(cutscene);
    assert.equal(quest.getStage(player), 90, 'the cutscene opens the chicken sale');

    action(N.MALCOLM, 'haQZnJ');
    assert.equal(quest.getStage(player), 100);
    assert.equal(inventory.getAmount(I.UNDEAD_CHICKEN), 2);
    assert.equal(inventory.getAmount(I.ECTO_TOKEN), 0);

    assert.equal(variant(N.AVA), 'magnetism-the-next-task');
    line(N.AVA, 'Here they are.');
    assert.equal(quest.getStage(player), 120, 'two chickens are handed to Ava');
    assert.equal(inventory.getAmount(I.UNDEAD_CHICKEN), 0);

    assert.equal(variant(N.WITCH_4), 'magnetism-helpful-witch');
    line(N.WITCH_4, "I'll be back.");
    assert.equal(quest.getStage(player), 130);
    assert.equal(variant(N.WITCH_4), 'magnetism-helpful-witch-talking-to-the-witch-again');
    line(N.WITCH_4, "Great, you'll go far! I made some nice painted metal toys for you, snookums.");
    assert.equal(quest.getStage(player), 140);
    assert.equal(inventory.getAmount(I.IRON_BAR), 0);
    assert.equal(inventory.getAmount(I.SELECTED_IRON), 1);

    PluginManager.emitItemOnItem({ player, usedItemId: I.HAMMER, usedWithItemId: I.SELECTED_IRON, handled: false });
    assert.equal(inventory.getAmount(I.SELECTED_IRON), 0);
    assert.equal(inventory.getAmount(I.BAR_MAGNET), 1);

    assert.equal(variant(N.AVA), 'the-bark-has-bite-handing-the-magnet-to-ava');
    line(N.AVA, "I've manufactured the magnet; here it is.");
    assert.equal(quest.getStage(player), 150);
    assert.equal(inventory.getAmount(I.BAR_MAGNET), 0);
    assert.equal(
      player.xp.filter((entry) => entry.skill === core.Skill.CRAFTING && entry.amount === 50).length,
      1,
      'Ava pays the magnet XP as she accepts it, before any later chat can be interrupted'
    );
    // The imported follow-up action is harmless if the transcript continues.
    action(N.AVA, 'G9W0YI');
    assert.equal(player.xp.filter((entry) => entry.skill === core.Skill.CRAFTING && entry.amount === 50).length, 1);

    PluginManager.emitNpcInteraction(treeEvent());
    assert.equal(quest.getStage(player), 160, 'the tree bounces a mithril axe');

    assert.equal(variant(N.TURAEL_4), 'the-bark-has-bite-a-slayer-s-perspective-turael');
    line(N.TURAEL_4, "Okay, so I'll see whether I can spare an axe and a symbol. Thanks.");
    assert.equal(quest.getStage(player), 170);
    condition(N.TURAEL_4, 'PTKy3J');
    assert.equal(quest.getStage(player), 180);
    assert.equal(inventory.getAmount(I.MITHRIL_AXE), 0);
    assert.equal(inventory.getAmount(I.HOLY_SYMBOL), 0);
    assert.equal(inventory.getAmount(I.BLESSED_AXE), 1);

    Math.random = () => 0; // the tree drop is a 50% roll
    PluginManager.emitNpcInteraction(treeEvent());
    assert.equal(quest.getStage(player), 180);
    assert.equal(inventory.getAmount(I.UNDEAD_TWIGS), 1);
    Math.random = originalRandom;

    line(N.AVA, 'I have that undead wood at last. Well, twigs anyway.');
    assert.equal(quest.getStage(player), 190);
    assert.equal(inventory.getAmount(I.UNDEAD_TWIGS), 0);

    line(N.AVA, "They are still stumping me. Here are the notes; I really hope your head doesn't explode from reading them.");
    assert.equal(quest.getStage(player), 200);
    assert.equal(inventory.getAmount(I.RESEARCH_NOTES), 1);

    // Research-notes switch puzzle: Translate opens cache interface 480.
    PluginManager.emitItemAction({ player, itemId: I.RESEARCH_NOTES, option: 'Translate', handled: false });
    assert.equal(player.getInterfaceId(), 480, 'Translate opens the cache notes puzzle');
    assert.equal(quest.getStage(player), 200, 'opening the puzzle does not translate anything');
    const clickNotes = (child) => PluginManager.emitInterfaceActionClick({
      player, buttonId: (480 << 16) | child, action: 1, handled: false,
    });
    // Switching off a wrong orb (2nd) must prevent the six correct ones solving.
    clickNotes(28);
    for (const child of [26, 31, 34, 40, 43, 46]) clickNotes(child);
    assert.equal(quest.getStage(player), 200, 'the 2nd orb must stay on');
    assert.equal(inventory.getAmount(I.TRANSLATED_NOTES), 0);
    clickNotes(28);
    assert.equal(quest.getStage(player), 210, 'six correct orbs translate the notes');
    assert.equal(player.varbits.get(3185), 210, 'the cache wire sees anma_main 210 after the puzzle');
    assert.equal(player.getInterfaceId(), -1, 'the puzzle closes on success');
    assert.equal(inventory.getAmount(I.RESEARCH_NOTES), 0);
    assert.equal(inventory.getAmount(I.TRANSLATED_NOTES), 1);

    line(N.AVA, "I've given you a pattern for the container; you'll need to combine them with some polished buttons and hard leather. Then we're almost done. Good news, eh?");
    assert.equal(quest.getStage(player), 220);
    assert.equal(inventory.getAmount(I.TRANSLATED_NOTES), 0);
    assert.equal(inventory.getAmount(I.A_PATTERN), 1);

    PluginManager.emitItemOnItem({ player, usedItemId: I.A_PATTERN, usedWithItemId: I.HARD_LEATHER, handled: false });
    assert.equal(quest.getStage(player), 230);
    assert.equal(inventory.getAmount(I.A_CONTAINER), 1);

    assert.equal(variant(N.AVA), 'the-final-component-delivering-the-container');
    line(N.AVA, 'Wow, great, now the arrow manufacturer is ready for use...there you are! Talk to me if you need more information later.');
    assert.equal(quest.getStage(player), 240);
    assert.equal(quest.isComplete(player), true);
    assert.equal(inventory.getAmount(I.AVAS_ATTRACTOR), 1, 'Ranged 30 receives the attractor');
    assert.equal(player.varbits.get(3185), 240, 'the cache wire sees anma_main 240 at completion');

    line(N.AVA, 'Wow, great, now the arrow manufacturer is ready for use...there you are! Talk to me if you need more information later.');
    assert.equal(inventory.getAmount(I.AVAS_ATTRACTOR), 1, 'the completion line cannot reward twice');
  } finally {
    Math.random = originalRandom;
    PluginManager.customEventHooks.set(
      'quest:is-complete',
      (PluginManager.customEventHooks.get('quest:is-complete') ?? []).filter((hook) => hook !== prereq)
    );
    cleanup();
  }
});


test('research notes puzzle handles wrong orbs, cancel, relog, missing notes and replay', () => {
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    const I = core.ItemIdentifiers;
    const openPuzzle = (player) => {
      const event = { player, itemId: I.RESEARCH_NOTES, option: 'Translate', handled: false };
      PluginManager.emitItemAction(event);
      return event;
    };
    const clickNotes = (player, child) => PluginManager.emitInterfaceActionClick({
      player, buttonId: (480 << 16) | child, action: 1, handled: false,
    });
    const newPlayer = () => {
      const player = playerFixture(inventoryFixture(new Map([[I.RESEARCH_NOTES, 1]])));
      quest.setStage(player, 200);
      return player;
    };

    // Wrong orb: the 2nd root must stay on for the six correct orbs to solve.
    const wrong = newPlayer();
    openPuzzle(wrong);
    assert.equal(wrong.getInterfaceId(), 480);
    const visibility = (player, child) => player.interfaceDisplayStates.findLast(
      (entry) => entry.id === ((480 << 16) | child)
    )?.hide;
    assert.equal(visibility(wrong, 26), false, 'cache Off variant starts visible');
    assert.equal(visibility(wrong, 50), true, 'cache On variant starts hidden');
    clickNotes(wrong, 28);
    assert.equal(visibility(wrong, 28), true, 'click hides the Off variant');
    assert.equal(visibility(wrong, 51), false, 'click shows the On variant');
    for (const child of [26, 31, 34, 40, 43, 46]) clickNotes(wrong, child);
    assert.equal(quest.getStage(wrong), 200, 'a wrong orb keeps the puzzle unsolved');
    clickNotes(wrong, 28);
    assert.equal(quest.getStage(wrong), 210);
    assert.equal(wrong.inventory.getAmount(I.TRANSLATED_NOTES), 1);

    // Cancel/reopen resets the toggles. Model-child ids hit the same roots.
    const reopened = newPlayer();
    openPuzzle(reopened);
    assert.equal(visibility(reopened, 26), false, 'reopen restores the cache default visible variant');
    assert.equal(visibility(reopened, 50), true, 'reopen hides the alternate variant again');
    clickNotes(reopened, 24); // model child of root 26
    assert.equal(quest.getStage(reopened), 200);
    clickNotes(reopened, 27); // model child of root 28 (wrong)
    PluginManager.emitCustomEvent('interface:closed', { player: reopened, interfaceId: 480 });
    reopened.setInterfaceId(-1);
    openPuzzle(reopened);
    for (const child of [30, 33, 39, 42, 45]) clickNotes(reopened, child); // roots 31/34/40/43/46
    assert.equal(quest.getStage(reopened), 200, 'reopening cleared the earlier 26 and 28 toggles');
    clickNotes(reopened, 24);
    assert.equal(quest.getStage(reopened), 210);

    // Relog clears an open puzzle's partial state.
    const relog = newPlayer();
    openPuzzle(relog);
    clickNotes(relog, 26);
    clickNotes(relog, 31);
    PluginManager.emitPlayerLogout({ player: relog });
    relog.setInterfaceId(-1);
    openPuzzle(relog);
    for (const child of [33, 39, 42, 45]) clickNotes(relog, child);
    assert.equal(quest.getStage(relog), 200, 'a relog cleared the two earlier toggles');
    clickNotes(relog, 26);
    clickNotes(relog, 31);
    assert.equal(quest.getStage(relog), 210);

    // Translate without the current notes does not open the puzzle.
    const noNotes = playerFixture();
    quest.setStage(noNotes, 200);
    openPuzzle(noNotes);
    assert.equal(noNotes.getInterfaceId(), -1, 'the puzzle needs the current research notes');

    // Replay: stage 210 cannot reopen or re-award translated notes.
    const replay = newPlayer();
    openPuzzle(replay);
    for (const child of [26, 31, 34, 40, 43, 46]) clickNotes(replay, child);
    assert.equal(quest.getStage(replay), 210);
    const translated = replay.inventory.getAmount(I.TRANSLATED_NOTES);
    openPuzzle(replay);
    assert.equal(replay.getInterfaceId(), -1, 'no puzzle reopen after translation');
    PluginManager.emitCustomEvent('npc-dialogue:action', {
      player: replay, npcId: core.NpcIdentifiers.AVA, stepId: 'Bi6_MY', kind: 'message', handled: false,
    });
    assert.equal(quest.getStage(replay), 210);
    assert.equal(replay.inventory.getAmount(I.TRANSLATED_NOTES), translated);
  } finally {
    cleanup();
  }
});

test('a While Guthix Sleeps player gets Aya for the blessed axe leg', () => {
  const { quest, spawned, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  const prereq = {
    pluginName: 'PrereqFixture',
    handler: (request) => {
      if (['the_restless_ghost', 'ernest_the_chicken', 'priest_in_peril', 'while_guthix_sleeps'].includes(request.key)) {
        request.complete = true;
      }
    },
  };
  const prereqHooks = PluginManager.customEventHooks.get('quest:is-complete') ?? [];
  prereqHooks.push(prereq);
  PluginManager.customEventHooks.set('quest:is-complete', prereqHooks);
  try {
    const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
    // Fixture starting state: the cache transform's first Aya state is WGS varbit 1.
    const inventory = inventoryFixture(new Map([
      [I.MITHRIL_AXE, 1],
      [I.HOLY_SYMBOL, 1],
    ]));
    const player = playerFixture(inventory);
    player.getPacketSender().sendVarbit(10782, 1);
    quest.setStage(player, 160);

    PluginManager.emitPlayerLogin({ player });
    assert.equal(spawned.length, 0, 'the cache-owned Slayer Master is not duplicated');

    assert.equal(
      PluginManager.emitNpcDialogueVariant({ player, npcId: N.AYA }),
      'the-bark-has-bite-a-slayer-s-perspective-aya'
    );
    PluginManager.emitCustomEvent('npc-dialogue:line', {
      player, npcId: N.AYA, handled: false,
      text: "Okay, so I'll see whether I can spare an axe and a symbol. Thanks.",
    });
    assert.equal(quest.getStage(player), 170);
    PluginManager.emitCustomEvent('npc-dialogue:condition', {
      player, npcId: N.AYA, stepId: 'PTKy3J', handled: false,
    });
    assert.equal(quest.getStage(player), 180);
    assert.equal(inventory.getAmount(I.BLESSED_AXE), 1);
    assert.equal(inventory.getAmount(I.MITHRIL_AXE), 0);
    assert.equal(inventory.getAmount(I.HOLY_SYMBOL), 0);

    const lineEvent = {
      player, npcId: N.AVA, handled: false,
      text: "Well, in that case, I think it may have something to do with Slayer abilities. After all, I did see [Turael/Aya] poking around the trees while I was moving in.",
    };
    PluginManager.emitCustomEvent('npc-dialogue:line', lineEvent);
    assert.match(lineEvent.text, /Aya/);
    assert.doesNotMatch(lineEvent.text, /Turael/);
  } finally {
    PluginManager.customEventHooks.set(
      'quest:is-complete',
      (PluginManager.customEventHooks.get('quest:is-complete') ?? []).filter((hook) => hook !== prereq)
    );
    cleanup();
  }
});

test('Slayer Master dialogue follows the cache transform and post-quest NPC defaults', () => {
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    const N = core.NpcIdentifiers;
    const player = playerFixture();
    const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
    for (const [value, expectedId] of [[0, N.TURAEL_4], [1, N.AYA], [2, N.AYA], [3, null]]) {
      player.getPacketSender().sendVarbit(10782, value);
      assert.equal(CacheDefinitions.resolveNpc(13651, player.getPacketSender())?.id ?? null, expectedId,
        `cache Slayer Master transform at varbit 10782=${value}`);
    }
    quest.setStage(player, 160);
    player.getPacketSender().sendVarbit(10782, 0);
    assert.equal(
      PluginManager.emitNpcDialogueVariant({ player, npcId: N.TURAEL_4 }),
      'the-bark-has-bite-a-slayer-s-perspective-turael'
    );
    player.getPacketSender().sendVarbit(10782, 1);
    assert.equal(
      PluginManager.emitNpcDialogueVariant({ player, npcId: N.AYA }),
      'the-bark-has-bite-a-slayer-s-perspective-aya'
    );

    quest.setStage(player, 150);
    assert.deepEqual(
      PluginManager.emitNpcDialogueVariant({ player, npcId: N.WITCH_4 }),
      { page: 'Witch', variant: 'standard-dialogue-after-the-completion-of-ernest-the-chicken' }
    );
    quest.setStage(player, 240);
    assert.equal(PluginManager.emitNpcDialogueVariant({ player, npcId: N.MALCOLM }), null);
    assert.deepEqual(
      PluginManager.emitNpcDialogueVariant({ player, npcId: N.WITCH_4 }),
      { page: 'Witch', variant: 'standard-dialogue-after-the-completion-of-animal-magnetism' }
    );
  } finally {
    cleanup();
  }
});

test('magnet combine requires the real player to face north', () => {
  const runtime = require('../plugins/quests/QuestRuntime');
  const originalStartTranscript = runtime.startTranscript;
  const transcripts = [];
  runtime.startTranscript = (api, player, npcId, page, variant) => {
    transcripts.push(variant);
    return true;
  };
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    const I = core.ItemIdentifiers;
    // Real Player supplies getFacingDirection/setDirection/getLocation; the
    // inventory and packet sender are contract fixtures because this test has
    // no live client session. setDirection is not a natural walk proof.
    const makePlayer = (direction) => {
      const items = inventoryFixture(new Map([
        [I.HAMMER, 1],
        [I.SELECTED_IRON, 1],
      ]));
      const player = new Player(null, new core.Location(2978, 3240, 0));
      player.isPlayerBot = () => true;
      player.getInventory = () => items;
      player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
      player.sendMessage = () => {};
      player.setDirection(direction);
      quest.setStage(player, 140);
      return { player, items };
    };
    const combine = (player) => PluginManager.emitItemOnItem({
      player,
      usedItemId: I.HAMMER,
      usedWithItemId: I.SELECTED_IRON,
      handled: false,
    });

    const south = makePlayer(core.Direction.SOUTH);
    assert.equal(combine(south.player), true, 'the handler owns the combine attempt');
    assert.equal(south.items.getAmount(I.SELECTED_IRON), 1, 'no iron is consumed facing south');
    assert.equal(south.items.getAmount(I.BAR_MAGNET), 0);
    assert.ok(transcripts.includes('magnetism-helpful-witch-using-hammer-on-selected-iron-without-facing-north'));

    transcripts.length = 0;
    const diagonal = makePlayer(core.Direction.NORTH_EAST);
    combine(diagonal.player);
    assert.equal(diagonal.items.getAmount(I.SELECTED_IRON), 1, 'a diagonal is not due north');
    assert.equal(diagonal.items.getAmount(I.BAR_MAGNET), 0);
    assert.ok(transcripts.includes('magnetism-helpful-witch-using-hammer-on-selected-iron-without-facing-north'));

    transcripts.length = 0;
    const north = makePlayer(core.Direction.NORTH);
    assert.equal(north.player.getFacingDirection(), core.Direction.NORTH);
    assert.equal(combine(north.player), true);
    assert.equal(north.items.getAmount(I.SELECTED_IRON), 0);
    assert.equal(north.items.getAmount(I.BAR_MAGNET), 1);
    assert.ok(transcripts.includes('magnetism-helpful-witch-using-hammer-on-selected-iron-as-intended'));
  } finally {
    runtime.startTranscript = originalStartTranscript;
    cleanup();
  }
});

test('Turael/Aya typed lines report the actual master name and id', () => {
  const { quest, cleanup } = registerQuestPlugin('AnimalMagnetism', 'AnimalMagnetismTest', 'animal_magnetism');
  try {
    const N = core.NpcIdentifiers;
    const againLine = (player, npcId) => ({
      player,
      npcId,
      step: { type: 'line', speaker: 'Turael/Aya' },
      text: "Hello, I'm here about those trees again.",
      handled: false,
    });
    const variant = (player, npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId });

    // Turael state: While Guthix Sleeps not complete.
    const turaelPlayer = playerFixture();
    quest.setStage(turaelPlayer, 170);
    const turaelEvent = againLine(turaelPlayer, N.TURAEL_4);
    PluginManager.emitCustomEvent('npc-dialogue:line', turaelEvent);
    assert.equal(turaelEvent.speakerName, 'Turael');
    assert.equal(turaelEvent.speakerId, N.TURAEL_4);
    const turaelAvaLine = {
      player: turaelPlayer, npcId: N.AVA, handled: false,
      text: 'I saw [Turael/Aya] there; [he\'s/she\'s] the Slayer Master with [his/her] earmuffs.',
    };
    PluginManager.emitCustomEvent('npc-dialogue:line', turaelAvaLine);
    assert.match(turaelAvaLine.text, /\bTurael\b/);
    assert.match(turaelAvaLine.text, /\bhe's\b/);
    assert.match(turaelAvaLine.text, /\bhis\b/);
    assert.doesNotMatch(turaelAvaLine.text, /\bAya\b|\bshe's\b|\bher\b/);
    assert.deepEqual(variant(turaelPlayer, N.TURAEL_4), {
      page: 'Animal Magnetism',
      variant: 'the-bark-has-bite-a-slayer-s-perspective-talking-to-turael-or-aya-again',
    });

    // Aya state: While Guthix Sleeps complete.
    const prereq = {
      pluginName: 'PrereqFixture',
      handler: (request) => {
        if (request.key === 'while_guthix_sleeps') request.complete = true;
      },
    };
    const hooks = PluginManager.customEventHooks.get('quest:is-complete') ?? [];
    hooks.push(prereq);
    PluginManager.customEventHooks.set('quest:is-complete', hooks);
    try {
      const ayaPlayer = playerFixture();
      ayaPlayer.getPacketSender().sendVarbit(10782, 1);
      quest.setStage(ayaPlayer, 170);
      const ayaEvent = againLine(ayaPlayer, N.AYA);
      PluginManager.emitCustomEvent('npc-dialogue:line', ayaEvent);
      assert.equal(ayaEvent.speakerName, 'Aya');
      assert.equal(ayaEvent.speakerId, N.AYA);
      const ayaAvaLine = {
        player: ayaPlayer, npcId: N.AVA, handled: false,
        text: 'I saw [Turael/Aya] there; [he\'s/she\'s] the Slayer Master with [his/her] earmuffs.',
      };
      PluginManager.emitCustomEvent('npc-dialogue:line', ayaAvaLine);
      assert.match(ayaAvaLine.text, /\bAya\b/);
      assert.match(ayaAvaLine.text, /\bshe's\b/);
      assert.match(ayaAvaLine.text, /\bher\b/);
      assert.doesNotMatch(ayaAvaLine.text, /\bTurael\b|\bhe's\b|\bhis\b/);
      assert.deepEqual(variant(ayaPlayer, N.AYA), {
        page: 'Animal Magnetism',
        variant: 'the-bark-has-bite-a-slayer-s-perspective-talking-to-turael-or-aya-again',
      });
    } finally {
      PluginManager.customEventHooks.set(
        'quest:is-complete',
        (PluginManager.customEventHooks.get('quest:is-complete') ?? []).filter((hook) => hook !== prereq)
      );
    }
  } finally {
    cleanup();
  }
});
