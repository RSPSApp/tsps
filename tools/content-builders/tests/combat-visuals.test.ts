import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {newVisual,validateVisuals,visualDuration,visualFrame,shiftHueRgb,VISUAL_RECIPES} from '../shared/visuals.mjs';
import {newEffects,newSpecial,newPassive,newNativeSpecial,compileEffects,validateEffects} from '../shared/effects.mjs';
import {BuilderCache} from '../cache';
const require=createRequire(import.meta.url),{validateManifest,checkEffectCapabilities,registerEffects}=require('../runtime.effects.cjs');
const root=path.resolve(import.meta.dirname,'../../..');
const project=(special:any=null,passives:any[]=[])=>({id:'visual-test',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special,passives}});
test('visual queues round trip into portable manifests and reject unbounded or misleading playback',()=>{
    const special={...newSpecial(),visuals:[newVisual(1209,{recipient:'player',phase:'launch'}),newVisual(398,{recipient:'both',speed:2,durationMs:2400,loop:true})]},passive={...newPassive(),visuals:[newVisual(398)]};
    const p=project(special,[passive]),before=JSON.stringify(p),manifest=compileEffects(p);
    assert.deepEqual(validateManifest(manifest),manifest);assert.equal(JSON.stringify(p),before);assert.ok(manifest.requires.includes('actor-visuals/1'));
    for(const patch of [{id:-1},{id:1.2},{recipient:'world'},{speed:0},{speed:5},{delayMs:NaN},{delayMs:119000,durationMs:2000},{loop:true},{extra:true},{kind:'animation',speed:2},{nativeGraphic:1171},{nativeRecipient:'player'},{heightMode:'native'}]){
        const broken={...special,visuals:[{...newVisual(398),...patch}]};assert.throws(()=>validateEffects(project(broken).effects));const m=structuredClone(manifest);m.config.special=broken;assert.throws(()=>validateManifest(m));
    }
    assert.throws(()=>validateEffects(project(null,[{...newPassive(),visuals:[newVisual(398,{phase:'launch'})]}]).effects),/activation impact/);
    assert.throws(()=>validateVisuals(Array.from({length:25},()=>newVisual(398))));
    const asset={frames:[{duration:100,vertices:[0]},{duration:200,vertices:[1]}]};
    assert.equal(visualDuration(newVisual(1,{speed:2}),300),150);
    assert.deepEqual(visualFrame(asset,newVisual(1,{speed:2}),60).vertices,[1]);
    assert.deepEqual(visualFrame(asset,newVisual(1,{durationMs:1000}),900).vertices,[1]);
    assert.deepEqual(visualFrame(asset,newVisual(1,{loop:true,durationMs:1000}),350).vertices,[0]);
});
test('native VFX catalog includes unnamed graphics, every recipe and size-test opponents with animated geometry',()=>{
    const cache=new BuilderCache(root);
    try{
        const all=cache.search('effect','');assert.ok(all.total>4000);assert.equal(all.rows.length,50);assert.equal(cache.search('effect','',50).rows.length,50);
        assert.ok(cache.combatEnemies().every((row:any)=>row.id>=0));assert.equal(cache.combatEnemies().length,4);
        for(const id of new Set(VISUAL_RECIPES.flatMap(r=>r.clips.map(c=>c.id)))){const clip=cache.effect(id);assert.ok(clip.frames.length>1);assert.ok(clip.duration>0);assert.ok(clip.frames.every(f=>f.vertices.length===clip.mesh.vertices.length));}
        (cache as any).catalog.delete('effect');(cache as any).gamevalNames.set(8,new Map());assert.ok(cache.search('effect','unnamed').total>4000,'caches without gameval names still expose every renderable effect');
        assert.throws(()=>cache.effect(-1));
    }finally{cache.close();}
});
test('native actor presentation schedules once, respects visibility, and cancels on replacement or disposal',()=>{
    const ts=require(path.join(root,'client/node_modules/typescript')),file=path.join(root,'server/src/main/typescript/elvarg/game/model/ActorVisuals.ts'),source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    const timers=new Map<any,{fn:()=>void,ms:number}>(),sent:any[]=[],actor:any={isPlayer:()=>false,getIndex:()=>4,performAnimation:(a:any)=>sent.push(['animation',a.id])};let current=actor;
    const visible={getLocalNpcs:()=>[actor],getSession:()=>({sendClientPacket:(p:any)=>sent.push(p)})},hidden={getLocalNpcs:()=>[],getSession:()=>({sendClientPacket:()=>assert.fail('hidden actors must not leak')})};
    const context:any={exports:{},require:(id:string)=>id.includes('World')?{World:{getNpcs:()=>({get:()=>current}),getPlayers:()=>[visible,hidden]}}:id.includes('Animation')?{Animation:class{constructor(public id:number){}}}:{encodePluginMessage:(channel:any,data:any)=>({channel,data})},setTimeout:(fn:any,ms:number)=>{const timer={unref(){}};timers.set(timer,{fn:()=>{timers.delete(timer);fn();},ms});return timer;},clearTimeout:(timer:any)=>timers.delete(timer)};
    vm.runInNewContext(source,context);const {ActorVisuals}=context.exports;
    const first=ActorVisuals.play(actor,[newVisual(398,{delayMs:250,speed:2,durationMs:1200})]);
    const next=[...timers.values()].find(t=>t.ms===250)!;next.fn();assert.equal(sent.length,1);assert.equal(sent[0].data.clip.speed,2);assert.equal(sent[0].data.actor.index,4);
    first.cancel();assert.equal(timers.size,0);assert.equal(sent.at(-1).data.type,'clear');
    ActorVisuals.play(actor,[newVisual(398,{delayMs:300})]);current={};[...timers.values()].find(t=>t.ms===300)!.fn();assert.equal(sent.length,2);assert.equal(timers.size,0,'entity replacement cancels pending presentation');
});
test('combat activation shares its proc with visuals and cancels queued playback on disable',async()=>{
    const played:any[]=[],hooks:any={},registrations=new Map(),core:any={HitDamage:class{onApplied(){}},CombatType:{MELEE:0},MeleeCombatMethod:class{},CombatSpecial:{getForWeaponId:()=>null,getById:()=>null,drain(){}},Animation:class{},ActorVisuals:{VERSION:1,play:(actor:any,clips:any[],valid:any)=>{let finish:any;const handle={actor,clips,valid,cancelled:false,cancel(){this.cancelled=true;finish();},finished:new Promise(r=>finish=r)};played.push(handle);return handle;}}};
    const api:any={core,onCombatHitDamage:(fn:any)=>hooks.damage=fn,onCombatHitResolved:(fn:any)=>hooks.resolved=fn,registerCombatSpecial:(d:any)=>registrations.set(d.id,d),unregisterCombatSpecial:()=>{}};
    const p=project(null,[{...newPassive(),chance:50,actions:[],visuals:[newVisual(398,{recipient:'both'})]}]),manifest=compileEffects(p);
    assert.throws(()=>checkEffectCapabilities({...api,core:{...core,ActorVisuals:null}},manifest),/ActorVisuals/);
    let random=.1;const life=registerEffects(api,manifest,{random:()=>random}),player:any={isPlayer:()=>true,getAsPlayer:()=>player,performAnimation(){},isSpecialActivated:()=>true,getCombatSpecial:()=>({getId:()=>manifest.owner+':special'}),getEquipment:()=>({get:(slot:number)=>({getId:()=>slot===3?60888:-1})})},target={};
    const activate=()=>{let applied:any;const hit={getHandleAfterHitEffects:()=>true,getHitDelays:()=>[0],isAccurate:()=>true,getHits:()=>[{onApplied:(fn:any)=>applied=fn}]},event={attacker:player,target,hit,combatType:0,accurate:true,damage:{getDamage:()=>20}};hooks.damage(event);hooks.resolved(event);assert.ok(applied);applied(20);};
    activate();assert.equal(played.length,2);assert.equal(played[0].actor,player);assert.equal(played[1].actor,target);assert.ok(played[0].valid());
    random=.9;activate();assert.equal(played.length,2,'failed chance must not play passive visuals');life.setEnabled(false);assert.ok(played.every(p=>p.cancelled));assert.equal(played[0].valid(),false);await Promise.resolve();life.dispose();
    const specialManifest=compileEffects(project({...newSpecial(),visuals:[newVisual(1209,{recipient:'both',phase:'launch'}),newVisual(398)]}));
    const specialLife=registerEffects(api,specialManifest);registrations.get(specialManifest.owner+':special').combatMethod.start(player,target);assert.equal(played.length,4,'launch clips play on both actors');activate();assert.equal(played.length,5,'impact clip plays once at actual hit application');assert.equal(played.at(-1).actor,target);specialLife.dispose();assert.ok(played.every(p=>p.cancelled));
});

