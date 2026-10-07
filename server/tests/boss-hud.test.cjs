const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');

const handlers = new Map();
require('../plugins/interface/BossHud.plugin').register({
  core: PluginManager.getCoreApi(),
  onCustomEvent: (name, handler) => handlers.set(name, handler),
});
const emit = (name, payload) => handlers.get(name)(payload);

/** A player whose packets are logged as [kind, id, value]: varp, varbit, colour, hide, script (with its last argument). */
function fakePlayer() {
  const log = [];
  const sender = {
    sendConfig: (id, value) => { log.push(['varp', id, value]); return sender; },
    sendVarbit: (id, value) => { log.push(['varbit', id, value]); return sender; },
    sendInterfaceColour: (uid, colour) => { log.push(['colour', uid & 0xffff, colour]); return sender; },
    sendInterfaceDisplayState: (uid, hidden) => { log.push(['hide', uid & 0xffff, hidden]); return sender; },
    sendInterfaceScript: (id, args) => { log.push(['script', id, args.at(-1)]); return sender; },
  };
  return { log, isRegistered: () => true, getPacketSender: () => sender };
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test('show sends what the Mad Angel capture does, then fades the bar in from 254', () => {
  const player = fakePlayer();
  emit('boss-hud:show', { player, npcId: 16305, current: 755, maximum: 755 });
  assert.deepEqual(player.log, [
    ['varp', 1683, 16305], ['varbit', 6099, 755], ['varbit', 6100, 755], ['varbit', 12401, 1],
    ['colour', 13, 25600], ['colour', 14, 576], ['colour', 15, 800],
    ['script', 2376, (303 << 16) | 3],
    ['script', 2887, 254],
  ]);
});

test('update sends only what changed, and new colours are redrawn', () => {
  const player = fakePlayer();
  emit('boss-hud:show', { player, npcId: 14707, current: 525, maximum: 525 });
  player.log.length = 0;
  emit('boss-hud:update', { player, npcId: 14707, current: 525, maximum: 525 });
  assert.deepEqual(player.log, [], 'nothing changed');
  emit('boss-hud:update', { player, npcId: 14707, current: 480, maximum: 525 });
  assert.deepEqual(player.log, [['varbit', 6099, 480]]);
  player.log.length = 0;
  emit('boss-hud:update', { player, colours: [132, 623, 853] });
  assert.deepEqual(player.log, [['colour', 13, 132], ['colour', 14, 623], ['colour', 15, 853], ['script', 2102, 1]]);
  player.log.length = 0;
  emit('boss-hud:update', { player, npcId: 14707, current: 480, maximum: 525, force: true });
  assert.equal(player.log.length, 3, 'forced: all three again');
});

test('hide fades out, then clears and hides the bar 4 ticks later (the Mad Angel capture)', () => {
  const player = fakePlayer();
  emit('boss-hud:show', { player, npcId: 16305, current: 0, maximum: 755 });
  player.log.length = 0;
  emit('boss-hud:hide', { player });
  assert.deepEqual(player.log, [['script', 2889, 0]]);
  ticks(3);
  assert.equal(player.log.length, 1, 'not yet');
  ticks(1);
  assert.deepEqual(player.log.slice(1), [['varp', 1683, -1], ['varbit', 6099, 0], ['varbit', 6100, 0], ['varbit', 12401, 0], ['hide', 5, true]]);
});

test('a show before a pending hide cancels it', () => {
  const player = fakePlayer();
  emit('boss-hud:show', { player, npcId: 14779, current: 900, maximum: 1000 });
  emit('boss-hud:hide', { player, afterTicks: 2 });
  emit('boss-hud:show', { player, npcId: 14779, current: 899, maximum: 1000 });
  player.log.length = 0;
  ticks(3);
  assert.deepEqual(player.log, []);
});

test('hide with no delay clears at once, leaving a fade to finish; without a fade it hides the bar too', () => {
  const player = fakePlayer();
  emit('boss-hud:hide', { player, afterTicks: 0 });
  assert.deepEqual(player.log.map(([kind, id]) => `${kind} ${id}`), ['script 2889', 'varp 1683', 'varbit 6099', 'varbit 6100', 'varbit 12401']);
  player.log.length = 0;
  emit('boss-hud:hide', { player, fade: false, afterTicks: 0 });
  assert.deepEqual(player.log.at(-1), ['hide', 5, true]);
});

test('reset hides the bar and empties its container (the Doom capture)', () => {
  const player = fakePlayer();
  emit('boss-hud:reset', { player });
  assert.deepEqual(player.log, [['hide', 5, true], ['script', 2249, (303 << 16) | 1]]);
});
