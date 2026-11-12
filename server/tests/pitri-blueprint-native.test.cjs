// Run after `yarn build`: node --test tests/pitri-blueprint-native.test.cjs
//
// Issue #4718, through Soar Leader Pitri's real transcript: every plugin loaded, a real Player, his
// spawn (13135) and native npc_option / dialogue_continue packets.
// - After 10 Hunters' Rumours, "Take the free whistle blueprint?" Yes gives the blueprint (the
//   transcript's receive step carries its wording in `text`, not `target`).
// - "I've lost my perfected whistle." shows only to a player who unlocked it and owns none, and
//   hands the whistle back with no charges.
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
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const PITRI = 13135;
const AT = [1558, 3047, 2];
const LOST = "I've lost my perfected whistle. Do you have any spares?";
let core, pitri, next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  pitri = PM.spawnNpc({ id: PITRI, x: AT[0], y: AT[1], z: AT[2], wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

const obj = (name) => core.CacheDefinitions.getObjId(name);

function harness(t, rumours) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++); player.setUsername('pitri' + next); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setAttribute('hunter.rumours', { assignments: {}, active: null, completed: 0, outfit: 0, ...rumours });
  player.setLocation(new core.Location(AT[0] + 1, AT[1], AT[2])); player.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = player;
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => { core.TaskManager.processWalkTo(player.getIndex()); player.getMovementQueue().process(); core.TaskManager.process(); c.processTurnPackets(); };
  const send = async (packet) => { await c.dispatch([packet]); for (let i = 0; i < 3; i++) tick(); };
  const group = () => player.getPacketSender().getChatboxGroupId();
  async function menu() {
    for (let i = 0; i < 30; i++) {
      const current = player.getDialogueManager().getCurrent();
      if (typeof current?.getOptions === 'function') return current.getOptions();
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) return pending.options;
      if (!player.getDialogueManager().isActive()) return null;
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
    return null;
  }
  async function choose(option) {
    const options = await menu();
    assert.ok(options?.includes(option), `${option} in ${JSON.stringify(options)}`);
    await send({ type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: options.indexOf(option) + 1 });
  }
  async function finish() {
    for (let i = 0; i < 30 && player.getDialogueManager().isActive(); i++) {
      if (typeof player.getDialogueManager().getCurrent()?.getOptions === 'function' || MultiChatboxPrompt.getPending(player)) return;
      await send({ type: 'dialogue_continue', widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
    }
  }
  async function talk() {
    const op = pitri.getCurrentDefinition(player).getActions().findIndex((action) => action === 'Talk-to') + 1;
    assert.ok(op > 0);
    await send({ type: 'npc_option', index: pitri.getIndex(), clickType: op });
  }
  return { player, menu, choose, finish, talk };
}

test('after 10 rumours, the free whistle blueprint arrives', async (t) => {
  const f = harness(t, { completed: 10 });
  await f.talk();
  await f.choose('Yes.');
  await f.finish();
  assert.equal(f.player.getInventory().getAmount(obj('hg_whistle_blueprint_1')), 1);
});

test('the lost perfected whistle option is offered only to a player who lost one, and returns it empty', async (t) => {
  const never = harness(t, { completed: 0 });
  await never.talk();
  assert.equal((await never.menu())?.includes(LOST), false, 'not offered to a player who never had one');

  const lost = harness(t, { completed: 0, perfected: true });
  await lost.talk();
  await lost.choose(LOST);
  await lost.finish();
  const whistle = obj('hg_quetzalwhistle_perfected');
  assert.equal(lost.player.getInventory().getAmount(whistle), 1);
  const Whistle = require('../plugins/world/quetzals/Whistle.Quetzals');
  assert.equal(Whistle.chargesOf(lost.player, Whistle.whistleOf(whistle)), 0, 'no charges left');
});
