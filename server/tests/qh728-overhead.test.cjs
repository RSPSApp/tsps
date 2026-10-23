const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});

const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');

const core = PluginManager.getCoreApi();
let turn = 0;

afterEach(() => {
  TaskManager.pendingTasks.clear();
  TaskManager.activeTasks.length = 0;
  turn = 0;
});

function createPlayer(log, options = {}) {
  const player = {
    location: options.location ?? new Location(3200, 3200, 0),
    localNpcs: options.localNpcs ?? [],
    area: options.area ?? null,
    registered: true,
    removals: 0,
    messages: [],
    sent: [],
    getUsername: () => 'Tester',
    getAppearance: () => ({ isMale: () => true }),
    getLocation() { return this.location; },
    getPrivateArea() { return this.area; },
    getLocalNpcs() { return this.localNpcs; },
    isRegistered() { return this.registered; },
    forceChat(text) { log.push({ actor: this, text, turn }); },
    sendMessage(text) { this.messages.push(text); },
    getDialogueManager() { return this.manager; },
    getPacketSender() { return this.sender; },
  };
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => {
      player.sent.push([key, ...args]);
      if (key === 'sendInterfaceRemoval') player.removals++;
      return sender;
    },
  });
  player.sender = sender;
  player.manager = new DialogueManager(player);
  return player;
}

function createNpc(log, options) {
  const npc = {
    name: options.name,
    index: options.index ?? 0,
    registered: options.registered ?? true,
    visible: options.visible ?? true,
    ownerOnly: options.ownerOnly ?? false,
    area: options.area ?? null,
    owner: options.owner ?? null,
    location: new Location(options.x, options.y, options.z ?? 0),
    baseName: options.baseName ?? options.name,
    currentName: options.currentName ?? options.name,
    definitionPlayer: undefined,
    getCurrentDefinition(player) {
      this.definitionPlayer = player;
      return { getName: () => this.currentName };
    },
    getDefinition: () => ({ getName: () => npc.baseName }),
    getLocation() { return this.location; },
    getPrivateArea() { return this.area; },
    getOwner() { return this.owner; },
    isOwnerOnly() { return this.ownerOnly; },
    isRegistered() { return this.registered; },
    isVisible() { return this.visible; },
    getIndex() { return this.index; },
    forceChat(text) { log.push({ actor: this, text, turn }); },
  };
  return npc;
}

function definition(name, id = 100) {
  return { getName: () => name, getId: () => id };
}

function advanceTicks(count) {
  for (let i = 0; i < count; i++) {
    turn++;
    TaskManager.process();
  }
}

function play(player, npc, def, steps, onLine = () => {}) {
  const actions = [];
  const api = {
    core,
    emitCustomEvent(name, request) {
      if (name === 'npc-dialogue:line') onLine(request);
      if (name === 'npc-dialogue:action') actions.push(request);
    },
    sendMultiChatboxPrompt() { return true; },
  };
  const event = { player, npc, npcId: def.getId(), definition: def };
  startDialogue(api, event, steps, {}, { player, npc, npcId: def.getId(), definition: def, pages: [] });
  return actions;
}

