// Run after `yarn build`: node --test tests/necropolis-rubble-crossing.test.cjs
// Beneath Cursed Sands: the Necropolis rubble (44003). rsprox 227/00101.txt tick 9141: the player is
// moved from 3349,2759 to 3347,2759 by an exactmove over 60 cycles with human_walk_style (839), and
// sound 2454 plays (3 loops, delay 4); tick 10674 crosses back. Real plugins and a real Player; the
// click goes through the plugin manager's object interaction, as the object packet does.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test('the rubble is crossed by a walking exact-move with its sound, west then back east', (t) => {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(2790); p.setUsername('necrorubble');
  p.setRegistered(true); p.setLocation(new core.Location(3349, 2759, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const quest = QuestRuntime.getRegisteredQuests().find((q) => q.name === 'Beneath Cursed Sands');
  assert.ok(quest);
  quest.setStage(p, 16);
  const sounds = [];
  const sender = p.getPacketSender();
  const sfx = sender.sendSoundEffect.bind(sender);
  const busy = [];
  const varbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, 'sendVarbit', (id, value) => { if (id === 12393) busy.push(value); return varbit(id, value); });
  t.mock.method(sender, 'sendSoundEffect', (id, loops, delay, volume) => { sounds.push([id, loops, delay]); return sfx(id, loops, delay, volume); });
  const rubble = new core.GameObject(44003, new core.Location(3348, 2759, 0), 10, 0, null);
  const click = () => PM.emitObjectInteraction({ player: p, object: rubble, objectId: 44003,
    definition: core.ObjectDefinition.forId(44003), clickType: 1, location: { x: 3348, y: 2759, z: 0 }, handled: false });
  click();
  assert.deepEqual(sounds, [[2454, 3, 4]], 'sound 2454, 3 loops, delay 4');
  // Busy (12393) on the start tick, cleared when the move ends (rsprox 227/00101.txt [9141]/[9143]).
  assert.deepEqual(busy, [1], 'busy on the start tick');
  core.TaskManager.process();
  const move = p.getForceMovement?.();
  assert.ok(move, 'an exact-move is running');
  assert.equal(move.getAnimation?.() ?? move.animation, 839);
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3347, 2759], 'west across the rubble');
  assert.deepEqual(busy, [1, 0], 'and free again once across');
  click();
  for (let i = 0; i < 4; i++) core.TaskManager.process();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3349, 2759], 'and back east');
  assert.deepEqual(busy, [1, 0, 1, 0]);
});
