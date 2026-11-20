const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { botRoutes, _test } = require('../plugins/tools/worldadmin/Bots.WorldAdmin');
const { setActiveBotRuntime } = require('../plugins/bots/runtime/RuntimeRegistry.PlayerBots');

function request(path, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  return req;
}
function response() {
  return {
    status: null,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

const coreSkills = [
  'Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing',
  'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Hunter', 'Construction', 'Sailing',
].map(name => ({ getName: () => name }));

test('activity list includes unscheduled built-ins and saved routines but not internal overlays', () => {
  const registry = { activities: [
    { id: 'custom_a', manual: true, codeDefined: true, spawnSetup: {}, repeat: true },
    { id: 'custom_b', manual: true, codeDefined: true, spawnSetup: null },
    { id: 'normal_trees', manual: false, spawnSetup: {} },
    { id: 'roam', manual: false, spawnSetup: {} },
    { id: 'pvp_engage', ephemeral: true, manual: false },
    { id: 'roam_step' }, { id: 'cut_trees' }, { id: 'castle_wars_match' }, { id: 'castle-wars' }, { id: 'pest-control-novice' },
  ] };
  assert.deepEqual(_test.activityList(registry).map(({ deploymentOverrides, ...entry }) => entry), [
    { id: 'custom_a', name: 'custom_a', repeat: true, setup: {} },
    { id: 'custom_b', name: 'custom_b', repeat: undefined, setup: { location: null, skills: {}, inventory: [], equipment: [] } },
    { id: 'normal_trees', name: 'Woodcutting — Normal trees', repeat: undefined, setup: {} },
  ]);
  assert.deepEqual(_test.activityList({ activities: [] }), []);
});

test('viewer enumeration returns online real-player clients and excludes bots', () => {
  const admin = { getUsername: () => 'AdminDev', getDisplayName: () => 'Developer', isPlayerBot: () => false };
  const player = { getUsername: () => 'Regular', isPlayerBot: () => false };
  const bot = { getUsername: () => 'ManagedBot', isPlayerBot: () => true };
  const viewers = _test.onlineViewers({ core: {
    World: { getPlayers: () => [admin, player, bot] },
    PlayerRights: { hasAdminRights: () => false },
  } });
  assert.deepEqual(viewers.map(viewer => [viewer.username, viewer.displayName]), [['AdminDev', 'Developer'], ['Regular', 'Regular']]);
});

test('deployment validates and applies setup to managed bots without a hard local count limit', async () => {
  const activity = { id: 'custom_routine', manual: true, codeDefined: true, deploymentOverrides: ['location', 'skills'], mode: 'custom_routine', repeat: false, spawnSetup: { location: null, skills: {}, inventory: [], equipment: [] } };
  const byId = new Map([[activity.id, activity]]);
  const entriesByUsername = new Map();
  let next = 0, attached = [];
  const runtime = {
    entriesByUsername,
    spawnPvpBot(location, options) {
      const username = `PanelBot${++next}`;
      const calls = [];
      const bot = {
        isPlayerBot: () => true, getUsername: () => username, requestLogout() { calls.push('logout'); }, calls,
        getSkillManager: () => ({ setMaxLevels() { return this; }, setCurrentLevel() { return this; }, setExperiences() { return this; } }),
        getInventory: () => ({ setItem() {} }), getEquipment: () => ({ setItem() {} }), getUpdateFlag: () => ({ flag() {} }),
      };
      entriesByUsername.set(username, { player: bot, state: { mode: options.mode } });
      return bot;
    },
  };
  const core = {
    Skill: { ATTACK: 'attack', values: () => coreSkills },
    SkillManager: { getExperienceForLevel: () => 0 },
    CacheDefinitions: { getItem: () => null },
    Location: class { constructor(x, y, z) { this.x=x;this.y=y;this.z=z; } },
    BonusManager: { update() {} }, WeaponInterfaceManager: { assign() {} }, Flag: { APPEARANCE: 'appearance' },
    PlayerRights: { hasAdminRights: () => false }, World: { getPlayerByName: () => null },
  };
  const handlerPath = require.resolve('../plugins/bots/brain/BrainActivities.PlayerBots');
  const previous = require.cache[handlerPath];
  require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: { startActivity(bot, id, options) { attached.push([bot.getUsername(), id, options.home]); return true; } } };
  setActiveBotRuntime(runtime, {}, { byId, activities: [] });
  try {
    const res = response();
    assert.equal(await botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 2, overrides: { location: { x: 3200, y: 3201, z: 0 }, skills: { attack: 30 } } }), res, new URL('http://localhost/api/bots/deploy'), { core }), true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.spawned, ['PanelBot1', 'PanelBot2']);
    assert.equal(attached.length, 2);
    assert.equal(attached[0][1], activity.id);
    assert.deepEqual([attached[0][2].x, attached[0][2].y, attached[0][2].z], [3200, 3201, 0]);
    assert.equal(entriesByUsername.get('PanelBot1').adminDeployedActivityId, activity.id);

    const restricted = { ...activity, id: 'plugin_restricted', codeDefined: true, deploymentOverrides: ['skills'] };
    byId.set(restricted.id, restricted);
    for (const body of [{ overrides: { location: { x: 3200, y: 3200, z: 0 } } }, { location: { x: 3200, y: 3200, z: 0 } }]) {
      await assert.rejects(botRoutes(request('/api/bots/deploy', { activityId: restricted.id, count: 1, ...body }), response(), new URL('http://localhost/api/bots/deploy'), { core }), error => error.status === 400);
    }
    const defaultActivity = { ...activity, id: 'custom_default', spawnSetup: null };
    byId.set(defaultActivity.id, defaultActivity);
    const defaultResponse = response();
    await botRoutes(request('/api/bots/deploy', { activityId: defaultActivity.id, count: 1, overrides: {} }), defaultResponse, new URL('http://localhost/api/bots/deploy'), { core });
    assert.equal(defaultResponse.status, 200);
    assert.deepEqual([attached[2][2].x, attached[2][2].y, attached[2][2].z], [3222, 3218, 0]);

    const batch = response();
    await botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 55 }), batch, new URL('http://localhost/api/bots/deploy'), { core });
    assert.equal(batch.body.spawned.length, 55);
    core.World = { getPlayers: () => ({ characters: Array(60), sizeReturn: () => 58 }), getAddPlayerQueue: () => [1] };
    await assert.rejects(botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 1 }), response(), new URL('http://localhost/api/bots/deploy'), { core }), /player slots/);
    assert.equal(next, 58, 'a rejected request did not allocate a player');
  } finally {
    if (previous) require.cache[handlerPath] = previous; else delete require.cache[handlerPath];
    setActiveBotRuntime(null, null, null);
  }
});

