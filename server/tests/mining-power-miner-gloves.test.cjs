const assert = require('node:assert/strict'), path = require('node:path');
const {before, after, test} = require('node:test');
// This fixture loads all plugins: prevent player bots before plugin startup.
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
let core, PlayerSave, next = 1250;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); ({PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave')); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); core.RegionManager.loadMapFiles(2611,3295); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));


function actor(t) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('pwrminer'+next); p.setRegistered(true); p.setLocation(new core.Location(3222,3218,0)); p.needsPlacement=false;
  const c=new ClientConnection(channel); c.player=p;
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});
  return {p,c};
}

function miningCancellationTurn(f) {
  f.p.resetUpdating();
  core.World.processCycle=(core.World.processCycle+1)&0x7fffffff;
  core.TaskManager.process();
  f.c.processTurnPackets();
  const movement=f.p.getMovementQueue();
  movement.beginCycle();
  movement.processEntityPursuit();
  if(movement.hasPendingWork())movement.process();
  core.TaskManager.processWalkTo(f.p.getIndex());
}

// The historic Power Miner rule stacks its four-ore rock lifetime with the
// equipped gloves' saves, up to seven. These cases use the actual Mining task,
// cache object, packet dispatcher, League listeners, equipment and bank.
for (const [label, relic, gloves, total, amethyst] of [
  ['expert gloves and Power Miner', true, true, 7, false],
  ['Power Miner only', true, false, 4, false],
  ['expert gloves only', false, true, 4, false],
  ['neither enhancer', false, false, 1, false],
  ['Amethyst base-two legacy compatibility', true, true, 5, true],
]) test(`native Power Miner glove stacking: ${label}`, async t => {
  const f = actor(t), p = f.p, ids = core.ItemIdentifiers, skills = p.getSkillManager();
  // The Amethyst count preserves current TSPS composition; it is not an OSRS oracle.
  const oreId = amethyst ? ids.AMETHYST : ids.IRON_ORE, baseXp = amethyst ? 240 : 35;
  p.setAttribute('bot-skip-persistence', true);
  p.setProfile('league');
  p.setAttribute('league:type', 5);
  p.setAttribute('league:relics', relic ? { 0: 1 } : {});
  p.setAttribute('league:power-miner-mode', 'off');
  const Regions = require('../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks');
  const area = Regions.areaAt(5, 3222, 3218);
  if (area !== null) p.setAttribute('league:areas', [area]);
  PM.emitPlayerLogin({ player:p, username:p.getUsername(), isNewAccount:false, profile:'league' });
  p.setLocation(new core.Location(3222,3218,0));
  p.needsPlacement = false;
  skills.setMaxLevel(core.Skill.MINING, 99);
  skills.setExperience(core.Skill.MINING, core.SkillManager.getExperienceForLevel(99));
  skills.setCurrentLevel(core.Skill.MINING, 99);
  const toolId = relic ? ids.ECHO_PICKAXE : ids.RUNE_PICKAXE;
  p.getInventory().add(new core.Item(toolId), true);
  if (gloves) p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(ids.EXPERT_MINING_GLOVES));
  const profile = {player:p, league:null}; PM.emitCustomEvent('league:profile', profile);
  const picks = {player:p}; PM.emitCustomEvent('league:relics', picks);
  const hasPowerMiner = {player:p, relic:'power-miner'};
  PM.emitCustomEvent('league:has-relic', hasPowerMiner);
  const gate = PM.emitCanGainExperience(p, core.Skill.MINING, baseXp);
  assert.equal(p.getProfile(), 'league');
  assert.equal(profile.league, 5);
  assert.deepEqual(p.getAttribute('league:relics'), relic ? {0:1} : {});
  assert.deepEqual(picks.chosen, relic ? {0:1} : {});
  assert.equal(hasPowerMiner.active, relic);
  assert.equal(p.getAttribute('league:power-miner-mode'), 'off');
  assert.equal(p.getInventory().getAmount(toolId), 1);
  assert.equal(p.getEquipment().get(core.Equipment.HANDS_SLOT)?.getId() ?? -1, gloves ? ids.EXPERT_MINING_GLOVES : -1);
  assert.equal(skills.getCurrentLevel(core.Skill.MINING), 99);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.notEqual(gate.allow, false);
  assert.equal(gate.multiplier, 5, 'the real League experience gate uses its base 5x rate');
  const tab = core.Bank.getTabForItem(p, oreId), bank = p.getBank(tab);
  assert.ok(bank.getFreeSlots() > 0, 'the actual ore bank tab can accept the ore');
  assert.equal(bank.getAmount(oreId), 0);
  assert.equal(p.getInventory().getAmount(oreId), 0);
  const at = new core.Location(3223,3218,0), rockId = core.CacheDefinitions.getLocId(amethyst ? 'amethystrock1' : 'ironrock2');
  const emptyId = core.CacheDefinitions.getLocId(amethyst ? 'amethystrock_empty' : 'rocks2');
  assert.ok(rockId >= 0 && emptyId >= 0);
  const rock = new core.GameObject(rockId, at, amethyst ? 0 : 10, 0, null);
  t.after(() => {
    for (const task of [...core.TaskManager.activeTasks, ...core.TaskManager.pendingTasks.toArray()])
      if (task.originalRockObject === rock) task.stop();
    for (const id of [rockId,emptyId]) {
      const found = core.MapObjects.get(id, at, null);
      if (found) core.ObjectManager.deregister(found, true);
    }
  });
  core.ObjectManager.register(rock,true);
  assert.equal(core.MapObjects.get(rockId, at, null), rock);
  const def = core.ObjectDefinition.forPlayer(rockId,p);
  assert.equal(def.getName(), amethyst ? 'Amethyst crystals' : 'Iron rocks');
  assert.ok(def.getActions().includes('Mine'));
  core.TaskManager.process();
  const task = core.TaskManager.activeTasks.find(x => x.constructor.name === 'MiningTask');
  assert.ok(task);
  assert.equal(task.activeSessions.size, 0);
  const execute = task.execute.bind(task), levels = [], getLevel = skills.getCurrentLevel.bind(skills);
  let yieldDraws = 0;
  // These checks rely on Node's unminified stack names and fail if they drift.
  // Deliberately observe the level read inside rollAttempt, not unrelated level queries.
  // Keep this frame name aligned with Mining.plugin.js when that function is renamed.
  t.mock.method(skills,'getCurrentLevel', skill => {
    const level = getLevel(skill);
    if (skill === core.Skill.MINING && /\bat rollAttempt \(/.test(new Error().stack)) levels.push(level);
    return level;
  });
  t.mock.method(task,'execute', () => {
    const saved = Math.random;
    try {
      Math.random = () => {
        // Count the direct rockHolds yield draw, excluding other random consumers.
        // Keep this frame name aligned with Mining.plugin.js if it is renamed.
        const caller = new Error().stack.split('\n')[2] ?? '';
        if (amethyst && /\bat rockHolds \(/.test(caller)) yieldDraws++;
        return 0.01;
      };
      return execute();
    }
    finally { Math.random = saved; }
  });
  const gains = [], addXp = skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences', (skill, amount) => {
    if (skill === core.Skill.MINING) gains.push(amount);
    return addXp(skill,amount);
  });
  const {GameConstants} = require('../dist/game/GameConstants');
  const startXp = skills.getExperience(core.Skill.MINING);
  async function mineOut() {
    await f.c.dispatch([{type:'object_option',id:rockId,x:3223,y:3218,action:'Mine'}]);
    for (let i=0;i<60 && !core.MapObjects.get(emptyId,at,null);i++) miningCancellationTurn(f);
    assert.ok(core.MapObjects.get(emptyId,at,null), 'the registered rock actually depletes');
  }
  await mineOut();
  assert.ok(levels.length > 0 && levels.every(level => level === 99), 'actual consuming roll uses level 99');
  assert.equal(relic ? bank.getAmount(oreId) : p.getInventory().getAmount(oreId), total,
    'actual gathers before depletion');
  assert.equal(relic ? p.getInventory().getAmount(oreId) : bank.getAmount(oreId), 0,
    'the other destination has no duplicate');
  assert.equal(p.getBank(core.Bank.getTabForItem(p, ids.STEEL_BAR)).getAmount(ids.STEEL_BAR), 0,
    'off mode does not smelt the ore into steel');
  assert.deepEqual(gains,Array(total).fill(baseXp), 'each actual Mining call requests base XP');
  assert.equal(skills.getExperience(core.Skill.MINING)-startXp,baseXp*total*5*GameConstants.EXPERIENCE_MULTIPLIER);
  assert.equal(p.getAttribute('mining:ores-mined'),total);
  if (amethyst) assert.equal(yieldDraws,1,'base-two yield is drawn once');
  for (let i=0;i<(amethyst ? 125 : 9);i++) miningCancellationTurn(f);
  assert.equal(core.MapObjects.get(rockId,at,null),rock,'the original rock respawns');
  await mineOut();
  assert.ok(levels.length >= 2*total && levels.every(level => level === 99), 'both cycles use Mining 99');
  assert.equal(relic ? bank.getAmount(oreId) : p.getInventory().getAmount(oreId),2*total,
    'respawn has a fresh finite budget');
  assert.equal(p.getBank(core.Bank.getTabForItem(p, ids.STEEL_BAR)).getAmount(ids.STEEL_BAR), 0);
  assert.deepEqual(gains,Array(2*total).fill(baseXp));
  assert.equal(skills.getExperience(core.Skill.MINING)-startXp,2*baseXp*total*5*GameConstants.EXPERIENCE_MULTIPLIER);
  if (amethyst) assert.equal(yieldDraws,2,'respawn draws its own base-two yield');
  assert.equal(p.getAttribute('mining:ores-mined'),2*total);
});
