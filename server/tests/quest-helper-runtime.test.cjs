const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QuestHelperRuntime}=require('../plugins/quests/questhelper/Runtime.QuestHelper');
const {tutorialResult}=require('../plugins/quests/questhelper/Tutorial.QuestHelper');
test('bridge accepts bounded real-sized results and rejects oversized expansion',async()=>{
 const {QuestHelperHttp}=require('../plugins/quests/questhelper/Http.QuestHelper');
 const make=size=>new QuestHelperHttp({token:'x'.repeat(24),fetchImpl:async()=>new Response(JSON.stringify({value:'x'.repeat(size)}))});
 assert.equal((await make(800000).catalog()).value.length,800000);
 await assert.rejects(make(4*1024*1024).catalog(),/limit/);
});
test('Quest Helper bridge accepts a configured service URL and rejects unsafe URLs',async()=>{
  const {QuestHelperHttp}=require('../plugins/quests/questhelper/Http.QuestHelper');
  let requested;
  const bridge=new QuestHelperHttp({url:'http://quest-helper:16471/',token:'x'.repeat(24),fetchImpl:async(url)=>{requested=url;return new Response('{}');}});
  await bridge.catalog();assert.equal(requested,'http://quest-helper:16471/catalog');
  const prefixed=new QuestHelperHttp({url:'https://quest-helper.internal/api/',port:0,token:'x'.repeat(24),fetchImpl:async(url)=>{requested=url;return new Response('{}');}});
  await prefixed.catalog();assert.equal(requested,'https://quest-helper.internal/api/catalog');
  for(const url of ['file:///tmp/helper','http://user:pass@quest-helper','http://quest-helper/?secret=x','http://quest-helper/#fragment','not a URL'])
    assert.throws(()=>new QuestHelperHttp({url,token:'x'.repeat(24)}),/Invalid Quest Helper URL/);
  assert.throws(()=>new QuestHelperHttp({port:0,token:'x'.repeat(24)}),/Invalid helper port/);
});
test('Quest Helper reports missing server credentials without requiring a local launcher',async()=>{
  const {QuestHelperHttp}=require('../plugins/quests/questhelper/Http.QuestHelper');
  await assert.rejects(new QuestHelperHttp({token:undefined}).catalog(),/set QUEST_HELPER_TOKEN for the server and bridge/);
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
test('native compatibility routes and projections remain read-only and keep packed vars consistent',async()=>{
 const f=fixture();f.runtime.nativeResult=request=>({...request,snapshot:undefined,events:undefined,sourceCommit:'native-fixture',status:'active',activeStep:null,panels:[],diagnostics:[]});
 f.runtime.projectState=()=>({varbits:{1850:3}});
 f.runtime.varbitDefinition=id=>id===1850?{baseVar:678,startBit:0,endBit:2}:null;
 const projected=f.runtime.authoritative(f.player,{varps:{678:20}},'cooks_assistant');
 assert.equal(projected.varbits[1850],3);assert.equal(projected.varps[678],19);
 assert.deepEqual(projected.varbitDefinitions[1850],{varp:678,lsb:0,msb:2});
 await f.send({type:'select',questKey:f.quest.key});await f.evaluate();assert.equal(f.calls.length,0);assert.equal(f.sent.at(-1).sourceCommit,'native-fixture');
});
test('helper settings and section locks are forwarded only in their bounded shapes',async()=>{
 const {helperConfig,lockSection}=require('../plugins/quests/questhelper/Runtime.QuestHelper');
 assert.deepEqual(helperConfig({solvePuzzles:false,passColour:0xff00ff00,nested:{x:1},'bad key':true,text:'x',half:1.5}),{solvePuzzles:false,passColour:0xff00ff00});
 assert.equal(helperConfig('x'),undefined);
 assert.deepEqual(lockSection({section:2,locked:true,extra:1}),{section:2,locked:true});
 assert.equal(lockSection({section:-1,locked:true}),undefined);
 const f=fixture();await f.send({type:'select',questKey:f.quest.key});
 await f.send({type:'evaluate',questKey:f.quest.key,sequence:1,snapshot:{},events:[],config:{showWorldLines:false},lockSection:{section:0,locked:false}});
 assert.deepEqual(f.calls[0].config,{showWorldLines:false});assert.deepEqual(f.calls[0].lockSection,{section:0,locked:false});
 assert.equal(f.calls[0].bankTab,undefined,'no bank tab unless asked');
 await f.send({type:'evaluate',questKey:f.quest.key,sequence:2,snapshot:{},events:[],bankTab:true});
 assert.equal(f.calls[1].bankTab,true,'the bank tab while the bank is open');
 await f.send({type:'evaluate',questKey:f.quest.key,sequence:3,snapshot:{},events:[],bankTab:'yes'});
 assert.equal(f.calls[2].bankTab,undefined,'only a boolean true');
});
