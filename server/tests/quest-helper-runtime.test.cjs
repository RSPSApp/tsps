const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QuestHelperRuntime}=require('../plugins/quests/questhelper/Runtime.QuestHelper');
const {tutorialResult}=require('../plugins/quests/questhelper/Tutorial.QuestHelper');
test('loopback bridge accepts bounded real-sized results and rejects oversized expansion',async()=>{
 const {QuestHelperHttp}=require('../plugins/quests/questhelper/Http.QuestHelper');
 const make=size=>new QuestHelperHttp({token:'x'.repeat(24),fetchImpl:async()=>new Response(JSON.stringify({value:'x'.repeat(size)}))});
 assert.equal((await make(800000).catalog()).value.length,800000);
 await assert.rejects(make(4*1024*1024).catalog(),/limit/);
});
test('helper plugin exposes the loader register contract',()=>{
 const plugin=require('../plugins/quests/QuestHelper.plugin');
 assert.equal(typeof plugin.register,'function');assert.equal(plugin.name,'OfflineQuestHelper');
});

function fixture() {
 const sent=[],calls=[],closed=[]; let pending;
 const quest={key:'cooks_assistant',name:"Cook's Assistant",varpId:29,getStage:()=>1,isStarted:()=>true,isComplete:()=>false,varpValue:s=>s};
 const player={getAttribute:k=>k==='cooks-assistant:delivered-ingredients'?5:undefined,getInventory:()=>({getItems:()=>[{getId:()=>1933,getAmount:()=>1}]}),getEquipment:()=>({getItems:()=>[]}),getLocation:()=>({getX:()=>3206,getY:()=>3213,getZ:()=>0}),getUsername:()=> 'Fixture'};
 const bridge={catalog:async()=>({sourceCommit:'pinned',quests:[{questKey:quest.key,supported:true}],diagnostics:[]}),evaluate:async request=>{calls.push(request);if(pending)return pending;return {protocol:1,session:request.session,sequence:request.sequence,questKey:request.questKey,sourceCommit:'pinned',status:'active',activeStep:null,panels:[],diagnostics:[]};},close:async session=>closed.push(session)};
 const runtime=new QuestHelperRuntime({getQuests:()=>[quest],bridge,send:(_p,d)=>sent.push(d)});
 const send=data=>runtime.receive(player,{protocol:1,session:'browser-session',...data});
 const evaluate=(sequence=1)=>send({type:'evaluate',questKey:quest.key,sequence,snapshot:{varps:{29:999},varbits:{},inventory:[],equipment:[],localPlayer:{name:'spoof',x:1,y:1,plane:0}},events:[]});
 return {runtime,player,quest,sent,calls,closed,send,evaluate,setPending:p=>pending=p};
}
test('catalog and results echo browser session but engine sessions are private',async()=>{
 const f=fixture();await f.send({type:'catalog'});assert.equal(f.sent[0].quests[0].name,"Cook's Assistant");await f.send({type:'select',questKey:f.quest.key});await f.evaluate();
 assert.notEqual(f.calls[0].session,'browser-session');assert.equal(f.sent.at(-1).session,'browser-session');
 assert.equal(f.calls[0].snapshot.varps[29],1);assert.deepEqual(f.calls[0].snapshot.inventory,[{id:1933,quantity:1,slot:0}]);assert.equal(f.calls[0].snapshot.localPlayer.x,3206);
 assert.deepEqual(f.calls[0].snapshot.dialogueHistory,["Here's a bucket of milk.","Here's a pot of flour."]);
 assert.equal(f.calls[0].snapshot.questStates.cooks_assistant,'IN_PROGRESS');
 assert.deepEqual(f.runtime.authoritative(f.player,{},'another_quest').dialogueHistory,[]);
});
test('unselected, duplicate and stale asynchronous evaluations cannot cross lifecycle',async()=>{
 const f=fixture();await f.evaluate();assert.equal(f.calls.length,0);await f.send({type:'select',questKey:f.quest.key});
 let release;f.setPending(new Promise(r=>release=r));const task=f.evaluate();await f.evaluate();assert.equal(f.calls.length,1);await f.send({type:'close'});
 release({protocol:1,status:'active'});await task;assert.equal(f.sent.filter(d=>d.type==='result').length,0);assert.equal(f.closed.length,2);
});
test('different player gets an isolated engine session; malformed/oversize inputs rejected',async()=>{
 const f=fixture();await f.send({type:'select',questKey:f.quest.key});await f.evaluate();await f.evaluate();assert.equal(f.calls.length,1);
 await f.runtime.receive({...f.player},{protocol:1,session:'browser-session',type:'select',questKey:f.quest.key});
 await f.send({type:'evaluate',questKey:f.quest.key,sequence:2,snapshot:{},events:Array(1025).fill({type:'x'})});assert.equal(f.calls.length,1);
 assert.ok(f.sent.some(d=>d.type==='error'));
});
test('Tutorial Island uses native recorded steps and exact completion boundary',()=>{
 const make=stage=>tutorialResult({session:'s',sequence:1,questKey:'learning_the_ropes'},stage);
 assert.match(make(10).activeStep.text.join(' '),/door/i);assert.ok(make(20).activeStep.targets.some(t=>t.kind==='npc'&&t.id===8503));
 assert.equal(make(670).status,'active');assert.equal(make(671).status,'complete');
});
