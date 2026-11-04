const assert=require("node:assert/strict");
const path=require("node:path");
const {before,after,test}=require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const {CachePipeline}=require("../dist/game/cache/CachePipeline");
const {PluginManager:PM}=require("../dist/plugins/PluginManager");
const {Player}=require("../dist/game/entity/impl/player/Player");
const {PlayerSession}=require("../dist/net/PlayerSession");
const {ClientConnection}=require("../dist/net/NetworkBuilder");
let core,next=800;
before(async()=>{await CachePipeline.initialize(path.resolve(__dirname,".."));PM.loadFromDirectory(path.resolve(__dirname,"../plugins"));core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(2611,3295);PM.emitServerStartup({});});
after(()=>PM.emitServerShutdown({}));
function actor(t,owned=[13247]){
  const channel={kind:"test",remoteAddress:"127.0.0.1",isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername("petreclaim"+next);p.setRegistered(true);p.setLocation(new core.Location(2611,3295,0));p.needsPlacement=false;p.setAttribute("pets.owned",owned);
  const npc=core.NPC.create(core.NpcIdentifiers.PROBITA,new core.Location(2612,3295,0));core.World.getNpcs().add(npc);
  const c=new ClientConnection(channel);c.player=p;const scripts=[],messages=[];
  const sender=p.getPacketSender(),send=sender.sendClientScript.bind(sender);
  t.mock.method(sender,"sendClientScript",(...args)=>{scripts.push(args);return send(...args);});
  t.mock.method(sender,"sendMessage",m=>{messages.push(m);return sender;});
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.World.getNpcs().remove(npc);core.TaskManager.cancelTasks(p.getIndex());});
  return {p,c,npc,scripts,messages};
}
function open(f){PM.emitCustomEvent("npc-dialogue:action",{player:f.p,npc:f.npc,npcId:core.NpcIdentifiers.PROBITA,action:"open_interface",target:"Pet Insurance"});core.TaskManager.process();core.TaskManager.process();}
async function click(f,child,slot=0,op=1){await f.c.dispatch([{type:"widget_action",widgetId:(148<<16)|child,groupId:148,childId:child,slot,buttonNum:op}]);f.c.processTurnPackets();}
const row=index=>6+5*index;
test("Probita's native Check option opens the same recovery screen",async t=>{
  const f=actor(t),tasks=[];const emit=PM.emitCustomEvent.bind(PM);t.mock.method(PM,"emitCustomEvent",(name,event)=>{if(name==="diary:task")tasks.push(event);return emit(name,event);});
  await f.c.dispatch([{type:"npc_option",index:f.npc.getIndex(),clickType:3}]);f.c.processTurnPackets();f.p.getMovementQueue().process();core.TaskManager.process();core.TaskManager.process();assert.equal(f.p.getInterfaceId(),148);assert.equal(f.p.getInventory().getAmount(13247),0);
  assert.deepEqual(tasks.map(({diary,task})=>({diary,task})),[{diary:"ardougne",task:"check-what-pets-you-have-insured-with-probita-in"}]);
});
test("the public Probita dialogue action credits only after the recovery interface opens",t=>{
  const f=actor(t),tasks=[];const emit=PM.emitCustomEvent.bind(PM);t.mock.method(PM,"emitCustomEvent",(name,event)=>{if(name==="diary:task")tasks.push(event);return emit(name,event);});
  open(f);assert.equal(f.p.getInterfaceId(),148);assert.equal(tasks.length,1);
  assert.equal(tasks[0].player,f.p);assert.equal(tasks[0].diary,"ardougne");assert.equal(tasks[0].task,"check-what-pets-you-have-insured-with-probita-in");
});
test("native Probita screen opens without reclaiming; one row and Confirm reclaim once for free",async t=>{
  const f=actor(t);open(f);assert.equal(f.p.getInterfaceId(),148);assert.equal(f.p.getInventory().getAmount(13247),0);
  assert.ok(f.scripts.some(s=>s[0]===6126&&s.length===16));
  await click(f,11,row(22));assert.equal(f.p.getInventory().getAmount(13247),0);
  await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),1);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),1);
  assert.equal(f.p.getInventory().getAmount(995),0);
});
test("unknown/forged row, unsupported operations and Confirm without selection give nothing",async t=>{
  const f=actor(t);open(f);await click(f,37);await click(f,11,row(0));await click(f,37);await click(f,11,row(22)+1);await click(f,37);await click(f,11,row(22),10);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),0);
});
test("full inventory preserves recovery; the last free slot succeeds without losing ownership",async t=>{
  const f=actor(t);while(f.p.getInventory().getFreeSlots())f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE),false);
  open(f);await click(f,11,row(22));await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),0);assert.deepEqual(f.p.getAttribute("pets.owned"),[13247]);
  f.p.getInventory().deleteAtSlot(27);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),1);
});
test("a different skilling-pet colour in the bank prevents duplicate family reclaim",async t=>{
  const f=actor(t,[20667]);f.p.getBank(0).add(new core.Item(20691),false);open(f);await click(f,11,row(31));await click(f,37);assert.equal(f.p.getInventory().getAmount(20667),0);assert.equal(f.p.getBank(0).getAmount(20691),1);
});
test("reclaim preserves the recorded rift guardian colour",async t=>{
  const f=actor(t,[20691]);open(f);await click(f,11,row(31));await click(f,37);assert.equal(f.p.getInventory().getAmount(20691),1);assert.equal(f.p.getInventory().getAmount(20667),0);
});
test("moving, closing or logging out invalidates selected recovery",async t=>{
  for(const invalidate of [f=>f.p.setLocation(new core.Location(2610,3295,0)),f=>f.p.getPacketSender().sendInterfaceRemoval(),f=>PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()})]){
    const f=actor(t);open(f);await click(f,11,row(22));invalidate(f);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),0);
  }
});
test("live family possession appearing between selection and Confirm prevents duplication",async t=>{
  const f=actor(t);open(f);await click(f,11,row(22));f.p.getInventory().add(new core.Item(13247),false);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),1);
});
test("empty and cat-only ownership opens an empty screen without creating a cat",t=>{for(const owned of [[],[1555]]){const f=actor(t,owned);open(f);assert.equal(f.p.getInterfaceId(),148);assert.equal(f.p.getInventory().getValidItems().length,0);}});
test("PIN guard prevents opening and its stale resume cannot reopen after leaving Probita",t=>{
  const f=actor(t);let resume;const tasks=[],emit=PM.emitCustomEvent.bind(PM);
  t.mock.method(PM,"emitCustomEvent",(name,r)=>{if(name==="bank-pin:guard"){r.locked=true;resume=r.resume;return;}if(name==="diary:task")tasks.push(r);return emit(name,r);});
  open(f);assert.notEqual(f.p.getInterfaceId(),148);assert.equal(typeof resume,"function");assert.equal(tasks.length,0);f.p.setLocation(new core.Location(3000,3000,0));resume();assert.notEqual(f.p.getInterfaceId(),148);assert.equal(tasks.length,0);
});
test("the real Bank PIN service locks contents and resumes after native PIN submission",async t=>{
  const f=actor(t),pin=require("../plugins/interface/bankpin/Common.BankPin");
  f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,"1234"));open(f);
  assert.notEqual(f.p.getInterfaceId(),148);assert.equal(f.scripts.some(s=>s[0]===6126),false);
  await f.c.dispatch([{type:"dialogue_amount",amount:1234}]);f.c.processTurnPackets();core.TaskManager.process();core.TaskManager.process();assert.equal(f.p.getInterfaceId(),148);
});
test("a PIN becoming active at confirmation reopens the bound recovery and awards once",async t=>{
  const f=actor(t),pin=require("../plugins/interface/bankpin/Common.BankPin");open(f);await click(f,11,row(22));
  f.p.setAttribute(pin.ATTRIBUTES.hash,pin.hash(f.p,"1234"));await click(f,37);assert.notEqual(f.p.getInterfaceId(),148);assert.equal(f.p.getInventory().getAmount(13247),0);
  await f.c.dispatch([{type:"dialogue_amount",amount:1234}]);f.c.processTurnPackets();core.TaskManager.process();core.TaskManager.process();
  assert.equal(f.p.getInterfaceId(),148);assert.equal(f.p.getInventory().getAmount(13247),1);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),1);
});
test("dead, detached, placement, other-plane and removed-Probita inputs cannot reclaim",async t=>{
  for(const invalidate of [f=>f.p.setHitpoints(0),f=>f.p.setRegistered(false),f=>{f.p.needsPlacement=true;},f=>f.p.setLocation(new core.Location(2611,3295,1)),f=>core.World.getNpcs().remove(f.npc)]){
    const f=actor(t);open(f);await click(f,11,row(22));invalidate(f);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),0);
  }
});
test("native Examine reports the pet without selecting or awarding it",async t=>{
  const f=actor(t);open(f);await click(f,11,row(22),10);assert.ok(f.messages.length);await click(f,37);assert.equal(f.p.getInventory().getAmount(13247),0);
});
test("cache masks and location packs distinguish inventory, bank and active follower",t=>{
  const f=actor(t,[13247,20659,12921]);f.p.getInventory().add(new core.Item(13247),false);f.p.getBank(0).add(new core.Item(20659),false);
  const pet=core.NPC.create(core.CacheDefinitions.getNpcId("snake_pet_green"),f.p.getLocation().clone());pet.setOwner(f.p);pet.setPet(true);core.World.getNpcs().add(pet);f.p.setAttribute("pets:current",pet);t.after(()=>core.World.getNpcs().remove(pet));
  open(f);const args=f.scripts.find(s=>s[0]===6126).slice(1);assert.equal(args.length,15);
  for(const [index,location]of [[22,2],[29,1],[15,3]]){assert.ok(args[Math.floor(index/31)]&(1<<(index%31)));assert.ok(args[3+Math.floor(index/31)]&(1<<(index%31)));assert.equal((args[6+Math.floor(index/8)]>>>((index%8)*4))&15,location);}
});
