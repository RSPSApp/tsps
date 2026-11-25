import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {BuilderCache} from '../cache';
import {compileProject} from '../export.mjs';
import {newProject,makePart} from '../shared/project.mjs';
import {newSpecial,newEffects,newNativeSpecial,newPassive} from '../shared/effects.mjs';
import {loadFromPayload} from '../../../client/common/gamemode/GamemodeContentStore';
import {CustomItemRegistry} from '../../../client/custom/items/CustomItemRegistry';
import {EquipmentSlot,withActionSeqHandItems} from '../../../client/rs/config/player/Equipment';
import {PlayerAppearance} from '../../../client/rs/config/player/PlayerAppearance';
const root=path.resolve(import.meta.dirname,'../../..');
test('player movements exclude monster, projectile and chathead sequences even by exact ID',()=>{
    const cache=new BuilderCache(root);
    try{
        const all=cache.movementChoices('',0,{actor:'player'});assert.ok(all.total>100);assert.equal(all.rows.length,50);
        for(const id of [0,1,2,3,4,5,6,7,8,9])assert.equal(cache.movementChoices(String(id),0,{actor:'player'}).total,0,'not a human movement: '+id);
        for(const id of [422,423,1062,7644,7514,7138])assert.equal(cache.movementChoices(String(id),0,{actor:'player'}).rows[0]?.id,id);
        assert.equal(cache.movementChoices('swarm walk',0,{actor:'player'}).total,0);
        assert.equal(cache.movementChoices('422',0,{actor:'player',category:'emote'}).total,0);
        assert.throws(()=>cache.movementPreview(4,{actor:'player',gender:'male'}),/compatible|player/i);
        const preview=cache.movementPreview(422,{actor:'player',gender:'female'});assert.ok(preview.frames.length>1);assert.ok(preview.frames.every(f=>f.vertices.length===preview.mesh.vertices.length));
        const crab=cache.movementChoices('',0,{actor:'npc',npcId:100});assert.ok(crab.total>0);assert.ok(crab.rows.every(row=>row.id!==422));
        const refs=cache.effectReferences('set');assert.ok(refs.rows.every(row=>row.name.length<100),'reference headings must not include entire descriptions');
        const source=cache.describe('item',4587,'inventory'),p=newProject('movement-export','gear',source,{definition:60888,modelBase:1100010},cache.info.name);p.parts.push(...['male','female'].map(variant=>makePart(cache.describe('item',4587,variant),variant)));p.settings.equipmentType='WEAPON';p.effects={...newEffects(),special:{...newSpecial(),animation:4}};assert.throws(()=>compileProject(p,cache),/compatible player animation/,'legacy invalid selections cannot export a player morph');
    }finally{cache.close();}
});

test('exported gear retains its worn model through native, edited and original special poses',()=>{
    const cache=new BuilderCache(root);
    try{
        const p=newProject('borrowed-pose','gear',cache.describe('item',4587,'inventory'),{definition:60888,modelBase:1100010},cache.info.name);
        p.parts.push(...['male','female'].map(variant=>makePart(cache.describe('item',4587,variant),variant)));
        p.settings.equipmentType='WEAPON';
        const equipment=Array(14).fill(-1);equipment[EquipmentSlot.WEAPON]=p.ids.definition;equipment[EquipmentSlot.SHIELD]=1201;
        for(const donor of [26233,11802]){
            const reference=cache.specialDonors(String(donor)).rows.find(row=>row.id===donor);
            assert.ok(reference?.animations.length);
            p.effects={...newEffects(),special:newNativeSpecial(reference)};
            const compiled=compileProject(p,cache),item=compiled.content.item;
            // The network dataset, registry and hand substitution function are the live client path.
            loadFromPayload({gamemodeId:'test',datasets:[{key:'customItems',rows:[item]}]});
            for(const animation of reference.animations){
                assert.ok(item.retainWornModelForAnimations.includes(animation));
                const seq=(cache as any).loader('seq').load(animation);
                assert.ok(seq.rightHandItem>=512,'the native sequence must actually replace the weapon');
                for(const gender of [0,1]){
                    const app=new PlayerAppearance(gender,[0,0,0,0,0],[0,1,2,3,4,5,6],equipment);
                    const attacking=withActionSeqHandItems(app,seq,animation);
                    assert.equal(attacking.equip[EquipmentSlot.WEAPON],item.id);
                    assert.equal(attacking.equip[EquipmentSlot.SHIELD],-1);
                }
            }
        }
        p.effects.special={...p.effects.special,animation:1062,nativeOverrides:['animation']};
        let item=compileProject(p,cache).content.item;
        assert.ok(item.retainWornModelForAnimations.includes(1062));
        assert.ok(!item.retainWornModelForAnimations.includes(7644),'a replaced native pose is no longer retained');
        const visual={kind:'animation',id:7644,recipient:'player',phase:'launch',delayMs:0,speed:1,durationMs:0,loop:false,height:0};
        p.effects={...newEffects(),special:{...newSpecial(),animation:9171,visuals:[visual,{...visual,id:7645,recipient:'target'}]},passives:[{...newPassive(),visuals:[{...visual,id:7642,phase:'impact'}]}]};
        p.animations.attack=7045;
        item=compileProject(p,cache).content.item;
        for(const id of [9171,7644,7642,7045])assert.ok(item.retainWornModelForAnimations.includes(id));
        assert.ok(!item.retainWornModelForAnimations.includes(7645),'target cues cannot change the wearer policy');
        assert.equal(new Set(item.retainWornModelForAnimations).size,item.retainWornModelForAnimations.length);
    }finally{CustomItemRegistry.clear();cache.close();}
});
