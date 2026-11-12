// Run after `yarn build`: node --test tests/kbd-antifire-protection.test.cjs
// Wiki (Antifire Protection): "Kill the King Black Dragon with an antifire potion active and an
// antidragon shield equipped." The dragonfire shield, dragonfire ward and ancient wyvern shield count too.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Dragonfire = require('../plugins/combat/DragonfireProtection');

let core, rule;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  const api = new Proxy({ core }, { get: (t, p) => (p in t ? t[p] : () => {}) });
  const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  Data(api);
  assert.equal(Data.taskNamed('Antifire Protection')?.description,
    'Kill the King Black Dragon with an antifire potion active and an antidragon shield equipped.');
  const captured = {};
  require('../plugins/achievements/combatachievements/tasks/KingBlackDragon.CombatAchievements')(
    { core }, { onKill: (name, tests) => { captured[name] = tests; } },
  );
  rule = captured['King Black Dragon']?.['Antifire Protection'];
  assert.equal(typeof rule, 'function');
});

/** A player wearing `shield` (an item name, or none) in the shield slot. */
function player(shield) {
  const attributes = new Map();
  const item = shield ? itemNamed(shield) : null;
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ get: (slot) => (slot === 5 ? item : null) }),
  };
}

function itemNamed(name) {
  for (let id = 0; id < 40000; id++) {
    const def = core.ItemDefinition.forId(id);
    if (def?.getName?.() === name && !def.isNoted()) return new core.Item(id, 1);
  }
  throw new Error(`no item ${name}`);
}

const drink = (p, tier = Dragonfire.DragonfireProtectionTier.ANTIFIRE) =>
  Dragonfire.setDragonfireProtection(p, { tier, seconds: 360, label: 'antifire potion' });

test('an antifire potion and an anti-dragon shield complete it', () => {
  const p = player('Anti-dragon shield');
  drink(p);
  assert.equal(rule({ player: p }), true);
});

test('a super antifire and the alternative shields count', () => {
  for (const shield of ['Dragonfire shield', 'Dragonfire ward', 'Ancient wyvern shield']) {
    const p = player(shield);
    drink(p, Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE);
    assert.equal(rule({ player: p }), true, shield);
  }
});

test('the shield alone, the potion alone, or an expired potion do not', () => {
  assert.equal(rule({ player: player('Anti-dragon shield') }), false, 'no potion');
  const unshielded = player(null);
  drink(unshielded);
  assert.equal(rule({ player: unshielded }), false, 'no shield');
  const other = player('Rune kiteshield');
  drink(other);
  assert.equal(rule({ player: other }), false, 'another shield');
  const expired = player('Anti-dragon shield');
  Dragonfire.setDragonfireProtection(expired, { tier: 1, seconds: 0.001, label: 'antifire potion' });
  const until = Date.now() + 5; while (Date.now() < until);
  expired.getPacketSender = () => ({ sendMessage() {} });
  assert.equal(rule({ player: expired }), false, 'the potion ran out');
});

test("other dragonfire immunity (a league relic's answer) is not an antifire potion", () => {
  // Brawler's Resolve answers combat:status-apply for dragonfire with allow: false.
  Dragonfire.initDragonfireProtectionCoreAccess({
    core,
    emitCustomEvent: (name, event) => { if (name === 'combat:status-apply' && event.kind === 'dragonfire') event.allow = false; },
  });
  try {
    const p = player('Anti-dragon shield');
    assert.equal(Dragonfire.getDragonfireProtectionTier(p), Dragonfire.DragonfireProtectionTier.SUPER_ANTIFIRE, 'the relic protects');
    assert.equal(rule({ player: p }), false, 'but no potion is active');
    drink(p);
    assert.equal(rule({ player: p }), true, 'with a potion too');
  } finally {
    Dragonfire.initDragonfireProtectionCoreAccess({ core });
  }
});
