// Quest Helper parity for Romeo & Juliet, Witch's Potion and Vampyre Slayer.
// From server/: node --test tests/qh-f2p-village-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const transcripts = require('../data/definitions/npc-dialogues.json');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../dist/game/definition/ObjectDefinition').ObjectDefinition.init();
});

function register(name, key) {
  const hooks = new Map(), custom = new Map(), ground = [], objects = [];
  const api = new Proxy({
    core: { ...core, ObjectManager: { register: (object) => objects.push(object), deregister() {} } },
    persistAttribute() {},
    getItemOnGroundManager: () => ({ registerLocation: (owner, item, location) => ground.push({ owner, item, location }) }),
    onCustomEvent(event, fn) { if (!custom.has(event)) custom.set(event, []); custom.get(event).push(fn); },
    emitCustomEvent(event, payload) { for (const fn of custom.get(event) ?? []) fn(payload); },
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function');
      if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
    };
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { hooks, ground, objects,
    quest: getRegisteredQuests().findLast((quest) => quest.key === key),
    call: (event, payload) => {
      for (const fn of [...(custom.get(event) ?? []), ...(hooks.get(event) ?? [])]) fn(payload);
      return payload;
    },
  };
}

function player() {
  const attributes = new Map(), items = new Map();
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    isFull: () => false,
    getFreeSlots: () => 28,
  };
  let packet;
  packet = new Proxy({}, { get: () => (...args) => packet });
  const p = { attributes, items, messages: [],
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => [{ getAmount: () => 0 }],
    getPacketSender: () => packet, getUsername: () => 'Parity',
    getLocation: () => new core.Location(3210, 3220, 0),
    getSkillManager: () => ({ getCombatLevel: () => 3, addExperiences() {} }),
    sendMessage: (message) => p.messages.push(message),
  };
  return p;
}

function conditions(page, variant) {
  const found = [];
  const walk = (steps) => {
    for (const step of steps ?? []) {
      if (step.type === 'condition') found.push(step);
      walk(step.steps);
      for (const option of step.options ?? []) walk(option.steps);
    }
  };
  walk(transcripts[page].variants[variant]);
  return found;
}

test("Witch's Potion drops the indoor rat's tail only while the quest is in progress", () => {
  const q = register('WitchsPotion', 'witchs_potion'), p = player();
  const RAT_INDOORS = 2855; // Quest Helper NpcID.RAT_INDOORS, cache NpcIdentifiers.RAT_7.
  const npc = { getLocation: () => new core.Location(2955, 3202, 0) };
  q.call('onNpcDeath', { killer: p, npc, npcId: RAT_INDOORS });
  assert.equal(q.ground.length, 0, 'no tail before the quest starts');
  q.quest.setStage(p, 1);
  q.call('onNpcDeath', { killer: p, npc, npcId: RAT_INDOORS });
  assert.equal(q.ground.length, 1);
  assert.equal(q.ground[0].item.getId(), core.ItemIdentifiers.RATS_TAIL);
  p.items.set(core.ItemIdentifiers.RATS_TAIL, 1);
  q.call('onNpcDeath', { killer: p, npc, npcId: RAT_INDOORS });
  assert.equal(q.ground.length, 1, 'carrying a tail does not produce another');
  p.items.delete(core.ItemIdentifiers.RATS_TAIL);
  q.quest.setStage(p, 3);
  q.call('onNpcDeath', { killer: p, npc, npcId: RAT_INDOORS });
  assert.equal(q.ground.length, 1, 'no tail after completion');
});

