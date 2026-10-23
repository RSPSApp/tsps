// From server/: node --test tests/remaining-elid-plinth-parity.test.cjs
// Cache-backed check that the Elidinis plinth is the real map multiloc 10389 at
// (3426,2930), transformed by stage varbit 1444 (55 -> 10438, 60 -> 10439).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const runtime = require('../plugins/quests/QuestRuntime');

runtime.startTranscript = () => true;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function setup() {
  const hooks = { itemOnObject: [], objects: [], login: [], custom: new Map() };
  const registrations = [];
  const core = {
    ...PluginManager.getCoreApi(),
    ObjectManager: {
      register(object) { registrations.push({ id: object.getId?.() ?? object.id, x: object.getLocation?.().getX?.(), y: object.getLocation?.().getY?.() }); },
      deregister() {},
    },
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getWorld: () => ({ getNpcs: () => [] }),
    getItemOnGroundManager: () => ({ getGroundItem: () => null, registerLocation() {} }),
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onObjectInteraction(target, actions) {
      if (typeof target === 'function') hooks.objects.push(target);
      else hooks.objects.push(...Object.values(actions ?? {}));
    },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/SpiritsOfTheElid.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), xp = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'elid-plinth-test',
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender,
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      isFull: () => false,
      getFreeSlots: () => 28,
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: () => 99, getMaxLevel: () => 99,
      setCurrentLevels() {}, updateSkill() {},
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => new core.Location(3426, 2930, 0),
    moveTo() {},
    getPrivateArea: () => null,
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues() {} }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    performAnimation() {},
    sendMessage() {},
    isPlayer: () => true,
    isRegistered: () => true,
  };
  const login = () => { for (const fn of hooks.login) fn({ player }); };
  const itemOnObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    for (const fn of hooks.itemOnObject) fn(event);
    return event;
  };
  const pray = (objectId) => {
    const event = { player, objectId, clickType: 1, definition: { getActions: () => ['Pray-at'] }, handled: false };
    for (const fn of hooks.objects) fn(event);
    return event;
  };
  const complete = () => api.emitCustomEvent('npc-dialogue:action', { player, stepId: 'G39MGw' });
  return { core, quest, player, attrs, inventory, varbits, xp, registrations, login, itemOnObject, pray, complete };
}

test('Elidinis plinth is the native 10389 map object and completion keeps the native transform', () => {
  const loc = CacheDefinitions.getObject(10389);
  assert.equal(loc?.transformVarbit, 1444, '10389 is the stage-driven native multiloc');
  assert.equal(loc?.transforms?.[55], 10438, 'stage 55 resolves to the plinth');
  assert.equal(loc?.transforms?.[60], 10439, 'stage 60 resolves to the placed statuette');
  assert.equal(CacheDefinitions.getObject(10439)?.actions?.filter(Boolean).includes('Pray-at'), true);

  const h = setup();
  const I = h.core.ItemIdentifiers;
  assert.equal(h.registrations.some((entry) => entry.id === 10438 || entry.id === 10439), false,
    'no displaced manual shrine object is placed at bootstrap');

  h.quest.setStage(h.player, 55);
  h.login();
  assert.equal(h.registrations.some((entry) => entry.id === 10438 || entry.id === 10439), false,
    'login does not place a manual shrine object');
  h.inventory.set(I.STATUETTE_2, 1);
  const use = h.itemOnObject(I.STATUETTE_2, 10389);
  assert.equal(use.handled, true);
  assert.equal(h.inventory.get(I.STATUETTE_2), 0, 'native map parent accepts the statuette');
  h.complete();
  assert.equal(h.quest.getStage(h.player), 60);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.xp.length, 3, 'rewards are granted once');
  assert.equal(h.registrations.some((entry) => entry.id === 10438 || entry.id === 10439), false,
    'completion relies on the native transform, not a manual object');

  const prayers = h.pray(10389);
  assert.equal(prayers.handled, true, 'the native parent remains prayable after completion');
  assert.equal(h.quest.getStage(h.player), 60, 'prayer never advances or repeats the quest');

  const xpCount = h.xp.length;
  h.varbits.clear();
  h.login();
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.xp.length, xpCount, 'relogin does not replay rewards');
  assert.equal(h.registrations.some((entry) => entry.id === 10438 || entry.id === 10439), false,
    'relogin does not restore the old manual placement');

  const child = setup();
  const childI = child.core.ItemIdentifiers;
  child.quest.setStage(child.player, 55);
  child.inventory.set(childI.STATUETTE_2, 1);
  assert.equal(child.itemOnObject(childI.STATUETTE_2, 10438).handled, true,
    'the real resolved child id remains usable');
  assert.equal(child.inventory.get(childI.STATUETTE_2), 0);
});
