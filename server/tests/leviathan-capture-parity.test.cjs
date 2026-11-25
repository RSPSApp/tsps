const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const H = require('./helpers/leviathan.cjs');
before(H.initialize);

/** Records what the player is sent: tile graphics, synths, area sounds and camera shakes. */
function record(h) {
  const sent = { graphics: [], sounds: [], areaSounds: [], shakes: [] };
  const sender = new Proxy({}, { get: (_, name) => {
    if (name === 'getVarbit' || name === 'getVarp') return () => 0;
    if (name === 'sendGraphic') return (g, at) => { sent.graphics.push({ tick: h.fight.tick, id: g.getId(), delay: g.getDelay(), height: g.getHeight(), at: h.session.sourceTile(at).slice(0, 2) }); return sender; };
    if (name === 'sendSoundEffect') return (id, loops, delay) => { sent.sounds.push({ tick: h.fight.tick, id, loops, delay }); return sender; };
    if (name === 'sendAreaSound') return (id, x, y, z, loops, delay, radius) => { sent.areaSounds.push({ tick: h.fight.tick, id, radius }); return sender; };
    if (name === 'sendCameraShake') return (slot, random) => { sent.shakes.push({ tick: h.fight.tick, slot, random }); return sender; };
    return () => sender;
  } });
  h.p.getPacketSender = () => sender;
  return sent;
}
function animations(t, h) {
  const seen = [];
  const animate = h.fight.boss.performAnimation.bind(h.fight.boss);
  t.mock.method(h.fight.boss, 'performAnimation', animation => { seen.push([h.fight.tick, animation.getId()]); return animate(animation); });
  return seen;
}

test('enrage telegraphs the pathfinder corner with 2298, then spawns it there with the message three ticks later', t => {
  const h = H.harness(t), sent = record(h);
  t.mock.method(Math, 'random', () => 0);
  h.fight.nextAttack = Infinity;
  h.fight.boss.setHitpoints(180);
  h.step();
  assert.equal(h.fight.enraged, true);
  const telegraph = sent.graphics.filter(g => g.id === 2298);
  assert.equal(telegraph.length, 20, 'five tiles at four delays');
  assert.deepEqual([...new Set(telegraph.map(g => g.delay))], [0, 30, 60, 90]);
  assert.ok(telegraph.every(g => g.height === 124 && g.tick === 1));
  assert.deepEqual([...new Set(telegraph.map(g => g.at.join(',')))].sort(), ['2074,6378', '2075,6377', '2075,6378', '2075,6379', '2076,6378']);
  const focus = m => m.includes('focuses on you intensely');
  assert.equal(h.messages.some(focus), false, 'no message on the roar tick');
  assert.equal(h.fight.hazards.pathfinder, null);
  h.step(2);
  assert.equal(h.messages.some(focus), false);
  h.step();
  assert.equal(h.messages.filter(focus).length, 1);
  assert.deepEqual(h.fight.hazards.pathCentre, [2075, 6378], 'the telegraphed corner');
});

test('a looped one-tick volley ends with 10280 the next tick and roars the tick after, five before the next orb', t => {
  const h = H.harness(t), seen = animations(t, h);
  record(h);
  const orbs = [];
  const orb = h.fight.orb.bind(h.fight);
  t.mock.method(h.fight, 'orb', (...args) => { orbs.push(h.fight.tick); return orb(...args); });
  h.fight.volleyRoars = 3; h.fight.bites = 1; h.fight.tier = 3; h.fight.shots = 11; h.fight.nextAttack = 1;
  h.move([2072, 6370]);
  h.step(9);
  const seq = id => seen.filter(([, s]) => s === id).map(([tick]) => tick);
  assert.deepEqual(orbs.slice(0, 2), [1, 8]);
  assert.deepEqual(seq(10280), [2]);
  assert.deepEqual(seq(10282), [3]);
});

test('roars send their synths and a three-axis camera shake; orbs send their launch synth', t => {
  const h = H.harness(t), sent = record(h);
  t.mock.method(Math, 'random', () => 0.5);
  h.fight.nextAttack = Infinity;
  h.fight.roar();
  assert.deepEqual(sent.sounds.map(({ id, loops, delay }) => [id, loops, delay]), [[7043, 1, 5], [1678, 5, 0]]);
  assert.deepEqual(sent.shakes.map(s => s.slot), [0, 1, 2]);
  assert.ok(sent.shakes.every(s => s.random >= 5 && s.random <= 8));
  sent.sounds.length = 0;
  for (const style of ['magic', 'ranged', 'melee']) h.fight.orb(style, 5);
  assert.deepEqual(sent.sounds.map(s => s.id), [7030, 7041, 7040]);
});

