// Fight Arena (q040) source-contract checks.
// From server/: node --test tests/qh728-q040.test.cjs (after yarn build).
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

const runtime = require('../plugins/quests/QuestRuntime');
const actualStartTranscript = runtime.startTranscript;
const transcripts = [];
const transcriptStub = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
runtime.startTranscript = transcriptStub;

const COINS = core.ItemIdentifiers.COINS;
const STACKABLE = new Set([COINS]);

function inventoryFixture(initial = new Map(), freeSlots = 28) {
  const items = new Map(initial);
  let free = freeSlots;
  const dropped = [];
  for (const id of items.keys()) if (!STACKABLE.has(id)) free--;
  return {
    items,
    dropped,
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => free <= 0,
    getFreeSlots: () => free,
    adds(id, amount = 1) {
      if (STACKABLE.has(id)) {
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
        if (items.delete(id) && !STACKABLE.has(id)) free++;
      } else {
        items.set(id, left);
      }
    },
    forceAdd(_player, item) {
      const id = item.getId();
      const amount = item.getAmount();
      if (STACKABLE.has(id) && items.has(id)) {
        items.set(id, items.get(id) + amount);
        return;
      }
      if (free > 0) {
        free--;
        items.set(id, (items.get(id) ?? 0) + amount);
        return;
      }
      dropped.push({ id, amount });
    },
  };
}

function playerFixture(inventory = inventoryFixture()) {
  const attributes = new Map();
  const messages = [];
  const configs = [];
  const varbits = [];
  const xp = [];
  const equipment = new Map();
  let dialogueManager = { startDialogues() {}, isActive: () => false, getCurrent: () => null, reset() {} };
  let location = new core.Location(2565, 3199, 0);
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === 'sendConfig') return (id, value) => { configs.push({ id, value }); return sender; };
    if (key === 'sendVarbit') return (id, value) => { varbits.push({ id, value }); return sender; };
    return () => sender;
  } });
  const player = {
    inventory,
    messages,
    configs,
    varbits,
    xp,
    equipment,
    getUsername: () => 'qh728-q040',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => (equipment.has(slot) ? { getId: () => equipment.get(slot) } : null) }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push({ skill: skill.getIndex?.() ?? skill, amount }) }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getDialogueManager: () => dialogueManager,
    setDialogueManager: (manager) => { dialogueManager = manager; },
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };
  return player;
}

