// Run after `yarn build`: node --test tests/restless-ghost.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');

const RESTLESS_GHOST = 922;
const FATHER_URHNEY = 923;
const COFFIN_CLOSED = 2145;
const COFFIN_OPEN = 15052;
const GHOSTS_SKULL = 553;
const TASK_LINE = 'Ok. I will try and get the skull back for you, then you can rest in peace.';

const noop = () => {};

function registerRestlessGhost() {
  const customEvents = {};
  const spawned = [];
  const removed = [];
  const objectClicks = new Map();
  let itemOnObject;
  let logoutHandler;
  const api = {
    core: PluginManager.getCoreApi(),
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: noop,
    onCustomEvent: (name, handler) => { (customEvents[name] ??= []).push(handler); },
    onObjectFirstClick: (ids, handler) => { for (const id of [].concat(ids)) objectClicks.set(id, handler); },
    onObjectSecondClick: noop,
    onItemOnObject: (handler) => { itemOnObject = handler; },
    onItemOnNpc: noop,
    onInterfaceActionButton: noop,
    onPlayerLogin: noop,
    onPlayerLogout: (handler) => { logoutHandler = handler; },
    persistAttribute: noop,
    spawnNpc: (definition) => { const npc = { definition }; spawned.push(npc); return npc; },
    removeNpc: (npc) => removed.push(npc),
  };
  require('../plugins/quests/quests/RestlessGhost.Quest')(api);
  const quest = getRegisteredQuests().find((q) => q.key === 'the_restless_ghost');
  return { quest, customEvents, spawned, removed, objectClicks, itemOnObject, logoutHandler };
}

function player() {
  const attributes = new Map();
  const inventory = new Map();
  const packet = new Proxy({}, { get: () => () => packet });
  return {
    inventory,
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
    getSkillManager: () => ({ addExperiences: noop }),
    sendMessage: noop,
  };
}

function coffinObject(id) {
  const { GameObject, Location } = PluginManager.getCoreApi();
  return new GameObject(id, new Location(3249, 3192, 0), 10, 0, null);
}

test('opening or searching the coffin raises one owner-only ghost', () => {
  const { quest, objectClicks, spawned, removed, logoutHandler } = registerRestlessGhost();

  const p = player();
  objectClicks.get(COFFIN_CLOSED)({ player: p, object: coffinObject(COFFIN_CLOSED) });
  assert.equal(spawned.length, 1, 'opening the coffin raises the ghost');
  assert.equal(spawned[0].definition.id, RESTLESS_GHOST);
  assert.equal(spawned[0].definition.owner, p);
  assert.equal(spawned[0].definition.ownerOnly, true);

  objectClicks.get(COFFIN_OPEN)({ player: p });
  assert.equal(spawned.length, 1, 'searching the open coffin must not spawn a second ghost');

  logoutHandler({ player: p });
  assert.deepEqual(removed, [spawned[0]], 'the private ghost is dropped on logout');
  objectClicks.get(COFFIN_OPEN)({ player: p });
  assert.equal(spawned.length, 2, 'the ghost rises again when the player comes back');

  const done = player();
  quest.setStage(done, 5);
  objectClicks.get(COFFIN_OPEN)({ player: done });
  assert.equal(spawned.length, 2, 'completed players get no ghost');
});

test('accepting the skull task advances only the spoken-to-ghost stage', () => {
  const { quest, customEvents } = registerRestlessGhost();
  const handler = customEvents['npc-dialogue:line'][0];
  const choiceHandler = customEvents['npc-dialogue:choice'][0];

  const p = player();
  quest.setStage(p, 2);
  handler({ npcId: RESTLESS_GHOST, player: p, text: TASK_LINE });
  assert.equal(quest.getStage(p), 3);

  handler({ npcId: RESTLESS_GHOST, player: p, text: TASK_LINE });
  assert.equal(quest.getStage(p), 3, 'a replay must not move the stage again');

  // The other two conversation branches commit through these nested choices.
  const nested = player();
  quest.setStage(nested, 2);
  choiceHandler({ npcId: RESTLESS_GHOST, player: nested, option: "Yes, ok. Do you know why you're a ghost?" });
  assert.equal(quest.getStage(nested), 3);

  const early = player();
  quest.setStage(early, 1);
  handler({ npcId: RESTLESS_GHOST, player: early, text: TASK_LINE });
  assert.equal(quest.getStage(early), 1, 'only the amulet conversation advances the stage');

  handler({ npcId: FATHER_URHNEY, player: early, text: TASK_LINE });
  assert.equal(quest.getStage(early), 1, 'another NPC saying the line is ignored');

  choiceHandler({ npcId: FATHER_URHNEY, player: early, option: "Yes, ok. Do you know why you're a ghost?" });
  assert.equal(quest.getStage(early), 1, 'another NPC using the choice is ignored');
});

test('returning the skull removes the ghost and completes the quest', () => {
  const { quest, objectClicks, itemOnObject, spawned, removed } = registerRestlessGhost();

  const p = player();
  quest.setStage(p, 4);
  p.inventory.set(GHOSTS_SKULL, 1);
  objectClicks.get(COFFIN_OPEN)({ player: p });
  assert.equal(spawned.length, 1);

  itemOnObject({
    player: p,
    itemId: GHOSTS_SKULL,
    objectId: COFFIN_OPEN,
    object: coffinObject(COFFIN_OPEN),
    handled: false,
  });

  assert.equal(quest.getStage(p), 5);
  assert.deepEqual(removed, [spawned[0]], 'the ghost vanishes with the completed quest');
});
