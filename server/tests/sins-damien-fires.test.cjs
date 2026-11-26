// From server/: node --test tests/sins-damien-fires.test.cjs (after yarn build).
// Damien Leucurte's magical fires in Sins of the Father (rsprox captures local 1000270, 102, 1637):
// the cast, the fire two ticks later, Stamp-out, the damage reduction message and the cleanup.
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.BROWSER_HOST = '1';
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const createDamienFires = require('../plugins/quests/quests/Fires.SinsOfTheFather');

const FIRE_OBJECT_ID = core.ObjectIdentifiers.MAGICAL_FIRE_4;
const MESSAGE = 'Your attacks seem to have reduced effect on Damien.';

function setup({ blocked = () => false } = {}) {
  const tasks = [];
  const objects = [];
  const api = {
    core: {
      ...core,
      RegionManager: { blocked: (location) => blocked(location) },
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      ObjectManager: {
        register: (object) => objects.push(object),
        deregister: (object) => { const i = objects.indexOf(object); if (i >= 0) objects.splice(i, 1); },
      },
    },
  };
  const sounds = [];
  const messages = [];
  const animations = [];
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getLocation: () => new core.Location(3719, 3358, 1),
    getPacketSender: () => ({ sendAreaSound: (id, x, y, z) => sounds.push([id, x, y, z]) }),
    sendMessage: (text) => messages.push(text),
    performAnimation: (animation) => animations.push(['player', animation.getId()]),
    setPositionToFace: () => {},
  };
  let registered = true;
  const npc = {
    isPlayer: () => false,
    isNpc: () => true,
    isRegistered: () => registered,
    getLocation: () => new core.Location(3718, 3357, 1),
    performAnimation: (animation) => animations.push(['npc', animation.getId()]),
    setPositionToFace: (location) => { npc.faced = [location.getX(), location.getY(), location.getZ()]; },
  };
  const fires = createDamienFires(api);
  const runTasks = () => {
    for (const task of [...tasks]) {
      if (!task.tick()) tasks.splice(tasks.indexOf(task), 1);
    }
  };
  const tickTo = (n) => { for (let i = 0; i < n; i++) runTasks(); };
  return {
    api, tasks, objects, sounds, messages, animations, player, npc, fires, tickTo,
    despawn: () => { registered = false; },
    fireObjects: () => objects.filter((object) => object.getId() === FIRE_OBJECT_ID),
  };
}

function hit(fires, attacker, target, amount) {
  const damage = new core.HitDamage(amount, core.HitMask.RED);
  fires.reduceDamage({ attacker, target, damage, accurate: true });
  return damage.getDamage();
}

test('every available fire count uses exact remaining fifths at damage boundaries', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  for (let count = 0; count <= 34; count++) {
    assert.equal(s.fireObjects().length, count);
    for (const amount of [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 19, 20, 21, 255]) {
      const expected = count >= 5 ? 0 : Math.floor(amount * (5 - count) / 5);
      assert.equal(hit(s.fires, s.player, s.npc, amount), expected, `${count} fires, ${amount} damage`);
    }
    if (count < 34) s.tickTo(30);
  }
  s.tickTo(60);
  assert.equal(s.fireObjects().length, 34, 'room capacity stays unchanged');
  s.fires.stop(s.player);
});