test('Witch\'s Potion maps every held ingredient combination to the real partial-item branches', () => {
  const q = register('WitchsPotion', 'witchs_potion'), p = player();
  const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
  q.quest.setStage(p, 1);
  const hook = q.hooks.get('onNpcDialogueCondition')[0];
  const variant = () => q.hooks.get('onNpcDialogueVariant')[0]({ player: p, npcId: N.HETTY }).variant;
  const condition = conditions("Witch's Potion", 'acquiring-the-items-talking-to-hetty-with-some-of-the-items');

  const pair = condition.find((entry) => /rat's tail and burnt meat/.test(entry.text));
  assert.ok(pair, 'transcript still has the rat tail + burnt meat branch');
  p.items.set(I.RATS_TAIL, 1);
  assert.equal(hook({ player: p, npcId: N.HETTY, text: pair.text }), false);
  p.items.set(I.BURNT_MEAT, 1);
  assert.equal(hook({ player: p, npcId: N.HETTY, text: pair.text }), true);
  assert.equal(variant(), 'acquiring-the-items-talking-to-hetty-with-some-of-the-items');

  for (const id of [I.RATS_TAIL, I.BURNT_MEAT, I.ONION, I.EYE_OF_NEWT]) p.items.set(id, 1);
  assert.equal(variant(), 'acquiring-the-items-talking-to-hetty-with-all-the-items');
  p.items.clear();
  assert.equal(variant(), 'acquiring-the-items-talking-to-hetty-with-none-of-the-items');
});

test('Vampyre Slayer opens and searches the real 2612/2613 garlic cupboard', () => {
  const q = register('VampyreSlayer', 'vampyre_slayer'), p = player();
  const O = core.ObjectIdentifiers;
  assert.equal(O.CUPBOARD_18, 2612);
  assert.equal(O.CUPBOARD_19, 2613);
  const tile = new core.Location(3096, 3269, 1);
  const shut = new core.GameObject(O.CUPBOARD_18, tile, 10, 0);
  q.call('onObjectInteraction', { player: p, objectId: shut.getId(), object: shut, clickType: 1 });
  assert.equal(q.objects.at(-1)?.getId(), O.CUPBOARD_19);

  const open = new core.GameObject(O.CUPBOARD_19, tile, 10, 0);
  const search = open.getDefinition().getInteractions().indexOf('Search') + 1;
  assert.ok(search > 0, 'the open cupboard still offers Search');
  q.call('onObjectInteraction', { player: p, objectId: open.getId(), object: open, clickType: search });
  assert.equal(p.items.get(core.ItemIdentifiers.GARLIC), 1);
  assert.match(p.messages.at(-1), /cupboard contains garlic/);
});

test('Romeo & Juliet lets Juliet replace a lost message without advancing the stage', () => {
  const q = register('RomeoAndJuliet', 'romeo_and_juliet'), p = player();
  const N = core.NpcIdentifiers;
  q.quest.setStage(p, 20);
  const lost = conditions('Romeo & Juliet', 'finding-juliet-talking-to-juliet-again')
    .find((entry) => /lost the message/.test(entry.text));
  assert.ok(lost, 'transcript still has the lost-message branch');
  assert.equal(q.hooks.get('onNpcDialogueCondition')[0]({ player: p, npcId: N.JULIET, text: lost.text }), true);
  const action = q.call('npc-dialogue:action', { player: p, npcId: N.JULIET, stepId: 'KmL5hw' });
  assert.deepEqual(action.box.items, [core.ItemIdentifiers.MESSAGE]);
  assert.equal(p.items.get(core.ItemIdentifiers.MESSAGE), 1);
  assert.equal(q.quest.getStage(p), 20);
});


// --- Real PluginManager + NpcDialogues dispatch for Harlow -------------------
// The live player's bank starts as an array of null tabs; ownsStake must not
// throw on that shape or the variant hook is swallowed and NpcDialogues falls
// back to the generic Dr Harlow page.

let realIndex = 5000;
function realPlayer() {
  const attributes = new Map(), items = new Map(), configs = new Map(), varbits = new Map();
  const banks = new Array(core.Bank?.TOTAL_BANK_TABS ?? 11).fill(null);
  let location = new core.Location(3222, 3397, 0);
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount) => { if (p.failAddId !== id) items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    isFull: () => p.full === true,
    getFreeSlots: () => p.full ? ((items.get(core.ItemIdentifiers.COINS) ?? 0) > 0 ? 0 : 1) : 28,
  };
  let packet;
  packet = new Proxy({
    getVarp: (id) => configs.get(id) ?? 0,
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
    sendString() { return packet; },
    sendChatboxInterface() { return packet; },
    sendNpcHeadOnInterface() { return packet; },
    sendPlayerHeadOnInterface() { return packet; },
    sendInterfaceFlagsRange() { return packet; },
    sendInterfaceAnimation() { return packet; },
  }, { get: (target, key) => target[key] ?? ((...args) => packet) });
  const p = { attributes, items, configs, varbits, banks, messages: [], animations: [], prompt: null, failAddId: null, full: false,
    index: realIndex++,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => p.banks,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getPacketSender: () => packet, getDialogueManager: () => p.manager,
    getSkillManager: () => ({ addExperiences() {}, getCombatLevel: () => 3, getCurrentLevel: () => 10, getMaxLevel: () => 10 }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; }, addSteps() {} }),
    getLocation: () => location, moveTo: (to) => { location = to; },
    getArea: () => null, getPrivateArea: () => null, setArea() {}, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getUsername: () => 'HarlowTest', setPositionToFace() {}, forceChat() {},
    performAnimation: (animation) => p.animations.push(animation?.getId?.() ?? animation), sendMessage: (text) => p.messages.push(text),
    getAppearance: () => ({ isMale: () => true }),
  };
  p.manager = new DialogueManager(p);
  return p;
}

