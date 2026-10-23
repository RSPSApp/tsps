// From server/: node --test tests/sins-qh-actions.test.cjs (after yarn build).
// Focused Sins native18 QH-action contracts: prerequisite, Vanescula ntch-j,
// long-vine 38004 use, valve 187:3 menu, enchant-ruby tablet.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    getFreeSlots: () => 28 - [...items.values()].filter(Boolean).length,
    get: slot => null,
    isFull: () => false,
  };
  const sender = new Proxy({}, { get: (_t, prop) => {
    if (prop === 'sendInterfaceScript') return (...args) => { log.push(['sendInterfaceScript', ...args]); return sender; };
    if (prop === 'sendClientScript') return (...args) => { log.push(['sendClientScript', ...args]); return sender; };
    if (prop === 'sendInterfaceFlagsRange') return (...args) => { log.push(['sendInterfaceFlagsRange', ...args]); return sender; };
    if (prop === 'sendSubInterface') return (...args) => { log.push(['sendSubInterface', ...args]); return sender; };
    if (prop === 'closeSubInterface') return (...args) => { log.push(['closeSubInterface', ...args]); return sender; };
    if (prop === 'sendCameraMoveTo') return (...args) => { log.push(['sendCameraMoveTo', ...args]); return sender; };
    if (prop === 'sendCameraLookAt') return (...args) => { log.push(['sendCameraLookAt', ...args]); return sender; };
    if (prop === 'sendCameraReset') return (...args) => { log.push(['sendCameraReset', ...args]); return sender; };
    return (...args) => { log.push([String(prop), ...args]); return sender; };
  }});
  return {
    attrs, items, messages, moves, log,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperience: noop }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop }),
    setInterfaceId: id => log.push(['setInterfaceId', id]),
    getLocation: () => new core.Location(0, 0, 0),
    moveTo: location => { moves.push([location.getX(), location.getY(), location.getZ()]); },
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
    isPlayer: () => true,
  };
}

function harness() {
  const hooks = {}, events = {}, namedObjects = new Map(), itemOnObject = [], itemOnItem = [];
  const interfaceButtons = [], interfaceClicks = [], npcs = [], objects = [];
  const api = new Proxy({
    core: {
      ...core,
      World: { ...core.World, getPlayers: () => [], getNpcs: () => npcs },
      TaskManager: { submit() {}, cancelTasks() {} },
      MapObjects: { get: () => null },
      ObjectManager: {
        register(object) { objects.push(object); },
        deregister(object) { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); },
      },
    },
    persistAttribute: noop,
    registerArea: noop,
    onNpcInteraction: noop,
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'function') (hooks.onObjectInteraction ??= []).push(target);
      else namedObjects.set(target, actions);
    },
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemOnItem: handler => itemOnItem.push(handler),
    onInterfaceActionButton: (buttonIds, handler) => interfaceButtons.push({ buttonIds: [].concat(buttonIds), handler }),
    onInterfaceActionClick: handler => interfaceClicks.push(handler),
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    spawnNpc: definition => {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        moveTo: noop, isRegistered: () => true, getOwner: () => definition.owner,
        getHitpoints: () => 1, setHitpoints: noop, getCombat: () => ({ reset: noop }),
      };
      npcs.push(npc);
      return npc;
    },
    removeNpc: noop,
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require('../plugins/quests/quests/SinsOfTheFather.Quest')(api);
  return { api, hooks, events, namedObjects, itemOnObject, itemOnItem, interfaceButtons, interfaceClicks, npcs, objects,
    quest: runtime.getRegisteredQuests().at(-1) };
}

function answerQuests(h, completed) {
  (h.events['quest:is-complete'] ??= []).push(request => {
    if (completed.has(request.key)) request.complete = true;
  });
}

test('Sins requires both Vampyre Slayer and A Taste of Hope through the normal start hook', () => {
  const h = harness();
  const p = makePlayer();
  answerQuests(h, new Set(['taste_of_hope']));
  h.quest.setStage(p, 0);
  const hook = { player: p, npcId: 5048, hook: 'quest:sins-of-the-father:start', handled: false };
  (h.events['npc-dialogue:hook'] ?? []).forEach(fn => fn(hook));
  assert.equal(h.quest.getStage(p), 0, 'missing Vampyre Slayer does not start Sins');
  assert.ok(p.messages.some(text => text.includes('Vampyre Slayer')), 'missing prerequisite is reported');
  answerQuests(h, new Set(['taste_of_hope', 'vampyre_slayer']));
  (h.events['npc-dialogue:hook'] ?? []).forEach(fn => fn(hook));
  assert.equal(h.quest.getStage(p), 2, 'both canonical prerequisites start Sins');
});

test('Sins canonical Vanescula ntch-j starts the fight and keeps Safalaan HgxSdS', () => {
  const h = harness();
  const p = makePlayer();
  p.items.set(24699, 1);
  h.quest.setStage(p, 126);
  const action = { player: p, npcId: 9574, stepId: 'ntch-j', handled: false };
  (h.events['npc-dialogue:action'] ?? []).forEach(fn => fn(action));
  assert.equal(h.quest.getStage(p), 130, 'Vanescula ready advances to the Castle stage');
  assert.deepEqual(p.moves.at(-1), [3565, 3362, 0], 'Vanescula ready lands on the arena tile');

  const q = makePlayer();
  q.items.set(24699, 1);
  h.quest.setStage(q, 126);
  const safalaan = { player: q, npcId: 8216, stepId: 'HgxSdS', handled: false };
  (h.events['npc-dialogue:action'] ?? []).forEach(fn => fn(safalaan));
  assert.equal(h.quest.getStage(q), 130, 'existing Safalaan entry is preserved');
  assert.deepEqual(q.moves.at(-1), [3565, 3362, 0]);

  const blocked = makePlayer();
  h.quest.setStage(blocked, 126);
  const early = { player: blocked, npcId: 9574, stepId: 'ntch-j', handled: false };
  (h.events['npc-dialogue:action'] ?? []).forEach(fn => fn(early));
  assert.equal(h.quest.getStage(blocked), 126, 'ntch-j without the flail cannot skip the gate');
});

