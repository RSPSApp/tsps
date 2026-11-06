const assert = require("node:assert/strict");
const path = require("node:path");
const {before,after,test} = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline} = require("../dist/game/cache/CachePipeline");
const {PluginManager: PM} = require("../dist/plugins/PluginManager");
const {Player} = require("../dist/game/entity/impl/player/Player");
const {PlayerSession} = require("../dist/net/PlayerSession");
const {ClientConnection} = require("../dist/net/NetworkBuilder");
let core,quest,western,Progress,Pets,next=700,nextBaitTile=0;
before(async()=>{
  await CachePipeline.initialize(path.resolve(__dirname,".."));
  PM.loadFromDirectory(path.resolve(__dirname,"../plugins"));core=PM.getCoreApi();
  core.RegionManager.init();core.RegionManager.loadMapFiles(2635,2966);
  PM.emitServerStartup({});
  quest=require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q=>q.key==="big_chompy_bird_hunting");
  western=require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("western");
  Progress=require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  Pets=require("../plugins/npcs/Pets.plugin");
});
after(()=>PM.emitServerShutdown({}));
function actor(t,claimed=false){
  const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername("chickqa"+next);p.setRegistered(true);
  p.setLocation(new core.Location(2634,2966,0));p.needsPlacement=false;
  const c=new ClientConnection(channel);c.player=p;const messages=[];
  t.mock.method(p.getPacketSender(),"sendMessage",m=>{messages.push(m);return p.getPacketSender();});
  quest.setStage(p,quest.completionValue);
  if(claimed)Progress.claimTier(p,western,"elite");
  const pet=core.NPC.create(core.NpcIdentifiers.HELLPUPPY,p.getLocation().clone());
  pet.setOwner(p);pet.setPet(true);core.World.getNpcs().add(pet);p.setAttribute("pets:current",pet);
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);for(const npc of [...core.World.getNpcs()])if(npc?.getOwner?.()===p)core.World.getNpcs().remove(npc);});
  return {p,c,messages};
}
const chick=()=>core.ItemIdentifiers.CHOMPY_CHICK;
const raw=()=>core.ItemIdentifiers.RAW_CHOMPY;
function award(f){PM.emitCustomEvent("npc-drops:roll",{player:f.p,drops:[{itemId:chick(),amount:1}]});}
async function hunt(t,f,win=false){
  const offset=nextBaitTile++;
  f.p.setLocation(new core.Location(2633+(offset%6),2965+Math.floor(offset/6)));
  f.p.needsPlacement=false;
  f.baitsPlaced=(f.baitsPlaced??0)+1;
  const previousBirds=new Set([...core.World.getNpcs()].filter(n=>n?.getId?.()===core.NpcIdentifiers.CHOMPY_BIRD&&n.getOwner()===f.p));
  f.p.getInventory().add(new core.Item(core.ItemIdentifiers.BLOATED_TOAD),false);
  const slot=f.p.getInventory().getItems().findIndex(i=>i.getId()===core.ItemIdentifiers.BLOATED_TOAD);
  await f.c.dispatch([{type:"inventory_action",widgetId:3214,itemId:core.ItemIdentifiers.BLOATED_TOAD,slot,option:"Drop"}]);f.c.processTurnPackets();
  t.mock.method(Math,"random",()=>0); // controlled successful lure; pet roll is set separately below
  for(let tick=0;tick<25;tick++)core.TaskManager.process();
  const npc=[...core.World.getNpcs()].find(n=>n?.getId?.()===core.NpcIdentifiers.CHOMPY_BIRD&&n.getOwner()===f.p&&!previousBirds.has(n));
  assert.ok(npc,"real quest-spawned hunted Chompy");
  const previousCorpses=new Set([...core.World.getNpcs()].filter(n=>n?.getId?.()===core.NpcIdentifiers.CHOMPY_BIRD_2&&n.getOwner()===f.p));
  t.mock.method(Math,"random",()=>win?0:0.999999);
  PM.emitNpcDeath({npc,npcId:npc.getId(),killer:f.p,location:npc.getLocation(),damagers:[f.p]});
  core.World.getNpcs().remove(npc);
  const corpse=[...core.World.getNpcs()].find(n=>n?.getId?.()===core.NpcIdentifiers.CHOMPY_BIRD_2&&n.getOwner()===f.p&&!previousCorpses.has(n));
  assert.ok(corpse,"real quest-created owned corpse");return corpse;
}
async function pluck(f,corpse){
  await f.c.dispatch([{type:"npc_option",index:corpse.getIndex(),clickType:4}]);f.c.processTurnPackets();
  for(let tick=0;tick<25;tick++){
    core.TaskManager.process();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}
function directPluck(f,corpse){PM.emitNpcInteraction({player:f.p,npc:corpse,npcId:corpse.getId(),definition:corpse.getDefinition(),clickType:4,handled:false});}
test("canonical claimed elite reward authorizes the pet; the old synthetic flag does not",t=>{
  const denied=actor(t);denied.p.setAttribute("achievement-diary:western-provinces:elite",true);award(denied);
  assert.equal(denied.p.getInventory().getAmount(chick()),0);
  const allowed=actor(t,true);award(allowed);assert.equal(allowed.p.getInventory().getAmount(chick()),1);
});
test("completed but unclaimed diary remains ineligible and malformed queries fail closed",t=>{
  const f=actor(t);
  for(const task of western.tiers.elite.tasks)Progress.completeTask(f.p,western,task.key);
  assert.equal(Progress.isTierComplete(f.p,western,"elite"),true);award(f);assert.equal(f.p.getInventory().getAmount(chick()),0);
  for(const request of [{player:f.p,diary:"missing",tier:"elite",claimed:false},{player:f.p,diary:"western",tier:"bogus",claimed:false}]){PM.emitCustomEvent("diary:is-reward-claimed",request);assert.equal(request.claimed,false);}
});
test("the existing kill roll awards once from the generated pet entry",async t=>{
  const f=actor(t,true);await hunt(t,f,true);
  assert.equal(f.p.getInventory().getAmount(chick()),1);
  assert.ok(Pets.__internals.getOwnedPetItems(f.p).includes(chick()));
});
test("a successful pluck rolls only the configured chick entry, once per corpse",async t=>{
  const f=actor(t,true),corpse=await hunt(t,f);
  const emit=PM.emitCustomEvent.bind(PM),rolls=[];
  t.mock.method(PM,"emitCustomEvent",(name,r)=>{if(name==="npc-drops:roll-table")rolls.push(r);return emit(name,r);});
  t.mock.method(Math,"random",()=>0);
  await pluck(f,corpse);
  assert.equal(f.p.getInventory().getAmount(raw()),1);
  assert.equal(f.p.getInventory().getAmount(chick()),1);
  assert.equal(rolls.length,1);
  assert.equal(rolls[0].entryFilter({item_id:chick()}),true);
  assert.equal(rolls[0].entryFilter({item_id:raw()}),false);
  directPluck(f,corpse);assert.equal(rolls.length,1);assert.equal(f.p.getInventory().getAmount(raw()),1);
});
test("a nonwinning configured pluck roll grants meat but no pet",async t=>{
  const f=actor(t,true),corpse=await hunt(t,f);await pluck(f,corpse);
  assert.equal(f.p.getInventory().getAmount(raw()),1);assert.equal(f.p.getInventory().getAmount(chick()),0);
});
test("an unclaimed player plucks normally without making a pet table roll",async t=>{
  const f=actor(t),corpse=await hunt(t,f);let rolls=0;const emit=PM.emitCustomEvent.bind(PM);
  t.mock.method(PM,"emitCustomEvent",(name,r)=>{if(name==="npc-drops:roll-table")rolls++;return emit(name,r);});
  t.mock.method(Math,"random",()=>0);await pluck(f,corpse);
  assert.equal(f.p.getInventory().getAmount(raw()),1);assert.equal(rolls,0);assert.equal(f.p.getInventory().getAmount(chick()),0);
});
test("full inventory preserves the corpse for retry; last-slot pet is insured with a follower",async t=>{
  const f=actor(t,true),corpse=await hunt(t,f),inv=f.p.getInventory();
  while(inv.getFreeSlots())inv.add(new core.Item(core.ItemIdentifiers.RAKE),false);
  t.mock.method(Math,"random",()=>0);await pluck(f,corpse);
  assert.equal(inv.getAmount(raw()),0);assert.equal(corpse.isRegistered(),true);
  inv.deleteAtSlot(27);await pluck(f,corpse);
  assert.equal(inv.getAmount(raw()),1);assert.equal(inv.getAmount(chick()),0);
  assert.ok(Pets.__internals.getOwnedPetItems(f.p).includes(chick()));
});
test("foreign, distant, different-plane, dead and unregistered plucks do not consume a corpse",async t=>{
  for(const mode of ["foreign","far","plane","dead","unregistered"]){
    const owner=actor(t,true),corpse=await hunt(t,owner),f=mode==="foreign"?actor(t,true):owner;
    if(mode==="far")f.p.setLocation(new core.Location(3200,3200));
    if(mode==="plane")f.p.setLocation(new core.Location(2634,2966,1));
    if(mode==="dead")f.p.setHitpoints(0);
    if(mode==="unregistered")f.p.setRegistered(false);
    directPluck(f,corpse);assert.equal(f.p.getInventory().getAmount(raw()),0,mode);assert.equal(corpse.isRegistered(),true,mode);
  }
});
test("kill plus pluck retains normal duplicate policy and saved ownership",async t=>{
  const f=actor(t,true),corpse=await hunt(t,f,true);await pluck(f,corpse);
  assert.equal(f.p.getInventory().getAmount(chick()),1);
  assert.ok(f.messages.some(m=>m.includes("would have been followed")));
  const {PlayerSave}=require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const saved=PlayerSave.fromPlayer(f.p),g=actor(t);saved.applyToPlayer(g.p);
  assert.ok(Pets.__internals.getOwnedPetItems(g.p).includes(chick()));
  const claimed={player:g.p,diary:"western",tier:"elite",claimed:false};PM.emitCustomEvent("diary:is-reward-claimed",claimed);assert.equal(claimed.claimed,true);
  award(g);assert.equal(g.p.getInventory().getAmount(chick()),1);
});
test("pet eligibility rejects unknown pets and malformed diary metadata",t=>{
  const f=actor(t,true),pet=Pets.__internals.PET_BY_ITEM_ID.get(chick()),original=pet.requiredDiaryReward;
  try{
    for(const bad of [null,false,"western",{diary:"unknown",tier:"elite"},{diary:"western",tier:"invalid"}]){
      pet.requiredDiaryReward=bad;const q={player:f.p,itemId:chick(),eligible:false};PM.emitCustomEvent("pets:eligible",q);assert.equal(q.eligible,false);
    }
  }finally{pet.requiredDiaryReward=original;}
  const unknown={player:f.p,itemId:core.ItemIdentifiers.RAKE,eligible:false};PM.emitCustomEvent("pets:eligible",unknown);assert.equal(unknown.eligible,false);
});
test("several kills retain every owned corpse and each can be plucked once",async t=>{
  const f=actor(t,true),a=await hunt(t,f),b=await hunt(t,f);
  assert.notEqual(a,b);t.mock.method(Math,"random",()=>0);
  await pluck(f,a);assert.equal(f.p.getInventory().getAmount(raw()),1);
  await pluck(f,b);assert.equal(f.p.getInventory().getAmount(raw()),2);
  assert.equal(f.p.getInventory().getAmount(chick()),1);
  directPluck(f,a);directPluck(f,b);assert.equal(f.p.getInventory().getAmount(raw()),2);
});