test('compact player/current NPC and typed nearest third actor force-chat in source order, chatbox lines stay unchanged', () => {
  const log = [];
  const currentName = 'Current NPC';
  const current = createNpc(log, { name: currentName, x: 3201, y: 3200, index: 30 });
  const nearest = createNpc(log, { name: 'Third', x: 3200, y: 3201, index: 10 });
  const sameDistance = createNpc(log, { name: 'Third', x: 3199, y: 3200, index: 20 });
  const further = createNpc(log, { name: 'Third', x: 3203, y: 3200, index: 1 });
  const wrongPlane = createNpc(log, { name: 'Third', x: 3200, y: 3200, z: 1, index: 2 });
  const unregistered = createNpc(log, { name: 'Third', x: 3200, y: 3200, registered: false, index: 3 });
  const otherOwner = createNpc(log, { name: 'Third', x: 3210, y: 3200, owner: {}, index: 4 });
  const player = createPlayer(log, { localNpcs: [current, wrongPlane, unregistered, otherOwner, nearest, sameDistance, further] });
  const steps = [
    { npc: 'Current NPC overhead', presentation: 'overhead' },
    { player: 'Player overhead', presentation: 'overhead' },
    { type: 'line', speaker: 'Third', text: 'Third overhead', presentation: 'overhead' },
    { npc: 'Chatbox line' },
  ];
  play(player, current, definition(currentName), steps, (request) => {
    if (request.text === 'Chatbox line') request.speakerName = currentName;
  });

  assert.deepEqual(log.map(({ actor, text, turn }) => [turn, actor.name ?? 'player', text]), [
    [0, currentName, 'Current NPC overhead'],
  ]);
  advanceTicks(1);
  assert.equal(log.length, 1);
  advanceTicks(1);
  assert.deepEqual(log.slice(1).map(({ actor, text, turn }) => [turn, actor.name ?? 'player', text]), [
    [2, 'player', 'Player overhead'],
  ]);
  advanceTicks(2);
  assert.deepEqual(log.slice(2).map(({ actor, text, turn }) => [turn, actor.name ?? 'player', text]), [
    [4, 'Third', 'Third overhead'],
  ]);
  assert.equal(log[2].actor, nearest, 'equidistant matches break ties by lowest index');

  advanceTicks(2);
  assert.equal(log.length, 3, 'the final chatbox line is not overhead speech');
  assert.ok(player.manager.getCurrent() instanceof NpcDialogue);
  assert.equal(player.manager.getCurrent().getText(), 'Chatbox line');
});

test('overhead before and after each run once, in order around the forced chat', () => {
  const log = [];
  const order = [];
  const player = createPlayer(log);
  const def = definition('Speaker');
  play(player, createNpc(log, { name: 'Speaker', x: 3201, y: 3200 }), def, [
    { player: 'One', presentation: 'overhead' },
    { player: 'Two', presentation: 'overhead' },
  ], (request) => {
    request.before = () => order.push(`before:${request.text}`);
    request.after = () => order.push(`after:${request.text}`);
  });
  advanceTicks(4);

  assert.deepEqual(order, [
    'before:One', 'after:One',
    'before:Two', 'after:Two',
  ]);
  assert.deepEqual(log.map(({ text, turn }) => [turn, text]), [[0, 'One'], [2, 'Two']]);
});

test('a missing third actor runs before, then uses unavailable without after or the completion tail', () => {
  const log = [];
  let after = 0;
  let before = 0;
  const player = createPlayer(log);
  const def = definition('Speaker');
  const actions = play(player, createNpc(log, { name: 'Speaker', x: 3201, y: 3200 }), def, [
    { type: 'line', speaker: 'Absent ghost', text: 'Boo', presentation: 'overhead' },
    { type: 'action', id: 'reward', text: 'You win' },
    { npc: 'Completion tail' },
  ], (request) => {
    request.before = () => before++;
    request.after = () => after++;
  });

  assert.equal(log.length, 0);
  assert.equal(before, 1, 'before has already set up the scene when the actor is resolved');
  assert.equal(after, 0);
  assert.deepEqual(actions, []);
  assert.equal(player.removals, 1);
  assert.equal(player.manager.getCurrent(), undefined);
  assert.deepEqual(player.messages, ["That conversation isn't available right now."]);
});

test('ordinary speech before a missing overhead actor is preserved until its action is reached', () => {
  const log = [];
  let before = 0;
  let after = 0;
  const player = createPlayer(log);
  const def = definition('Speaker');
  play(player, createNpc(log, { name: 'Speaker', x: 3201, y: 3200 }), def, [
    { npc: 'Ordinary line' },
    { type: 'line', speaker: 'Absent ghost', text: 'Boo', presentation: 'overhead' },
    { npc: 'Completion tail' },
  ], (request) => {
    if (request.text === 'Ordinary line') request.speakerName = 'Speaker';
    if (request.text === 'Boo') {
      request.before = () => before++;
      request.after = () => after++;
    }
  });

  assert.ok(player.manager.getCurrent() instanceof NpcDialogue);
  assert.equal(player.manager.getCurrent().getText(), 'Ordinary line');
  assert.equal(before, 0);
  assert.equal(log.length, 0);

  player.manager.advance();
  assert.equal(before, 1);
  assert.equal(after, 0);
  assert.equal(log.length, 0);
  assert.equal(player.manager.getCurrent(), undefined);
});