test('enrage-phase debris shatters without the roar shake or synths', t => {
  const h = H.harness(t), sent = record(h);
  h.fight.nextAttack = Infinity;
  h.fight.enraged = true; h.fight.nextEnrageDebris = 1;
  h.step();
  assert.ok(sent.graphics.some(g => g.id === 2475 || g.id === 2476));
  assert.deepEqual(sent.shakes, []);
  assert.deepEqual(sent.sounds, []);
});

test('volley roars after the second drop no debris; the enrage roar still does', t => {
  const h = H.harness(t), sent = record(h);
  h.fight.nextAttack = Infinity;
  const rocks = () => sent.graphics.filter(g => g.id >= 2475 && g.id <= 2480).length;
  h.fight.roar(); h.step(); assert.ok(rocks() > 0);
  sent.graphics.length = 0; h.fight.roar(); h.step(); assert.ok(rocks() > 0);
  sent.graphics.length = 0; h.fight.roar(); h.step(); assert.equal(rocks(), 0, 'third volley roar');
  h.fight.boss.setHitpoints(100); sent.graphics.length = 0;
  h.step();
  assert.equal(h.fight.enraged, true);
  assert.ok(rocks() > 0, 'enrage roar');
});

test('the boss hit and death area sounds go out at its centre with radius 15', t => {
  const h = H.harness(t), sent = record(h);
  h.fight.nextAttack = Infinity;
  const hit = h.hit(20);
  h.dispatch('onNpcHitModify', { npc: h.fight.boss, hit });
  h.applyBoss(hit);
  assert.deepEqual(sent.areaSounds.map(s => [s.id, s.radius]), [[7031, 15]]);
  h.kill(); h.step();
  assert.ok(sent.areaSounds.some(s => s.id === 7034 && s.radius === 15));
});

test('taking rubble damage fails Perfect Leviathan with the recorded reason, once', t => {
  const h = H.harness(t);
  record(h);
  t.mock.method(Math, 'random', () => 0.999);
  h.fight.nextAttack = Infinity;
  h.move([2077, 6378]);
  h.fight.hazards.roar();
  h.step(h.Common.data.roar.flightTicks + 1);
  const failed = h.emitted.filter(([name]) => name === 'combat-achievements:failed').map(([, e]) => [e.task, e.reason]);
  assert.deepEqual(failed, [['Perfect Leviathan', 'You took damage from the falling rubble.']]);
  assert.equal(h.fight.perfect, false);
  h.Common.damage(h.fight, 5, true, 'You took damage from the falling rubble.'); h.step();
  assert.equal(h.emitted.filter(([name]) => name === 'combat-achievements:failed').length, 1);
});

test('rubble lasts through the death animation and crumbles with 2474 a tick after the kill message', t => {
  const h = H.harness(t), sent = record(h);
  require('../plugins/bosses/leviathan/Rewards.Leviathan').attach(h.api);
  h.fight.nextAttack = Infinity;
  h.move([2077, 6378]);
  h.fight.hazards.roar();
  h.move([2076, 6370]);
  h.step(h.Common.data.roar.flightTicks);
  const rubble = [...h.fight.hazards.blockers];
  assert.ok(rubble.length > 0);
  h.kill();
  for (let tick = 0; tick < 8 && !h.fight.rewarded; tick++) {
    h.step();
    if (!h.fight.rewarded) assert.deepEqual([...h.fight.hazards.blockers], rubble, 'still standing while the boss dies');
  }
  assert.equal(h.fight.rewarded, true);
  assert.deepEqual([...h.fight.hazards.blockers], rubble, 'not yet on the kill message tick');
  sent.graphics.length = 0;
  h.step();
  assert.equal(h.fight.hazards.blockers.size, 0);
  assert.deepEqual(sent.graphics.filter(g => g.id === 2474).map(g => g.at.join(',')).sort(), rubble.sort());
});