test('complete reference catalog covers every native handler with real items, variants and shared helpers',()=>{
    const cache=new BuilderCache(root);try{
        const rows:any[]=[];for(let offset=0;offset<cache.specialDonors('').total;offset+=50)rows.push(...cache.specialDonors('',offset).rows);
        for(const file of fs.readdirSync(path.join(root,'server/plugins/combat/specials'))){
            const code=fs.readFileSync(path.join(root,'server/plugins/combat/specials',file),'utf8');
            if(!code.includes('registerCombatSpecial')||code.includes('const ITEM_IDS = []')||file==='PowerOfDeath.SpecialAttack.js')continue;
            assert.ok(rows.some(row=>row.source.endsWith('/'+file)),file+' must be discoverable');
        }
        for(const name of ['Staff of light','Staff of the dead','Toxic staff of the dead','Dragon pickaxe','Dragon harpoon','Soulreaper axe','Lithic sceptre','Abyssal dagger (bh)',"Zorya's tome"])assert.ok(rows.some(row=>row.name.toLowerCase()===name.toLowerCase()),name);
        assert.equal(rows.find(row=>row.name==='Abyssal dagger (bh)').energy,35);
        assert.equal(rows.find(row=>row.name==='Abyssal dagger').energy,25);
        assert.ok(cache.effectReferences('set').total>=59);
        for(const row of rows){const p=project(newNativeSpecial(row));assert.deepEqual(validateManifest(compileEffects(p)),compileEffects(p),row.name);}
    }finally{cache.close();}
});

