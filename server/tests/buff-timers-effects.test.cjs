// node --test tests/buff-timers-effects.test.cjs
// The buff bar timers BuffTimers.plugin.js reads from other plugins' state, on the vars the cache's
// buff bar script (5923) reads, in each buff's own steps.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../plugins/interface/BuffTimers.plugin');

const AMMUNITION_SLOT = 13;
// Antifire, Tele Block and stamina (tests/buff-timers.test.cjs): left out here.
const OTHER_TIMERS = new Set([7990, 7991, 7992, 7993, 3981, 6101, 4163, 24, 25].flatMap(id => [`varp ${id}`, `varbit ${id}`]));

function noTimer() {
  return { secondsRemaining: () => 0, millisRemaining: () => 0 };
}

/** A player with equipment, on a server whose World tick and custom events the plugin reaches. */
function fixture({ cycle = 1000, players = 0 } = {}) {
  const world = { cycle };
  const group = { players };
  const hooks = {};
  plugin.register({
    core: { World: { getProcessCycle: () => world.cycle }, Equipment: { AMMUNITION_SLOT } },
    emitCustomEvent: (name, request) => { if (name === 'woodcutting:group-bonus') request.players = group.players; },
    onPlayerLogin: fn => { hooks.login = fn; },
    onPlayerProcess: fn => { hooks.process = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
  });
  const attributes = new Map(), slots = new Map(), vars = [];
  const player = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getFireImmunityTimer: noTimer, getTeleblockTimer: noTimer }),
    getEquipment: () => ({ get: slot => slots.get(slot) ?? null }),
    getPacketSender: () => ({
      sendConfig: (id, value) => vars.push([`varp ${id}`, value]),
      sendVarbit: (id, value) => vars.push([`varbit ${id}`, value]),
    }),
  };
  const sent = () => Object.fromEntries(vars.splice(0).filter(([key]) => !OTHER_TIMERS.has(key)));
  const tick = () => hooks.process({ player });
  const login = () => hooks.login({ player });
  return { player, attributes, slots, world, group, sent, tick, login };
}

/** Logged in, with the login's own sends cleared. */
function loggedIn(options) {
  const f = fixture(options);
  f.login();
  f.sent();
  return f;
}

test('a login sends only the timers that are not 0: the empty ammo slot and no group bonus', () => {
  const f = fixture();
  f.login();
  assert.deepEqual(f.sent(), { 'varp 3158': -1, 'varp 3160': -1, 'varp 4007': -1 });
  f.tick();
  assert.deepEqual(f.sent(), {}, 'nothing changed');
});

test('a login sends a running timer again', t => {
  const now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  f.attributes.set('godwars:altar-prayed-at', now);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 4099': 10 });
  f.login();
  assert.equal(f.sent()['varbit 4099'], 10);
});

test('Charge counts steps of 2 ticks on magearena_charge (varp 272), from its 700 ticks', () => {
  const f = loggedIn();
  f.attributes.set('charge:until', f.world.cycle + 700);
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 272': 350 });
  f.world.cycle += 1;
  f.tick();
  assert.deepEqual(f.sent(), {}, 'a step lasts 2 ticks');
  f.world.cycle += 1;
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 272': 349 });
  f.world.cycle += 698;
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 272': 0 });
});

test('the God Wars altar cooldown counts minutes (100-tick steps) on godwars_altar_delay', t => {
  let now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  f.attributes.set('godwars:altar-prayed-at', now);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 4099': 10 }, 'ten minutes');
  now += 9 * 60_000 + 1;
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 4099': 1 });
  now += 60_000;
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 4099': 0 });
});

test('Magic Imbue counts steps of 10 ticks on magic_imbue_active', () => {
  const f = loggedIn();
  f.attributes.set('lunar:magic-imbue-until', f.world.cycle + 21);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 5438': 3 }, '21 ticks fit the 2-bit varbit');
  f.world.cycle += 21;
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 5438': 0 });
});

test('a divine super combat counts ticks on the attack, strength, defence and combat varbits', t => {
  let now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  const endsAt = now + 300_000;
  f.attributes.set('potions:divine:state', { endsAt, targets: [0, 2, 1].map(skillIndex => ({ skillIndex, target: 118, endsAt })) });
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 8429': 500, 'varbit 8430': 500, 'varbit 8431': 500, 'varbit 13663': 500 });
  now += 600;
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 8429': 499, 'varbit 8430': 499, 'varbit 8431': 499, 'varbit 13663': 499 });
  f.attributes.set('potions:divine:state', null);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 8429': 0, 'varbit 8430': 0, 'varbit 8431': 0, 'varbit 13663': 0 });
});

test('divineattack_potion_base holds the locked Attack level while the lock lasts, then 0', t => {
  let now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  const endsAt = now + 300_000;
  const targets = [0, 2, 1].map(skillIndex => ({ skillIndex, target: 118, endsAt }));
  targets[0].base = 118;
  f.attributes.set('potions:divine:state', { endsAt, targets });
  f.tick();
  assert.equal(f.sent()['varbit 8434'], 118);
  targets[0].target = 110;
  now += 600;
  f.tick();
  assert.equal(f.sent()['varbit 8434'], undefined, 'a drain keeps the drink level');
  now = endsAt;
  f.tick();
  assert.equal(f.sent()['varbit 8434'], 0, 'cleared with the timer');
});

