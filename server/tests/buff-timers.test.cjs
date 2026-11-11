const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../plugins/interface/BuffTimers.plugin');
const { ATTR_DRAGONFIRE_STATE, ATTR_DRAGONFIRE_TIER, DragonfireProtectionTier } = require('../plugins/combat/DragonfireProtection');

const ANTIFIRE_SECONDS = 7990, ANTIFIRE_TYPE = 7991, TELEBLOCK_SECONDS = 7992, STAMINA_SECONDS = 7993;
/** The other timed effects' slots (seconds, icon) from 7950, sent with the rest at login. */
const EMPTY_ITEM_SLOTS = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [7950 + i, 0]));
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
  plugin.register({
    onPlayerLogin: fn => { hooks.login = fn; },
    onPlayerProcess: fn => { hooks.process = fn; },
    onPlayerLogout: fn => { hooks.logout = fn; },
  });
  const attributes = new Map(), configs = [], varbits = [];
  const fire = timer(), teleblock = timer();
  const player = {
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getCombat: () => ({ getFireImmunityTimer: () => fire, getTeleblockTimer: () => teleblock }),
    getPacketSender: () => ({ sendConfig: (id, value) => configs.push([id, value]), sendVarbit: (id, value) => varbits.push([id, value]) }),
  };
  const sent = () => Object.fromEntries(configs.splice(0));
  const bits = () => Object.fromEntries(varbits.splice(0));
  return { hooks, player, attributes, fire, teleblock, sent, bits };
}

test('login sends every timer varp, cleared when nothing is active', t => {
  const f = fixture();
  f.hooks.login({ player: f.player });
  assert.deepEqual(f.sent(), { ...EMPTY_ITEM_SLOTS, [ANTIFIRE_SECONDS]: 0, [ANTIFIRE_TYPE]: 0, [TELEBLOCK_SECONDS]: 0, [STAMINA_SECONDS]: 0 });
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
  assert.deepEqual(f.sent(), { ...EMPTY_ITEM_SLOTS, [ANTIFIRE_SECONDS]: 300, [ANTIFIRE_TYPE]: 1, [TELEBLOCK_SECONDS]: 0, [STAMINA_SECONDS]: 0 });
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
  assert.equal(Object.keys(f.sent()).length, 4 + 40);
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

// The other timed effects: each slot is the seconds left and the item whose icon the client shows.
const core = {
  ItemIdentifiers: {
    DIVINE_SUPER_COMBAT_POTION_4_: 23685, DIVINE_SUPER_ATTACK_POTION_4_: 23697, DIVINE_SUPER_STRENGTH_POTION_4_: 23709,
    DIVINE_SUPER_DEFENCE_POTION_4_: 23721, DIVINE_RANGING_POTION_4_: 23733, DIVINE_MAGIC_POTION_4_: 23745,
    DIVINE_BATTLEMAGE_POTION_4_: 24623, DIVINE_BASTION_POTION_4_: 24635, OVERLOAD_4_: 11730, OVERLOAD_4__4: 20992,
    MENAPHITE_REMEDY_4_: 27202, PRAYER_REGENERATION_POTION_4_: 30125, PRAYER_ENHANCE_4_: 20968,
    SUPERANTIPOISON_4_: 2448, GOADING_POTION_4_: 30137, IMBUED_HEART: 20724, SATURATED_HEART: 27641,
    SMELLING_SALTS_2_: 27343, LIQUID_ADRENALINE_2_: 27339, BLESSED_CRYSTAL_SCARAB_2_: 27335, SILK_DRESSING_2_: 27323,
    DRAGON_DAGGER: 1215,
  },
  Skill: Object.fromEntries(['ATTACK', 'DEFENCE', 'STRENGTH', 'HITPOINTS', 'RANGED', 'PRAYER', 'MAGIC'].map((name, i) => [name, { getIndex: () => i }])),
  CacheDefinitions: { getVarbitId: name => (name === 'goading_potion_timer' ? 13000 : null) },
};

test('item timers: divine potions told apart, overloads, Menaphite, prayer regeneration, immunity, goading, the heart', t => {
  const now = 2_000_000;
  t.mock.method(Date, 'now', () => now);
  plugin._test.setCore(core);
  const attributes = new Map([
    // Divine super combat (attack, strength, defence) and, later, divine ranging.
    ['potions:divine:state', { endsAt: now + 300_000, targets: [
      { skillIndex: 0, endsAt: now + 200_000 }, { skillIndex: 2, endsAt: now + 200_000 }, { skillIndex: 1, endsAt: now + 200_000 },
      { skillIndex: 4, endsAt: now + 300_000 }] }],
    ['potions:overload:state', { endsAt: now + 60_000, area: 'raid' }],
    ['potions:menaphite:state', { endsAt: now + 120_000 }],
    // 10 steps left, the next in 3 ticks: 3 + 9 * 12 ticks.
    ['potions:prayer-regen:state', { left: 10, nextRestoreAt: now + 1800 }],
    ['imbued-heart:ready-at', now + 420_000],
  ]);
  const player = {
    getAttribute: key => attributes.get(key),
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ secondsRemaining: () => 90, millisRemaining: () => 90_000 }) }),
    getPacketSender: () => ({ getVarbit: id => (id === 13000 ? 50 : 0) }),
  };
  const timers = plugin._test.itemTimers(player, now);
  assert.deepEqual(timers, [
    [200_000, 23685], [300_000, 23733], [60_000, 20992], [120_000, 27202],
    [1800 + 9 * 7200, 30125], [90_000, 2448], [50 * 3600, 30137], [420_000, 20724],
  ]);
  const state = Object.fromEntries(plugin._test.getState(player, now).filter(([kind]) => kind === 'varp').map(([, id, value]) => [id, value]));
  assert.equal(state[7950], 200, 'slot 1: seconds');
  assert.equal(state[7951], 23685, 'slot 1: the divine super combat potion');
  assert.equal(state[7966], 0, 'slot 9 is empty');
  plugin._test.setCore(null);
});

