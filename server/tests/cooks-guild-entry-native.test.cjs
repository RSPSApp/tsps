// Run after yarn build: node --test tests/cooks-guild-entry-native.test.cjs
// Decoded object packets and real force movement; seeded skill levels, not potion consumption.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const { MAIN_PROFILE } = require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const { isMembersWorld } = require('../dist/game/definition/WorldDefinition');
let core, next = 8100;
const errors=[], originalError=console.error;
console.error=(...args)=>{ errors.push(args); originalError(...args); };
const X=3143, Y=3443, DOOR=24958;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(X, Y);
  PM.emitServerStartup({});
});
after(() => { try { PM.emitServerShutdown({}); } finally { console.error=originalError; assert.deepEqual(errors,[],'no caught startup, runtime or shutdown errors'); } });
async function attempt(t, base, current, apron, inside=false) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); const name=`cookguild${next++}`;
  t.after(() => { try { try { p.closeInterruptibleInterfaces(); } finally { core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); } } finally { try { if(p.isRegistered()) core.World.getPlayers().remove(p); } finally { assert.ok(!p.isRegistered()); assert.ok(p.getForceMovement()==null); assert.equal(core.TaskManager.hasActiveTask(p),false); assert.equal(core.TaskManager.hasActiveTask(p.getIndex()),false); assert.equal(MultiChatboxPrompt.getPending(p),null); assert.deepEqual(errors,[]); } } });
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); assert.notEqual(p.getLongUsername(),0n);
  p.setAttribute('bot-skip-persistence',true); assert.equal(core.World.getPlayers().add(p),true); p.moveTo(new core.Location(X,inside?Y+1:Y-1,0)); p.setNeedsPlacement(false); assert.ok(p.getHitpoints()>0); assert.equal(p.busy(),false);
  assert.equal(isMembersWorld(),true); assert.equal(p.getProfile(),MAIN_PROFILE); const league=require('../plugins/modes/league/Common.LeagueMode'), sentinel=Symbol('unanswered'), query={player:p,league:sentinel}; assert.equal(league.worldLeague(),null); PM.emitCustomEvent('league:profile',query); assert.equal(query.league,null);
  const c=new ClientConnection(channel); c.player=p; p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(()=>c.processTurnPackets());
  const skills=p.getSkillManager(), skill=core.Skill.COOKING;
  skills.setMaxLevels(skill,base,false).setExperience(skill,SkillManager.getExperienceForLevel(base)).setCurrentLevels(skill,current,false);
  assert.equal(skills.getMaxLevel(skill),base); assert.equal(skills.getCurrentLevel(skill),current);
  if(apron) { const id=core.ItemIdentifiers.CHEFS_HAT; assert.match(core.ItemDefinition.forId(id).getName(),/^chef.s hat$/i); p.getEquipment().setItem(core.Equipment.HEAD_SLOT,new core.Item(id,1)); }
  assert.equal(core.CacheDefinitions.getLocId('chefdoor'),DOOR);
  const object=core.World.findCacheObject(p,DOOR,new core.Location(X,Y,0));
  assert.ok(object,'active cache has guild door at expected position');
  const def=ObjectDefinition.forPlayer(DOOR,p); assert.equal(def.getName(),'Door'); assert.equal(def.getInteractions()[0].toLowerCase(),'open');
  assert.ok(Number.isInteger(object.getFace())); const type=object.getType(), rect=type===10||type===11||type===22;
  const footprint=type===22?def:(ObjectDefinition.forId(DOOR)??def);
  const candidates=inside?[[X,Y+1]]:[[X,Y-1],[X-1,Y],[X+1,Y],[X,Y]];
  let standing=null;
  for(const [x,y] of candidates) {
    const loc=new core.Location(x,y,0);
    if(core.RegionManager.blocked(loc,p.getPrivateArea())) continue;
    p.moveTo(loc); p.setNeedsPlacement(false);
    if(PathFinder.reachedObject(p,X,Y,rect?footprint.getSizeX():1,rect?footprint.getSizeY():1,object.getFace(),rect?10:type,rect?def.getBlockingMask():0)) { standing=loc; break; }
  }
  assert.ok(standing,'active map provides a walkable reachable tile on the requested side');
  assert.equal(inside ? standing.getY()>Y : standing.getY()<=Y,true,'standing tile matches entry or exit branch');
  await c.dispatch([{type:'object_option',id:DOOR,x:X,y:Y,clickType:1}]);
  let forced=false;
  for(let i=0;i<20;i++) { core.World.process(); forced ||= !!p.getForceMovement(); }
  assert.ok(p.getForceMovement()==null,'force movement is inactive');
  assert.equal(p.getMovementQueue().isMovementBlocked(),false,'door releases movement');
  assert.equal(skills.getCurrentLevel(skill),current,'visible level preserved through route');
  return {p,forced,c};
}
function landed(f,y){const loc=f.p.getLocation();assert.deepEqual([loc.getX(),loc.getY(),loc.getZ()],[X,y,0]);}
test('ordinary qualifying player enters through registered door',async t=>{const f=await attempt(t,32,32,true);assert.ok(f.forced);landed(f,Y+1);});
test('base 31 with visible level 32 enters',async t=>{const f=await attempt(t,31,32,true);assert.ok(f.forced);landed(f,Y+1);});
test('base and current 31 remain outside',async t=>{const f=await attempt(t,31,31,true);assert.equal(f.forced,false);assert.ok(f.p.getLocation().getY()<=Y);});
test('qualifying player without hat remains outside',async t=>{const f=await attempt(t,32,32,false);assert.equal(f.forced,false);assert.ok(f.p.getLocation().getY()<=Y);});
test('previously qualified drained level still enters',async t=>{const f=await attempt(t,32,31,true);assert.ok(f.forced);landed(f,Y+1);});
test('exit remains available without qualification',async t=>{const f=await attempt(t,1,1,false,true);assert.ok(f.forced);landed(f,Y);});