function registerQuestPlugin(name = 'FightArena', pluginName = 'FightArenaTest', questKey = 'fight_arena', options = {}) {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
    object: PluginManager.objectInteractionHooks.length,
    objectNames: new Map([...PluginManager.objectHooksByName].map(([name, hooks]) => [name, hooks.length])),
    itemOnObject: PluginManager.itemOnObjectHooks.length,
    death: PluginManager.npcDeathHooks.length,
    login: PluginManager.loginHooks.length,
  };
  const customEvents = new Set();
  const spawned = [];
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'persistAttribute') return () => {};
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    if (key === 'onNpcInteraction') return (handler) => {
      if (typeof handler === 'function') PluginManager.npcInteractionHooks.push({ pluginName, handler });
    };
    if (key === 'onObjectInteraction') return (handler, actions) => {
      if (typeof handler === 'function') {
        PluginManager.objectInteractionHooks.push({ pluginName, order: ++PluginManager.nextObjectHookOrder, handler });
        return;
      }
      registerNamedObjectHook(pluginName, handler, actions);
    };
    if (key === 'onItemOnObject') return (handler) => PluginManager.itemOnObjectHooks.push({ pluginName, handler });
    if (key === 'onNpcDeath') return (handler) => PluginManager.npcDeathHooks.push({ pluginName, handler: (event) => {
      if (!event?.killer || !event?.npc) return;
      handler(event);
    } });
    if (key === 'onPlayerLogin') return (handler) => PluginManager.loginHooks.push({ pluginName, handler });
    if (key === 'onPlayerLogout') return () => {};
    if (key === 'onCustomEvent') return (eventName, handler) => {
      customEvents.add(eventName);
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    if (key === 'spawnNpc') return (def) => {
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, isRegistered: () => true, moveTo() {} };
      spawned.push(npc);
      return npc;
    };
    if (key === 'removeNpc') return () => {};
    return () => {};
  } });
  if (options.realTranscript) runtime.startTranscript = actualStartTranscript;
  try {
    require(`../plugins/quests/quests/${name}.Quest`)(api);
  } finally {
    runtime.startTranscript = transcriptStub;
  }
  return {
    api,
    spawned,
    quest: getRegisteredQuests().findLast((entry) => entry.key === questKey),
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcInteractionHooks.length = before.interaction;
      PluginManager.objectInteractionHooks.length = before.object;
      for (const [name, length] of before.objectNames) {
        const hooks = PluginManager.objectHooksByName.get(name) ?? [];
        hooks.length = length;
      }
      PluginManager.itemOnObjectHooks.length = before.itemOnObject;
      PluginManager.npcDeathHooks.length = before.death;
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

// The real PluginManager registers name-based object hooks through this shape.
function registerNamedObjectHook(pluginName, objectName, actions) {
  const named = new Map(Object.entries(actions ?? {}).filter(([, action]) => typeof action === 'function'));
  const hooks = PluginManager.objectHooksByName.get(objectName) ?? [];
  hooks.push({
    pluginName,
    order: ++PluginManager.nextObjectHookOrder,
    handler: (event) => {
      if (!Number.isInteger(event.clickType) || event.clickType < 1 || event.clickType > 5) return;
      const action = named.get(event.definition?.getInteractions?.()[event.clickType - 1]);
      if (action && action(event) !== false) event.handled = true;
    },
  });
  PluginManager.objectHooksByName.set(objectName, hooks);
}

/**
 * A stand-in for objects/Doors.plugin.js: it owns the named "Door" Open hook,
 * asks plugins through the shared door:toggle event and only opens the door
 * when no plugin claimed the request. Registering it before the quest
 * reproduces the shadowing the shared Doors handling has over a quest's own
 * object-interaction hook.
 */
function registerSharedDoorsStub() {
  const opened = [];
  const sharedDoorsToggle = (event) => {
    const request = {
      player: event.player,
      object: event.object,
      objectId: event.objectId,
      definition: event.definition,
      location: event.location,
      clickType: event.clickType,
      handled: false,
    };
    PluginManager.emitCustomEvent('door:toggle', request);
    if (request.handled) return true;
    opened.push(event.objectId);
    return true;
  };
  registerNamedObjectHook('DoorsStub', 'Door', {
    Open: sharedDoorsToggle,
    Close: sharedDoorsToggle,
    Release: sharedDoorsToggle,
  });
  return {
    opened,
    cleanup() {
      const hooks = PluginManager.objectHooksByName.get('Door') ?? [];
      const index = hooks.findIndex((hook) => hook.pluginName === 'DoorsStub');
      if (index >= 0) hooks.splice(index, 1);
    },
  };
}

function clickObject(player, objectId, option = 'Open', location = { x: 2606, y: 3152, z: 0 }) {
  return PluginManager.emitObjectInteraction({
    player,
    object: { getId: () => objectId, getLocation: () => location },
    objectId,
    definition: { getName: () => 'Door', getInteractions: () => [option] },
    clickType: 1,
    location,
    handled: false,
  });
}

// The generated transcript is the runner's source: a variant is only a valid
// step if the action it must fire really is in it.
const fightArenaTranscript = require('../data/definitions/npc-dialogues.json')['Fight Arena'].variants;

function transcriptStepIds(variant) {
  const ids = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string') ids.add(node.id);
    for (const value of Object.values(node)) walk(value);
  };
  walk(fightArenaTranscript[variant]);
  return ids;
}

const N = () => core.NpcIdentifiers;
const I = () => core.ItemIdentifiers;

