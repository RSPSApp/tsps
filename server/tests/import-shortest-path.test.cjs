const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyCorrections, generate } = require('../scripts/import-shortest-path.cjs');
const allInput = require('../scripts/shortest-path-corrections.json');
const input = { ...allInput, corrections: allInput.corrections.filter((c) => 'quest' in c) };
const clone = (value) => JSON.parse(JSON.stringify(value));
function rows() {
  return { transports: input.corrections.map((c) => [c.from, c.to, c.menu, c.id, null, null, null, null, null, 1]) };
}

test('tracked city corrections preserve every field except the two quest requirements', () => {
  const data = rows();
  const expected = clone(data);
  for (const row of expected.transports) row[6] = 'Death to the Dorgeshuun';
  applyCorrections(data, input);
  assert.deepEqual(data, expected);
});

test('missing and ambiguous source rows fail before changing any row', () => {
  for (const change of [
    (data) => data.transports.pop(),
    (data) => data.transports.push(clone(data.transports[1])),
    (data) => { data.transports[1][1][0]++; },
    (data) => { data.transports[1][2] = 'Open Gate'; },
    (data) => { data.transports[1][3] = 6920; },
  ]) {
    const data = clone(rows());
    change(data);
    const before = clone(data);
    assert.throws(() => applyCorrections(data, input), /exactly one match/);
    assert.deepEqual(data, before);
  }
});

test('stale quest requirements and repeated corrections fail without partial application', () => {
  const data = clone(rows());
  data.transports[1][6] = 'Another quest';
  const before = clone(data);
  assert.throws(() => applyCorrections(data, input), /Stale/);
  assert.deepEqual(data, before);
  const duplicate = clone(input);
  duplicate.corrections.push(clone(duplicate.corrections[0]));
  const fresh = rows();
  assert.throws(() => applyCorrections(fresh, duplicate), /Duplicate/);
  assert.deepEqual(fresh, rows());
});

test('malformed schema and selectors are rejected', () => {
  const changes = [
    (i) => { i.version = 2; },
    (i) => { i.extra = true; },
    (i) => { i.corrections = []; },
    (i) => { delete i.corrections[0].expectedQuest; },
    (i) => { i.corrections[0].extra = true; },
    (i) => { i.corrections[0].table = 'unknown'; },
    (i) => { i.corrections[0].from = [3317, 9602]; },
    (i) => { i.corrections[0].to = [2747.5, 5374, 0]; },
    (i) => { i.corrections[0].menu = ''; },
    (i) => { i.corrections[0].id = '6919'; },
    (i) => { i.corrections[0].expectedQuest = false; },
    (i) => { i.corrections[0].quest = null; },
    (i) => { i.corrections[0].quest = ' '; },
    (i) => { i.corrections[0].expectedQuest = i.corrections[0].quest; },
  ];
  for (const change of changes) {
    const bad = clone(input);
    change(bad);
    assert.throws(() => applyCorrections(rows(), bad), /Malformed/);
  }
});

test('immutable source references reject moving branches before reading source', () => {
  for (const ref of ['main', 'HEAD', '65314c0', '--all', '']) {
    assert.throws(() => generate('unused', ref), /full immutable commit SHA/);
  }
});

const durationInput = { ...allInput, corrections: allInput.corrections.filter((c) => 'ticks' in c) };
function durationRows() {
  return { agility_shortcuts: durationInput.corrections.map((c) =>
    [c.from, c.to, c.menu, c.id, '21 Agility', null, null, null, null, 7]) };
}

test('GE duration corrections change only the two matched costs', () => {
  const data = durationRows();
  const expected = clone(data);
  for (const row of expected.agility_shortcuts) row[9] = 4;
  applyCorrections(data, durationInput);
  assert.deepEqual(data, expected);
});

test('duration corrections reject stale, missing, ambiguous and invalid inputs atomically', () => {
  for (const mutate of [
    (data) => { data.agility_shortcuts[1][9] = 6; },
    (data) => data.agility_shortcuts.pop(),
    (data) => data.agility_shortcuts.push(clone(data.agility_shortcuts[1])),
  ]) {
    const data = durationRows();
    mutate(data);
    const before = clone(data);
    assert.throws(() => applyCorrections(data, durationInput), /Stale|exactly one match/);
    assert.deepEqual(data, before);
  }
  for (const field of ['ticks', 'expectedTicks']) {
    for (const value of [null, 0, -1, 1.5, '4']) {
      const invalid = clone(durationInput);
      invalid.corrections[1][field] = value;
      const data = durationRows();
      assert.throws(() => applyCorrections(data, invalid), /Malformed/);
      assert.deepEqual(data, durationRows());
    }
  }
  for (const mutation of [
    (c) => { c.ticks = c.expectedTicks; },
    (c) => { c.quest = 'A quest'; },
    (c) => { delete c.expectedTicks; },
  ]) {
    const invalid = clone(durationInput);
    mutation(invalid.corrections[1]);
    assert.throws(() => applyCorrections(durationRows(), invalid), /Malformed/);
  }
});

test('travel plans through a closed door that blocks its whole tile (a diagonal door), opening it from the tile before', () => {
  const { planTravel } = require('../plugins/agent/mcp/TravelRoutes.AgentMcp');
  const LOC = 0x100, BLOCK_WALK = 0x200000;
  // A one-tile corridor at x=158, y=120..160, with a closed diagonal door on (158, 140).
  const getFlag = (x, y) => (x !== 158 || y < 120 || y > 160 ? BLOCK_WALK : y === 140 ? LOC : 0);
  const door = { type: 'map-door', menu: 'Open Door', id: 1535, object: { x: 158, y: 140, z: 0 } };
  const plan = (doorAt) => planTravel({
    from: { x: 158, y: 152, z: 0 }, to: { x: 158, y: 125, z: 0 }, goalReach: 0,
    getFlag, transportsAt: () => [], doorAt,
  });
  const route = plan((x, y) => (x === 158 && y === 140 ? door : null));
  assert.ok(route, 'a route through the door');
  const crossing = route.steps.find((step) => step.via);
  assert.deepEqual([crossing.x, crossing.y], [158, 140]);
  assert.deepEqual(crossing.via.from, [158, 141, 0]);
  assert.equal(crossing.via.id, 1535);
  // No door there: the blocked tile stays blocked.
  assert.equal(plan(() => null), null);
});

test('the production planner charges four ticks for both generated GE crossings', () => {
  const { planTravel, indexTransports, key, BLOCKED } = require('../plugins/agent/mcp/TravelRoutes.AgentMcp');
  const generated = require('../plugins/agent/data/transports.json');
  const byOrigin = indexTransports(generated);
  for (const correction of durationInput.corrections) {
    const [x, y, z] = correction.from;
    const [tx, ty, tz] = correction.to;
    const route = planTravel({
      from: { x, y, z }, to: { x: tx, y: ty, z: tz }, goalReach: 0,
      getFlag: () => BLOCKED,
      transportsAt: (x, y, z) => byOrigin.get(key(x, y, z)) ?? [],
      usable: (transport) => transport.id === correction.id,
    });
    assert.ok(route);
    assert.equal(route.cost, 4);
    assert.equal(route.steps.length, 2);
    assert.equal(route.steps[1].via.id, correction.id);
  }
});