function registerHarlowDispatch() {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcAnyInteractionHooks.length,
  };
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName: 'VampyreSlayerTest', handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName: 'VampyreSlayerTest', handler });
    if (key === 'onCustomEvent') return (name, handler) => {
      const hooks = PluginManager.customEventHooks.get(name) ?? [];
      hooks.push({ pluginName: 'VampyreSlayerTest', handler });
      PluginManager.customEventHooks.set(name, hooks);
    };
    if (key === 'emitCustomEvent') return (name, payload) => PluginManager.emitCustomEvent(name, payload);
    return () => {};
  } });
  require('../plugins/quests/quests/VampyreSlayer.Quest')(api);
  const quest = getRegisteredQuests().findLast((entry) => entry.key === 'vampyre_slayer');
  return {
    quest,
    cleanup() {
      PluginManager.npcDialogueVariantHooks.length = before.variant;
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcAnyInteractionHooks.length = before.interaction;
      for (const [name, hooks] of PluginManager.customEventHooks) {
        const kept = hooks.filter((hook) => !String(hook.pluginName).endsWith('Test'));
        if (kept.length) PluginManager.customEventHooks.set(name, kept); else PluginManager.customEventHooks.delete(name);
      }
    },
  };
}

function registerRealDialogues() {
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'onAnyNpcInteraction') return (actions) => {
      for (const [action, handler] of Object.entries(actions)) {
        PluginManager.npcAnyInteractionHooks.push({ pluginName: 'NpcDialoguesTest', handler: (event) => {
          if (event.handled) return;
          const option = event.definition?.getActions?.()[event.clickType - 1];
          if (option !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'emitCustomEvent') return (name, payload) => PluginManager.emitCustomEvent(name, payload);
    if (key === 'onCustomEvent') return (name, handler) => {
      const hooks = PluginManager.customEventHooks.get(name) ?? [];
      hooks.push({ pluginName: 'NpcDialoguesTest', handler });
      PluginManager.customEventHooks.set(name, hooks);
    };
    if (key === 'sendMultiChatboxPrompt') return (player, title, ...pairs) => {
      player.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    };
    return () => {};
  } });
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
}

function harlowEvent(player) {
  const entity = NPC.create(core.NpcIdentifiers.DR_HARLOW, new core.Location(3222, 3397, 0));
  const definition = entity.getCurrentDefinition(player);
  return {
    player, npc: entity, definition, npcId: entity.getContentId(player), npcIndex: entity.getIndex(),
    clickType: 1, handled: false, location: { x: 3222, y: 3397, z: 0 },
  };
}

function currentText(player) {
  return player.manager.getCurrent()?.getText?.() ?? null;
}

function advanceToPrompt(player, limit = 60) {
  for (let step = 0; step < limit; step++) {
    if (player.prompt) return player.prompt;
    if (!player.manager.getCurrent()) break;
    player.manager.advance();
  }
  return player.prompt ?? null;
}

function choosePrompt(player, label) {
  const prompt = player.prompt;
  assert.ok(prompt, `no menu for ${label}`);
  const index = prompt.options.indexOf(label);
  assert.ok(index >= 0, `missing ${label} in ${JSON.stringify(prompt.options)}`);
  player.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

function finishDialogue(player, limit = 80) {
  for (let step = 0; step < limit; step++) {
    if (player.prompt) throw new Error(`unexpected menu ${JSON.stringify(player.prompt.options)}`);
    if (!player.manager.getCurrent()) return;
    player.manager.advance();
  }
  throw new Error('dialogue did not finish');
}

test('Vampyre Slayer Harlow resolves stage 2 with real null bank tabs and runs beer/stake', () => {
  const { quest, cleanup } = registerHarlowDispatch();
  registerRealDialogues();
  try {
    const player = realPlayer();
    const I = core.ItemIdentifiers;

    quest.setStage(player, 1);
    const first = harlowEvent(player);
    assert.equal(first.npcId, core.NpcIdentifiers.DR_HARLOW_2);
    assert.equal(first.npc.getId(), core.NpcIdentifiers.DR_HARLOW, 'the spawned actor keeps its parent id');
    PluginManager.emitNpcInteraction(first);
    assert.match(currentText(player) ?? '', /Buy me a drink pleassh/);
    const firstMenu = advanceToPrompt(player);
    assert.deepEqual(firstMenu.options, ["I need your help dealing with a vampyre.", "I think you've had enough."]);
    choosePrompt(player, 'I need your help dealing with a vampyre.');
    finishDialogue(player);
    assert.equal(quest.getStage(player), 2);

    // A real Player starts with null bank tabs; this must not throw inside the
    // variant hook (a throw makes NpcDialogues fall back to the generic page).
    assert.equal(player.getBanks().every((bank) => bank === null), true);
    player.items.set(I.BEER, 1);
    const second = harlowEvent(player);
    PluginManager.emitNpcInteraction(second);
    assert.match(currentText(player) ?? '', /Have yoush got me a beer/);
    const secondMenu = advanceToPrompt(player);
    assert.deepEqual(secondMenu.options, ["Yes, here you go.", "No. I think you've had enough."]);
    choosePrompt(player, 'Yes, here you go.');
    const followUp = advanceToPrompt(player);
    assert.deepEqual(followUp.options, ["You said no one's ever seen Count Draynor?", "So you were once a proper vampyre hunter?", "I'd best get going."]);
    choosePrompt(player, "I'd best get going.");
    finishDialogue(player);
    assert.equal(player.items.get(I.BEER) ?? 0, 0, 'beer consumed by the real message action');
    assert.equal(player.items.get(I.STAKE) ?? 0, 1, 'stake handed over by the real message action');
    assert.equal(quest.getStage(player), 2);

    // Post-quest Harlow must stay generic, and Morgan keeps all three variants.
    player.items.clear();
    quest.setStage(player, 3);
    PluginManager.emitNpcInteraction(harlowEvent(player));
    assert.match(currentText(player) ?? '', /Buy me a drink pleassh/);
    finishDialogue(player);
    const variant = (npcId) => PluginManager.emitNpcDialogueVariant({ player, npcId });
    quest.setStage(player, 1);
    assert.deepEqual(variant(core.NpcIdentifiers.MORGAN), { page: 'Vampyre Slayer', variant: 'starting-off-talking-to-morgan-again' });
    quest.setStage(player, 2);
    assert.deepEqual(variant(core.NpcIdentifiers.MORGAN), { page: 'Vampyre Slayer', variant: 'dr-harlow-returning-to-morgan' });
    player.items.set(I.GARLIC, 1);
    assert.deepEqual(variant(core.NpcIdentifiers.MORGAN), { page: 'Vampyre Slayer', variant: 'starting-off-talking-to-morgan-again' });
    // Wrong NPCs must not answer Harlow's variant/condition.
    assert.equal(variant(core.NpcIdentifiers.HETTY), null);
    const conditionHook = PluginManager.npcDialogueConditionHooks.find((hook) => hook.pluginName === 'VampyreSlayerTest').handler;
    assert.equal(conditionHook({ player, npcId: core.NpcIdentifiers.HETTY, text: 'If the player has a beer:' }), null);
    assert.equal(conditionHook({ player, npcId: core.NpcIdentifiers.DR_HARLOW, text: 'If the player lost the stake:' }), true);
    assert.equal(conditionHook({ player, npcId: core.NpcIdentifiers.DR_HARLOW, text: 'If the player has the stake:' }), false);
  } finally {
    cleanup();
  }
});


function registerQuestForDispatch(name, pluginName) {
  const before = {
    variant: PluginManager.npcDialogueVariantHooks.length,
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcInteractionHooks.length,
  };
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'onNpcDialogueVariant') return (handler) => PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
    if (key === 'onNpcInteraction') return (names, actions) => {
      const wanted = new Set([].concat(names));
      for (const [action, handler] of Object.entries(actions ?? {})) {
        PluginManager.npcInteractionHooks.push({ pluginName, handler: (event) => {
          if (event.handled || event.definition?.getName?.() === undefined || !wanted.has(event.definition.getName())) return;
          const clicked = event.definition.getActions()?.[event.clickType - 1];
          if (clicked !== action) return;
          if (handler(event) !== false) event.handled = true;
        } });
      }
    };
    if (key === 'onCustomEvent') return (eventName, handler) => {
      const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
      hooks.push({ pluginName, handler });
      PluginManager.customEventHooks.set(eventName, hooks);
    };
    if (key === 'emitCustomEvent') return (eventName, payload) => PluginManager.emitCustomEvent(eventName, payload);
    return () => {};
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { cleanup() {
    PluginManager.npcDialogueVariantHooks.length = before.variant;
    PluginManager.npcDialogueConditionHooks.length = before.condition;
    PluginManager.npcInteractionHooks.length = before.interaction;
    for (const [eventName, hooks] of PluginManager.customEventHooks) {
      const kept = hooks.filter((hook) => String(hook.pluginName) !== pluginName);
      if (kept.length) PluginManager.customEventHooks.set(eventName, kept); else PluginManager.customEventHooks.delete(eventName);
    }
  } };
}

function apothecaryEvent(player) {
  const entity = NPC.create(core.NpcIdentifiers.APOTHECARY, new core.Location(3195, 3404, 0));
  const definition = entity.getCurrentDefinition(player);
  return {
    player, npc: entity, definition, npcId: entity.getContentId(player), npcIndex: entity.getIndex(),
    clickType: 1, handled: false, location: { x: 3195, y: 3404, z: 0 },
  };
}

function registerBartendersDispatch() {
  const before = {
    condition: PluginManager.npcDialogueConditionHooks.length,
    interaction: PluginManager.npcAnyInteractionHooks.length,
  };
  const api = new Proxy({ core }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'onNpcDialogueCondition') return (handler) => PluginManager.npcDialogueConditionHooks.push({ pluginName: 'BartendersTest', handler });
    if (key === 'onCustomEvent') return (name, handler) => {
      const hooks = PluginManager.customEventHooks.get(name) ?? [];
      hooks.push({ pluginName: 'BartendersTest', handler });
      PluginManager.customEventHooks.set(name, hooks);
    };
    if (key === 'emitCustomEvent') return (name, payload) => PluginManager.emitCustomEvent(name, payload);
    return () => {};
  } });
  require('../plugins/npcs/Bartenders.plugin').register(api);
  return {
    cleanup() {
      PluginManager.npcDialogueConditionHooks.length = before.condition;
      PluginManager.npcAnyInteractionHooks.length = before.interaction;
      for (const [name, hooks] of PluginManager.customEventHooks) {
        const kept = hooks.filter((hook) => !String(hook.pluginName).endsWith('Test'));
        if (kept.length) PluginManager.customEventHooks.set(name, kept); else PluginManager.customEventHooks.delete(name);
      }
    },
  };
}

