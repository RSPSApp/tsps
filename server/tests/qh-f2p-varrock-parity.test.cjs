// Run after yarn build: node --test tests/qh-f2p-varrock-parity.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});

function setup(module) {
  const itemOnObject = [], custom = new Map(), tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit: (task) => tasks.push(task), cancelTasks() {} } },
    persistAttribute() {},
    getItemOnGroundManager: () => ({ registerLocation() {}, getGroundItem: () => null }),
    onCustomEvent(name, fn) { const list = custom.get(name) ?? []; list.push(fn); custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of custom.get(name) ?? []) fn(event); },
    onItemOnObject(fn) { itemOnObject.push(fn); },
    spawnNpc: () => null,
    removeNpc() {},
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/' + module + '.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === questKey(module));

  const attributes = new Map(), items = new Map(), varbits = new Map(), messages = [];
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount, 'cannot consume missing ' + id); items.set(id, items.get(id) - amount); },
    isFull: () => false,
  };
  const sender = new Proxy({ sendVarbit: (id, value) => { varbits.set(id, value); return sender; } },
    { get: (target, key) => target[key] ?? (() => sender) });
  const player = {
    attributes, items, varbits, messages,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getBanks: () => [],
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getLocation: () => new core.Location(3200, 3400, 0),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues() {}, reset() {}, getCurrent: () => null, isActive: () => false }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getCombatLevel: () => 99, addExperiences() {} }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true, isNpc: () => false, isRegistered: () => true,
    getUsername: () => 'QH parity',
  };
  return { api, quest, player, items, attributes, varbits, messages, itemOnObject };
}

function questKey(module) {
  return { DemonSlayer: 'demon_slayer', GoblinDiplomacy: 'goblin_diplomacy', KnightsSword: 'the_knights_sword' }[module];
}

/** Mirrors the core item-on-object event; the core validates the slot item before dispatch. */
function itemOnObjectEvent(h, water, objectId) {
  return { player: h.player, object: {}, objectId, item: { getId: () => water }, itemId: water,
    itemSlot: 0, interfaceType: 0, location: { x: 3225, y: 3496, z: 0 }, handled: false };
}

test('Demon Slayer flushes the real drains with the single-volume water containers the Wiki allows', () => {
  const containers = [
    [I.BUCKET_OF_WATER, I.BUCKET],
    [I.JUG_OF_WATER, I.JUG],
    [I.BOWL_OF_WATER, I.BOWL],
    [I.VIAL_OF_WATER, I.VIAL],
  ];
  const drains = [O.DRAIN_6, O.DRAIN_7, 2843];
  for (let index = 0; index < containers.length; index++) {
    const [water, empty] = containers[index];
    const h = setup('DemonSlayer');
    h.quest.setStage(h.player, 2);
    h.items.set(water, 1);
    const event = itemOnObjectEvent(h, water, drains[index % drains.length]);
    h.itemOnObject[0](event);
    assert.equal(event.handled, true, 'handled for ' + water);
    assert.equal(h.items.get(water) ?? 0, 0, 'water ' + water + ' consumed');
    assert.equal(h.items.get(empty), 1, 'empty container returned for ' + water);
    assert.equal(h.attributes.get('demon_slayer.drain'), 2, 'drain flushed for ' + water);
    assert.equal(h.varbits.get(2568), 1, 'drain varbit for ' + water);
    assert.equal(h.quest.getStage(h.player), 2);
  }
});

test('Demon Slayer ignores foreign objects, foreign items, noted water and missing inventory', () => {
  const cases = [
    ['foreign object', I.BUCKET_OF_WATER, O.SINK],
    ['foreign item', I.BONES, O.DRAIN_6],
    ['noted water', I.BUCKET_OF_WATER_2, O.DRAIN_6],
    ['missing inventory', I.BUCKET_OF_WATER, O.DRAIN_6],
  ];
  for (const [name, itemId, objectId] of cases) {
    const h = setup('DemonSlayer');
    h.quest.setStage(h.player, 2);
    if (name !== 'missing inventory') h.items.set(itemId, 1);
    const event = itemOnObjectEvent(h, itemId, objectId);
    h.itemOnObject[0](event);
    assert.ok(!event.handled, name + ' is not handled');
    assert.equal(h.items.get(itemId) ?? 0, name === 'missing inventory' ? 0 : 1, name + ' is not consumed');
    assert.equal(h.attributes.get('demon_slayer.drain'), undefined, name + ' does not flush');
    assert.equal(h.varbits.get(2568), undefined, name + ' sends no varbit');
  }
});

