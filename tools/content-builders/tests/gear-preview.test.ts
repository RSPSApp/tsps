import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {newProject,makePart} from '../shared/project.mjs';
import {gearPreviewMesh,gearPreviewSequence} from '../shared/gear-preview.mjs';
import {assemble} from '../shared/mesh.mjs';
const root=path.resolve(import.meta.dirname,'../../..');
test('all weapon families animate on a complete native player rig, including hidden and translucent body references',()=>{
    const cache=new BuilderCache(root);try{
        let differentPivot=false;
        for(const name of ['Saradomin sword','Dragon scimitar','Magic shortbow','Staff of air']){
            const row=cache.search('item',name).rows.find(row=>row.name.toLowerCase()===name.toLowerCase()),source=cache.describe('item',row.id,'inventory'),project=newProject('gear-preview','gear',source,{definition:60888,modelBase:1100010},cache.info.name);
            for(const gender of ['male','female']){
                const p=structuredClone(project);p.parts.push(makePart(cache.describe('item',row.id,gender),gender));const before=JSON.stringify(p),body=cache.mannequin(gender,p.settings.equipmentType,'character').mesh,visible=gearPreviewMesh(p,gender,body,{style:'character'}),hidden=gearPreviewMesh(p,gender,body,{visible:false}),dummy=gearPreviewMesh(p,gender,body,{style:'dummy'}),alone=assemble(p.parts,gender);
                assert.ok(visible.vertices.length>alone.vertices.length);assert.equal(hidden.alpha.filter(a=>a===255).length,body.faces.length);assert.equal(dummy.alpha.at(-1),153);assert.equal(gearPreviewSequence(p,'idle'),source.gameplay.standAnim);assert.ok(cache.movementChoices(String(p.animations.idle)).total,name+' native equipment movement must be selectable');
                const full=cache.animate(visible,p.animations.idle,3),invisible=cache.animate(hidden,p.animations.idle,3);assert.deepEqual(full.frames.map(f=>f.vertices),invisible.frames.map(f=>f.vertices),'hiding the body must preserve native joint pivots');
                const solo=cache.animate(alone,p.animations.idle,3);differentPivot ||= full.frames.some((f,i)=>solo.frames[i].vertices.some((v,j)=>v.some((n,k)=>n!==f.vertices[j][k])));
                assert.equal(JSON.stringify(p),before,'preview body and alpha never enter the project');
            }
        }
        assert.ok(differentPivot,'the regression must detect standalone-weapon pivot differences');
    }finally{cache.close();}
});
