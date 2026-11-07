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
before(async () => { await CachePipeline.initialize(path.resolve(__dirname,'..')); PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi(); ({PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave')); core.RegionManager.init(); core.RegionManager.loadMapFiles(3222,3218); core.RegionManager.loadMapFiles(2611,3295); core.RegionManager.loadMapFiles(1666,3136); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));


function actor(t, x=3222, y=3218) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername('varmine'+next); p.setRegistered(true); p.setLocation(new core.Location(x,y,0)); p.needsPlacement=false;
  const c=new ClientConnection(channel); c.player=p;
  t.after(()=>{
    let active;
    try {
      PM.emitPlayerDisconnect({player:p,username:p.getUsername()});
      active=require('../plugins/skills/Mining.plugin').isMiningActive(p);
    } finally {
      try { PM.emitPlayerLogout({player:p,username:p.getUsername()}); }
      finally {
        p.setRegistered(false);
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(p.getIndex());
        for(const n of [...core.World.getNpcs()]) if(n?.getOwner?.()===p) core.World.getNpcs().remove(n);
      }
    }
    assert.equal(active,false,'disconnect removes the real Mining session');
  });
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

// Ordinary iron has independent armour, Mining cape and charged-ring rolls.
// These expectations cover only iron, with real equipment and plugin listeners.
const configurations = [];
for (let mask = 0; mask < 8; mask++) configurations.push({
  label: `equipped mask ${mask}`, armour: !!(mask & 1), cape: !!(mask & 2),
  ring: !!(mask & 4), expected: 1 + Number(!!(mask & 1)) + Number(!!(mask & 2)) + Number(!!(mask & 4)),
});
// All three are worn: exercise mixed outcomes, not just gear presence. The
// ring and cape draws are identified at their actual existing module frames;
// the remaining non-ore draws use armourHit's controlled value.
for (const [armourHit,capeHit,ringHit] of [
  [true,true,false], [true,false,true], [true,false,false],
  [false,true,true], [false,true,false], [false,false,true], [false,false,false],
]) configurations.push({
  label:`all worn, rolls ${Number(armourHit)}${Number(capeHit)}${Number(ringHit)}`,
  armour:true,cape:true,ring:true,armourHit,capeHit,ringHit,
  expected:1+Number(armourHit)+Number(capeHit)+Number(ringHit),
});
configurations.push(
  ...[2,3,4].map(tier=>({label:`Varrock armour ${tier} on iron`,armour:true,armourTier:tier,cape:false,ring:false,expected:2})),
  {label:'charged ring spends its last charge',armour:false,cape:false,ring:true,initialCharges:1,expected:2},
  {label:'uncharged ring supplies only its level boost',armour:false,cape:false,ring:true,uncharged:true,expected:1},
  {label:'one remaining bonus slot, no storage', armour:true, cape:true, ring:true, slots:2, expected:2},
  {label:'no remaining bonus slot, no storage', armour:true, cape:true, ring:true, slots:1, expected:1},
  {label:'accepting Power Miner bank with full inventory', armour:true, cape:true, ring:true, bank:true, slots:0, expected:4},
  // This is an existing TSPS relic-composition control, not a separate retail claim.
  {label:'Hotfoot and Endless Harvest transform and bank', armour:true, cape:true, ring:true, bank:true, hotfoot:true, slots:0, expected:4},
);

for (const config of configurations) test(`native ordinary iron enhancers: ${config.label}`, async t => {
  const x=config.hotfoot ? 1666 : 3222, y=config.hotfoot ? 3136 : 3218;
  const f = actor(t,x,y), p = f.p, ids = core.ItemIdentifiers, skills = p.getSkillManager();
  p.setAttribute('bot-skip-persistence',true);
  if (config.bank) {
    p.setProfile('league');
    p.setAttribute('league:type',config.hotfoot ? 6 : 5);
    p.setAttribute('league:relics',config.hotfoot ? {0:1,1:1} : {0:1});
    if (!config.hotfoot) p.setAttribute('league:power-miner-mode','off');
    const area = require('../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks').areaAt(config.hotfoot ? 6 : 5,x,y);
    if (area !== null) p.setAttribute('league:areas',[area]);
  }
  PM.emitPlayerLogin({player:p,username:p.getUsername(),isNewAccount:false,profile:config.bank ? 'league' : 'main'});
  p.setLocation(new core.Location(x,y,0)); p.needsPlacement=false;
  if (config.hotfoot) {
    const regions=require('../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks');
    assert.equal(regions.areaAt(6,x,y),21);
    assert.equal(regions.isOpenAt(6,p,p.getLocation()),true,'Demonic Pacts permits this Varlamore fixture location');
  }
  skills.setMaxLevel(core.Skill.MINING,99);
  skills.setExperience(core.Skill.MINING,core.SkillManager.getExperienceForLevel(99));
  skills.setCurrentLevel(core.Skill.MINING,99);
  if (config.hotfoot) {
    skills.setMaxLevel(core.Skill.SMITHING,99);
    skills.setExperience(core.Skill.SMITHING,core.SkillManager.getExperienceForLevel(99));
    skills.setCurrentLevel(core.Skill.SMITHING,99);
    assert.equal(skills.getCurrentLevel(core.Skill.SMITHING),99);
  }
  const tool = config.bank && !config.hotfoot ? ids.ECHO_PICKAXE : ids.RUNE_PICKAXE;
  p.getInventory().add(new core.Item(tool),true);
  if (config.hotfoot) p.getEquipment().setItem(core.Equipment.FEET_SLOT,new core.Item(ids.SEARING_BOOTS));
  const armourId=ids[`VARROCK_ARMOUR_${config.armourTier ?? 1}`];
  if (config.armour) p.getEquipment().setItem(core.Equipment.BODY_SLOT,new core.Item(armourId));
  if (config.cape) p.getEquipment().setItem(core.Equipment.CAPE_SLOT,new core.Item(ids.MINING_CAPE));
  const Ring = require('../plugins/skills/shootingstars/CelestialRing.ShootingStars');
  let ring;
  if (config.ring) {
    ring = new core.Item(config.uncharged ? ids.CELESTIAL_RING_UNCHARGED_ : ids.CELESTIAL_RING);
    if (!config.uncharged) ring.setMetaValue(Ring.CHARGES_META_KEY,config.initialCharges ?? 10);
    p.getEquipment().setItem(core.Equipment.RING_SLOT,ring);
  }
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  assert.equal(skills.getCurrentLevel(core.Skill.MINING),99);
  assert.equal(p.getInventory().getAmount(tool),1);
  assert.equal(p.getEquipment().get(core.Equipment.BODY_SLOT)?.getId() ?? -1,config.armour ? armourId : -1);
  assert.equal(p.getEquipment().get(core.Equipment.CAPE_SLOT)?.getId() ?? -1,config.cape ? ids.MINING_CAPE : -1);
  assert.equal(p.getEquipment().get(core.Equipment.RING_SLOT)?.getId() ?? -1,
    config.ring ? (config.uncharged ? ids.CELESTIAL_RING_UNCHARGED_ : ids.CELESTIAL_RING) : -1);
  if (config.ring) assert.equal(Ring.charges(ring),config.uncharged ? 0 : (config.initialCharges ?? 10));
  const boost = {player:p,boost:0}; PM.emitCustomEvent('mining:level-boost',boost);
  assert.equal(boost.boost,config.ring ? 4 : 0,'the real equipped ring supplies the invisible boost');
  const rate = PM.emitCanGainExperience(p,core.Skill.MINING,35);
  assert.notEqual(rate.allow,false);
  assert.equal(rate.multiplier,config.hotfoot ? 8 : config.bank ? 5 : 1);
  if (config.bank) {
    const picks={player:p}; PM.emitCustomEvent('league:relics',picks);
    assert.equal(p.getAttribute('league:type'),config.hotfoot ? 6 : 5);
    assert.deepEqual(picks.chosen,config.hotfoot ? {0:1,1:1} : {0:1});
    const active = {player:p,relic:config.hotfoot ? 'endless-harvest' : 'power-miner'};
    PM.emitCustomEvent('league:has-relic',active);
    assert.equal(p.getProfile(),'league'); assert.equal(active.active,true);
    if (config.hotfoot) {
      const hotfoot={player:p,relic:'hotfoot'}; PM.emitCustomEvent('league:has-relic',hotfoot);
      assert.equal(hotfoot.active,true);
      assert.equal(p.getEquipment().get(core.Equipment.FEET_SLOT)?.getId(),ids.SEARING_BOOTS);
    } else assert.equal(p.getAttribute('league:power-miner-mode'),'off');
  } else assert.notEqual(p.getProfile(),'league');
  if (config.slots !== undefined) {
    for (let n=0;n<28 && p.getInventory().getFreeSlots()>config.slots;n++)
      p.getInventory().add(new core.Item(ids.RAKE),false);
    assert.equal(p.getInventory().getFreeSlots(),config.slots);
  } else assert.ok(p.getInventory().getFreeSlots() >= 4);
  const storage = {player:p,itemId:ids.IRON_ORE,skill:core.Skill.MINING,room:false};
  PM.emitCustomEvent('storage:room',storage);
  assert.equal(storage.room,!!config.bank,'the actual storage path is explicitly qualified');
  const bank = p.getBank(core.Bank.getTabForItem(p,ids.IRON_ORE));
  const outputBank = p.getBank(core.Bank.getTabForItem(p,config.hotfoot ? ids.STEEL_BAR : ids.IRON_ORE));
  assert.ok(bank.getFreeSlots()>0);
  assert.ok(outputBank.getFreeSlots()>0);
  assert.equal(bank.getAmount(ids.IRON_ORE),0);
  if (config.hotfoot) assert.equal(outputBank.getAmount(ids.STEEL_BAR),0);
  assert.equal(p.getInventory().getAmount(ids.IRON_ORE),0);
  // The registered iron target is synthetic; this does not assert a rock spawn at the fixture tile.
  const at = new core.Location(x+1,y,0), rockId=core.CacheDefinitions.getLocId('ironrock2');
  const emptyId=core.CacheDefinitions.getLocId('rocks2');
  assert.ok(rockId>=0 && emptyId>=0);
  const rock = new core.GameObject(rockId,at,10,0,null);
  t.after(() => {
    for (const task of [...core.TaskManager.activeTasks,...core.TaskManager.pendingTasks.toArray()])
      if (task.originalRockObject===rock) task.stop();
    for (const id of [rockId,emptyId]) {
      const object = core.MapObjects.get(id,at,null);
      if (object) core.ObjectManager.deregister(object,true);
    }
    for (const ground of [...core.World.getItems()])
      if (ground.getOwner()===p.getUsername() && ground.getItem().getId()===ids.IRON_ORE)
        core.ItemOnGroundManager.deregister(ground);
  });
  core.ObjectManager.register(rock,true);
  assert.equal(core.MapObjects.get(rockId,at,null),rock);
  const definition=core.ObjectDefinition.forPlayer(rockId,p);
  assert.equal(definition.getName(),'Iron rocks'); assert.ok(definition.getActions().includes('Mine'));
  core.TaskManager.process();
  const task=core.TaskManager.activeTasks.find(x=>x.constructor.name==='MiningTask');
  assert.ok(task); assert.equal(task.activeSessions.size,0);
  const execute=task.execute.bind(task), levels=[], getLevel=skills.getCurrentLevel.bind(skills);
  let capeDraws=0, ringDraws=0, successes=0, depletionEvents=0, extraRequests=0;
  // The consumed ore-roll level is checked at the existing source frame.
  t.mock.method(skills,'getCurrentLevel',skill=>{
    const result=getLevel(skill);
    if (skill===core.Skill.MINING && /\bat rollAttempt \(/.test(new Error().stack)) levels.push(result);
    return result;
  });
  t.mock.method(task,'execute',()=>{
    const saved=Math.random;
    try {
      Math.random=()=>{
        const stack=new Error().stack;
        if (/Passive\.SkillCapes\.js/.test(stack)) {capeDraws++; return config.capeHit===false ? 0.99 : 0.01;}
        if (/CelestialRing\.ShootingStars\.js/.test(stack)) {ringDraws++; return config.ringHit===false ? 0.99 : 0.01;}
        if (/\bat rollAttempt \(/.test(stack)) return 0.01;
        return config.armourHit===false ? 0.99 : 0.01;
      };
      return execute();
    } finally { Math.random=saved; }
  });
  const emit=PM.emitCustomEvent.bind(PM);
  t.mock.method(PM,'emitCustomEvent',(name,request)=>{
    const result=emit(name,request);
    if (request?.player===p) {
      if (name==='mining:success') successes++;
      if (name==='mining:deplete-rock') depletionEvents++;
      if (name==='mining:extra-ore') extraRequests++;
    }
    return result;
  });
  const gains=[], addXp=skills.addExperiences.bind(skills);
  t.mock.method(skills,'addExperiences',(skill,amount)=>{
    if (skill===core.Skill.MINING) gains.push(amount);
    return addXp(skill,amount);
  });
  const {GameConstants}=require('../dist/game/GameConstants');
  const startXp=skills.getExperience(core.Skill.MINING);
  const startSmithXp=skills.getExperience(core.Skill.SMITHING);
  await f.c.dispatch([{type:'object_option',id:rockId,x:x+1,y,action:'Mine'}]);
  for (let i=0;i<90 && (config.hotfoot ? successes===0 : !core.MapObjects.get(emptyId,at,null));i++)
    miningCancellationTurn(f);
  if (config.hotfoot) {
    assert.equal(p.getLocation().getX(),x); assert.equal(p.getLocation().getY(),y);
    assert.equal(require('../plugins/modes/leagueareas/Regions.LeagueAreaUnlocks').isOpenAt(6,p,p.getLocation()),true);
  }
  assert.ok(levels.length>0 && levels.every(level=>level===99),'the consuming roll reads visible level 99');
  assert.ok(p.getAttribute('mining:ores-mined')>0,'one real successful gather occurred');
  const baseGathers=config.bank && !config.hotfoot ? 4 : 1;
  if (config.ring) {
    const left=config.uncharged ? 0 : (config.initialCharges ?? 10)-baseGathers;
    assert.equal(Ring.charges(ring),left,'each charged eligible base gather spends one charge');
    if (left===0) assert.equal(ring.getId(),ids.CELESTIAL_RING_UNCHARGED_,'the last charge changes the real worn ring');
  }
  if (config.hotfoot) assert.equal(core.MapObjects.get(rockId,at,null),rock,'Endless Harvest retained the real rock');
  else assert.ok(core.MapObjects.get(emptyId,at,null),'the ordinary iron rock actually depleted');
  const inventoryOre=p.getInventory().getAmount(ids.IRON_ORE), bankOre=bank.getAmount(ids.IRON_ORE);
  const delivered=config.hotfoot ? outputBank.getAmount(ids.STEEL_BAR) : config.bank ? bankOre : inventoryOre;
  assert.equal(delivered,baseGathers*config.expected*(config.hotfoot ? 2 : 1),'base and deliverable bonuses reach the selected storage');
  assert.equal(config.bank ? inventoryOre : bankOre,0,'no duplicate at the other destination');
  if (config.hotfoot) {
    assert.equal(bankOre,0,'Hotfoot supplies bars, not unprocessed bank ore');
    assert.equal(p.getInventory().getAmount(ids.STEEL_BAR),0,'processed bars are not duplicated in inventory');
  }
  const groundOre=[...core.World.getItems()].filter(x=>x.getOwner()===p.getUsername()
    && [ids.IRON_ORE,ids.STEEL_BAR].includes(x.getItem().getId()));
  assert.equal(groundOre.length,0,'bonus resources are not credited as undeliverable ground drops');
  assert.equal(p.getAttribute('mining:ores-mined'),baseGathers*config.expected);
  const xpAwards=baseGathers*config.expected*(config.hotfoot ? 2 : 1);
  assert.deepEqual(gains,Array(xpAwards).fill(35));
  assert.equal(skills.getExperience(core.Skill.MINING)-startXp,
    35*xpAwards*rate.multiplier*GameConstants.EXPERIENCE_MULTIPLIER);
  if (config.hotfoot) assert.equal(skills.getExperience(core.Skill.SMITHING)-startSmithXp,
    17.5*config.expected*rate.multiplier*GameConstants.EXPERIENCE_MULTIPLIER,
    'the existing transformation awards Smithing XP for each logical ore request');
  assert.equal(successes,baseGathers,'bonus ores do not recursively trigger mining success');
  assert.equal(depletionEvents,baseGathers,'bonus ores do not cause additional depletion attempts');
  assert.equal(extraRequests,baseGathers,'each base gather requests bonuses once');
  if (config.slots === undefined || config.bank) {
    assert.equal(capeDraws,config.cape ? baseGathers : 0,'the worn cape rolls independently');
    assert.equal(ringDraws,config.ring && !config.uncharged ? baseGathers : 0,'the charged ring rolls independently');
  }
});

test('Varrock armour ordinary ore tier boundaries through the registered listener', t=>{
  const f=actor(t), p=f.p, I=core.ItemIdentifiers;
  p.setAttribute('bot-skip-persistence',true);
  assert.equal(core.WorldDefinition.isMembersWorld(),true);
  const ores=[
    [I.COPPER_ORE,1,1], [I.TIN_ORE,1,1], [I.IRON_ORE,15,1],
    [I.SILVER_ORE,20,1], [I.COAL,30,1], [I.GOLD_ORE,40,1], [I.LEAD_ORE,25,1],
    [I.MITHRIL_ORE,55,2], [I.ADAMANTITE_ORE,70,3], [I.RUNITE_ORE,85,4],
  ];
  t.mock.method(Math,'random',()=>0.01);
  for (let tier=1;tier<=4;tier++) {
    p.getEquipment().setItem(core.Equipment.BODY_SLOT,new core.Item(I[`VARROCK_ARMOUR_${tier}`]));
    for (const [oreId,rockLevel,minimum] of ores) {
      const request={player:p,oreId,rockLevel,bonuses:[]};
      PM.emitCustomEvent('mining:extra-ore',request);
      assert.equal(request.bonuses.length,tier>=minimum ? 1 : 0,`tier ${tier}, ore ${oreId}`);
    }
  }
});