// Candidate: seeded registered quest completion and direct altar event; entry uses the real
// guild door above. Upper floor and range are seeded; this does not prove a stairs route.
const diaryData = require('../plugins/achievements/diaries/Data.AchievementDiaries');
const diaryProgress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
const varrockTask = require('../plugins/achievements/diaries/VarrockDiary.AchievementDiaries')._test.TASK.summerPie;
const diary = diaryData.BY_KEY.get('varrock');
const credited = p => diaryProgress.doneTasks(p, diary).has(varrockTask);
async function bakeActor(t, atGuild = true, cooking = 99) {
  const f = await attempt(t, cooking, cooking, true);
  assert.equal(f.forced, true);
  const p = f.p, skills = p.getSkillManager();
  for (const skill of core.Skill.values()) {
    const level=skill===core.Skill.COOKING?cooking:99, xp=SkillManager.getExperienceForLevel(level);
    skills.setMaxLevels(skill,level,false).setExperience(skill,xp).setCurrentLevels(skill,level,false);
    assert.equal(skills.getMaxLevel(skill),level); assert.equal(skills.getCurrentLevel(skill),level); assert.equal(skills.getExperience(skill),xp);
  }
  p.setHitpoints(99); assert.equal(p.getHitpoints(),99);
  const quests = require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  for (const key of ['jungle_potion','fremennik_trials','lost_city','rune_mysteries','shilo_village']) { const q=quests.find(x=>x.key===key); assert.ok(q); q.setStage(p,q.completionValue); assert.equal(q.isComplete(p),true); const check={player:p,key,complete:false}; PM.emitCustomEvent('quest:is-complete',check); assert.equal(check.complete,true); }
  const quest = quests.find(q => q.key === 'lunar_diplomacy');
  assert.ok(quest); assert.equal(quest.completionValue, 190); quest.setStage(p, quest.completionValue);
  assert.equal(quest.isComplete(p), true);
  const answer = { player:p, key:'lunar_diplomacy', complete:false }; PM.emitCustomEvent('quest:is-complete', answer); assert.equal(answer.complete,true);
  const altarId = core.ObjectIdentifiers.ALTAR_57;
  const altar = { getId:()=>altarId, getDefinition:()=>core.ObjectDefinition.forId(altarId), getLocation:()=>new core.Location(2156,3864,0) };
  p.setSpellbook(core.MagicSpellbook.NORMAL);
  PM.emitObjectInteraction({player:p,object:altar,objectId:altarId,definition:altar.getDefinition(),option:'pray',clickType:1,location:altar.getLocation(),handled:false});
  assert.equal(p.getSpellbook(),core.MagicSpellbook.LUNAR,'registered quest altar switches book');
  p.moveTo(new core.Location(atGuild?3143:3200,atGuild?3450:3400,atGuild?1:0)); p.setNeedsPlacement(false);
  assert.equal(credited(p),false);
  const spell=core.CacheDefinitions.getSpellByName('Bake Pie'), req=core.CacheDefinitions.getSpellRequirements('Bake Pie');
  assert.ok(spell && req); assert.equal(core.CacheDefinitions.getSpellName(spell.widgetId,spell.itemId).toLowerCase(),'bake pie');
  const raw=core.CacheDefinitions.getObjId('uncooked_summer_pie'), cooked=core.ItemIdentifiers.SUMMER_PIE;
  assert.equal(core.ItemDefinition.forId(raw).getName().toLowerCase(),'raw summer pie');
  for (const rune of req.runes) p.getInventory().adds(rune.id,rune.amount);
  p.getInventory().adds(raw,1);
  return {p,skills,spell,req,raw,cooked,conn:f.c};
}
async function castBake(f) {
  const s=f.spell; await f.conn.dispatch([{type:'widget_action',widgetId:s.widgetId,groupId:s.widgetId>>>16,childId:s.widgetId&65535,slot:-1,buttonNum:1,itemId:s.itemId}]); f.conn.processTurnPackets();
}
test('Bake Pie credits the guild summer pie only on a successful cast',async t=>{
  const f=await bakeActor(t); const {p,skills,raw,cooked,req}=f;
  const magic=skills.getExperience(core.Skill.MAGIC), cooking=skills.getExperience(core.Skill.COOKING);
  const runes=req.runes.map(r=>[r.id,p.getInventory().getAmount(r.id),r.amount]);
  await castBake(f);
  assert.equal(p.getInventory().getAmount(raw),0); assert.equal(p.getInventory().getAmount(cooked),1);
  for(const [id,before,cost] of runes) assert.equal(p.getInventory().getAmount(id),before-cost);
  assert.equal(skills.getExperience(core.Skill.MAGIC)-magic,60*core.GameConstants.EXPERIENCE_MULTIPLIER); assert.equal(skills.getExperience(core.Skill.COOKING)-cooking,260*core.GameConstants.EXPERIENCE_MULTIPLIER);
  assert.equal(credited(p),true);
});
test('Bake Pie outside the guild produces pie but does not credit',async t=>{
  const f=await bakeActor(t,false); await castBake(f);
  assert.equal(f.p.getInventory().getAmount(f.raw),0); assert.equal(f.p.getInventory().getAmount(f.cooked),1); assert.equal(credited(f.p),false);
});
test('insufficient Cooking level cannot bake or credit',async t=>{
  const f=await bakeActor(t,true,84); const xp=f.skills.getExperience(core.Skill.COOKING), magic=f.skills.getExperience(core.Skill.MAGIC), runes=f.req.runes.map(r=>[r.id,f.p.getInventory().getAmount(r.id)]); await castBake(f);
  assert.equal(f.p.getInventory().getAmount(f.raw),1); assert.equal(f.p.getInventory().getAmount(f.cooked),0); assert.equal(f.skills.getExperience(core.Skill.COOKING),xp); assert.equal(f.skills.getExperience(core.Skill.MAGIC),magic); for(const [id,amount] of runes) assert.equal(f.p.getInventory().getAmount(id),amount); assert.equal(credited(f.p),false);
});
test('missing runes refuses without producing pie or credit',async t=>{
  const f=await bakeActor(t); const rune=f.req.runes[0]; assert.ok(rune); f.p.getInventory().deleteNumber(rune.id,rune.amount);
  const runes=f.req.runes.map(r=>[r.id,f.p.getInventory().getAmount(r.id)]), magic=f.skills.getExperience(core.Skill.MAGIC), cooking=f.skills.getExperience(core.Skill.COOKING);
  await castBake(f); assert.equal(f.p.getInventory().getAmount(f.raw),1); assert.equal(f.p.getInventory().getAmount(f.cooked),0);
  for(const [id,amount] of runes) assert.equal(f.p.getInventory().getAmount(id),amount);
  assert.equal(f.skills.getExperience(core.Skill.MAGIC),magic); assert.equal(f.skills.getExperience(core.Skill.COOKING),cooking); assert.equal(credited(f.p),false);
});
test('ordinary registered range cooking credits a successful summer pie in the guild',async t=>{
  const f=await bakeActor(t), {p,raw,cooked}=f;
  const rangeId=core.CacheDefinitions.getLocId('fai_varrock_range');
  const range=new core.GameObject(rangeId,new core.Location(3144,3450,1),10,0);
  assert.equal(range.getDefinition().getName(),'Range'); core.MapObjects.add(range);
  t.after(()=>core.MapObjects.remove(range));
  const cooking=require('../plugins/skills/Cooking.plugin'); t.after(()=>{ PM.emitPlayerDisconnect({player:p,username:p.getUsername(),source:'summer-pie-fixture'}); assert.equal(cooking.isCookingActive(p),false); });
  const recipe=cooking.COOKABLE_BY_RAW.get(raw); assert.ok(recipe); assert.deepEqual(recipe.chance.range,[1,212]); assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.COOKING),99);
  // Wiki (Summer pie): a range at level 99 still burns 43 in 256; a high roll always cooks.
  t.mock.method(Math,'random',()=>0.999);
  const {Inventory}=require('../dist/game/model/container/impl/Inventory');
  const itemSlot=p.getInventory().getItems().findIndex(i=>i?.getId()===raw), item=p.getInventory().getItems()[itemSlot];
  const location={x:range.getLocation().getX(),y:range.getLocation().getY(),z:range.getLocation().getZ()};
  const event={player:p,object:range,objectId:rangeId,itemId:raw,item,itemSlot,interfaceType:Inventory.INTERFACE_ID,location,handled:false};
  assert.ok(event.item); assert.equal(PM.emitItemOnObject(event),true);
  assert.equal(cooking.isCookingActive(p),true);
  for(let n=0;n<10;n++) core.TaskManager.process();
  assert.equal(cooking.isCookingActive(p),false);
  assert.equal(p.getInventory().getAmount(raw),0); assert.equal(p.getInventory().getAmount(cooked),1); assert.equal(credited(p),true);
});

