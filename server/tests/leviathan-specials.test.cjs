const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const H = require('./helpers/leviathan.cjs');
before(H.initialize);
test('recorded roar rubble uses falling-stay graphics and lands seven ticks later with permanent first-roar tells', t => {
  const h = H.harness(t), graphics = [];
  h.fight.nextAttack = Infinity;
  h.move([2077, 6378]);
  h.fight.nextSpecial = 'smoke';
  t.mock.method(Math, 'random', () => 0.5);
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? (g, at) => graphics.push([g.getId(), g.getDelay(), h.session.sourceTile(at).slice(0, 2)]) : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.hazards.roar();
  const stays = () => graphics.filter(([id]) => id >= 2477 && id <= 2480);
  assert.deepEqual(stays(), [[2479, 50, [2077,6378]], [2479, 50, [2082,6365]], [2479, 50, [2081,6379]]]);
  // rsprox 227: 11-30 shattering rocks (2475/2476 at 20/50/80 cycles) fall beside the staying ones.
  const breaks = graphics.filter(([id]) => id === 2475 || id === 2476);
  assert.equal(breaks.length, 21);
  assert.ok(breaks.every(([, delay, at]) => [20, 50, 80].includes(delay) && h.fight.hazards.floor.has(at.join(','))));
  assert.equal(new Set(breaks.map(([, , at]) => at.join(','))).size, breaks.length, 'one shattering rock a tile');
  assert.ok(breaks.every(([, , at]) => !['2077,6378', '2082,6365', '2081,6379'].includes(at.join(','))));
  h.move([2076, 6378]);
  h.step(6);
  assert.equal(h.fight.hazards.blockers.size, 0);
  h.step();
  assert.deepEqual([...h.fight.hazards.blockers].sort(), ['2077,6378', '2081,6379', '2082,6365']);
  assert.deepEqual([...h.fight.hazards.objects.values()].map(o => o.getFace()), [2,2,2]);
  assert.equal(stays().length, 3, 'the falling-stay graphic already contains the impact');
  assert.equal(graphics.length, 3 + 21, 'nothing more is sent when the rocks land');
});
test('the first-roar side tell is not repeated by later volleys or enrage debris', t => {
  const h = H.harness(t);
  h.fight.nextAttack = Infinity;
  t.mock.method(Math, 'random', () => 0.5);
  h.move([2077, 6378]);
  h.fight.hazards.roar(); h.step(7);
  assert.equal(h.fight.hazards.blockers.size, 3);
  h.move([2076, 6378]);
  h.fight.hazards.roar(); h.step(7);
  assert.equal(h.fight.hazards.blockers.size, 4);
});
test('first-roar lightning tells use the recorded west/east regions and preserve rubble rotation', t => {
  const h = H.harness(t), graphics = [];
  h.fight.nextAttack = Infinity;
  h.fight.nextSpecial = 'lightning';
  h.move([2077, 6378]);
  t.mock.method(Math, 'random', () => 0.999);
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? (g, at) => graphics.push([g.getId(), g.getDelay(), h.session.sourceTile(at).slice(0, 2)]) : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.hazards.roar();
  assert.deepEqual(graphics.filter(([id]) => id >= 2477 && id <= 2480), [[2480, 50, [2077,6378]], [2480, 50, [2074,6373]], [2480, 50, [2090,6373]]]);
  h.move([2076, 6378]); h.step(7);
  assert.deepEqual([...h.fight.hazards.objects.values()].map(o => o.getFace()), [3,3,3]);
});
test('a landed boulder from the current smoke wave blocks its final blast', t => {
  const h = H.harness(t);
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  h.move([2075, 6371]);
  h.fight.nextSpecial = 'smoke';
  h.fight.beginSpecial();
  h.step(4);
  h.move([2074, 6379]);
  h.step(9);
  h.move([2074, 6371]);
  random = 0.999;
  h.step(6);
  assert.equal(h.fight.special, null);
  assert.equal(h.p.getHitpoints(), 99);
  assert.ok(h.fight.hazards.blockers.has('2075,6371'));
  assert.equal(h.fight.perfect, true);
});