test('a stale, hidden, remote or wrong-name event.npc falls back to the exact visible local actor', () => {
  const cases = [
    ['stale', { registered: false }, true],
    ['hidden', { visible: false }, true],
    ['remote', {}, false],
    ['wrong-name', { currentName: 'Imposter' }, true],
  ];
  for (const [label, invalidOptions, local] of cases) {
    const log = [];
    const valid = createNpc(log, { name: 'Speaker', x: 3201, y: 3200, index: 2 });
    const invalid = createNpc(log, { name: 'Speaker', x: 3200, y: 3200, index: 1, ...invalidOptions });
    const player = createPlayer(log, { localNpcs: local ? [invalid, valid] : [valid] });
    play(player, invalid, definition('Speaker'), [
      { npc: 'Hello', presentation: 'overhead' },
    ]);
    assert.deepEqual(log.map(({ actor }) => actor), [valid], label);
    advanceTicks(2);
    assert.equal(player.manager.getCurrent(), undefined, `${label} completes through the close path`);
  }
});

test('an omitted event.npc resolves the exact registered visible local speaker', () => {
  const log = [];
  const hidden = createNpc(log, { name: 'Speaker', x: 3200, y: 3200, visible: false, index: 1 });
  const actor = createNpc(log, { name: 'Speaker', x: 3202, y: 3200, index: 2 });
  const player = createPlayer(log, { localNpcs: [hidden, actor] });
  play(player, undefined, definition('Speaker'), [
    { npc: 'Hello', presentation: 'overhead' },
  ]);

  assert.deepEqual(log.map(({ actor: speaker }) => speaker), [actor]);
  advanceTicks(2);
  assert.equal(player.manager.getCurrent(), undefined, 'the final overhead leaves no active ActionDialogue');
});

test('public combat-owned NPCs stay visible while foreign owner-only NPCs are rejected', () => {
  const def = definition('Speaker');

  const publicLog = [];
  const publicNpc = createNpc(publicLog, { name: 'Speaker', x: 3201, y: 3200, owner: {}, index: 2 });
  const publicPlayer = createPlayer(publicLog, { localNpcs: [publicNpc] });
  play(publicPlayer, publicNpc, def, [{ npc: 'Hello', presentation: 'overhead' }]);
  assert.deepEqual(publicLog.map(({ actor }) => actor), [publicNpc]);

  const fallbackLog = [];
  const ownerOnly = createNpc(fallbackLog, { name: 'Speaker', x: 3200, y: 3200, owner: {}, ownerOnly: true, index: 1 });
  const fallback = createNpc(fallbackLog, { name: 'Speaker', x: 3203, y: 3200, index: 2 });
  const fallbackPlayer = createPlayer(fallbackLog, { localNpcs: [ownerOnly, fallback] });
  play(fallbackPlayer, ownerOnly, def, [{ npc: 'Hello', presentation: 'overhead' }]);
  assert.deepEqual(fallbackLog.map(({ actor }) => actor), [fallback]);

  const missingLog = [];
  const foreign = createNpc(missingLog, { name: 'Speaker', x: 3200, y: 3200, owner: {}, ownerOnly: true, index: 1 });
  const missingPlayer = createPlayer(missingLog, { localNpcs: [foreign] });
  play(missingPlayer, foreign, def, [{ npc: 'Hello', presentation: 'overhead' }, { npc: 'Tail' }]);
  assert.deepEqual(missingLog, []);
  assert.equal(missingPlayer.manager.getCurrent(), undefined);
});

test('actor names resolve through getCurrentDefinition(player), not the base definition', () => {
  const log = [];
  const actor = createNpc(log, {
    name: 'Base', baseName: 'Base', currentName: 'Transformed', x: 3201, y: 3200, index: 2,
  });
  const decoy = createNpc(log, {
    name: 'Other', baseName: 'Transformed', currentName: 'Other', x: 3200, y: 3200, index: 1,
  });
  const player = createPlayer(log, { localNpcs: [decoy, actor] });
  play(player, undefined, definition('Transformed'), [
    { type: 'line', speaker: 'Transformed', text: 'Hello', presentation: 'overhead' },
  ]);

  assert.deepEqual(log.map(({ actor: speaker }) => speaker), [actor]);
  assert.equal(actor.definitionPlayer, player, 'the per-player transform API receives the player');
});

