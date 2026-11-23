// Shadow spider (3016): the first attack of a fight drains half the target's Prayer (Wiki: rounded up,
// never the last point; a spectral spirit shield halves it), with "The spider drains your prayer..."
// and synth 2672 (rsprox local recordings 1001903 and 1001457).
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Plugin = require('../plugins/npcs/ShadowSpiders.plugin');

const SPECTRAL_SPIRIT_SHIELD = 12821;
let core, index = 7300;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  Plugin.register(PluginManager.createApi('ShadowSpidersTest'));
  require('../plugins/combat/effects/SpiritShields.EquipmentEffects')(PluginManager.createApi('SpiritShieldsTest'));
});

function actors(t, prayer, id = core.NpcIdentifiers.SHADOW_SPIDER) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('SpiderTest' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99); player.setHitpoints(99);
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, prayer);
  const messages = [], sounds = [];
  t.mock.method(player.getPacketSender(), 'sendMessage', m => { messages.push(String(m)); return player.getPacketSender(); });
  t.mock.method(core.Sounds, 'sendSound', (who, sound) => { if (who === player) sounds.push(sound.getId?.() ?? sound.id); });
  const npc = PluginManager.spawnNpc({ id, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered()); npc.setNeedsPlacement(false);
  t.after(() => {
    player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex());
    npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc);
  });
  return { player, npc, messages, sounds, prayer: () => player.getSkillManager().getCurrentLevel(core.Skill.PRAYER) };
}

/** One real swing through Combat: the spider targets the player and attacks now. */
function swing(npc, player) {
  if (npc.getCombat().getTarget() !== player) npc.getCombat().attack(player);
  npc.getCombat().setAttackDelay(0);
  assert.equal(npc.getCombat().performNewAttack(true), true, 'the spider swings');
}

test('Wiki: half of the current prayer, rounded up, never the last point', () => {
  const { prayerDrain } = Plugin._test;
  assert.equal(prayerDrain(52), 26);
  assert.equal(prayerDrain(21), 11);
  assert.equal(prayerDrain(13), 7);
  assert.equal(prayerDrain(3), 2);
  assert.equal(prayerDrain(2), 1);
  assert.equal(prayerDrain(1), 0);
  assert.equal(prayerDrain(0), 0);
});

test('the spider uses its own melee method', t => {
  const { npc } = actors(t, 50);
  assert.ok(core.CombatFactory.getMethod(npc) instanceof Plugin._test.methodClass());
  assert.equal(core.CombatFactory.getMethod(npc).type(), core.CombatType.MELEE);
});

test('the first swing of a fight drains half, with the recorded message and sound; later swings do not', t => {
  const { player, npc, messages, sounds, prayer } = actors(t, 52);
  swing(npc, player);
  assert.equal(prayer(), 26, '52 drained by 26 (rsprox 1001457 tick 1452: 52 to 26)');
  assert.deepEqual(messages, [Plugin._test.DRAIN_MESSAGE]);
  assert.equal(messages[0], 'The spider drains your prayer...');
  assert.deepEqual(sounds.filter(id => id === 2672), [2672]);
  swing(npc, player);
  swing(npc, player);
  assert.equal(prayer(), 26, 'no drain on the same fight\'s later swings');
  assert.equal(messages.length, 1);
});

test('a new fight after the spider dropped the player drains again', t => {
  const { player, npc, messages, prayer } = actors(t, 26);
  swing(npc, player);
  assert.equal(prayer(), 13);
  npc.getCombat().reset();
  swing(npc, player);
  assert.equal(prayer(), 6, '13 drained by 7 (half rounded up)');
  assert.equal(messages.length, 2);
});

test('switching to another target and back is a new fight', t => {
  const { player, npc, prayer } = actors(t, 40);
  const other = actors(t, 40);
  swing(npc, player);
  assert.equal(prayer(), 20);
  swing(npc, other.player);
  assert.equal(other.prayer(), 20, 'the other player is drained by this spider\'s first swing at them');
  swing(npc, player);
  assert.equal(prayer(), 10);
});

test('the last prayer point is never taken, and nothing is sent when nothing drains', t => {
  const { player, npc, messages, sounds, prayer } = actors(t, 2);
  swing(npc, player);
  assert.equal(prayer(), 1);
  npc.getCombat().reset();
  swing(npc, player);
  assert.equal(prayer(), 1, 'the last point stays');
  assert.equal(messages.length, 1, 'no message for an empty drain');
  assert.equal(sounds.filter(id => id === 2672).length, 1);
});

test('a spectral spirit shield halves the drain (Wiki)', t => {
  const { player, npc, prayer } = actors(t, 40);
  player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(SPECTRAL_SPIRIT_SHIELD, 1));
  swing(npc, player);
  assert.equal(prayer(), 30, '20 halved to 10');
});

test('other NPCs do not drain prayer on their first swing', t => {
  const { player, npc, messages, prayer } = actors(t, 40, core.NpcIdentifiers.SAND_CRAB);
  swing(npc, player);
  assert.equal(prayer(), 40);
  assert.deepEqual(messages.filter(m => m.includes('drains your prayer')), []);
});
