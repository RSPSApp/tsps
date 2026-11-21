// Tower of Life against the user's revision 242.1 RSProx capture (TowerOfLife.bin; facts and ticks in
// docs/quests/tower-of-life/README.md). From server/: node --test tests/tower-of-life-capture.test.cjs
//
// The plugin is registered through the real PluginManager hooks; stages and inventory are set directly,
// and the puzzle tests replay the capture's own button presses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const FLAGS = 'quest.tower_of_life.flags';
const SCARED = 1 << 6;
const STAGE_VARBIT = 3337;
const dialogueData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
const towerVariants = dialogueData['Tower of Life'].variants;
const normalizeText = (text) => String(text).replace(/\s+/g, ' ').trim();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});
const transcriptCalls = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcriptCalls.push({ npcId, page, variant });
  return true;
};

const TEST_PLUGIN = 'TowerOfLifeCaptureTest';
const MIND_BAR_GROUP = 508;
const OVERLAY_HUD_UID = (161 << 16) | 8;

// Register through the real PluginManager hooks so every assertion below goes through
// the same dispatch path as the server. The previous test's hooks are removed first.
function clearTestHooks() {
  for (const name of [
    'npcDialogueVariantHooks', 'npcDialogueConditionHooks', 'npcInteractionHooks',
    'itemOnNpcHooks', 'loginHooks', 'interfaceActionClickHooks',
  ]) {
    const hooks = PluginManager[name];
    if (!Array.isArray(hooks)) continue;
    for (let index = hooks.length - 1; index >= 0; index--) {
      if (hooks[index]?.pluginName === TEST_PLUGIN) hooks.splice(index, 1);
    }
  }
  for (const [name, hooks] of PluginManager.customEventHooks) {
    const kept = hooks.filter((hook) => hook?.pluginName !== TEST_PLUGIN);
    if (kept.length) PluginManager.customEventHooks.set(name, kept);
    else PluginManager.customEventHooks.delete(name);
  }
}