test('the fight duration runs from the spawn to the kill message, not to the lethal hit', t => {
  const h = H.harness(t);
  record(h);
  require('../plugins/bosses/leviathan/Rewards.Leviathan').attach(h.api);
  h.fight.nextAttack = Infinity;
  h.step(10);
  h.kill();
  let lethal = null;
  for (let tick = 0; tick < 10 && !h.fight.rewarded; tick++) { h.step(); if (h.fight.over && lethal === null) lethal = h.cycle; }
  assert.equal(h.fight.rewarded, true);
  assert.equal(h.fight.finishedTicks, h.cycle - h.fight.startCycle);
  assert.equal(h.cycle - lethal, h.fight.boss.getCurrentDefinition().getDeathTicks(), 'the six-tick death animation counts');
});

test('the shadow stun message comes two ticks after the impact and is not repeated by a second impact', t => {
  const h = H.harness(t);
  h.fight.nextAttack = Infinity;
  const spell = h.core.CombatSpells.SHADOW_BARRAGE.getSpell();
  h.api.emitCustomEvent('magic:hit-effects', { attacker: h.p, target: h.fight.boss, spell });
  h.step();
  h.api.emitCustomEvent('magic:hit-effects', { attacker: h.p, target: h.fight.boss, spell });
  h.step(3);
  assert.equal(h.fight.stuns, 1);
  assert.equal(h.messages.filter(m => m.includes('stuns the Leviathan')).length, 1);
});

function site(t) {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  Site.attach(h.api);
  require('../plugins/bosses/leviathan/Rewards.Leviathan').attach(h.api);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  t.mock.method(Math, 'random', () => 0);
  h.p.setLocation(h.Common.location(h.Common.data.site.campReturn));
  Site.travel({ player: h.p, objectId: 49212 });
  const session = Site.sessionOf(h.p);
  t.after(() => session.end());
  const locAt = tile => {
    const at = session.tile(tile);
    return h.core.ObjectManager.objectsAt(at).find(o => o.getType() === 10 && o.getPrivateArea() === session.area)?.getId()
      ?? session.area.getTemplateObject(at, 10)?.getId();
  };
  return { h, Site, session, locAt };
}

test('the island rowboat is the Escape boat until a kill turns it into the Travel boat', t => {
  const { h, Site, session, locAt } = site(t);
  const boat = h.Common.data.site.islandBoat;
  assert.equal(locAt(boat), 49215);
  Site.climb({ player: h.p, objectId: 47593 });
  const fight = session.fight;
  fight.boss.getCombat().addDamage(h.p, 1); fight.boss.setHitpoints(0);
  for (let tick = 0; tick < 8 && !fight.rewarded; tick++) {
    h.step();
    if (!fight.rewarded) assert.equal(locAt(boat), 49215);
  }
  assert.equal(locAt(boat), 49214);
  h.step(31);
  assert.notEqual(session.fight, fight, 'respawned');
  assert.equal(locAt(boat), 49214, 'stays the Travel boat after the respawn');
  assert.equal(Site.travel({ player: h.p, objectId: 49214 }), true);
  assert.equal(session.ended, true);
});

test('the handholds become a wall once climbed and cannot be climbed back out', t => {
  const { h, Site, session, locAt } = site(t);
  const handholds = h.Common.data.site.handholds;
  assert.notEqual(locAt(handholds), 49224);
  Site.climb({ player: h.p, objectId: 47593 });
  assert.equal(locAt(handholds), 49224);
  const fight = session.fight;
  assert.equal(Site.climb({ player: h.p, objectId: 47593 }), true);
  assert.equal(session.fight, fight);
  assert.equal(fight.stopped, false);
  assert.ok(session.sourceTile(h.p.getLocation())[0] >= h.Common.data.site.arenaArrival[0], 'still in the arena');
});

test('Escape asks "Are you sure you want to leave?" and Quick-escape leaves at once', t => {
  const { h, Site, session } = site(t);
  const prompts = [];
  h.api.sendMultiChatboxPrompt = (player, title, ...options) => prompts.push([title, options]);
  assert.equal(Site.escape({ player: h.p, objectId: 49215 }), true);
  assert.equal(prompts.length, 1);
  const [title, options] = prompts[0];
  assert.equal(title, 'Are you sure you want to leave?');
  assert.deepEqual([options[0], options[2]], ['Yes.', 'No.']);
  options[3]();
  assert.equal(session.ended, false, 'No. stays');
  options[1]();
  assert.equal(session.ended, true);
  const again = site(t);
  assert.equal(again.Site.quickEscape({ player: again.h.p, objectId: 49215 }), true);
  assert.equal(again.session.ended, true);
});
