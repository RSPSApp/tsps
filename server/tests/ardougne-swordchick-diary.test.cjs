const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const CreatureCreation = require('../plugins/minigames/CreatureCreation.plugin');
const NpcDrops = require('../plugins/npcs/NpcDrops.plugin');
const Diaries = require('../plugins/achievements/AchievementDiaries.plugin');
const Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
const { BY_KEY } = require('../plugins/achievements/diaries/Data.AchievementDiaries');

let core;
let diary;
let task;
let handlers;
let api;
let deathHandlers;
let emittedEvents;
let playerIndex = 1000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  diary = BY_KEY.get('ardougne');
  task = 'kill-a-swordchick-in-the-tower-of-life';
  handlers = new Map();
  deathHandlers = [];
  emittedEvents = [];
  api = {
    core,
    persistAttribute() {},
    onPlayerLogin() {},
    onServerStartup() {},
    onItemOnObject() {},
    onObjectInteraction() {},
    onNpcDeath(handler) { deathHandlers.push(handler); },
    onPlayerLogout(handler) { handlers.set('player-logout', handler); },
    onPlayerDeath() {},
    onServerShutdown() {},
    onCustomEvent(name, handler) {
      const listeners = handlers.get(name) ?? [];
      listeners.push(handler);
      handlers.set(name, listeners);
    },
    registerArea() {},
    registerCommand() {},
    log() {},
    getItemOnGroundManager() { return { registerLocation() {} }; },
    spawnNpc({ id, x, y, z }) { return { getId: () => id, getLocation: () => new core.Location(x, y, z) }; },
    removeNpc() {},
    emitCustomEvent(name, event) {
      emittedEvents.push({ name, event });
      if (name === 'quest:is-complete') event.complete = true;
      else if (name === 'diary:task') for (const handler of handlers.get(name) ?? []) handler(event);
      else if (name === 'diary:is-complete') event.complete = false;
      else if (name === 'npc-drops:generated') event.handled = true;
      else for (const handler of handlers.get(name) ?? []) handler(event);
    },
    getTaskManager() { throw new Error('unexpected diary tier completion'); },
  };
  Progress(api);
  handlers.set('diary:task', [Diaries._test.onTask]);
  CreatureCreation.register(api);
  NpcDrops.register(api);
});

function actor() {
  const player = new Player(null, new core.Location(3012, 4380, 0));
  player.setIndex(playerIndex++);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (_target, key) => key === 'sendVarbit'
      ? (id, value) => { varbits.set(id, value); return sender; }
      : () => sender,
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isRegistered = () => true;
  return { player, varbits };
}

function createCreature(player, altarKey = 'swordchick') {
  const altar = CreatureCreation._test.ALTARS.find(({ key }) => key === altarKey);
  player.setAttribute(`creature-creation:${altarKey}`, core.ItemIdentifiers[altar.ingredients[0]]);
  player.setAttribute(`creature-creation:${altarKey}-second`, core.ItemIdentifiers[altar.ingredients[1]]);
  assert.equal(CreatureCreation._test.activate(api, core, {
    player,
    objectId: core.ObjectIdentifiers.SYMBOL_OF_LIFE,
    location: { x: Number(altar.tile.split(',')[0]), y: Number(altar.tile.split(',')[1]), z: 0 },
  }), true);
  return api.spawnedNpc;
}

function kill(killer, npc) {
  for (const handler of deathHandlers) handler({ killer, npc, npcId: npc.getId(), damagers: [killer] });
}

test('the owner killing their altar-created Swordchick completes Ardougne Medium #10', () => {
  const { player, varbits } = actor();
  let spawned;
  api.spawnNpc = ({ id, x, y, z }) => (api.spawnedNpc = spawned = {
    getId: () => id,
    getLocation: () => new core.Location(x, y, z),
  });
  createCreature(player);
  assert.equal(spawned.getId(), 3603);

  kill(player, spawned);

  assert.ok(Progress.doneTasks(player, diary).has(task));
  assert.equal(Progress.tierCount(player, diary, 'medium'), 1);
  assert.equal(varbits.get(diary.tiers.medium.countVarbit), 1);
  assert.ok(emittedEvents.some(({ name, event }) => name === 'npc-drops:roll' && event.player === player && event.npc === spawned));
});

test('other creatures, other players, untracked Swordchicks, and despawned creatures do not earn the task', () => {
  const taskCount = (player) => Progress.tierCount(player, diary, 'medium');
  const owner = actor();
  let spawned;
  api.spawnNpc = ({ id, x, y, z }) => (api.spawnedNpc = spawned = {
    getId: () => id,
    getLocation: () => new core.Location(x, y, z),
  });
  createCreature(owner.player, 'newtroost');
  kill(owner.player, spawned);
  assert.equal(taskCount(owner.player), 0, 'another altar creature does not earn the task');

  const swordchickOwner = actor();
  createCreature(swordchickOwner.player);
  const stranger = actor();
  kill(stranger.player, spawned);
  assert.equal(taskCount(stranger.player), 0, 'a non-owner does not earn the task');

  const ordinary = actor();
  const wildSwordchick = {
    getId: () => 3603,
    getLocation: () => new core.Location(3012, 4380, 0),
  };
  kill(ordinary.player, wildSwordchick);
  assert.equal(taskCount(ordinary.player), 0, 'an untracked Swordchick does not earn the task');

  const rollCount = emittedEvents.filter(({ name }) => name === 'npc-drops:roll').length;
  handlers.get('player-logout')({ player: swordchickOwner.player });
  kill(null, spawned);
  assert.equal(emittedEvents.filter(({ name }) => name === 'npc-drops:roll').length, rollCount,
    'despawning a creature does not produce an NPC drop roll');
  assert.equal(taskCount(swordchickOwner.player), 0, 'a despawned creature does not earn the task');
});