test('real PendingHit with actual fires keeps exact damage and owner-only stamp removal', async t => {
  const path = require('node:path');
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3719, 3358);
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const actors = [];
  const actor = () => {
    const p = new Player(new PlayerSession({ kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} }));
    p.setUsername(`damienround${actors.length}`); p.setAttribute('bot-skip-persistence', true);
    p.setLocation(new core.Location(3719, 3358, 1)); p.setNeedsPlacement(false);
    core.World.getPlayers().add(p); actors.push(p); return p;
  };
  const api = PluginManager.createApi('DamienRoundingRegression'), fires = createDamienFires(api);
  api.onCombatHitDamage(fires.reduceDamage);
  const p = actor(), other = actor(), npc = new core.NPC(9564, new core.Location(3718, 3357, 1));
  core.World.getNpcs().add(npc); npc.setHitpoints(150);
  const step = n => { for (let i = 0; i < n; i++) { core.World.processCycle++; core.TaskManager.process(); } };
  const rolled = (attacker, target, damage) => new core.PendingHit(attacker, target, new core.MeleeCombatMethod(),
    { damage, rollAccuracy: false, experience: false }).getTotalDamage();
  t.after(() => {
    for (const a of actors) { fires.stop(a); core.TaskManager.cancelTasks(a); core.TaskManager.cancelTasks(a.getIndex());
      core.World.getPlayers().remove(a); core.World.unregisterPlayerPosition(a); }
    core.TaskManager.cancelTasks(npc); core.World.getNpcs().remove(npc); step(4);
  });
  fires.start(p, npc); step(90);
  assert.equal(fires.firesFor(p).length, 3);
  assert.deepEqual([rolled(p, npc, 5), rolled(p, npc, 10)], [2, 4]);
  assert.equal(rolled(other, npc, 10), 10, 'foreign attacker has no reduction');
  const at = new core.Location(...fires.firesFor(p)[0].split(',').map(Number));
  const fire = core.ObjectManager.objectsAt(at).find(o => o.getOwner() === p && o.getId() === FIRE_OBJECT_ID);
  assert.ok(fire, 'actual registered owner-only fire');
  assert.equal(fires.stampOut({ player: other, object: fire, location: at }), false);
  assert.equal(fires.stampOut({ player: p, object: fire, location: at }), true);
  step(1);
  assert.equal(core.ObjectManager.objectsAt(at).includes(fire), false);
  assert.equal(fires.firesFor(p).length, 2);
  assert.equal(rolled(p, npc, 5), 3);
  fires.stop(p); step(35);
  assert.equal(fires.firesFor(p).length, 0);
  assert.equal(core.World.getObjects().some(o => o.getOwner() === p && o.getId() === FIRE_OBJECT_ID), false);
});

test('Damien casts on tick 28 and the fire appears two ticks later, owner-only, with its sound', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  s.tickTo(27);
  assert.equal(s.animations.length, 0);
  s.tickTo(1);
  assert.deepEqual(s.animations, [['npc', 728]]);
  assert.ok(s.npc.faced, 'Damien faces the fire tile');
  s.tickTo(1);
  assert.equal(s.fireObjects().length, 0);
  s.tickTo(1);
  const [fire] = s.fireObjects();
  assert.ok(fire, 'the fire is lit two ticks after the cast');
  assert.deepEqual([fire.getLocation().getX(), fire.getLocation().getY(), fire.getLocation().getZ()], s.npc.faced);
  assert.equal(fire.getType(), 10);
  assert.equal(fire.getOwner(), s.player);
  assert.deepEqual(s.sounds.at(-1), [2596, ...s.npc.faced]);
  // Next cast 30 ticks after the first.
  s.tickTo(27);
  assert.equal(s.animations.length, 1);
  s.tickTo(1);
  assert.equal(s.animations.length, 2);
});

test('fires never land on Damien, the player, a blocked tile or another fire', () => {
  const s = setup({ blocked: (location) => location.getX() !== 3719 && location.getX() !== 3718 });
  s.fires.start(s.player, s.npc);
  s.tickTo(30 + 30 * 20);
  const tiles = s.fireObjects().map((object) => `${object.getLocation().getX()},${object.getLocation().getY()}`);
  assert.equal(new Set(tiles).size, tiles.length);
  for (const tile of tiles) {
    assert.ok(tile.startsWith('3719,') || tile.startsWith('3718,'), tile);
    assert.notEqual(tile, '3718,3357');
    assert.notEqual(tile, '3719,3358');
  }
  // 12 tiles in two columns minus Damien's and the player's.
  assert.equal(tiles.length, 10);
});

