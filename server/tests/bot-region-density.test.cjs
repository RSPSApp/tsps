// Run after yarn build; real PlayerFactory, World list, movement and logout paths.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { World } = require('../dist/game/World');
const { Location } = require('../dist/game/model/Location');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { createBotPlayer } = require('../plugins/bots/behaviours/spawn/PlayerFactory.PlayerBots');
const { createBotRegistry } = require('../plugins/bots/runtime/Registry.PlayerBots');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize();
  RegionManager.init();
  RegionManager.loadMapFiles(3220, 3650);
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

function setup(t, overrides, globalTarget = 2, pool = 40) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let update;
  let snapshot = { radius: 0, regions: [50, 51, 52].map(regionX => ({ key: `0:${regionX}:57`, regionX, regionY: 57, z: 0 })) };
  const api = { core: PluginManager.getCoreApi(), getWorld: () => World,
    getRegionManager: () => RegionManager, log() {} };
  const registry = createBotRegistry({
    botApi: api, botCount: 0, wildernessRoamerBotCount: pool,
    wildernessActiveRegionBotsPerRegion: globalTarget,
    wildernessActiveRegionBotsByRegion: overrides,
    spawn: new Location(3222, 3218), behaviorMode: { PVP: 'pvp' },
    createBotPlayer, createInitialState: () => ({ pvp: {} }),
    applyInitialPvpLoadout: () => true, ensureBehaviorTaskStarted() {}, emitPlayerLogin() {},
    worldGetPlayerByName: name => World.getPlayerByName(name), randomInRange: min => min,
    onActiveRegionsUpdated: handler => { update = handler; },
    onPlayerMapSquareChange: handler => PluginManager.createApi('density-test').onPlayerMapSquareChange(handler),
    getActiveRegionSnapshot: () => snapshot,
  });
  const mapHooksBefore = PluginManager.mapSquareChangeHooks.length;
  registry.scheduleInitialSpawn();
  const pluginApi = PluginManager.createApi('density-logout-test');
  const hooksBefore = PluginManager.logoutHooks.length;
  pluginApi.onPlayerLogout(({ player, username }) => {
    if (registry.entriesByUsername.has(username)) registry.handleDisconnect(player, username);
  });
  t.after(() => {
    // Disable refill before actual deregistration so cleanup cannot spawn replacements.
    snapshot = { regions: [] };
    PluginManager.logoutHooks.length = hooksBefore;
    PluginManager.mapSquareChangeHooks.length = mapHooksBefore;
    for (const player of [...World.getPlayers()]) World.getPlayers().remove(player);
    World.getAddPlayerQueue().length = 0;
    World.getRemovePlayerQueue().length = 0;
  });
  return { registry, update: () => update(snapshot), unload: () => { snapshot = { regions: [] }; update(snapshot); },
    count(key) { return registry.entries.filter(e => e.state.roaming?.roamBounds?.id === key).length; },
    register() { for (const player of World.getAddPlayerQueue().splice(0)) World.getPlayers().add(player, true); },
    drainRemoval() { for (const player of World.getRemovePlayerQueue().splice(0)) World.getPlayers().remove(player); } };
}

test('regional targets preserve global fallback and reserve queued real Players across refill calls', t => {
  const h = setup(t, { '0:50:57': 1, '0:51:57': 0 });
  h.update();
  h.update();
  assert.equal(h.count('0:50:57'), 1);
  assert.equal(h.count('0:51:57'), 0);
  assert.equal(h.count('0:52:57'), 2);
  assert.ok(h.registry.entries.every(e => !e.player.isRegistered()));
  h.register();
  h.update();
  assert.equal(h.count('0:50:57'), 1);
  assert.equal(h.count('0:52:57'), 2);
  assert.equal(new Set(h.registry.entries.map(e => e.player.getUsername())).size, h.registry.entries.length);
});

test('a positive regional target works with a zero global target', t => {
  const h = setup(t, { '0:50:57': 3 }, 0);
  h.update();
  assert.equal(h.count('0:50:57'), 3);
  assert.equal(h.count('0:51:57'), 0);
  assert.equal(h.count('0:52:57'), 0);
});

test('a registered roamer crossing into a zero square settles there and refills its source', t => {
  const h = setup(t, { '0:50:57': 1, '0:51:57': 0 }, 0);
  h.update();
  h.register();
  const bot = h.registry.entries[0].player;
  bot.moveTo(new Location(3270, 3650));
  t.mock.timers.tick(600);
  t.mock.timers.tick(30000);
  assert.ok(World.getRemovePlayerQueue().includes(bot), 'native map-square hook schedules culling in the destination');
  h.drainRemoval();
  h.register();
  assert.equal(h.count('0:50:57'), 1, 'a replacement fills the source after the migrant leaves');
  assert.ok(!h.registry.entries.some(e => e.player === bot));
  h.unload();
  t.mock.timers.tick(31000);
  h.drainRemoval();
  assert.equal(h.count('0:50:57'), 0, 'inactive squares unload after the existing grace period');
});

