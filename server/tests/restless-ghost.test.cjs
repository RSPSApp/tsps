// Run after `yarn build`: node --test tests/restless-ghost.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
// Quest stage updates render cache-backed quest-list metadata. Keep one live store
// for the whole file so cached definitions and RegionManager share its lifetime.
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');

const RESTLESS_GHOST = 922;
const FATHER_URHNEY = 923;
const COFFIN_CLOSED = 2145;
const COFFIN_OPEN = 15052;
const GHOSTS_SKULL = 553;
const TASK_LINE = 'Ooh, thank you. That would be such a great relief!';

const noop = () => {};

function registerRestlessGhost() {
  const customEvents = {};
  const spawned = [];
  const removed = [];
  const objectClicks = new Map();
  let itemOnObject;
  let logoutHandler;
  const tasks = [];
  const api = {
    core: { ...PluginManager.getCoreApi(), TaskManager: {
      submit: task => { task.setRunning(true); tasks.push(task); },
      cancelTasks: key => tasks.filter(task => task.key === key).forEach(task => task.stop()),
    }, ObjectManager: { register: noop, deregister: noop } },
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: noop,
    onCustomEvent: (name, handler) => { (customEvents[name] ??= []).push(handler); },
    onObjectFirstClick: (ids, handler) => { for (const id of [].concat(ids)) objectClicks.set(id, handler); },
    onObjectSecondClick: noop,
    onItemOnObject: (handler) => { itemOnObject = handler; },
    onItemOnNpc: noop,
    onItemAction: noop,
    onItemDropPolicy: noop,
    onInterfaceActionButton: noop,
    onPlayerLogin: noop,
    onPlayerLogout: (handler) => { logoutHandler = handler; },
    persistAttribute: noop,
    spawnNpc: (definition) => { const npc = { definition, performAnimation: noop }; spawned.push(npc); return npc; },
    removeNpc: (npc) => removed.push(npc),
  };
  require('../plugins/quests/quests/RestlessGhost.Quest')(api);
  const quest = getRegisteredQuests().find((q) => q.key === 'the_restless_ghost');
  return { quest, customEvents, spawned, removed, objectClicks, itemOnObject, logoutHandler,
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); } };
}

function player() {
  const attributes = new Map();
  const inventory = new Map();
  const packet = new Proxy({}, { get: () => () => packet });
  return {
    inventory,
    isRegistered: () => true,
    getMovementQueue: () => ({ setBlockMovement() { return this; } }),
    performAnimation: noop,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) + amount),
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)),
      isFull: () => false,
    }),
    getEquipment: () => ({ get: () => undefined }),
    getPacketSender: () => packet,
    getDialogueManager: () => ({ startDialogues: noop }),
    getSkillManager: () => ({ addExperiences: noop }),
    sendMessage: noop,
  };
}

function coffinObject(id) {
  const { GameObject, Location } = PluginManager.getCoreApi();
  return new GameObject(id, new Location(3249, 3192, 0), 10, 0, null);
}

test('opening or searching the coffin raises one owner-only ghost', () => {
  const { quest, objectClicks, spawned, removed, logoutHandler, tick } = registerRestlessGhost();

  const p = player();
  objectClicks.get(COFFIN_CLOSED)({ player: p, object: coffinObject(COFFIN_CLOSED) });
  assert.equal(spawned.length, 0, 'the ghost waits for the coffin opening animation');
  tick(4);
  assert.equal(spawned.length, 1, 'opening the coffin raises the ghost after four ticks');
  assert.equal(spawned[0].definition.id, RESTLESS_GHOST);
  assert.equal(spawned[0].definition.owner, p);
  assert.equal(spawned[0].definition.ownerOnly, true);

  objectClicks.get(COFFIN_OPEN)({ player: p, object: coffinObject(COFFIN_OPEN) });
  assert.equal(spawned.length, 1, 'searching the open coffin must not spawn a second ghost');

  logoutHandler({ player: p, object: coffinObject(COFFIN_OPEN) });
  assert.deepEqual(removed, [spawned[0]], 'the private ghost is dropped on logout');
  objectClicks.get(COFFIN_OPEN)({ player: p, object: coffinObject(COFFIN_OPEN) });
  assert.equal(spawned.length, 2, 'the ghost rises again when the player comes back');

  const done = player();
  quest.setStage(done, 5);
  objectClicks.get(COFFIN_OPEN)({ player: done, object: coffinObject(COFFIN_OPEN) });
  assert.equal(spawned.length, 2, 'completed players get no ghost');
});

test('the skull explanation advances only after the final ghost response is continued', () => {
  const { quest, customEvents } = registerRestlessGhost();
  const handler = customEvents['npc-dialogue:line'][0];
  const p = player(); quest.setStage(p, 2);
  const event = { npcId: RESTLESS_GHOST, player: p, text: TASK_LINE };
  handler(event); assert.equal(quest.getStage(p), 2); event.after(); assert.equal(quest.getStage(p), 3);
  event.after(); assert.equal(quest.getStage(p), 3, 'a replay must not move the stage again');
  const early = player(); quest.setStage(early, 1);
  const earlyEvent = { npcId: RESTLESS_GHOST, player: early, text: TASK_LINE };
  handler(earlyEvent); earlyEvent.after(); assert.equal(quest.getStage(early), 1);
  const other = { npcId: FATHER_URHNEY, player: early, text: TASK_LINE };
  handler(other); assert.equal(other.after, undefined);
});

test('returning the skull removes the ghost and saves the pending river scene', () => {
  const { quest, objectClicks, itemOnObject, spawned, removed } = registerRestlessGhost();

  const p = player();
  quest.setStage(p, 4);
  p.inventory.set(GHOSTS_SKULL, 1);
  objectClicks.get(COFFIN_OPEN)({ player: p, object: coffinObject(COFFIN_OPEN) });
  assert.equal(spawned.length, 1);

  itemOnObject({
    player: p,
    itemId: GHOSTS_SKULL,
    objectId: COFFIN_OPEN,
    object: coffinObject(COFFIN_OPEN),
    handled: false,
  });

  assert.equal(quest.getStage(p), 4, 'rewards wait for the river scene');
  assert.equal(p.getAttribute('restless-ghost:release-pending'), 1);
  assert.equal(p.inventory.get(GHOSTS_SKULL), 0);
  assert.deepEqual(removed, [spawned[0]], 'the field ghost is removed before the private scene');
});
