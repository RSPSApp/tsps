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

test('the JDK lookup finds a 21, not a 17 whose patch number is 21, nor a JAVA_HOME of another version',()=>{
 const java=path.join('bin','java.exe');
 const adoptium=path.join('C:/PF','Eclipse Adoptium');
 // Folder names as Temurin installs them on this machine; 17.0.21 sorts first.
 const jdk17=path.join(adoptium,'jdk-17.0.21.9-hotspot'),jdk21=path.join(adoptium,'jdk-21.0.13.9-hotspot');
 const list=()=>['jdk-17.0.21.9-hotspot','jdk-21.0.13.9-hotspot'];
 const fs=files=>file=>file===adoptium||files.includes(file);
 const both=fs([path.join(jdk17,java),path.join(jdk21,java)]);
 const noRelease=()=>{throw new Error('ENOENT');};
 assert.equal(findJavaHome({env:{ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:both,list,read:noRelease}),jdk21);
 assert.equal(findJavaHome({env:{ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:fs([path.join(jdk17,java)]),list,read:noRelease}),null);
 // The release file wins over the folder name.
 const release=file=>file.startsWith(jdk21)?'JAVA_VERSION="21.0.13"\n':'JAVA_VERSION="17.0.21"\n';
 assert.equal(findJavaHome({env:{ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:both,list,read:release}),jdk21);
 // An explicit home is used when it is 21 or says nothing, and skipped when it is another version.
 const homes=fs([path.join('/qh',java),path.join('/j17',java),path.join(jdk21,java)]);
 const homeRelease=file=>file.startsWith('/j17')?'JAVA_VERSION="17.0.2"':(()=>{throw new Error('ENOENT');})();
 assert.equal(findJavaHome({env:{QUEST_HELPER_JAVA_HOME:'/qh',JAVA_HOME:'/j17'},platform:'win32',home:'/h',exists:homes,list,read:homeRelease}),'/qh');
 assert.equal(findJavaHome({env:{JAVA_HOME:'/j17',ProgramFiles:'C:/PF'},platform:'win32',home:'/h',exists:homes,list,read:homeRelease}),jdk21);
});

test('a cancelled server shutdown starts the bridge again for the next request',async()=>{
 const {instance,spawned}=launcher();
 await instance.start();
 instance.stop();
 assert.equal(instance.state,'stopped');
 const http=new QuestHelperHttp({launcher:instance,fetchImpl:async url=>{assert.equal(url,'http://127.0.0.1:45123/catalog');return new Response('{}');}});
 assert.deepEqual(await http.catalog(),{});
 assert.equal(spawned.length,2);assert.equal(instance.state,'ready');
 instance.stop();
});

test('a bridge the server started gets its own admin hints, not token advice',async()=>{
 const {instance}=launcher();
 await instance.start();
 const logs=[];
 const dead=new QuestHelperHttp({launcher:instance,log:line=>logs.push(line),fetchImpl:async()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});}});
 await assert.rejects(dead.catalog(),error=>error.message===PLAYER_NOT_ENABLED);
 const stolen=new QuestHelperHttp({launcher:instance,log:line=>logs.push(line),fetchImpl:async()=>new Response('{}',{status:401})});
 await assert.rejects(stolen.catalog(),error=>error.message===PLAYER_NOT_ENABLED);
 assert.match(logs[0],/the server started stopped answering/);assert.match(logs[1],/another program may hold port 45123/);
 assert.ok(logs.every(line=>!/QUEST_HELPER_TOKEN|yarn bridge`/.test(line)));
 instance.stop();
});

test('a spawn that throws marks the bridge failed instead of rejecting',async()=>{
 const logged=[];
 const instance=new QuestHelperLauncher({env:{},root:'/repo',exists:()=>true,findJava:()=>'/jdk21',freePort:async()=>45123,log:line=>logged.push(line),
  spawnImpl:()=>{throw new TypeError('bad argument');}});
 assert.equal(await instance.start(),false);
 assert.equal(instance.state,'failed');assert.match(logged[0],/could not start \(bad argument\)/);
});

