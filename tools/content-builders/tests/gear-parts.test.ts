import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as inference from '../shared/parts.mjs';
import {BuilderCache} from '../cache';
import {extract} from '../shared/mesh.mjs';
import {makePart,validateProject,newProject} from '../shared/project.mjs';

const root=path.resolve(import.meta.dirname,'../../..');
const require=createRequire(path.join(root,'client/package.json')),{JSDOM}=require('jsdom');
// Separate vertex indices at the stripe seam. Discovery may compare positions,
// but extraction must retain the two animation/material vertices.
const striped=()=>({vertices:[[0,0,0],[1,0,0],[0,-1,0],[1,0,0],[1,-1,0],[0,-1,0],[8,0,0],[9,0,0],[8,-1,0]],faces:[[0,1,2,960],[3,4,5,43968],[6,7,8,960]],skins:[1,1,1,2,2,2,3,3,3],bones:Array.from({length:9},(_,i)=>[i%3]),weights:Array.from({length:9},()=>[255]),textures:[-1,7,-1],textureCoords:[-1,0,-1],textureMappings:[[3,4,5]],alpha:[0,10,0],priorities:[0,2,0],faceLabels:[1,2,3],renderTypes:[0,0,0]});
const describe=(mesh:any)=>(inference.describeGearParts??inference.describeParts)(mesh);

test('gear discovery offers a connected striped piece and each colour without welding source vertices',()=>{
    const mesh=striped(),before=structuredClone(mesh),offers=describe(mesh);
    const plume=offers.find((p:any)=>p.group==='pieces'&&p.faces.join(',')==='0,1');
    assert.ok(plume,'both stripe colours are offered as one connected piece');
    assert.ok(offers.some((p:any)=>p.group==='colours'&&p.faces.join(',')==='0'));
    assert.ok(offers.some((p:any)=>p.group==='colours'&&p.faces.join(',')==='1'));
    assert.ok(offers.some((p:any)=>p.group==='pieces'&&p.faces.join(',')==='2'),'same colour on a disconnected piece stays separate');
    const cut=extract(mesh,plume.faces);
    assert.equal(cut.vertices.length,6,'coincident stripe seam remains two vertices');
    for(const field of ['skins','bones','weights','textures','textureCoords','textureMappings','alpha','priorities','faceLabels','renderTypes'])assert.deepEqual(cut[field],field==='textureMappings'?[[3,4,5]]:mesh[field].slice(0,field==='skins'||field==='bones'||field==='weights'?6:2));
    assert.deepEqual(mesh,before);
});
test('material boundaries remain selectable within a single connected colour',()=>{
    const mesh=striped();mesh.faces[1][3]=mesh.faces[0][3];
    const offers=describe(mesh);
    assert.ok(offers.some((p:any)=>p.group==='pieces'&&p.faces.join(',')==='0,1'));
    assert.ok(offers.some((p:any)=>p.group==='colours'&&p.faces.join(',')==='1'&&/textur/i.test(p.name)));
});
test('native rune full helm exposes multi-colour pieces and colour cards through the cache source API',()=>{
    const cache=new BuilderCache(root);
    try {
        const source=cache.describe('item',1163,'male');
        assert.ok(new Set(source.mesh.faces.map(f=>f[3])).size>1);
        const pieces=source.parts.filter(p=>p.group==='pieces'&&p.key!=='whole');
        assert.ok(pieces.length,'native equipment has separate connected pieces');
        assert.ok(pieces.some(p=>new Set(p.faces.map(i=>source.mesh.faces[i][3])).size>1),'at least one whole native piece keeps multiple colours');
        assert.ok(source.parts.some(p=>p.group==='colours'));
        const project=newProject('gear-parts','gear',source,{definition:60000,modelBase:1100000},cache.info.name);
        for(const offer of [...pieces,source.parts.find(p=>p.group==='colours')]) {
            const part=makePart(source,'male',offer.key);part.mesh=extract(source.mesh,offer.faces);project.parts.push(part);
            assert.equal(part.source.region,offer.key);
            assert.equal(part.mesh.faces.length,offer.faces.length);
        }
        assert.equal(validateProject(project).parts.length,project.parts.length);
    } finally {cache.close();}
});
test('pictured gear grouping switches selections and keeps source request deduplication',async()=>{
    const dom=new JSDOM('<input id="search"><select id="source-kind"><option>item</option></select><label><input id="creatures-only"></label><button id="search-go"></button><button id="prev"></button><button id="next"></button><span id="result-count"></span><div id="results"></div><div id="library-body"><div id="library-split"></div></div><strong id="source-name"></strong><select id="source-variant"><option>male</option></select><div id="part-cards"></div>',{url:'http://test/'});
    const doc=dom.window.document,source={kind:'item',id:1163,variant:'male',name:'Striped helm',mesh:striped(),parts:describe(striped()),warnings:[]},added:any[]=[],previews:number[]=[],errors:string[]=[];
    let requests=0;
    const module={exports:{} as any};
    const code=fs.readFileSync(path.join(root,'tools/content-builders/public/library.mjs'),'utf8').replace(/^import .*;$/gm,'').replace('export function createLibrary','function createLibrary');
    vm.runInNewContext(`${code}\nmodule.exports={createLibrary};`,{module,document:doc,extract,thumbnail:(_canvas:any,mesh:any)=>previews.push(mesh.faces.length),setTimeout,clearTimeout,localStorage:dom.window.localStorage,IntersectionObserver:class{observe(){}unobserve(){}disconnect(){}}});
    try {
        const library=module.exports.createLibrary({api:async()=>{requests++;return source;},choose:()=>{},add:async(_source:any,offer:any)=>added.push(offer.key),report:(error:string)=>errors.push(error),sequence:()=>{}});
        library.renderParts(source);
        const piece=doc.querySelector('[data-part-key="gear-piece-0"]');assert.ok(piece);assert.ok(previews.includes(2),'picture contains both stripe faces');
        (piece.querySelector('button') as HTMLButtonElement).click();assert.equal(added.at(-1),'gear-piece-0');
        ([...doc.querySelectorAll('button')].find((b:any)=>b.textContent==='Colour areas') as HTMLButtonElement).click();
        assert.equal(doc.querySelector('[data-part-key="gear-piece-0"]'),null);
        assert.ok(doc.querySelector('[data-part-key="gear-colour-0"] canvas'));
        (doc.querySelector('[data-part-key="gear-colour-1"] button') as HTMLButtonElement).click();assert.equal(added.at(-1),'gear-colour-1');
        assert.equal(doc.querySelector('button[aria-pressed=true]')?.textContent,'Colour areas');
        await Promise.all([library.request('item',1163,'male'),library.request('item',1163,'male')]);assert.equal(requests,1);assert.deepEqual(errors,[]);
    } finally {dom.window.close();}
});

test('piece extraction retains face provenance through deduplication and repeated cuts',()=>{
    const mesh=striped();
    mesh.sourceFaces=[40,17,92];
    const cut=extract(mesh,[2,0,2,999]);
    assert.deepEqual(cut.sourceFaces,[92,40]);
    assert.equal(cut.sourceFaces.length,cut.faces.length);
    assert.deepEqual(extract(cut,[1,0]).sourceFaces,[40,92]);
    delete mesh.sourceFaces;
    assert.deepEqual(extract(mesh,[2,0]).sourceFaces,[2,0]);
});
