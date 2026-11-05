const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const H = require('./helpers/leviathan.cjs');
const Model = require('../plugins/bosses/leviathan/Model.Leviathan');
before(H.initialize);

test('normal opening replays six three-tick shots, delayed roar and subsequent eight-shot volleys', t => {
  const h = H.harness(t), launches = [], roars = [];
  h.move([2075, 6377]);
  t.mock.method(h.fight, 'orb', (style, flight) => launches.push([h.fight.tick, flight]));
  t.mock.method(h.fight, 'roar', () => roars.push(h.fight.tick));
  h.step(65);
  assert.deepEqual(launches.slice(0, 6), [4,7,10,13,16,19].map(t => [t,5]));
  assert.deepEqual(launches.slice(6, 14), [27,29,31,33,35,37,39,41].map(t => [t,5]));
  assert.deepEqual(launches.slice(14), [48,50,52,54,56,58,60,62].map(t => [t,4]));
  assert.deepEqual(roars, [22,43,64]);
});

test('ordinary one-tick volleys have twelve then ten shots and retain tier-specific reaction time', () => {
  assert.deepEqual([0,1,2,3,4,5,6].map(n => Model.volley(n).shots), [6,8,8,12,10,10,10]);
  assert.deepEqual([0,1,2,3,4,5,6].map(n => Model.volley(n).flight), [5,5,4,3,3,2,1]);
});

test('normal natural progression replays the filmed late counts and seven-tick last-to-next gaps', t => {
  const h = H.harness(t), launches = [];
  h.move([2075, 6377]);
  t.mock.method(h.fight, 'orb', () => launches.push([h.fight.tick, h.fight.tier]));
  t.mock.method(h.fight, 'roar', () => {});
  h.step(160);
  const group = tier => launches.filter(([, n]) => n === tier).map(([tick]) => tick);
  assert.deepEqual(group(3), Array.from({length:12}, (_, n) => 69+n));
  assert.deepEqual(group(4), Array.from({length:10}, (_, n) => 87+n));
  assert.deepEqual(group(5), Array.from({length:10}, (_, n) => 103+n));
  assert.deepEqual(group(6), [119,135,151].flatMap(start => Array.from({length:10}, (_, n) => start+n)));
});

test('a normal late-recovery stun prevents the next volley', t => {
  const h = H.harness(t), launches = [];
  h.move([2075, 6377]);
  h.fight.tier = 5;
  t.mock.method(h.fight, 'orb', () => launches.push(h.fight.tick));
  t.mock.method(h.fight, 'roar', () => {});
  h.step(19);
  assert.deepEqual(launches, Array.from({length:10}, (_, n) => 4+n));
  h.fight.stun();
  h.step(3);
  assert.equal(h.fight.stunnedUntil > h.fight.tick, true);
  assert.equal(launches.length,10);
});

test('inaccessible awakened mode retains its previous provisional late-volley schedule', t => {
  const h = H.harness(t, true), launches = [];
  h.move([2075, 6377]);
  h.fight.tier = 5;
  t.mock.method(h.fight, 'orb', () => launches.push(h.fight.tick));
  t.mock.method(h.fight, 'roar', () => {});
  h.step(32);
  assert.deepEqual(launches, [4,21].flatMap(start => Array.from({length:12}, (_, n) => start+n)));
});

test('normal enrage delays pathfinder three ticks and the next volley five; falling debris repeats without interrupting orbs', t => {
  const h = H.harness(t), launches = [], debris = [], chip = [];
  h.move([2075, 6377]);
  t.mock.method(h.fight, 'orb', (style, flight) => launches.push([h.fight.tick, flight]));
  t.mock.method(h.fight.hazards, 'roar', () => debris.push(h.fight.tick));
  t.mock.method(h.Common, 'damage', (...args) => chip.push(h.fight.tick));
  h.fight.boss.setHitpoints(180);
  h.step();
  assert.equal(h.fight.hazards.pathReady(), false);
  h.step(2); assert.equal(h.fight.hazards.pathReady(), false);
  h.step(); assert.ok(h.fight.hazards.pathfinder?.isRegistered());
  h.step(16);
  assert.deepEqual(launches, [6,8,10,12,14,16,18,20].map(t => [t,5]));
  assert.deepEqual(debris, [1,9,17]);
  assert.deepEqual(chip, [2], 'only the entry roar chips; ongoing debris does not add repeated roar damage');
});

