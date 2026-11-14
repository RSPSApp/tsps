const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../plugins/interface/BuffTimers.plugin');
const { ATTR_DRAGONFIRE_STATE, ATTR_DRAGONFIRE_TIER, DragonfireProtectionTier } = require('../plugins/combat/DragonfireProtection');

const ANTIFIRE_SECONDS = 7990, ANTIFIRE_TYPE = 7991, TELEBLOCK_SECONDS = 7992, STAMINA_SECONDS = 7993;
// The buff bar's own varbits: antifire_potion, super_antifire_potion, teleblock_cycles, stamina_duration, stamina_active.
const ANTIFIRE = 3981, SUPER_ANTIFIRE = 6101, TELEBLOCK = 4163, STAMINA = 24, STAMINA_ACTIVE = 25;

function timer(seconds = 0) {
  return {
    seconds,
    millis: undefined,
    secondsRemaining() { return this.seconds; },
    millisRemaining() { return this.millis ?? this.seconds * 1000; },
    finished() { throw new Error('finished() stops the timer'); },
  };
}

function fixture() {
  const hooks = {};
  const world = { cycle: 24462 };
  plugin.register({
    core: { World: { getProcessCycle: () => world.cycle } },
    onPlayerLogin: fn => { hooks.login = fn; },
    onPlayerProcess: fn => { hooks.process = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
  });
  const attributes = new Map(), configs = [], varbits = [], scripts = [];
  const fire = timer(), teleblock = timer();
  const player = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getFireImmunityTimer: () => fire, getTeleblockTimer: () => teleblock }),
    getPacketSender: () => ({ sendConfig: (id, value) => configs.push([id, value]), sendVarbit: (id, value) => varbits.push([id, value]), sendClientScript: (...args) => scripts.push(args) }),
  };
  const sent = () => Object.fromEntries(configs.splice(0));
  const bits = () => Object.fromEntries(varbits.splice(0));
  const started = () => scripts.splice(0);
  return { hooks, player, attributes, fire, teleblock, sent, bits, started, world };
}

test('login sends every timer varp, cleared when nothing is active', t => {
  const f = fixture();
  f.hooks.login({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 0, [ANTIFIRE_TYPE]: 0, [TELEBLOCK_SECONDS]: 0, [STAMINA_SECONDS]: 0 });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 0, [SUPER_ANTIFIRE]: 0, [TELEBLOCK]: 0, [STAMINA]: 0, [STAMINA_ACTIVE]: 0 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), {}, 'unchanged values are not resent each tick');
  assert.deepEqual(f.bits(), {});
});

test('the buff bar gets antifire in steps of 30 ticks and super antifire in steps of 20', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.hooks.login({ player: f.player });
  f.bits();
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.ANTIFIRE, endsAt: now + 360_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 20 }, 'a fresh antifire: 600 ticks');
  now += 600;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), {}, 'a step stays until its last tick has passed');
  now += 29 * 600;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 19 });
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.SUPER_ANTIFIRE, endsAt: now + 180_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 0, [SUPER_ANTIFIRE]: 15 }, 'a super antifire replaces it: 300 ticks');
  f.attributes.set(ATTR_DRAGONFIRE_STATE, null); // cleared by death or a duel's no-potions rule
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [SUPER_ANTIFIRE]: 0 });
});

// rsprox rec 1002134 (rev 242): each extended antifire drink sends buff_bar_start [3102, that tick's map_clock]
// after antifire_potion; rec 1001569 (rev 241): super antifire, [3103, map_clock]. cs2 5923 draws neither
// buff while its varc (484, 485), which only buff_bar_start sets, is 0.
test('each antifire drink starts the buff bar entry with the map_clock tick, after the varbit', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [], 'nothing to start without a protection');
  f.bits();
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.ANTIFIRE, endsAt: now + 720_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 40 });
  assert.deepEqual(f.started(), [[5931, 3102, 24462]]);
  f.world.cycle += 1;
  now += 600;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [], 'started once per drink');
  f.world.cycle += 1205;
  now += 1205 * 600;
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.ANTIFIRE, endsAt: now + 720_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [[5931, 3102, 25668]], 'a new drink starts it again');
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.SUPER_ANTIFIRE, endsAt: now + 180_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [[5931, 3103, 25668]], 'a super antifire starts the Superior antifire buff');
  f.attributes.set(ATTR_DRAGONFIRE_STATE, null);
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [], 'the varbit going to 0 hides it; no clear is sent');
});

