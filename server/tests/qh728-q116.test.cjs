// Tower of Life (q116) source-contract tests.
// From server/: node --test tests/qh728-q116.test.cjs
//
// Fixture start: stages, inventory and the scared flag are set directly. Each test
// dispatches the plugin's registered handler and asserts the observable effect; the
// machine/costume tests do not prove a natural traversal of the tower.
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

const TEST_PLUGIN = 'TowerOfLifeQ116Test';
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
  const api = new Proxy({
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
    sendInterfaceRawModel(uid, model) { rawModels.push([uid, model]); return sender; },
    sendInterfacePosition(uid, x, y) { positions.push([uid, x, y]); return sender; },
    sendString() { return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null }),
    getPacketSender: () => sender,
    getInterfaceId: () => interfaceId,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, reset() {} }),
    getSkillManager: () => ({
      getCurrentLevel: () => options.constructionLevel ?? 99,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getUsername: () => 'qh728-q116',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };

  const action = (stepId) => {
    const event = { player, stepId, handled: false };
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
    quest, player, attributes, items, equipment, varbits, messages, xp, rawModels, positions, emitted, transcriptCalls, custom, itemOnNpc, conditions,
    persistedAttributes,
    interfaceButtons, subInterfaces, subInterfaceSends, action, selectVariant, objectAction, npcInteraction, login, closeInterface, interfaceAction, flushTasks,
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


function expectedSpeech(h, npcId, steps, picks = [], out = []) {
  for (const step of steps ?? []) {
    if (step.type === 'end') break;
    if (typeof step.player === 'string') out.push(step.player);
    if (step.type === 'line' && typeof step.text === 'string') out.push(step.text);
    if (step.type === 'message' && typeof step.text === 'string') out.push(step.text);
    if (step.type === 'action' && ['VtcfG5', 'ZkpaiW', 'p7AQxw', 'yA27Qt'].includes(step.id)) return out;
    if (step.type === 'choice') {
      const pick = picks.shift();
      const option = (step.options ?? []).find((entry) => !pick || entry.text === pick || entry.text.startsWith(pick)) ?? step.options?.[0];
      if (option) expectedSpeech(h, npcId, option.steps ?? [], picks, out);
      return out;
    }
    if (step.type === 'condition') {
      const answer = h.conditions
        .map((handler) => handler({ player: h.player, npcId, stepId: step.id, text: step.text }))
        .find((value) => value !== null && value !== undefined);
      if (answer === true) expectedSpeech(h, npcId, step.steps ?? [], picks, out);
    }
  }
  return out;
}

function realPlay(h, npcId, variant, picks = []) {
  const chains = [];
  const lines = [];
  const prompts = [];
  const messagesBefore = h.messages.length;
  const manager = {
    startDialogues(chain) { chains.push(chain); },
    getCurrent() { return chains.at(-1) ? [...chains.at(-1).getDialogues().values()][0] : null; },
    reset() {},
    advance() {},
  };
  h.player.getDialogueManager = () => manager;
  const api = {
    core,
    emitCustomEvent(name, event) {
      PluginManager.emitCustomEvent(name, event);
    },
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      const options = [];
      for (let index = 0; index < pairs.length; index += 2) options.push(pairs[index]);
      prompts.push({ title, options });
      const pick = picks.shift();
      let chosen = 0;
      if (pick !== undefined) {
        const found = options.findIndex((option) => String(option) === pick || String(option).startsWith(pick));
        if (found >= 0) chosen = found;
      }
      const callback = pairs[chosen * 2 + 1];
      if (callback) callback();
      return true;
    },
  };

  assert.equal(realStartTranscript(api, h.player, npcId, 'Tower of Life', variant), true,
    `${variant} must be present in the generated dialogue data`);
  let guard = 0;
  while (chains.length > 0 && guard++ < 200) {
    const chain = chains.shift();
    const entries = [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex());
    for (const entry of entries) {
      const text = typeof entry.getText === 'function' ? entry.getText() : null;
      if (text) lines.push(String(text));
      if (entry.constructor.name === 'ActionDialogue') entry.send(h.player);
    }
  }
  h.flushTasks();
  return { lines, prompts, messages: h.messages.slice(messagesBefore) };
}

test('fresh stage 0 requires Construction 10 and starts at wire 2', () => {
  const low = setup({ constructionLevel: 9 });
  assert.equal(low.selectVariant(N.EFFIGY), 'getting-started-the-builders-on-strike');
  PluginManager.emitCustomEvent('npc-dialogue:hook',
    { player: low.player, npcId: N.EFFIGY, hook: 'quest:tower-of-life:start' });
  assert.equal(low.quest.getStage(low.player), 0);
  assert.ok(low.messages.some((message) => message.includes('Construction level of 10')));

  const ready = setup();
  assert.equal(ready.selectVariant(N.EFFIGY), 'getting-started-the-builders-on-strike');
  PluginManager.emitCustomEvent('npc-dialogue:hook',
    { player: ready.player, npcId: N.EFFIGY, hook: 'quest:tower-of-life:start' });
  assert.equal(ready.quest.getStage(ready.player), 2);
  assert.equal(ready.varbits.get(STAGE_VARBIT), 2);
});

test('machine puzzle state uses namespaced persisted attributes with a null starting value', () => {
  const h = setup();
  assert.equal(h.persistedAttributes.get('tower-of-life:pressure-puzzle'), null);
  assert.equal(h.persistedAttributes.get('tower-of-life:pipe-puzzle'), null);
  assert.equal(h.persistedAttributes.get('tower-of-life:cage-puzzle'), null);
  for (const key of h.persistedAttributes.keys()) {
    assert.doesNotMatch(key, /^quest\.tower_of_life\.(pressure|pipe|cage)-puzzle$/);
  }
});

test('the basement completion action cannot finish the quest before the mind is freed', () => {
  const h = setup();
  h.quest.setStage(h.player, 12);
  h.action('mwkqoc');
  assert.equal(h.quest.getStage(h.player), 12);
  assert.equal(h.quest.isComplete(h.player), false);
  assert.equal(h.varbits.get(STAGE_VARBIT), 12);
});

test('durable stages map to the cache tol_prog progression values', () => {
  const h = setup();
  const expected = new Map([[0, 0], [2, 2], [3, 4], [4, 6], [6, 8], [8, 10], [11, 11], [12, 12], [14, 14], [16, 18]]);
  for (const [stage, wire] of expected) {
    h.quest.setStage(h.player, stage);
    assert.equal(h.varbits.get(STAGE_VARBIT), wire, `stage ${stage} must send tol_prog ${wire}`);
  }
});

test('scaring the alchemists advances the wire to 16 and login replays the mapping', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  assert.equal(h.varbits.get(STAGE_VARBIT), 14);

  const variant = h.selectVariant(N.EFFIGY);
  assert.equal(variant, 'finished-work-freeing-the-homunculus-effigy');
  assert.equal(h.attributes.get(FLAGS) & SCARED, SCARED);
  assert.equal(h.varbits.get(STAGE_VARBIT), 16, 'the scare leg is canonical tol_prog 16');

  h.quest.setStage(h.player, 14);
  h.attributes.set(FLAGS, SCARED);
  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(STAGE_VARBIT), 16, 'relogin resends the scared wire, not the raw durable stage');

  h.quest.setStage(h.player, 16);
  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(STAGE_VARBIT), 18, 'completion resends the cache completion threshold');
});

