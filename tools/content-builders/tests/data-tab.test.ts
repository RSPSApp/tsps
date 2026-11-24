import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { BuilderCache } from '../cache';
import { newProject, validateProject } from '../shared/project.mjs';
import { ELEMENTS, activeRequirements, analyseDrops, applyCreaturePreset, chanceText, compareGameplay, copyGameplayGroup, gameplayWarnings, sampleDrops, setDropChance, statSummary, templateGameplay, ticksText } from '../shared/data.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const require = createRequire(path.join(root, 'client/package.json'));
const { JSDOM } = require('jsdom');
let cache: BuilderCache;
before(() => { cache = new BuilderCache(root); });
after(() => cache.close());
const table = () => ({ mode: 'custom', sourceId: 655, emptyWeight: 2, rows: [ { itemId: 526, min: 1, max: 1, weight: 0 }, { itemId: 995, min: 5, max: 10, weight: 6 }, { itemId: 1333, min: 1, max: 1, weight: 2 } ] });
const ids = { definition: 58000, modelBase: 1100000 };
function project(kind = 'npc') { return newProject('data-test', kind, cache.describe(kind === 'npc' ? 'npc' : 'item', kind === 'npc' ? 655 : 4587, kind === 'npc' ? 'body' : 'inventory'), ids, cache.info.name); }