function talkVariant(player, npcId) {
  return PluginManager.emitNpcDialogueVariant({ player, npcId });
}

function dialogueAction(player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
}

function dialogueMessage(player, npcId, stepId) {
  const event = { player, npcId, stepId, kind: 'message', handled: false };
  PluginManager.emitCustomEvent('npc-dialogue:action', event);
  return event;
}

function startQuestHook(player, npcId) {
  PluginManager.emitCustomEvent('npc-dialogue:hook', {
    player, npcId, hook: 'quest:fight-arena:start',
  });
}

function searchChest(player) {
  return PluginManager.emitObjectInteraction({
    player,
    objectId: core.ObjectIdentifiers.CHEST,
    object: { getId: () => core.ObjectIdentifiers.CHEST },
    definition: { getName: () => 'Chest', getInteractions: () => ['Search'] },
    clickType: 1,
    handled: false,
  });
}

function barmanTalk(player) {
  return PluginManager.emitNpcInteraction({
    player,
    npc: { getId: () => N().KHAZARD_BARMAN },
    npcId: N().KHAZARD_BARMAN,
    definition: { getName: () => 'Khazard barman', getActions: () => ['Talk-to'] },
    clickType: 1,
    handled: false,
  });
}

function kill(player, npcId) {
  PluginManager.emitNpcDeath({
    player, killer: player, npc: { getId: () => npcId, getDefinition: () => ({ getName: () => 'npc' }) }, npcId, handled: false,
  });
}

function doorToggle(player, objectId, option = 'Open') {
  const event = {
    player,
    objectId,
    object: { getId: () => objectId },
    definition: { getName: () => 'Door', getInteractions: () => [option] },
    location: new core.Location(2606, 3152, 0),
    clickType: 1,
    handled: false,
  };
  PluginManager.emitCustomEvent('door:toggle', event);
  return event;
}

function useKeysOnDoor(player, objectId) {
  return PluginManager.emitItemOnObject({
    player,
    objectId,
    object: { getId: () => objectId },
    itemId: I().KHAZARD_CELL_KEYS,
    item: { getId: () => I().KHAZARD_CELL_KEYS },
    handled: false,
  });
}

