const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyCorrections, generate } = require('../scripts/import-shortest-path.cjs');
const input = require('../scripts/shortest-path-corrections.json');
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