test('drop preview matches guaranteed, weighted and empty runtime outcomes', () => {
    const d = table(), original = structuredClone(d), a = analyseDrops(d);
    assert.equal(a.total, 10); assert.equal(a.entries[0].chance, 1); assert.equal(a.entries[1].chance, .6); assert.equal(a.emptyChance, .2);
    assert.equal(a.entries[1].expected, 4.5);
    const sequence = [0, .59999, .99999, 0, .6, 0, 0, .8]; let i = 0;
    assert.deepEqual(sampleDrops(d, 3, () => sequence[i++]), [ [{itemId:526,amount:1},{itemId:995,amount:10}], [{itemId:526,amount:1},{itemId:1333,amount:1}], [{itemId:526,amount:1}] ]);
    assert.deepEqual(d, original);
    assert.equal(chanceText(.125), '1 in 8 (12.5%)'); assert.match(chanceText(.3), /About 1 in 3/);
    assert.equal(chanceText(1), 'Every kill (100%)'); assert.equal(chanceText(0), 'Never');
});
test('editing a chance preserves other ratios and cannot turn weighted rows into guaranteed rows', () => {
    const d = table(), next = setDropChance(d, 1, 25), a = analyseDrops(next);
    assert.equal(a.entries[1].chance, .25); assert.equal(next.rows[2].weight / next.emptyWeight, 1);
    assert.equal(next.rows[0].weight, 0); assert.equal(d.rows[1].weight, 6);
    for (const percent of [.01, 1, 12.5, 33.33, 50, 99.99]) {
        const changed = setDropChance({ ...table(), emptyWeight: 0, rows: table().rows.slice(0,2) }, 1, percent);
        assert.ok(Math.abs(analyseDrops(changed).entries[1].chance * 100 - percent) < 1e-8);
        assert.equal(changed.rows[0].weight, 0);
    }
    assert.throws(() => setDropChance(d, 1, 100), /Other weighted/);
    assert.throws(() => setDropChance(d, 1, 0), /above 0/);
    assert.throws(() => setDropChance(d, 0, 50), /weighted/);
    assert.throws(() => setDropChance(d, 1, 1.234), /decimal/);
    const huge = { ...table(), emptyWeight: 999999, rows: table().rows.map(r => r.weight > 0 ? {...r,weight:999983} : r) };
    assert.throws(() => setDropChance(huge, 1, 33.33), /too many shares/);
    const only = { ...table(), emptyWeight: 3, rows: [table().rows[1]] };
    assert.equal(analyseDrops(setDropChance(only, 0, 100)).entries[0].chance, 1);
    assert.equal(setDropChance(only, 0, 100).rows[0].weight, 1);
});
test('validation explains quantities, duplicate items, row budgets and inactive custom errors', () => {
    const d = table(); d.rows[1].min = 11; d.rows[1].itemId = 526; d.rows[2].weight = -1;
    const result = analyseDrops(d); assert.match(result.errors.join(' '), /maximum at least minimum/); assert.match(result.errors.join(' '), /shares/); assert.equal(result.warnings.length, 1);
    assert.ok(analyseDrops({...d,mode:'none'}).errors.length, 'saved hidden rows still need valid values');
    assert.match(analyseDrops({...table(),rows:Array(151).fill(table().rows[0])}).errors[0], /150/);
    assert.throws(() => sampleDrops(d), /quantities/);
    assert.equal(sampleDrops(table(), 100, () => .99).length, 50);
    assert.throws(() => sampleDrops(table(), 1, () => 1), /random/);
});
test('copy and reset use TSPS template defaults without touching geometry, IDs, drops or animation', () => {
    for (const kind of ['npc', 'gear']) {
        const p = project(kind), source = cache.gameData(kind === 'npc' ? 'npc' : 'item', kind === 'npc' ? 655 : 4587), template = templateGameplay(source, kind);
        const retained = JSON.stringify({parts:p.parts,animations:p.animations,drops:p.drops,ids:p.ids});
        if (kind === 'npc') { p.settings.hitpoints += 50; assert.ok(compareGameplay(p,template,'combat').some(row=>row.key==='hitpoints')); copyGameplayGroup(p,template,'combat'); assert.equal(p.settings.hitpoints,template.settings.hitpoints); }
        else { p.settings.bonuses[0] += 20; p.settings.requirements[23] = 70; copyGameplayGroup(p,template,'bonuses'); assert.equal(p.settings.bonuses[0],template.settings.bonuses[0]); assert.equal(p.settings.requirements[23],70); p.settings.bonuses[0]++; assert.notEqual(p.settings.bonuses[0],template.settings.bonuses[0]); }
        assert.equal(JSON.stringify({parts:p.parts,animations:p.animations,drops:p.drops,ids:p.ids}),retained);
        assert.equal(validateProject(p).name,p.name);
        assert.throws(()=>copyGameplayGroup(p,template,'animation'),/gameplay group/);
    }
});
test('creature presets, units and gear summaries retain modern elemental mappings and explicit restrictions', () => {
    assert.deepEqual(ELEMENTS.map(row=>row[1]), ['None','Air (wind)','Water','Earth','Fire']);
    assert.equal(ticksText(4), '4 ticks (2.4 seconds)');
    const p=project(); const old=JSON.stringify({drops:p.drops,animations:p.animations,parts:p.parts});
    applyCreaturePreset(p,'ranged'); assert.equal(p.settings.attackType,'RANGED'); assert.equal(p.settings.stats[3],25); assert.equal(JSON.stringify({drops:p.drops,animations:p.animations,parts:p.parts}),old);
    assert.equal(statSummary(p).find(row=>row[0]==='Attack interval')[1],'3 sec');
    const g=project('gear'); g.settings.requirements.fill(0);g.settings.requirements[23]=70;
    assert.deepEqual(activeRequirements(g.settings),[{name:'Sailing',index:23,level:70}]);
    g.settings.equipmentType='NONE';g.settings.doubleHanded=true;g.settings.specialFrom=1215;
    assert.ok(gameplayWarnings(g).some(text=>text.includes('Two-handed')));assert.ok(gameplayWarnings(g).some(text=>text.includes('cannot be equipped')));
});
test('read-only metadata has the same template semantics as mesh sources and is detached', () => {
    for (const [kind,id,variant] of [['npc',655,'body'],['item',4587,'inventory']] as const) {
        const metadata=cache.gameData(kind,id), source=cache.describe(kind,id,variant);
        assert.deepEqual(metadata.fields,source.fields);assert.deepEqual(metadata.gameplay,source.gameplay);assert.deepEqual(metadata.combat,source.combat);
        metadata.fields.wearPos=999;metadata.gameplay.name='mutated';
        assert.notEqual(cache.gameData(kind,id).fields.wearPos,999);assert.notEqual(cache.gameData(kind,id).gameplay.name,'mutated');
    }
    assert.throws(()=>cache.gameData('seq',1),/creature or native item/);assert.throws(()=>cache.gameData('item',-1),/does not exist/);
});
test('special donor search reads real bundled registrations and excludes ordinary weapons and stubs', () => {
    const rows=cache.specialDonors('dragon dagger').rows;
    assert.ok(rows.some(row=>row.id===1215&&row.energy===25));
    assert.equal(cache.specialDonors('bronze dagger').total,0);
    assert.equal(cache.specialDonors('sunspear').total,0,'empty registration stubs cannot be donors');
    assert.equal(cache.specialDonors('seercull').rows[0]?.energy,100,'actual registration wins over a stale skipped comment');
    const maul=cache.specialDonors('granite maul').rows;
    assert.equal(maul.find(row=>row.id===24225)?.energy,50,'ornate drain override comes from the registration');
    assert.ok(cache.specialDonors('',0).rows.length<=50);assert.ok(cache.specialDonors('',50).rows.every(row=>!cache.specialDonors('',0).rows.some(first=>first.id===row.id)));
});
test('native reference search includes noted drops without changing the Build library catalog', () => {
    const refs=cache.search('item','rune scimitar',0,{references:true});
    const noted=refs.rows.find(row=>row.noted); assert.ok(noted,'noted items must be selectable for drops');
    assert.equal(cache.search('item',String(noted.id)).total,0);
    assert.equal(cache.search('item',String(noted.id),0,{references:true}).rows[0].id,noted.id);
    const preview=cache.dropTable(655);assert.ok(preview.tables.length);assert.match(preview.notice,/not final per-kill odds/);
    assert.ok(preview.tables.every(table=>table.rows.length<=80));preview.tables[0].rows[0].name='changed';assert.notEqual(cache.dropTable(655).tables[0].rows[0].name,'changed');
    assert.equal(cache.dropTable(6594).tables.length,0,'removed NPC table mappings stay removed');
});

