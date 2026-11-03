const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Wilderness = require('../plugins/areas/Wilderness.plugin');
const core = PluginManager.getCoreApi();
let board;
let nextIndex = 0;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3095, 3500);
  core.RegionManager.loadMapFiles(3123, 3629);
  board = [...core.MapObjects.mapObjects.values()].flat().find(object => object.getId() === core.ObjectIdentifiers.WILDERNESS_STATISTICS);
  Wilderness.register({ ...PluginManager.createApi('WildernessStatisticsTest'), getTaskManager: () => ({ submit() {} }) });
});

function player(t, x = 3095, y = 3526) {
  const p = new Player(null, new core.Location(x, y));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write() {} }));
  return p;
}

function toggle(p) {
  return PluginManager.emitObjectInteraction({ player: p, object: board, objectId: board.getId(), clickType: 2, handled: false });
}

test('the real Edgeville board dispatches Toggle K/D and preserves the shared Wilderness varp', t => {
  assert.ok(board);
  assert.equal(board.getDefinition().getInteractions()[1], 'Toggle K/D');
  const p = player(t), sender = p.getPacketSender();
  sender.sendVarbit(5963, 1);
  assert.equal(toggle(p), true);
  assert.equal(sender.getVarbit(4143), 1);
  assert.equal(sender.getVarbit(5963), 1, 'the overlay toggle does not clear Wilderness membership');
  assert.equal(toggle(p), true);
  assert.equal(sender.getVarbit(4143), 0);
});

test('dedicated counts and the toggle survive native persistence; old killstreak totals are not imported', t => {
  const killer = player(t), victim = player(t, 3096);
  killer.setAttribute('killstreaks:total-kills', 999);
  victim.setAttribute('killstreaks:deaths', 999);
  PluginManager.emitPlayerLogin({ player: killer, username: 'statistics' });
  assert.equal(killer.getPacketSender().getVarbit(8376), 0);
  assert.equal(killer.getPacketSender().getVarbit(4143), 0);
  assert.equal(toggle(killer), true);
  for (let i = 0; i < 2; i++) PluginManager.emitPlayerDefeated(killer, victim);
  assert.equal(killer.getPacketSender().getVarbit(8376), 2, 'repeated kills are statistics, independent of reward eligibility');
  assert.equal(victim.getPacketSender().getVarbit(8375), 2);
  const loaded = player(t);
  PlayerSave.fromPlayer(killer).applyToPlayer(loaded);
  PluginManager.emitPlayerLogin({ player: loaded, username: 'loadedstatistics' });
  assert.equal(loaded.getPacketSender().getVarbit(8376), 2);
  assert.equal(loaded.getPacketSender().getVarbit(4143), 1);
  assert.equal(loaded.getAttribute('killstreaks:total-kills'), 999);
  const fresh = PlayerSave.fromPlayer(player(t));
  for (const key of ['wilderness-statistics:kills', 'wilderness-statistics:deaths', 'wilderness-statistics:show-kd']) {
    assert.equal(key in fresh.attributes, false, 'default values are omitted from saves');
  }
});

