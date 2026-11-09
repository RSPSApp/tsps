const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const H = require('./helpers/leviathan.cjs');
before(H.initialize);

test('recorded world statistics survive reload, retain faster records and exclude awakened events', t => {
  const h = H.harness(t), fs = require('node:fs'), strings = new Map(), persisted = [];
  const moduleId = require.resolve('../plugins/bosses/leviathan/Records.Leviathan'), prior = require.cache[moduleId];
  t.after(() => { if (prior) require.cache[moduleId] = prior; else delete require.cache[moduleId]; });
  let stored = JSON.stringify({ kills: 9876, deaths: 222, bestTicks: 80 }), reads = 0;
  const originalRead = fs.readFileSync, originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (String(file).endsWith('leviathan-scoreboard.json')) { reads++; return stored; }
    return originalRead(file, ...args);
  });
  t.mock.method(fs, 'writeFileSync', (file, text, ...args) => {
    if (String(file).endsWith('leviathan-scoreboard.json')) stored = text;
    else originalWrite(file, text, ...args);
  });
  h.p.getPacketSender = () => ({ sendInterfaceScript() {}, sendInterface() {}, sendString: (text, uid) => strings.set(uid & 65535, text) });
  h.api.persistAttribute = (...args) => persisted.push(args);
  delete require.cache[moduleId];
  const Records = require(moduleId);
  Records.attach(h.api); Records.read(h.p);
  assert.deepEqual(persisted, [[h.Common.DEATHS_ATTRIBUTE, 0]]);
  assert.equal(strings.get(13), 'No recorded best');
  assert.equal(strings.get(15), '9,876 (recorded)');
  assert.equal(strings.get(17), '222 (recorded)');
  assert.equal(strings.get(19), '0:48.00');
  Records.died(h.p);
  Records.won({ finishedTicks: 100 });
  assert.equal(JSON.parse(stored).bestTicks, 80, 'slower kills retain the world best');
  Records.won({ finishedTicks: 40 });
  Records.won({ awakened: true, finishedTicks: 1 });
  assert.equal(reads, 1, 'the store is loaded once per module lifetime');
  assert.deepEqual(JSON.parse(stored), { kills: 9878, deaths: 223, bestTicks: 40 });
  delete require.cache[moduleId];
  require(moduleId).read(h.p);
  assert.equal(reads, 2);
  assert.equal(strings.get(15), '9,878 (recorded)');
  assert.equal(strings.get(17), '223 (recorded)');
  assert.equal(strings.get(19), '0:24.00');
  assert.equal(strings.get(11), '1 (recorded)');
});

function scoreboard(h) {
  const bindings = new Map(), packets = [], strings = new Map();
  h.api.onObjectInteraction = (name, handlers) => bindings.set(name, handlers);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  const sender = new Proxy({}, { get: (_, name) => name === 'sendInterface' ? id => packets.push(id)
    : name === 'sendString' ? (text, uid) => strings.set(uid & 65535, text) : () => sender });
  h.p.getPacketSender = () => sender;
  const Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  Site.attach(h.api);
  const read = bindings.get('Scoreboard')?.Read;
  assert.equal(typeof read, 'function', 'the native scoreboard needs a scoped Read binding');
  return { Site, read, packets, strings, bindings };
}

test('the Leviathan scoreboard uses the native cached statistics interface and existing personal records', t => {
  const h = H.harness(t), board = scoreboard(h);
  h.p.setAttribute(h.Common.KILLS_ATTRIBUTE, 1234);
  h.p.setAttribute(h.Common.BEST_ATTRIBUTE, 160);
  assert.equal(board.read({ player: h.p, objectId: 49475 }), true);
  assert.deepEqual(board.packets, [831]);
  assert.equal(board.strings.get(9), '1,234');
  assert.equal(board.strings.get(11), '0 (recorded)');
  assert.equal(board.strings.get(13), '1:36.00');
  assert.match(board.strings.get(15), /^\d[\d,]* \(recorded\)$/);
  assert.match(board.strings.get(17), /^\d[\d,]* \(recorded\)$/);
  assert.ok(board.strings.get(19));
  assert.equal(board.read({ player: h.p, objectId: 47588 }), true);
  assert.equal(board.read({ player: h.p, objectId: 47589 }), true, 'Read on the awakened-capable object still opens normal statistics');
  assert.equal(board.bindings.get('Scoreboard')['Read (Awakened)'], undefined);
});