test('after a relog the running antifire buff is started again', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  const state = { tier: DragonfireProtectionTier.SUPER_ANTIFIRE, endsAt: now + 180_000 };
  f.attributes.set(ATTR_DRAGONFIRE_STATE, state);
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [[5931, 3103, 24462]]);
  f.hooks.logout({ player: f.player });
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [[5931, 3103, 24462]], 'the same state still gets a start after a login');
  now = state.endsAt;
  f.hooks.logout({ player: f.player });
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.started(), [], 'an expired protection is not started');
});

test('after a relog a super antifire stays on the super antifire varbit', t => {
  const f = fixture();
  f.fire.seconds = 120;
  f.attributes.set(ATTR_DRAGONFIRE_TIER, { tier: DragonfireProtectionTier.SUPER_ANTIFIRE, label: 'super antifire potion' });
  f.hooks.login({ player: f.player });
  assert.equal(f.sent()[ANTIFIRE_TYPE], 2);
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 0, [SUPER_ANTIFIRE]: 10, [TELEBLOCK]: 0, [STAMINA]: 0, [STAMINA_ACTIVE]: 0 });
});

test('antifire reads the dragonfire protection deadline and tier', t => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.hooks.login({ player: f.player });
  f.sent();
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.ANTIFIRE, endsAt: now + 720_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 720, [ANTIFIRE_TYPE]: 1 });
  now += 1_500;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 719 }, 'partial seconds round up');
  f.attributes.set(ATTR_DRAGONFIRE_STATE, { tier: DragonfireProtectionTier.SUPER_ANTIFIRE, endsAt: now + 180_000 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 180, [ANTIFIRE_TYPE]: 2 });
  now += 180_000;
  f.fire.seconds = 1; // the whole-second timer can lag the deadline; an expired state wins
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 0, [ANTIFIRE_TYPE]: 0 });
});

test('after a relog antifire falls back to the saved fire immunity timer', t => {
  const f = fixture();
  f.fire.seconds = 300;
  f.hooks.login({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 300, [ANTIFIRE_TYPE]: 1, [TELEBLOCK_SECONDS]: 0, [STAMINA_SECONDS]: 0 });
  assert.deepEqual(f.bits(), { [ANTIFIRE]: 17, [SUPER_ANTIFIRE]: 0, [TELEBLOCK]: 0, [STAMINA]: 0, [STAMINA_ACTIVE]: 0 }, '500 ticks left');
});

test('teleblock follows the combat teleblock timer, which survives relog', t => {
  const f = fixture();
  f.teleblock.seconds = 150;
  f.hooks.login({ player: f.player });
  assert.equal(f.sent()[TELEBLOCK_SECONDS], 150);
  assert.equal(f.bits()[TELEBLOCK], 250, 'the buff bar counts ticks');
  f.teleblock.seconds = 149;
  f.teleblock.millis = 149_400;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [TELEBLOCK_SECONDS]: 149 });
  assert.deepEqual(f.bits(), { [TELEBLOCK]: 249 }, 'one tick per tick, not whole seconds');
  f.teleblock.seconds = 0; // expired, or cleared on death
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [TELEBLOCK_SECONDS]: 0 });
  assert.deepEqual(f.bits(), { [TELEBLOCK]: 0 });
});

test('stamina reads the potion deadline, including one shifted on relog', t => {
  let now = 5_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.attributes.set('potions:stamina:end', now + 120_000);
  f.hooks.login({ player: f.player });
  assert.equal(f.sent()[STAMINA_SECONDS], 120);
  const atLogin = f.bits();
  assert.equal(atLogin[STAMINA], 20, 'a dose: 200 ticks in steps of 10');
  assert.equal(atLogin[STAMINA_ACTIVE], 1);
  now += 9 * 600;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), {}, 'a step stays until its last tick has passed');
  now += 600;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.bits(), { [STAMINA]: 19 });
  f.attributes.set('potions:stamina:end', now + 200_000);
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [STAMINA_SECONDS]: 200 });
  assert.deepEqual(f.bits(), { [STAMINA]: 34 }, 'a refresh');
  f.attributes.set('potions:stamina:end', null);
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [STAMINA_SECONDS]: 0 });
  assert.deepEqual(f.bits(), { [STAMINA]: 0, [STAMINA_ACTIVE]: 0 });
});

test('logout forgets the player, so the next login resends everything', t => {
  const f = fixture();
  f.hooks.login({ player: f.player });
  f.sent();
  f.hooks.logout({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.equal(Object.keys(f.sent()).length, 4);
  assert.equal(Object.keys(f.bits()).length, 5);
});

test('player bots get no timer varps', t => {
  const f = fixture();
  f.player.isPlayerBot = () => true;
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), {});
  assert.deepEqual(f.bits(), {});
});