test('roar rubble remains a movement blocker but does not shelter the player from smoke', t => {
  const h = H.harness(t);
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  h.fight.hazards.dropRoar([2075, 6371]);
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial();
  h.move([2074, 6379]); h.step(13);
  assert.ok(h.fight.hazards.blockers.has('2075,6371'));
  assert.ok(h.area.getClip(h.session.tile([2075,6371])) & h.core.RegionManager.BLOCKED_TILE);
  h.move([2074, 6371]); random = 0.999; h.step(6);
  assert.equal(h.p.getHitpoints(), 40);
  assert.equal(h.fight.perfect, false);
});

test('a previous smoke wave cannot shelter the player from a later smoke blast', t => {
  const h = H.harness(t);
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  h.move([2075, 6371]);
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial(); h.step(4);
  h.move([2074, 6379]); h.step(15);
  assert.ok(h.fight.hazards.blockers.has('2075,6371'));
  h.move([2088, 6378]);
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial(); h.step(13);
  h.move([2074, 6371]); random = 0.999; h.step(6);
  assert.equal(h.p.getHitpoints(), 40);
  assert.ok(h.fight.hazards.blockers.has('2075,6371'), 'old smoke rocks still block movement');
});
test('uncovered smoke applies damage and is not cancelled by entering enrage', t => {
  const h = H.harness(t);
  let random = 0;
  t.mock.method(Math, 'random', () => random);
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial();
  h.move([2074, 6379]);
  h.fight.boss.setHitpoints(180);
  h.step();
  assert.equal(h.fight.enraged, true);
  assert.equal(h.fight.special, 'smoke');
  h.step(12);
  h.move([2074, 6371]);
  random = 0.999;
  h.step(6);
  assert.equal(h.fight.special, null);
  assert.equal(h.p.getHitpoints(), 40);
  assert.equal(h.fight.perfect, false);
});
test('lightning strikes its marked tile later; moving avoids it and stationary contact fails perfection', t => {
  const h = H.harness(t);
  t.mock.method(Math, 'random', () => 0.999);
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial();
  h.step(5); h.move([2073, 6370]);
  h.step(); h.move([2074, 6370]);
  h.step();
  assert.equal(h.p.getHitpoints(), 99);
  h.step(2);
  assert.ok(h.p.getHitpoints() < 99);
  assert.equal(h.fight.perfect, false);
});

test('normal smoke preserves its filmed retaliation, throws, explosion charge and recovery', t => {
  const h = H.harness(t), throws = [], blasts = [];
  t.mock.method(Math, 'random', () => 0);
  const sender = new Proxy({}, { get: (_, name) => name === 'sendProjectile' ? (...args) => {
    if (args[4] === 2472) throws.push(h.fight.tick);
  } : name === 'sendGraphic' ? graphic => {
    if (graphic.getId() === 2494) blasts.push(h.fight.tick);
  } : () => sender });
  h.p.getPacketSender = () => sender;
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  h.fight.tier = 1;
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial();
  assert.equal(h.fight.boss.getAnimation().getId(), 10282);
  h.step(3);
  assert.equal(h.fight.boss.getAnimation().getId(), 10288);
  assert.deepEqual(throws, []);
  h.step(10);
  assert.deepEqual(throws, [4,5,6,7,8,9,10,11,12,13]);
  h.step();
  assert.equal(h.fight.boss.getAnimation().getId(), 10290);
  assert.deepEqual(blasts, []);
  h.step(2);
  assert.deepEqual(blasts, [16]);
  h.step(2);
  assert.equal(h.fight.special, 'smoke');
  h.step();
  assert.equal(h.fight.special, null);
  h.step();
  assert.equal(h.fight.boss.getGraphic()?.getId(), undefined, 'recovery ending is not the first orb startup');
  h.step();
  assert.equal(h.fight.tick, 21);
  assert.equal(h.fight.boss.getGraphic().getId(), 2486);
});