test('WALKTHROUGH: Fight Arena runs fresh stage 0 to the cache completion threshold', () => {
  // Fixture start: fresh stage 0, 5 coins, no other items. Every stage is moved
  // by the real registered handler/dispatch below; transcript playback itself is
  // shared NpcDialogues code and is intercepted by the module-level recorder.
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const inventory = inventoryFixture(new Map([[COINS, 5]]));
    const player = playerFixture(inventory);
    assert.equal(quest.getStage(player), 0);
    assert.equal(talkVariant(player, N().LADY_SERVIL), 'getting-started-talking-to-lady-servil');

    startQuestHook(player, N().LADY_SERVIL);
    assert.equal(quest.getStage(player), 1, 'the start choice hook starts Fight Arena');
    assert.equal(talkVariant(player, N().LADY_SERVIL), 'getting-started-talking-to-lady-servil-after-starting-the-quest');

    assert.equal(searchChest(player), true, 'the armour chest interaction is handled');
    assert.equal(inventory.getAmount(I().KHAZARD_HELMET), 1);
    assert.equal(inventory.getAmount(I().KHAZARD_ARMOUR), 1);
    assert.equal(quest.getStage(player), 2);

    player.equipment.set(core.Equipment.HEAD_SLOT, I().KHAZARD_HELMET);
    player.equipment.set(core.Equipment.BODY_SLOT, I().KHAZARD_ARMOUR);
    assert.equal(
      talkVariant(player, N().HEAD_GUARD),
      'entering-the-arena-talking-to-the-head-guard-with-khazard-armour-equipped'
    );
    assert.equal(quest.getStage(player), 3, 'the Head Guard mentions the Khali brew');

    transcripts.length = 0;
    assert.equal(barmanTalk(player), true, 'Fight Arena takes the barman at its brew leg');
    assert.deepEqual(transcripts.at(-1), {
      npcId: N().KHAZARD_BARMAN,
      page: 'Fight Arena',
      variant: 'getting-the-keys-talking-to-khazard-barman-after-learning-about-the-khali-brew',
    });
    dialogueMessage(player, N().KHAZARD_BARMAN, 'Dg8YuY');
    assert.equal(inventory.getAmount(COINS), 0, 'five coins are spent');
    assert.equal(inventory.getAmount(I().KHALI_BREW), 1);

    assert.equal(
      talkVariant(player, N().HEAD_GUARD),
      'getting-the-keys-talking-to-the-head-guard-while-holding-khali-brew'
    );
    dialogueMessage(player, N().HEAD_GUARD, 'tRXEfT');
    assert.equal(inventory.getAmount(I().KHALI_BREW), 0);
    assert.equal(inventory.getAmount(I().KHAZARD_CELL_KEYS), 1);
    assert.equal(quest.getStage(player), 5);
    dialogueMessage(player, N().HEAD_GUARD, 'rUfSrN');
    assert.equal(inventory.getAmount(I().KHAZARD_CELL_KEYS), 1, 'the second key message does not duplicate keys');

    assert.equal(useKeysOnDoor(player, core.ObjectIdentifiers.PRISON_GATE_4), true);
    assert.equal(quest.getStage(player), 6, 'keys on Sammy\'s door start the ogre fight');
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_OGRE), 'the ogre is spawned');
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2603, 3156]);

    kill(player, N().KHAZARD_OGRE);
    assert.equal(quest.getStage(player), 8);
    assert.equal(talkVariant(player, N().GENERAL_KHAZARD_5), 'the-battles-upon-killing-the-khazard-ogre');

    dialogueAction(player, N().GENERAL_KHAZARD_5, 'ND1rhG');
    assert.equal(quest.getStage(player), 9);
    assert.deepEqual(
      [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
      [2599, 3143, 0],
      'the jail teleport lands inside Hengrad\'s cell, not on the wall tile'
    );
    assert.equal(talkVariant(player, N().HENGRAD), 'the-battles-talking-to-hengrad-in-the-jail-cell');

    dialogueAction(player, N().HENGRAD, 'XDkdB3');
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2603, 3156]);
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_SCORPION), 'the scorpion is spawned');

    kill(player, N().KHAZARD_SCORPION);
    assert.equal(quest.getStage(player), 10);
    assert.ok(spawned.some((npc) => npc.def.id === N().BOUNCER), 'Bouncer is spawned after the scorpion');

    kill(player, N().BOUNCER);
    assert.equal(quest.getStage(player), 11);
    assert.equal(
      talkVariant(player, N().LADY_SERVIL),
      'the-battles-talking-to-lady-servil-after-khazard-attacks',
      'Quest Helper lets the player leave after Bouncer without killing Khazard'
    );

    const xpBefore = player.xp.length;
    dialogueAction(player, N().LADY_SERVIL, 'VZ72SC');
    assert.equal(quest.getStage(player), 14, 'the plugin completes on the cache threshold value');
    assert.equal(quest.isComplete(player), true);
    assert.equal(inventory.getAmount(COINS), 1000, 'the full coin reward is paid');
    const varp17 = player.configs.filter((entry) => entry.id === 17);
    assert.equal(varp17.at(-1).value, 14);
    assert.deepEqual(player.xp.slice(xpBefore).map((entry) => entry.amount), [12175, 2175]);

    const coinsAfter = inventory.getAmount(COINS);
    const xpAfter = player.xp.length;
    dialogueAction(player, N().LADY_SERVIL, 'VZ72SC');
    assert.equal(inventory.getAmount(COINS), coinsAfter, 'replaying completion cannot pay twice');
    assert.equal(player.xp.length, xpAfter, 'replaying completion cannot grant XP twice');

    assert.deepEqual(talkVariant(player, N().LADY_SERVIL), {
      page: 'Lady Servil',
      variant: 'standard-dialogue-after-fight-arena',
    }, 'post-quest uses the named NPC page, not the quest completion branch');

    runtime.sendQuestVarps({ player });
    assert.equal(
      player.configs.filter((entry) => entry.id === 17).at(-1).value,
      14,
      'login replay re-sends the saved completion value'
    );
  } finally {
    cleanup();
  }
});