test('the basement hand-in completes once at the canonical wire value', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  h.attributes.set(FLAGS, SCARED);
  h.setLocation(3038, 4395, 0);
  const npc = { getLocation: () => new core.Location(3038, 4395, 0) };

  assert.equal(h.selectVariant(N.HOMUNCULUS, npc),
    'finished-work-finishing-off-talking-to-the-homunculus-in-the-basement');
  const event = h.action('mwkqoc');
  assert.equal(event.handled, true);
  assert.equal(h.quest.getStage(h.player), 16);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(STAGE_VARBIT), 18, 'completion must reach the cache threshold');
  assert.equal(h.attributes.get('quest.points'), 2);
  assert.deepEqual(h.xp, [
    [core.Skill.CONSTRUCTION, 1000],
    [core.Skill.CRAFTING, 500],
    [core.Skill.THIEVING, 500],
  ]);

  h.action('mwkqoc');
  assert.equal(h.attributes.get('quest.points'), 2, 'a repeat hand-in grants no extra points');
  assert.equal(h.xp.length, 3, 'a repeat hand-in grants no extra xp');
});

function stockMachineMaterials(h) {
  for (const id of [
    I.COLOURED_BALL, I.METAL_SHEET, I.VALVE_WHEEL,
    I.PIPE_2, I.PIPE_RING, I.RIVETS,
    I.METAL_BAR, I.BINDING_FLUID,
  ]) h.items.set(id, 10);
  h.items.set(I.HAMMER, 1);
  h.items.set(I.SAW, 1);
}

function buildMachine(h, name, objectId, buildAction, openAction) {
  const event = h.objectAction(name, 'Fix', { objectId });
  assert.equal(event.handled, true, `${name} Fix is owned`);
  assert.equal(h.transcriptCalls.at(-1).variant,
    `unfinished-work-fixing-the-${name === 'Cage' ? 'strange-cage' : name === 'Pipe machine' ? 'pipe-system' : 'pressure-machine'}`);
  h.action(buildAction);
  h.action(openAction);
  h.flushTasks();
  assert.equal(h.varbits.get(name === 'Cage' ? 3340 : name === 'Pipe machine' ? 3339 : 3338), 1,
    `${name} is built but not calibrated`);
}

function pressPressure(h, child) {
  return h.interfaceAction((510 << 16) | child);
}

function solvePressure(h) {
  pressPressure(h, 128); pressPressure(h, 128); // ball 1 left to the hole
  pressPressure(h, 129); pressPressure(h, 129); pressPressure(h, 129); // fill
  pressPressure(h, 136); // left lever for ball 2
  pressPressure(h, 130); pressPressure(h, 130);
  pressPressure(h, 131); pressPressure(h, 131); pressPressure(h, 131);
  pressPressure(h, 133); pressPressure(h, 133); pressPressure(h, 133); pressPressure(h, 133); // ball 3 right to drip
  pressPressure(h, 132); pressPressure(h, 133); pressPressure(h, 133); // left to plug, right to fill
  pressPressure(h, 141); // right lever for ball 4
  pressPressure(h, 135); pressPressure(h, 135); pressPressure(h, 135); pressPressure(h, 135);
  pressPressure(h, 134); pressPressure(h, 135); pressPressure(h, 135);
}