// Browser modules are loaded with only their existing absolute module imports
// rewritten to local file URLs. No server, preview tab, bundle or test copy.
const publicPath=path.join(root,'tools/content-builders/public');
const dataSource=fs.readFileSync(path.join(publicPath,'data.mjs'),'utf8').replaceAll("'/shared/project.mjs'",JSON.stringify(pathToFileURL(path.join(publicPath,'../shared/project.mjs')).href)).replaceAll("'/shared/data.mjs'",JSON.stringify(pathToFileURL(path.join(publicPath,'../shared/data.mjs')).href)).replaceAll("'/gear-effects.mjs'",JSON.stringify(pathToFileURL(path.join(publicPath,'gear-effects.mjs')).href)).replaceAll("'/picker.mjs'",JSON.stringify(pathToFileURL(path.join(publicPath,'picker.mjs')).href));
const dataModule=()=>import(`data:text/javascript;base64,${Buffer.from(dataSource).toString('base64')}`);
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(p:any) {
    const dom=new JSDOM('<main><div id="tools"></div><div id="properties"></div></main>');
    const previous=(globalThis as any).document;(globalThis as any).document=dom.window.document;
    const doc=dom.window.document,errors:string[]=[],history:any[]=[];let tab:any;
    function element(tag:string,attrs:any={},...children:any[]) {
        const e=doc.createElement(tag);
        for(const [key,value] of Object.entries(attrs)) {if(key.startsWith('on'))e.addEventListener(key.slice(2).toLowerCase(),value as any);else if(key==='text')e.textContent=value as string;else if(key==='class')e.className=value as string;else if(key in e)(e as any)[key]=value;else e.setAttribute(key,String(value));}
        e.append(...children.filter(v=>v!==null&&v!==undefined&&v!==false));return e;
    }
    const state:any={project:p,info:{weaponStyles:['SWORD']},mode:'data'};
    const ctx:any={state,element,thumbnail:()=>{},status:(text:string,error:boolean)=>{if(error)errors.push(text);},api:async(route:string)=>{
        const u=new URL(route,'http://test/');const id=Number(u.searchParams.get('q')??u.searchParams.get('id'));
        if(u.pathname.endsWith('search'))return {rows:[{id:Number.isFinite(id)&&id>0?id:995,name:id===526?'Bones':'Coins'}],total:1};
        if(u.pathname.endsWith('source'))return {mesh:{vertices:[],faces:[]}};
        if(u.pathname.endsWith('special-donors'))return {rows:[{id:1215,name:'Dragon dagger',specialName:'dragon_dagger',energy:25,recipe:{version:1,rules:[{id:'rule-1',type:'hitCount',value:2}],extras:[],actions:[]}}],total:1};
        if(u.pathname.endsWith('game-data'))return cache.gameData(p.kind==='npc'?'npc':'item',id);
        if(u.pathname.endsWith('drop-table'))return cache.dropTable(id);
        throw new Error(route);
    },change:(fn:()=>void)=>{history.push(structuredClone(state.project));fn();tab.renderProperties(doc.querySelector('#properties'));},renderProperties:()=>tab.renderProperties(doc.querySelector('#properties'))};
    ctx.button=(text:string,fn:()=>any,attrs:any={})=>element('button',{text,onClick:()=>{try{Promise.resolve(fn()).catch(e=>errors.push(e.message));}catch(e:any){errors.push(e.message);}},...attrs});
    const input=(label:string)=>doc.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    const changeInput=(label:string,value:any)=>{const field=input(label);assert.ok(field,label);field.value=String(value);field.dispatchEvent(new dom.window.Event('change'));};
    const click=(text:string)=>{const b=[...doc.querySelectorAll('button')].find((b:any)=>b.textContent===text) as HTMLButtonElement;assert.ok(b,text);b.click();};
    return {ctx,doc,state,errors,history,input,changeInput,click,setTab:(t:any)=>tab=t,close:()=>{(globalThis as any).document=previous;dom.window.close();}};
}
test('creature UI edits pictured drops with one undo checkpoint and rejects invalid numbers', async()=>{
    const p=project();p.drops=table();const h=harness(p);
    try {
        const {createGameDataTab}=await dataModule(),tab=createGameDataTab(h.ctx);h.setTab(tab);tab.renderProperties(h.doc.querySelector('#properties'));tab.renderTools(h.doc.querySelector('#tools'));await settle();
        assert.ok(h.doc.querySelector('table[aria-label="Drop table preview"] canvas'));
        assert.match(h.doc.body.textContent,/Guaranteed/);assert.match(h.doc.body.textContent,/One weighted roll/);
        h.state.gameData.dropIndex=1;tab.renderProperties(h.doc.querySelector('#properties'));
        h.changeInput('Chance on each kill (%)',25);assert.equal(analyseDrops(p.drops).entries[1].chance,.25);assert.equal(h.history.length,1);
        h.changeInput('Minimum amount',100);assert.equal(p.drops.rows[1].max,100);
        const previous=p.drops.rows[1].min;h.changeInput('Minimum amount',-1);assert.equal(p.drops.rows[1].min,previous);assert.match(h.errors.at(-1)!,/whole number/);
        h.changeInput('What drops on a kill?','none');h.changeInput('What drops on a kill?','custom');assert.equal(p.drops.rows.length,3);
        h.click('Try 10 kills');assert.equal(h.doc.querySelectorAll('.data-sample li').length,10);
        assert.equal(validateProject(p).drops.rows.length,3);
    } finally {h.close();}
});
test('gear UI supports slot selection, active requirements and a real special donor without authoring animation',async()=>{
    const p=project('gear'),h=harness(p);p.settings.requirements.fill(0);
    try {
        const {createGameDataTab}=await dataModule(),tab=createGameDataTab(h.ctx);h.setTab(tab);tab.renderProperties(h.doc.querySelector('#properties'));await settle();
        assert.equal(h.doc.querySelectorAll('.data-slot').length,12);
        h.click('Head');assert.equal(p.settings.equipmentType,'HAT');assert.ok(h.doc.querySelector('.data-slot-head[aria-pressed=true]'));
        h.changeInput('Add a skill requirement',23);h.click('Add');h.changeInput('Sailing',70);assert.equal(p.settings.requirements[23],70);
        h.click('Remove');assert.equal(p.settings.requirements[23],0);
        h.click('Weapon');h.click('Use an existing attack');const search=h.input('Special attack weapon');search.dispatchEvent(new h.doc.defaultView.Event('focus'));await settle();
        const donor=[...h.doc.querySelectorAll('.picker-results button')].find((b:any)=>b.textContent.includes('Dragon dagger')) as HTMLButtonElement;assert.ok(donor);donor.click();
        assert.equal(p.settings.specialFrom,-1);assert.equal(p.effects.special.nativeFrom,1215);assert.equal(p.effects.special.recipe,true);assert.equal(p.effects.special.energy,25);assert.match(h.doc.body.textContent,/Energy|energy/);
        assert.equal(h.doc.querySelectorAll('[aria-label*="animation ID"]').length,0);assert.equal(validateProject(p).effects.special.recipe,true);
    } finally {h.close();}
});
test('animation-compatible picker keeps keyboard selection and discards a search after Escape',async()=>{
    const p=project(),h=harness(p);
    try {
        const {referencePicker}=await import('../public/picker.mjs');let resolve:any,selected=-1;
        const ctx={...h.ctx,api:()=>new Promise(r=>resolve=r),change:(fn:any)=>fn()};
        const wrapper=referencePicker(ctx,h.doc.querySelector('#properties'),'Movement','seq',-1,(id:number)=>selected=id);
        const input=wrapper.querySelector('input');input.dispatchEvent(new h.doc.defaultView.Event('focus'));
        input.dispatchEvent(new h.doc.defaultView.KeyboardEvent('keydown',{key:'Escape'}));resolve({rows:[{id:808,name:'Human idle'}],total:1});await settle();
        assert.equal(wrapper.querySelector('.picker-results').hidden,true);
        input.dispatchEvent(new h.doc.defaultView.Event('focus'));resolve({rows:[{id:808,name:'Human idle'}],total:1});await settle();
        const option=[...wrapper.querySelectorAll('[role="option"]')].find((b:any)=>b.textContent==='Human idle') as HTMLButtonElement;assert.ok(option);option.click();assert.equal(selected,808);assert.equal(wrapper.querySelectorAll('canvas').length,0);
    }finally{h.close();}
});
