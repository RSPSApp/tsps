// Run after `yarn build`: node --test tests/hunter-guild-pellem-native.test.cjs
//
// Issue #4434: Pellem's transcript splits on "If the player has under 46 Hunter:" / "If the player has
// at least 46 Hunter:". Every plugin loaded, a real Player, Pellem's spawn (13130) and a native
// npc_option Talk-to: 46+ Hunter gets his greeting, under 46 the refusal.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { skillLevelCondition } = require('../plugins/npcs/NpcDialogues.plugin');

const PELLEM = 13130;
const AT = [1565, 3035, 0];
let core, pellem, next = 9740;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  pellem = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === PELLEM)
    ?? PM.spawnNpc({ id: PELLEM, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

async function talkAt(t, hunter) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('pellem' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.getSkillManager().setMaxLevel(core.Skill.HUNTER, hunter).setCurrentLevel(core.Skill.HUNTER, hunter);
  const at = pellem.getLocation();
  player.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const op = pellem.getCurrentDefinition(player).getActions().findIndex((action) => action === 'Talk-to') + 1;
  assert.ok(op > 0);
  await c.dispatch([{ type: 'npc_option', index: pellem.getIndex(), clickType: op }]);
  for (let i = 0; i < 4; i++) { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); }
  return player.getDialogueManager().getCurrent()?.getText?.()?.replace(/\s+/g, ' ');
}

test('Pellem greets a player with 46 or more Hunter', async (t) => {
  assert.equal(await talkAt(t, 60), 'Hi there. How can I help you today?');
  assert.equal(await talkAt(t, 46), 'Hi there. How can I help you today?');
});

test('Pellem refuses a player under 46 Hunter', async (t) => {
  assert.equal(await talkAt(t, 45), 'Sorry, but I can only provide services to qualified members of the Hunter Guild.');
});

test('the bare skill-level wording answers from that skill; other wording is left to plugins', () => {
  const at = (levels) => ({ getSkillManager: () => ({ getCurrentLevel: (skill) => levels[skill.getName()] ?? 1 }) });
  assert.equal(skillLevelCondition(at({ Smithing: 60 }), 'If the player has at least 60 Smithing:'), true);
  assert.equal(skillLevelCondition(at({ Smithing: 59 }), 'If the player has less than 60 Smithing:'), true);
  assert.equal(skillLevelCondition(at({ Sailing: 40 }), 'If the player has under 40 Sailing:'), false);
  assert.equal(skillLevelCondition(at({}), 'If the player has at least 40 Prayer points:'), null);
  assert.equal(skillLevelCondition(at({}), 'If the player has at least 875 coins with them:'), null);
});