function pressPipe(h, child) {
  return h.interfaceAction((511 << 16) | child);
}

function solvePipe(h, firstPieceMovedLeft = 0) {
  const pieces = [
    { child: 9, dx: 7 + firstPieceMovedLeft, dy: -6 },
    { child: 10, dx: 3, dy: -5 },
    { child: 11, dx: 13, dy: -7 },
    { child: 12, dx: 12, dy: -1, rotate: 1 },
    { child: 13, dx: 5, dy: -6 },
  ];
  for (const piece of pieces) {
    pressPipe(h, piece.child);
    for (let turn = 0; turn < (piece.rotate ?? 0); turn++) pressPipe(h, 15);
    for (let move = 0; move < Math.abs(piece.dx); move++) pressPipe(h, piece.dx > 0 ? 19 : 17);
    for (let move = 0; move < Math.abs(piece.dy); move++) pressPipe(h, piece.dy > 0 ? 23 : 21);
  }
}

function pressCage(h, child) {
  return h.interfaceAction((509 << 16) | child);
}

function solveCage(h) {
  const sides = [
    [['h', 2], ['h', 2], ['v', 2]],
    [['v', 2], ['h', 3], ['h', 2]],
    [['v', 2], ['v', 4], ['h', 2]],
    [['h', 4], ['v', 2], ['v', 3]],
  ];
  let size = 1;
  for (let side = 0; side < sides.length; side++) {
    if (side > 0) pressCage(h, 29);
    for (const [orientation, targetSize] of sides[side]) {
      pressCage(h, orientation === 'h' ? 41 : 44);
      while (size < targetSize) { pressCage(h, 52); size++; }
      while (size > targetSize) { pressCage(h, 49); size--; }
      pressCage(h, 32);
    }
  }
}

test('all three machine interfaces are calibrated through their real controls and advance to wire 8', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);

  buildMachine(h, 'Pressure machine', O.PRESSURE_MACHINE, 'GYrrRh', 'VtcfG5');
  assert.equal(h.getInterfaceId(), 510);
  solvePressure(h);
  assert.equal(h.varbits.get(3338), 2);

  buildMachine(h, 'Pipe machine', O.PIPE_MACHINE, '7-wU8Y', 'ZkpaiW');
  assert.equal(h.getInterfaceId(), 511);
  solvePipe(h);
  assert.equal(h.varbits.get(3339), 2);

  buildMachine(h, 'Cage', O.CAGE_17, 'Dl3PuF', 'p7AQxw');
  assert.equal(h.getInterfaceId(), 509);
  solveCage(h);
  assert.equal(h.varbits.get(3340), 2);

  assert.equal(h.items.get(I.COLOURED_BALL), 6);
  assert.equal(h.items.get(I.PIPE_RING), 5);
  assert.equal(h.items.get(I.METAL_BAR), 5);
  assert.equal(h.items.get(I.HAMMER), 1, 'tools are not consumed');
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.varbits.get(STAGE_VARBIT), 8, 'machines fixed is canonical tol_prog 8');
  assert.ok(h.messages.includes('The tower should be in working order now! Best go and tell Effigy!'));
});

test('pressure calibration rejects a locked valve, survives cancel/reopen/relog, then completes', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);
  buildMachine(h, 'Pressure machine', O.PRESSURE_MACHINE, 'GYrrRh', 'VtcfG5');

  pressPressure(h, 136); // lock ball 1 in the wrong lever position
  assert.ok(h.attributes.has('tower-of-life:pressure-puzzle'), 'pressure layout is saved under its namespaced key');
  pressPressure(h, 128);
  assert.equal(h.varbits.get(3351), 4, 'the locked valve does not move the ball');
  assert.ok(h.messages.includes('The valve is locked.'));

  h.closeInterface();
  assert.equal(h.getInterfaceId(), -1);
  const transcriptsBeforeReopen = h.transcriptCalls.length;
  const reopened = h.objectAction('Pressure machine', 'Fix', { objectId: O.PRESSURE_MACHINE });
  assert.equal(reopened.handled, true);
  assert.equal(h.getInterfaceId(), 510);
  assert.equal(h.transcriptCalls.length, transcriptsBeforeReopen, 'reopen does not replay the build transcript');
  assert.equal(h.varbits.get(3351), 4, 'cancel/reopen preserves the ball position');

  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(3351), 4, 'relog restores the pressure puzzle levels');

  pressPressure(h, 136);
  assert.equal(h.varbits.get(3356), 1, 'relog closed the interface, so a stale button click is ignored');
  h.objectAction('Pressure machine', 'Fix', { objectId: O.PRESSURE_MACHINE });
  pressPressure(h, 136); // unlock ball 1 again
  solvePressure(h);
  assert.equal(h.varbits.get(3338), 2);
});