test('Demon Slayer refuses water after Silverlight without consuming the container', () => {
  const h = setup('DemonSlayer');
  h.quest.setStage(h.player, 29);
  h.items.set(I.BUCKET_OF_WATER, 1);
  const event = itemOnObjectEvent(h, I.BUCKET_OF_WATER, O.DRAIN_6);
  h.itemOnObject[0](event);
  assert.equal(event.handled, true);
  assert.equal(h.items.get(I.BUCKET_OF_WATER), 1);
  assert.equal(h.items.get(I.BUCKET) ?? 0, 0);
  assert.match(h.messages.at(-1), /no reason/);
});

// Real DialogueManager + plugin tasks/scene controls for the Delrith encounter.
function sceneSetup() {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const hooks = new Map(), custom = new Map(), tasks = [], areas = [], spawned = [], removed = [], prompts = [];
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: {
        submit: (task) => { task.setRunning(true); tasks.push(task); },
        cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
      },
    },
    persistAttribute() {},
    registerArea: (area) => areas.push(area),
    getItemOnGroundManager: () => ({ registerLocation() {}, getGroundItem: () => null }),
    onCustomEvent(name, fn) { const list = custom.get(name) ?? []; list.push(fn); custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of custom.get(name) ?? []) fn(event); },
    onNpcBeforeDeath(fn) { const list = hooks.get('onNpcBeforeDeath') ?? []; list.push(fn); hooks.set('onNpcBeforeDeath', list); },
    spawnNpc(def) {
      let area = null, location = new core.Location(def.x, def.y, def.z), hp = 7, transform = -1;
      const npc = {
        def, getId: () => def.id, getIndex: () => 1, getLocation: () => location,
        moveTo: (value) => { location = value; }, getArea: () => area, setArea: (value) => { area = value; },
        getMovementQueue: () => ({ addSteps: (value) => { location = value; } }), getCombat: () => ({ reset() {} }),
        getHitpoints: () => hp, setHitpoints: (value) => { hp = value; }, getDefinition: () => core.NpcDefinition.forId(def.id),
        setNpcTransformationId: (value) => { transform = value; }, getNpcTransformationId: () => transform,
        getOwner: () => def.owner, isPlayer: () => false, isNpc: () => true, isRegistered: () => true,
        performAnimation() {}, getAsNpc: () => npc,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { removed.push(npc); npc.__removed = true; },
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function');
      if (fn) { const list = hooks.get(prop) ?? []; list.push(fn); hooks.set(prop, list); }
    };
  } });
  require('../plugins/quests/quests/DemonSlayer.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'demon_slayer');
  const attributes = new Map(), items = new Map(), varbits = new Map(), messages = [], equipment = [];
  const movement = { block: false, reset() { return this; }, setBlockMovement(value) { this.block = value; return this; } };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  let area = null, location = new core.Location(3223, 3377, 0);
  const player = {
    attributes, items, varbits, messages, equipment, movement,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ getAmount: (id) => items.get(id) ?? 0, isFull: () => false,
      adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)) }),
    getBanks: () => [], getEquipment: () => ({ getItems: () => equipment, get: () => null }),
    getLocation: () => location, moveTo: (value) => { location = value; },
    getArea: () => area, setArea: (value) => { area = value; }, getPrivateArea: () => area instanceof core.PrivateArea ? area : null,
    getPacketSender: () => sender, getUsername: () => 'Scene tester', getIndex: () => 1,
    getSkillManager: () => ({ getCurrentLevel: () => 99, getCombatLevel: () => 99, addExperiences() {} }),
    getMovementQueue: () => movement, setUntargetable() {}, getCombat: () => ({ reset() {} }),
    getForceMovement: () => null, setForceMovement() {}, isRunningReturn: () => false, setRunning() {},
    performAnimation() {}, performGraphic() {}, setNpcTransformationId() {}, getNpcTransformationId: () => -1,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => player, isRegistered: () => true,
    sendMessage: (message) => messages.push(message), getFrameUpdater: () => ({ clear() {} }),
  };
  const manager = new DialogueManager(player);
  player.getDialogueManager = () => manager;
  const tick = (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); };
  return { api, quest, player, movement, varbits, spawned, removed, prompts, areas, manager, tick,
    call: (name, payload) => { for (const fn of hooks.get(name) ?? []) fn(payload); } };
}