test('smoke sends a native rock to the snapshotted tile and its stay impact lands two ticks later', t => {
  const h = H.harness(t), projectiles = [], graphics = [];
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  const sender = new Proxy({}, { get: (_, name) => name === 'sendProjectile' ? (...args) => projectiles.push(args)
    : name === 'sendGraphic' ? (graphic, at) => graphics.push([h.fight.tick, graphic.getId(), h.session.sourceTile(at).slice(0, 2)]) : () => sender });
  h.p.getPacketSender = () => sender;
  h.move([2075, 6371]);
  h.fight.nextSpecial = 'smoke'; h.fight.beginSpecial(); h.step(4);
  assert.equal(projectiles.length, 1);
  assert.deepEqual([projectiles[0][4], projectiles[0][3], projectiles[0][8], projectiles[0][7]], [2472, 60, 0, 0]);
  assert.deepEqual(h.session.sourceTile(projectiles[0][1]), [2075,6371,0]);
  h.move([2074, 6379]); h.step();
  assert.equal(graphics.some(([, id]) => id === 2473), false);
  h.step();
  assert.ok(graphics.some(([tick, id, at]) => tick === 6 && id === 2473 && at.join(',') === '2075,6371'));
  assert.ok(h.fight.hazards.blockers.has('2075,6371'));
  assert.equal(graphics.some(([, id]) => id === 2506 || id === 2505), false, 'smoke rocks are neither cyan orbs nor orange smoke columns');
});

test('normal lightning sends five traveling cyan side orbs every six ticks and lands native bolts after eight ticks', t => {
  const h = H.harness(t), graphics = [], projectiles = [];
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? (graphic, at) => graphics.push([h.fight.tick, graphic.getId(), h.session.sourceTile(at).slice(0, 2)])
    : name === 'sendProjectile' ? (...args) => projectiles.push([h.fight.tick, args]) : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial(); h.step(4);
  assert.equal(projectiles.length, 0);
  h.step();
  assert.equal(projectiles.length, 5);
  assert.ok(projectiles.every(([,args]) => args[4] === 2506 && args[3] === 240 && args[8] === 0));
  const target = h.session.sourceTile(projectiles[0][1][1]).slice(0, 2);
  h.step(7);
  assert.equal(graphics.some(([,id,at]) => id === 2504 && at.join(',') === target.join(',')), false);
  h.step();
  assert.equal(graphics.filter(([tick,id,at]) => tick === 13 && id === 2504 && at.join(',') === target.join(',')).length, 5);
  h.step(30);
  assert.deepEqual(projectiles.map(([tick]) => tick), [5,11,17,23,29,35].flatMap(tick => Array(5).fill(tick)));
  assert.equal(graphics.some(([,id]) => [2472,2473,2505,2506].includes(id)), false,
    'side effects are neither smoke rocks, stationary cyan balls nor smoke columns');
  assert.equal(h.fight.hazards.blockers.size, 0);
});

test('lightning side-orb eligibility excludes the actual pool-adjacent ring but includes the next safe row', t => {
  const h = H.harness(t);
  let eligible;
  t.mock.method(h.Common, 'pick', tiles => { eligible = tiles; return tiles[0]; });
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial(); h.step(5);
  const has = tile => eligible.some(at => at.join(',') === tile.join(','));
  assert.equal(has([2081,6378]), true, 'two rows north of the water is a valid non-adjacent arena tile');
  assert.equal(has([2081,6377]), false, 'north pool adjacency');
  assert.equal(has([2076,6372]), false, 'west pool adjacency');
  assert.equal(has([2077,6367]), false, 'diagonal pool adjacency');
});

for (const outcome of ['hit', 'adjacent', 'death', 'departure']) test(`a flying normal side orb keeps its one-tile landing and damage boundary (${outcome})`, t => {
  const h = H.harness(t), target = [2075,6378];
  h.fight.nextAttack = Infinity;
  t.mock.method(h.Common, 'random', () => 17);
  h.move(target); h.prayer('magic');
  h.fight.hazards.drop(target, false, 8);
  target[0]++;
  h.step(7);
  assert.equal(h.p.getHitpoints(), 99, 'the ball has not landed');
  if (outcome === 'adjacent') h.move([2076,6378]);
  if (outcome === 'death') h.fight.fell();
  if (outcome === 'departure') h.fight.stop();
  h.step();
  assert.equal(h.p.getHitpoints(), outcome === 'hit' ? 82 : 99);
  assert.equal(h.fight.perfect, outcome !== 'hit');
  assert.equal(h.fight.hazards.blockers.size, 0);
});