test('watching transfers a non-admin game client in read-only mode and releases it on return', async () => {
  const bot = { getUsername: () => 'ManagedBot', isPlayerBot: () => true };
  const viewer = { getUsername: () => 'AdminDev', isPlayerBot: () => false };
  const entry = { player: bot, state: { mode: 'custom_routine' }, adminDeployedActivityId: 'custom_routine', brain: { stopped: true, frames: [] } };
  const runtime = { entriesByUsername: new Map([['ManagedBot', entry]]) };
  let watchOptions, watchedTarget, release;
  const core = {
    World: { getPlayerByName: name => name.toLowerCase() === 'admindev' ? viewer : null },
    PlayerRights: { hasAdminRights: () => false },
    controlPlayer(owner, target, callback, options) { assert.equal(owner, viewer); watchedTarget = target; release = callback; watchOptions = options; return true; },
    releasePlayerControl(target) { assert.equal(target, bot); release(); return true; },
  };
  setActiveBotRuntime(runtime, {}, { activities: [] });
  try {
    const watchResponse = response();
    assert.equal(await botRoutes(request('/api/bots/watch', { bot: 'ManagedBot', viewer: 'AdminDev' }), watchResponse, new URL('http://localhost/api/bots/watch'), { core }), true);
    assert.equal(watchResponse.status, 200);
    assert.equal(watchOptions.readOnly, true);
    assert.equal(watchedTarget, bot);
    assert.equal(entry.spectating, true);
    assert.equal(entry.spectatorOwner, 'AdminDev');

    const returnResponse = response();
    assert.equal(await botRoutes(request('/api/bots/unwatch', { viewer: 'AdminDev' }), returnResponse, new URL('http://localhost/api/bots/unwatch'), { core }), true);
    assert.equal(returnResponse.status, 200);
    assert.equal(entry.spectating, false);
    assert.equal(entry.spectatorOwner, null);
  } finally { setActiveBotRuntime(null, null, null); }
});

