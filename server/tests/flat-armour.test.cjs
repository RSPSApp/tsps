// NPC flat armour (Wiki: Flat armour): each landed melee/ranged splat a player deals gains a negative
// value or loses a positive one (to no less than 0); misses, magic and non-player attackers are untouched.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const DATA = require('../plugins/combat/data/npc-flat-armour.json');
let core, Plugin, index = 6950;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  Plugin = require('../plugins/combat/FlatArmour.plugin');
  Plugin.register(PluginManager.createApi('FlatArmourTest'));
});

function actors(t, gameval) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('FlatArmour' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  const id = typeof gameval === 'number' ? gameval : core.CacheDefinitions.getNpcId(gameval);
  const npc = PluginManager.spawnNpc({ id, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered(), `spawned ${gameval}`); npc.setNeedsPlacement(false);
  t.after(() => { player.setRegistered(false); npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  return { player, npc };
}

/** A hit from `attacker` with these splat damages, through the NPC's hit-modify hook as the hit queue does. */
function hitOn(npc, attacker, type, damages) {
  const method = type === core.CombatType.RANGED ? new core.RangedCombatMethod() : new core.MeleeCombatMethod();
  if (type === core.CombatType.MAGIC) method.type = () => core.CombatType.MAGIC;
  const hit = new core.PendingHit(attacker, npc, method, { hitAmount: damages.length });
  hit.getHits().forEach((splat, i) => splat.setDamage(damages[i]));
  hit.updateTotalDamage();
  return npc.manipulateHit(hit);
}
const splats = hit => hit.getHits().map(h => h.getDamage());

test('every gameval in the data resolves to a cache npc, and the Wiki values are on them', () => {
  for (const monster of DATA.monsters) {
    for (const gameval of monster.npcs) {
      const id = core.CacheDefinitions.getNpcId(gameval);
      assert.ok(id != null, gameval);
      assert.equal(Plugin.flatArmourOf(id), monster.flatArmour, `${gameval} (${monster.wiki})`);
    }
  }
  const of = gameval => Plugin.flatArmourOf(core.CacheDefinitions.getNpcId(gameval));
  assert.equal(of('frost_nagua'), -4);
  assert.equal(of('earth_nagua'), -4);
  assert.equal(of('pmoon_sulphur_nagua'), -4);
  assert.equal(of('pmoon_quest_nagua_vis'), -4);
  assert.equal(of('amoxliatl'), -2);
  assert.equal(of('pmoon_boss_blood_moon'), -2, 'the Moon players fight, not only its visual multi');
  assert.equal(of('pmoon_boss_blue_moon'), -5);
  assert.equal(of('superior_rockslug'), 2);
  assert.equal(of('elite_black_knight_1'), 7);
  assert.equal(of('wilderness_rune_golem'), 4);
  assert.equal(of('pmoon_boss_eclipse_moon_vis'), 0, 'Eclipse Moon is left to its fight (6, 4 during Clones)');
});

test('negative flat armour: a landed 1 against a Frost Nagua becomes 5, a miss stays 0, every splat of a multi-hit gets 4', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [1])), [5]);
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [0])), [0]);
  const multi = hitOn(npc, player, core.CombatType.RANGED, [3, 0, 7]);
  assert.deepEqual(splats(multi), [7, 0, 11]);
  assert.equal(multi.getTotalDamage(), 18);
});

test('the Sulphur Nagua keeps its -4 (now from the shared table)', t => {
  for (const gameval of ['pmoon_sulphur_nagua', 'pmoon_quest_nagua_vis']) {
    const { player, npc } = actors(t, gameval);
    assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [1])), [5], gameval);
  }
});

test('positive flat armour: a Giant rockslug (2) takes 2 off a landed hit, and a hit of 2 or less does nothing', t => {
  const { player, npc } = actors(t, 'superior_rockslug');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [10])), [8]);
  const low = hitOn(npc, player, core.CombatType.RANGED, [2, 1, 3]);
  assert.deepEqual(splats(low), [0, 0, 1]);
  assert.equal(low.getTotalDamage(), 1);
});

test('magic, other NPCs and monsters without flat armour are untouched', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MAGIC, [5])), [5], 'player magic ignores flat armour');
  const voidwaker = new core.PendingHit(player, npc, new core.MeleeCombatMethod(), { hitAmount: 1 });
  voidwaker.getHits()[0].setDamage(5); voidwaker.updateTotalDamage();
  t.mock.method(voidwaker, 'getProtectionType', () => core.CombatType.MAGIC);
  assert.deepEqual(splats(npc.manipulateHit(voidwaker)), [5], 'a melee swing dealing magic damage (the Voidwaker special) ignores it');
  const other = actors(t, core.NpcIdentifiers.SAND_CRAB);
  assert.deepEqual(splats(hitOn(npc, other.npc, core.CombatType.MELEE, [5])), [5], 'an NPC attacker (a thrall, say) is untouched');
  assert.deepEqual(splats(hitOn(other.npc, player, core.CombatType.MELEE, [2])), [2], 'a sand crab has no flat armour');
});
