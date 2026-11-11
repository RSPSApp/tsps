const assert=require('node:assert/strict'),path=require('node:path');
const{before,after,test}=require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const{CachePipeline}=require('../dist/game/cache/CachePipeline'),{PluginManager:PM}=require('../dist/plugins/PluginManager');
const{Player}=require('../dist/game/entity/impl/player/Player'),{PlayerSession}=require('../dist/net/PlayerSession'),{ClientConnection}=require('../dist/net/NetworkBuilder');
const{PlayerSave}=require('../dist/game/entity/impl/player/persistence/PlayerSave');
let core,next=1900;
before(async()=>{await CachePipeline.initialize(path.resolve(__dirname,'..'));PM.loadFromDirectory(path.resolve(__dirname,'../plugins'));core=PM.getCoreApi();core.RegionManager.init();core.RegionManager.loadMapFiles(3243,3210);PM.emitServerStartup({});});
after(()=>PM.emitServerShutdown({}));
function actor(t,x=3245,y=3210){
  const channel={kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const p=new Player(new PlayerSession(channel));p.setIndex(next++);p.setUsername('stuckpet'+next);p.setRegistered(true);p.setLocation(new core.Location(x,y,0));p.needsPlacement=false;
  const c=new ClientConnection(channel);c.player=p;
  t.after(()=>{PM.emitPlayerLogout({player:p,username:p.getUsername()});p.setRegistered(false);core.TaskManager.cancelTasks(p.getIndex());for(const n of [...core.World.getNpcs()])if(n?.getOwner?.()===p)core.World.getNpcs().remove(n);});
  return{p,c};
}
async function follower(f,id=core.ItemIdentifiers.OLMLET){
  f.p.getInventory().add(new core.Item(id),true);await f.c.dispatch([{type:'inventory_action',itemId:id,slot:f.p.getInventory().getSlotForItemId(id),widgetId:149<<16,option:'Drop',optionIndex:5}]);f.c.processTurnPackets();
  for(let i=0;i<3;i++){core.TaskManager.processWalkTo(f.p.getIndex());core.TaskManager.process();}
  const n=f.p.getAttribute('pets:current');assert.ok(n?.isRegistered());n.setNeedsPlacement(false);return n;
}
function cycles(n,count){for(let i=0;i<count;i++){n.process();n.setNeedsPlacement(false);}}
const distance=(f,n)=>Math.max(Math.abs(f.p.getLocation().getX()-n.getLocation().getX()),Math.abs(f.p.getLocation().getY()-n.getLocation().getY()));
test('real NPC.process recovers a pet stranded by actual Lumbridge church geometry',async t=>{
  const f=actor(t),n=await follower(f);n.setLocation(new core.Location(3244,3217,0));
  assert.equal(core.RegionManager.canMovestart(n.getLocation(),f.p.getLocation(),1,1,null),false);
  cycles(n,30);assert.ok(distance(f,n)<=1,`still stranded at ${n.getLocation()} route=${n.getMovementQueue().hasRoute()} alternative=${n.getMovementQueue().usedAlternativeRoute()}`);
  assert.equal(f.p.getAttribute('pets:current'),n);assert.equal(n.getOwner(),f.p);assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.OLMLET),0);
});
test('adjacent pets across real collision recover although the ordinary stationary-adjacent follow branch returns early',async t=>{
  const f=actor(t),n=await follower(f);let edge;
  for(let x=3240;x<=3248&&!edge;x++)for(let y=3205;y<=3218&&!edge;y++)for(const [dx,dy]of [[1,0],[0,1]]){
    const a=new core.Location(x,y,0),b=a.clone().add(dx,dy);
    if(!core.RegionManager.blocked(a,null)&&!core.RegionManager.blocked(b,null)&&!core.RegionManager.canMovestart(a,b,1,1,null)){edge=[a,b];break;}
  }
  assert.ok(edge,'real church region must expose a static blocked edge');f.p.setLocation(edge[1]);n.setLocation(edge[0]);
  assert.equal(core.RegionManager.canMovestart(n.getLocation(),f.p.getLocation(),1,1,null),false);
  cycles(n,2);assert.ok(core.RegionManager.canMovestart(n.getLocation(),f.p.getLocation(),1,1,null),`${n.getLocation()} remains across the real blocked edge`);
});
test('real private collision with no adjacent destination falls back safely; a prohibited area cannot recall',async t=>{
  for(const prohibited of [false,true]){
    const f=actor(t),n=await follower(f),area=new class extends core.PrivateArea { allowSummonPet(){return !prohibited;} }([new core.Boundary(3238,3250,3200,3220,0)]);
    area.enter(f.p);area.enter(n);t.after(()=>area.destroy());n.setLocation(new core.Location(3244,3217,0));
    for(const tile of f.p.outterTiles())core.RegionManager.addClipping(tile.getX(),tile.getY(),tile.getZ(),0x200000,area);
    assert.equal(core.RegionManager.blocked(f.p.getLocation(),area),false);cycles(n,30);
    if(prohibited)assert.ok(distance(f,n)>1);else assert.ok(n.getLocation().equals(f.p.getLocation()));
  }
});
test('automatic recovery keeps its saved active descriptor without minting an item or replacing its identity',async t=>{
  const f=actor(t),id=core.CacheDefinitions.getObjId('xarpuspet'),n=await follower(f,id);n.setLocation(new core.Location(3244,3217,0));cycles(n,30);
  assert.equal(n.getFollowing(),f.p);assert.equal(f.p.getAttribute('pets:current'),n);PM.emitPlayerLogout({player:f.p,username:f.p.getUsername()});
  const g=actor(t);PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);PM.emitPlayerLogin({player:g.p,username:g.p.getUsername(),isNewAccount:false});
  assert.equal(g.p.getAttribute('pets:active-item'),id);assert.equal(g.p.getAttribute('pets:current').getId(),n.getId());assert.equal(g.p.getInventory().getAmount(id),0);
});
test('clear following still walks and idle adjacency does not teleport, even with occupying NPCs',async t=>{
  const f=actor(t,3222,3218),n=await follower(f);n.setLocation(new core.Location(3227,3218,0));
  const previous=n.getLocation().clone();n.process();assert.ok(n.getLocation().isWithinDistance(previous,1));assert.equal(n.isNeedsPlacement(),false);
  n.setNeedsPlacement(false);cycles(n,12);assert.equal(distance(f,n),1);const at=n.getLocation().clone();
  const blocker=core.NPC.create(core.NpcIdentifiers.MAN,at);core.World.getNpcs().add(blocker);t.after(()=>core.World.getNpcs().remove(blocker));
  cycles(n,3);assert.ok(n.getLocation().equals(at));
});
test('frozen followers, ordinary NPC followers and foreign current pointers cannot teleport through walls',async t=>{
  for(const invalidate of [(f,n)=>n.getMovementQueue().setBlockMovement(true),(f,n)=>n.setPet(false),(f,n)=>n.setOwner(actor(t).p),(f,n)=>f.p.setAttribute('pets:current',null),(f,n)=>n.setVisible(false)]){
    const f=actor(t),n=await follower(f);n.setLocation(new core.Location(3244,3217,0));const at=n.getLocation().clone();invalidate(f,n);cycles(n,15);assert.ok(distance(f,n)>1);assert.ok(!n.getLocation().equals(f.p.getLocation()));
  }
});
test('automatic recovery preserves the physical form, cat clock, leader dialogue/walk and player task',async t=>{
  for(const id of [core.CacheDefinitions.getObjId('xarpuspet'),core.CacheDefinitions.getObjId('kittenobject')]){
    const f=actor(t),n=await follower(f,id);n.setLocation(new core.Location(3244,3217,0));const state=JSON.stringify(f.p.getAttribute('pets:cat')),owned=JSON.stringify(f.p.getAttribute('pets.owned'));
    let selected=0,completed=0;const d=new core.OptionDialogue(0,{executeOption(){selected++;}},'Continue','Stop');f.p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(d));
    f.p.getMovementQueue().addSteps(new core.Location(3245,3211,0));const size=f.p.getMovementQueue().size();core.TaskManager.submit(new core.CountdownTask(f.p.getIndex(),2,()=>completed++));
    cycles(n,30);assert.ok(distance(f,n)<=1);assert.equal(f.p.getAttribute('pets:current'),n);assert.equal(f.p.getAttribute('pets:active-item'),id);assert.equal(JSON.stringify(f.p.getAttribute('pets:cat')),state);assert.equal(JSON.stringify(f.p.getAttribute('pets.owned')),owned);
    assert.equal(f.p.getDialogueManager().getCurrent(),d);assert.equal(selected,0);assert.equal(f.p.getMovementQueue().size(),size);for(let i=0;i<3;i++)core.TaskManager.process();assert.equal(completed,1);
  }
});
test('a pet stays out of an area that bars followers (canoe ride) and rejoins its owner afterwards',async t=>{
  const f=actor(t),n=await follower(f),home=n.getLocation().clone();
  const area=new class extends core.PrivateArea { allowSummonPet(){return false;} barsFollowers(){return true;} }([new core.Boundary(1792,1855,4480,4543,0)]);
  t.after(()=>area.destroy());
  area.enter(f.p);f.p.moveTo(new core.Location(1817,4515,0));cycles(n,30);
  assert.ok(n.getLocation().equals(home),`pet followed into the barred area to ${n.getLocation()}`);
  assert.notEqual(n.getArea(),area);assert.equal(n.getFollowing(),f.p);
  area.leave(f.p,false);f.p.moveTo(new core.Location(3245,3210,0));cycles(n,30);
  assert.ok(distance(f,n)<=2,`pet did not catch up after the ride: ${n.getLocation()}`);
});

// Wiki (Pet): "You can enter the raid with a pet already following you to have it follow you during the raid"
// (Chambers of Xeric), and pets "visibly follow you into The Gauntlet": refusing a dropped pet is not barring a follower.
test('a pet already following goes into an area that only refuses dropping a pet',async t=>{
  const f=actor(t),n=await follower(f);
  const area=new class extends core.PrivateArea { allowSummonPet(){return false;} }([new core.Boundary(1792,1855,4480,4543,0)]);
  t.after(()=>area.destroy());
  area.enter(f.p);f.p.moveTo(new core.Location(1817,4515,0));cycles(n,30);
  assert.ok(distance(f,n)<=2,`pet was left outside: ${n.getLocation()}`);
  assert.equal(n.getFollowing(),f.p);
});
