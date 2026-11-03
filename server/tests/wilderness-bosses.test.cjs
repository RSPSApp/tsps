const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PluginManager } = require('../dist/plugins/PluginManager');
const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
const { World } = require('../dist/game/World');

const core = PluginManager.getCoreApi();
/** Enough plugin API for the units to attach without a running world. */
const api = new Proxy({ core, emitCustomEvent: () => {}, getPrayerHandler: () => ({}), getPluginConfig: (key, fallback) => fallback }, {
  get: (target, name) => (name in target ? target[name] : () => {}),
});

const Common = require('../plugins/bosses/wildernessbosses/Common.WildernessBosses');
const Caves = require('../plugins/bosses/wildernessbosses/Caves.WildernessBosses');
const Loot = require('../plugins/bosses/wildernessbosses/Loot.WildernessBosses');
const Vetion = require('../plugins/bosses/wildernessbosses/Vetion.WildernessBosses');
const Spiders = require('../plugins/bosses/wildernessbosses/Spiders.WildernessBosses');
Common.attach(api);
Caves.attach(api);
Loot.attach(api, { addDiscount: () => {}, playersIn: () => [] });
Vetion.attach(api);

test('the boss caves have the Wilderness levels cache script 384 gives them', () => {
  assert.equal(Wilderness.levelAt(3358, 10335), 40); // Callisto's Den
  assert.equal(Wilderness.levelAt(3295, 10203), 35); // Vet'ion's Rest
  assert.equal(Wilderness.levelAt(3423, 10212), 35); // Silk Chasm
  assert.equal(Wilderness.levelAt(1759, 11551), 21); // Hunter's End
  assert.equal(Wilderness.levelAt(1887, 11546), 21); // Skeletal Tomb
  assert.equal(Wilderness.levelAt(1631, 11556), 29); // Web Chasm
  assert.equal(Wilderness.levelAt(3359, 10246), 33); // Escape Caves, south
  assert.equal(Wilderness.levelAt(3361, 10300), 40); // Escape Caves, north
  assert.equal(Wilderness.levelAt(3292, 3848), 42); // the surface strip is unchanged
});

test('every lair has its entrance, its exit and a box its arrival lies in', () => {
  for (const lair of Common.LAIRS) {
    const [minX, minY, maxX, maxY, plane] = lair.entrance.arrive;
    assert.ok(Common.inBox(lair.box, lair.plane, { x: minX, y: minY, z: plane }), lair.key);
    assert.ok(Common.inBox(lair.box, lair.plane, { x: maxX, y: maxY, z: plane }), lair.key);
    assert.ok(Common.inBox(lair.box, lair.plane, { x: lair.exit.at[0], y: lair.exit.at[1], z: lair.exit.at[2] }), lair.key);
    assert.equal(lair.exit.to === 'escape', lair.multi, lair.key);
  }
  assert.equal(Caves._test.ENTRANCES.size, 6);
  assert.equal(Caves._test.ESCAPE_ENTRANCES.size, 4);
});

test('a player leaving a multi lair within 10 seconds of another comes out where they did', (t) => {
  let cycle = 1000;
  t.mock.method(World, 'getProcessCycle', () => cycle);
  const callisto = Common.LAIR_BY_KEY.get('callisto');
  Caves._test.lastExits.clear();
  const first = Caves._test.escapeArrival(callisto);
  cycle += Common.ESCAPE.followTicks;
  assert.equal(Caves._test.escapeArrival(callisto), first);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    cycle += Common.ESCAPE.followTicks + 1;
    seen.add(Caves._test.escapeArrival(callisto));
  }
  assert.equal(seen.size, 3);
});

test('the loot goes to the top ten by damage, each with at least a quarter of the solo amount', () => {
  const players = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, damage: 100 - i }));
  const list = Loot._test.recipients(players.map((entry) => ({ player: entry, damage: entry.damage })));
  assert.equal(list.length, 10);
  assert.equal(list[0].player.name, 'p0');
  assert.ok(Math.abs(list.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);
  assert.ok(list.every((entry) => entry.scale === 0.25));
  const solo = Loot._test.recipients([{ player: { name: 'solo' }, damage: 50 }]);
  assert.equal(solo[0].scale, 1);
  assert.deepEqual(Loot._test.scaled([{ itemId: 995, amount: 50000 }, { itemId: 532, amount: 1 }], 0.25),
    [{ itemId: 995, amount: 12500 }, { itemId: 532, amount: 1 }]);
});

