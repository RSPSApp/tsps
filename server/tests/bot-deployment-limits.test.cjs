const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const deployPath = require.resolve('../plugins/bots/runtime/Deploy.PlayerBots');

function results(overrides) {
  const env = { ...process.env, BOT_MAX_DEPLOY_COUNT: '0', BOT_MAX_MANAGED_BOTS: '0', ...overrides };
  return JSON.parse(execFileSync(process.execPath, ['-e', `
    const { checkDeploymentLimits } = require(${JSON.stringify(deployPath)});
    const runtime = { entriesByUsername: new Map(Array.from({ length: 45 }, (_, i) => [i, { adminDeployedActivityId: 'routine' }])) };
    const world = { getPlayers: () => ({ characters: Array(101), sizeReturn: () => 45 }), getAddPlayerQueue: () => [1, 2] };
    console.log(JSON.stringify([6, 21, 53, 54].map(count => checkDeploymentLimits(runtime, count, world)?.error ?? null)));
  `], { env, encoding: 'utf8' }));
}

test('uncapped deployments are governed by actual world slots including pending adds', () => {
  assert.deepEqual(results({}), [null, null, null, 'The world has 53 player slots available.']);
});

test('a host can enable deployment and managed-bot caps independently', () => {
  assert.deepEqual(results({ BOT_MAX_DEPLOY_COUNT: '20' }), [null, ...Array(3).fill('This world allows 20 bots per deployment.')]);
  assert.deepEqual(results({ BOT_MAX_MANAGED_BOTS: '50' }), Array(4).fill('This world has 5 managed bot slots available (limit 50).'));
});