test('the Leviathan scoreboard rejects other bosses and incomplete quests without opening an interface', t => {
  const h = H.harness(t), board = scoreboard(h);
  assert.equal(board.read({ player: h.p, objectId: 55198 }), false);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = false; });
  assert.equal(board.read({ player: h.p, objectId: 47588 }), false);
  assert.deepEqual(board.packets, []);
});

test('a raw null-name Leviathan scoreboard parent Read dispatch opens normal records through its guarded parent hook', t => {
  const h = H.harness(t), board = scoreboard(h);
  const event = { player: h.p, objectId: 49475, clickType: 1, definition: { getName: () => 'null' }, handled: false };
  h.dispatch('onBeforeObjectInteraction', event);
  assert.equal(event.handled, true);
  assert.deepEqual(board.packets, [831]);
  for (const objectId of [47588, 46091]) {
    const other = { ...event, objectId, handled: false };
    h.dispatch('onBeforeObjectInteraction', other);
    assert.equal(other.handled, false, 'resolved names and other bosses stay with their own handlers');
  }
  const nonRead = { ...event, clickType: 2, handled: false };
  h.dispatch('onBeforeObjectInteraction', nonRead);
  assert.equal(nonRead.handled, false);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = false; });
  const locked = { ...event, handled: false };
  h.dispatch('onBeforeObjectInteraction', locked);
  assert.equal(locked.handled, false);
  assert.equal(board.packets.length, 1);
});

test('a real active-fight death updates recorded personal/global deaths once, without counting a mere departure', t => {
  const h = H.harness(t), board = scoreboard(h);
  board.read({ player: h.p, objectId: 47588 });
  const before = Number(board.strings.get(17).replace(/[^\d]/g, ''));
  board.Site.travel({ player: h.p, objectId: 49212 });
  board.Site.climb({ player: h.p, objectId: 47593 });
  h.dispatch('onPlayerDeath', { player: h.p });
  h.dispatch('onPlayerDeath', { player: h.p });
  assert.equal(board.Site.sessionOf(h.p), null);
  board.read({ player: h.p, objectId: 47588 });
  assert.equal(board.strings.get(11), '1 (recorded)');
  assert.equal(Number(board.strings.get(17).replace(/[^\d]/g, '')), before + 1);
  board.Site.travel({ player: h.p, objectId: 49212 });
  board.Site.leave(h.p);
  board.read({ player: h.p, objectId: 47588 });
  assert.equal(board.strings.get(11), '1 (recorded)');
});

