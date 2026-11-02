const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../plugins/interface/BuffTimers.plugin');
const { ATTR_DRAGONFIRE_STATE, DragonfireProtectionTier } = require('../plugins/combat/DragonfireProtection');

const ANTIFIRE_SECONDS = 7990, ANTIFIRE_TYPE = 7991, TELEBLOCK_SECONDS = 7992, STAMINA_SECONDS = 7993;

function timer(seconds = 0) {
  return { seconds, secondsRemaining() { return this.seconds; }, finished() { throw new Error('finished() stops the timer'); } };
}

function fixture() {
  const hooks = {};
  plugin.register({
    onPlayerLogin: fn => { hooks.login = fn; },
    onPlayerProcess: fn => { hooks.process = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
  });
  const attributes = new Map(), configs = [];
  const fire = timer(), teleblock = timer();
  const player = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getFireImmunityTimer: () => fire, getTeleblockTimer: () => teleblock }),
    getPacketSender: () => ({ sendConfig: (id, value) => configs.push([id, value]) }),
  };
  const sent = () => Object.fromEntries(configs.splice(0));
  return { hooks, player, attributes, fire, teleblock, sent };
}

test('login sends every timer varp, cleared when nothing is active', t => {
  const f = fixture();
  f.hooks.login({ player: f.player });
  assert.deepEqual(f.sent(), { [ANTIFIRE_SECONDS]: 0, [ANTIFIRE_TYPE]: 0, [TELEBLOCK_SECONDS]: 0, [STAMINA_SECONDS]: 0 });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), {}, 'unchanged values are not resent each tick');
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
});

test('teleblock follows the combat teleblock timer, which survives relog', t => {
  const f = fixture();
  f.teleblock.seconds = 150;
  f.hooks.login({ player: f.player });
  assert.equal(f.sent()[TELEBLOCK_SECONDS], 150);
  f.teleblock.seconds = 149;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [TELEBLOCK_SECONDS]: 149 });
  f.teleblock.seconds = 0;
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [TELEBLOCK_SECONDS]: 0 });
});

test('stamina reads the potion deadline, including one shifted on relog', t => {
  let now = 5_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  f.attributes.set('potions:stamina:end', now + 120_000);
  f.hooks.login({ player: f.player });
  assert.equal(f.sent()[STAMINA_SECONDS], 120);
  f.attributes.set('potions:stamina:end', now + 200_000);
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [STAMINA_SECONDS]: 200 });
  f.attributes.set('potions:stamina:end', null);
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), { [STAMINA_SECONDS]: 0 });
});

test('logout forgets the player, so the next login resends everything', t => {
  const f = fixture();
  f.hooks.login({ player: f.player });
  f.sent();
  f.hooks.logout({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.equal(Object.keys(f.sent()).length, 4);
});

test('player bots get no timer varps', t => {
  const f = fixture();
  f.player.isPlayerBot = () => true;
  f.hooks.login({ player: f.player });
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), {});
});
