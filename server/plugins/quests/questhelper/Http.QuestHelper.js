"use strict";
const {MAX_CHUNKED_PLUGIN_BYTES}=require('./Chunks.QuestHelper');

class QuestHelperHttp {
  constructor({port=Number(process.env.QUEST_HELPER_PORT || 16471),token=process.env.QUEST_HELPER_TOKEN,fetchImpl=globalThis.fetch}={}) {
    if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid helper port');
    this.base=`http://127.0.0.1:${port}`;this.token=token;this.fetchImpl=fetchImpl;
  }
  async request(route,body) {
    if(typeof this.token!=='string'||this.token.length<24) throw new Error('Quest Helper engine has not been started by the local launcher.');
    const response=await this.fetchImpl(this.base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Quest Helper engine returned ${response.status}`);
    const reader=response.body.getReader();let bytes=0;const parts=[];
    try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_CHUNKED_PLUGIN_BYTES)throw new Error('Quest Helper result exceeds transport limit');parts.push(value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  catalog(){return this.request('/catalog');}
  evaluate(request){return this.request('/evaluate',request);}
  close(session){return this.request('/close',{session});}
}
module.exports={QuestHelperHttp};