test('staggered attacks share one activation and recover incrementally from actual health loss',()=>{
    const hooks:any={},core:any={HitDamage:class{onApplied(){}},CombatType:{MELEE:0},Skill:{HITPOINTS:0},CombatSpecial:{}},api:any={core,onCombatHitDamage:(fn:any)=>hooks.damage=fn,onCombatHitResolved:(fn:any)=>hooks.resolved=fn};
    let hp=10;const levels={getCurrentLevel:()=>hp,getMaxLevel:()=>99,setCurrentLevels:(_skill:any,value:number)=>hp=value},player:any={isPlayer:()=>true,getAsPlayer:()=>player,getHitpoints:()=>hp,getSkillManager:()=>levels,getEquipment:()=>({get:(slot:number)=>({getId:()=>slot===3?60888:-1})})},target={},applied:any[]=[];
    const life=registerEffects(api,compileEffects(project(null,[{...newPassive(),chance:100}]))),damages=[0,1].map(i=>({getDamage:()=>10,onApplied:(fn:any)=>applied[i]=fn})),hit={getHandleAfterHitEffects:()=>true,getHitDelays:()=>[0,1],getHits:()=>damages,isAccurate:()=>true};
    for(const damage of damages)hooks.damage({attacker:player,target,hit,damage,accurate:true,combatType:0});hooks.resolved({attacker:player,target,hit});applied[0](4);assert.equal(hp,14,'recovery is retained even if later hits are cancelled');applied[1](2);assert.equal(hp,16,'heal from actual total loss exactly once');life.dispose();
});

test('one-click ideas create valid playable effects and naturally named VFX can be found',async()=>{
    const {ATTACK_IDEAS,SET_IDEAS}=await import('../public/effect-ideas.mjs');
    for(const idea of ATTACK_IDEAS)if(idea.make){const p=project(idea.make());assert.deepEqual(validateManifest(compileEffects(p)),compileEffects(p));assert.ok(p.effects.special.visuals.length);}
    for(const idea of SET_IDEAS){const p=project(null,[idea.make()]);assert.deepEqual(validateManifest(compileEffects(p)),compileEffects(p));assert.ok(p.effects.passives[0].visuals.length);}
    const cache=new BuilderCache(root);try{assert.ok(cache.search('effect','Armadyl godsword').rows.some(row=>row.id===1211));assert.ok(cache.search('effect','Guthan').rows.some(row=>row.id===398));}finally{cache.close();}
});

test('damage-triggered recovery recognizes real damage from a native failed accuracy branch',()=>{
    const hooks:any={},core:any={HitDamage:class{onApplied(){}},CombatType:{MELEE:0},Skill:{HITPOINTS:0},CombatSpecial:{}},api:any={core,onCombatHitDamage:(fn:any)=>hooks.damage=fn,onCombatHitResolved:(fn:any)=>hooks.resolved=fn};let hp=10,applied:any;
    const player:any={isPlayer:()=>true,getAsPlayer:()=>player,getHitpoints:()=>hp,getSkillManager:()=>({getCurrentLevel:()=>hp,getMaxLevel:()=>99,setCurrentLevels:(_s:any,value:number)=>hp=value}),getEquipment:()=>({get:(slot:number)=>({getId:()=>slot===3?60888:-1})})},target={},damage={getDamage:()=>0,onApplied:(fn:any)=>applied=fn},hit={getHandleAfterHitEffects:()=>true,getHitDelays:()=>[0],getHits:()=>[damage],isAccurate:()=>false};
    const life=registerEffects(api,compileEffects(project(null,[{...newPassive(),chance:100}])));hooks.damage({attacker:player,target,hit,damage,accurate:false,combatType:0});hooks.resolved({attacker:player,target,hit});applied(2);assert.equal(hp,12,'actual damage is the trigger, rather than the accuracy flag');life.dispose();
});

test('VFX hue shifts and slow playback retain exact colours and portable timing',()=>{
    const red=[220,20,20],before=[...red];assert.deepEqual(shiftHueRgb(red,120),[20,220,20]);assert.deepEqual(red,before);assert.deepEqual(shiftHueRgb([180,180,180],120),[180,180,180]);
    const clip=newVisual(398,{hueShift:120,speed:.25}),manifest=compileEffects(project({...newSpecial(),visuals:[clip]}));assert.deepEqual(validateManifest(manifest),manifest);assert.ok(manifest.requires.includes('actor-visual-colour/1'));assert.equal(visualDuration(clip,2000),8000);assert.equal(visualDuration({...clip,delayMs:1000},60000),119000);
    for(const hueShift of [NaN,181,-181,'red'])assert.throws(()=>validateVisuals([{...clip,hueShift}]));
    assert.throws(()=>validateVisuals([{...newVisual(422,{kind:'animation',recipient:'player'}),hueShift:1}]));
});