function bartenderEvent(player, npcId) {
  const entity = NPC.create(npcId, new core.Location(3222, 3399, 0));
  const definition = entity.getCurrentDefinition(player);
  return {
    player, npc: entity, definition, npcId: entity.getContentId(player), npcIndex: entity.getIndex(),
    clickType: 1, handled: false, location: { x: 3222, y: 3399, z: 0 },
  };
}

function buyAt(player, npcId, choice, label) {
  PluginManager.emitNpcInteraction(bartenderEvent(player, npcId));
  const prompt = advanceToPrompt(player);
  assert.ok(prompt, `${label}: no menu`);
  assert.ok(prompt.options.includes(choice), `${label}: missing ${choice} in ${JSON.stringify(prompt.options)}`);
  choosePrompt(player, choice);
  finishDialogue(player);
}

test('Bartenders charge the canonical 2 coins and add one beer, with safe refusal and repeat buys', () => {
  const { cleanup } = registerBartendersDispatch();
  registerRealDialogues();
  try {
    const I = core.ItemIdentifiers;
    const player = realPlayer();
    player.items.set(I.COINS, 5);

    buyAt(player, 1312, 'A glass of your finest ale please.', 'Blue Moon first');
    assert.equal(player.items.get(I.BEER), 1);
    assert.equal(player.items.get(I.COINS), 3);

    buyAt(player, 1312, 'A glass of your finest ale please.', 'Blue Moon repeat');
    assert.equal(player.items.get(I.BEER), 2);
    assert.equal(player.items.get(I.COINS), 1);

    buyAt(player, 1312, 'A glass of your finest ale please.', 'Blue Moon without coins');
    assert.equal(player.items.get(I.BEER), 2);
    assert.equal(player.items.get(I.COINS), 1);

    player.items.set(I.COINS, 5);
    player.full = true;
    buyAt(player, 1312, 'A glass of your finest ale please.', 'Blue Moon full bag');
    assert.equal(player.items.get(I.BEER), 2);
    assert.equal(player.items.get(I.COINS), 5);
    assert.match(player.messages.at(-1), /free inventory slot/);
    player.full = false;

    buyAt(player, 1311, 'Yes please!', 'Dancing Donkey');
    assert.equal(player.items.get(I.BEER), 3);
    assert.equal(player.items.get(I.COINS), 3);

    buyAt(player, 7546, "I'll have a beer please.", 'Sheared Ram');
    assert.equal(player.items.get(I.BEER), 4);
    assert.equal(player.items.get(I.COINS), 1);

    // Wrong page/npc or step must do nothing even with the real step ids.
    const actionHooks = (PluginManager.customEventHooks.get('npc-dialogue:action') ?? [])
      .filter((hook) => hook.pluginName === 'BartendersTest').map((hook) => hook.handler);
    const conditionHook = PluginManager.npcDialogueConditionHooks.find((hook) => hook.pluginName === 'BartendersTest').handler;
    const wrongNpc = { player, stepId: '-P7usW', action: 'receive', pages: [{ page: 'Hetty' }], handled: false };
    const wrongStep = { player, stepId: 'not-a-bartender-step', action: 'receive', pages: [{ page: 'Bartender (Blue Moon Inn)' }], handled: false };
    for (const hook of actionHooks) { hook(wrongNpc); hook(wrongStep); }
    assert.equal(wrongNpc.handled, false);
    assert.equal(wrongStep.handled, false);
    assert.equal(player.items.get(I.BEER), 4);
    assert.equal(player.items.get(I.COINS), 1);
    assert.equal(conditionHook({ player, text: 'If the player has at least two coins in their inventory:', pages: [{ page: 'Hetty' }] }), null);
  } finally {
    cleanup();
  }
});


