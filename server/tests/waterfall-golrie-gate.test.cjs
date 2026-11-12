// Run after `yarn build`: node --test tests/waterfall-golrie-gate.test.cjs
// Golrie's jail gate (1991 at 2515,9575, the jail north of it). Wiki Transcript:Waterfall Quest: from
// the outside it takes the key ("You use the key to unlock the gate."), and Golrie answers a player
// without one; from the inside "You open the gate and walk through." The Wiki's Key (Tree Gnome
// Village Dungeon) page has the key needed again to re-enter, so unlocking it once is not enough.
// Real plugins, real Players, the real map gate and ObjectActionPacketListener.executeAction.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');

const GATE = [1991, 2515, 9575];
const UNLOCK = 'You use the key to unlock the gate.';
const WALK = 'You open the gate and walk through.';
let core, next = 2780;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  core.ObjectDefinition.init(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2515, 9575);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function click(t, [x, y], { key = false, unlockedBefore = false } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('golrie' + p.getIndex());
  p.setRegistered(true); p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  if (unlockedBefore) p.setAttribute('waterfall-quest:golrie-gate', 1);
  if (key) p.getInventory().add(new core.Item(core.ItemIdentifiers.KEY_17, 1), true);
  new ObjectActionPacketListener().executeAction(p, ...GATE, 1);
  for (let i = 0; i < 4; i++) { p.getMovementQueue().process(); core.TaskManager.processWalkTo(p.getIndex()); core.TaskManager.process(); }
  return { p, messages };
}

test('from the outside the key unlocks the gate', (t) => {
  const { messages } = click(t, [2515, 9574], { key: true });
  assert.ok(messages.includes(UNLOCK), messages.join(' | '));
});

test('from the outside an earlier unlock does not open it without the key', (t) => {
  const { p, messages } = click(t, [2515, 9574], { unlockedBefore: true });
  assert.ok(!messages.includes(UNLOCK), messages.join(' | '));
  assert.ok(p.getDialogueManager().isActive(), 'Golrie answers the player without a key');
});

test('from the inside the gate opens without the key', (t) => {
  const { p, messages } = click(t, [2515, 9576]);
  assert.ok(messages.includes(WALK), messages.join(' | '));
  assert.ok(!p.getDialogueManager().isActive(), 'no locked-out conversation');
});