test('pipe calibration requires selection/rotation/placement, survives cancel/reopen/relog, then completes', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);
  buildMachine(h, 'Pipe machine', O.PIPE_MACHINE, '7-wU8Y', 'ZkpaiW');

  pressPipe(h, 17); // move without a selected piece: no-op
  assert.equal(h.varbits.get(3343), 0, 'no piece is in hand until one is picked up');
  pressPipe(h, 9);
  pressPipe(h, 17); pressPipe(h, 17); // move the 5-piece left, away from its target
  assert.ok(h.attributes.has('tower-of-life:pipe-puzzle'), 'pipe layout is saved under its namespaced key');
  assert.equal(h.varbits.get(3343), 1, 'a misplaced piece stays in the tray');

  h.closeInterface();
  const reopened = h.objectAction('Pipe machine', 'Fix', { objectId: O.PIPE_MACHINE });
  assert.equal(reopened.handled, true);
  assert.equal(h.getInterfaceId(), 511);
  assert.equal(h.varbits.get(3343), 1, 'cancel/reopen preserves the pipe state');

  h.login();
  assert.equal(h.varbits.get(3343), 1, 'relog restores the pipe tray varbits');

  pressPipe(h, 17);
  assert.equal(h.varbits.get(3343), 1, 'relog closed the interface, so a stale pipe control is ignored');
  h.objectAction('Pipe machine', 'Fix', { objectId: O.PIPE_MACHINE });
  solvePipe(h, 2);
  assert.equal(h.varbits.get(3339), 2);
});

test('cage assembly rejects a wrong bar, survives cancel/reopen/relog, then completes', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);
  buildMachine(h, 'Cage', O.CAGE_17, 'Dl3PuF', 'p7AQxw');

  pressCage(h, 44); // wrong orientation for side 1 bar 1
  assert.ok(h.attributes.has('tower-of-life:cage-puzzle'), 'cage layout is saved under its namespaced key');
  pressCage(h, 32);
  assert.equal(h.varbits.get(3340), 1);
  assert.equal(h.rawModels.length, 0, 'a wrong bar places no solved model');

  h.closeInterface();
  const transcriptsBeforeReopen = h.transcriptCalls.length;
  const reopened = h.objectAction('Cage', 'Fix', { objectId: O.CAGE_17 });
  assert.equal(reopened.handled, true);
  assert.equal(h.getInterfaceId(), 509);
  assert.equal(h.transcriptCalls.length, transcriptsBeforeReopen, 'reopen does not replay the build transcript');

  h.login();
  assert.equal(h.varbits.get(3340), 1, 'relog keeps the cage unfinished');

  pressCage(h, 29);
  assert.equal(h.varbits.get(3340), 1, 'relog closed the interface, so a stale cage control is ignored');
  h.objectAction('Cage', 'Fix', { objectId: O.CAGE_17 });
  solveCage(h);
  assert.equal(h.varbits.get(3340), 2);
});
test('machine and mind controls are scoped to their stages and open interface', () => {
  const h = setup();
  h.quest.setStage(h.player, 3);
  stockMachineMaterials(h);

  const notAdmitted = h.objectAction('Pressure machine', 'Fix', { objectId: O.PRESSURE_MACHINE });
  assert.equal(notAdmitted.handled, true);
  assert.equal(h.transcriptCalls.length, 0, 'an unadmitted player cannot start a machine repair');
  assert.equal(h.getInterfaceId(), -1);

  h.quest.setStage(h.player, 6);
  h.messages.length = 0;
  h.objectAction('Pressure machine', 'Fix', { objectId: O.PRESSURE_MACHINE });
  assert.equal(h.transcriptCalls.length, 0, 'a finished tower cannot replay the build transcript');
  assert.deepEqual(h.messages, ['The machine is working!']);
  assert.equal(h.getInterfaceId(), -1);

  h.quest.setStage(h.player, 4);
  h.interfaceAction((510 << 16) | 128);
  assert.equal(h.varbits.get(3351), undefined, 'valve clicks without the open interface are ignored');

  h.quest.setStage(h.player, 11);
  const wrongStageBar = h.action('uGmjY6');
  assert.equal(wrongStageBar.handled, true);
  assert.equal(h.mindBarOpen(), false, 'the mind bar only opens during the Homunculus stage');

  h.quest.setStage(h.player, 12);
  h.player.setAttribute('quest.tower_of_life.mind-align', 7);
  h.quest.setStage(h.player, 13);
  const wrongStageFix = h.action('yA27Qt');
  assert.equal(wrongStageFix.handled, true);
  assert.equal(wrongStageFix.end, true);
  assert.equal(h.quest.getStage(h.player), 13, 'the terminal mind action cannot advance a neighbouring stage');
});

test('the trapdoor is sealed until the homunculus is freed', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  const climb = (objectId) => {
    const request = {
      player: h.player,
      objectId,
      object: { getLocation: () => new core.Location(2648, 3212, 0) },
      handled: false,
    };
    PluginManager.emitCustomEvent('ladders:climb', request);
    return request;
  };

  assert.equal(climb(O.TRAPDOOR_86).handled, true);
  assert.ok(h.messages.includes("The trapdoor won't budge."));
  assert.equal(h.emitted.filter((entry) => entry.name === 'ladders:climbDown').length, 0);

  h.attributes.set(FLAGS, SCARED);
  assert.equal(climb(O.TRAPDOOR_86).handled, true);
  const down = h.emitted.find((entry) => entry.name === 'ladders:climbDown');
  assert.ok(down, 'the freed homunculus opens the dungeon route');
  assert.equal(down.event.destination.getX(), 3038);
  assert.equal(down.event.destination.getY(), 4376);
  assert.equal(h.messages.filter((message) => message === "The trapdoor won't budge.").length, 1);
});


