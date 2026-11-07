const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');

let core, quest, started = false, serial = 0, boulder, rockslide;
const players = [], npcs = [], stageEvents = new WeakMap();
const previousBots = process.env.DISABLE_PLAYER_BOTS;
function attempt(errors, fn) { try { fn(); } catch (error) { errors.push(error); } }
after(() => {
  const errors = [];
  try {
    if (core) {
      for (const p of players) {
        attempt(errors, () => { if (p.isRegistered()) PluginManager.emitPlayerLogout({ player:p, username:p.getUsername() }); });
        attempt(errors, () => core.TaskManager.cancelTasks(p));
        attempt(errors, () => core.TaskManager.cancelTasks(p.getIndex()));
        attempt(errors, () => { if (p.isRegistered()) core.World.getPlayers().remove(p); });
      }
      for (const npc of npcs) attempt(errors, () => { if (npc.isRegistered()) PluginManager.removeNpc(npc); });
    }
  } finally {
    try { attempt(errors, () => { if (started) PluginManager.emitServerShutdown({}); }); }
    finally {
      if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = previousBots;
    }
  }
  if (errors.length) throw new AggregateError(errors, 'fixture cleanup failed');
});
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2760, 3660);
  core.ObjectDefinition.init(); new NpcDefinitionLoader().load();
  started = true; PluginManager.emitServerStartup({});
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const nearby = [...MapObjects.mapObjects.values()].flat().filter(o => {
    const p=o.getLocation(); return p.getZ()===0 && Math.abs(p.getX()-2760)<35 && Math.abs(p.getY()-3660)<35;
  });
  boulder = nearby.find(o => o.getId() === core.ObjectIdentifiers.BOULDER_7);
  rockslide = nearby.find(o => o.getId() === core.ObjectIdentifiers.ROCKSLIDE_2);
  assert.ok(boulder, 'cache map contains the rope boulder');
  assert.ok(rockslide, 'cache map contains the camp rockslide');
  quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().filter(q => q.key === 'mountain_daughter').at(-1);
  assert.ok(quest, 'real Mountain Daughter registration');
  PluginManager.createApi('MountainStartStageObserver').onCustomEvent('quest:stage-changed', e => {
    if (e.key === 'mountain_daughter' && stageEvents.has(e.player)) stageEvents.get(e.player).push(e.stage);
  });
});