function setup(options = {}) {
  clearTestHooks();
  transcriptCalls.length = 0;
  const tasks = [];
  const questCore = {
    ...core,
    CountdownTask: class { constructor(_player, _ticks, callback) { this.callback = callback; } },
    TaskManager: { submit(task) { tasks.push(task); } },
  };
  const custom = new Map();
  const emitted = [];
  const persistedAttributes = new Map();
  const variants = [];
  const conditions = [];
  const objects = new Map();
  const npcInteractions = [];
  const itemOnNpc = [];
  const zoneEnter = [];
  const interfaceButtons = [];
  const addCustom = (name, handler) => {
    const list = custom.get(name) ?? [];
    list.push(handler);
    custom.set(name, list);
    const hooks = PluginManager.customEventHooks.get(name) ?? [];
    hooks.push({ pluginName: TEST_PLUGIN, handler });
    PluginManager.customEventHooks.set(name, hooks);
  };
  const customInterfaces = new Map();
  const api = new Proxy({
    registerCustomInterface(definition) { customInterfaces.set(definition.groupId, definition); },
    core: questCore,
    persistAttribute(key, defaultValue) { persistedAttributes.set(key, defaultValue); },
    onNpcDialogueVariant(handler) {
      variants.push(handler);
      PluginManager.npcDialogueVariantHooks.push({ pluginName: TEST_PLUGIN, handler });
    },
    onNpcDialogueCondition(handler) {
      conditions.push(handler);
      PluginManager.npcDialogueConditionHooks.push({ pluginName: TEST_PLUGIN, handler });
    },
    onCustomEvent(name, handler) { addCustom(name, handler); },
    emitCustomEvent(name, event) {
      emitted.push({ name, event });
      PluginManager.emitCustomEvent(name, event);
    },
    onNpcInteraction(handler) {
      npcInteractions.push(handler);
      PluginManager.npcInteractionHooks.push({ pluginName: TEST_PLUGIN, handler });
    },
    onItemOnNpc(handler) {
      itemOnNpc.push(handler);
      PluginManager.itemOnNpcHooks.push({ pluginName: TEST_PLUGIN, handler });
    },
    onObjectInteraction(name, actions) { objects.set(name, actions); },
    onZoneEnter(_zone, handler) { zoneEnter.push(handler); },
    onPlayerLogin(handler) {
      PluginManager.loginHooks.push({ pluginName: TEST_PLUGIN, handler });
    },
    onInterfaceActionButton(buttonIds, handler) {
      const ids = new Set(Array.isArray(buttonIds) ? buttonIds : [buttonIds]);
      interfaceButtons.push({ buttonIds: [...ids], handler });
      PluginManager.interfaceActionClickHooks.push({ pluginName: TEST_PLUGIN, handler: (event) => {
        if (event.handled || !ids.has(event.buttonId)) return;
        if (handler(event) !== false) event.handled = true;
      } });
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/TowerOfLife.Quest')(api);
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'tower_of_life').at(-1);

  const attributes = new Map();
  const items = new Map();
  const equipment = new Map();
  const varbits = new Map();
  const messages = [];
  const xp = [];
  const rawModels = [];
  const positions = [];
  const subInterfaces = new Map();
  const subInterfaceSends = [];
  let full = false;
  let interfaceId = -1;
  let location = new core.Location(2649, 3225, 0);

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount = 1) {
      if (full && !items.has(id)) {
        messages.push("You don't have enough inventory space.");
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd(_player, item) {
      items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28),
    isFull: () => full,
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendInterface(group) { interfaceId = group; return sender; },
    sendInterfaceRemoval() { interfaceId = -1; return sender; },
    sendSubInterface(targetUid, group, type = 1) {
      subInterfaces.set(group, { targetUid, type });
      subInterfaceSends.push([targetUid, group, type]);
      return sender;
    },
    closeSubInterface(targetUid) {
      for (const [group, mounted] of subInterfaces) {
        if (mounted.targetUid === targetUid) subInterfaces.delete(group);
      }
      return sender;
    },
    sendInterfaceDisplayState() { return sender; },
    sendInterfaceRawModel(uid, model) { rawModels.push([uid, model, interfaceId]); return sender; },
    sendInterfacePosition(uid, x, y) { positions.push([uid, x, y]); return sender; },
    sendString() { return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const statements = [];
  const animations = [];
  const dialogueManager = {
    isActive: () => false, getCurrent: () => null, reset() {},
    startDialogues(chain) {
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (typeof entry.getText === 'function') statements.push(String(entry.getText()));
      }
    },
  };
  const player = {
    performAnimation: (animation) => animations.push(animation.getId?.() ?? animation.id ?? animation),
    performGraphic() {},
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null }),
    getPacketSender: () => sender,
    getInterfaceId: () => interfaceId,
    getDialogueManager: () => dialogueManager,
    getSkillManager: () => ({
      getCurrentLevel: () => options.constructionLevel ?? 99,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getUsername: () => 'tower-of-life-capture',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };

  const action = (stepId, extra = {}) => {
    const event = { player, stepId, handled: false, ...extra };
    PluginManager.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const selectVariant = (npcId, npc = null) =>
    PluginManager.emitNpcDialogueVariant({ player, npcId, npc });
  const objectAction = (name, option, event) => {
    const handler = objects.get(name)?.[option];
    if (!handler) return null;
    const payload = { player, handled: false, ...event };
    handler(payload);
    return payload;
  };
  const npcInteraction = (npcId, clickType, npc = null) => {
    const event = {
      player,
      npc: npc ?? { getLocation: () => location, getContentId: () => npcId },
      npcId,
      clickType,
      handled: false,
    };
    PluginManager.emitNpcInteraction(event);
    return event.handled ? event : null;
  };
  const login = () => PluginManager.emitPlayerLogin({ player });
  const flushTasks = () => {
    while (tasks.length > 0) tasks.shift().callback();
  };
  const closeInterface = () => {
    const closed = interfaceId;
    interfaceId = -1;
    PluginManager.emitCustomEvent('interface:closed', { player, interfaceId: closed });
  };
  const interfaceAction = (buttonId) => {
    const event = { player, buttonId, action: 1, handled: false };
    PluginManager.emitInterfaceActionClick(event);
    return event;
  };

  return {
    quest, player, statements, animations, attributes, items, equipment, varbits, messages, xp, rawModels, positions, emitted, transcriptCalls, custom, itemOnNpc, conditions,
    persistedAttributes,
    interfaceButtons, subInterfaces, subInterfaceSends, customInterfaces, action, selectVariant, objectAction, npcInteraction, login, closeInterface, interfaceAction, flushTasks,
    getInterfaceId: () => interfaceId,
    mindBarOpen: () => subInterfaces.has(MIND_BAR_GROUP),
    modelFor: (uid) => rawModels.filter(([target]) => target === uid).at(-1)?.[1],
    positionFor: (uid) => positions.filter(([target]) => target === uid).at(-1)?.slice(1),
    equipOutfit() {
      equipment.set(core.Equipment.HEAD_SLOT, { getId: () => I.HARD_HAT });
      equipment.set(core.Equipment.BODY_SLOT, { getId: () => I.BUILDERS_SHIRT });
      equipment.set(core.Equipment.LEG_SLOT, { getId: () => I.BUILDERS_TROUSERS });
      equipment.set(core.Equipment.FEET_SLOT, { getId: () => I.BUILDERS_BOOTS });
    },
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
  };
}


const STAGE = 'quest.tower_of_life.stage';
const SCALE = 'quest.tower_of_life.stage-scale';
const ui = (group, child) => (group << 16) | child;
/** The capture's presses, run-length: [component, count] (ticks 1593-1666, 2006-2185, 2443-2574). */
const PRESSURE_PRESSES = [[130, 2], [133, 6], [134, 7], [133, 2], [132, 7], [134, 4], [135, 5], [131, 4], [130, 3], [129, 4], [128, 2], [129, 4], [136, 2], [141, 2], [131, 1], [136, 1], [130, 2], [131, 3], [133, 4], [141, 1], [135, 4], [134, 1], [135, 2]];
const PIPE_PRESSES = [[11, 1], [17, 2], [19, 2], [21, 2], [23, 2], [15, 8], [17, 12], [19, 4], [21, 21], [13, 1], [15, 8], [17, 27], [19, 3], [17, 1], [21, 13], [11, 1], [10, 1], [15, 4], [23, 1], [21, 3], [23, 4], [17, 34], [21, 1], [9, 1], [15, 6], [17, 31], [21, 4], [19, 1], [21, 6], [12, 1], [15, 4], [17, 26], [23, 11]];
const CAGE_PRESSES = [[44, 1], [52, 1], [41, 1], [44, 1], [49, 1], [52, 1], [49, 1], [26, 3], [29, 3], [52, 1], [32, 1], [41, 1], [52, 2], [32, 1], [41, 1], [32, 1], [41, 1], [52, 1], [32, 1], [29, 1], [44, 3], [52, 3], [32, 1], [44, 1], [52, 1], [32, 1], [41, 1], [52, 1], [32, 1], [29, 1], [41, 1], [32, 1], [41, 1], [52, 1], [32, 1], [41, 1], [52, 2], [32, 1], [41, 1], [52, 3], [32, 1], [44, 1], [52, 1], [32, 1], [44, 1], [52, 2], [32, 1], [29, 1], [41, 1], [52, 1], [32, 1], [41, 1], [52, 1], [32, 1], [44, 1], [52, 1], [32, 1]];

function at(h, stage) {
  h.attributes.set(SCALE, 1);
  h.attributes.set(STAGE, stage);
}
function press(h, group, presses) {
  for (const [child, count] of presses) for (let i = 0; i < count; i++) h.interfaceAction(ui(group, child));
}
function line(h, npcId, text) {
  const request = { player: h.player, npcId, text, skip: false };
  PluginManager.emitCustomEvent('npc-dialogue:line', request);
  return request;
}
const tally = (list, text) => list.filter((entry) => entry === text).length;

test('stages are tol_prog values, moved on the lines the capture moves them on (ticks 378, 460, 1130, 2955, 3291)', () => {
  const h = setup();
  at(h, 0);
  PluginManager.emitCustomEvent('npc-dialogue:hook', { player: h.player, npcId: N.EFFIGY, hook: 'quest:tower-of-life:start' });
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.varbits.get(STAGE_VARBIT), 2);
  line(h, N.BONAFIDO, 'Only builders are allowed in there, like.');
  assert.equal(h.quest.getStage(h.player), 2);
  line(h, N.BONAFIDO, "Okay. Come to me kitted out like a builder - hard hat, some boots, scruffy trousers and shirt - and I'll let ya try out ta be one ov us.");
  assert.equal(h.quest.getStage(h.player), 4);
  line(h, N.BONAFIDO, "Cosmic! I canna see no reason why ya can't go in t'tower now.");
  assert.equal(h.quest.getStage(h.player), 6);
  at(h, 11);
  line(h, N.EFFIGY, 'Good on you! I knew you would help us!');
  assert.equal(h.quest.getStage(h.player), 12);
  at(h, 14);
  line(h, N.HOMUNCULUS_2, 'Easy. You run down and I watching from here. I surprise right moment.');
  assert.equal(h.quest.getStage(h.player), 16);
  assert.equal(h.varbits.get(STAGE_VARBIT), 16);
});

test('the tower door asks for permission first, and the first way in is tol_prog 8 (ticks 294, 1289)', () => {
  const h = setup();
  at(h, 2);
  h.setLocation(2649, 3226, 0);
  const refused = { player: h.player, objectId: O.TOWER_DOOR, location: { x: 2649, y: 3225, z: 0 }, handled: false };
  PluginManager.emitCustomEvent('door:toggle', refused);
  assert.equal(refused.handled, true);
  assert.deepEqual(h.statements, ["You're going to need permission to enter this building."]);
  at(h, 6);
  h.equipOutfit();
  const pass = { player: h.player, objectId: O.TOWER_DOOR, location: { x: 2649, y: 3225, z: 0 }, handled: false };
  PluginManager.emitCustomEvent('door:toggle', pass);
  assert.equal(pass.handled, false, 'the door lets the builder through');
  assert.equal(h.quest.getStage(h.player), 8);
  h.flushTasks();
  assert.ok(h.transcriptCalls.some((call) => call.variant === 'unfinished-work-entering-the-tower-of-life'));
});

test('talk routing follows the capture by stage', () => {
  const h = setup();
  const pick = (npcId) => {
    const value = h.selectVariant(npcId);
    return typeof value === 'object' && value ? value.variant : value;
  };
  at(h, 0);
  assert.equal(pick(N.BONAFIDO), 'standard-dialogue-before-tower-of-life');
  assert.equal(pick(N.GUMMY), 'standard-dialogue-before-tower-of-life');
  at(h, 2);
  assert.equal(pick(N.BONAFIDO), 'getting-started-speaking-with-bonafido-the-head-builder');
  at(h, 4);
  assert.equal(pick(N.BLACK_EYE), 'accessing-the-tower-obtaining-hard-hat');
  assert.equal(pick(N.THE_GUNS), 'accessing-the-tower-obtaining-builder-s-shirt');
  h.items.set(I.BUILDERS_SHIRT, 1);
  assert.equal(pick(N.THE_GUNS), 'standard-dialogue-after-tower-of-life', 'tick 722: his own page once the shirt is had');
  at(h, 6);
  assert.equal(pick(N.EFFIGY), 'getting-started-the-builders-on-strike-talking-to-effigy-again', 'tick 1187: "Guess what!"');
  assert.equal(pick(N.BLACK_EYE), 'standard-dialogue-after-tower-of-life', 'tick 1141');
  assert.equal(pick(N.GUMMY), 'standard-dialogue-after-tower-of-life', 'tick 1145');
  at(h, 11);
  assert.equal(pick(N.EFFIGY), 'finished-work-confronting-the-alchemists-effigy');
  at(h, 12);
  assert.equal(pick(N.EFFIGY), 'finished-work-confronting-the-alchemists-effigy-talking-to-effigy-again', 'tick 2960');
  assert.equal(pick(N.BONAFIDO), 'finished-work-talking-to-bonafido-again', 'tick 3018');
  assert.equal(pick(N.HOMUNCULUS_3), 'finished-work-freeing-the-homunculus-returning-to-it');
  at(h, 14);
  assert.equal(pick(N.HOMUNCULUS_3), 'finished-work-freeing-the-homunculus-leaving-and-talking-to-the-homunculus-before-helping-it', 'tick 3145');
  at(h, 17);
  assert.equal(pick(N.BONAFIDO), 'finished-work-freeing-the-homunculus-talking-to-bonafido-again', 'tick 3395');
  assert.equal(PluginManager.emitNpcDialogueVariant({ player: h.player, npcId: N.HOMUNCULUS, npc: { getLocation: () => new core.Location(3043, 4398, 0) } })?.variant
    ?? PluginManager.emitNpcDialogueVariant({ player: h.player, npcId: N.HOMUNCULUS, npc: { getLocation: () => new core.Location(3043, 4398, 0) } }),
  'finished-work-finishing-off-talking-to-the-homunculus-in-the-basement');
  at(h, 18);
  assert.equal(pick(N.BONAFIDO), 'standard-dialogue-after-tower-of-life', 'tick 3506');
});

test('crates rummage for eight ticks; crate 1 holds metal bars; no need once the machines work (ticks 1297-1314, 3047)', () => {
  const h = setup();
  at(h, 8);
  h.objectAction('Crate', 'Search', { objectId: O.CRATE_182, object: { getLocation: () => new core.Location(2647, 3223, 0) } });
  assert.deepEqual(h.animations, [5819]);
  assert.equal(h.items.get(I.METAL_BAR) ?? 0, 0);
  h.flushTasks();
  assert.equal(h.items.get(I.METAL_BAR), 1);
  assert.deepEqual(h.messages, ['You found something!']);
  assert.deepEqual(h.animations, [5819, 855]);
  for (const key of ['pressure', 'pipe', 'cage']) h.attributes.set(`quest.tower_of_life.${key}`, 2);
  h.objectAction('Crate', 'Search', { objectId: O.CRATE_189, object: { getLocation: () => new core.Location(2651, 3213, 0) } });
  assert.equal(h.messages.at(-1), 'You have no need to search the crates.');
});

test('a short machine build names the first missing material; a full one builds four ticks after the swing (ticks 2215, 2428-2432)', () => {
  const h = setup();
  at(h, 8);
  h.items.set(I.HAMMER, 1);
  h.items.set(I.SAW, 1);
  h.items.set(I.METAL_BAR, 4);
  h.items.set(I.BINDING_FLUID, 4);
  const short = h.action('Dl3PuF');
  assert.equal(short.handled, true);
  assert.deepEqual(h.statements, ['You need 5 metal bars to fix the machine.']);
  assert.equal(h.items.get(I.METAL_BAR), 4);
  h.items.set(I.METAL_BAR, 5);
  const built = h.action('Dl3PuF');
  assert.deepEqual(h.animations, [5846]);
  assert.equal(h.items.get(I.METAL_BAR), 0);
  assert.equal(typeof built.wait, 'function');
  let resumed = false;
  built.wait(() => { resumed = true; });
  assert.equal(h.varbits.get(3340) ?? 0, 0);
  h.flushTasks();
  assert.equal(resumed, true);
  assert.equal(h.varbits.get(3340), 1);
});

test('the pressure machine replays the capture: locked wheels, holes, plugs and the machine working (ticks 1590-1669)', () => {
  const h = setup();
  at(h, 8);
  h.attributes.set('quest.tower_of_life.pressure', 1);
  h.objectAction('Pressure machine', 'Fix', { objectId: O.PRESSURE_MACHINE });
  assert.equal(h.getInterfaceId(), 510);
  assert.deepEqual([3351, 3352, 3353, 3355].map((id) => h.varbits.get(id)), [3, 4, 1, 1]);
  assert.equal(h.varbits.get(7982), 1);
  press(h, 510, PRESSURE_PRESSES);
  assert.equal(tally(h.messages, "Pipe 2: The wheel won't budge. A lever will release it."), 10);
  assert.equal(tally(h.messages, "Pipe 4: The wheel won't budge. A lever will release it."), 16);
  assert.equal(tally(h.messages, "Pipe 3: There isn't enough pressure because of the hole!"), 6);
  assert.equal(tally(h.messages, "Pipe 1: There isn't enough pressure because of the hole!"), 4);
  assert.equal(tally(h.messages, "Pipe 4: There isn't enough pressure because of the hole!"), 1);
  assert.equal(tally(h.messages, "Pipe 3: You can't lower the pressure any further."), 5);
  for (const n of [1, 2, 3, 4]) assert.equal(tally(h.messages, `Pipe ${n}: The leak is blocked!`), 1);
  assert.deepEqual([3351, 3352, 3353, 3355].map((id) => h.varbits.get(id)), [5, 5, 5, 5]);
  assert.deepEqual([3347, 3348, 3349, 3350].map((id) => h.varbits.get(id)), [1, 1, 1, 1]);
  assert.equal(h.varbits.get(3338) ?? 1, 1, 'working three ticks after the last fill');
  h.flushTasks();
  assert.equal(h.varbits.get(3338), 2);
  assert.equal(h.messages.at(-1), 'The machine is working!');
  assert.deepEqual(h.statements, ['The machine is working!']);
  assert.equal(h.getInterfaceId(), -1);
});

test('the pipe machine replays the capture: 8-pixel moves, four turns and the lock within 9 pixels (ticks 2003-2189)', () => {
  const h = setup();
  at(h, 8);
  h.attributes.set('quest.tower_of_life.pipe', 1);
  h.objectAction('Pipe machine', 'Fix', { objectId: 21943 });
  assert.equal(h.getInterfaceId(), 511);
  assert.deepEqual(h.positionFor(ui(511, 10)), [356, 58]);
  assert.deepEqual(h.positionFor(ui(511, 9)), [402, 153]);
  assert.equal(h.modelFor(ui(511, 9)), 22544, 'piece 3 starts turned (its rotation-2 grey)');
  press(h, 511, PIPE_PRESSES.slice(0, 9));
  assert.deepEqual(h.positionFor(ui(511, 11)), [256, 60], 'piece 4 locks at (256,60) from (259,69), tick 2041');
  assert.equal(tally(h.messages, 'Please select a piece of pipe first.'), 1);
  press(h, 511, PIPE_PRESSES.slice(9));
  assert.equal(tally(h.messages, "You've already solved that piece!"), 1);
  assert.equal(tally(h.messages, 'Please select a piece of pipe first.'), 1, 'piece 1 stops at y 58 (ticks 2114-2115), so it locks on the last press');
  assert.deepEqual([10, 13, 9, 11, 12].map((child) => h.positionFor(ui(511, child))), [[83, 80], [126, 64], [159, 69], [256, 60], [237, 155]]);
  assert.equal(h.modelFor(ui(511, 9)), 22538);
  assert.equal(h.varbits.get(7981), 0, "tol_pipe5_rot went 1, 2, 3 and back to 0");
  assert.equal(h.varbits.get(3339) ?? 1, 1, 'working four ticks after the last lock');
  h.flushTasks();
  assert.equal(h.varbits.get(3339), 2);
  assert.equal(h.messages.at(-1), 'The machine is working!');
});

test('the cage replays the capture: wrong bars, any open slot of the side shown, and the turn before it is complete (ticks 2437-2582)', () => {
  const h = setup();
  at(h, 8);
  for (const key of ['pressure', 'pipe']) h.attributes.set(`quest.tower_of_life.${key}`, 2);
  h.attributes.set('quest.tower_of_life.cage', 1);
  h.objectAction('Cage', 'Fix', { objectId: 21941 });
  assert.equal(h.getInterfaceId(), 509);
  press(h, 509, CAGE_PRESSES);
  assert.equal(tally(h.messages, "You can't make bars smaller than that."), 1);
  assert.equal(tally(h.messages, "That's not going to work."), 4);
  assert.equal(tally(h.messages, 'You fix the part of the cage!'), 12);
  assert.equal(h.messages.at(-1), "It's complete!");
  assert.equal(h.modelFor(ui(509, 18)), 22494, 'the size-4 bar went to the second slot of side 3 first');
  h.flushTasks();
  assert.equal(h.varbits.get(3340), 2);
  assert.equal(h.varbits.get(3354), 1);
  assert.equal(h.messages.at(-1), 'The cage is complete!');
  assert.deepEqual(h.statements, ['The cage is complete!', 'The tower should be in working order now! Best go and tell Effigy!']);
});

test('the mind puzzle starts at 7, runs the questions round and ends at 0 or 14 (ticks 3094-3291)', () => {
  const h = setup();
  at(h, 12);
  const start = h.action('CrIrBk', { kind: 'message' });
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.varbits.get(3358), 7);
  assert.deepEqual(start.box, { statement: true });
  assert.ok(h.mindBarOpen());
  // The capture's first talk: answer, by question, from tick 3100 on.
  const answers = [
    'Get some logs and a tinderbox.', 'Not too sure, I\'ve never seen it happen.', 'Eat, sleep, nothing that exciting.', 'Bury them.',
    "I'm not really much of a traveller, sorry.", 'People mix together ingredients in vials. The nutrients will help you.', 'Never seen one personally.',
    "Perhaps. I've never seen it myself, though.", "It's beyond me!", 'Coincidence - there is a lot of loose metal around.',
    'Try some Mining followed by Smithing.', "Don't be silly! You'd get burnt!", "Everything has a reason, even if you don't know what it is.",
    "I'm too laid back to really care, mate.", 'With the aid of 5 fire runes.',
  ];
  const ids = ['97eltZ', 'ZpSk5O', '2Dr--Z', 'yu4sTZ', 'uV-kVf', 'Qy-c4H', 'tErHx-', 'UzEfko', 'qUwTWj', 'TCOCmh', 'QHamRU', 'BGjV-n', 'VmKi9Z', 'xCAmQm', '97eltZ'];
  const seen = [];
  answers.forEach((option, i) => {
    const ask = (stepId) => h.conditions.map((handler) => handler({ player: h.player, npcId: 6155, stepId })).find((v) => v !== null && v !== undefined);
    // Only the question in turn is true: the transcript's condition run plays the first true one.
    assert.deepEqual(ids.slice(0, 14).map(ask).filter(Boolean).length, 1);
    assert.equal(ask(ids[i]), true);
    PluginManager.emitCustomEvent('npc-dialogue:choice', { player: h.player, npcId: 6155, option });
    seen.push(h.varbits.get(3358));
  });
  assert.deepEqual(seen, [8, 8, 8, 9, 9, 10, 10, 10, 10, 11, 12, 12, 13, 13, 12]);
  h.attributes.set('quest.tower_of_life.mind-align', 14);
  const fixed = h.action('yA27Qt');
  assert.equal(fixed.handled, true);
  assert.equal(fixed.end, undefined);
  assert.equal(h.mindBarOpen(), false);
  assert.equal(line(h, N.HOMUNCULUS_3, 'I decided to root for magic.').text, 'I decided to root for logic.');
});

test('the trapdoor is locked until the scare, then opens a tick after the pull (ticks 2628, 3419-3422)', () => {
  const h = setup();
  at(h, 16);
  h.objectAction('Trapdoor', 'Open', { objectId: 21944, location: { x: 2648, y: 3212, z: 0 } });
  assert.deepEqual(h.statements, ['It seems to be locked.']);
  at(h, 17);
  h.objectAction('Trapdoor', 'Open', { objectId: 21944, location: { x: 2648, y: 3212, z: 0 } });
  assert.deepEqual(h.animations, [827]);
  assert.equal(h.varbits.get(3372) ?? 0, 0);
  h.flushTasks();
  assert.equal(h.varbits.get(3372), 1);
  // The Doors plugin asks first: the quest claims the trapdoor so it is not swung open like a door.
  const toggle = { player: h.player, objectId: 21944, location: { x: 2648, y: 3212, z: 0 }, handled: false };
  PluginManager.emitCustomEvent('door:toggle', toggle);
  assert.equal(toggle.handled, true);
  assert.equal(h.varbits.get(3372), 0, 'an open trapdoor closes');
});

test('the dungeon hand-in completes the quest and clears the puzzle varbits (tick 3442)', () => {
  const h = setup();
  at(h, 17);
  h.varbits.set(3351, 5);
  h.attributes.set('quest.tower_of_life.mind-align', 14);
  const done = h.action('mwkqoc');
  assert.equal(done.end, true);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(STAGE_VARBIT), 18);
  assert.equal(h.varbits.get(3351), 0);
  assert.equal(h.varbits.get(3358), 0);
});

test('No fingers is pickpocketed for the boots: two messages a tick apart and 8 Thieving xp (ticks 691-692)', () => {
  const h = setup();
  at(h, 4);
  h.npcInteraction(N.NO_FINGERS, 3);
  assert.deepEqual(h.messages, ["You attempt to pick the man's pocket."]);
  h.flushTasks();
  assert.equal(h.items.get(I.BUILDERS_BOOTS), 1);
  assert.deepEqual(h.messages.slice(1), ["You pick the man's pocket...and find some boots!", "Try the beckon emote while wearing an item of builders' clothing!"]);
  assert.deepEqual(h.animations, [881]);
  assert.equal(h.xp.at(-1)[1], 8);
});

test('saves from before tol_prog stages move onto it once', () => {
  const cases = [[16, 0, 18], [4, 1 << 4, 8], [4, 0, 6], [6, 0, 8], [14, 1 << 6, 17], [3, 0, 4]];
  for (const [old, flags, moved] of cases) {
    const h = setup();
    h.attributes.set(STAGE, old);
    h.attributes.set(FLAGS, flags);
    h.login();
    assert.equal(h.attributes.get(STAGE), moved, `old stage ${old}`);
    h.login();
    assert.equal(h.attributes.get(STAGE), moved, 'only once');
  }
});

test("Bonafido's whistles are held message boxes with the player's emote (ticks 925-930, 946-951, 993-996)", () => {
  const h = setup();
  at(h, 4);
  const cases = [['TQBFKO', 866, 5], ['e5x7Je', 862, 5], ['Wyx8j-', 5845, 3]];
  for (const [stepId, animation, holdTicks] of cases) {
    const box = h.action(stepId, { kind: 'message' }).box;
    assert.deepEqual(box, { statement: true, holdTicks, advance: true });
    assert.equal(h.animations.at(-1), animation);
  }
  assert.equal(h.action('13wIR1').handled, true, 'the emote step plays with the box');
});
