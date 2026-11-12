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
const custom = {};
/** Players who have finished Death to the Dorgeshuun, answered through quest:is-complete. */
const dttdDone = new WeakSet();

before(() => {
  const api = { core: PluginManager.getCoreApi(), onNpcInteraction: (name, actions) => { handlers[name] = actions; }, onCustomEvent: (name, fn) => { custom[name] = fn; },
    emitCustomEvent: (name, request) => {
      if (name === 'quest:is-complete' && request.key === 'death_to_the_dorgeshuun') request.complete = dttdDone.has(request.player);
    } };
  require('../plugins/areas/DorgeshuunGuides.plugin').register(api);
});

function player() {
  const p = {
    location: new Location(3231, 9611, 0), messages: [], types: [], log: [], blocked: false,
    isRegistered: () => true,
    sendMessage: (message) => { p.types.push("normal"); p.messages.push(message); },
    moveTo(l) { p.location = l; p.log.push('move'); },
    getMovementQueue: () => ({ setBlockMovement(b) { p.blocked = b; return this; }, reset() {} }),
    getPacketSender: () => ({
      sendTypedMessage: (type, message) => { p.types.push(type); p.messages.push(message); },
      sendSubInterface: (uid, id, type, { postScripts }) => p.log.push(`fade ${postScripts[0].args[1] === 255 ? 'out' : 'in'}`),
      closeSubInterface: () => p.log.push('close'),
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
  assert.deepEqual(p.messages, ['Kazgar shows you the way through the tunnels.']);
  assert.deepEqual(p.types, [PluginManager.getCoreApi().ChatType.SPAM]);
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
    assert.deepEqual(p.messages, ['Mistag shows you the way through the tunnels.']);
    ticks(6, p, []);
    assert.deepEqual([p.location.getX(), p.location.getY()], [3235, 9610], option);
  }
  const p = player();
  handlers.Kazgar.Mines({ player: p });
  ticks(6, p, []);
  assert.deepEqual([p.location.getX(), p.location.getY()], [3309, 9613]);
  assert.ok(handlers.Kazgar.Watermill && handlers.Mistag.Watermill, 'both guides take players to the water mill');
});


test("recorded dialogue routes use the same timed crossing as quick travel", () => {
  const routes = [
    ['Mistag', 'uzpbCL', 3235, 9610],
    ['Mistag', 'yWjjdW', 3235, 9610],
    ['Kazgar', 'm471ps', 3309, 9613],
    ['Kazgar', 'ccERZh', 3242, 9648],
    ['Mistag', '_mrum5', 3245, 9645],
    ['Dartog', 'SCTNDo', 3309, 9613],
    ['Dartog', 'S9W4wW', 3235, 9610],
  ];
  for (const [name, stepId, x, y] of routes) {
    const p = player();
    dttdDone.add(p);
    const event = { player: p, stepId, kind: 'message', text: `${name} shows you the way through the tunnels.` };
    custom['npc-dialogue:action'](event);
    assert.equal(event.handled, true, stepId);
    assert.deepEqual(p.log.splice(0), ['fade out'], stepId);
    assert.deepEqual(p.messages, [event.text], stepId);
    ticks(2, p, []);
    assert.deepEqual([p.location.getX(), p.location.getY()], [3231, 9611], stepId);
    ticks(4, p, []);
    assert.deepEqual([p.location.getX(), p.location.getY()], [x, y], stepId);
  }
});

test("water mill dialogue routes stay put before Death to the Dorgeshuun", () => {
  for (const [name, stepId] of [['Kazgar', 'ccERZh'], ['Mistag', '_mrum5']]) {
    const p = player();
    const event = { player: p, stepId, kind: 'message', text: `${name} shows you the way through the tunnels.` };
    custom['npc-dialogue:action'](event);
    assert.equal(event.handled, true, stepId);
    ticks(6, p, []);
    assert.deepEqual(p.log, [], stepId);
    assert.deepEqual(p.messages, [], stepId);
    assert.deepEqual([p.location.getX(), p.location.getY()], [3231, 9611], stepId);
  }
});

test("Dartog's quick options reach the mine and cellar destinations", () => {
  for (const [option, x, y] of [['Mines', 3309, 9613], ['Cellar', 3235, 9610]]) {
    const p = player();
    handlers.Dartog[option]({ player: p });
    ticks(6, p, []);
    assert.deepEqual([p.location.getX(), p.location.getY()], [x, y]);
  }
});


test("unrelated dialogue messages do not start a guide journey", () => {
  const p = player();
  const event = { player: p, stepId: 'uzpbCL', kind: 'message', text: 'An unrelated message.' };
  custom['npc-dialogue:action'](event);
  assert.equal(event.handled, undefined);
  assert.deepEqual(p.log, []);
});
