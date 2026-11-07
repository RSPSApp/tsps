const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');

let core, quest, started = false, serial = 0;
const players = [], npcs = [], actions = new WeakMap(), stages = new WeakMap();
const previousBots = process.env.DISABLE_PLAYER_BOTS;
function attempt(errors, fn) { try { fn(); } catch (error) { errors.push(error); } }
after(() => {
  const errors=[];
  try {
    if(core) {
      for(const p of players) {
        attempt(errors,()=>{if(p.isRegistered()) PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});});
        attempt(errors,()=>core.TaskManager.cancelTasks(p));attempt(errors,()=>core.TaskManager.cancelTasks(p.getIndex()));
        attempt(errors,()=>{if(p.isRegistered()) core.World.getPlayers().remove(p);});
      }
      for(const npc of npcs) attempt(errors,()=>{if(npc.isRegistered()) PluginManager.removeNpc(npc);});
    }
  } finally {
    try { attempt(errors,()=>{if(started) PluginManager.emitServerShutdown({});}); }
    finally { if(previousBots===undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS=previousBots; }
  }
  if(errors.length) throw new AggregateError(errors,'fixture cleanup failed');
});
before(async () => {
  process.env.DISABLE_PLAYER_BOTS='1';
  await CachePipeline.initialize(path.resolve(__dirname,'..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname,'../plugins'));
  core=PluginManager.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3149,3207);
  new NpcDefinitionLoader().load();started=true;PluginManager.emitServerStartup({});
  quest=require('../plugins/quests/QuestRuntime').getRegisteredQuests().filter(q=>q.key==='lost_city').at(-1);
  assert.ok(quest,'real Lost City quest registration');
  PluginManager.createApi('LostCityStartObservation').onCustomEvent('npc-dialogue:action',e=>{
    if(actions.has(e.player) && e.kind==='message') actions.get(e.player).push(e.stepId);
  });
  PluginManager.createApi('LostCityStageObservation').onCustomEvent('quest:stage-changed',e=>{
    if(e.key==='lost_city' && stages.has(e.player)) stages.get(e.player).push(e.stage);
  });
});
test('registered Warrior dialogue starts independently of later skill thresholds', async t => {
  function actor(child, crafting, woodcutting) {
    const channel={kind:'test',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const session=new PlayerSession(channel), p=new Player(session,new core.Location(3149,3207,0));session.setPlayer(p);
    p.setUsername(`loststart${++serial}`);p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
    assert.notEqual(p.getLongUsername(),0n);
    child.mock.method(p,'onAdd',()=>{});child.mock.method(p,'onRemove',()=>{});
    const owned=[];
    child.after(()=>{
      const errors=[];
      attempt(errors,()=>p.getPacketSender().sendInterfaceRemoval());attempt(errors,()=>p.getDialogueManager().reset());
      attempt(errors,()=>{if(p.isRegistered()) PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});});
      attempt(errors,()=>core.TaskManager.cancelTasks(p));attempt(errors,()=>core.TaskManager.cancelTasks(p.getIndex()));
      for(const npc of owned) attempt(errors,()=>{if(npc.isRegistered()) PluginManager.removeNpc(npc);});
      attempt(errors,()=>{if(p.isRegistered()) core.World.getPlayers().remove(p);});
      attempt(errors,()=>assert.equal(p.isRegistered(),false));attempt(errors,()=>assert.equal(p.getDialogueManager().isActive(),false));
      attempt(errors,()=>assert.equal(core.MultiChatboxPrompt.getPending(p),null));
      for(const npc of owned) attempt(errors,()=>assert.equal(npc.isRegistered(),false));
      if(errors.length) throw new AggregateError(errors,'owned actor cleanup failed');
    });
    players.push(p);actions.set(p,[]);stages.set(p,[]);assert.equal(core.World.getPlayers().add(p),true);
    assert.equal(core.World.getPlayers().get(p.getIndex()),p);p.setAttribute('bot-skip-persistence',true);
    for(const [skill,level] of [[core.Skill.CRAFTING,crafting],[core.Skill.WOODCUTTING,woodcutting]]) {
      const xp=core.SkillManager.getExperienceForLevel(level), sm=p.getSkillManager();
      sm.setMaxLevels(skill,level,false);sm.setExperience(skill,xp);sm.setCurrentLevel(skill,level,false);
      assert.equal(sm.getExperience(skill),xp);assert.equal(sm.getMaxLevel(skill),level);assert.equal(sm.getCurrentLevel(skill),level);
    }
    assert.ok(p.getSkillManager().getCombatLevel()<45,'warning fixture has low combat');
    assert.equal(quest.getStage(p),0);
    return {p,owned};
  }
  function talk(f) {
    const origin=new core.Location(3149,3207,0);
    const spawns=require('../data/definitions/npc-spawns.json');
    assert.ok(spawns.some(s=>s.id===1158 && s.x===3149 && s.y===3207 && s.level===0),
      'Warrior origin is an actual configured spawn');
    const npc=core.NPC.create(core.NpcIdentifiers.WARRIOR,origin);
    const candidates=[[1,0],[-1,0],[0,1],[0,-1]];
    let reachable=false;
    for(const [dx,dy] of candidates) {
      const tile=new core.Location(3149+dx,3207+dy,0);
      if(core.RegionManager.blocked(tile,f.p.getPrivateArea())) continue;
      f.p.setLocation(tile);if(PathFinder.reachedEntity(f.p,npc)) { reachable=true;break; }
    }
    assert.equal(reachable,true,'actual Warrior is reachable from passable tile');
    core.World.process();
    assert.equal(f.p.isNeedsPlacement(),false,'real World turn completed placement');
    assert.equal(f.p.busy(),false,'player is idle before talking');
    assert.equal(PathFinder.reachedEntity(f.p,npc),true,'Warrior remains reachable at dispatch');
    assert.equal(core.World.getNpcs().add(npc),true);npcs.push(npc);f.owned.push(npc);
    assert.equal(core.World.getNpcs().get(npc.getIndex()),npc);
    const definition=npc.getCurrentDefinition(f.p);
    assert.equal(npc.getContentId(f.p),1158);assert.equal(definition.getName(),'Warrior');assert.ok(definition.getActions().includes('Talk-to'));
    assert.equal(PluginManager.emitNpcInteraction({player:f.p,npc,npcId:npc.getContentId(f.p),definition,clickType:1,handled:false}),true);
  }
  function choose(f,text) {
    const manager=f.p.getDialogueManager();
    for(let i=0;i<120&&!core.MultiChatboxPrompt.getPending(f.p)&&manager.isActive();i++) {
      const current=manager.getCurrent();
      if(current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process(); else manager.advance();
    }
    const pending=core.MultiChatboxPrompt.getPending(f.p);assert.ok(pending,`generated prompt for ${text}`);
    const index=pending.options.indexOf(text);assert.ok(index>=0,`${text} in ${JSON.stringify(pending.options)}`);
    assert.equal(PluginManager.emitInterfaceActionClick({player:f.p,groupId:219,childId:1,buttonId:(219<<16)|1,slot:index+1,action:1,handled:false}),true);
  }
  function toStart(f) {
    talk(f);choose(f,'What are you camped out here for?');choose(f,"Who's Zanaris?");
    choose(f,"If it's hidden how are you planning to find it?");choose(f,"Looks like you don't know either.");
  }
  for(const [label,crafting,woodcutting] of [['low Crafting',30,36],['low Woodcutting',31,35],['both low',30,35]]) {
    await t.test(`${label} receives warning and may start`, child=>{
      const f=actor(child,crafting,woodcutting);toStart(f);
      choose(f,'Yes.');assert.ok(actions.get(f.p).includes('LrBc5e'),'actual low-skill warning emitted');
      assert.ok(stages.get(f.p).includes(1));assert.equal(quest.getStage(f.p),1);
    });
  }
  await t.test('threshold skills start without the low-skill warning', child=>{
    const f=actor(child,31,36);toStart(f);choose(f,'Yes.');
    assert.ok(!actions.get(f.p).includes('LrBc5e'));assert.ok(stages.get(f.p).includes(1));assert.equal(quest.getStage(f.p),1);
  });
  await t.test('No leaves the quest unstarted', child=>{
    const f=actor(child,30,35);toStart(f);choose(f,'No');
    assert.ok(actions.get(f.p).includes('LrBc5e'));assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
  });
});
