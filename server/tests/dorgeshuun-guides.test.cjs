// Run after `yarn build`: node --test tests/dorgeshuun-guides.test.cjs
//
// Kazgar's and Mistag's tunnel travel against rsprox (Kazgar op3 in 13 recordings, 224/01441 to
// 239/04263; Mistag op3 in 232/03182 and 232/03187).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

const handlers = {};

before(() => {
  const api = { core: PluginManager.getCoreApi(), onNpcInteraction: (name, actions) => { handlers[name] = actions; } };
  require('../plugins/areas/DorgeshuunGuides.plugin').register(api);
});

function player() {
  const p = {
    location: new Location(3231, 9611, 0), messages: [], log: [], blocked: false,
    isRegistered: () => true,
    sendMessage: (m) => p.messages.push(m),
    moveTo(l) { p.location = l; p.log.push('move'); },
    getMovementQueue: () => ({ setBlockMovement(b) { p.blocked = b; return this; }, reset() {} }),
    getPacketSender: () => ({
      sendSubInterface: (uid, id, type, { postScripts }) => p.log.push(`fade ${postScripts[0].args[1] === 255 ? 'out' : 'in'}`),
      closeSubInterface: () => p.log.push('close'),
      sendTypedMessage: (type, m) => p.messages.push(type === PluginManager.getCoreApi().ChatType.SPAM ? `spam:${m}` : m),
    }),
  };
  return p;
}

function ticks(count, p, log) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    log.push(p.log.splice(0).join(',') || '-');
  }
}

test("Kazgar's Follow: the recorded line and fade, moved 3 ticks later to (3309, 9613), back in a tick on, closed 2 ticks after", () => {
  const p = player();
  assert.equal(handlers.Kazgar.Follow({ player: p }), true);
  assert.deepEqual(p.messages, ['spam:Kazgar shows you the way through the tunnels.']);
  assert.deepEqual(p.log.splice(0), ['fade out']);
  assert.equal(p.blocked, true);
  const log = [];
  ticks(6, p, log);
  assert.deepEqual(log, ['-', '-', 'move', 'fade in', '-', 'close']);
  assert.deepEqual([p.location.getX(), p.location.getY()], [3309, 9613]);
  assert.equal(p.blocked, false);
});

test("Mistag's Follow and Cellar lead to Kazgar (3235, 9610); after Death to the Dorgeshuun, Kazgar's Mines goes to the mine", () => {
  for (const option of ['Follow', 'Cellar']) {
    const p = player();
    handlers.Mistag[option]({ player: p });
    assert.deepEqual(p.messages, ['spam:Mistag shows you the way through the tunnels.']);
    ticks(6, p, []);
    assert.deepEqual([p.location.getX(), p.location.getY()], [3235, 9610], option);
  }
  const p = player();
  handlers.Kazgar.Mines({ player: p });
  ticks(6, p, []);
  assert.deepEqual([p.location.getX(), p.location.getY()], [3309, 9613]);
  assert.ok(handlers.Kazgar.Watermill && handlers.Mistag.Watermill, 'both guides take players to the water mill');
});
