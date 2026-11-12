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
    ['colour', 14, 25600], ['colour', 15, 576], ['colour', 16, 800],
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
  assert.deepEqual(player.log, [['colour', 14, 132], ['colour', 15, 623], ['colour', 16, 853], ['script', 2102, 1]]);
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

/** A player who attacks, with the normal health overlay setting (varbit 12390) as given. */
function attacker(standardDisabled = 0) {
  const player = fakePlayer();
  const sender = player.getPacketSender();
  sender.getVarbit = (id) => (id === 12390 ? standardDisabled : 0);
  let target = null;
  return Object.assign(player, {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getCombat: () => ({ getTarget: () => target }),
    target: (npc) => { target = npc; },
  });
}

function npc(id, hitpoints, maximum = hitpoints) {
  const self = { isNpc: () => true, isPlayer: () => false, getId: () => id, getHitpoints: () => hitpoints, getMaxHitpoints: () => maximum };
  self.hit = (damage) => { hitpoints = Math.max(0, hitpoints - damage); emit('combat:damage-applied', { target: self }); };
  return self;
}

const swing = (player, target) => emit('combat:hit-rolled', { attacker: player, target, damage: 0 });

test('an attack on an ordinary NPC opens the normal health overlay, as the Falador guard capture does', () => {
  const player = attacker();
  const guard = npc(3269, 22);
  player.target(guard);
  swing(player, guard);
  assert.deepEqual(player.log, [
    ['varp', 1683, 3269], ['varbit', 6099, 22], ['varbit', 6100, 22], ['varbit', 12401, 0],
    ['colour', 14, 25600], ['colour', 15, 576], ['colour', 16, 800],
    ['script', 2376, (303 << 16) | 3],
    ['script', 2887, 254],
  ]);
  player.log.length = 0;
  guard.hit(18);
  assert.deepEqual(player.log, [['varbit', 6099, 4]]);
  player.log.length = 0;
  swing(player, guard);
  assert.deepEqual(player.log, [], 'another attack on it sends nothing');
});

test('8 ticks after the last attack it fades out, and clears 4 ticks later', () => {
  const player = attacker();
  const guard = npc(3269, 22);
  player.target(guard);
  swing(player, guard);
  ticks(5);
  swing(player, guard);
  player.log.length = 0;
  ticks(7);
  assert.deepEqual(player.log, [], 'the second attack restarted the count');
  ticks(1);
  assert.deepEqual(player.log, [['script', 2889, 0]]);
  ticks(4);
  assert.deepEqual(player.log.slice(1), [['varp', 1683, -1], ['varbit', 6099, 0], ['varbit', 6100, 0], ['varbit', 12401, 0], ['hide', 5, true]]);
  player.log.length = 0;
  ticks(10);
  assert.deepEqual(player.log, []);
});

test('an attack during the fade-out shows it again', () => {
  const player = attacker();
  const calf = npc(2801, 6);
  player.target(calf);
  swing(player, calf);
  ticks(9);
  player.log.length = 0;
  swing(player, calf);
  assert.equal(player.log.filter(([kind, id]) => kind === 'script' && id === 2376).length, 1);
  ticks(4);
  assert.equal(player.log.some(([kind]) => kind === 'hide'), false, 'the pending clear was cancelled');
  assert.equal(player.log.some(([kind, id, value]) => kind === 'varp' && id === 1683 && value === -1), false);
});

test('the setting off, or a boss NPC, gets no normal health overlay', () => {
  const off = attacker(1);
  const man = npc(2613, 60);
  off.target(man);
  swing(off, man);
  assert.deepEqual(off.log, []);

  const player = attacker();
  emit('boss-hud:show', { player: fakePlayer(), npcId: 12345, current: 100, maximum: 100 });
  const boss = npc(12345, 100);
  player.target(boss);
  swing(player, boss);
  assert.deepEqual(player.log, [], 'a boss event named it');
});

test("a boss's HUD wins over the normal one, and an add hit meanwhile changes nothing", () => {
  const player = attacker();
  const man = npc(2613, 60);
  player.target(man);
  swing(player, man);
  emit('boss-hud:show', { player, npcId: 16305, current: 755, maximum: 755 });
  player.log.length = 0;
  man.hit(5);
  const add = npc(2614, 60);
  player.target(add);
  swing(player, add);
  ticks(12);
  assert.deepEqual(player.log, []);
});

test("in a multi-target attack the HUD follows the player's own target", () => {
  const player = attacker();
  const first = npc(2613, 60);
  const second = npc(2614, 60);
  player.target(first);
  swing(player, first);
  player.log.length = 0;
  swing(player, second);
  assert.deepEqual(player.log, [], 'not the target: no switch');
  player.target(second);
  swing(player, second);
  assert.deepEqual(player.log[0], ['varp', 1683, 2614]);
  player.log.length = 0;
  first.hit(10);
  assert.deepEqual(player.log, [], 'the old NPC no longer updates it');
});

test('a cancelled fade count starts again on the next attack', () => {
  const player = attacker();
  const man = npc(2613, 60);
  player.target(man);
  swing(player, man);
  TaskManager.cancelTasks(player);
  for (const task of [...TaskManager.activeTasks ?? [], ...(TaskManager.pendingTasks?.toArray?.() ?? [])]) task.stop();
  ticks(3);
  swing(player, man);
  player.log.length = 0;
  ticks(8);
  assert.deepEqual(player.log, [['script', 2889, 0]]);
});

test('an NPC that changes form mid-fight shows its new id on the next hit', () => {
  const player = attacker();
  let id = 2613;
  const man = npc(2613, 60);
  man.getId = () => id;
  player.target(man);
  swing(player, man);
  player.log.length = 0;
  id = 2614;
  man.hit(3);
  assert.deepEqual(player.log, [['varp', 1683, 2614], ['varbit', 6099, 57]]);
});