test('the defeat-Khazard branch completes above the cache threshold', () => {
  // Fixture start: stage 13 (Khazard defeated) with the fight already over.
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture(inventoryFixture(new Map([[COINS, 1]])));
    quest.setStage(player, 13);
    assert.equal(talkVariant(player, N().LADY_SERVIL), 'the-battles-talking-to-lady-servil-after-defeating-khazard');
    dialogueAction(player, N().LADY_SERVIL, 'aAxtbU');
    assert.equal(quest.getStage(player), 15);
    assert.equal(quest.isComplete(player), true);
    assert.ok(player.configs.some((entry) => entry.id === 17 && entry.value === 15));
    assert.equal(player.inventory.getAmount(COINS), 1001);
  } finally {
    cleanup();
  }
});

test('a relog mid-fight restores the required arena beast', () => {
  // Fixture start: saved stages only; the owner-only beast is gone after logout.
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();

    quest.setStage(player, 6);
    PluginManager.emitPlayerLogin({ player });
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_OGRE), 'stage 6 relog respawns the ogre');

    spawned.length = 0;
    quest.setStage(player, 8);
    PluginManager.emitPlayerLogin({ player });
    assert.equal(spawned.length, 0, 'stage 8 needs no beast');

    spawned.length = 0;
    quest.setStage(player, 9);
    PluginManager.emitPlayerLogin({ player });
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_SCORPION),
      'stage 9 relog restores the scorpion for a player who already left Hengrad\'s cell');

    spawned.length = 0;
    quest.setStage(player, 10);
    PluginManager.emitPlayerLogin({ player });
    assert.ok(spawned.some((npc) => npc.def.id === N().BOUNCER), 'stage 10 relog respawns Bouncer');
  } finally {
    cleanup();
  }
});

test('the door guard\'s jail-return branch still reaches Hengrad and the scorpion', () => {
  // Fixture start: stage 8 (ogre defeated). Talking to the arena door guard is
  // a natural alternative to General Khazard's jail teleport.
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 8);
    assert.equal(
      talkVariant(player, N().DOOR_GUARD),
      'the-battles-talking-to-a-spectator-after-defeating-the-ogre-talking-to-a-door-guard'
    );
    dialogueAction(player, N().DOOR_GUARD, 'CDVO1E');
    assert.equal(quest.getStage(player), 9, 'the jail return enters the Hengrad leg');
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2599, 3143]);
    assert.equal(
      talkVariant(player, N().HENGRAD),
      'the-battles-talking-to-hengrad-in-the-jail-cell'
    );
    dialogueAction(player, N().HENGRAD, 'XDkdB3');
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_SCORPION));
  } finally {
    cleanup();
  }
});