test('a divine bastion sets ranged, defence and bastion, not combat', t => {
  const now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  const endsAt = now + 300_000;
  f.attributes.set('potions:divine:state', { endsAt, targets: [4, 1].map(skillIndex => ({ skillIndex, target: 112, endsAt })) });
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 8431': 500, 'varbit 8432': 500, 'varbit 13664': 500 });
});

test('a divine ranging after a divine super combat does not show divine bastion', t => {
  const now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  const combat = now + 200_000, ranging = now + 300_000;
  f.attributes.set('potions:divine:state', {
    endsAt: ranging,
    targets: [[0, combat], [2, combat], [1, combat], [4, ranging]].map(([skillIndex, endsAt]) => ({ skillIndex, target: 110, endsAt })),
  });
  f.tick();
  const sent = f.sent();
  assert.equal(sent['varbit 13663'], 334, 'the combat potion');
  assert.equal(sent['varbit 8432'], 500, 'the ranging potion');
  assert.equal(sent['varbit 13664'], undefined, 'no bastion was drunk');
});

test('the Menaphite remedy counts steps of 25 ticks on statrenewal_potion_timer', t => {
  const now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  f.attributes.set('potions:menaphite:state', { endsAt: now + 300_000, nextRestoreAt: now + 15_000 });
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 14448': 20 });
});

test('the raid prayer enhance: tier, rate and 6-tick steps; the raid overload: tier and 25-tick steps', t => {
  const now = 9_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = loggedIn();
  f.attributes.set('potions:prayer-enhance', { endsAt: now + 480 * 600, nextAt: now + 3600, area: 'chambers-of-xeric', tier: 3 });
  f.attributes.set('potions:overload:state', { endsAt: now + 300_000, area: 'chambers-of-xeric', tier: 2 });
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 12397': 3, 'varbit 5419': 6, 'varbit 5417': 80, 'varbit 5420': 2, 'varbit 5418': 20 });
  f.attributes.set('potions:prayer-enhance', null);
  f.attributes.set('potions:overload:state', { endsAt: now + 300_000 }); // an overload outside the raid has no tier
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 12397': 0, 'varbit 5419': 0, 'varbit 5417': 0, 'varbit 5420': 0, 'varbit 5418': 0 });
});

test('the Arceuus corruption, its cooldowns and a thrall go on their varbits', () => {
  const f = loggedIn();
  f.attributes.set('arceuus:corruption', 12);
  f.attributes.set('arceuus:corruption-cooldown', f.world.cycle + 50);
  f.attributes.set('arceuus:shadow-veil-cooldown', f.world.cycle + 50);
  f.attributes.set('arceuus:ward-cooldown', f.world.cycle + 50);
  f.attributes.set('arceuus:thrall-until', f.world.cycle + 17);
  f.attributes.set('arceuus:thrall', {});
  f.tick();
  assert.deepEqual(f.sent(), {
    'varbit 12136': 2, 'varbit 12288': 1, 'varbit 12291': 1, 'varbit 12293': 1, 'varbit 12290': 1, 'varbit 12413': 1,
  });
  f.world.cycle += 17;
  f.attributes.set('arceuus:corruption', 6);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 12136': 1, 'varbit 12290': 0 }, 'the thrall cooldown ends after 17 ticks');
  f.world.cycle += 33;
  f.attributes.set('arceuus:corruption', null);
  f.attributes.set('arceuus:thrall', null);
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 12136': 0, 'varbit 12288': 0, 'varbit 12291': 0, 'varbit 12293': 0, 'varbit 12413': 0 });
});

test('the ammo slot goes on buff_bar_ammo_type and buff_bar_ammo_amount', () => {
  const f = fixture();
  f.slots.set(AMMUNITION_SLOT, { getId: () => 11875, getAmount: () => 1228 });
  f.login();
  assert.deepEqual(f.sent(), { 'varp 3158': 11875, 'varp 3159': 1228, 'varp 3160': -1, 'varp 4007': -1 });
  f.slots.set(AMMUNITION_SLOT, { getId: () => 11875, getAmount: () => 1227 });
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 3159': 1227 });
  f.slots.delete(AMMUNITION_SLOT);
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 3158': -1, 'varp 3159': 0 });
});

test('the group woodcutting bonus: 96 while chopping, the players at the tree and one less', () => {
  const f = fixture({ players: 2 });
  f.login();
  assert.deepEqual(f.sent(), { 'varp 3158': -1, 'varp 3160': -1, 'varp 4007': 96, 'varbit 15347': 2, 'varbit 15348': 1 });
  f.group.players = 1;
  f.tick();
  assert.deepEqual(f.sent(), { 'varbit 15347': 1, 'varbit 15348': 0 }, 'alone at the tree: no bonus shown');
  f.group.players = 0;
  f.tick();
  assert.deepEqual(f.sent(), { 'varp 4007': -1, 'varbit 15347': 0 });
});

test('logout forgets the effect timers, so the next login resends the running ones', () => {
  const f = loggedIn();
  f.attributes.set('charge:until', f.world.cycle + 100);
  f.tick();
  f.sent();
  plugin._test.sync(f.player, true);
  assert.equal(f.sent()['varp 272'], 50);
});