test('the shield bash covers the captured shapes', (t) => {
  const npc = { getLocation: () => new core.Location(1884, 11544, 1), getSize: () => 3 };
  const at = (x, y) => ({ getLocation: () => new core.Location(x, y, 1) });
  t.mock.method(Math, 'random', () => 0.9);
  // The corner as captured: 12 tiles south-west of him, 2 deep.
  const corner = Vetion._test.bashTiles(npc, at(1883, 11543));
  assert.equal(corner.length, 12);
  assert.ok(corner.some(({ location }) => location.getX() === 1882 && location.getY() === 11542));
  // A side: 5 tiles, then 7, on the player's side.
  const side = Vetion._test.bashTiles(npc, at(1883, 11545));
  assert.equal(side.length, 12);
  assert.ok(side.every(({ location }) => location.getX() < 1884));
  t.mock.method(Math, 'random', () => 0);
  assert.equal(Vetion._test.bashTiles(npc, at(1883, 11545)).length, 16);
});

test('rebirth restores the combat stats the first form drained', () => {
  const restored = new Map();
  Vetion._test.restoreStats({
    getMaxLevel: () => 99,
    setCurrentLevels: (skill, level) => restored.set(skill, level),
  });
  assert.deepEqual([...restored.keys()],
    [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.MAGIC, core.Skill.RANGED]);
  assert.ok([...restored.values()].every((level) => level === 99));
});

test('the sticky web is the captured 37-tile shape', () => {
  const tiles = new Set(Spiders._test.WEB_PATTERN.map(([dx, dy]) => `${dx},${dy}`));
  assert.equal(tiles.size, 37);
  assert.ok(Spiders._test.WEB_PATTERN.every(([dx, dy]) => Math.abs(dx) <= 3 && Math.abs(dy) <= 3));
});

/** A player as these rules see one: attributes, varbits, messages. */
function fakePlayer(attributes = {}) {
  const sent = [];
  const sender = new Proxy({}, { get: (target, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  return {
    sent,
    attributes,
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    getPacketSender: () => sender,
    sendMessage: (text) => sent.push(['message', text]),
    getLocation: () => new core.Location(3358, 10330, 0),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

test('a lair holds teleports for 3 ticks after entering', (t) => {
  let cycle = 500;
  t.mock.method(World, 'getProcessCycle', () => cycle);
  const player = fakePlayer({ [Caves._test.ENTERED_AT_ATTRIBUTE]: 500 });
  assert.equal(Caves._test.teleportLocked(player), true);
  cycle = 502;
  assert.equal(Caves._test.teleportLocked(player), true);
  cycle = 503;
  assert.equal(Caves._test.teleportLocked(player), false);
});

test('dying to a player since the last visit loses the fee to them', (t) => {
  const drops = [];
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', (owner, item) => drops.push([owner, item.getId(), item.getAmount()]));
  const killer = fakePlayer();
  const player = fakePlayer({
    [Common.FEE_PAID_ATTRIBUTE]: true, [Common.FEE_AMOUNT_ATTRIBUTE]: 40000, [Common.VISITED_ATTRIBUTE]: true,
  });
  Caves._test.playerDied({ player, killer: { isPlayer: () => false } });
  assert.equal(player.attributes[Common.FEE_PAID_ATTRIBUTE], true);
  Caves._test.playerDied({ player, killer });
  assert.equal(player.attributes[Common.FEE_PAID_ATTRIBUTE], false);
  assert.deepEqual(drops, [[killer, Common.COINS, 40000]]);
  const away = fakePlayer({ [Common.FEE_PAID_ATTRIBUTE]: true, [Common.FEE_AMOUNT_ATTRIBUTE]: 50000, [Common.VISITED_ATTRIBUTE]: false });
  Caves._test.playerDied({ player: away, killer });
  assert.equal(away.attributes[Common.FEE_PAID_ATTRIBUTE], true);
});

test('the bears\' crescent and the spiders\' shots splat when they land, not before (#1862)', () => {
  const Bears = require('../plugins/bosses/wildernessbosses/Bears.WildernessBosses');
  Bears.attach(api);
  Spiders.attach(api);
  const lands = (ticks, end) => ticks * 30 >= end && (ticks - 1) * 30 < end;
  // Crescent: 30 + 6 per tile from the bear's middle, plus one.
  for (const tiles of [1, 3, 8]) {
    const end = Bears._test.RANGED.start + 6 * (tiles + 1);
    assert.ok(lands(Bears._test.rangedHitTicks(end), end), `crescent at ${tiles} tiles`);
  }
  assert.equal(Bears._test.rangedHitTicks(42), 2);
  // Spits and webs: 25 + 2 per tile; never a 0-tick hit.
  for (const tiles of [3, 10]) {
    const end = Spiders._test.SHOT_SHAPE.start + Spiders._test.SHOT_SHAPE.perTile * tiles;
    assert.ok(lands(Spiders._test.shotHitTicks(end), end), `spider shot at ${tiles} tiles`);
  }
  assert.equal(Spiders._test.shotHitTicks(31), 2);
});