test('live bot snapshot carries inventory, equipment and bot-brain activity', () => {
  const item = (id, amount, name) => ({ getId: () => id, getAmount: () => amount, getDefinition: () => ({ getName: () => name }) });
  const skills = { getCurrentLevel: () => 20, getMaxLevel: () => 30, getExperience: () => 1000, getCombatLevel: () => 42, getTotalLevel: () => 240 };
  const bot = {
    isPlayerBot: () => true, getUsername: () => 'ManagedBot', getDisplayName: () => 'Gatherer', getLocation: () => ({ getX: () => 3210, getY: () => 3220, getZ: () => 0 }),
    getSkillManager: () => skills, getCombat: () => ({ getTarget: () => null, getAttacker: () => null }), getHitpoints: () => 20, getRunEnergy: () => 75,
    getInventory: () => ({ getItems: () => [item(1511, 12, 'Logs')] }), getEquipment: () => ({ getItems: () => [item(1351, 1, 'Bronze axe')] }),
  };
  const frame = { action: () => ({ id: 'interactObject', describe: () => 'gather: chopping oak' }), actionIndex: 0, behaviour: { actions: [{}, {}] }, state: 'running' };
  const entry = { player: bot, state: { mode: 'custom_routine' }, adminDeployedActivityId: 'custom_routine', brain: { rootActivityId: 'custom_routine', frames: [frame] } };
  const runtime = { entriesByUsername: new Map([['ManagedBot', entry]]) };
  const world = { getPlayers: () => [bot], getRemovePlayerQueue: () => [] };
  const brainRegistry = { byId: new Map([['custom_routine', { name: 'Oak gatherer' }]]) };
  const [snapshot] = _test.monitoredBots(runtime, { Skill: { values: () => coreSkills } }, world, brainRegistry);
  assert.equal(snapshot.activityId, 'custom_routine');
  assert.equal(snapshot.routineName, 'Oak gatherer');
  assert.equal(snapshot.watchable, true);
  assert.equal(snapshot.managed, true);
  assert.equal(snapshot.action.description, 'gather: chopping oak');
  assert.deepEqual(snapshot.inventory, [{ slot: 0, id: 1511, name: 'Logs', amount: 12 }]);
  assert.deepEqual(snapshot.equipment, [{ slot: 0, id: 1351, name: 'Bronze axe', amount: 1 }]);
  assert.equal(snapshot.location.x, 3210);
  assert.equal(snapshot.totalLevel, 240);
});

test('online bots include native minigame bots, not real players, pending spawns or queued logouts', () => {
  const { ACTIVATION_ATTRIBUTE } = require('../plugins/bots/runtime/Activation.PlayerBots');
  const bot = name => ({ isPlayerBot: () => true, getUsername: () => name });
  const native = { ...bot('MatchBot'), getAttribute: key => key === ACTIVATION_ATTRIBUTE ? 'soul-wars' : null };
  const pending = bot('PendingBot');
  const leaving = bot('LeavingBot');
  const human = { ...bot('Human'), isPlayerBot: () => false };
  const runtime = { entriesByUsername: new Map([['PendingBot', { player: pending }], ['LeavingBot', { player: leaving }]]) };
  const world = { getPlayers: () => [native, leaving, human], getRemovePlayerQueue: () => [leaving] };
  const bots = _test.monitoredBots(runtime, { Skill: { values: () => [] } }, world);
  assert.deepEqual(bots.map(({ username, routineName, status, watchable }) => ({ username, routineName, status, watchable })), [
    { username: 'MatchBot', routineName: 'Soul Wars bots', status: 'online', watchable: false },
  ]);
});

test('browser bot bridge authenticates requests and retires visual authoring', async () => {
  const http = require('node:http');
  const { browserBotHandler } = require('../plugins/tools/worldadmin/Bots.WorldAdmin');
  const token = 'test-browser-bots-token';
  const server = http.createServer(browserBotHandler({ core: {} }, token, () => server.address().port));
  try {
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = base + '/api/bot-editor-validate';
    const validate = (headers, body) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/api/bots')).status, 401);
    assert.equal((await validate({ 'Content-Type': 'application/json' }, { activities: [] })).status, 401);

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await validate(headers, { activities: [] })).status, 410);
    assert.equal((await fetch(base + '/api/bot-editor', { headers })).status, 410);
    assert.equal((await fetch(base + '/api/bots', { headers })).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