test('normal death records exclude staging, completed fights and disabled awakened sessions', t => {
  const h = H.harness(t), board = scoreboard(h);
  for (const state of ['staging', 'completed', 'awakened']) {
    board.Site.travel({ player: h.p, objectId: 49212 });
    if (state !== 'staging') {
      board.Site.climb({ player: h.p, objectId: 47593 });
      const fight = board.Site.sessionOf(h.p).fight;
      if (state === 'completed') fight.fell();
      else fight.awakened = true;
    }
    h.dispatch('onPlayerDeath', { player: h.p });
    assert.equal(h.Common.count(h.p, h.Common.DEATHS_ATTRIBUTE), 0, state);
    assert.equal(board.Site.sessionOf(h.p), null);
  }
});
test('island view includes all five distant tails through native NPC visibility and restores the previous radius on exit', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  h.p.setNpcViewDistance(17);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  Site.travel({ player: h.p, objectId: 49212 });
  const session = Site.sessionOf(h.p);
  t.after(() => session.end());
  const byIndex = new Map();
  for (let i = 0; i < session.tails.length; i++) {
    const tail = session.tails[i];
    tail.setIndex(100 + i); tail.setNeedsPlacement(false); byIndex.set(tail.getIndex(), tail);
  }
  t.mock.method(h.core.World, 'getNpcs', () => ({ get: index => byIndex.get(index) }));
  for (const at of [[2072,6370], [2072,6364], [2090,6364], [2072,6380], [2090,6380]]) {
    h.p.setLocation(session.tile(at));
    h.core.World.updateLocalNpcs(h.p, session.tails);
    assert.equal(h.p.getLocalNpcs().length, 5, `native visibility from ${at}`);
  }
  Site.leave(h.p);
  assert.equal(h.p.getNpcViewDistance(), 17);
});
test('the five recorded tail actors belong to the island and survive fight replacement until exit', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  Site.travel({ player: h.p, objectId: 49212 });
  const session = Site.sessionOf(h.p);
  t.after(() => session.end());
  assert.equal(session.tails?.length, 5);
  assert.deepEqual(session.tails.map(n => [n.getId(), session.sourceTile(n.getLocation()), n.getFace().getDirection().getId()]), [
    [12216, [2053,6355,0], 2], [12217, [2079,6346,0], 1], [12216, [2075,6393,0], 6],
    [12216, [2095,6357,0], 0], [12218, [2096,6389,0], 5],
  ]);
  for (const tail of session.tails) {
    assert.equal(tail.getPrivateArea(), session.area);
    assert.equal(tail.getOwner(), h.p);
    assert.equal(tail.isOwnerOnly(), true);
    assert.ok(tail.getLocation().getX() >= session.area.getBaseX(), 'western tail is inside copied chunks');
  }
  const tails = [...session.tails];
  Site.climb({ player: h.p, objectId: 47593 });
  session.fight.fell(); session.start();
  assert.deepEqual(session.tails, tails);
  assert.ok(tails.every(n => n.isRegistered()));
  Site.leave(h.p);
  assert.equal(session.tails.length, 0);
  assert.ok(tails.every(n => !n.isRegistered()));
});
test('boss bites animate every native tail using its recorded variant', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan'), animations = [];
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  Site.travel({ player: h.p, objectId: 49212 });
  const session = Site.sessionOf(h.p);
  t.after(() => session.end());
  assert.equal(session.tails?.length, 5);
  for (const tail of session.tails) t.mock.method(tail, 'performAnimation', animation => animations.push(animation.getId()));
  Site.climb({ player: h.p, objectId: 47593 });
  h.p.setLocation(session.tile([2076,6372]));
  session.fight.nextAttack = 0;
  session.fight.process();
  assert.deepEqual(animations, [10301,10302,10301,10301,10303]);
});
test('postquest Scar stones connect the two walkable shores in both directions only at their cache locations', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  h.p.setLocation(new h.core.Location(2029, 6430, 0));
  assert.equal(Site.cross({ player: h.p, objectId: 49209, location: { x: 2031, y: 6430, z: 0 } }), true);
  assert.equal(h.p.getLocation().getX(), 2035);
  assert.equal(Site.cross({ player: h.p, objectId: 49209, location: { x: 2033, y: 6430, z: 0 } }), true);
  assert.equal(h.p.getLocation().getX(), 2029);
  assert.equal(Site.cross({ player: h.p, objectId: 49209, location: { x: 10, y: 10, z: 0 } }), false);
  for (const x of [2029, 2035]) assert.equal(h.core.RegionManager.getClipping(x, 6430, 0, null) & 0x200100, 0);
});
test('the public grave/recovery shore and Guardian arrival are cache-walkable', t => {
  const h = H.harness(t);
  for (const tile of [h.Common.data.site.campReturn, h.Common.data.site.guardianArrival])
    assert.equal(h.core.RegionManager.getClipping(...tile, null) & 0x200100, 0, tile.join(','));
});
test('quest-complete player reaches island, climbs into private fight and leaves safely', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  Site.attach(h.api);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  h.p.setLocation(h.Common.location(h.Common.data.site.campReturn));
  assert.equal(Site.travel({ player: h.p, objectId: 49212 }), true);
  const session = Site.sessionOf(h.p);
  assert.ok(session);
  assert.equal(session.fight, null);
  assert.deepEqual(session.sourceTile(h.p.getLocation()), h.Common.data.site.islandArrival);
  assert.equal(Site.climb({ player: h.p, objectId: 47593 }), true);
  assert.equal(session.fight.boss.getHitpoints(), 900);
  assert.equal(h.p.getAttribute(h.Common.INSIDE_ATTRIBUTE), true);
  const grave = { player: h.p };
  h.api.emitCustomEvent('gravestones:grave-location', grave);
  assert.deepEqual(grave.tile, { x: 2063, y: 6435, z: 0 });
  assert.equal(grave.feeMultiplier, 0.25);
  Site.leave(h.p);
  assert.equal(session.ended, true);
  assert.equal(session.fight.stopped, true);
  assert.equal(session.area.isDestroyed(), true);
  assert.equal(h.p.getPrivateArea(), null);
  assert.equal(Site.sessionOf(h.p), null);
  assert.deepEqual([h.p.getLocation().getX(), h.p.getLocation().getY()], [2063, 6435]);
});
test('incomplete quests do not create sessions; persisted inside flags recover outside', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  Site.attach(h.api);
  assert.equal(Site.travel({ player: h.p, objectId: 49212 }), false);
  assert.equal(Site.sessionOf(h.p), null);
  h.p.setAttribute(h.Common.INSIDE_ATTRIBUTE, true);
  h.dispatch('onPlayerLogin', { player: h.p });
  assert.equal(h.p.getAttribute(h.Common.INSIDE_ATTRIBUTE), false);
  assert.equal(h.p.getLocation().getX(), 2063);
});

