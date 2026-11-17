const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ACTIVITY_LAUNCHER_EVENT, collectActivityLaunchers, validateSetupValues } = require('../plugins/bots/runtime/LauncherCatalog.PlayerBots');
const { deployRegisteredBots, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS } = require('../plugins/bots/runtime/Deploy.PlayerBots');

test('activity plugins contribute validated, de-duplicated launchers through the named event', () => {
  const logs = [];
  const api = {
    emitCustomEvent(name, event) {
      assert.equal(name, ACTIVITY_LAUNCHER_EVENT);
      event.register({ id: 'barbarian-assault', name: 'Barbarian Assault', detail: 'Minigame', description: 'Deploy activity-specific bots.', deploy() {} });
      event.register({ id: 'barbarian-assault', name: 'Duplicate', description: 'Ignored duplicate.', deploy() {} });
      event.register({ id: 'Invalid ID', name: 'Invalid', description: 'Rejected.', deploy() {} });
      event.register({ id: 'custom_oak', name: 'Routine collision', description: 'Rejected.', deploy() {} });
      event.register({ id: 'missing-deploy', name: 'Missing deploy', description: 'Rejected.' });
      event.register({ id: 'bad-setup', name: 'Bad setup', description: 'Rejected.', deploy() {}, setupFields: [{ id: 'role', label: 'Role', choices: [{ value: 'only', label: 'Only' }] }] });
    },
    log(name, data) { logs.push({ name, data }); },
  };
  const launchers = collectActivityLaunchers(api);
  assert.equal(launchers.length, 1);
  assert.deepEqual({ id: launchers[0].id, key: launchers[0].key, name: launchers[0].name, kind: launchers[0].kind }, {
    id: 'barbarian-assault', key: 'activity:barbarian-assault', name: 'Barbarian Assault', kind: 'activity',
  });
  assert.equal(launchers[0].setupSummary, 'Activity defaults are applied by its plugin.');
  assert.deepEqual(logs.map(entry => entry.name), ['bot_activity_launcher_rejected', 'bot_activity_launcher_rejected', 'bot_activity_launcher_rejected', 'bot_activity_launcher_rejected']);
  assert.deepEqual(validateSetupValues(launchers[0].setupFields, { extra: 'injected' }), { ok: false, error: 'Activity setup contains an unknown field.' });
});

test('registered activity deployment is bounded, validates its location and marks returned runtime bots as managed', () => {
  const runtime = { entriesByUsername: new Map() };
  const calls = [];
  const launcher = {
    id: 'barbarian-assault',
    deploy({ count, location, skillOverrides }) {
      calls.push({ count, location, skillOverrides });
      const spawned = [];
      for (let index = 1; index <= count; index += 1) {
        const username = `AssaultBot${index}`;
        const player = { getUsername: () => username, isPlayerBot: () => true };
        runtime.entriesByUsername.set(username, { player });
        spawned.push(username);
      }
      return { spawned, failures: [] };
    },
  };
  const result = deployRegisteredBots({
    runtime, launcher, count: 2, location: { x: 3200, y: 3210, z: 1 },
    context: { skillOverrides: { attack: 60 } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.spawned, ['AssaultBot1', 'AssaultBot2']);
  assert.deepEqual(calls, [{ count: 2, location: { x: 3200, y: 3210, z: 1 }, skillOverrides: { attack: 60 } }]);
  for (const username of result.spawned) {
    const entry = runtime.entriesByUsername.get(username);
    assert.equal(entry.adminDeployedActivityId, 'barbarian-assault');
    assert.equal(entry.adminDeployedLauncherId, 'barbarian-assault');
    assert.ok(Number.isFinite(entry.adminDeployedAt));
  }
  assert.equal(MAX_DEPLOY_COUNT, 20);
  assert.equal(MAX_MANAGED_BOTS, 50);
});

test('registered activity deployment tracks and logs out plugin overproduction', () => {
  const runtime = { entriesByUsername: new Map() };
  const loggedOut = [];
  const launcher = {
    id: 'test-activity',
    deploy() {
      const spawned = [];
      for (let index = 1; index <= 3; index += 1) {
        const username = `ExtraBot${index}`;
        const player = { getUsername: () => username, isPlayerBot: () => true, requestLogout: () => loggedOut.push(username) };
        runtime.entriesByUsername.set(username, { player });
        spawned.push(username);
      }
      return { spawned };
    },
  };
  const result = deployRegisteredBots({ runtime, launcher, count: 1, location: { x: 3200, y: 3200, z: 0 } });
  assert.deepEqual(result.spawned, ['ExtraBot1']);
  assert.ok(result.failures.some(message => /more bots than requested/.test(message)));
  assert.deepEqual(loggedOut, ['ExtraBot2', 'ExtraBot3']);
  assert.equal([...runtime.entriesByUsername.values()].filter(entry => entry.adminDeployedActivityId === 'test-activity').length, 3);
});

test('registered activity deployment validates activity-specific setup choices before invoking plugin code', () => {
  let calls = 0;
  const launcher = {
    id: 'test-activity',
    setupFields: [{ id: 'role', label: 'Role', defaultValue: 'attacker', choices: [{ value: 'attacker', label: 'Attacker' }, { value: 'defender', label: 'Defender' }] }],
    deploy() { calls += 1; return []; },
  };
  const result = deployRegisteredBots({ runtime: { entriesByUsername: new Map() }, launcher, count: 1,
    location: { x: 3200, y: 3200, z: 0 }, context: { setup: { role: 'healer' } } });
  assert.equal(result.status, 400);
  assert.match(result.error, /Invalid value/);
  assert.equal(calls, 0);
});

test('registered activity deployment rejects excessive requests and bad coordinates before invoking plugin code', () => {
  let calls = 0;
  const launcher = { id: 'test-activity', deploy() { calls += 1; return []; } };
  const fullRuntime = { entriesByUsername: new Map(Array.from({ length: 49 }, (_, index) => [`Managed${index}`, { adminDeployedActivityId: 'old' }])) };
  assert.equal(deployRegisteredBots({ runtime: fullRuntime, launcher, count: 2, location: { x: 3200, y: 3200, z: 0 } }).status, 409);
  assert.equal(deployRegisteredBots({ runtime: { entriesByUsername: new Map() }, launcher, count: MAX_DEPLOY_COUNT + 1, location: { x: 3200, y: 3200, z: 0 } }).status, 400);
  assert.equal(deployRegisteredBots({ runtime: { entriesByUsername: new Map() }, launcher, count: 1, location: { x: -1, y: 3200, z: 0 } }).status, 400);
  assert.equal(calls, 0);
});