test('disabled awakened lightning retains its prior stationary side presentation', t => {
  const h = H.harness(t, true), graphics = [], projectiles = [];
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(h.core.World, 'forEachNetworkPlayer', callback => callback(h.p));
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? graphic => graphics.push(graphic.getId())
    : name === 'sendProjectile' ? (...args) => projectiles.push(args) : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial(); h.step(3);
  assert.ok(graphics.includes(2506));
  assert.ok(graphics.includes(2505));
  assert.equal(projectiles.length, 0);
});

test('normal lightning stages its native animations and thirty-five pulses across the filmed phase', t => {
  const h = H.harness(t), warnings = [], strikes = [];
  t.mock.method(Math, 'random', () => 0);
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? (graphic, at) => {
    if (graphic.getId() === 2503) warnings.push(h.fight.tick);
    if (graphic.getId() === 2504 && h.session.sourceTile(at).slice(0,2).join(',') === h.fight.hazards.playerTile().join(',')) strikes.push(h.fight.tick);
  } : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.tier = 1;
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial();
  assert.equal(h.fight.boss.getAnimation().getId(), 10285);
  h.step(2);
  assert.deepEqual(warnings, []);
  h.step();
  assert.equal(h.fight.boss.getAnimation().getId(), 10286);
  h.step(2);
  assert.deepEqual(warnings, [5]);
  assert.deepEqual(strikes, []);
  h.step(2);
  assert.deepEqual(strikes, [7]);
  h.step(34);
  assert.equal(warnings.length, 35);
  assert.equal(strikes.length, 35);
  assert.equal(warnings.at(-1), 39);
  assert.equal(strikes.at(-1), 41);
  h.step();
  assert.equal(h.fight.boss.getAnimation().getId(), 10287);
  h.step();
  assert.equal(h.fight.special, 'lightning', 'the native end animation must finish before normal attacks resume');
  h.step();
  assert.equal(h.fight.special, null);
  h.step();
  assert.equal(h.fight.boss.getGraphic()?.getId(), undefined, 'the normal volley still waits its attack interval');
  h.step();
  assert.equal(h.fight.tick, 46);
  assert.equal(h.fight.boss.getGraphic().getId(), 2486);
});

test('the documented low-health lightning launches a tick earlier than its normal-health counterpart', t => {
  const h = H.harness(t, false, 25), strikes = [];
  t.mock.method(Math, 'random', () => 0);
  const sender = new Proxy({}, { get: (_, name) => name === 'sendGraphic' ? (graphic, at) => {
    if (graphic.getId() === 2504 && h.session.sourceTile(at).slice(0,2).join(',') === h.fight.hazards.playerTile().join(',')) strikes.push(h.fight.tick);
  } : () => sender });
  h.p.getPacketSender = () => sender;
  h.fight.nextSpecial = 'lightning'; h.fight.beginSpecial();
  h.step(5);
  assert.deepEqual(strikes, []);
  h.step();
  assert.deepEqual(strikes, [6]);
});
test('normal specials reduce all incoming damage by one third; magic rear boost preserves accuracy rules', t => {
  const h = H.harness(t);
  const normal = h.hit(45);
  h.fight.special = 'lightning';
  h.dispatch('onNpcHitModify', { npc: h.fight.boss, hit: normal });
  assert.equal(normal.getTotalDamage(), 30);
  h.fight.special = null;
  h.fight.stun(); h.move([2090, 6371]);
  const magic = h.hit(40, h.core.CombatType.MAGIC);
  h.dispatch('onNpcHitModify', { npc: h.fight.boss, hit: magic });
  assert.equal(magic.getTotalDamage(), 80);
  const roll = { attacker: h.p, target: h.fight.boss, combatType: h.core.CombatType.MAGIC, forceAccurate: false };
  h.dispatch('onCombatHitRoll', roll);
  assert.equal(roll.forceAccurate, false);
});