test('actual kill respawns a fresh normal fight in the same instance and logout ends it', t => {
  const h = H.harness(t), Site = require('../plugins/bosses/leviathan/Site.Leviathan');
  Site.attach(h.api);
  require('../plugins/bosses/leviathan/Rewards.Leviathan').attach(h.api);
  h.api.onCustomEvent('quest:is-complete', request => { request.complete = true; });
  t.mock.method(Math, 'random', () => 0);
  Site.travel({ player: h.p, objectId: 49212 });
  const session = Site.sessionOf(h.p);
  t.after(() => session.end());
  Site.climb({ player: h.p, objectId: 47593 });
  const first = session.fight;
  first.boss.getCombat().addDamage(h.p, 1); first.boss.setHitpoints(0);
  // Original ordinary-world footage: loot at 6:28.6, next spawn at 6:46.8.
  // Count from the real reward/death hook, not the earlier lethal hit.
  for (let tick = 0; tick < 8 && !first.rewarded; tick++) h.step();
  assert.equal(first.rewarded, true);
  h.step(29);
  assert.equal(session.fight, first, 'respawn must wait the full thirty ticks after rewards');
  h.step();
  assert.notEqual(session.fight, first);
  assert.equal(first.stopped, true);
  assert.equal(session.fight.perfect, true);
  assert.equal(session.fight.boss.getHitpoints(), 900);
  assert.equal(session.perfectKills, 1);
  session.area.leave(h.p, true);
  assert.equal(session.ended, true);
  assert.equal(session.fight.stopped, true);
  assert.equal(h.p.getLocation().getX(), 2063);
  assert.equal(h.p.getAttribute(h.Common.INSIDE_ATTRIBUTE), false);
});
