// Run after `yarn build`: node --test tests/slayer-assign.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Skill } = require('../dist/game/model/Skill');
const Slayer = require('../plugins/skills/Slayer.plugin');
const { assignTask, getActiveTask } = Slayer;

const MASTER = {
  id: 7663,
  name: 'Krystilia',
  tasks: [{ slug: 'goblin', name: 'Goblin', quantity: [3, 3], slayer_level: 0, weight: 1, npc_names: ['goblin'] }],
};

function fakePlayer(attributes = {}) {
  const store = new Map(Object.entries(attributes));
  const dialogues = [];
  return {
    dialogues,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    getSkillManager: () => ({ getMaxLevel: (skill) => (skill === Skill.SLAYER ? 99 : 1) }),
    getDialogueManager: () => ({ startDialogues: (builder) => dialogues.push(builder) }),
  };
}

// The NPC line the plugin last spoke.
function spokenLine(player) {
  const builder = player.dialogues.at(-1);
  return builder?.getDialogues?.().get(0)?.text;
}

function captureApi() {
  const api = { log() {}, onNpcDeath() {}, persisted: [], events: {} };
  Slayer.register({
    ...api,
    persistAttribute: (key) => api.persisted.push(key),
    onNpcInteraction: (handler) => { api.npcClick = handler; },
    onCustomEvent: (name, handler) => { api.events[name] = handler; },
  });
  return api;
}

test('a new assignment is stored as a persisted attribute snapshot', () => {
  const player = fakePlayer();
  assert.match(assignTask(player, MASTER), /Your new task is to kill 3 goblin\./);
  assert.deepEqual(player.getAttribute('slayer:task'), {
    masterId: 7663,
    slug: 'goblin',
    remaining: 3,
  });
});

test('a snapshot rebuilds the active task from the dump', () => {
  const player = fakePlayer({ 'slayer:task': { masterId: 7663, slug: 'ankou', remaining: 4 } });
  const task = getActiveTask(player);
  assert.equal(task.getTask().toString(), 'ankou');
  assert.equal(task.getRemaining(), 4);
});

test('an existing assignment is reported, not replaced', () => {
  const snapshot = { masterId: 7663, slug: 'ankou', remaining: 7 };
  const player = fakePlayer({ 'slayer:task': snapshot });
  assert.match(assignTask(player, MASTER), /still hunting ankou; you have 7 to go\. Come back when you've finished your task\./);
  assert.equal(player.getAttribute('slayer:task'), snapshot);
});

test('an abandoned assignment snapshot does not resurrect', () => {
  const player = fakePlayer({ 'slayer:task': { masterId: 7663, slug: 'gone', remaining: 5 } });
  assert.equal(getActiveTask(player), null);
});

test('the Assignment click is wired for any slayer master npc', () => {
  const api = captureApi();
  assert.equal(typeof api.npcClick, 'function');
  assert.deepEqual(api.persisted, ['slayer:task', 'slayer:points', 'slayer:streak']);

  // Krystilia (7663) is in the task dump; 999 is not a master.
  const master = fakePlayer();
  const masterEvent = { player: master, npcId: 7663, clickType: 3, handled: false };
  api.npcClick(masterEvent);
  assert.equal(masterEvent.handled, true);
  assert.match(spokenLine(master), /Your new task is to kill/);

  const outsider = fakePlayer();
  const outsiderEvent = { player: outsider, npcId: 999, clickType: 3, handled: false };
  api.npcClick(outsiderEvent);
  assert.equal(outsiderEvent.handled, false);
  assert.equal(outsider.getAttribute('slayer:task'), undefined);
});

test('the Assignment click speaks the current task as a dialogue', () => {
  const api = captureApi();
  const player = fakePlayer({ 'slayer:task': { masterId: 7663, slug: 'ankou', remaining: 7 } });
  const event = { player, npcId: 7663, clickType: 3, handled: false };
  api.npcClick(event);
  assert.equal(event.handled, true);
  assert.match(spokenLine(player), /still hunting ankou; you have 7 to go\. Come back when you've finished your task\./);
});

test('Nieve assigns from her transformed definition, not her spawn id', () => {
  const api = captureApi();
  // Spawn 1455 transforms to 7108; only the latter is in the task dump.
  const player = fakePlayer();
  api.npcClick({ player, npcId: 1455, definition: { getId: () => 7108 }, clickType: 3, handled: false });
  assert.match(spokenLine(player), /Your new task is to kill/);
});

test('a different labelled slot is not treated as Assignment', () => {
  const api = captureApi();
  const player = fakePlayer();
  const event = { player, npcId: 7663, definition: { getActions: () => [null, null, 'Trade'] }, clickType: 3, handled: false };
  api.npcClick(event);
  assert.equal(event.handled, false);
  assert.equal(player.dialogues.length, 0);
});

test('the assignment event fills the line and ignores non-masters', () => {
  const api = captureApi();
  const request = { player: fakePlayer(), npcId: 7663, line: null };
  api.events['slayer:assignment'](request);
  assert.match(request.line, /Your new task is to kill/);

  // Nieve's spawn (1455) transforms to 7108; neither is the master lookup id.
  const nieve = { player: fakePlayer(), npcId: 1455, definitionId: 7108, npcName: 'Nieve', line: null };
  api.events['slayer:assignment'](nieve);
  assert.match(nieve.line, /Your new task is to kill/);

  // The exporter slugs the master name, so runtime ids are only a fallback.
  const slugged = { player: fakePlayer(), master: 'Nieve', npcId: 0, line: null };
  api.events['slayer:assignment'](slugged);
  assert.match(slugged.line, /Your new task is to kill/);

  const outsider = { player: fakePlayer(), npcId: 999, line: null };
  api.events['slayer:assignment'](outsider);
  assert.equal(outsider.line, null);
});

test('the task-tip event reports the active task location', () => {
  const api = captureApi();
  const tasked = { player: fakePlayer({ 'slayer:task': { masterId: 7663, slug: 'ankou', remaining: 4 } }), line: null };
  api.events['slayer:task-tip'](tasked);
  assert.match(tasked.line, /find your task at/);

  const none = { player: fakePlayer(), line: null };
  api.events['slayer:task-tip'](none);
  assert.equal(none.line, null);
});