test('the Homunculus mind bar and answer controls advance to wire 14', () => {
  const h = setup();
  h.quest.setStage(h.player, 12);
  const npc = { getLocation: () => new core.Location(2648, 3217, 3) };
  assert.equal(h.selectVariant(N.HOMUNCULUS, npc),
    'finished-work-freeing-the-homunculus-returning-to-it');

  const talk = h.npcInteraction(N.HOMUNCULUS, 1, npc);
  assert.equal(talk, null, 'the first talk lets the normal transcript play');
  assert.equal(h.mindBarOpen(), false, 'the imported uGmjY6 action opens the bar, not the NPC hook');

  const openBar = h.action('uGmjY6');
  assert.equal(openBar.handled, true);
  assert.deepEqual(h.subInterfaces.get(MIND_BAR_GROUP), { targetUid: OVERLAY_HUD_UID, type: 1 },
    'the mind bar is the cache HUD overlay 508, not a main modal');
  assert.equal(h.varbits.get(3358), 8, 'neutral mind alignment');

  const questions = [
    ['97eltZ', 'Get some logs and a tinderbox.'],
    ['ZpSk5O', 'By ignition of gas in their belly as they exhale.'],
    ['2Dr--Z', 'Fletching, Crafting, Smithing.'],
    ['yu4sTZ', 'Bury them.'],
    ['uV-kVf', 'Run, run as fast as you can.'],
    ['Qy-c4H', 'People mix together ingredients in vials. The nutrients will help you.'],
    ['tErHx-', 'Take some essence to an altar and use a talisman.'],
    ['UzEfko', 'Sure. Use your brain to tell someone to move it!'],
  ];
  for (let index = 0; index < questions.length; index++) {
    const [stepId, option] = questions[index];
    PluginManager.emitNpcDialogueCondition({ player: h.player, npcId: N.HOMUNCULUS, stepId });
    PluginManager.emitCustomEvent('npc-dialogue:choice', { player: h.player, npcId: N.HOMUNCULUS, option });
    // The bar is four bits: 8 is neutral, 15 fully logical.
    assert.equal(h.varbits.get(3358), Math.min(15, 8 + index + 1), 'each answer moves the bar');
  }
  assert.equal(h.attributes.get('quest.tower_of_life.mind-align'), 8);

  const repeat = h.npcInteraction(N.HOMUNCULUS, 1, npc);
  assert.equal(repeat.handled, true, 'later talks still own the mind conversation');
  const start = h.emitted.findLast((entry) => entry.name === 'npc-dialogue:start');
  assert.ok(start, 'the repeat conversation replays the imported transcript');
  const steps = start.event.select(towerVariants['finished-work-freeing-the-homunculus-returning-to-it']);
  assert.ok(steps.some((step) => step.type === 'action' && step.id === 'uGmjY6'),
    'the repeat transcript keeps the imported mind-bar action');

  const action = h.action('yA27Qt');
  assert.equal(action.handled, true);
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.varbits.get(STAGE_VARBIT), 14);
  assert.equal(h.mindBarOpen(), false, 'the bar closes when the mind is fixed');

  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(3358), 15, 'relog resends the clamped mind alignment');
  assert.equal(h.mindBarOpen(), false, 'relog does not reopen a closed mind bar');

  const early = setup();
  early.quest.setStage(early.player, 12);
  const earlyAction = early.action('yA27Qt');
  assert.equal(earlyAction.handled, true);
  assert.equal(earlyAction.end, true);
  assert.equal(early.quest.getStage(early.player), 12, 'the mind is not fixed below the threshold');
});

test('builder costume hand-ins are owned and the final quiz admits the player', () => {
  const h = setup();
  h.quest.setStage(h.player, 3);

  assert.equal(h.selectVariant(N.BLACK_EYE).variant, 'accessing-the-tower-obtaining-hard-hat');
  h.action('g0D-tI');
  assert.equal(h.items.get(I.HARD_HAT), 1);
  h.action('g0D-tI');
  assert.equal(h.items.get(I.HARD_HAT), 1, 'the hard hat is granted once');

  const pickpocket = h.npcInteraction(N.NO_FINGERS, 3);
  assert.equal(pickpocket.handled, true);
  assert.equal(h.transcriptCalls.at(-1).variant, 'accessing-the-tower-obtaining-builder-s-boots-stealing-the-boots');
  h.action('1z74yp');
  assert.equal(h.items.get(I.BUILDERS_BOOTS), 1);

  h.items.set(I.BEER, 1);
  const guns = { player: h.player, npcId: N.THE_GUNS, itemId: I.BEER, item: { getDefinition: () => ({ isNoted: () => false }) }, handled: false };
  PluginManager.emitItemOnNpc(guns);
  assert.equal(guns.handled, true);
  h.action('d8nl3j');
  assert.equal(h.items.get(I.BUILDERS_SHIRT), 1);
  assert.equal(h.items.get(I.BEER), 0, 'the beer is consumed');

  h.objectAction('Plant', 'Search', { objectId: O.PLANT_80, location: { x: 2640, y: 3210, z: 0 } });
  h.action('2crh1R');
  assert.equal(h.items.get(I.BUILDERS_TROUSERS), 1);

  h.equipOutfit();
  PluginManager.emitCustomEvent('npc-dialogue:choice',
    { player: h.player, npcId: N.BONAFIDO, option: "Carry on, it'll fix itself" });
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.varbits.get(STAGE_VARBIT), 6, 'admission is canonical tol_prog 6');
});

