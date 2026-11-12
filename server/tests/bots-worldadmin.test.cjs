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

test('activity list keeps only deployable custom graphs and advertises bounded AI routing', () => {
  const registry = { activities: [
    { id: 'custom_a', manual: true, spawnSetup: {}, repeat: true, usesAiAgent: true },
    { id: 'custom_b', manual: true, spawnSetup: null },
    { id: 'roam', manual: false, spawnSetup: {} },
  ] };
  assert.deepEqual(_test.activityList(registry), [
    { id: 'custom_a', repeat: true, setup: {}, usesAiAgent: true },
    { id: 'custom_b', repeat: undefined, setup: { location: null, skills: {}, inventory: [], equipment: [] }, usesAiAgent: false },
  ]);
  assert.equal(_test.MAX_DEPLOY_COUNT, 20);
  assert.equal(_test.MAX_MANAGED_BOTS, 50);
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

test('deployment validates and applies setup to managed graph bots with hard count limits', async () => {
  const activity = { id: 'custom_routine', manual: true, mode: 'custom_routine', repeat: false, spawnSetup: { location: null, skills: {}, inventory: [], equipment: [] }, usesAiAgent: false };
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
  setActiveBotRuntime(runtime, {}, { byId, activities: [], aiAgentAvailable: false });
  try {
    const res = response();
    assert.equal(await botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 2, overrides: { location: { x: 3200, y: 3201, z: 0 }, skills: { attack: 30 } } }), res, new URL('http://localhost/api/bots/deploy'), { core }), true);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.spawned, ['PanelBot1', 'PanelBot2']);
    assert.equal(attached.length, 2);
    assert.equal(attached[0][1], activity.id);
    assert.deepEqual([attached[0][2].x, attached[0][2].y, attached[0][2].z], [3200, 3201, 0]);
    assert.equal(entriesByUsername.get('PanelBot1').adminDeployedActivityId, activity.id);

    const defaultActivity = { ...activity, id: 'custom_default', spawnSetup: null };
    byId.set(defaultActivity.id, defaultActivity);
    const defaultResponse = response();
    await botRoutes(request('/api/bots/deploy', { activityId: defaultActivity.id, count: 1, overrides: {} }), defaultResponse, new URL('http://localhost/api/bots/deploy'), { core });
    assert.equal(defaultResponse.status, 200);
    assert.deepEqual([attached[2][2].x, attached[2][2].y, attached[2][2].z], [3222, 3218, 0]);

    await assert.rejects(botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 21, overrides: {} }), response(), new URL('http://localhost/api/bots/deploy'), { core }), error => error.status === 400);
    const aiActivity = { ...activity, id: 'custom_ai', usesAiAgent: true };
    byId.set(aiActivity.id, aiActivity);
    await assert.rejects(botRoutes(request('/api/bots/deploy', { activityId: aiActivity.id, count: 1, overrides: {} }), response(), new URL('http://localhost/api/bots/deploy'), { core }), error => error.status === 409);
    // Fill the managed cap synchronously and verify another deployment is rejected before spawn.
    for (let index = 4; index <= _test.MAX_MANAGED_BOTS; index++) entriesByUsername.set(`PanelBot${index}`, { adminDeployedActivityId: activity.id, player: { isPlayerBot: () => true } });
    await assert.rejects(botRoutes(request('/api/bots/deploy', { activityId: activity.id, count: 1, overrides: {} }), response(), new URL('http://localhost/api/bots/deploy'), { core }), error => error.status === 409);
    assert.equal(next, 3, 'failed preflight checks do not spawn extra bots');
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
  const frame = { action: () => ({ id: 'graph', describe: () => 'gather: chopping oak' }), actionIndex: 0, behaviour: { actions: [{}, {}] }, state: 'running' };
  const entry = { player: bot, state: { mode: 'custom_routine' }, adminDeployedActivityId: 'custom_routine', brain: { rootActivityId: 'custom_routine', frames: [frame] } };
  const runtime = { entriesByUsername: new Map([['ManagedBot', entry]]) };
  const [snapshot] = _test.monitoredBots(runtime, { Skill: { values: () => coreSkills } });
  assert.equal(snapshot.activityId, 'custom_routine');
  assert.equal(snapshot.managed, true);
  assert.equal(snapshot.action.description, 'gather: chopping oak');
  assert.deepEqual(snapshot.inventory, [{ slot: 0, id: 1511, name: 'Logs', amount: 12 }]);
  assert.deepEqual(snapshot.equipment, [{ slot: 0, id: 1351, name: 'Bronze axe', amount: 1 }]);
  assert.equal(snapshot.location.x, 3210);
  assert.equal(snapshot.totalLevel, 240);
});