test('Bartenders let exactly 2 coins free a full-bag slot at all three pubs and refund a failed beer add', () => {
  const { cleanup } = registerBartendersDispatch();
  registerRealDialogues();
  try {
    const I = core.ItemIdentifiers;
    const player = realPlayer();
    const pubs = [
      [1312, 'A glass of your finest ale please.', 'Blue Moon'],
      [1311, 'Yes please!', 'Dancing Donkey'],
      [7546, "I'll have a beer please.", 'Sheared Ram'],
    ];

    player.full = true;
    for (const [npcId, choice, label] of pubs) {
      player.items.set(I.COINS, 2);
      const beer = player.items.get(I.BEER) ?? 0;
      buyAt(player, npcId, choice, `${label} full bag exact coins`);
      assert.equal(player.items.get(I.BEER), beer + 1, `${label}: full bag with exactly 2 coins should buy`);
      assert.equal(player.items.get(I.COINS), 0, `${label}: exactly 2 coins taken`);
    }

    // Full bag with more than the price cannot free a slot; nothing is lost.
    for (const [npcId, choice, label] of pubs) {
      player.items.set(I.COINS, 5);
      const beer = player.items.get(I.BEER) ?? 0;
      buyAt(player, npcId, choice, `${label} full bag extra coins`);
      assert.equal(player.items.get(I.BEER), beer, `${label}: full bag with >2 coins must refuse`);
      assert.equal(player.items.get(I.COINS), 5, `${label}: refusal takes no coins`);
      assert.match(player.messages.at(-1), /free inventory slot/);
    }

    // A failed item add must refund the charge.
    player.full = false;
    player.items.set(I.COINS, 5);
    const beer = player.items.get(I.BEER) ?? 0;
    player.failAddId = I.BEER;
    buyAt(player, 1312, 'A glass of your finest ale please.', 'Blue Moon failed add');
    assert.equal(player.items.get(I.BEER), beer, 'failed add leaves no beer');
    assert.equal(player.items.get(I.COINS), 5, 'failed add refunds both coins');
    assert.match(player.messages.at(-1), /free inventory slot/);
    player.failAddId = null;
  } finally {
    cleanup();
  }
});