test('a full bag refuses the hard hat without granting it', () => {
  const h = setup();
  h.quest.setStage(h.player, 3);
  h.setFull(true);
  h.action('g0D-tI');
  assert.equal(h.items.get(I.HARD_HAT) ?? 0, 0);
  assert.ok(h.messages.some((message) => message.includes('inventory space')));
});

test('the imported builder lines play through the real transcript runner', () => {
  const cases = [
    { npcId: N.BLACK_EYE, variant: 'accessing-the-tower-obtaining-hard-hat', picks: ['Three', 'Torn curtains', '10 clay pieces'] },
    { npcId: N.THE_GUNS, variant: 'accessing-the-tower-obtaining-builder-s-shirt', picks: [], beer: true },
    { npcId: N.GUMMY, variant: 'accessing-the-tower-obtaining-builder-s-trousers', picks: [] },
    { npcId: N.NO_FINGERS, variant: 'accessing-the-tower-obtaining-builder-s-boots', picks: [] },
  ];
  for (const entry of cases) {
    const h = setup();
    h.quest.setStage(h.player, 3);
    if (entry.beer) h.items.set(I.BEER, 1);
    const expected = expectedSpeech(h, entry.npcId, towerVariants[entry.variant], [...entry.picks]);
    const run = realPlay(h, entry.npcId, entry.variant, [...entry.picks]);
    const spoken = run.lines.concat(run.messages).map(normalizeText);
    for (const text of expected) {
      assert.ok(spoken.includes(normalizeText(text)), `${entry.variant} must speak the imported line: ${text}`);
    }
  }
});

test('machine build transcripts play their imported lines and open the real interface', () => {
  const cases = [
    { name: 'Pressure machine', objectId: O.PRESSURE_MACHINE, variant: 'unfinished-work-fixing-the-pressure-machine', group: 510, solve: solvePressure, progressVarbit: 3338 },
    { name: 'Pipe machine', objectId: O.PIPE_MACHINE, variant: 'unfinished-work-fixing-the-pipe-system', group: 511, solve: solvePipe, progressVarbit: 3339 },
    { name: 'Cage', objectId: O.CAGE_17, variant: 'unfinished-work-fixing-the-strange-cage', group: 509, solve: solveCage, progressVarbit: 3340 },
  ];
  for (const entry of cases) {
    const h = setup();
    h.quest.setStage(h.player, 4);
    stockMachineMaterials(h);
    const expected = expectedSpeech(h, N.BONAFIDO, towerVariants[entry.variant], ['Yes']);
    const run = realPlay(h, N.BONAFIDO, entry.variant, ['Yes']);
    const spoken = run.lines.concat(run.messages).map(normalizeText);
    for (const text of expected) {
      assert.ok(spoken.includes(normalizeText(text)), `${entry.variant} must speak the imported line: ${text}`);
    }
    assert.equal(h.getInterfaceId(), entry.group, `${entry.name} opens its cache interface`);
    assert.equal(h.varbits.get(entry.progressVarbit), 1, `${entry.name} is built, not calibrated`);
    entry.solve(h);
    assert.equal(h.varbits.get(entry.progressVarbit), 2, `${entry.name} completes through real controls`);
    assert.equal(h.getInterfaceId(), -1);
  }
});

test('the imported mind-bar conversation drives the real answers and alignment bar', () => {
  const variant = 'finished-work-freeing-the-homunculus-returning-to-it';
  const answers = [
    'Get some logs and a tinderbox.',
    'By ignition of gas in their belly as they exhale.',
    'Fletching, Crafting, Smithing.',
    'Bury them.',
    'Run, run as fast as you can.',
    'People mix together ingredients in vials. The nutrients will help you.',
    'Take some essence to an altar and use a talisman.',
    'Sure. Use your brain to tell someone to move it!',
  ];
  const firstQuestion = towerVariants[variant].find((step) => step.id === '97eltZ').steps[0].prompt;
  const h = setup();
  h.quest.setStage(h.player, 12);
  const npc = { getLocation: () => new core.Location(2648, 3217, 3) };

  const expected = expectedSpeech(h, N.HOMUNCULUS, towerVariants[variant], [answers[0]]);
  for (let index = 0; index < answers.length; index++) {
    const run = realPlay(h, N.HOMUNCULUS, variant, [answers[index]]);
    assert.ok(run.prompts.length > 0, 'the imported question prompt is shown');
    if (index === 0) {
      assert.ok(run.prompts.some((prompt) => prompt.title === firstQuestion),
        'the first imported question prompt is shown');
    }
    if (index === 0) {
      const spoken = run.lines.concat(run.messages).map(normalizeText);
      for (const text of expected) {
        assert.ok(spoken.includes(normalizeText(text)), `mind transcript must speak: ${text}`);
      }
      assert.ok(h.subInterfaceSends.some(([target, group, type]) =>
        target === OVERLAY_HUD_UID && group === MIND_BAR_GROUP && type === 1),
      'the imported uGmjY6 action opens the cache mind-bar overlay');
    }
    assert.equal(h.varbits.get(3358), Math.min(15, 8 + index + 1), 'the alignment bar follows the real answers');
  }
  assert.equal(h.attributes.get('quest.tower_of_life.mind-align'), 8);
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.varbits.get(STAGE_VARBIT), 14);
});

