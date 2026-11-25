import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createSaveConflictRecovery} from '../public/save-conflicts.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require('../../../client/node_modules/jsdom');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(){
    const dom=new JSDOM('<body></body>',{url:'http://localhost:3891'}),win=dom.window;win.crypto={randomUUID};const storage=new Map();Object.defineProperty(win,'localStorage',{value:{get length(){return storage.size;},key:(i)=>[...storage.keys()][i],getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});Object.defineProperty(win,'sessionStorage',{value:{getItem:()=>null,setItem(){}}});
    win.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};win.HTMLElement.prototype.close=function(){this.removeAttribute('open');};
    const saved={project:{id:'test-project',name:'Saved version'},revision:'saved-1'},local={id:'test-project',name:'Local unsaved version'},state={project:local,mode:'paint',variant:'male',revision:'old'},requests:any[]=[],loaded:any[]=[],accepted:any[]=[],errors:any[]=[];
    const peer=`creator-${randomUUID()}`;let focused=0,failNext=false;
    win.localStorage.setItem('tsps-creator-tab:'+peer,JSON.stringify({tabId:peer,label:'Saved editor · Paint',seen:Date.now(),lastSaved:{projectId:local.id,revision:saved.revision}}));win.open=()=>({location:{href:'http://localhost:3891/'},focus(){focused++;}});
    const element=(tag:string,attrs:any={},...children:any[])=>{const node=win.document.createElement(tag);for(const [key,value] of Object.entries(attrs)){if(key==='text')node.textContent=value;else if(key==='class')node.className=value;else if(key in node)node[key]=value;else node.setAttribute(key,value);}node.append(...children);return node;};
    const ctx:any={state,document:()=>local,label:()=>local.name,element,button:(text:string,fn:any,attrs:any={})=>{const b=element('button',{text,...attrs});b.onclick=()=>Promise.resolve(fn()).catch(e=>errors.push(e));return b;},status(){},download(){},load:(r:any)=>loaded.push(r),accept:(r:any)=>accepted.push(r),request:async(route:string,data:any)=>{requests.push([route,data]);if(data){if(failNext){failNext=false;saved.revision='saved-2';throw {status:409,conflict:{projectId:local.id}};}assert.equal(data.revision,saved.revision);return {project:data.project,revision:'ours'};}return structuredClone(saved);}};
    const recovery=createSaveConflictRecovery(ctx,win),click=(label:string)=>{const b=[...win.document.querySelectorAll('button')].find((b:any)=>b.textContent===label);assert.ok(b,label);b.click();};
    return {dom,win,local,saved,loaded,accepted,requests,errors,click,recovery,get focused(){return focused;},race(){failNext=true;},open:()=>recovery.show({status:409,conflict:{projectId:local.id}},{route:'save',data:{project:local,revision:'old'}}),close(){recovery.dispose();win.close();}};
}
test('save conflict offers tab navigation and both explicit discard actions without automatic mutation',async()=>{
    const h=harness();try{await h.open();assert.match(h.win.document.body.textContent,/Discard this tab’s unsaved changes/);assert.match(h.win.document.body.textContent,/Replace saved changes with this tab’s version/);assert.equal(h.requests.filter(([,body])=>body).length,0);h.click('Go to the tab that changed it');assert.equal(h.focused,1);h.click('Discard this tab’s unsaved changes');await settle();assert.equal(h.loaded[0].project.name,'Saved version');assert.equal(h.accepted.length,0);assert.equal(h.local.name,'Local unsaved version');assert.deepEqual(h.errors,[]);}finally{h.close();}
});
test('replacing the saved version uses the reviewed revision and reopens if another tab saves again',async()=>{
    const h=harness();try{await h.open();h.race();h.click('Replace saved changes with this tab’s version');await settle();await settle();assert.equal(h.accepted.length,0);assert.ok(h.win.document.querySelector('dialog[open]'));assert.equal(h.saved.revision,'saved-2');h.click('Replace saved changes with this tab’s version');await settle();assert.equal(h.accepted[0].project.name,'Local unsaved version');assert.equal(h.requests.filter(([,body])=>body).at(-1)[1].revision,'saved-2');assert.deepEqual(h.errors,[]);}finally{h.close();}
});