test('Romeo defers the Apothecary outside its window so A Tail of Two Cats answers', () => {
  const romeo = registerQuestForDispatch('RomeoAndJuliet', 'RomeoTest');
  const tail = registerQuestForDispatch('TailOfTwoCats', 'TailTest');
  const index = require('../data/definitions/npc-dialogue-index.json');
  const pages = (index['5036'] ?? []).map((entry) => ({ page: entry.page.replace(/^Transcript:/, ''), variants: entry.variants }));
  try {
    const player = realPlayer();
    const I = core.ItemIdentifiers;
    const variant = () => PluginManager.emitNpcDialogueVariant({ player, npcId: core.NpcIdentifiers.APOTHECARY, pages });

    // A Tail of Two Cats stage 40 with a hat: its named Talk-to handler defers,
    // then the variant dispatcher must let Tail answer instead of Romeo.
    player.attributes.set('quest.a_tail_of_two_cats.stage', 40);
    player.attributes.set('quest.romeo_and_juliet.stage', 0);
    player.items.set(6547, 1); // Doctor's hat.
    assert.equal(PluginManager.emitNpcInteraction(apothecaryEvent(player)), false, 'Tail named handler defers with the hat owned');
    assert.equal(variant(), 'medical-emergency-talking-to-the-apothecary-again');

    player.attributes.set('quest.romeo_and_juliet.stage', 100);
    assert.equal(variant(), 'medical-emergency-talking-to-the-apothecary-again');

    // Basic Apothecary fallback when neither quest claims him.
    player.attributes.set('quest.a_tail_of_two_cats.stage', 0);
    player.attributes.set('quest.romeo_and_juliet.stage', 0);
    player.items.clear();
    registerRealDialogues();
    PluginManager.emitNpcInteraction(apothecaryEvent(player));
    assert.match(currentText(player) ?? '', /I am the Apothecary\. I brew potions/);

    // Romeo still owns its real windows: stage 40, and stage 50 only while the potion is missing.
    player.attributes.set('quest.romeo_and_juliet.stage', 40);
    assert.deepEqual(variant(), { page: 'Romeo & Juliet', variant: 'making-the-cadava-potion-talking-to-the-apothecary' });
    player.attributes.set('quest.romeo_and_juliet.stage', 50);
    assert.deepEqual(variant(), { page: 'Romeo & Juliet', variant: 'making-the-cadava-potion-talking-to-the-apothecary-again' });
    player.items.set(I.CADAVA_POTION, 1);
    assert.equal(variant(), null);
    player.attributes.set('quest.romeo_and_juliet.stage', 60);
    assert.equal(variant(), null);
  } finally {
    tail.cleanup();
    romeo.cleanup();
    for (const [eventName, hooks] of PluginManager.customEventHooks) {
      const kept = hooks.filter((hook) => !String(hook.pluginName).endsWith('Test'));
      if (kept.length) PluginManager.customEventHooks.set(eventName, kept); else PluginManager.customEventHooks.delete(eventName);
    }
    PluginManager.npcAnyInteractionHooks.length = 0;
  }
});