test('divine potions by their skills: bastion, battlemage and the single-skill ones', t => {
  const now = 2_000_000;
  plugin._test.setCore(core);
  const divine = targets => plugin._test.itemTimers({
    getAttribute: key => (key === 'potions:divine:state' ? { endsAt: now + 1000, targets } : undefined),
  }, now).map(([, item]) => item);
  assert.deepEqual(divine([{ skillIndex: 4, endsAt: now + 1000 }, { skillIndex: 1, endsAt: now + 1000 }]), [24635], 'ranged and defence: bastion');
  assert.deepEqual(divine([{ skillIndex: 6, endsAt: now + 1000 }, { skillIndex: 1, endsAt: now + 1000 }]), [24623], 'magic and defence: battlemage');
  assert.deepEqual(divine([{ skillIndex: 2, endsAt: now + 1000 }]), [23709], 'strength alone');
  assert.deepEqual(divine([{ skillIndex: 6, endsAt: now + 1000 }]), [23745], 'magic alone');
  plugin._test.setCore(null);
});

test('spell timers (minus their sprite), the home teleport, Tombs of Amascut supplies and special attack regeneration', t => {
  const now = 60_000 * 1_000_000 + 15_000, cycle = 5000;
  const ARCEUUS = {};
  plugin._test.setCore({ ...core, World: { getProcessCycle: () => cycle }, MagicSpellbook: { ARCEUUS } });
  const attributes = new Map([
    ['charge:until', cycle + 10],
    ['lunar:magic-imbue-until', cycle], // ended this tick
    ['arceuus:mark-until', cycle + 99],
    ['arceuus:death-charge-until', null], // spent on a kill: its cooldown shows
    ['arceuus:death-charge-cooldown', cycle + 40],
    ['arceuus:thrall-until', cycle + 17],
    ['home-teleport:last-minute', 1_000_000 - 10], // 20 minutes left, less the 15 seconds into this minute
    ['toa:supply-effects', { salts: 800, scarab: 0, silk: 3, adrenaline: 250 }],
  ]);
  let book = ARCEUUS, spec = 60;
  const player = {
    getAttribute: key => attributes.get(key),
    getSpellbook: () => book,
    getSpecialPercentage: () => spec,
    getSpecialAttackRestore: () => ({ secondsRemaining: () => 12, millisRemaining: () => 11_400 }),
  };
  assert.deepEqual(plugin._test.itemTimers(player, now), [
    [6000, -322], [59_400, -1305], [24_000, -1310], [10_200, -2980], [20 * 60_000 - 15_000, -1251],
    [480_000, 27343], [150_000, 27339], [1800, 27323], [11_400, 1215],
  ]);
  book = {};
  spec = 100;
  const timers = plugin._test.itemTimers(player, now);
  assert.deepEqual(timers.find(([, icon]) => icon === -356), [20 * 60_000 - 15_000, -356], "the other spellbooks' home teleport icon");
  assert.equal(timers.some(([, icon]) => icon === 1215), false, 'no special attack timer at full energy');
  const state = Object.fromEntries(plugin._test.getState(player, now).filter(([kind]) => kind === 'varp').map(([, id, value]) => [id, value]));
  assert.equal(state[7951], -322, 'a sprite is sent as minus its id');
  plugin._test.setCore(null);
});
