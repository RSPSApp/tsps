const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ACTIVATION_ATTRIBUTE, createActivationStore, customSchedule } = require('../plugins/bots/runtime/Activation.PlayerBots');
const { deploymentSnapshot, updateDeployment } = require('../plugins/tools/worldadmin/Activation.WorldAdmin');

function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-activation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'activation.json');
  const store = createActivationStore(file);
  const stopped = [], leaving = [], requested = [];
  const make = (name, id) => {
    const bot = { isPlayerBot: () => true, isRegistered: () => false, getUsername: () => name, getAttribute: key => key === ACTIVATION_ATTRIBUTE ? id : null,
      requestLogout() { stopped.push(name); leaving.push(bot); } };
    return bot;
  };
  const online = [make('RoutineBot', 'custom_smith')];
  const pending = [make('Pending', 'custom_smith')];
  const world = { getPlayers: () => online, getAddPlayerQueue: () => pending, getRemovePlayerQueue: () => leaving };
  const api = {
    getWorld: () => world,
    getPluginConfig: (key, fallback) => key === 'PlayerBots:startupRoutines' ? [{ id: 'custom_smith', count: 2 }] : fallback,
  };
  const runtime = { entriesByUsername: new Map() };
  const registry = { activities: [{ id: 'custom_smith', manual: true }] };
  const snapshot = () => deploymentSnapshot(api, runtime, registry, store);
  const update = body => updateDeployment(api, runtime, registry, body, store, options => (requested.push(options.count), { ok: true, spawned: ['New'] }));
  return { file, store, stopped, requested, online, pending, snapshot, update, registry };
}

test('an enabled proximity deployment can have zero bots in world; disabling is persisted without deleting the routine', t => {
  const h = harness(t);
  const nearby = h.snapshot().find(row => row.id === 'wilderness-regional');
  assert.equal(nearby.enabled, true);
  assert.equal(nearby.trigger, 'Nearby players');
  assert.deepEqual(nearby.online, []);
  const original = h.snapshot().find(row => row.id === 'custom_smith');
  assert.equal(original.enabled, true);
  assert.deepEqual(original.online, ['RoutineBot']);
  assert.deepEqual(h.update({ id: 'custom_smith', enabled: false }), { id: 'custom_smith', enabled: false, stopped: 2 });
  assert.deepEqual(h.stopped, ['Pending', 'RoutineBot']);
  assert.equal(h.registry.activities.length, 1);
  const reloaded = createActivationStore(h.file);
  assert.deepEqual(reloaded.get('custom_smith'), { enabled: false, count: 2 });
  assert.equal(reloaded.allowed('custom_smith'), false);
  assert.equal(customSchedule([{ id: 'custom_smith', count: 2 }], reloaded).has('custom_smith'), false);
  const row = h.snapshot().find(row => row.id === 'custom_smith');
  assert.equal(row.enabled, false);
  assert.equal(row.blocked, true);
  assert.deepEqual(row.online, []);
});

test('enable restores the configured deployment count and counts bots pending registration', t => {
  const h = harness(t);
  assert.deepEqual(h.update({ id: 'custom_smith', enabled: true }).spawned, []);
  assert.deepEqual(h.requested, []);
  h.pending.length = 0;
  assert.deepEqual(h.update({ id: 'custom_smith', enabled: true }).spawned, ['New']);
  assert.deepEqual(h.requested, [1]);
  assert.throws(() => h.update({ id: 'custom_smith', enabled: true, count: 1.5 }), /positive whole/);
  assert.throws(() => h.update({ id: 'custom_deleted', enabled: false }), /does not exist/);
});