test('actor resolution happens after before, so before can spawn the local actor', () => {
  const log = [];
  const actor = createNpc(log, { name: 'Speaker', x: 3201, y: 3200, index: 2 });
  const player = createPlayer(log);
  play(player, undefined, definition('Speaker'), [
    { type: 'line', speaker: 'Speaker', text: 'Spawned', presentation: 'overhead' },
  ], (request) => {
    if (request.text === 'Spawned') request.before = () => { player.localNpcs.push(actor); };
  });

  assert.deepEqual(log.map(({ actor: speaker }) => speaker), [actor]);
  assert.equal(actor.definitionPlayer, player);
  advanceTicks(2);
  assert.equal(player.manager.getCurrent(), undefined);
});

test('a skipped overhead source line stays skipped and does not delay the next line', () => {
  const log = [];
  const player = createPlayer(log);
  const def = definition('Speaker');
  play(player, createNpc(log, { name: 'Speaker', x: 3201, y: 3200 }), def, [
    { player: 'Skip me', presentation: 'overhead' },
    { player: 'Keep me', presentation: 'overhead' },
  ], (request) => {
    if (request.text === 'Skip me') request.skip = true;
  });

  assert.deepEqual(log.map(({ text, turn }) => [turn, text]), [[0, 'Keep me']]);
});

test('replaced or cancelled dialogues never run the delayed after or continuation', () => {
  const def = definition('Speaker');
  const npc = createNpc([], { name: 'Speaker', x: 3201, y: 3200 });
  const replacement = new DialogueChainBuilder().add(new ActionDialogue(0, { execute() {} }));
  const steps = [
    { player: 'First', presentation: 'overhead' },
    { player: 'Second', presentation: 'overhead' },
    { npc: 'Tail' },
  ];

  const replacedLog = [];
  let replacedAfter = 0;
  const replacedPlayer = createPlayer(replacedLog, { localNpcs: [npc] });
  play(replacedPlayer, npc, def, steps, (request) => { request.after = () => replacedAfter++; });
  replacedPlayer.manager.startDialogues(replacement);
  advanceTicks(4);
  assert.deepEqual(replacedLog.map(({ text }) => text), ['First']);
  assert.equal(replacedAfter, 0);

  const cancelledLog = [];
  let cancelledAfter = 0;
  const cancelledPlayer = createPlayer(cancelledLog, { localNpcs: [npc] });
  play(cancelledPlayer, npc, def, steps, (request) => { request.after = () => cancelledAfter++; });
  cancelledPlayer.manager.reset();
  advanceTicks(4);
  assert.deepEqual(cancelledLog.map(({ text }) => text), ['First']);
  assert.equal(cancelledAfter, 0);

  const beforeLog = [];
  const beforePlayer = createPlayer(beforeLog, { localNpcs: [npc] });
  play(beforePlayer, npc, def, [{ player: 'Never', presentation: 'overhead' }], (request) => {
    request.before = () => beforePlayer.manager.startDialogues(replacement);
  });
  assert.deepEqual(beforeLog, [], 'a before that replaces the dialogue aborts the overhead');
});

test('logout and actor unregister cancel the scheduled continuation', () => {
  const def = definition('Speaker');
  const steps = [
    { player: 'First', presentation: 'overhead' },
    { player: 'Second', presentation: 'overhead' },
  ];

  const logoutLog = [];
  let logoutAfter = 0;
  const logoutPlayer = createPlayer(logoutLog);
  play(logoutPlayer, createNpc(logoutLog, { name: 'Speaker', x: 3201, y: 3200 }), def, steps,
    (request) => { request.after = () => logoutAfter++; });
  TaskManager.cancelTasks(logoutPlayer);
  advanceTicks(4);
  assert.deepEqual(logoutLog.map(({ text }) => text), ['First']);
  assert.equal(logoutAfter, 0);

  const unregisterLog = [];
  let unregisterAfter = 0;
  const actor = createNpc(unregisterLog, { name: 'Speaker', x: 3201, y: 3200 });
  const unregisterPlayer = createPlayer(unregisterLog, { localNpcs: [actor] });
  play(unregisterPlayer, actor, def, [
    { npc: 'First', presentation: 'overhead' },
    { npc: 'Second', presentation: 'overhead' },
  ], (request) => { request.after = () => unregisterAfter++; });
  actor.registered = false;
  advanceTicks(4);
  assert.deepEqual(unregisterLog.map(({ text }) => text), ['First']);
  assert.equal(unregisterAfter, 0);
});