// The bank room door (fai_varrock_cook_guild_door), a wall on the west edge of its tile: the room is east.
const BANK_DOOR_X=3144, BANK_DOOR_Y=3452;
async function bankDoor(t, {cooking=1, hardDiary=false, inside=false}={}) {
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel)); const name=`cookbank${next++}`;
  t.after(() => { core.TaskManager.cancelTasks(p); if(p.isRegistered()) core.World.getPlayers().remove(p); });
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
  p.setAttribute('bot-skip-persistence',true); assert.equal(core.World.getPlayers().add(p),true);
  p.moveTo(new core.Location(inside?BANK_DOOR_X:BANK_DOOR_X-1,BANK_DOOR_Y,0)); p.setNeedsPlacement(false);
  const c=new ClientConnection(channel); c.player=p; p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(()=>c.processTurnPackets());
  const skills=p.getSkillManager(), skill=core.Skill.COOKING;
  skills.setMaxLevels(skill,cooking,false).setExperience(skill,SkillManager.getExperienceForLevel(cooking)).setCurrentLevels(skill,cooking,false);
  if(hardDiary) for(const task of diary.tiers.hard.tasks) diaryProgress.completeTask(p,diary,task.key);
  const query={player:p,diary:'varrock',tier:'hard',complete:false}; PM.emitCustomEvent('diary:is-complete',query); assert.equal(query.complete,hardDiary);
  const id=core.CacheDefinitions.getLocId('fai_varrock_cook_guild_door');
  assert.ok(core.World.findCacheObject(p,id,new core.Location(BANK_DOOR_X,BANK_DOOR_Y,0)),'active cache has the bank room door');
  const messages=[]; const send=p.sendMessage.bind(p); p.sendMessage=(m,...rest)=>{ messages.push(String(m)); return send(m,...rest); };
  const sender=p.getPacketSender(), sound=sender.sendSound.bind(sender); let tick=0; const sounds=[];
  sender.sendSound=(id,...rest)=>{ sounds.push([id,tick]); return sound(id,...rest); };
  await c.dispatch([{type:'object_option',id,x:BANK_DOOR_X,y:BANK_DOOR_Y,clickType:1}]);
  let forced=false, stepTick=null;
  for(tick=1;tick<=20;tick++) { core.World.process(); if(p.getForceMovement()&&stepTick==null) stepTick=tick; forced ||= !!p.getForceMovement(); }
  assert.ok(p.getForceMovement()==null); assert.equal(p.getMovementQueue().isMovementBlocked(),false,'door releases movement');
  const loc=p.getLocation();
  return {p,forced,sounds,stepTick,messages:messages.filter(m=>!m.includes("music track")),at:[loc.getX(),loc.getY(),loc.getZ()]};
}
test('bank room door lets in a player with the hard Varrock Diary',async t=>{const f=await bankDoor(t,{cooking:32,hardDiary:true});assert.ok(f.forced);assert.deepEqual(f.at,[BANK_DOOR_X,BANK_DOOR_Y,0]);assert.deepEqual(f.messages,[]);});
test('bank room door lets in a player with 99 Cooking',async t=>{const f=await bankDoor(t,{cooking:99});assert.ok(f.forced);assert.deepEqual(f.at,[BANK_DOOR_X,BANK_DOOR_Y,0]);});
test('bank room door turns away a player without either',async t=>{const f=await bankDoor(t,{cooking:98});assert.equal(f.forced,false);assert.deepEqual(f.at,[BANK_DOOR_X-1,BANK_DOOR_Y,0]);assert.deepEqual(f.messages,['Only those who have completed the hard Varrock Diary or have 99 Cooking may enter.']);});
test('leaving the bank room is never stopped',async t=>{const f=await bankDoor(t,{inside:true});assert.ok(f.forced);assert.deepEqual(f.at,[BANK_DOOR_X-1,BANK_DOOR_Y,0]);});
test('bank room door plays the door sound on the step, not the click',async t=>{const f=await bankDoor(t,{cooking:99});assert.ok(f.stepTick!=null);assert.deepEqual(f.sounds,[[62,f.stepTick]]);});
test('a refused player hears no door sound',async t=>{const f=await bankDoor(t,{cooking:98});assert.deepEqual(f.sounds,[]);});
test('on a free-to-play world the bank room door turns away even a 99 Cooking player',async t=>{t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);const f=await bankDoor(t,{cooking:99,hardDiary:true});assert.equal(f.forced,false);assert.deepEqual(f.at,[BANK_DOOR_X-1,BANK_DOOR_Y,0]);assert.deepEqual(f.messages,["You need to be on a members' world to enter the bank."]);assert.deepEqual(f.sounds,[]);});
test('on a free-to-play world leaving the bank room is still allowed',async t=>{t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);const f=await bankDoor(t,{inside:true});assert.ok(f.forced);assert.deepEqual(f.at,[BANK_DOOR_X-1,BANK_DOOR_Y,0]);});
