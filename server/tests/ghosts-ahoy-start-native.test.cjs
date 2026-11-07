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

let core, quest, quests, started = false, serial = 0;
const players = [], npcs = [], lines = new WeakMap(), stages = new WeakMap(), actions = new WeakMap();
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
  core=PluginManager.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3678,3510);
  new NpcDefinitionLoader().load();started=true;PluginManager.emitServerStartup({});
  quests=require('../plugins/quests/QuestRuntime').getRegisteredQuests();
  quest=quests.filter(q=>q.key==='ghosts_ahoy').at(-1);assert.ok(quest,'real Ghosts Ahoy registration');
  const api=PluginManager.createApi('GhostsStartObserver');
  api.onCustomEvent('quest:stage-changed',e=>{if(e.key==='ghosts_ahoy'&&stages.has(e.player)) stages.get(e.player).push(e.stage);});
  api.onCustomEvent('npc-dialogue:line',e=>{if(lines.has(e.player)) lines.get(e.player).push(e.text);});
  api.onCustomEvent('npc-dialogue:action',e=>{if(actions.has(e.player)) actions.get(e.player).push(e.stepId);});
});
test('registered Velorina start keeps prerequisites and consent independent of later skills', async t => {
  function actor(child,{agility=25,cooking=20,missingQuest,amulet=true}={}) {
    const channel={kind:'test',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const session=new PlayerSession(channel), p=new Player(session,new core.Location(3678,3510,0));session.setPlayer(p);
    p.setUsername(`ghoststart${++serial}`);p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));assert.notEqual(p.getLongUsername(),0n);
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
    players.push(p);lines.set(p,[]);stages.set(p,[]);actions.set(p,[]);assert.equal(core.World.getPlayers().add(p),true);
    assert.equal(core.World.getPlayers().get(p.getIndex()),p);p.setAttribute('bot-skip-persistence',true);
    for(const [skill,level] of [[core.Skill.AGILITY,agility],[core.Skill.COOKING,cooking]]) {
      const xp=core.SkillManager.getExperienceForLevel(level),sm=p.getSkillManager();sm.setMaxLevels(skill,level,false);sm.setExperience(skill,xp);sm.setCurrentLevel(skill,level,false);
      assert.equal(sm.getExperience(skill),xp);assert.equal(sm.getMaxLevel(skill),level);assert.equal(sm.getCurrentLevel(skill),level);
    }
    for(const key of ['priest_in_peril','the_restless_ghost']) {
      const prerequisite=quests.filter(q=>q.key===key).at(-1);assert.ok(prerequisite,`registered ${key}`);
      prerequisite.setStage(p,key===missingQuest?0:prerequisite.completionValue);
      const request={player:p,key,complete:undefined};PluginManager.createApi('GhostsPrerequisiteCheck').emitCustomEvent('quest:is-complete',request);
      assert.equal(request.complete,key!==missingQuest,`actual prerequisite ${key}`);
    }
    if(amulet) p.getEquipment().setItem(core.Equipment.AMULET_SLOT,new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET));
    assert.equal(p.getEquipment().get(core.Equipment.AMULET_SLOT).getId()===core.ItemIdentifiers.GHOSTSPEAK_AMULET,amulet);
    const messages=[],send=p.sendMessage.bind(p);child.mock.method(p,'sendMessage',m=>{messages.push(m);return send(m);});
    assert.equal(quest.getStage(p),0);return {p,owned,messages};
  }
  function talk(f) {
    const spawn=require('../data/definitions/npc-spawns.json').find(s=>s.id===2985 && s.name==='Velorina');
    assert.ok(spawn,'actual configured Velorina spawn');
    const npc=core.NPC.create(core.NpcIdentifiers.VELORINA,new core.Location(spawn.x,spawn.y,spawn.level));
    let reachable=false;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const tile=new core.Location(spawn.x+dx,spawn.y+dy,spawn.level);
      if(core.RegionManager.blocked(tile,f.p.getPrivateArea())) continue;
      f.p.setLocation(tile);if(PathFinder.reachedEntity(f.p,npc)){reachable=true;break;}
    }
    assert.equal(reachable,true,'Velorina reached from passable tile');core.World.process();
    assert.equal(f.p.isNeedsPlacement(),false);assert.equal(f.p.busy(),false);assert.equal(PathFinder.reachedEntity(f.p,npc),true);
    assert.equal(core.World.getNpcs().add(npc),true);npcs.push(npc);f.owned.push(npc);assert.equal(core.World.getNpcs().get(npc.getIndex()),npc);
    const definition=npc.getCurrentDefinition(f.p);assert.equal(npc.getContentId(f.p),2985);assert.equal(definition.getName(),'Velorina');assert.ok(definition.getActions().includes('Talk-to'));
    assert.equal(PluginManager.emitNpcInteraction({player:f.p,npc,npcId:npc.getContentId(f.p),definition,clickType:1,handled:false}),true);
  }
  function menu(f) {
    const manager=f.p.getDialogueManager();
    for(let i=0;i<150&&!core.MultiChatboxPrompt.getPending(f.p)&&manager.isActive();i++) {
      const current=manager.getCurrent();if(current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process();else manager.advance();
    }
    const pending=core.MultiChatboxPrompt.getPending(f.p);assert.ok(pending,'actual generated menu');return pending;
  }
  function choose(f,text) {
    const pending=menu(f),index=pending.options.indexOf(text);assert.ok(index>=0,`${text} in ${JSON.stringify(pending.options)}`);
    assert.equal(PluginManager.emitInterfaceActionClick({player:f.p,groupId:219,childId:1,buttonId:(219<<16)|1,slot:index+1,action:1,handled:false}),true);
  }
  function history(f,short=false) {
    talk(f);choose(f,'Why, what is the matter?');choose(f,short?'Yes, I do. It is a very sad story.':'No - could you tell me?');
    const pending=menu(f);assert.equal(pending.title,'Start the Ghosts Ahoy quest?');assert.deepEqual(pending.options,['Yes.','No.']);
  }
  for(const [label,agility,cooking] of [['low Agility',24,20],['low Cooking',25,19],['both low',24,19]]) {
    await t.test(`${label} can accept the long route`,child=>{
      const f=actor(child,{agility,cooking});history(f);assert.equal(quest.getStage(f.p),0);
      choose(f,'Yes.');assert.ok(stages.get(f.p).includes(1));assert.equal(quest.getStage(f.p),1);
    });
  }
  await t.test('threshold levels can start',child=>{const f=actor(child);history(f);choose(f,'Yes.');assert.equal(quest.getStage(f.p),1);});
  await t.test('long No does not start',child=>{const f=actor(child,{agility:24,cooking:19});history(f);choose(f,'No.');assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);});
  for(const missingQuest of ['priest_in_peril','the_restless_ghost']) await t.test(`long Yes requires ${missingQuest}`,child=>{
    const f=actor(child,{missingQuest});history(f);choose(f,'Yes.');
    assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
    const name=missingQuest==='priest_in_peril'?'Priest in Peril':'The Restless Ghost';
    assert.ok(f.messages.includes(`You must complete ${name} to start this quest.`),'named prerequisite refusal');
    assert.ok(!lines.get(f.p).some(line=>String(line).includes('Oh, thank you!')),'accepted line was not constructed');
    assert.equal(core.MultiChatboxPrompt.getPending(f.p),null);assert.equal(f.p.getDialogueManager().isActive(),false);
  });
  await t.test('short route waits for consent and No leaves stage zero',child=>{
    const f=actor(child);history(f,true);assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
    choose(f,'No.');assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
  });
  await t.test('short Yes starts with both prerequisites',child=>{
    const f=actor(child,{agility:24,cooking:19});history(f,true);assert.equal(quest.getStage(f.p),0);
    choose(f,'Yes.');assert.ok(stages.get(f.p).includes(1));assert.equal(quest.getStage(f.p),1);
  });
  for(const missingQuest of ['priest_in_peril','the_restless_ghost']) await t.test(`short Yes still requires ${missingQuest}`,child=>{
    const f=actor(child,{missingQuest});history(f,true);assert.equal(quest.getStage(f.p),0);
    const before=f.messages.length;
    choose(f,'Yes.');assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
    const name=missingQuest==='priest_in_peril'?'Priest in Peril':'The Restless Ghost';
    assert.ok(f.messages.slice(before).includes(`You must complete ${name} to start this quest.`),'final Yes is refused');
    assert.ok(!lines.get(f.p).some(line=>String(line).includes('Oh, thank you!')),'accepted line was not constructed');
    assert.equal(core.MultiChatboxPrompt.getPending(f.p),null);assert.equal(f.p.getDialogueManager().isActive(),false);
  });
  await t.test('without ghostspeak the start menu is unavailable',child=>{
    const f=actor(child,{amulet:false});talk(f);const manager=f.p.getDialogueManager();
    for(let i=0;i<30&&manager.isActive();i++) manager.advance();
    assert.ok(actions.get(f.p).includes('26f6qH'));assert.equal(core.MultiChatboxPrompt.getPending(f.p),null);assert.equal(manager.isActive(),false);
    assert.equal(quest.getStage(f.p),0);assert.deepEqual(stages.get(f.p),[]);
  });
  for(const level of [19,20]) await t.test(`nettle-water cooking retains its current-level ${level} boundary`,child=>{
    const f=actor(child,{cooking:level});quest.setStage(f.p,4);
    const item=new core.Item(core.ItemIdentifiers.NETTLE_WATER,1);f.p.getInventory().add(item,false);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.NETTLE_WATER),1);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.NETTLE_TEA),0);
    const held=f.p.getInventory().getItems().find(i=>i?.getId()===core.ItemIdentifiers.NETTLE_WATER);
    assert.ok(held);const slot=f.p.getInventory().getItems().indexOf(held);assert.ok(slot>=0);
    const at=f.p.getLocation(),object=new core.GameObject(core.ObjectIdentifiers.COOKING_RANGE,at,10,0,null);
    const definition=object.getDefinition();assert.ok(definition);
    assert.ok(['Cooking range','Range','Fire'].includes(definition.getName()) || (definition.getInteractions()??[]).includes('Cook'));
    const before=f.p.getSkillManager().getExperience(core.Skill.COOKING);
    assert.equal(PluginManager.emitItemOnObject({player:f.p,item:held,itemId:held.getId(),slot,object,objectId:object.getId(),definition,
      location:{x:at.getX(),y:at.getY(),z:at.getZ()},handled:false}),true);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.NETTLE_WATER),level<20?1:0);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.NETTLE_TEA),level<20?0:1);
    assert.equal(f.p.getSkillManager().getExperience(core.Skill.COOKING),before+(level<20?0:52));
    if(level<20) assert.ok(f.messages.includes('You need a Cooking level of at least 20 to cook this.'));
    assert.equal(quest.getStage(f.p),4);
  });
});
