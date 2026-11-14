// Real cache, player, private area, Hespori NPC and Combat Achievements; network only is stubbed.
// Capture 234/03282: a farming-patch kill prints the kill count, then the fight duration.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, Data, Patches, Hespori, CaKills, patch, index = 1800;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(1246, 10085);
  Data = require('../plugins/skills/farming/Data.Farming');
  Patches = require('../plugins/skills/farming/Patches.Farming');
  Hespori = require('../plugins/skills/farming/Hespori.Farming');
  CaKills = require('../plugins/achievements/combatachievements/Kills.CombatAchievements');
  PM.emitServerStartup({});
  patch = Data.CACHE.patches.find(p => p.type === 'HESPORI');
});
function fixture(t) {
  const transport = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true,
    send:()=>true, close(){}, onData(){}, onError(){}, onClose(){} };
  const p = new Player(new PlayerSession(transport));
  p.setIndex(index++); p.setUsername('hespkill' + index); p.setRegistered(true);
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(1246, 10085, 0));
  const messages = [], configs = [];
  p.sendMessage = (message) => { messages.push(message); };
  const sender = p.getPacketSender();
  const sendConfig = sender.sendConfig.bind(sender);
  sender.sendConfig = (id, value) => { configs.push([id, value]); return sendConfig(id, value); };
  t.after(() => { PM.emitPlayerLogout({player:p, username:p.getUsername()}); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return { p, messages, configs };
}
function grow(p) {
  const state = Patches.stateFor(p, patch);
  delete state.hesporiLoot;
  Object.assign(state, { crop:'HESPORI', status:'grown', stage:3, nextAt:Number.MAX_SAFE_INTEGER });
  Patches.farmFor(p).deathbank = [];
}
/** Harvest (the fight starts a tick later), let `ticks` pass, then the boss's drops roll. */
function fightAndKill(f, ticks) {
  grow(f.p);
  const spawned = [], spawnNpc = core.PluginManager.spawnNpc;
  core.PluginManager.spawnNpc = (...args) => { const npc = spawnNpc.apply(core.PluginManager, args); spawned.push(npc); return npc; };
  try { Hespori.harvestHespori(f.p, patch); Patches.tick(); } finally { core.PluginManager.spawnNpc = spawnNpc; }
  const boss = spawned.find(n => n?.getId() === core.NpcIdentifiers.HESPORI);
  assert.ok(boss, 'the fight spawned its Hespori');
  core.World.processCycle += ticks;
  f.messages.length = 0; f.configs.length = 0;
  const event = { player:f.p, npc:boss, npcId:boss.getId(), drops:[], handled:false };
  Hespori.hesporiLoot(event);
  assert.equal(event.handled, true);
  boss.getCombat().reset(); f.p.getCombat().reset(); f.p.setNeedsPlacement(false);
  core.World.getRemoveNPCQueue().push(boss);
}

test('fight durations print as capture 234/03282 shows them', () => {
  const seen = { 50:'0:29', 47:'0:28', 63:'0:37', 54:'0:32', 65:'0:38', 51:'0:30', 56:'0:33', 60:'0:35', 100:'0:59', 101:'1:00' };
  for (const [ticks, text] of Object.entries(seen)) assert.equal(Hespori.formatFightTicks(Number(ticks)), text, `${ticks} ticks`);
});

test('a farming-patch kill sends the kill count, total_hespori_kills and the fight duration', t => {
  const f = fixture(t);
  CaKills.setCount(f.p, { name:'Hespori', killVarps:[2075] }, 3);
  fightAndKill(f, 50);
  assert.deepEqual(f.messages.slice(0, 2), [
    'Your Hespori kill count is: <col=ff0000>4</col>.',
    'Fight duration: <col=ff0000>0:29</col> (new personal best)',
  ]);
  assert.ok(f.configs.some(([id, value]) => id === 2075 && value === 4), 'total_hespori_kills 3 -> 4');
  assert.equal(Patches.farmFor(f.p).hesporiBestTicks, 50);
});

test('a slower or equal kill keeps the personal best; a faster one replaces it', t => {
  const f = fixture(t);
  fightAndKill(f, 47);
  assert.deepEqual(f.messages.slice(0, 2), ['Your Hespori kill count is: <col=ff0000>1</col>.', 'Fight duration: <col=ff0000>0:28</col> (new personal best)']);
  fightAndKill(f, 47);
  assert.equal(f.messages[1], 'Fight duration: <col=ff0000>0:28</col>. Personal best: 0:28');
  fightAndKill(f, 63);
  assert.deepEqual(f.messages.slice(0, 2), ['Your Hespori kill count is: <col=ff0000>3</col>.', 'Fight duration: <col=ff0000>0:37</col>. Personal best: 0:28']);
  assert.equal(Patches.farmFor(f.p).hesporiBestTicks, 47);
  fightAndKill(f, 40);
  assert.equal(f.messages[1], 'Fight duration: <col=ff0000>0:23</col> (new personal best)');
  assert.equal(Patches.farmFor(f.p).hesporiBestTicks, 40);
});

test('the Hespori counts once, by its plugin, not again by its death', t => {
  const f = fixture(t);
  fightAndKill(f, 50);
  const boss = { getMaxHitpoints:() => 300, getCurrentDefinition:() => ({ getName:() => 'Hespori' }) };
  CaKills.onNpcDeath({ npc:boss, killer:f.p });
  assert.equal(CaKills.counts(f.p).Hespori, 1);
});

test('the entangle line is the captured red one', () => {
  assert.equal(Hespori.VINES_MESSAGE, '<col=ef1020>The Hespori entangles you in some vines!</col>');
});

test('the speed tasks are judged from the fight clock, since the plugin counts the kill', t => {
  const CaData = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  const CaProgress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
  const done = (p, name) => CaProgress.isComplete(p, CaData.taskNamed(name).id);
  assert.equal(CaData.monsterNamed('Hespori').byEvent, true);
  const slow = fixture(t);
  fightAndKill(slow, 85); // 51 s
  assert.equal(done(slow.p, 'Hespori Speed-Trialist'), false);
  assert.equal(done(slow.p, 'Hespori Speed-Chaser'), false);
  const medium = fixture(t);
  fightAndKill(medium, 79); // 47.4 s
  assert.equal(done(medium.p, 'Hespori Speed-Trialist'), true);
  assert.equal(done(medium.p, 'Hespori Speed-Chaser'), false);
  const fast = fixture(t);
  fightAndKill(fast, 50); // 30 s
  assert.equal(done(fast.p, 'Hespori Speed-Trialist'), true);
  assert.equal(done(fast.p, 'Hespori Speed-Chaser'), true);
});
