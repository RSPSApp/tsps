const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../dist/Server').Server.installProductionPathResolver();
const { collectCodeDefinitions, CODE_DEFINITIONS_EVENT } = require('../plugins/bots/runtime/CodeDefinitions.PlayerBots');
const { createBotActivityRegistry } = require('../plugins/bots/brain/ActivityRegistry.PlayerBots');
const { listedRoutines } = require('../plugins/bots/runtime/RoutineCatalog.PlayerBots');
const { readAvailablePlans, savePlan } = require('../plugins/bots/runtime/DeploymentPlans.PlayerBots');
const { _test: { activityList } } = require('../plugins/tools/worldadmin/Bots.WorldAdmin');
const { groupRoutines } = require('../plugins/bots/runtime/RoutineDeployments.PlayerBots');

const routine = { id: 'rest_stop', name: 'Test wait', repeat: false, deploymentOverrides: ['skills'], createActions: ({ action }) => [action({ type: 'wait', seconds: 3 })] };
const preset = { id: 'plugin-test-pair', name: 'Test pair', rows: [{ routine: routine.id, count: 2 }], launchOverrides: [{ count: true, routines: [] }] };

test('startup collects code actions and presets only after all plugins can attach', () => {
  let listeners = [], collections = 0;
  const api = { emitCustomEvent(event, payload) { assert.equal(event, CODE_DEFINITIONS_EVENT); collections++; for (const listener of listeners) listener(payload); } };
  const core = require('../dist/plugins/PluginManager').PluginManager.getCoreApi();
  const registry = createBotActivityRegistry({ api, world: { core }, deferCodeDefinitions: true });
  assert.equal(registry.byId.has(routine.id), false);
  listeners.push(({ registerPlan }) => registerPlan(preset));
  listeners.push(({ registerRoutine }) => registerRoutine(routine));
  registry.installCodeDefinitions();
  registry.installCodeDefinitions();
  assert.equal(collections, 1);
  const compiled = registry.byId.get(routine.id);
  assert.equal(compiled.oneShot, true);
  assert.equal(compiled.manual, true);
  assert.equal(registry.pickActivity({}, 0, { allowed: [routine.id] }), null);
  assert.equal(registry.pickActivity({}, 0, { own: routine.id }), compiled);
  assert.ok(listedRoutines(registry).includes(compiled));
  const published = activityList(registry).find(entry => entry.id === routine.id);
  assert.equal(published.name, routine.name);
  assert.deepEqual(published.deploymentOverrides.map(field => field.key), ['skills']);
  const woodcutting = activityList(registry).find(entry => entry.id === 'normal_trees');
  const profile = woodcutting.deploymentOverrides.find(field => field.type === 'routineChoice');
  assert.equal(profile.label, 'Tree type');
  assert.ok(profile.choices.some(choice => choice.id === 'oak_trees'));
  assert.deepEqual(readAvailablePlans(registry.deploymentPlans).find(plan => plan.id === preset.id), preset);
  const player = {};
  assert.equal(compiled.actions[0].update({ player, nowMs: 0 }), 'running');
  assert.equal(compiled.actions[0].update({ player, nowMs: 3000 }), 'success');
});

test('invalid code definitions are isolated and saved plans cannot shadow new code IDs', () => {
  const errors = [];
  const result = collectCodeDefinitions({
    emitCustomEvent(_, { registerRoutine, registerPlan }) {
      for (const id of ['roam', 'world', 'developer', 'sparring', 'soul_wars_match', 'Invalid']) registerRoutine({ ...routine, id });
      registerRoutine({ ...routine, id: 'plugin_existing' });
      registerRoutine({ ...routine, id: 'plugin_bad', createActions: async () => [] });
      registerRoutine(routine);
      registerRoutine(routine);
      registerPlan({ ...preset, id: 'plugin-missing', rows: [{ routine: 'plugin_unavailable', count: 2 }] });
      registerPlan(preset);
    },
    log(_, entry) { errors.push(entry.id); },
  }, {}, new Map(), () => ({ update: () => 'success' }));
  assert.deepEqual(result.routines.map(entry => entry.id), ['plugin_existing', routine.id]);
  assert.deepEqual(result.plans, [preset]);
  assert.deepEqual(errors, ['roam', 'world', 'developer', 'sparring', 'soul_wars_match', 'Invalid', 'plugin_bad', routine.id, 'plugin-missing']);
  assert.throws(() => savePlan(preset, require('node:path').join(require('node:os').tmpdir(), `tsps-code-plan-test-${process.pid}.json`), []), /reserved/);
});

test('deployment families preserve the concrete stored tier IDs', () => {
  assert.deepEqual(groupRoutines([{ id: 'iron_rocks' }, { id: 'coal_rocks' }]), [{
    key: 'family:mining', label: 'Mining', defaultProfile: 'copper_tin_rocks', profiles: [{ id: 'iron_rocks', label: 'Iron' }, { id: 'coal_rocks', label: 'Coal' }],
  }]);
});
