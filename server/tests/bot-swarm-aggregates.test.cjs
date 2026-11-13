const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregateSwarm, metricValue } = require('../plugins/tools/worldadmin/panel/swarm-aggregates');
const { createRequestHandler } = require('../plugins/tools/worldadmin/Http.WorldAdmin');

const bots = [
  { username: 'Oak1', activityId: 'custom_oak', status: 'running', managed: true, hitpoints: 10, maxHitpoints: 20,
    skills: [{ name: 'Attack', xp: 100 }, { name: 'Woodcutting', xp: 500 }] },
  { username: 'Oak2', activityId: 'custom_oak', status: 'idle', managed: false, hitpoints: 15, maxHitpoints: 20,
    skills: [{ name: 'Attack', xp: 300 }, { name: 'Woodcutting', xp: 700 }] },
  { username: 'Fisher', activityId: 'custom_fishing', status: 'running', managed: true, hitpoints: 20, maxHitpoints: 20,
    skills: [{ name: 'Attack', xp: 500 }, { name: 'Fishing', xp: 900 }] },
];

test('swarm aggregate computes average, median and extrema for health and skill XP', () => {
  assert.equal(aggregateSwarm(bots, { type: 'average', metric: 'healthPercent' }).value, 75);
  assert.equal(aggregateSwarm(bots, { type: 'median', metric: 'healthPercent' }).value, 75);
  assert.equal(aggregateSwarm(bots, { type: 'min', metric: 'xp:attack' }).value, 100);
  assert.equal(aggregateSwarm(bots, { type: 'max', metric: 'xp:attack' }).value, 500);
  assert.equal(aggregateSwarm(bots, { type: 'average', metric: 'totalXp' }).value, (600 + 1000 + 1400) / 3);
});

test('categories can select routine cohorts, status cohorts and managed bots', () => {
  assert.equal(aggregateSwarm(bots, { category: 'routine:custom_oak', metric: 'hitpoints' }).sampleCount, 2);
  assert.equal(aggregateSwarm(bots, { category: 'status:idle', metric: 'hitpoints' }).value, 15);
  assert.equal(aggregateSwarm(bots, { category: 'managed', metric: 'xp:fishing' }).sampleCount, 1);
  assert.equal(aggregateSwarm(bots, { category: 'unmanaged', metric: 'xp:attack' }).value, 300);
});

test('top and bottom 10 return ordered bot rows with the selected metric', () => {
  const top = aggregateSwarm(bots, { type: 'top10', metric: 'xp:attack' });
  assert.deepEqual(top.rows.map(row => [row.username, row.value]), [['Fisher', 500], ['Oak2', 300], ['Oak1', 100]]);
  const bottom = aggregateSwarm(bots, { type: 'bottom10', metric: 'healthPercent' });
  assert.deepEqual(bottom.rows.map(row => [row.username, row.value]), [['Oak1', 50], ['Oak2', 75], ['Fisher', 100]]);
});

test('the authenticated local panel serves its aggregate module as an approved panel asset', async () => {
  const token = 'a'.repeat(32);
  const route = createRequestHandler({ token, loopback: true, port: () => 43595 }, { catalog: () => ({ status: 200, body: {} }) }, []);
  const request = { method: 'GET', url: '/panel/swarm-aggregates.js', headers: { host: 'localhost:43595', authorization: `Bearer ${token}` } };
  const response = { status: null, headers: null, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = String(body); } };
  await route(request, response);
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'application/javascript; charset=utf-8');
  assert.match(response.body, /LocalBotSwarmAggregates/);
});

test('missing metrics are excluded and invalid aggregate types do not fabricate values', () => {
  assert.equal(metricValue({ hitpoints: 1, maxHitpoints: 0 }, 'healthPercent'), null);
  assert.deepEqual(aggregateSwarm([{ username: 'No XP', skills: [] }], { metric: 'xp:attack' }), {
    type: 'average', category: 'all', metric: 'xp:attack', sampleCount: 0, value: null,
  });
  assert.equal(aggregateSwarm(bots, { type: 'unknown', metric: 'hitpoints' }).value, null);
});