test('a burning fire cuts the player\'s damage on Damien and warns once per fire', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  assert.equal(hit(s.fires, s.player, s.npc, 20), 20);
  s.tickTo(30);
  assert.equal(s.fireObjects().length, 1);
  assert.equal(hit(s.fires, s.player, s.npc, 20), 16);
  assert.equal(hit(s.fires, s.player, s.npc, 20), 16);
  assert.deepEqual(s.messages, [MESSAGE]);
  s.tickTo(30);
  assert.equal(s.fireObjects().length, 2);
  assert.equal(hit(s.fires, s.player, s.npc, 20), 12);
  assert.deepEqual(s.messages, [MESSAGE, MESSAGE]);
  // Other NPCs and NPC attackers are untouched.
  const other = { ...s.npc };
  assert.equal(hit(s.fires, s.player, other, 20), 20);
  assert.equal(hit(s.fires, s.npc, s.player, 20), 20);
});

test('Stamp-out plays human_stamp, and a tick later the fire goes out with sound 1446', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  s.tickTo(30);
  const [fire] = s.fireObjects();
  const at = fire.getLocation();
  const event = { player: s.player, objectId: FIRE_OBJECT_ID, location: at, object: fire };
  assert.equal(s.fires.stampOut(event), true);
  assert.equal(event.handled, true);
  assert.deepEqual(s.animations.at(-1), ['player', 794]);
  assert.equal(s.fireObjects().length, 1, 'still burning on the click tick');
  s.tickTo(1);
  assert.equal(s.fireObjects().length, 0);
  assert.deepEqual(s.sounds.at(-1), [1446, at.getX(), at.getY(), at.getZ()]);
  assert.equal(hit(s.fires, s.player, s.npc, 20), 20);
  // Not our fire (another tile, or no fight): left to other handlers.
  assert.equal(s.fires.stampOut({ player: s.player, location: new core.Location(3000, 3000, 0) }), false);
  const t = setup();
  assert.equal(t.fires.stampOut({ player: t.player, location: at }), false);
});

test('the fires go out when the fight stops or Damien is gone', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  s.tickTo(60);
  assert.equal(s.fireObjects().length, 2);
  s.fires.stop(s.player);
  assert.equal(s.fireObjects().length, 0);
  assert.deepEqual(s.fires.firesFor(s.player), []);

  const d = setup();
  d.fires.start(d.player, d.npc);
  d.tickTo(30);
  assert.equal(d.fireObjects().length, 1);
  d.despawn();
  d.tickTo(1);
  assert.equal(d.fireObjects().length, 0);
  assert.equal(d.fires.tick(d.player), false);
});

test('leaving the fight puts the fires out and the casts start over on return', () => {
  const s = setup();
  let away = false;
  s.player.getLocation = () => (away ? new core.Location(3222, 3218, 0) : new core.Location(3719, 3358, 1));
  s.fires.start(s.player, s.npc);
  s.tickTo(30);
  assert.equal(s.fireObjects().length, 1);
  away = true;
  s.tickTo(1);
  assert.equal(s.fireObjects().length, 0);
  s.tickTo(100);
  assert.equal(s.animations.length, 1, 'no casts while the player is away');
  away = false;
  s.fires.start(s.player, s.npc); // the stage respawn sees the same Damien: no restart
  s.tickTo(27);
  assert.equal(s.animations.length, 1);
  s.tickTo(1);
  assert.equal(s.animations.length, 2);
});

test('the fight task survives TaskManager.cancelTasks(player) and a restart revives a stopped one', () => {
  const s = setup();
  s.fires.start(s.player, s.npc);
  const task = s.tasks[0];
  assert.notEqual(task.key, s.player, 'not keyed to the player');
  task.stop(); // as if cancelled anyway
  s.tickTo(1);
  s.fires.start(s.player, s.npc); // the stage respawn with the same Damien restarts it
  s.tickTo(28);
  assert.equal(s.animations.length, 1);
});