test('the pressure machine solves along the Quest Helper route, including the third ball', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);
  buildMachine(h, 'Pressure machine', O.PRESSURE_MACHINE, 'GYrrRh', 'VtcfG5');

  // Quest Helper's pressureSolver: ball 1 down into its hole (level 2), then up to fill.
  pressPressure(h, 128); pressPressure(h, 128);
  pressPressure(h, 129); pressPressure(h, 129); pressPressure(h, 129);
  assert.equal(h.varbits.get(3347), 1, 'ball 1 is plugged');
  assert.equal(h.varbits.get(3351), 5, 'ball 1 is filled');

  pressPressure(h, 136); // the lever that frees ball 2
  pressPressure(h, 130); pressPressure(h, 130);
  pressPressure(h, 131); pressPressure(h, 131); pressPressure(h, 131);
  assert.equal(h.varbits.get(3348), 1, 'ball 2 is plugged');
  assert.equal(h.varbits.get(3352), 5, 'ball 2 is filled');

  // Ball 3's hole sits at level 3, above its start: the solver raises the ball into it.
  pressPressure(h, 133); pressPressure(h, 133); pressPressure(h, 133);
  assert.equal(h.varbits.get(3349), 1, 'ball 3 plugs when it is raised into its hole');
  assert.equal(h.varbits.get(3353), 3);
  pressPressure(h, 133); pressPressure(h, 133);
  assert.equal(h.varbits.get(3353), 5, 'ball 3 is filled');

  pressPressure(h, 141); // the lever that frees ball 4
  pressPressure(h, 135); pressPressure(h, 135); pressPressure(h, 135);
  assert.equal(h.varbits.get(3350), 1, 'ball 4 is plugged');
  pressPressure(h, 135); pressPressure(h, 135);
  assert.equal(h.varbits.get(3355), 5, 'ball 4 is filled');

  assert.equal(h.varbits.get(3338), 2, 'the pressure machine works');
  assert.equal(h.quest.getStage(h.player), 4, 'the tower is only fixed once all three machines work');
});

test('the pipe mirrors the piece model, position and rotation varbit and refuses a misoriented piece', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  stockMachineMaterials(h);
  buildMachine(h, 'Pipe machine', O.PIPE_MACHINE, '7-wU8Y', 'ZkpaiW');

  pressPipe(h, 9);
  assert.equal(h.varbits.get(3343), 1, 'the piece in hand is the active one');
  assert.equal(h.varbits.get(3341), 0, 'only one piece is active at a time');
  assert.equal(h.modelFor((511 << 16) | 9), 22547, 'the 5-piece shows its cache model');
  assert.deepEqual(h.positionFor((511 << 16) | 9), [47, 165], 'the piece position is mirrored');

  pressPipe(h, 15);
  assert.equal(h.varbits.get(7981), 1, 'the rotation is mirrored on tol_pipe5_rot');
  assert.equal(h.modelFor((511 << 16) | 9), 22544, 'the rotated piece shows its next model');
  pressPipe(h, 15); pressPipe(h, 15); pressPipe(h, 15);
  assert.equal(h.modelFor((511 << 16) | 9), 22547, 'four rotations return to the first model');

  // The big bend has to be turned before it fits into the pipe.
  pressPipe(h, 12);
  for (let move = 0; move < 12; move++) pressPipe(h, 19);
  pressPipe(h, 21);
  assert.ok(h.messages.includes('That piece does not fit.'), 'a misoriented piece is refused');
  assert.equal(h.varbits.get(3339), 1, 'the pipe is not fixed yet');
  pressPipe(h, 15);
  assert.equal(h.modelFor((511 << 16) | 12), 22562, 'the big bend shows its solved model');
  assert.deepEqual(h.positionFor((511 << 16) | 12), [237, 155], 'the big bend sits on its target');

  solvePipe(h);
  assert.equal(h.varbits.get(3339), 2, 'the pipe machine works');
});