test('Demon Slayer keeps the summon scene locked, then hands off unlocked at story end', () => {
  const h = sceneSetup();
  h.quest.setStage(h.player, 29);
  h.varbits.set(2569, 0);
  h.areas[0].process(h.player);
  assert.equal(h.movement.block, true, 'the summoning cutscene stays locked');
  assert.match(h.manager.getCurrent()?.getText() ?? '', /^Arise, O mighty Delrith/);
  h.manager.advance();
  h.manager.advance();
  h.tick(13);
  assert.ok(h.spawned.some((npc) => npc.getId() === core.NpcIdentifiers.DELRITH));
  h.tick(1);
  for (let step = 0; step < 8 && h.manager.getCurrent(); step++) h.manager.advance();
  assert.equal(h.varbits.get(2569), 1, 'the story-end marker is sent');
  assert.equal(h.movement.block, false, 'story end hands control to the fight');
  assert.ok(h.removed.length > 0, 'the exit actor is cleaned up after the handoff');
  const delrith = h.spawned.find((npc) => npc.getId() === core.NpcIdentifiers.DELRITH);
  h.player.equipment.push({ getId: () => core.ItemIdentifiers.SILVERLIGHT });
  assert.equal(h.areas[0].canAttack(h.player, delrith), null, 'the real-area attack gate accepts Silverlight after the story');
});

// Real KnightsSword registration + real NpcDialogues/DialogueManager for stage-3 recovery.
function knightsSetup() {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const custom = new Map(), named = new Map(), prompts = [];
  const api = new Proxy({
    core: { ...core },
    persistAttribute() {},
    onCustomEvent(name, fn) { const list = custom.get(name) ?? []; list.push(fn); custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of custom.get(name) ?? []) fn(event); },
    onNpcInteraction(name, actions) { named.set(name, actions); },
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onInterfaceActionButton() {},
    onPlayerLogin() {},
    sendMultiChatboxPrompt(player, title, ...args) { prompts.push({ player, title, args }); return true; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/KnightsSword.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'the_knights_sword');
  const attrs = new Map(), items = new Map(), varbits = new Map();
  const inventory = { getAmount: (id) => items.get(id) ?? 0, isFull: () => false,
    adds: (id, amount) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)) };
  const sender = new Proxy({ sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0 }, { get: (target, key) => target[key] ?? (() => sender) });
  let location = new core.Location(3001, 3144, 0);
  const player = { attrs, items, varbits,
    getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory, getEquipment: () => ({ get: () => null }), getBanks: () => [],
    getPacketSender: () => sender, getLocation: () => location, moveTo: (value) => { location = value; },
    getSkillManager: () => ({ getCurrentLevel: () => 99, getCombatLevel: () => 99, addExperiences() {} }),
    getUsername: () => 'Knight recovery', getAppearance: () => ({ isMale: () => true }), isRegistered: () => true,
    getFrameUpdater: () => ({ clear() {} }), performAnimation() {}, performGraphic() {},
  };
  const manager = new DialogueManager(player);
  player.getDialogueManager = () => manager;
  return { quest, player, attrs, items, named, prompts, manager };
}

test('KnightsSword stage-3 interrupted pie recovery replays the captured sword request without a second pie', () => {
  const h = knightsSetup();
  h.attrs.set('quest.the_knights_sword.stage', 3);
  const thurgo = core.NpcIdentifiers.THURGO;
  const handler = h.named.get('Thurgo')?.['Talk-to'];
  assert.ok(handler, 'production Thurgo Talk-to handler registered');
  const event = { player: h.player, npcId: thurgo, definition: core.NpcDefinition.forId(thurgo) };
  assert.equal(handler(event), true);
  let prompt;
  for (let step = 0; step < 20 && !prompt; step++) {
    prompt = h.prompts.find((entry) => entry.args.includes('Can you make a special sword for me?'));
    if (!prompt) h.manager.advance();
  }
  assert.ok(prompt, 'captured WITH_PIE sword-request option is reachable');
  const index = prompt.args.indexOf('Can you make a special sword for me?');
  prompt.args[index + 1]();
  for (let step = 0; step < 20 && h.quest.getStage(h.player) < 4; step++) h.manager.advance();
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.items.get(core.ItemIdentifiers.REDBERRY_PIE) ?? 0, 0, 'no second pie was consumed');
});
