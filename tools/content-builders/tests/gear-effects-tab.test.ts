import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGearEffectsTab} from '../public/gear-effects.mjs';
import {compileEffects,effectPreset,newEffects} from '../shared/effects.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(root,'client/package.json')),{JSDOM}=require('jsdom');
const mesh={vertices:[[0,0,0],[10,0,0],[0,-10,0]],faces:[[0,1,2,500]],skins:[0,0,0]};
const makeProject=()=>({id:'gear-ui',kind:'gear',ids:{definition:60888},settings:{equipmentType:'WEAPON',specialFrom:-1,specialEnergy:50},parts:[{id:'weapon',variant:'male',visible:true,mesh:structuredClone(mesh)}],effects:newEffects()});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(p:any=makeProject()) {
    const dom=new JSDOM('<main><aside id="tools"></aside><div id="properties"></div></main>'),doc=dom.window.document,previous=(globalThis as any).document;(globalThis as any).document=doc;
    const history:any[]=[],errors:string[]=[],requests:any[]=[],played:any[]=[];let tab:any;
    const state:any={project:p,variant:'male',mode:'data'};
    function element(tag:string,attrs:any={},...children:any[]) {
        const node=doc.createElement(tag);
        for(const [key,value] of Object.entries(attrs)) {
            if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value as any);
            else if(key==='text')node.textContent=value as string;
            else if(key==='class')node.className=value as string;
            else if(key in node)(node as any)[key]=value;
            else node.setAttribute(key,String(value));
        }
        node.append(...children.filter(v=>v!==undefined&&v!==null&&v!==false));return node;
    }
    const ctx:any={state,element,thumbnail:()=>{},stop:()=>{},renderView:()=>{},viewport:{play:(clip:any)=>played.push(clip)},status:(message:string,error:boolean)=>{if(error)errors.push(message);},change:(fn:any)=>{history.push(structuredClone(state.project));fn();},api:async(route:string,body:any)=>{
        requests.push([route,body]);const u=new URL(route,'http://test/');
        if(u.pathname.endsWith('special-donors'))return {rows:[{id:1215,name:'Dragon dagger',energy:25,specialName:'dragon_dagger',recipe:{version:1,rules:[{id:'rule-1',type:'hitCount',value:2}],extras:[],actions:[]}}],total:1};
        if(u.pathname.endsWith('search'))return {rows:[{id:Number(u.searchParams.get('q'))||1062,name:u.searchParams.get('kind')==='seq'?'Dragon dagger puncture':'Native item'}],total:1};
        if(u.pathname.endsWith('source'))return {mesh};
        if(u.pathname.endsWith('mannequin'))return {mesh};
        if(u.pathname.endsWith('animate'))return {mesh:body.mesh,frames:[{duration:100,vertices:body.mesh.vertices}]};
        throw new Error(route);
    }};
    ctx.button=(text:string,fn:any,attrs:any={})=>element('button',{text,...attrs,onClick:()=>{try{Promise.resolve(fn()).catch(e=>errors.push(e.message));}catch(e:any){errors.push(e.message);}}});
    const render=()=>{tab.renderProperties(doc.querySelector('#properties'));tab.renderTools(doc.querySelector('#tools'));};
    tab=createGearEffectsTab(ctx);render();
    const field=(label:string)=>doc.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    const change=(label:string,value:any)=>{const input=field(label);assert.ok(input,label);if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new dom.window.Event('change'));};
    const click=(text:string)=>{const input=[...doc.querySelectorAll('button')].find((n:any)=>n.textContent===text) as HTMLButtonElement;assert.ok(input,text);input.click();};
    return {doc,state,ctx,tab,history,errors,requests,played,render,field,change,click,close:()=>{tab.reset();dom.window.close();(globalThis as any).document=previous;}};
}
test('gear authoring creates real configurable special rules with bounded hits and named animation',async()=>{
    const h=harness();
    try {
        h.click('Create an attack');assert.equal(h.state.project.effects.special.hitCount,2);assert.equal(h.history.length,1);
        h.change('Start with a special attack','warhammer');assert.equal(h.state.project.effects.special.animation,1378);assert.equal(h.state.project.effects.special.actions[0].type,'drain');assert.match(h.doc.body.textContent,/Tekton/);
        h.change('Current Defence removed (%)',20);assert.equal(h.state.project.effects.special.actions[0].percent,20);
        h.change('Number of hits',3);assert.deepEqual(h.state.project.effects.special.hitDelayTicks,[0,0,0]);
        const previous=JSON.stringify(h.state.project.effects);h.change('Number of hits',5);assert.equal(JSON.stringify(h.state.project.effects),previous);assert.match(h.errors.at(-1)!,/whole number/);
        h.change('Hit 3 delay (ticks)',2);assert.deepEqual(h.state.project.effects.special.hitDelayTicks,[0,0,2],'staggered hits retain impact effects through actual health-loss callbacks');
        h.change('Named attack movement',7644);assert.equal(h.state.project.effects.special.animation,7644);
        h.click('Play animation');await settle();await settle();assert.equal(h.played.length,1);assert.ok(h.requests.some(([route,body])=>route==='animate'&&body.sequence===7644));
        assert.equal(h.state.project.settings.specialFrom,-1);assert.equal(compileEffects(h.state.project).config.special.hitCount,3);
        assert.equal(h.doc.querySelectorAll('.effects-hit-preview li').length,3);assert.match(h.doc.body.textContent,/hit chance/);
        h.click('None');assert.equal(h.state.project.effects.special,null);
    } finally {h.close();}
});
test('selecting an existing attack copies editable effects and cost with a single undo checkpoint',async()=>{
    const p=makeProject();delete p.effects;const h=harness(p);
    try {
        h.click('Use an existing attack');const before=h.history.length;
        h.field('Special attack weapon').dispatchEvent(new h.doc.defaultView.Event('focus'));await settle();
        const donor=[...h.doc.querySelectorAll('.picker-results button')].find((n:any)=>n.textContent.includes('Dragon dagger')) as HTMLButtonElement;assert.ok(donor);donor.click();
        assert.equal(p.settings.specialFrom,-1);assert.equal(p.effects.special.nativeFrom,1215);assert.equal(p.effects.special.recipe,true);assert.equal(p.effects.special.energy,25);assert.equal(h.history.length,before+1);
        h.change('Special energy (%)',30);assert.equal(p.effects.special.energy,30);
        h.click('Create an attack');assert.equal(p.settings.specialFrom,-1);assert.ok(p.effects.special);
        h.click('Use an existing attack');assert.equal(p.effects.special,null);
    } finally {h.close();}
});
test('set authoring handles named native pieces, alternatives, required count and reassigned custom IDs',()=>{
    const h=harness();
    try {
        h.change('Start with a passive or set effect','guthans');assert.equal(h.state.project.effects.passives.length,1);assert.equal(h.state.project.effects.passives[0].set.required,4);
        h.change('Weapon item IDs','self, 1215');assert.deepEqual(compileEffects(h.state.project).config.passives[0].set.pieces.find(p=>p.slot===3).itemIds,[60888,1215]);
        h.change('Required pieces',3);assert.equal(h.state.project.effects.passives[0].set.required,3);
        const before=JSON.stringify(h.state.project.effects);h.change('Weapon item IDs','self, secret-text');assert.equal(JSON.stringify(h.state.project.effects),before);assert.match(h.errors.at(-1)!,/item IDs/);
        h.click('Create an effect');assert.equal(h.state.project.effects.passives.length,2);
        h.change('Activation trigger','accurate');h.change('Add damage to the existing hit',8);assert.equal(h.state.project.effects.passives[1].bonusDamage,8);
        h.change('Activation trigger','damage');assert.equal(h.state.project.effects.passives[1].bonusDamage,0);
        h.click('Delete effect');assert.equal(h.state.project.effects.passives.length,1);
    } finally {h.close();}
});
test('pending animation responses cannot replace a changed creation and preview errors remain visible',async()=>{
    const p=makeProject();p.effects.special=effectPreset('dagger');const h=harness(p);
    try {
        let finish:any;h.ctx.api=async(route:string)=>route.startsWith('mannequin')?{mesh}:new Promise(resolve=>finish=resolve);
        // ctx.api is read at request time, including after awaiting the mannequin.
        h.click('Play animation');await settle();h.change('Attack name','New attack');finish({mesh,frames:[{duration:100,vertices:mesh.vertices}]});await settle();assert.equal(h.played.length,0);
        h.ctx.api=async()=>{throw new Error('This movement needs a weighted rig.');};h.click('Play animation');await settle();assert.match(h.errors.at(-1)!,/weighted rig/);
    } finally {h.close();}
});
test('the standalone effect panel leaves creature editing untouched',()=>{
    const p=makeProject();p.kind='npc';const h=harness(p);
    try{assert.equal(h.doc.querySelector('#properties').textContent,'');assert.equal(h.doc.querySelector('#tools').textContent,'');assert.deepEqual(p.effects,newEffects());}
    finally{h.close();}
});
test('reference discovery is pictured, searchable and goal-first with technical rolls disclosed later',()=>{
    const h=harness();
    try {
        h.click('Create an attack');
        assert.ok(h.doc.querySelector('[aria-label="Find a special attack reference"]'));
        assert.ok(h.doc.querySelectorAll('.effects-reference-card canvas').length>=4,'references use real native model cards');
        assert.ok(h.field('Accuracy (%)').closest('details')?.open===false,'accuracy starts inside Advanced');
        assert.ok(h.doc.querySelector('[aria-label="Reference goal"]'));
    } finally {h.close();}
});
