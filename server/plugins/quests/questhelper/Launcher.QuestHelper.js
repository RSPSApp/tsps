"use strict";
// Starts the Quest Helper bridge beside the server when nobody configured one, so a plain
// `yarn start` has a working panel once the bridge is built (`yarn bridge:setup`). The token is
// made here and lives only in this process and the child's environment.
//
// It stays out of the way when QUEST_HELPER_TOKEN or QUEST_HELPER_URL is set (`yarn bridge`, a
// container, the Play launcher) or QUEST_HELPER_AUTOSTART=0.
const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {findJavaHome,javaExecutable}=require('./Java.QuestHelper');

const ROOT=path.resolve(__dirname,'../../../..');
const INSTALL=path.join('tools','quest-helper-bridge','build','install','offline-quest-helper-bridge');
const SETUP_HINT='Run `yarn bridge:setup` once (needs JDK 21), then restart the server.';

function freeLoopbackPort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));});
  });
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class QuestHelperLauncher {
  constructor({env=process.env,root=ROOT,spawnImpl=spawn,fetchImpl=globalThis.fetch,exists=fs.existsSync,findJava=findJavaHome,freePort=freeLoopbackPort,log=console.log,attempts=120,interval=500}={}) {
    Object.assign(this,{env,root,spawnImpl,fetchImpl,exists,findJava,freePort,log,attempts,interval});
    /** off → external | not-built | no-java | starting → ready | failed; stopped after shutdown. */
    this.state='off';
    this.ready=Promise.resolve(false);
    this.killOnExit=()=>this.child?.kill();
  }
  /** True when this launcher, not an admin, owns the bridge. */
  enabled(){return !this.env.QUEST_HELPER_TOKEN&&!this.env.QUEST_HELPER_URL&&this.env.QUEST_HELPER_AUTOSTART!=='0';}
  /** What the server should tell an admin when a player can't use the helper. */
  adminHint(){
    if(this.state==='not-built')return `the bridge is not built. ${SETUP_HINT}`;
    if(this.state==='no-java')return 'no JDK 21 was found. Install one, or set QUEST_HELPER_JAVA_HOME, then restart the server.';
    if(this.state==='failed')return 'the bridge stopped; see the [quest-helper] lines in the server log, then restart the server.';
    return `set QUEST_HELPER_TOKEN for the server and \`yarn bridge\`, or unset it and let the server start the bridge itself. ${SETUP_HINT}`;
  }
  start(){
    if(this.state!=='off')return this.ready;
    if(!this.enabled()){this.state='external';return this.ready;}
    const install=path.join(this.root,INSTALL);
    if(!this.exists(path.join(install,'lib'))){
      this.state='not-built';
      this.log(`[quest-helper] The in-game Quest Helper is off: the bridge is not built. ${SETUP_HINT}`);
      return this.ready;
    }
    const javaHome=this.findJava({env:this.env});
    if(!javaHome){
      this.state='no-java';
      this.log('[quest-helper] The in-game Quest Helper is off: no JDK 21 found. Install one or set QUEST_HELPER_JAVA_HOME.');
      return this.ready;
    }
    this.state='starting';
    this.token=crypto.randomBytes(32).toString('hex');
    this.ready=this.launch(install,javaHome);
    return this.ready;
  }
  async launch(install,javaHome){
    try{this.port=await this.freePort();}catch(error){return this.fail(`could not get a free port (${error.message})`);}
    if(this.state!=='starting')return false;
    const child=this.spawnImpl(path.join(javaHome,'bin',javaExecutable()),
      ['-Djava.awt.headless=true','-XX:+EnableDynamicAgentLoading','-cp',path.join(install,'lib','*'),'local.questbridge.BridgeServer',String(this.port)],
      // stdin stays an open pipe: the bridge exits when it closes, so a killed server leaves no JVM.
      {cwd:install,windowsHide:true,stdio:['pipe','pipe','pipe'],
       env:{...this.env,JAVA_HOME:javaHome,QUEST_HELPER_TOKEN:this.token,QUEST_HELPER_PORT:String(this.port),QUEST_HELPER_EXIT_WITH_PARENT:'1'}});
    this.child=child;
    process.once('exit',this.killOnExit);
    for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>this.relay(chunk));
    // A spawn error may come without an exit event, and an exit after an error must not log twice.
    const gone=reason=>{
      if(this.child!==child)return;
      this.child=null;process.removeListener('exit',this.killOnExit);
      if(this.state==='ready'||this.state==='starting')this.fail(reason);
    };
    child.once('error',error=>gone(`could not start (${error.message})`));
    child.once('exit',code=>gone(`exited with code ${code}`));
    for(let attempt=0;attempt<this.attempts;attempt++){
      if(this.state!=='starting')return false;
      if(await this.healthy()){
        if(this.state!=='starting')return false;
        this.state='ready';
        this.log(`[quest-helper] Bridge started on 127.0.0.1:${this.port}.`);
        return true;
      }
      await pause(this.interval);
    }
    if(this.state!=='starting')return false;
    const late=this.child;this.child=null;process.removeListener('exit',this.killOnExit);late?.kill();
    return this.fail('did not answer /health in time');
  }
  async healthy(){
    try{
      const response=await this.fetchImpl(`http://127.0.0.1:${this.port}/health`,{signal:AbortSignal.timeout(1000)});
      if(!response.ok)return false;
      const health=await response.json();
      return health?.protocol===1&&health?.status==='ok';
    }catch{return false;}
  }
  relay(chunk){
    for(const line of String(chunk).split(/\r?\n/))if(line.trim())this.log(`[quest-helper] ${line}`);
  }
  fail(reason){
    if(this.state==='stopped')return false;
    this.state='failed';
    this.log(`[quest-helper] The in-game Quest Helper is off: the bridge ${reason}.`);
    return false;
  }
  /** Settings for QuestHelperHttp: the bridge this launcher started, or null to use the env. */
  connection(){return this.state==='ready'?{port:this.port,token:this.token}:null;}
  stop(){
    this.state='stopped';
    const child=this.child;this.child=null;
    process.removeListener('exit',this.killOnExit);
    child?.kill();
  }
}

module.exports={QuestHelperLauncher,freeLoopbackPort};