test('stunning during the last-shot gap cancels that queued roar rather than interrupting the stun', t => {
  const h = H.harness(t), roars = [];
  h.move([2075, 6377]);
  t.mock.method(h.fight, 'orb', () => {});
  t.mock.method(h.fight, 'roar', () => roars.push(h.fight.tick));
  h.step(19);
  h.fight.stun();
  h.step(3);
  assert.equal(h.fight.stunnedUntil > h.fight.tick, true);
  assert.deepEqual(roars, []);
});

test('early orbs apply after five ticks and roar chip lands one tick after the roar', t => {
  const h = H.harness(t);
  h.fight.nextAttack = Infinity;
  t.mock.method(Math, 'random', () => 0.999);
  h.fight.orb('magic', Model.volley(0).flight);
  h.step(4); assert.equal(h.p.getHitpoints(), 99);
  h.step(); assert.equal(h.p.getHitpoints(), 67);
  h.fight.roar();
  assert.equal(h.p.getCombat().getHitQueue().getQueuedDamage(), 0);
  h.step(); assert.equal(h.p.getHitpoints(), 60);
});

test('recorded mouth origins and client-cycle launch parameters reach the real projectile sender', t => {
  const h = H.harness(t), sent = [];
  h.fight.nextAttack = Infinity;
  const sender = new Proxy({}, { get: (_, name) => name === 'sendProjectile' ? (...args) => sent.push(args) : () => sender });
  h.p.getPacketSender = () => sender;
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  for (const [tile, mouth] of [[[2075,6377],[2079,6374]], [[2078,6378],[2081,6374]], [[2087,6374],[2083,6372]], [[2072,6368],[2079,6370]]]) {
    h.move(tile); h.fight.orb('magic', 5);
    const args = sent.at(-1);
    assert.deepEqual(h.session.sourceTile(args[0]), [...mouth,0]);
    assert.deepEqual([args[3],args[5]*4,args[6]*4,args[8],args[9],args[10],args[11]], [150,550,100,30,30,124,null]);
  }
});

test('orb startup and consecutive one-tick launches use the corresponding captured spotanim variants', t => {
  const h = H.harness(t), graphics = [];
  t.mock.method(h.fight.boss, 'performGraphic', graphic => graphics.push(graphic.getId()));
  h.fight.tier = 0; h.fight.shots = 0;
  h.fight.orb('magic', 5);
  h.fight.tier = 3; h.fight.shots = 0;
  h.fight.orb('ranged', 3);
  h.fight.shots = 1;
  h.fight.orb('magic', 3); h.fight.orb('melee', 3);
  h.fight.enraged = true;
  h.fight.orb('ranged', 5);
  assert.deepEqual(graphics, [2486,2484,2483,2482,2484]);
});

test('one-tick orbs are drawn as a flight landing on their impact tick (#1862)', t => {
  const h = H.harness(t), sent = [];
  h.fight.nextAttack = Infinity;
  const sender = new Proxy({}, { get: (_, name) => name === 'sendProjectile' ? (...args) => sent.push(args) : () => sender });
  h.p.getPacketSender = () => sender;
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  h.move([2075,6377]);
  for (const flight of [1, 2, 5]) {
    h.fight.orb('magic', flight);
    const [end, delay] = [sent.at(-1)[3], sent.at(-1)[8]];
    assert.ok(end > delay + 1, `flight ${flight} lands after it launches`);
    assert.equal(Math.ceil(end / 30), flight, `flight ${flight} lands on its impact tick`);
  }
});
