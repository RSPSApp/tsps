// Run after `yarn build`: node --test tests/bird-nest-members-only.test.cjs
// Wiki (Bird nest): "Free players won't see them while woodcutting." The nest roll had no members check (Kandarin
// headgear and the felling rations do), so a free world dropped nests.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
let core, next = 9980;
const bots = process.env.DISABLE_PLAYER_BOTS;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function chopper(t, members) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('nest' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => members);
  t.mock.method(Math, 'random', () => 0);
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, 'registers', (_player, item) => { dropped.push(item.getId()); });
  return { p, dropped };
}
test('a free world never drops a bird nest', (t) => {
  const f = chopper(t, false);
  assert.equal(Woodcutting._test.maybeDropBirdNest(f.p), false, 'the log goes to the inventory');
  assert.deepEqual(f.dropped, []);
});
test('control: a members world drops one on a winning roll', (t) => {
  const f = chopper(t, true);
  assert.equal(Woodcutting._test.maybeDropBirdNest(f.p), true);
  assert.equal(f.dropped.length, 1);
});