test('registered Mountain Daughter start after actual rope entry', async t => {
  function actor(child, level) {
    const channel={kind:'test',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const session=new PlayerSession(channel), p=new Player(session, boulder.getLocation()); session.setPlayer(p);
    p.setUsername(`mountstart${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
    assert.notEqual(p.getLongUsername(), 0n);
    child.mock.method(p, 'onAdd', () => {}); child.mock.method(p, 'onRemove', () => {});
    const owned=[];
    child.after(() => {
      const errors=[];
      attempt(errors,()=>p.getPacketSender().sendInterfaceRemoval());
      attempt(errors,()=>p.getDialogueManager().reset());
      attempt(errors,()=>{if(p.isRegistered()) PluginManager.emitPlayerLogout({player:p,username:p.getUsername()});});
      attempt(errors,()=>core.TaskManager.cancelTasks(p)); attempt(errors,()=>core.TaskManager.cancelTasks(p.getIndex()));
      for(const npc of owned) attempt(errors,()=>{if(npc.isRegistered()) PluginManager.removeNpc(npc);});
      attempt(errors,()=>{if(p.isRegistered()) core.World.getPlayers().remove(p);});
      attempt(errors,()=>assert.equal(p.isRegistered(),false));
      attempt(errors,()=>assert.equal(p.getDialogueManager().isActive(),false));
      attempt(errors,()=>assert.equal(core.MultiChatboxPrompt.getPending(p),null));
      for(const npc of owned) attempt(errors,()=>assert.equal(npc.isRegistered(),false));
      if(errors.length) throw new AggregateError(errors,'owned actor cleanup failed');
    });
    players.push(p);stageEvents.set(p,[]);assert.equal(core.World.getPlayers().add(p),true);
    assert.equal(core.World.getPlayers().get(p.getIndex()),p);p.setAttribute('bot-skip-persistence',true);
    const skills=p.getSkillManager(), agility=core.Skill.AGILITY, xp=core.SkillManager.getExperienceForLevel(level);
    skills.setMaxLevels(agility,level,false);skills.setExperience(agility,xp);skills.setCurrentLevel(agility,level,false);
    assert.equal(skills.getExperience(agility),xp);assert.equal(skills.getMaxLevel(agility),level);assert.equal(skills.getCurrentLevel(agility),level);
    assert.ok(level>=10,'fixture meets sourced initial camp entry level');
    const rope=new core.Item(core.ItemIdentifiers.ROPE,1);p.getInventory().add(rope,false);
    const item=p.getInventory().getItems().find(i=>i?.getId()===core.ItemIdentifiers.ROPE);
    assert.ok(item);const slot=p.getInventory().getItems().indexOf(item);assert.ok(slot>=0);
    assert.equal(quest.getStage(p),0);
    return {p,item,slot,owned};
  }
  function placeReachable(f, object, permitted = () => true) {
    const at=object.getLocation(), queue=f.p.getMovementQueue();
    assert.equal(typeof queue.buildObjectRouteSpec,'function');
    assert.equal(typeof queue.reachesObject,'function');
    const spec=queue.buildObjectRouteSpec(object,0);
    for(let dx=-8;dx<=8;dx++) for(let dy=-8;dy<=8;dy++) {
      const tile=new core.Location(at.getX()+dx,at.getY()+dy,at.getZ());
      if(!permitted(tile) || core.RegionManager.blocked(tile,f.p.getPrivateArea())) continue;
      f.p.setLocation(tile);
      if(queue.reachesObject(object,spec)) return tile;
    }
    assert.fail('no passable tile reaches the actual cache object');
  }
  function finishDialogue(f) {
    const manager=f.p.getDialogueManager();
    for(let i=0;i<30&&manager.isActive();i++) {
      assert.equal(core.MultiChatboxPrompt.getPending(f.p),null,'entry transcript has no pending choice');
      const current=manager.getCurrent();
      if(current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process(); else manager.advance();
    }
    assert.equal(manager.isActive(),false,'entry transcript completed');
    assert.equal(core.MultiChatboxPrompt.getPending(f.p),null);
  }
  function useRope(f) {
    placeReachable(f,boulder);
    const definition=core.ObjectDefinition.forPlayer(boulder.getId(),f.p), at=boulder.getLocation();
    assert.equal(definition.getName(),'Boulder');
    const event={player:f.p,item:f.item,itemId:f.item.getId(),slot:f.slot,object:boulder,objectId:boulder.getId(),definition,
      location:{x:at.getX(),y:at.getY(),z:at.getZ()},handled:false};
    assert.equal(PluginManager.emitItemOnObject(event),true);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[2764,3667,0]);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.ROPE),1);
    finishDialogue(f);
    core.World.process();
    assert.equal(f.p.isNeedsPlacement(),false,'real World turn completed placement');
    assert.equal(f.p.busy(),false,'player is idle before speaking to Hamal');
  }
  function talk(f) {
    const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
    const at=f.p.getLocation();let npc;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const candidate=new core.Location(at.getX()+dx,at.getY()+dy,at.getZ());
      if(core.RegionManager.blocked(candidate,f.p.getPrivateArea())) continue;
      const possible=core.NPC.create(core.NpcIdentifiers.HAMAL_THE_CHIEFTAIN,candidate);
      if(PathFinder.reachedEntity(f.p,possible)) { npc=possible; break; }
    }
    assert.ok(npc,'adjacent passable Hamal tile is reachable through the canonical entity check');
    assert.equal(core.World.getNpcs().add(npc),true);npcs.push(npc);f.owned.push(npc);
    assert.equal(core.World.getNpcs().get(npc.getIndex()),npc);
    const definition=npc.getCurrentDefinition(f.p);assert.equal(definition.getName(),'Hamal the Chieftain');
    assert.ok(definition.getActions().includes('Talk-to'));
    assert.equal(PluginManager.emitNpcInteraction({player:f.p,npc,npcId:npc.getContentId(f.p),definition,clickType:1,handled:false}),true);
  }
  function crossRockslide(f) {
    placeReachable(f,rockslide,tile=>tile.getY()<3658);
    const definition=core.ObjectDefinition.forPlayer(rockslide.getId(),f.p),at=rockslide.getLocation();
    assert.equal(definition.getName(),'Rockslide');
    const index=definition.getActions().findIndex(action=>/climb/i.test(action ?? ''));
    assert.ok(index>=0,'actual rockslide has a climb action');
    return PluginManager.emitObjectInteraction({player:f.p,object:rockslide,objectId:rockslide.getId(),definition,
      clickType:index+1,location:{x:at.getX(),y:at.getY(),z:at.getZ()},handled:false});
  }
  function choose(f,text) {
    const manager=f.p.getDialogueManager();
    for(let i=0;i<100&&!core.MultiChatboxPrompt.getPending(f.p)&&manager.isActive();i++) {
      const current=manager.getCurrent();
      if(current instanceof core.ActionDialogue && current.isSelfAdvancing()) core.World.process(); else manager.advance();
    }
    const pending=core.MultiChatboxPrompt.getPending(f.p);assert.ok(pending,`generated prompt for ${text}`);
    const index=pending.options.indexOf(text);assert.ok(index>=0,`${text} in ${JSON.stringify(pending.options)}`);
    assert.equal(PluginManager.emitInterfaceActionClick({player:f.p,groupId:219,childId:1,buttonId:(219<<16)|1,slot:index+1,action:1,handled:false}),true);
  }
  for(const level of [10,19,20]) await t.test(`Agility ${level} uses rope and accepts Hamal request`, child => {
    const f=actor(child,level);useRope(f);talk(f);
    choose(f,'Why is everyone so hostile?');choose(f,'So what are you doing up here?');choose(f,'I will search for her!');
    assert.ok(stageEvents.get(f.p).includes(10));assert.equal(quest.getStage(f.p),10);
  });
  await t.test('declining the request does not start the quest', child => {
    const f=actor(child,19);useRope(f);talk(f);
    choose(f,'Why is everyone so hostile?');choose(f,'So what are you doing up here?');choose(f,"I'm sorry to hear that.");
    assert.equal(quest.getStage(f.p),0);assert.deepEqual(stageEvents.get(f.p),[]);
  });
  await t.test('rockslide remains guarded before and traversable after starting', child => {
    const f=actor(child,20);
    placeReachable(f,rockslide,tile=>tile.getY()<3658);
    const before=[f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()];
    assert.equal(crossRockslide(f),true);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],before);
    assert.equal(quest.getStage(f.p),0);
    f.p.getPacketSender().sendInterfaceRemoval();f.p.getDialogueManager().reset();
    useRope(f);talk(f);
    choose(f,'Why is everyone so hostile?');choose(f,'So what are you doing up here?');choose(f,'I will search for her!');
    assert.equal(quest.getStage(f.p),10);
    f.p.getPacketSender().sendInterfaceRemoval();f.p.getDialogueManager().reset();
    assert.equal(crossRockslide(f),true);
    assert.deepEqual([f.p.getLocation().getX(),f.p.getLocation().getY(),f.p.getLocation().getZ()],[2761,3661,0]);
  });
});