test('registered stage-8 General Khazard transcript sends the player to Hengrad', () => {
  const { api, quest, cleanup } = registerQuestPlugin('FightArena', 'FightArenaRunnerTest', 'fight_arena', { realTranscript: true });
  try {
    const variant = 'the-battles-upon-killing-the-khazard-ogre';
    assert.equal(talkVariant(playerFixture(), N().GENERAL_KHAZARD), null,
      'an unstarted quest has no post-ogre General dialogue');
    for (const [page, actionId] of [
      ['Fight Arena', 'ND1rhG'],
      ['Fight Arena/Historical', 'l2eYgD'],
    ]) {
      const player = playerFixture();
      quest.setStage(player, 8);
      assert.equal(talkVariant(player, N().GENERAL_KHAZARD), variant);
      const transcript = require('../data/definitions/npc-dialogues.json')[page].variants[variant];
      assert.ok(transcript.some((step) => step.type === 'action' && step.id === actionId),
        `${page} keeps its imported prison action ${actionId}`);

      const manager = new DialogueManager(player);
      player.setDialogueManager(manager);
      assert.equal(actualStartTranscript(api, player, N().GENERAL_KHAZARD, page, variant), true);
      for (let step = 0; step < 30 && quest.getStage(player) < 9; step++) manager.advance();

      assert.equal(quest.getStage(player), 9, `${page} action persists the jail leg`);
      assert.deepEqual(
        [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
        [2599, 3143, 0],
        `${page} sends the player to Hengrad in the jail cell`
      );
      quest.setStage(player, 0);
    }

    for (const stage of [7, 10]) {
      const player = playerFixture();
      quest.setStage(player, stage);
      const before = player.getLocation();
      const action = dialogueAction(player, N().GENERAL_KHAZARD, 'l2eYgD');
      assert.equal(action.handled, true, `stage ${stage} consumes a stale historical action`);
      assert.equal(quest.getStage(player), stage);
      assert.equal(player.getLocation(), before, `stage ${stage} does not replay the jail teleport`);
    }
  } finally {
    cleanup();
  }
});

test('the arena door is locked before the fight and open afterwards', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 5);
    const locked = doorToggle(player, core.ObjectIdentifiers.DOOR_9);
    assert.equal(locked.handled, true, 'Fight Arena claims the arena door before stage 6');
    assert.ok(player.messages.includes('The door is securely locked.'));

    quest.setStage(player, 6);
    const open = doorToggle(player, core.ObjectIdentifiers.DOOR_9);
    assert.equal(open.handled, false, 'after stage 6 the core Doors handler may open it');

    const unrelated = doorToggle(player, core.ObjectIdentifiers.DOOR_8);
    assert.equal(unrelated.handled, false, 'another Door id is not claimed');
    const wrongOption = doorToggle(player, core.ObjectIdentifiers.DOOR_9, 'Close');
    assert.equal(wrongOption.handled, false, 'only Open is gated');
  } finally {
    cleanup();
  }
});

test('the door-guard jail return is only offered for the stage-8/9 jail leg', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 8);
    assert.equal(
      talkVariant(player, N().DOOR_GUARD),
      'the-battles-talking-to-a-spectator-after-defeating-the-ogre-talking-to-a-door-guard'
    );

    for (const stage of [10, 11]) {
      quest.setStage(player, stage);
      assert.equal(talkVariant(player, N().DOOR_GUARD), null,
        `stage ${stage} falls back to the Door Guard page instead of the jail return`);
      const before = player.getLocation();
      dialogueAction(player, N().DOOR_GUARD, 'CDVO1E');
      assert.equal(quest.getStage(player), stage, `stage ${stage} does not advance on a stale CDVO1E`);
      assert.equal(player.getLocation(), before, `stage ${stage} is not teleported by a stale CDVO1E`);
    }
  } finally {
    cleanup();
  }
});

test('Secrets of the North keeps the barman and its General Khazard forms', () => {
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 3);
    player.setAttribute('quest.secrets_of_the_north.stage', 3);

    transcripts.length = 0;
    assert.equal(barmanTalk(player), false, 'Fight Arena yields the barman during the SOTN 3-5 window');
    assert.equal(transcripts.length, 0);

    player.setAttribute('quest.secrets_of_the_north.stage', 6);
    assert.equal(barmanTalk(player), true, 'Fight Arena takes the barman outside the SOTN window');

    assert.equal(
      talkVariant(player, N().GENERAL_KHAZARD_7),
      null,
      'SOTN\'s General Khazard form is not owned by Fight Arena'
    );
    quest.setStage(player, 8);
    assert.equal(talkVariant(player, N().GENERAL_KHAZARD_5), 'the-battles-upon-killing-the-khazard-ogre');

    quest.setStage(player, 12);
    kill(player, N().GENERAL_KHAZARD_7);
    assert.equal(quest.getStage(player), 12, 'killing SOTN\'s Khazard cannot advance Fight Arena');
    kill(player, N().GENERAL_KHAZARD);
    assert.equal(quest.getStage(player), 13, 'the arena fight form still advances the quest');
  } finally {
    cleanup();
  }
});

