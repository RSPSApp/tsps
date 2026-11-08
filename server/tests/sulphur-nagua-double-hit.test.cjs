// Sulphur Nagua (13033): one attack is two same-tick splats sharing the 11 maximum (wiki: 6+5).
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const NAGUA = 13033;
let core, index = 6900;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  const api = PluginManager.createApi('SulphurNaguaTest');
  require('../plugins/npcs/SulphurNagua.plugin').register(api);
});
function actors(t, id) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('NaguaTest' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99); player.setHitpoints(99);
  const npc = PluginManager.spawnNpc({ id, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered()); npc.setNeedsPlacement(false);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  return { player, npc };
}
test('the nagua swings once for two splats that split the 11 maximum', t => {
  const { player, npc } = actors(t, NAGUA);
  assert.equal(npc.getDefinition().getMaxHit(), 11);
  const ranges = [];
  const api = PluginManager.createApi('SulphurNaguaRanges');
  api.onCustomEvent('combat:hit-rolled', event => { if (event.attacker === npc) ranges.push(event.maximum); });
  const originalAccuracy = core.AccuracyFormulasDpsCalc.rollAccuracy;
  core.AccuracyFormulasDpsCalc.rollAccuracy = (attacker, ...args) =>
    attacker === npc ? true : originalAccuracy.call(core.AccuracyFormulasDpsCalc, attacker, ...args);
  try {
    npc.getCombat().setTarget?.(player);
    const method = core.CombatFactory.getMethod(npc);
    assert.equal(method.type(), core.CombatType.MELEE);
    const hits = method.hits(npc, player);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].getHits().length, 2);
    assert.equal(hits[0].getHitDelays(), undefined, 'both splats land on the same tick');
    assert.equal(ranges.reduce((a, b) => a + b, 0), 11, 'the two maxima add up to 11');
    assert.deepEqual(ranges.slice().sort(), [5, 6]);
  } finally {
    core.AccuracyFormulasDpsCalc.rollAccuracy = originalAccuracy;
  }
});
test('an ordinary NPC still swings once', t => {
  const { player, npc } = actors(t, core.NpcIdentifiers.SAND_CRAB);
  npc.getCombat().setTarget?.(player);
  const hits = core.CombatFactory.getMethod(npc).hits(npc, player);
  assert.equal(hits.length, 1); assert.equal(hits[0].getHits().length, 1);
});
