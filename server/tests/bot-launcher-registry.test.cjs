const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ACTIVITY_LAUNCHER_EVENT, collectActivityLaunchers, validateSetupValues } = require('../plugins/bots/runtime/LauncherCatalog.PlayerBots');
const { deployRegisteredBots } = require('../plugins/bots/runtime/Deploy.PlayerBots');

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

test('registered activity deployment validates its location and marks returned runtime bots as managed', () => {
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

test('registered activity deployment rejects invalid counts and coordinates before invoking plugin code', () => {
  let calls = 0;
  const launcher = { id: 'test-activity', deploy() { calls += 1; return []; } };
  assert.equal(deployRegisteredBots({ runtime: { entriesByUsername: new Map() }, launcher, count: 1.5, location: { x: 3200, y: 3200, z: 0 } }).status, 400);
  assert.equal(deployRegisteredBots({ runtime: { entriesByUsername: new Map() }, launcher, count: 1, location: { x: -1, y: 3200, z: 0 } }).status, 400);
  assert.equal(calls, 0);
});

test('routine deployment uses the real developer activity spawn policy', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-deploy-policy-'));
  const environment = {
    BROWSER_HOST: '1',
    TSPS_ACCOUNTS_FILE: path.join(scratch, 'accounts.json'),
    BOT_FILE_LOG_WRITES_ENABLED: '0',
    BOT_RUNTIME_TELEMETRY_ENABLED: '0',
  };
  const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(path.join(scratch, 'accounts.json'), { force: true });
    fs.rmdirSync(scratch);
  });

  const { Server } = require('../dist/Server');
  Server.installProductionPathResolver();
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { ItemIds } = require('../dist/util/IdEnums');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { getActiveBotRuntime, setActiveBotRuntime } = require('../plugins/bots/runtime/RuntimeRegistry.PlayerBots');
  const { configureBrainActivities } = require('../plugins/bots/brain/BrainActivities.PlayerBots');
  const { deployRoutineBots } = require('../plugins/bots/runtime/Deploy.PlayerBots');
  const previousConfig = PluginManager.pluginConfigCache;
  PluginManager.pluginConfigCache = { 'PlayerBots:allowedActivities': ['developer'], 'PlayerBots:ai': { enabled: false } };
  const api = PluginManager.createApi('PlayerBots');
  require('../plugins/bots/PlayerBots.plugin').register(api);
  const { runtime, brainRegistry } = getActiveBotRuntime();
  t.after(() => {
    PluginManager.pluginConfigCache = { 'PlayerBots:allowedActivities': ['developer'] };
    for (const entry of [...runtime.entries]) {
      const bot = entry.player;
      runtime.disableControllerForPlayer(bot);
      runtime.handleDisconnect(bot);
      for (const queue of [api.core.World.getAddPlayerQueue(), api.core.World.getRemovePlayerQueue()]) {
        const index = queue.indexOf(bot);
        if (index !== -1) queue.splice(index, 1);
      }
      api.core.TaskManager.cancelTasks(bot);
      api.core.TaskManager.cancelTasks(bot.getIndex());
      bot.setRegistered(false);
    }
    api.core.TaskManager.cancelTasks(api.core.Task.DEFAULT_KEY);
    assert.equal(runtime.entriesByUsername.size, 0);
    assert.equal(runtime.entries.length, 0);
    configureBrainActivities();
    setActiveBotRuntime(null, null);
    PluginManager.pluginConfigCache = previousConfig;
  });

  const activityId = 'plugin_developer_policy';
  api.onCustomEvent('bots:collect-definitions', ({ registerRoutine }) => registerRoutine({
    id: activityId, name: 'Developer policy test', repeat: false,
    spawnSetup: { inventory: [{ slot: 0, id: ItemIds.COINS, amount: 50 }] },
    createActions: ({ action }) => [action({ type: 'wait', seconds: 1 })],
  }));
  brainRegistry.installCodeDefinitions();
  assert.ok(brainRegistry.byId.get(activityId));
  const deploy = () => deployRoutineBots({ runtime, brainRegistry, core: api.core, activityId, count: 1 });

  await t.test('developer-only worlds permit routines without permitting world population', () => {
    assert.equal(runtime.spawnPvpBot(new api.core.Location(3222, 3218)), false);
    const result = deploy();
    assert.equal(result.ok, true);
    assert.equal(result.spawned.length, 1);
    const entry = runtime.entriesByUsername.get(result.spawned[0]);
    assert.ok(entry.player instanceof Player);
    assert.equal(entry.player.isPlayerBot(), true);
    assert.equal(entry.adminDeployedActivityId, activityId);
    assert.equal(entry.brain.isRunningActivity(activityId), true);
    assert.equal(entry.player.getInventory().getAmount(ItemIds.COINS), 50);
    assert.ok(api.core.World.getAddPlayerQueue().includes(entry.player));
  });

  await t.test('the production ::bot command respects and stamps a code routine activation ID', t => {
    const { activation, ACTIVATION_ATTRIBUTE, createActivationStore } = require('../plugins/bots/runtime/Activation.PlayerBots');
    const file = path.join(scratch, 'activation.json');
    const store = createActivationStore(file);
    t.after(() => fs.rmSync(file, { force: true }));
    t.mock.method(activation, 'allowed', store.allowed);
    const messages = [];
    const player = { getRights: () => api.core.PlayerRights.DEVELOPER, getLocation: () => new api.core.Location(3222, 3218), sendMessage: text => messages.push(text) };
    const command = () => PluginManager.emitCommand({ player, raw: `bot ${activityId}`, base: 'bot', parts: ['bot', activityId], handled: false });
    const before = new Set(runtime.entriesByUsername.keys());

    store.set(activityId, false);
    assert.equal(command(), true);
    assert.deepEqual(new Set(runtime.entriesByUsername.keys()), before);
    assert.match(messages.at(-1), /Unable to spawn/);

    store.set(activityId, true);
    assert.equal(command(), true);
    const [entry] = [...runtime.entriesByUsername.entries()].filter(([name]) => !before.has(name)).map(([, value]) => value);
    assert.equal(entry.player.getAttribute(ACTIVATION_ATTRIBUTE), activityId);
    assert.equal(entry.brain.isRunningActivity(activityId), true);

    const { updateDeployment } = require('../plugins/tools/worldadmin/Activation.WorldAdmin');
    const update = enabled => updateDeployment(api, runtime, brainRegistry, { id: activityId, enabled }, store);
    assert.ok(update(false).stopped > 0);
    const world = api.getWorld();
    assert.ok(world.getRemovePlayerQueue().includes(entry.player));
    assert.ok(world.getAddPlayerQueue().includes(entry.player));
    const replacement = update(true);
    assert.equal(replacement.notice, null);
    assert.equal(replacement.spawned.length, 1);
    assert.notEqual(replacement.spawned[0], entry.player.getUsername());
  });

  await t.test('allowing world population does not permit developer routine deployment', () => {
    PluginManager.pluginConfigCache = { 'PlayerBots:allowedActivities': ['world'], 'PlayerBots:ai': { enabled: false } };
    const beforeEntries = [...runtime.entriesByUsername.entries()];
    const beforeQueue = [...api.core.World.getAddPlayerQueue()];
    const result = deploy();
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.deepEqual([...runtime.entriesByUsername.entries()], beforeEntries);
    assert.deepEqual(api.core.World.getAddPlayerQueue(), beforeQueue);
  });
});