test('searching the chest with the set already held still leaves the armour leg', () => {
  // Fixture start: stage 1 with both pieces (for example from a previous save or
  // another source) and a full-ish inventory.
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const inventory = inventoryFixture(new Map([
      [I().KHAZARD_HELMET, 1],
      [I().KHAZARD_ARMOUR, 1],
    ]));
    const player = playerFixture(inventory);
    quest.setStage(player, 1);
    assert.equal(searchChest(player), true);
    assert.equal(quest.getStage(player), 2, 'holding the set cannot soft-lock the brew leg');

    assert.equal(
      PluginManager.emitNpcDialogueCondition({
        player, npcId: N().KHAZARD_GUARD, text: 'With the Khazard armour equipped:',
      }),
      false
    );
    player.equipment.set(core.Equipment.HEAD_SLOT, I().KHAZARD_HELMET);
    player.equipment.set(core.Equipment.BODY_SLOT, I().KHAZARD_ARMOUR);
    assert.equal(
      PluginManager.emitNpcDialogueCondition({
        player, npcId: N().KHAZARD_GUARD, text: 'With the Khazard armour equipped:',
      }),
      true
    );
    assert.equal(
      PluginManager.emitNpcDialogueCondition({
        player, npcId: N().KHAZARD_BARMAN, text: "If the player doesn't have 5 coins:",
      }),
      true,
      'a player with no coins sees the no-coins branch'
    );
  } finally {
    cleanup();
  }
});

test('a full bag at completion still receives the whole 1,000 coins', () => {
  // Fixture start: stage 11 and a full inventory with no coin stack.
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const items = new Map();
    for (let id = 1000; id < 1028; id++) items.set(id, 1);
    const inventory = inventoryFixture(items, 0);
    const player = playerFixture(inventory);
    quest.setStage(player, 11);
    dialogueAction(player, N().LADY_SERVIL, 'VZ72SC');
    assert.deepEqual(inventory.dropped, [{ id: COINS, amount: 1000 }],
      'the whole stack is dropped rather than silently losing 999 coins');
    assert.equal(quest.isComplete(player), true);
  } finally {
    cleanup();
  }
});

test('stage 11 plays the canonical post-Bouncer Khazard line and advances to stage 12', () => {
  // Fixture start: stage 11 (Bouncer dead). The Khazard attack (ZGx6Rg) is the
  // only step that sets stage 12, so the post-Bouncer conversation has to be
  // the one offered here.
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 11);

    const variant = talkVariant(player, N().GENERAL_KHAZARD_5);
    assert.equal(variant, 'the-battles-upon-killing-bouncer',
      'stage 11 offers the post-Bouncer conversation');
    assert.ok(transcriptStepIds(variant).has('ZGx6Rg'),
      'that conversation really carries the Khazard attack');

    dialogueAction(player, N().GENERAL_KHAZARD_5, 'ZGx6Rg');
    assert.equal(quest.getStage(player), 12, 'the Khazard attack sets stage 12');
    assert.ok(spawned.some((npc) => npc.def.id === N().GENERAL_KHAZARD),
      'the attacking Khazard is spawned');

    assert.equal(talkVariant(player, N().GENERAL_KHAZARD_5), 'the-battles-upon-killing-bouncer',
      'the stage-12 branch is retained');
    kill(player, N().GENERAL_KHAZARD);
    assert.equal(quest.getStage(player), 13, 'the Khazard fight form advances to stage 13');
    assert.equal(talkVariant(player, N().GENERAL_KHAZARD_5), 'the-battles-upon-defeating-general-khazard');

    // Negative: the earlier conversations cannot advance to stage 12.
    quest.setStage(player, 10);
    const scorpionVariant = talkVariant(player, N().GENERAL_KHAZARD_5);
    assert.equal(scorpionVariant, 'the-battles-upon-killing-the-scorpion');
    assert.ok(!transcriptStepIds(scorpionVariant).has('ZGx6Rg'),
      'the post-scorpion conversation has no Khazard attack');
  } finally {
    cleanup();
  }
});

