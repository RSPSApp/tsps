import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {makePart} from '../shared/project.mjs';
import {newGearVisuals} from '../shared/gear-visuals.mjs';
import {worldPoint,reflectPoint} from '../shared/mesh.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(root,'client/package.json')),{JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(root,'tools/content-builders/public/gear-visuals.mjs'),'utf8').replace(/'\/shared\/([^']+)'/g,(_,file)=>JSON.stringify(pathToFileURL(path.join(root,'tools/content-builders/shared',file)).href));
const module=import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const settle=()=>new Promise(r=>setImmediate(r));

test('visual editor selections, mirrored placement and retargeting preserve geometry and recover from stale layers',async()=>{
    const {createGearVisualsTab}=await module,dom=new JSDOM('<div id="tools"></div><div id="properties"></div>'),doc=dom.window.document,previous=(globalThis as any).document;(globalThis as any).document=doc;
    const mesh={vertices:[[0,0,0],[20,0,0],[0,-20,0],[0,0,15]],faces:[[0,1,2,1000],[0,2,3,1000]],skins:[1,1,1,1],bones:[[],[],[],[]],weights:[[],[],[],[]]};
    const first=makePart({name:'First part',kind:'item',id:1,variant:'inventory',mesh},'inventory'),second=makePart({name:'Second part',kind:'item',id:2,variant:'female',mesh},'female');first.position=[12,3,4];first.pair=true;
    const state:any={mode:'visuals',variant:'inventory',selected:first.id,project:{id:'visual-test',kind:'gear',parts:[first,second],visuals:newGearVisuals()}},geometry=JSON.stringify(state.project.parts),history:any[]=[],errors:string[]=[],messages:string[]=[];let tab:any;
    const element=(tag:string,attrs:any={},...children:any[])=>{const node=doc.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value as any);else if(key==='text')node.textContent=value as string;else if(key==='class')node.className=value as string;else if(key in node)(node as any)[key]=value;else node.setAttribute(key,String(value));}node.append(...children.filter(v=>v!==null&&v!==undefined&&v!==false));return node;};
    const safe=(fn:any)=>(...args:any[])=>{try{return Promise.resolve(fn(...args)).catch(e=>errors.push(e.message));}catch(e:any){errors.push(e.message);}};
    const render=()=>{tab.renderTools(doc.querySelector('#tools'));tab.renderProperties(doc.querySelector('#properties'));};
    const ctx:any={state,element,safe,viewport:{dirty:false},selected:()=>state.project.parts.find(p=>p.id===state.selected),change:(fn:any)=>{history.push(structuredClone(state.project));fn();render();},status:(message:string,error:boolean)=>{messages.push(message);if(error)errors.push(message);},render,renderView:()=>{},updateReference:async()=>{},api:async()=>({rows:[],total:0})};
    ctx.button=(text:string,fn:any,attrs:any={})=>element('button',{text,...attrs,onClick:safe(fn)});
    const click=async(text:string)=>{const button=[...doc.querySelectorAll('button')].find((n:any)=>n.textContent===text) as HTMLButtonElement;assert.ok(button,text);button.click();await settle();};
    const field=async(label:string,value:any)=>{const input=doc.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;assert.ok(input,label);input.value=String(value);input.dispatchEvent(new dom.window.Event('change'));await settle();};
    try{
        tab=createGearVisualsTab(ctx);render();await click('Add layer');await click('Select faces on model');
        assert.equal(tab.pick({partId:first.id,faceId:0,sourceFaceId:0,point:[12,3,4]}),true);assert.deepEqual(state.project.visuals.textures[0].faces,[0]);
        const saved=JSON.stringify(state.project.visuals),count=history.length;await field('Texture scale U',0);assert.equal(JSON.stringify(state.project.visuals),saved);assert.equal(history.length,count,'invalid changes must not enter undo history');assert.match(errors.at(-1)!,/scale/);
        await field('Target part',second.id);assert.equal(state.variant,'female');assert.equal(state.selected,second.id);assert.deepEqual(state.project.visuals.textures[0].faces,[],'retargeting clears the old geometry selection');
        await click('Particles');await click('Add layer');await field('Target part',first.id);await click('Place emitter on model');
        const local=[7,-5,2],point=reflectPoint(worldPoint(local,first,state.project.parts),null,state.project.parts);
        tab.pick({partId:first.id,point,twin:true});assert.deepEqual(state.project.visuals.particles[0].origin,local,'picking the mirrored twin stores the original part-local position');
        assert.equal(JSON.stringify(state.project.parts),geometry,'editing visual layers must not deform source geometry');
        state.project.visuals.particles[0].partId='removed-part';tab.invalidate();const item={id:first.id,mesh:first.mesh};assert.doesNotThrow(()=>tab.preview([item],100));assert.ok(messages.some(m=>m.includes('needs a target part')),'stale layers explain recovery without breaking the render loop');
    }finally{tab?.reset();dom.window.close();(globalThis as any).document=previous;}
});
