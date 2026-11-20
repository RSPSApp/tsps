// Run after `yarn build`: node --test tests/streak-info.test.cjs
//
// Read on Edgeville's Streak info noticeboard (target_noticeboard, 37434) against rsprox
// 232/03212 t2261-t2265: toplevel_mainmodal_open, the target_streaks (648) modal, then the hunter
// (648:7) and rogue (648:8) columns, both "<col=ffb83f>0</col><br>0".
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

const STREAK_INFO = 37434;
const TARGET_STREAKS = 648;

const hooks = {};

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
  };
  require('../plugins/objects/StreakInfo.plugin').register(api);
});

/** A real Player with only the network stubbed; what it sends is recorded in order. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(3096, 3505, 0));
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = [];
  for (const name of ['sendString', 'sendInterface', 'sendClientScript', 'sendVarbit', 'sendMessage']) {
    const original = sender[name];
    t.mock.method(sender, name, function (...args) { p.sent.push([name, ...args]); return original.apply(this, args); });
  }
  return p;
}

test('the cache names the board "Streak info" with Read, and the interface its two columns', () => {
  const core = PluginManager.getCoreApi();
  const definition = core.CacheDefinitions.getObject(STREAK_INFO);
  assert.equal(definition.name, 'Streak info');
  assert.equal(definition.actions[0], 'Read');
  assert.equal(core.CacheDefinitions.getInterfaceId('target_streaks'), TARGET_STREAKS);
  assert.ok(hooks['Streak info']?.Read, 'Read on "Streak info" is hooked');
});

test('Read opens target_streaks with no hunter or rogue streak, as recorded (232/03212 t2265)', (t) => {
  const p = realPlayer(t);
  assert.equal(hooks['Streak info'].Read({ player: p, objectId: STREAK_INFO, clickType: 1, handled: false }), true);
  assert.deepEqual(p.sent, [
    ['sendClientScript', 2524, -1, -1],
    ['sendInterface', TARGET_STREAKS],
    ['sendString', '<col=ffb83f>0</col><br>0', (TARGET_STREAKS << 16) | 7],
    ['sendString', '<col=ffb83f>0</col><br>0', (TARGET_STREAKS << 16) | 8],
  ]);
});