test('registered dispatch: the arena door lock survives the shared Doors handling', () => {
  // The shared Doors plugin owns the named "Door" Open hook and asks plugins
  // through door:toggle before it opens anything. It is registered first here,
  // so a quest that claimed the click with its own object hook would be
  // shadowed and the door would open.
  const doors = registerSharedDoorsStub();
  const { quest, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 5);

    const locked = clickObject(player, core.ObjectIdentifiers.DOOR_9);
    assert.equal(locked, true, 'the arena door click is handled');
    assert.ok(player.messages.includes('The door is securely locked.'));
    assert.deepEqual(doors.opened, [], 'the shared Doors handling did not open the locked door');

    // Negative: another door, the same id on another tile and another option
    // are all left to the shared handling.
    const other = playerFixture();
    quest.setStage(other, 5);
    clickObject(other, core.ObjectIdentifiers.DOOR_8, 'Open', { x: 2585, y: 3141, z: 0 });
    clickObject(other, core.ObjectIdentifiers.DOOR_9, 'Open', { x: 2600, y: 3200, z: 0 });
    clickObject(other, core.ObjectIdentifiers.DOOR_9, 'Close');
    assert.ok(!other.messages.includes('The door is securely locked.'),
      'unrelated doors, tiles and options are not claimed');
    assert.deepEqual(doors.opened, [
      core.ObjectIdentifiers.DOOR_8,
      core.ObjectIdentifiers.DOOR_9,
      core.ObjectIdentifiers.DOOR_9,
    ], 'the shared handling keeps every unrelated door');

    quest.setStage(player, 6);
    const open = clickObject(player, core.ObjectIdentifiers.DOOR_9);
    assert.equal(open, true);
    assert.deepEqual(doors.opened.at(-1), core.ObjectIdentifiers.DOOR_9,
      'after stage 6 the shared Doors handling opens the arena door');
    assert.equal(player.messages.filter((message) => message === 'The door is securely locked.').length, 1,
      'the unlocked door is not reported as locked');
  } finally {
    cleanup();
    doors.cleanup();
  }
});

test('the door-guard jail return persists the jail leg and lands in Hengrad\'s cell', () => {
  // Fixture start: stage 8 (ogre defeated). The door guard's own transcript
  // is the natural alternative to General Khazard's jail teleport.
  const { quest, spawned, cleanup } = registerQuestPlugin();
  try {
    const player = playerFixture();
    quest.setStage(player, 8);

    const variant = talkVariant(player, N().DOOR_GUARD);
    assert.equal(variant, 'the-battles-talking-to-a-spectator-after-defeating-the-ogre-talking-to-a-door-guard');
    assert.ok(transcriptStepIds(variant).has('CDVO1E'),
      'the door-guard transcript really carries the return-to-jail action');

    dialogueAction(player, N().DOOR_GUARD, 'CDVO1E');
    assert.equal(quest.getStage(player), 9, 'the jail leg is persisted once the return happened');
    assert.deepEqual(
      [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()],
      [2599, 3143, 0],
      'the player lands in Hengrad\'s cell, not on the blocked wall tile'
    );
    assert.equal(talkVariant(player, N().HENGRAD), 'the-battles-talking-to-hengrad-in-the-jail-cell');
    dialogueAction(player, N().HENGRAD, 'XDkdB3');
    assert.ok(spawned.some((npc) => npc.def.id === N().KHAZARD_SCORPION),
      'the route to the scorpion survives the jail return');
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2603, 3156]);
  } finally {
    cleanup();
  }
});
