const assert = require('node:assert/strict');
const path = require('node:path');
const {test,before} = require('node:test');
const {Server}=require('../dist/Server'); Server.installProductionPathResolver();
const {CachePipeline}=require('../dist/game/cache/CachePipeline');
const {PluginManager}=require('../dist/plugins/PluginManager');
const {Player}=require('../dist/game/entity/impl/player/Player');
const {PlayerSession}=require('../dist/net/PlayerSession');
const {ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');
const {createContext}=require('../plugins/agent/mcp/Context.AgentMcp');
const travel=require('../plugins/agent/mcp/Travel.AgentMcp');
const locs=require('../plugins/world/LocTeleports.plugin');
let core; let nextIndex=1600;
before(async()=>{
 await CachePipeline.initialize(path.resolve(__dirname,'..'));
 core=PluginManager.getCoreApi(); core.RegionManager.init();
 PluginManager.createApi('TravelMultilocRefusal').onObjectInteraction((event)=>{
   if(event.objectId===12266 && event.player.getAttribute('travel-test:refuse')){
     event.player.sendMessage('This trapdoor is locked.');event.handled=true;
   }
 });
 locs.register(PluginManager.createApi('TravelMultilocNative'));
});
function setup(open=0, control={}){
 const p=new Player(new PlayerSession({kind:'test',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}}));
 p.setUsername(`multiloc${nextIndex}`).setIndex(nextIndex++);p.setRegistered(true);p.setLocation(new core.Location(3077,3492,0));
 p.getPacketSender().sendVarbit(1888,open);
 const sent=[];let handler;
 const ctx=createContext(core,{registerTool(){}});
 ctx.find=()=>p;ctx.tool=(_n,_d,_s,h)=>handler=h;
 ctx.sleepTicks=async(count)=>{for(let i=0;i<count;i++){core.World.processCycle++;core.TaskManager.process();p.getMovementQueue().process();core.TaskManager.processRemainingWalkTo();p.resetUpdating();control.afterTick?.(p);}};
 ctx.send=(player,packet)=>{sent.push(packet);assert.equal(packet.type,'object_option');new ObjectActionPacketListener().executeAction(player,packet.id,packet.x,packet.y,undefined,packet.action);};
 travel._test.setTransports({columns:['from','to','menu','id','ticks'],transports:{transports:[[[3077,3493,0],[3077,9893,0],'Open trapdoor',12267,1]]}});
 travel(ctx,{areas:{get:()=>null}});
 return {p,sent,ctx,go:(budgetTicks=35)=>handler({player:p.getUsername(),x:3077,y:9893,z:0,exact:false,run:false,budgetTicks,retryFailed:true,skipWalks:false})};
}
test('closed multiloc travel opens then goes down from the normal reachable approach',async()=>{
 const h=setup();const r=await h.go();assert.equal(r.result,'arrived');assert.equal(h.p.getLocation().getY(),9893);
 assert.deepEqual(h.sent.map(p=>p.action),['Open','Go-down']);assert.equal(h.p.getPacketSender().getVarbit(1888),1);
});
test('already-open multiloc travel uses its native descent without reopening',async()=>{
 const h=setup(1);const r=await h.go();assert.equal(r.result,'arrived');assert.deepEqual(h.sent.map(p=>p.action),['Go-down']);
});
test('native refusal leaves the closed state and never sends a followup',async()=>{
 const h=setup();h.p.setAttribute('travel-test:refuse',true);const r=await h.go();
 assert.equal(r.result,'blocked');assert.deepEqual(h.sent.map(p=>p.action),['Open']);assert.equal(h.p.getPacketSender().getVarbit(1888),0);
});
test('another real player retains a separately closed trapdoor',async()=>{
 const opened=setup(1);const closed=setup();await closed.go();
 assert.equal(opened.p.getPacketSender().getVarbit(1888),1);
 const fresh=setup();assert.equal(fresh.p.getPacketSender().getVarbit(1888),0);
});
test('budget ending after opening resumes with the current native child',async()=>{
 const h=setup();const first=await h.go(5);assert.equal(first.result,'in-progress');
 assert.deepEqual(h.sent.map(p=>p.action),['Open']);assert.equal(h.p.getPacketSender().getVarbit(1888),1);
 const second=await h.go();assert.equal(second.result,'arrived');assert.deepEqual(h.sent.map(p=>p.action),['Open','Go-down']);
});
test('logout after opening prevents the continuation',async()=>{
 const h=setup(0,{afterTick(p){if(p.getPacketSender().getVarbit(1888)===1)p.setRegistered(false);}});
 const r=await h.go();assert.equal(r.result,'blocked');assert.deepEqual(h.sent.map(p=>p.action),['Open']);
});
test('a native scene object replacement after opening prevents continuation',async()=>{
 let original,replacement;
 const h=setup(0,{afterTick(p){
  if(!replacement && p.getPacketSender().getVarbit(1888)===1){
   original=core.MapObjects.getPrivateArea(p,12266,new core.Location(3077,3493,0));
   replacement=new core.GameObject(original.getId(),original.getLocation().clone(),original.getType(),original.getFace());
   core.MapObjects.remove(original);core.MapObjects.add(replacement);
  }
 }});
 try{const r=await h.go();assert.equal(r.result,'blocked');assert.deepEqual(h.sent.map(p=>p.action),['Open']);}
 finally{if(replacement){core.MapObjects.remove(replacement);core.MapObjects.add(original);}}
});