test('only attributed human PvP deaths in the actual Wilderness count', t => {
  const { WORLD_ZONE_BOUNDARIES } = require('../dist/game/definition/WorldDefinition');
  const killer = player(t), victim = player(t, 3096);
  for (const [x, y] of [[3096, 3526], [3100, 9921]]) {
    victim.setLocation(new core.Location(x, y));
    PluginManager.emitPlayerDefeated(killer, victim);
  }
  assert.equal(killer.getPacketSender().getVarbit(8376), 2, 'level 1 and underground Wilderness both count');
  const pvp = new core.Boundary(0, 0x3fff, 0, 0x3fff, 0);
  WORLD_ZONE_BOUNDARIES.pvp.push(pvp);
  t.after(() => WORLD_ZONE_BOUNDARIES.pvp.splice(WORLD_ZONE_BOUNDARIES.pvp.indexOf(pvp), 1));
  for (const [x, y] of [[3200, 3200], [2426, 3082], [3130, 3630], [3122, 3629]]) {
    victim.setLocation(new core.Location(x, y));
    assert.equal(core.Wilderness.isIn(victim), true, 'a broad PvP zone alone cannot establish Wilderness statistics eligibility');
    PluginManager.emitPlayerDefeated(killer, victim);
  }
  victim.setLocation(new core.Location(3096, 3526));
  PluginManager.emitPlayerDefeated(null, victim);
  PluginManager.emitPlayerDefeated(new core.NPC(core.NpcIdentifiers.GOBLIN, victim.getLocation()), victim);
  PluginManager.emitPlayerDefeated(victim, victim);
  killer.setPlayerBot(true);
  PluginManager.emitPlayerDefeated(killer, victim);
  killer.setPlayerBot(false);
  victim.setPlayerBot(true);
  PluginManager.emitPlayerDefeated(killer, victim);
  victim.setPlayerBot(false);
  const safe = new core.Boundary(3096, 3096, 3527, 3527, 0);
  WORLD_ZONE_BOUNDARIES.safe.push(safe);
  t.after(() => WORLD_ZONE_BOUNDARIES.safe.splice(WORLD_ZONE_BOUNDARIES.safe.indexOf(safe), 1));
  victim.setLocation(new core.Location(3096, 3527));
  PluginManager.emitPlayerDefeated(killer, victim);
  assert.equal(killer.getPacketSender().getVarbit(8376), 2, 'custom PvP zones, safe tiles, bots and unattributed deaths do not count');
  assert.equal(victim.getPacketSender().getVarbit(8375), 2);
});

test('the native death task records the attributed kill before respawn and persistence, after resetting Wilderness level', t => {
  const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
  const { GameConstants } = require('../dist/game/GameConstants');
  const killer = player(t), victim = player(t, 3096);
  victim.setWildernessLevel(1);
  victim.getCombat().addDamage(killer, 10);
  const saves = [];
  t.mock.method(core.ItemOnGroundManager, 'registerLocation', () => {});
  t.mock.method(core.TaskManager, 'submit', () => {});
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, 'requestSave', (p, reason) => saves.push({ reason, deaths: p.getAttribute('wilderness-statistics:deaths') }));
  const task = new PlayerDeathTask(victim);
  assert.equal(task.killer, killer, 'the real damage attribution selects the killer');
  killer.setLocation(new core.Location(3200, 3200));
  task.execute(); task.execute(); task.execute();
  assert.equal(victim.getWildernessLevel(), 0, 'resetAttributes ran before the defeat event');
  assert.equal(victim.getPacketSender().getVarbit(8375), 1);
  assert.equal(killer.getPacketSender().getVarbit(8376), 1, 'a killer leaving after lethal damage still receives credit');
  assert.equal(saves.find(save => save.reason === 'death')?.deaths, 1, 'the death snapshot includes the increment');
  assert.notEqual(victim.getLocation().getY(), 3526, 'the normal respawn still follows the event');
  const safeVictim = player(t, 3130, 3630);
  safeVictim.getCombat().addDamage(killer, 10);
  const safeDeath = new PlayerDeathTask(safeVictim);
  safeDeath.execute(); safeDeath.execute(); safeDeath.execute();
  assert.equal(safeVictim.getPacketSender().getVarbit(8375), 0, 'a queued attributed death after entering Ferox does not count');
  assert.equal(killer.getPacketSender().getVarbit(8376), 1);
});

test('counts saturate at the native 31-bit limit instead of wrapping the overlay to zero', t => {
  const killer = player(t), victim = player(t, 3096);
  killer.setAttribute('wilderness-statistics:kills', 0x7ffffffe);
  victim.setAttribute('wilderness-statistics:deaths', 0x7ffffffe);
  for (let i = 0; i < 2; i++) PluginManager.emitPlayerDefeated(killer, victim);
  assert.equal(killer.getPacketSender().getVarbit(8376), 0x7fffffff);
  assert.equal(victim.getPacketSender().getVarbit(8375), 0x7fffffff);
});
