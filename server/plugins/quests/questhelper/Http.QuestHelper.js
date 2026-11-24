"use strict";
const {MAX_CHUNKED_PLUGIN_BYTES}=require('./Chunks.QuestHelper');

// Players see these; the setup detail goes to the server log once per cause.
const NOT_ENABLED='QUEST_HELPER_NOT_ENABLED';
const PLAYER_NOT_ENABLED="Quest Helper isn't enabled on this world. Tutorial Island and Recipe for Disaster guides still work.";
const PLAYER_STARTING='Quest Helper is still starting up on this world. Try again in a moment.';
const PLAYER_TIMEOUT='Quest Helper took too long to answer. Try again in a moment.';
const DEFAULT_HINT='set QUEST_HELPER_TOKEN for the server and `yarn bridge`, or unset it and let the server start a built bridge itself (`yarn bridge:setup`).';
const STARTUP_WAIT_MS=20000;

const playerError=(message,code)=>Object.assign(new Error(message),{questHelperCode:code});
function waitFor(promise,ms){
  let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(resolve,ms);timer.unref?.();});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

class QuestHelperHttp {
  constructor({port=Number(process.env.QUEST_HELPER_PORT || 16471),url=process.env.QUEST_HELPER_URL,token=process.env.QUEST_HELPER_TOKEN,fetchImpl=globalThis.fetch,launcher=null,log=console.warn,startupWaitMs=STARTUP_WAIT_MS}={}) {
    if (!url && (!Number.isInteger(port) || port<1024 || port>65535)) throw new Error('Invalid helper port');
    let base;
    try {
      base=new URL(url||`http://127.0.0.1:${port}`);
    } catch {
      throw new Error('Invalid Quest Helper URL');
    }
    if(!['http:','https:'].includes(base.protocol)||!base.hostname||base.username||base.password||base.search||base.hash)throw new Error('Invalid Quest Helper URL');
    this.base=base.toString().replace(/\/$/,'');this.token=token;this.fetchImpl=fetchImpl;
    this.launcher=launcher;this.log=log;this.startupWaitMs=startupWaitMs;this.logged=new Set();
  }
  /** Logs the admin detail once per cause and gives the player a plain message. */
  notEnabled(detail) {
    if(!this.logged.has(detail)){this.logged.add(detail);this.log(`[quest-helper] A player opened Quest Helper, but ${detail}`);}
    return playerError(PLAYER_NOT_ENABLED,NOT_ENABLED);
  }
  /** The bridge to ask: the one the server started, else the configured one. */
  async target() {
    const launcher=this.launcher;
    if(launcher?.state==='starting')await waitFor(launcher.ready,this.startupWaitMs);
    const own=launcher?.connection?.();
    if(own)return {base:`http://127.0.0.1:${own.port}`,token:own.token,own:true};
    // A cancelled server shutdown stopped the bridge but players are still here.
    if(launcher?.state==='stopped'){launcher.start();return this.target();}
    if(launcher?.state==='starting')throw playerError(PLAYER_STARTING,'QUEST_HELPER_STARTING');
    if(['browser-host','not-built','no-java','failed'].includes(launcher?.state))throw this.notEnabled(launcher.adminHint());
    if(typeof this.token!=='string'||this.token.length<24)throw this.notEnabled(`QUEST_HELPER_TOKEN is not set (24+ characters): ${launcher?.adminHint?.()??DEFAULT_HINT}`);
    return {base:this.base,token:this.token};
  }
  async request(route,body) {
    const {base,token,own}=await this.target();
    let response;
    try {
      response=await this.fetchImpl(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    } catch (error) {
      if(error?.name==='TimeoutError'||error?.name==='AbortError')throw playerError(PLAYER_TIMEOUT,'QUEST_HELPER_UNAVAILABLE');
      const cause=error?.cause?.code??error?.message;
      throw this.notEnabled(own
        ?`the bridge the server started stopped answering (${cause}); see the [quest-helper] lines in the server log.`
        :`the bridge at ${base} can't be reached (${cause}). Start it with \`yarn bridge\`, or ${DEFAULT_HINT}`);
    }
    if(response.status===401||response.status===403)throw this.notEnabled(own
      ?`the bridge the server started rejected its token, so another program may hold port ${new URL(base).port}; restart the server.`
      :`the bridge at ${base} rejected the server's token; QUEST_HELPER_TOKEN must be the same for the server and the bridge.`);
    if(!response.ok)throw new Error(`Quest Helper engine returned ${response.status}`);
    const reader=response.body.getReader();let bytes=0;const parts=[];
    try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_CHUNKED_PLUGIN_BYTES)throw new Error('Quest Helper result exceeds transport limit');parts.push(value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  catalog(){return this.request('/catalog');}
  evaluate(request){return this.request('/evaluate',request);}
  close(session){return this.request('/close',{session});}
}
module.exports={QuestHelperHttp,NOT_ENABLED,PLAYER_NOT_ENABLED,PLAYER_STARTING};
