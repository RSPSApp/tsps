// Flat armour is a target stat: it finalizes each rolled splat before HP/XP and content hooks that
// read or spend the damage at impact. Here the Moons of Peril and a plain recorder hook register *before*
// FlatArmour (plugins load in directory order, bosses/ before combat/) and still see the adjusted hit.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, index = 7050;
const seen = [];

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PluginManager.createApi('FlatArmourOrderRecorder').onNpcHitModify(({ hit }) => seen.push(hit.getTotalDamage()));
  require('../plugins/bosses/MoonsOfPeril.plugin').register(PluginManager.createApi('MoonsOfPeril'));
  require('../plugins/combat/FlatArmour.plugin').register(PluginManager.createApi('FlatArmour'));
  PluginManager.emitServerStartup({});
});

function newPlayer(t, at) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('FlatOrder' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(at); player.setNeedsPlacement(false);
  t.after(() => player.setRegistered(false));
  return player;
}

function meleeHit(player, npc, damage) {
  return new core.PendingHit(player, npc, new core.MeleeCombatMethod(), { damage, rollAccuracy: false });
}

test('an ordinary hook registered earlier reads the damage after flat armour', t => {
  const npc = PluginManager.spawnNpc({ id: core.CacheDefinitions.getNpcId('frost_nagua'), x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  t.after(() => { npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  seen.length = 0;
  const hit = npc.manipulateHit(meleeHit(newPlayer(t, new core.Location(3222, 3218)), npc, 1));
  assert.equal(hit.getTotalDamage(), 5);
  assert.deepEqual(seen, [5]);
});

test('the Blood and Blue Moons lose the adjusted damage from their fight health, not the rolled one', t => {
  const Cycle = require('../plugins/bosses/moonsofperil/Cycle.MoonsOfPeril.js');
  const { Fight } = require('../plugins/bosses/moonsofperil/Fight.MoonsOfPeril.js');
  for (const [moon, expected] of [['blue', 15], ['blood', 12]]) {
    const arena = Cycle.arenaOf(moon);
    const npc = arena.npc;
    assert.ok(npc, `${moon} moon spawned`);
    const player = newPlayer(t, npc.getLocation());
    const fight = new Fight(arena, player);
    arena.fights.set(player, fight); arena.attackable = true; arena.hidden = false;
    t.after(() => arena.fights.delete(player));
    const before = fight.hp;
    const hit = npc.manipulateHit(meleeHit(player, npc, 10));
    assert.equal(hit.getTotalDamage(), expected, `${moon} splat`);
    assert.equal(before - fight.hp, expected, `${moon} fight health drops by the splat`);
  }
});