test('the delayed cull rechecks hotspot population rather than retaining extra roamers', t => {
  const h = setup(t, { '0:50:57': 2 }, 0);
  h.update();
  t.mock.timers.tick(2000); // Let the existing paced fixed hotspots fill, with a controlled clock.
  h.register();
  const hotspot = h.registry.entries.find(e => e.state.roaming?.roamBounds?.id === 'edge_low').player;
  const roamers = h.registry.entries.filter(e => e.state.roaming?.roamBounds?.id === '0:50:57');
  assert.equal(roamers.length, 2);
  hotspot.moveTo(new Location(3220, 3650));
  h.update();
  t.mock.timers.tick(31000);
  assert.equal(roamers.filter(e => World.getRemovePlayerQueue().includes(e.player)).length, 1,
    'one hotspot consumes one of the two regional slots even in the timer recheck');
  assert.ok(!World.getRemovePlayerQueue().includes(hotspot), 'regional targets never evict fixed hotspots');
});

test('a migrated roamer with a real pending hit is retained until it can safely leave', t => {
  const h = setup(t, { '0:50:57': 1, '0:51:57': 0 }, 0);
  h.update(); h.register();
  const bot = h.registry.entries[0].player;
  const attacker = createBotPlayer('density-attacker', bot.getLocation().clone().add(0, 5), {
    api: { getWorld: () => World }, loadPersistence: false, saveRandomizedAppearance: false,
  });
  attacker.setPlayerBot(true);
  h.register();
  bot.setNeedsPlacement(false);
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
  for (const hit of new RangedCombatMethod().hits(attacker, bot)) CombatFactory.addPendingHit(hit);
  assert.equal(bot.getCombat().getHitQueue().hasPendingWork(), true);
  bot.moveTo(new Location(3270, 3650));
  t.mock.timers.tick(600); t.mock.timers.tick(30000);
  assert.ok(!World.getRemovePlayerQueue().includes(bot));
  bot.getCombat().getHitQueue().clear();
  h.update(); t.mock.timers.tick(30000);
  assert.ok(World.getRemovePlayerQueue().includes(bot));
});

test('world density mapping reaches the population settings while shipped defaults stay intact', t => {
  const modulePath = require.resolve('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  const original = require.cache[modulePath];
  const key = 'PlayerBots:activeRegionBotsByRegion';
  const getConfig = PluginManager.getPluginConfig.bind(PluginManager);
  t.mock.method(PluginManager, 'getPluginConfig', name => name === key ? { '0:50:158': 3, '0:50:159': 0 } : getConfig(name));
  try {
    delete require.cache[modulePath];
    const { PVP_BOT_SETTINGS, getEnabledWildernessHotspots } = require(modulePath);
    assert.deepEqual({ ...PVP_BOT_SETTINGS.activeRegionBotsByRegion }, { '0:50:158': 3, '0:50:159': 0 });
    assert.equal(PVP_BOT_SETTINGS.activeRegionBotsPerRegion, 16);
    assert.equal(PVP_BOT_SETTINGS.botPool, 845);
    assert.deepEqual(getEnabledWildernessHotspots().map(h => h.targetBots), [5, 5, 5, 10]);
  } finally { require.cache[modulePath] = original; }
});

test('density overrides validate canonical map squares and finite integer counts without coercion', () => {
  const { normalizeRegionDensity } = require('../plugins/bots/behaviours/pvp/RegionDensity.PlayerBots');
  const warnings = [];
  const warn = message => warnings.push(message);
  const raw = { '0:50:158': 0, '3:255:255': 40, '0:49:57': 41, '0:50:57': -1,
    '0:51:57': 1.5, '0:52:57': '3', '0:53:57': null, '0:54:57': Infinity,
    '4:50:57': 1, '0:256:57': 1, '0:050:57': 1, '0:50:57:extra': 1, '__proto__': 3 };
  assert.deepEqual({ ...normalizeRegionDensity(raw, 40, warn) }, { '0:50:158': 0, '3:255:255': 40 });
  assert.equal(warnings.length, 10);
  for (const malformed of [null, false, [], 3, 'invalid']) {
    assert.deepEqual({ ...normalizeRegionDensity(malformed, 40, warn) }, {});
  }
});
