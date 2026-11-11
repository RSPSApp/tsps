// Run after `yarn build`: node --test tests/fenkenstrain-castle-spawns-native.test.cjs
//
// Issue #4350: one Dr Fenkenstrain (and one Gardener Ghost), not two. The world's multi-NPC spawns
// 2014 (fenk_fenkenstrain) and 2013 (fenk_gardener_multi_2) resolve to 1269 and 1272 for the
// player, and the quest's Talk-to reaches them through a real npc_option; a login spawns no
// private copy beside them.
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

const DOCTOR = { world: 2014, content: 1269, at: [3551, 3550, 0] };
const GARDENER = { world: 2013, content: 1272, at: [3551, 3561, 0] };
let core, next = 9940;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOCTOR.at[0], DOCTOR.at[1]);
  PM.emitServerStartup({});
  for (const spawn of [DOCTOR, GARDENER]) {
    spawn.npc = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === spawn.world)
      ?? PM.spawnNpc({ id: spawn.world, x: spawn.at[0], y: spawn.at[1], z: 0, wanderRadius: 0 });
  }
});
after(() => PM.emitServerShutdown({}));

function harness(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('fenk' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(DOCTOR.at[0] + 1, DOCTOR.at[1], 0)); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const send = async (packet) => {
    await c.dispatch([packet]);
    for (let i = 0; i < 4; i++) {
      core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets();
    }
  };
  return { player, send };
}

/** Every NPC on the tile that shows to `player` as `contentId`, including ones still queued to spawn. */
function shown(player, [x, y, z], contentId) {
  const all = [...core.World.getNpcs(), ...core.World.getAddNPCQueue()].filter(Boolean);
  return all.filter((npc) => {
    const at = npc.getLocation();
    return at.getX() === x && at.getY() === y && at.getZ() === z
      && !core.World.getRemoveNPCQueue().includes(npc) && npc.getContentId(player) === contentId;
  });
}

test('after login there is one Dr Fenkenstrain and one Gardener Ghost, the world spawns', (t) => {
  const { player } = harness(t);
  PM.emitPlayerLogin({ player, username: player.getUsername() });
  for (const spawn of [DOCTOR, GARDENER]) {
    const seen = shown(player, spawn.at, spawn.content);
    assert.equal(seen.length, 1, `one ${spawn.content} at ${spawn.at}`);
    assert.equal(seen[0], spawn.npc, 'the world spawn');
  }
});

test("Talk-to on the world Dr Fenkenstrain opens the quest's conversation", async (t) => {
  const { player, send } = harness(t);
  PM.emitPlayerLogin({ player, username: player.getUsername() });
  const definition = DOCTOR.npc.getCurrentDefinition(player);
  assert.equal(definition.getId(), DOCTOR.content);
  const op = definition.getActions().findIndex((action) => action === 'Talk-to') + 1;
  assert.ok(op > 0);
  await send({ type: 'npc_option', index: DOCTOR.npc.getIndex(), clickType: op });
  assert.equal(player.getDialogueManager().isActive(), true, 'a conversation opened');
  const text = player.getDialogueManager().getCurrent()?.getText?.() ?? '';
  assert.ok(text.length > 0 && !/isn't available|nothing interesting/i.test(text), text);
});
