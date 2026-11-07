// Registered GWD chamber, NPC death and diary consumers; CA progress and damage are seeded adapters.
// Run after yarn build: node --test tests/frem-gwd-private-native.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const {before, after, test} = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline} = require('../dist/game/cache/CachePipeline');
const {PluginManager: PM} = require('../dist/plugins/PluginManager');
const {Player} = require('../dist/game/entity/impl/player/Player');
const {PlayerSession} = require('../dist/net/PlayerSession');
const {ClientConnection} = require('../dist/net/NetworkBuilder');
const {SkillManager} = require('../dist/game/content/skill/SkillManager');
const {ObjectDefinition} = require('../dist/game/definition/ObjectDefinition');
const {PathFinder} = require('../dist/game/model/movement/path/PathFinder');
const {PrivateArea} = require('../dist/game/model/areas/impl/PrivateArea');
const {Boundary} = require('../dist/game/model/Boundary');
const Autosave = require('../plugins/persistence/Autosave.plugin');
const {NpcDialogue} = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const {PlayerDialogue} = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const {MAIN_PROFILE} = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const {isMembersWorld} = require('../dist/game/definition/WorldDefinition');
const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
const Progress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
const Runtime = require('../plugins/quests/QuestRuntime');
const Rules = require('../plugins/bosses/godwars/Rules.GodWars');
const Chambers = require('../plugins/bosses/godwars/Chambers.GodWars');
const Common = require('../plugins/bosses/godwars/Common.GodWars');
const {ItemOnGroundManager} = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
let core, next = 9300;
const errors=[], warnings=[], oldError=console.error, oldWarn=console.warn;
console.error=(...args)=>{errors.push(args);oldError(...args);};
console.warn=(...args)=>{if(args.some(x=>/hook.*(threw|error)/i.test(String(x)))) warnings.push(args);oldWarn(...args);};
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));
  core=PM.getCoreApi(); core.RegionManager.init(); core.RegionManager.loadMapFiles(2860,3542);
  PM.emitServerStartup({});
});
after(()=>{try{PM.emitServerShutdown({});}finally{console.error=oldError;console.warn=oldWarn;assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);}});
function actor(t){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player=new Player(new PlayerSession(channel)),name=`fremgwd${next++}`,owned=new Set(); let slot=null;
  const foreignGround=[...core.World.getItems()];
  t.after(()=>{
    const area=Chambers.instanceOf(player);
    const collect=()=>{for(const n of [...core.World.getNpcs(),...core.World.getAddNPCQueue(),...core.World.getRemoveNPCQueue()])if(n?.__godwarsChamber?.area?.player===player||n?.getOwner?.()===player)owned.add(n);};
    collect();
    try {
      try {
        if(area?.hasMember(player)) area.leave(player,false);
        else if(player.getPrivateArea()?.hasMember(player)) player.getPrivateArea().leave(player,false);
      } finally {
        // Private-chamber respawn callbacks are unkeyed; allow the normal 150-tick
        // callback and any in-flight death task to drain after the chamber closes.
        for(let i=0;i<170;i++) core.World.process();
      }
    } finally {
      try {
        collect();
        const cleanup=PM.createApi('FremGwdFixtureCleanup');
        for(const npc of owned){
          cleanup.removeNpc(npc);
          assert.ok(!npc.isRegistered());
          assert.ok(!core.World.getAddNPCQueue().includes(npc));
          assert.ok(!core.World.getRemoveNPCQueue().includes(npc));
        }
        if(area)assert.equal([...core.World.getNpcs(),...core.World.getAddNPCQueue()].some(n=>n?.getPrivateArea?.()===area),false);
      } finally {
        try {
          for(const ground of ItemOnGroundManager.ownedBy(name))ItemOnGroundManager.deregister(ground);
          ItemOnGroundManager.process();
          for(const ground of foreignGround)assert.ok(core.World.getItems().includes(ground));
        } finally {
          try{player.closeInterruptibleInterfaces();}finally{core.TaskManager.cancelTasks(player);core.TaskManager.cancelTasks(player.getIndex());if(player.isRegistered())core.World.getPlayers().remove(player);}
          assert.ok(!player.isRegistered());if(slot!==null)assert.notEqual(core.World.getPlayers().get(slot),player);
          assert.equal(Chambers.instanceOf(player),null);assert.equal(Autosave._test.dueAt.has(player),false);assert.equal(core.MultiChatboxPrompt.getPending(player),null);
          assert.ok(player.getDialogueManager().getCurrent()==null);assert.equal(core.TaskManager.hasActiveTask(player),false);assert.equal(core.TaskManager.hasActiveTask(slot),false);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
        }
      }
    }
  });
  player.setUsername(name);player.setLongUsername(core.Misc.stringToLongBigInt(name));assert.notEqual(player.getLongUsername(),0n);
  player.setAttribute('bot-skip-persistence',true);assert.equal(core.World.getPlayers().add(player),true);slot=player.getIndex();
  player.moveTo(new core.Location(2860,3542,0));player.setNeedsPlacement(false);assert.ok(player.getHitpoints()>0);assert.equal(player.busy(),false);
  const plateau=Runtime.getRegisteredQuests().findLast(q=>q.key==='death_plateau');assert.ok(plateau);assert.equal(plateau.complete(player,{scroll:false,announce:false}),true);assert.equal(plateau.isComplete(player),true);
  for(const skill of core.Skill.values()){
    player.getSkillManager().setMaxLevels(skill,99,false).setExperience(skill,SkillManager.getExperienceForLevel(99)).setCurrentLevels(skill,99,false);
  }
  const troll=Runtime.getRegisteredQuests().findLast(q=>q.key==='troll_stronghold');assert.ok(troll);troll.setStage(player,Rules.TROLL_STRONGHOLD_DAD_STAGE);assert.equal(troll.getStage(player),Rules.TROLL_STRONGHOLD_DAD_STAGE);
  assert.equal(Rules.canMoveBoulder(troll.getStage(player),player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH),player.getSkillManager().getCurrentLevel(core.Skill.AGILITY)).ok,true);assert.equal(Rules.canClimbEntrance(troll.getStage(player),true,false).ok,true);
  player.getInventory().adds(core.ItemIdentifiers.ROPE,2);
  assert.equal(isMembersWorld(),true);assert.equal(player.getProfile(),MAIN_PROFILE);
  const league=require('../plugins/modes/league/Common.LeagueMode'),sentinel=Symbol('unanswered'),q={player,league:sentinel};
  assert.equal(league.worldLeague(),null);PM.emitCustomEvent('league:profile',q);assert.equal(q.league,null);
  const connection=new ClientConnection(channel);connection.player=player;player.getSession().setPlayer(player);player.getSession().setTurnPacketProcessor(()=>connection.processTurnPackets());
  // The registered GWD login producer selects the private-door cache variant.
  PM.emitPlayerLogin({player,username:name});
  assert.equal(player.getPacketSender().getVarbit(Common.data.privateDoorVarbit),1);
  assert.equal(Autosave._test.dueAt.has(player),true);
  assert.equal(isMembersWorld(),true);assert.equal(player.getProfile(),MAIN_PROFILE);
  const post={player,league:sentinel};PM.emitCustomEvent('league:profile',post);assert.equal(post.league,null);assert.equal(league.worldLeague(),null);
  for(const skill of core.Skill.values()){assert.equal(player.getSkillManager().getMaxLevel(skill),99);assert.equal(player.getSkillManager().getCurrentLevel(skill),99);}
  assert.equal(plateau.isComplete(player),true);assert.equal(troll.getStage(player),Rules.TROLL_STRONGHOLD_DAD_STAGE);
  assert.ok(player.getHitpoints()>0);assert.equal(player.busy(),false);assert.equal(core.MultiChatboxPrompt.getPending(player),null);assert.ok(player.getDialogueManager().getCurrent()==null);
  return {player,connection,owned};
}
function tier(f,tier){const q={player:f.player,tier,claimed:false,currentThresholdMet:false};PM.emitCustomEvent('combat-achievements:tier',q);return q;}
function seedIndependentCA(f){
  // Historical CA task progress is seeded; these selected bosses do not require
  // any GWD general kill. The task catalogue and Hard threshold are active-cache data.
  const allowed=new Set(['Obor','Bryophyta','Giant Mole','King Black Dragon','Sarachnis',
    'Kalphite Queen','Scurrius','Tempoross','Wintertodt','Hespori','Kraken','Cerberus',
    'Thermonuclear Smoke Devil','Skotizo','TzTok-Jad','DK: Rex','DK: Prime','DK: Supreme',
    'Chambers of Xeric','CM: Chambers of Xeric']);
  const words=Data.TASK_VARPS.map(()=>0),selected=[];
  for(const task of Data.tasks().values()){
    if(!allowed.has(task.monster?.name) || /vengeance|demonbane|anti.?dragon shield|fremennik|diary|god wars/i.test([task.name,task.description].join(' ')))continue;
    words[task.id>>>5]|=1<<(task.id&31);selected.push({id:task.id,name:task.name,description:task.description,monster:task.monster.name,points:task.points});
  }
  selected.sort((a,b)=>a.id-b.id);
  const rows=selected.map(task=>[task.id,task.name,task.description,task.monster,task.points]);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'d5990f85eac93f87bdff46a7624f79d5da0a769e5bdbad9147cb126630b271e8','actual CA rows match reviewed rev241 selected tasks');
  const points=selected.reduce((n,task)=>n+task.points,0);
  assert.ok(points>=Data.tiers()[2].threshold,'selected non-GWD CA tasks reach actual Hard threshold');
  f.player.setAttribute('combat-achievements:completed',words);
  assert.equal(Progress.points(f.player),points);
  assert.equal(Progress.claimedTiers(f.player).size,0);
  assert.deepEqual(f.player.getAttribute('fremennik-diary:gwd-generals')??[],[]);
  assert.equal(f.player.getAttribute('achievement-diaries:tasks')?.fremennik?.includes('kill-the-generals-of-armadyl-bandos-saradomin-an')??false,false);
  return {selected,points};
}
async function resume(f,choice){const group=f.player.getPacketSender().getChatboxGroupId();const widgetId=choice==null?(group<<16)|([231,217].includes(group)?5:0):core.MultiChatboxPrompt.OPTIONS_WIDGET_ID;await f.connection.dispatch([{type:'dialogue_continue',widgetId,childIndex:choice??-1}]);f.connection.processTurnPackets();}
function normalized(dialogue){const raw=dialogue?.getText?.();return (Array.isArray(raw)?raw.join(' '):String(raw??'')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
async function claimNext(f,name){
  const here=f.player.getLocation();let spawn=null;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const candidate=new core.Location(here.getX()+dx,here.getY()+dy,here.getZ());if(![...core.World.getNpcs()].some(n=>n?.isRegistered()&&n.getLocation().equals(candidate))&&!core.RegionManager.blocked(candidate,f.player.getPrivateArea())){spawn=candidate;break;}}
  assert.ok(spawn);const npc=core.NPC.create(core.NpcIdentifiers.GHOMMAL_3,spawn);f.owned.add(npc);assert.equal(core.World.getNpcs().add(npc),true);
  const def=npc.getCurrentDefinition(f.player);assert.match(def.getName(),/Ghommal/i);
  assert.equal(PM.emitNpcInteraction({player:f.player,npc,npcId:npc.getId(),definition:def,clickType:1,handled:false}),true);
  let confirmed=false;
  for(let i=0;i<45&&!confirmed;i++){
    const menu=core.MultiChatboxPrompt.getPending(f.player);
    if(menu){assert.equal(f.player.getPacketSender().getChatboxGroupId(),219);const index=menu.options.findIndex(x=>x.startsWith("I'm here to talk about Combat Achievements")||x.startsWith("I think I've completed a combat tier"));assert.ok(index>=0);await resume(f,index+1);}
    else{const line=f.player.getDialogueManager().getCurrent();assert.ok(line);const text=normalized(line);if(text==='Yes please!'){assert.ok(line instanceof PlayerDialogue);assert.equal(f.player.getPacketSender().getChatboxGroupId(),217);confirmed=true;}else if(text==='You have come very far. You have earned these rewards.'){assert.ok(line instanceof NpcDialogue);assert.equal(line.getNpcId(),npc.getId());confirmed=true;}else await resume(f);}
  }
  assert.equal(confirmed,true);assert.equal(tier(f,name).claimed,false);await resume(f);assert.equal(tier(f,name).claimed,true);assert.equal(tier(f,name).currentThresholdMet,true);
  f.player.closeInterruptibleInterfaces();if(npc.isRegistered())core.World.getNpcs().remove(npc);
}
function reachable(player,object){const loc=object.getLocation(),def=ObjectDefinition.forPlayer(object.getId(),player),type=object.getType(),rect=[10,11,22].includes(type),footprint=type===22?def:ObjectDefinition.forId(object.getId());return def&&PathFinder.reachedObject(player,loc.getX(),loc.getY(),rect?footprint.getSizeX():1,rect?footprint.getSizeY():1,object.getFace(),rect?10:type,rect?def.getBlockingMask():0);}
async function enterBandos(f){
  const faction=Common.factionByKey('bandos'),[x,y,z]=faction.door.tile,loc=new core.Location(x,y,z);
  core.RegionManager.loadMapFiles(x,y);const door=core.World.findCacheObject(f.player,faction.door.id,loc);assert.ok(door,'active placed door');
  const def=ObjectDefinition.forPlayer(door.getId(),f.player);assert.ok(def);const action=def.getInteractions().findIndex(s=>/private/i.test(String(s)));assert.equal(action,1,'registered private second action');
  const outside=Common.toLocation(faction.door.outside);assert.equal(core.RegionManager.blocked(outside,f.player.getPrivateArea()),false);f.player.moveTo(outside);f.player.setNeedsPlacement(false);assert.ok(reachable(f.player,door));
  const I=core.ItemIdentifiers;f.player.getInventory().adds(I.COINS,Common.data.instanceCost);Common.setEssence(f.player,faction,Common.data.essence.required);
  const cash=f.player.getInventory().getAmount(I.COINS),essence=Common.getEssence(f.player,faction);
  await f.connection.dispatch([{type:'object_option',id:def.id,x,y,clickType:action+1}]);
  for(let i=0;i<20&&!Chambers.instanceOf(f.player);i++)core.World.process();
  const area=Chambers.instanceOf(f.player);assert.ok(area?.isGodWarsInstance);assert.equal(f.player.getPrivateArea(),area);assert.ok(area.hasMember(f.player));
  assert.equal(f.player.getInventory().getAmount(I.COINS),cash-Common.data.instanceCost);assert.equal(Common.getEssence(f.player,faction),essence-Common.data.essence.required);
  for(let i=0;i<10;i++)core.World.process();
  const general=[...core.World.getNpcs()].find(n=>n?.isRegistered()&&n.getId()===faction.general&&n.getPrivateArea()===area);
  assert.ok(general,'actual chamber-spawned registered general');assert.equal(general.__godwarsChamber.area,area);f.owned.add(general);
  for(const n of [...core.World.getNpcs(),...core.World.getAddNPCQueue()])if(n?.getPrivateArea?.()===area)f.owned.add(n);
  return {area,general};
}
async function death(f,npc,expectedArea=null){
  assert.ok(npc.isRegistered());assert.ok(npc.getHitpoints()>0);const combat=npc.getCombat(),amount=npc.getHitpoints();
  combat.addDamage(f.player,amount);const entries=combat.getRecentDamagerEntries();assert.equal(entries.length,1);assert.equal(entries[0].player,f.player);assert.equal(entries[0].damage,amount);assert.equal(combat.getKiller(false),f.player);
  let deathEvent=null,deathArea=null,killEvent=null,playerAtKill=null;const oldDeath=PM.emitNpcDeath,oldCustom=PM.emitCustomEvent;
  PM.emitNpcDeath=function(event){if(event.npc===npc){deathEvent=event;deathArea=npc.getPrivateArea();}return oldDeath.call(this,event);};
  PM.emitCustomEvent=function(name,event){if(name==='godwars:kill'&&event.player===f.player&&event.npcId===npc.getId()){killEvent=event;const area=f.player.getPrivateArea();playerAtKill={registered:f.player.isRegistered(),hitpoints:f.player.getHitpoints(),dying:f.player.isDyingReturn(),area,member:area?.hasMember(f.player)??false,instance:Chambers.instanceOf(f.player)};}return oldCustom.call(this,name,event);};
  try{npc.setHitpoints(0);for(let i=0;i<100&&!deathEvent;i++)core.World.process();assert.ok(deathEvent,'actual NPCDeathTask emitted registered death');assert.equal(deathEvent.killer,f.player);assert.equal(deathArea,expectedArea,'actual NPC area at death emission');assert.ok(killEvent,'registered GWD producer emitted kill');assert.equal(playerAtKill.registered,true);assert.ok(playerAtKill.hitpoints>0,'player alive at producer');assert.notEqual(playerAtKill.dying,true,'player not dying at producer');assert.equal(playerAtKill.area,expectedArea,'player area at producer');if(expectedArea)assert.equal(playerAtKill.member,true,'player remains member at producer');assert.equal(playerAtKill.instance,npc.__godwarsChamber?.area??null,'canonical chamber owner at producer');}finally{PM.emitNpcDeath=oldDeath;PM.emitCustomEvent=oldCustom;}
  return killEvent;
}
function publicGeneral(f,key){
  const faction=Common.factionByKey(key),row=require('../data/definitions/npc-spawns.json').find(x=>x.id===faction.general);assert.ok(row);
  const loc=new core.Location(row.x,row.y,row.level??0);core.RegionManager.loadMapFiles(loc.getX(),loc.getY());
  assert.equal([...core.World.getNpcs()].some(n=>n?.isRegistered()&&n.getLocation().equals(loc)),false);
  f.player.moveTo(loc.clone());f.player.setNeedsPlacement(false);const npc=core.NPC.create(row.id,loc);npc.__skipDefaultRespawn=true;assert.equal(core.World.getNpcs().add(npc),true);f.owned.add(npc);return npc;
}
test('public general deaths still complete the four-generals task',async t=>{
  const f=actor(t);
  for(const key of ['armadyl','bandos','saradomin','zamorak']){
    const npc=publicGeneral(f,key),event=await death(f,npc);assert.equal(event.faction,key);
  }
  assert.deepEqual(new Set(f.player.getAttribute('fremennik-diary:gwd-generals')),new Set(['armadyl','bandos','saradomin','zamorak']));
  assert.ok(f.player.getAttribute('achievement-diaries:tasks')?.fremennik?.includes('kill-the-generals-of-armadyl-bandos-saradomin-an'));
});

test('real paid Bandos chamber completes an unfinished four-generals task',async t=>{
  const f=actor(t),ca=seedIndependentCA(f);for(const task of ca.selected)t.diagnostic('seeded CA '+JSON.stringify(task));t.diagnostic(`seeded CA points ${ca.points}, Hard threshold ${Data.tiers()[2].threshold}`);for(const name of ['Easy','Medium','Hard'])await claimNext(f,name);assert.equal(tier(f,'Hard').claimed,true);assert.equal(tier(f,'Hard').currentThresholdMet,true);assert.equal(Progress.points(f.player),ca.points);assert.deepEqual(f.player.getAttribute('fremennik-diary:gwd-generals')??[],[]);assert.equal(f.player.getAttribute('achievement-diaries:tasks')?.fremennik?.includes('kill-the-generals-of-armadyl-bandos-saradomin-an')??false,false);
  for(const key of ['armadyl','saradomin','zamorak']){const npc=publicGeneral(f,key);const event=await death(f,npc);assert.equal(event.faction,key);}
  assert.deepEqual(new Set(f.player.getAttribute('fremennik-diary:gwd-generals')),new Set(['armadyl','saradomin','zamorak']));
  assert.equal(f.player.getAttribute('achievement-diaries:tasks')?.fremennik?.includes('kill-the-generals-of-armadyl-bandos-saradomin-an')??false,false);
  assert.equal(tier(f,'Hard').claimed,true);assert.equal(tier(f,'Hard').currentThresholdMet,true);assert.ok(Progress.points(f.player)>=ca.points);
  const {area,general}=await enterBandos(f);assert.equal(general.getPrivateArea(),area);const event=await death(f,general,area);assert.equal(event.faction,'bandos');
  assert.deepEqual(new Set(f.player.getAttribute('fremennik-diary:gwd-generals')),new Set(['armadyl','bandos','saradomin','zamorak']));
  assert.ok(f.player.getAttribute('achievement-diaries:tasks')?.fremennik?.includes('kill-the-generals-of-armadyl-bandos-saradomin-an'));
});

test('an unrelated private area does not gain general credit',async t=>{
  const f=actor(t),npc=publicGeneral(f,'bandos'),loc=npc.getLocation();
  // A real unrelated private boundary retains both actors during World processing.
  const area=new PrivateArea([new Boundary(loc.getX()-2,loc.getX()+2,loc.getY()-2,loc.getY()+2,loc.getZ())]);
  area.enter(f.player);area.enter(npc);assert.equal(f.player.getPrivateArea(),area);assert.equal(npc.getPrivateArea(),area);
  assert.ok(area.hasMember(f.player));assert.equal(Chambers.instanceOf(f.player),null);
  const event=await death(f,npc,area);assert.equal(event.faction,'bandos');
  assert.deepEqual(f.player.getAttribute('fremennik-diary:gwd-generals')??[],[]);
});
