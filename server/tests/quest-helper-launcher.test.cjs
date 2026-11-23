const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {QuestHelperLauncher}=require('../plugins/quests/questhelper/Launcher.QuestHelper');
const {QuestHelperHttp,NOT_ENABLED,PLAYER_NOT_ENABLED,PLAYER_STARTING}=require('../plugins/quests/questhelper/Http.QuestHelper');
const {findJavaHome}=require('../plugins/quests/questhelper/Java.QuestHelper');

function fakeChild(){
 const child=new EventEmitter();
 child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.killed=0;child.kill=()=>{child.killed++;setImmediate(()=>child.emit('exit',null));return true;};
 return child;
}
function launcher(options={}){
 const logged=[],spawned=[];let healthy=options.healthy??true;const child=fakeChild();
 const instance=new QuestHelperLauncher({env:options.env??{},root:'/repo',interval:1,attempts:options.attempts??20,
  exists:options.exists??(()=>true),findJava:options.findJava??(()=>'/jdk21'),freePort:async()=>45123,log:line=>logged.push(line),
  spawnImpl:(...args)=>{spawned.push(args);return child;},
  fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:45123/health');if(!healthy)throw new Error('ECONNREFUSED');return new Response(JSON.stringify({protocol:1,status:'ok'}));}});
 return {instance,logged,spawned,child,setHealthy:value=>{healthy=value;}};
}

test('the launcher leaves a configured bridge alone',async()=>{
 for(const env of [{QUEST_HELPER_TOKEN:'x'.repeat(24)},{QUEST_HELPER_URL:'http://quest-helper:16471'},{QUEST_HELPER_AUTOSTART:'0'}]){
  const {instance,spawned}=launcher({env});
  assert.equal(await instance.start(),false);assert.equal(instance.state,'external');assert.equal(spawned.length,0);assert.equal(instance.connection(),null);
 }
});

test('an unbuilt bridge logs the setup command and players get the plain message',async()=>{
 const {instance,logged,spawned}=launcher({exists:()=>false});
 await instance.start();
 assert.equal(instance.state,'not-built');assert.equal(spawned.length,0);assert.match(logged[0],/yarn bridge:setup/);
 const adminLog=[];
 const http=new QuestHelperHttp({launcher:instance,log:line=>adminLog.push(line),fetchImpl:async()=>assert.fail('nothing to ask')});
 await assert.rejects(http.catalog(),error=>error.message===PLAYER_NOT_ENABLED&&error.questHelperCode===NOT_ENABLED);
 assert.match(adminLog[0],/not built/);
});

test('no JDK 21 is reported rather than spawning',async()=>{
 const {instance,spawned,logged}=launcher({findJava:()=>null});
 await instance.start();
 assert.equal(instance.state,'no-java');assert.equal(spawned.length,0);assert.match(logged[0],/QUEST_HELPER_JAVA_HOME/);
});

test('a built bridge starts with its own token and port and the server talks to it',async()=>{
 const {instance,spawned,logged,child}=launcher();
 assert.equal(await instance.start(),true);
 assert.equal(instance.state,'ready');assert.equal(spawned.length,1);
 const [java,args,options]=spawned[0];
 assert.equal(path.basename(path.dirname(java)),'bin');assert.equal(args.at(-1),'45123');assert.equal(args.at(-2),'local.questbridge.BridgeServer');
 assert.equal(options.env.QUEST_HELPER_EXIT_WITH_PARENT,'1');assert.equal(options.env.QUEST_HELPER_PORT,'45123');
 assert.match(options.env.QUEST_HELPER_TOKEN,/^[0-9a-f]{64}$/);assert.equal(options.stdio[0],'pipe');assert.equal(options.windowsHide,true);
 child.stdout.write('QUEST_HELPER_READY http://127.0.0.1:45123\n');await new Promise(setImmediate);
 assert.ok(logged.includes('[quest-helper] QUEST_HELPER_READY http://127.0.0.1:45123'));
 let asked;
 const http=new QuestHelperHttp({launcher:instance,fetchImpl:async(url,init)=>{asked={url,auth:init.headers.Authorization};return new Response('{"quests":[]}');}});
 await http.catalog();
 assert.deepEqual(asked,{url:'http://127.0.0.1:45123/catalog',auth:`Bearer ${options.env.QUEST_HELPER_TOKEN}`});
 instance.stop();
 assert.equal(child.killed,1);assert.equal(instance.connection(),null);
 await new Promise(setImmediate);
 assert.ok(!logged.some(line=>/is off/.test(line)),'a deliberate stop is not a failure');
});

test('a player asking while the bridge boots waits for it, and is told it is starting when it is slow',async()=>{
 const {instance,setHealthy}=launcher({attempts:1000});
 setHealthy(false);instance.start();
 const http=new QuestHelperHttp({launcher:instance,startupWaitMs:20,fetchImpl:async()=>new Response('{}')});
 await assert.rejects(http.catalog(),error=>error.message===PLAYER_STARTING);
 setHealthy(true);await instance.ready;
 assert.deepEqual(await http.catalog(),{});
 instance.stop();
});

test('a bridge that dies is logged once and players get the plain message',async()=>{
 const {instance,child,logged}=launcher();
 await instance.start();
 child.emit('exit',1);
 assert.equal(instance.state,'failed');assert.equal(logged.filter(line=>/is off/.test(line)).length,1);
 const http=new QuestHelperHttp({launcher:instance,log:()=>{},fetchImpl:async()=>assert.fail('not asked')});
 await assert.rejects(http.catalog(),error=>error.questHelperCode===NOT_ENABLED);
});

test('a bridge that never answers health is killed',async()=>{
 const {instance,child,setHealthy}=launcher({attempts:3});
 setHealthy(false);
 assert.equal(await instance.start(),false);
 assert.equal(instance.state,'failed');assert.equal(child.killed,1);
});

test('an unreachable or mismatched bridge is a setup problem, not a player-facing error',async()=>{
 const logs=[];
 const refused=new QuestHelperHttp({token:'x'.repeat(24),log:line=>logs.push(line),fetchImpl:async()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});}});
 await assert.rejects(refused.catalog(),error=>error.message===PLAYER_NOT_ENABLED);
 assert.match(logs[0],/ECONNREFUSED/);
 const mismatched=new QuestHelperHttp({token:'x'.repeat(24),log:line=>logs.push(line),fetchImpl:async()=>new Response('{}',{status:401})});
 await assert.rejects(mismatched.catalog(),error=>error.message===PLAYER_NOT_ENABLED);
 assert.match(logs[1],/same for the server and the bridge/);
 const slow=new QuestHelperHttp({token:'x'.repeat(24),fetchImpl:async()=>{throw new DOMException('timed out','TimeoutError');}});
 await assert.rejects(slow.catalog(),/took too long/);
});

test('the JDK lookup prefers QUEST_HELPER_JAVA_HOME and finds an installed 21 only',()=>{
 const java=path.join('bin','java.exe');
 const adoptium=path.join('C:/PF','Eclipse Adoptium');
 const jdk21=path.join(adoptium,'jdk-21.0.12.101-hotspot'),jdk17=path.join(adoptium,'jdk-17.0.1');
 const list=()=>['jdk-17.0.1','jdk-21.0.12.101-hotspot'];
 const fs=files=>file=>file===adoptium||files.includes(file);
 assert.equal(findJavaHome({env:{QUEST_HELPER_JAVA_HOME:'/qh',JAVA_HOME:'/other'},platform:'win32',home:'/h',exists:fs([path.join('/qh',java)]),list}),'/qh');
 assert.equal(findJavaHome({env:{ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:fs([path.join(jdk17,java),path.join(jdk21,java)]),list}),jdk21);
 assert.equal(findJavaHome({env:{ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:fs([path.join(jdk17,java)]),list}),null);
});
