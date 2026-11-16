// Run after yarn build: node --test tests/rag-bone-ii-start-native.test.cjs
// Decoded NPC action with seeded quest completions/rewards and nearby placement, not quest playthrough.
const assert=require('node:assert/strict');
const path=require('node:path');
const {before,after,test}=require('node:test');
process.env.DISABLE_PLAYER_BOTS='1';
require('../dist/Server').Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager:PM}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ClientConnection}=require('../dist/net/NetworkBuilder');
const {SkillManager}=require('../dist/game/content/skill/SkillManager');
const {PlayerDialogue}=require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const {MAIN_PROFILE}=require('../dist/game/entity/impl/player/persistence/PlayerProfile');
const {isMembersWorld}=require('../dist/game/definition/WorldDefinition');
const Runtime=require('../plugins/quests/QuestRuntime');
let core,next=8400;
const errors=[],warnings=[],oldError=console.error,oldWarn=console.warn,operated=new WeakMap();
console.error=(...args)=>{errors.push(args);oldError(...args);};
console.warn=(...args)=>{if(args.some(x=>/hook.*(threw|error)/i.test(String(x)))) warnings.push(args);oldWarn(...args);};
function observeOperation(event){const state=operated.get(event.player);if(state && event.npc===state.npc && event.option==='talk-to')state.count++;}
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  PM.loadFromDirectory(path.resolve(__dirname,'../plugins')); core=PM.getCoreApi();
  core.RegionManager.init();core.RegionManager.loadMapFiles(3361,3505);
  PM.createApi('RagBoneStartTest').onCustomEvent('npc:operated',observeOperation);
  PM.emitServerStartup({});
});
after(()=>{try{PM.emitServerShutdown({});}finally{console.error=oldError;console.warn=oldWarn;assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);}});
function carried(player){return player.getInventory().getItems().filter(item=>item && item.getId()>=0).map(item=>[item.getId(),item.getAmount(),JSON.stringify(item.getMeta())]);}
function quest(key){const q=Runtime.getRegisteredQuests().findLast(entry=>entry.key===key);assert.ok(q,`registered ${key}`);return q;}
function levels(player,skill,value){const sm=player.getSkillManager();sm.setMaxLevels(skill,value,false).setExperience(skill,SkillManager.getExperienceForLevel(value)).setCurrentLevels(skill,value,false);assert.equal(sm.getMaxLevel(skill),value);assert.equal(sm.getCurrentLevel(skill),value);}
function actor(t,slayer,defence,options={}){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player=new Player(new PlayerSession(channel)); const name=`ragstart${next++}`;
  let npc=null,npcSlot=null;
  t.after(()=>{
    try {try {player.closeInterruptibleInterfaces();} finally {core.TaskManager.cancelTasks(player);core.TaskManager.cancelTasks(player.getIndex());}}
    finally {try {if(npc?.isRegistered())core.World.getNpcs().remove(npc);} finally {try {if(player.isRegistered())core.World.getPlayers().remove(player);} finally {
      assert.ok(!npc?.isRegistered()); if(npcSlot!==null)assert.notEqual(core.World.getNpcs().get(npcSlot),npc);
      assert.ok(!core.World.getAddNPCQueue().includes(npc)); assert.ok(!core.World.getRemoveNPCQueue().includes(npc)); assert.ok(!player.isRegistered());assert.equal(core.TaskManager.hasActiveTask(player),false);assert.equal(core.TaskManager.hasActiveTask(player.getIndex()),false);
      assert.equal(core.MultiChatboxPrompt.getPending(player),null);assert.ok(player.getDialogueManager().getCurrent()==null);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
    }}}
  });
  player.setUsername(name);player.setLongUsername(core.Misc.stringToLongBigInt(name));assert.notEqual(player.getLongUsername(),0n);
  player.setAttribute('bot-skip-persistence',true);assert.equal(core.World.getPlayers().add(player),true);
  const placement=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]].map(([dx,dy])=>new core.Location(3361+dx,3505+dy,0)).find(tile=>!core.RegionManager.blocked(tile,player.getPrivateArea()));
  assert.ok(placement,'loaded map supplies a walkable initial tile');player.moveTo(placement);player.setNeedsPlacement(false);
  levels(player,core.Skill.SLAYER,slayer);levels(player,core.Skill.DEFENCE,defence);levels(player,core.Skill.AGILITY,35);
  assert.equal(isMembersWorld(),true);assert.equal(player.getProfile(),MAIN_PROFILE);
  const league=require('../plugins/modes/league/Common.LeagueMode'),sentinel=Symbol('unanswered'),query={player,league:sentinel};
  assert.equal(league.worldLeague(),null);PM.emitCustomEvent('league:profile',query);assert.equal(query.league,null);
  const skills=player.getSkillManager(),slayerXP=skills.getExperience(core.Skill.SLAYER),defenceXP=skills.getExperience(core.Skill.DEFENCE);
  if(options.rag!==false) assert.equal(quest('rag_and_bone_man_i').complete(player,{scroll:false,announce:false}),true);
  if(options.horror!==false) {
    assert.equal(quest('alfred-grimhands-barcrawl').complete(player,{scroll:false,announce:false}),true);
    assert.equal(quest('alfred-grimhands-barcrawl').isComplete(player),true);
    assert.equal(quest('horror_from_the_deep').complete(player,{scroll:false,announce:false}),true);
  }
  assert.equal(quest('rag_and_bone_man_i').isComplete(player),options.rag!==false);
  assert.equal(quest('horror_from_the_deep').isComplete(player),options.horror!==false);
  assert.equal(skills.getExperience(core.Skill.SLAYER),slayerXP);assert.equal(skills.getExperience(core.Skill.DEFENCE),defenceXP);
  assert.equal(skills.getMaxLevel(core.Skill.SLAYER),slayer);assert.equal(skills.getCurrentLevel(core.Skill.SLAYER),slayer);
  assert.equal(skills.getMaxLevel(core.Skill.DEFENCE),defence);assert.equal(skills.getCurrentLevel(core.Skill.DEFENCE),defence);
  assert.equal(quest('bone_voyage').getStage(player),0);
  const ii=quest('rag_and_bone_man_ii');assert.equal(ii.getStage(player),0);
  if(options.rag!==false)assert.equal(player.getPacketSender().getVarp(714),4,'shared wire value does not imply logical start');
  if(options.started)ii.setStage(player,1);
  if(options.completed)ii.setStage(player,ii.completionValue);
  const rows=require('../data/definitions/npc-spawns.json');const row=rows.find(x=>x.id===core.NpcIdentifiers.ODD_OLD_MAN && x.x===3361 && x.y===3505 && x.level===0);
  assert.ok(row,'canonical Odd Old Man spawn row');const loc=new core.Location(row.x,row.y,row.level);
  assert.equal([...core.World.getNpcs()].some(other=>other?.isRegistered() && other.getLocation().equals(loc)),false,'do not replace a pre-existing NPC');
  npc=core.NPC.create(row.id,loc);assert.equal(core.World.getNpcs().add(npc),true);assert.ok(npc.isRegistered());npcSlot=npc.getIndex();assert.equal(core.World.getNpcs().get(npcSlot),npc);
  const definition=npc.getCurrentDefinition(player);assert.match(definition.getName(),/^Odd Old Man$/i);
  const action=definition.getActions().findIndex(x=>x?.toLowerCase()==='talk-to');assert.ok(action>=0,'active NPC has Talk-to');
  let standing=null;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
    const tile=new core.Location(row.x+dx,row.y+dy,row.level);if(core.RegionManager.blocked(tile,player.getPrivateArea()))continue;
    player.moveTo(tile);player.setNeedsPlacement(false);if(core.PathFinder.reachedEntity(player,npc)){standing=tile;break;}
  }
  assert.ok(standing,'actual map has a walkable reachable adjacent tile');assert.ok(player.getHitpoints()>0);assert.equal(player.busy(),false);
  const connection=new ClientConnection(channel);connection.player=player;player.getSession().setPlayer(player);player.getSession().setTurnPacketProcessor(()=>connection.processTurnPackets());
  const observation={npc,count:0};operated.set(player,observation);t.after(()=>operated.delete(player));
  const before={slayerXP:skills.getExperience(core.Skill.SLAYER),defenceXP:skills.getExperience(core.Skill.DEFENCE),points:Number(player.getAttribute('quest.points'))||0,items:carried(player)};
  return {player,npc,action,connection,ii,observation,slayer,defence,options,before};
}
async function talk(f){
  await f.connection.dispatch([{type:'npc_option',index:f.npc.getIndex(),clickType:f.action+1}]);
  for(let i=0;i<15 && f.observation.count===0;i++)core.World.process();
  assert.equal(f.observation.count,1,'decoded Talk-to reaches a registered NPC consumer');
  assert.equal(f.player.getSkillManager().getMaxLevel(core.Skill.SLAYER),f.slayer);
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.SLAYER),f.slayer);
  assert.equal(f.player.getSkillManager().getMaxLevel(core.Skill.DEFENCE),f.defence);
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.DEFENCE),f.defence);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.SLAYER),f.before.slayerXP);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.DEFENCE),f.before.defenceXP);
  assert.equal(Number(f.player.getAttribute('quest.points'))||0,f.before.points);
  assert.deepEqual(carried(f.player),f.before.items);
}
function assertStarted(f){
  assert.equal(f.ii.getStage(f.player),1,'logical Rag II is started');
  assert.equal(f.player.getPacketSender().getVarp(714),4);
  const line=f.player.getDialogueManager().getCurrent();assert.ok(line instanceof PlayerDialogue);
  assert.equal(f.player.getPacketSender().getChatboxGroupId(),217);
  assert.equal(line.getText(),'So how is the sorting going?');
}
test('ordinary qualifying actor starts through Odd Old Man Talk-to',async t=>{const f=actor(t,40,20);await talk(f);assertStarted(f);});
test('Slayer below 40 does not prevent starting',async t=>{const f=actor(t,39,20);await talk(f);assertStarted(f);});
test('Defence below 20 does not prevent starting',async t=>{const f=actor(t,40,19);await talk(f);assertStarted(f);});
test('both skills below their later requirements do not prevent starting',async t=>{const f=actor(t,39,19);await talk(f);assertStarted(f);});
test('missing Rag I remains a start blocker',async t=>{const f=actor(t,40,20,{rag:false});await talk(f);assert.equal(f.ii.getStage(f.player),0);assert.notEqual(f.player.getDialogueManager().getCurrent()?.getText?.(),'So how is the sorting going?');});
// Wiki (Rag and Bone Man II): Horror from the Deep is not a requirement; it only opens the dagannoths for the ribs.
test('missing Horror from the Deep does not prevent starting',async t=>{const f=actor(t,40,20,{horror:false});await talk(f);assertStarted(f);});
test('already-started quest remains started with low skills and missing Horror',async t=>{const f=actor(t,39,19,{horror:false,started:true});await talk(f);assertStarted(f);});
test('completed quest remains complete with low skills and missing Horror',async t=>{const f=actor(t,39,19,{horror:false,completed:true});await talk(f);assert.equal(f.ii.getStage(f.player),f.ii.completionValue);assert.equal(f.ii.isComplete(f.player),true);});
