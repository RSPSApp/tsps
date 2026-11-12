const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const H = require('./helpers/duke-sucellus.cjs');
const Drops = require('../plugins/npcs/NpcDrops.plugin');
const table = require('../data/definitions/npc-drops.json').tables.duke_sucellus;

before(H.initialize);

function fixture(t) {
  const h = H.harness(t);
  // Rendering and scheduling use the encounter harness; the context event bus,
  // Player/HitQueue, NPC lethal-damage path and canonical loot consumer are real.
  h.api.getItemOnGroundManager = () => ({});
  Drops.register(h.api);
  // The imported table carries the ordered Forgotten Four chain, so the real state plugin is registered too.
  require('../plugins/npcs/ForgottenFourRewards.plugin').register(h.api);
  const s = h.enter();
  s.fight.wake();
  s.fight.nextAttack = Infinity;
  const random = t.mock.method(Math, 'random', () => .99);
  const damage = options => {
    const hp = h.p.getHitpoints();
    h.C.hurt(s.fight, 1, options);
    h.step();
    assert.equal(h.p.getHitpoints(), hp - 1, 'queued damage actually reaches the player');
  };
  const die = () => {
    s.boss.setHitpoints(1);
    s.boss.decrementHealth(new h.core.HitDamage(1, h.core.HitMask.RED));
    assert.equal(s.boss.getHitpoints(), 0);
    assert.equal(s.fight.over, true, 'real NPC lethal damage freezes the grade synchronously');
  };
  const loot = (player = h.p, npc = s.boss) => {
    // Slot zero selects the first canonical main-table row. Keep every other
    // entry/tertiary intact: there is no synthetic quantity or supplied context.
    // Every ordered-chain stage must miss (one draw each) so the roll reaches the flat main table.
    let draws = 0;
    random.mock.mockImplementation(() => (draws++ < table.reward_chain.stages.length ? .99 : .005));
    const drops = Drops.__internals.rollTable(table, player, npc);
    const bronze = drops.find(drop => drop.itemId === 1103);
    assert.ok(bronze, 'full canonical Duke table rolled Bronze chainbody');
    assert.equal(bronze.noted, true);
    return bronze.amount;
  };
  return { h, s, damage, die, loot };
}

test('clean Duke death selects the canonical perfect quantity only after real lethal damage', t => {
  const f = fixture(t);
  assert.equal(f.loot(), 11, 'a living encounter cannot claim perfect rewards');
  f.die();
  assert.equal(f.loot(), 17);
});

test('applied avoidable Duke damage selects the canonical ordinary quantity', t => {
  const f = fixture(t);
  f.damage();
  f.die();
  assert.equal(f.loot(), 11);
});

test('applied unavoidable Duke chip preserves the canonical perfect quantity', t => {
  const f = fixture(t);
  f.damage({ avoidable: false });
  f.die();
  assert.equal(f.loot(), 17);
});

test('pending avoidable damage is cancelled at Duke lethal damage before loot grading', t => {
  const f = fixture(t), hp = f.h.p.getHitpoints();
  const pending = f.h.C.hurt(f.s.fight, 1);
  f.die();
  assert.equal(pending.getDamage(), 0);
  assert.equal(f.h.p.getHitpoints(), hp);
  assert.equal(f.loot(), 17);
});

test('foreign player and stale encounter cannot consume Duke perfect context', t => {
  const f = fixture(t);
  f.die();
  assert.equal(f.loot({}, f.s.boss), 11);
  const fight = f.s.fight;
  try {
    f.s.fight = {};
    assert.equal(f.loot(), 11);
  } finally {
    f.s.fight = fight;
  }
});