test('a lost builder-costume piece is handed out again', () => {
  const h = setup();
  h.quest.setStage(h.player, 3);

  h.action('g0D-tI');
  assert.equal(h.items.get(I.HARD_HAT), 1);
  h.items.delete(I.HARD_HAT);
  assert.equal(h.selectVariant(N.BLACK_EYE).variant, 'accessing-the-tower-obtaining-hard-hat',
    'Black-eye hands out a new hard hat');
  h.action('g0D-tI');
  assert.equal(h.items.get(I.HARD_HAT), 1, 'the hard hat is obtained again');

  h.action('1z74yp');
  assert.equal(h.items.get(I.BUILDERS_BOOTS), 1);
  h.items.delete(I.BUILDERS_BOOTS);
  const pickpocket = h.npcInteraction(N.NO_FINGERS, 3);
  assert.equal(pickpocket.handled, true, 'the boots can be pickpocketed again');
  h.action('1z74yp');
  assert.equal(h.items.get(I.BUILDERS_BOOTS), 1, 'the boots are obtained again');

  h.items.set(I.BEER, 1);
  const guns = { player: h.player, npcId: N.THE_GUNS, itemId: I.BEER, item: { getDefinition: () => ({ isNoted: () => false }) }, handled: false };
  PluginManager.emitItemOnNpc(guns);
  h.action('d8nl3j');
  assert.equal(h.items.get(I.BUILDERS_SHIRT), 1);
  h.items.delete(I.BUILDERS_SHIRT);
  h.items.set(I.BEER, 1);
  const again = { player: h.player, npcId: N.THE_GUNS, itemId: I.BEER, item: { getDefinition: () => ({ isNoted: () => false }) }, handled: false };
  PluginManager.emitItemOnNpc(again);
  assert.equal(again.handled, true, 'The Guns pours another beer for a lost shirt');
  h.action('d8nl3j');
  assert.equal(h.items.get(I.BUILDERS_SHIRT), 1, 'the shirt is obtained again');

  const plant = { objectId: O.PLANT_80, location: { x: 2640, y: 3210, z: 0 } };
  h.objectAction('Plant', 'Search', plant);
  h.action('2crh1R');
  assert.equal(h.items.get(I.BUILDERS_TROUSERS), 1);
  h.items.delete(I.BUILDERS_TROUSERS);
  const searched = h.objectAction('Plant', 'Search', plant);
  assert.equal(searched.handled, true, 'the plants are searched again');
  h.action('2crh1R');
  assert.equal(h.items.get(I.BUILDERS_TROUSERS), 1, 'the trousers are found again');

  // A player who lost a piece can wear the outfit again and enter the tower.
  h.quest.setStage(h.player, 4);
  h.setLocation(2649, 3225, 0);
  const door = { objectId: O.TOWER_DOOR, location: { x: 2649, y: 3225, z: 0 } };
  const refused = h.objectAction('Tower door', 'Open', door);
  assert.equal(refused.handled, true);
  assert.ok(h.messages.some((message) => message.includes("Come back to me wearin'")),
    'the door still refuses an incomplete outfit');
  h.equipOutfit();
  const opened = h.objectAction('Tower door', 'Open', door);
  assert.equal(opened.handled, true, 'the recovered outfit opens the tower');
});

test('the dungeon descent sends the canonical tol_prog 17 before the hand-in', () => {
  const h = setup();
  h.quest.setStage(h.player, 14);
  h.attributes.set(FLAGS, SCARED);
  const climb = (objectId, location) => {
    const request = { player: h.player, objectId, object: { getLocation: () => location }, handled: false };
    PluginManager.emitCustomEvent('ladders:climb', request);
    return request;
  };

  climb(O.TRAPDOOR_86, new core.Location(2648, 3212, 0));
  assert.equal(h.varbits.get(STAGE_VARBIT), 17, 'the descent is the cache tol_prog step 17');

  h.varbits.clear();
  h.login();
  assert.equal(h.varbits.get(STAGE_VARBIT), 17, 'relog resends the basement step');

  climb(17974, new core.Location(3038, 4375, 0)); // the dungeon ladder
  assert.equal(h.varbits.get(STAGE_VARBIT), 16, 'climbing back to the tower returns to the scare step');

  climb(O.TRAPDOOR_86, new core.Location(2648, 3212, 0));
  h.setLocation(3038, 4395, 0);
  h.action('mwkqoc');
  assert.equal(h.varbits.get(STAGE_VARBIT), 18, 'the hand-in completes at the cache threshold');
});

test('the magic answers push the sanity meter to the fully magical end', () => {
  const h = setup();
  h.quest.setStage(h.player, 12);
  const magic = [
    ['97eltZ', 'With the aid of 5 fire runes.'],
    ['ZpSk5O', 'With the help of the magical dragonstones!'],
    ['2Dr--Z', 'Runecraft, enchant jewellery, perform alchemy.'],
    ['yu4sTZ', 'Turn them into bananas or peaches!'],
    ['uV-kVf', 'Depends where you are headed, but teleport spells are a safe bet.'],
    ['Qy-c4H', 'Yes, you can make magic potions to boost your skills.'],
    ['tErHx-', 'By harnessing the power of the gods!'],
    ['UzEfko', 'Yep, you can use the Telekinetic Grab spell.'],
  ];
  for (const [stepId, option] of magic) {
    PluginManager.emitNpcDialogueCondition({ player: h.player, npcId: N.HOMUNCULUS, stepId });
    PluginManager.emitCustomEvent('npc-dialogue:choice', { player: h.player, npcId: N.HOMUNCULUS, option });
  }
  assert.equal(h.attributes.get('quest.tower_of_life.mind-align'), -8);
  assert.equal(h.varbits.get(3358), 0, 'the magic route reaches the fully magical end');

  const action = h.action('yA27Qt');
  assert.equal(action.handled, true);
  assert.equal(h.quest.getStage(h.player), 14, 'the mind is fixed at the magical end');
  assert.equal(h.varbits.get(STAGE_VARBIT), 14);
});