test('Sins canonical long vine uses branch 38004 then swings 38005', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 36);
  p.attrs.set('quest.sins_of_the_father.bits', 0);
  p.items.set(7777, 1);
  const use = { player: p, itemId: 7777, objectId: 38004, handled: false };
  h.itemOnObject.forEach(fn => fn(use));
  assert.equal(use.handled, true);
  assert.equal(p.items.get(7777) ?? 0, 0, 'long vine is consumed by the branch');
  assert.equal(p.attrs.get('sins-of-the-father:vine-attached'), true);
  assert.ok(p.messages.some(text => text.includes('throw the vine up')), 'primary throw/wrap message');

  const swing = { player: p, objectId: 38005, handled: false };
  (h.hooks.onObjectInteraction ?? []).forEach(fn => fn(swing));
  assert.equal(swing.handled, true);
  assert.equal(p.attrs.get('quest.sins_of_the_father.bits') & (1 << 13), 1 << 13, 'swing sets BIT_TREK');
  assert.deepEqual(p.moves.at(-1), [3437, 3402, 0], 'swing lands on the captured crossing tile');
});

test('Sins valve Turn opens the 187:3 numeric menu and applies the chosen value', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 100);
  // required 7 gallons; north/south fields start at 0.
  p.attrs.set('quest.sins_of_the_father.bits', 7 << 26);
  const event = { player: p, objectId: 37997, handled: false };
  h.namedObjects.get('Valve').Turn(event);
  assert.equal(event.handled, true);
  const script = p.log.find(row => row[0] === 'sendClientScript' && row[1] === 217);
  assert.ok(script, 'script 217 is used');
  assert.equal(script[2], 'What would you like to set the valve to?');
  assert.equal(script[3], '0 (current)|1|2|3|4|5|(Cancel)');
  assert.ok(p.log.some(row => row[0] === 'sendInterfaceFlagsRange' && row[1] === ((187 << 16) | 3)));

  const click = h.interfaceClicks.at(-1);
  assert.ok(click, '187:3 native pause/button handler is registered through onInterfaceActionClick');
  assert.ok(!h.interfaceButtons.some(entry => entry.buttonIds.includes((187 << 16) | 3)), 'valve uses the native click path, not the filtered button hook');
  click({ player: p, buttonId: (187 << 16) | 3, groupId: 187, childId: 3, action: 1, handled: false });
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') >> 20) & 7, 1, 'north valve stores the chosen 1');
  assert.ok(p.messages.includes('You set the valve to 1.'));
  assert.ok(p.messages.includes("Water begins to flow through the arboretum's irrigation."));
  assert.ok(p.log.some(row => row[0] === 'setInterfaceId' && row[1] === -1), 'choice closes the active interface');

  // Cancel closes without changing the stored value.
  p.messages.length = 0;
  const cancelOpen = { player: p, objectId: 37997, handled: false };
  h.namedObjects.get('Valve').Turn(cancelOpen);
  click({ player: p, buttonId: (187 << 16) | 3, groupId: 187, childId: 3, action: 6, handled: false });
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') >> 20) & 7, 1, 'Cancel leaves the valve unchanged');
  assert.ok(!p.messages.some(text => text.includes('You set the valve to 6')), 'Cancel does not apply a value');
  assert.ok(p.log.some(row => row[0] === 'setInterfaceId' && row[1] === -1), 'Cancel closes the active interface');

  // Invalid choice is ignored without changing state or closing the pending menu.
  p.messages.length = 0;
  const invalidOpen = { player: p, objectId: 37997, handled: false };
  h.namedObjects.get('Valve').Turn(invalidOpen);
  const lastInterface = p.log.filter(row => row[0] === 'setInterfaceId').at(-1);
  click({ player: p, buttonId: (187 << 16) | 3, groupId: 187, childId: 3, action: 9, handled: false });
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') >> 20) & 7, 1, 'invalid choice leaves the valve unchanged');
  assert.ok(!p.messages.some(text => text.includes('You set the valve')), 'invalid choice sends no value message');
  assert.equal(p.log.filter(row => row[0] === 'setInterfaceId').at(-1), lastInterface, 'invalid choice does not close the menu');
});

test('Sins ruby sickle accepts the real Enchant ruby or topaz tablet', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 118);
  p.items.set(24693, 1);
  p.items.set(8018, 1);
  const event = { player: p, usedItemId: 24693, usedWithItemId: 8018, handled: false };
  h.itemOnItem.forEach(fn => fn(event));
  assert.equal(event.handled, true);
  assert.equal(p.items.get(24693) ?? 0, 0, 'ruby sickle consumed');
  assert.equal(p.items.get(8018) ?? 0, 0, 'tablet consumed');
  assert.equal(p.items.get(24695), 1, 'enchanted ruby sickle produced');
  assert.ok(p.messages.includes('You enchant the ruby sickle.'));
});
