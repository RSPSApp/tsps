// node --test tests/temple-trekking.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const Common = require('../plugins/minigames/templetrekking/Common.TempleTrekking');
const Trek = require('../plugins/minigames/templetrekking/Trek.TempleTrekking');
const Rewards = require('../plugins/minigames/templetrekking/Rewards.TempleTrekking');

before(() => {
  Common.init({ core: {} });
});

function trek(direction, route) {
  const follower = Common.data.followers.find((entry) => entry.direction === direction);
  const t = new Trek.Trek({ isRegistered: () => true }, follower);
  t.route = route;
  return t;
}

test('reward counts follow the Wiki formula and its worked example', () => {
  // Wiki: 500 points on route 2 picking bow strings gives 150 + floor(100 * 175 / 7675) = 152.
  assert.equal(Rewards.count([150, 250], 500), 152);
  assert.equal(Rewards.count([66, 165], 500), 68);
  // Below the minimum counts as 325, above the maximum as 8000.
  assert.equal(Rewards.count([100, 200], 0), 100);
  assert.equal(Rewards.count([100, 200], 99999), 200);
});

test('the map flashes the captured positions in both directions', () => {
  // Captured to Paterdomus: route 1 stops 1, 2, 8, 9 flash 1, 2, 8, 9; route 3 stop 3 flashes 18.
  for (const [n, flash] of [[1, 1], [2, 2], [8, 8], [9, 9]]) assert.equal(trek('temple', 1).flash(n), flash);
  assert.equal(trek('temple', 3).flash(3), 18);
  // Captured to Burgh: route 1 stops 1, 3, 4, 5, 6, 7, 10 flash 10, 8, 7, 6, 5, 4, 1.
  for (const [n, flash] of [[1, 10], [3, 8], [4, 7], [5, 6], [6, 5], [7, 4], [10, 1]]) {
    assert.equal(trek('ramble', 1).flash(n), flash);
  }
  // Route 2 stops 1 and 4 flash 10 and 14; route 3 stops 2, 4, 6, 8 flash 24, 22, 20, 18.
  assert.equal(trek('ramble', 2).flash(1), 10);
  assert.equal(trek('ramble', 2).flash(4), 14);
  for (const [n, flash] of [[2, 24], [4, 22], [6, 20], [8, 18]]) assert.equal(trek('ramble', 3).flash(n), flash);
});

test('every route uses 25 distinct map positions between them', () => {
  const positions = new Set();
  for (const route of Object.values(Common.data.routes)) {
    if (!route.flash) continue;
    assert.equal(route.flash.length, 10);
    route.flash.forEach((position) => positions.add(position));
  }
  assert.equal(positions.size, 25);
  for (let position = 1; position <= 25; position++) assert.ok(Common.data.escapes[position], `escape for ${position}`);
});

test('trip animations cover all eleven trips of every route', () => {
  for (const direction of ['temple', 'ramble']) {
    for (const route of ['1', '2', '3']) {
      const trips = Common.data.trips[direction].trip[route];
      assert.equal(trips.length, 12);
      for (let n = 1; n <= 11; n++) assert.ok(trips[n] > 0, `${direction} route ${route} trip ${n}`);
    }
  }
});

test('rooms are whole chunks small enough for an instance', () => {
  const { rooms } = Common.data;
  const all = [...rooms.swamp, ...rooms.hollows, rooms.shades, rooms.bridge, rooms.river, rooms.boat, Common.data.hub];
  for (const room of all) {
    const [x0, y0, x1, y1] = room.source;
    assert.equal(x0 % 8, 0, `${room.key} x`);
    assert.equal(y0 % 8, 0, `${room.key} y`);
    assert.equal((x1 + 1) % 8, 0, `${room.key} width`);
    assert.equal((y1 + 1) % 8, 0, `${room.key} height`);
    assert.ok((x1 - x0 + 1) / 8 <= 16 && (y1 - y0 + 1) / 8 <= 16, `${room.key} size`);
  }
});

test('each follower is on the side its direction starts from, with a token per route', () => {
  for (const direction of ['temple', 'ramble']) {
    const followers = Common.data.followers.filter((entry) => entry.direction === direction);
    assert.equal(followers.length, 6);
    assert.deepEqual(new Set(followers.map((entry) => entry.difficulty)), new Set(['easy', 'medium', 'hard']));
    assert.deepEqual(Object.keys(Common.data.directions[direction].tokens), ['1', '2', '3']);
  }
});
