import {effectRuntimeSource} from '../export.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EFFECT_ANIMATIONS, EFFECT_PRESETS, compileEffects, effectPreset, newEffects, newPassive, newSpecial, previewPassive, previewSpecial, validateEffects } from '../shared/effects.mjs';
import { BuilderCache } from '../cache';
import {compileProject} from '../export.mjs';
import {newProject,makePart} from '../shared/project.mjs';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(import.meta.url);
const {registerEffects,validateManifest}=require('../runtime.effects.cjs');
const project=(config:any=newEffects(),id='effects-test',itemId=60888)=>({id,kind:'gear',ids:{definition:itemId},settings:{equipmentType:'WEAPON',specialFrom:-1},effects:config});
function passive(config:any={}) {return {...newPassive(),chance:100,...config};}
function manifest(passives:any[]=[],special:any=null,id='effects-test',itemId=60888) {return compileEffects(project({version:1,special,passives},id,itemId));}

test('authored references cover native roll patterns beyond the original nine examples',()=>{
    assert.ok(EFFECT_PRESETS.length>=20,'provide a broad named reference collection');
    assert.equal(effectPreset('abyssal-dagger').sharedAccuracy,true);
    assert.equal(effectPreset('fang').minimumDamageMultiplier,.15);
    assert.equal(effectPreset('vesta').defenceRollMultiplier,.25);
    assert.equal(effectPreset('elder-maul').actions[0].trigger,'accurate');
});

test('effect schema validates real presets, preserves input and resolves self on reassignment',()=>{
    assert.equal(compileEffects(project()),null);
    for(const preset of EFFECT_PRESETS) {
        const p=project({version:1,special:preset.kind==='special'?effectPreset(preset.id):null,passives:preset.kind==='special'?[]:[effectPreset(preset.id)]});
        const original=JSON.stringify(p),compiled=compileEffects(p);assert.deepEqual(validateManifest(compiled),compiled);assert.equal(JSON.stringify(p),original);
    }
    const rule=passive({set:{required:1,pieces:[{slot:3,itemIds:['self',1215]}]}}),p=project({version:1,special:null,passives:[rule]});
    assert.deepEqual(compileEffects(p).config.passives[0].set.pieces[0].itemIds,[60888,1215]);p.ids.definition=60889;assert.deepEqual(compileEffects(p).config.passives[0].set.pieces[0].itemIds,[60889,1215]);
    assert.equal(p.effects.passives[0].set.pieces[0].itemIds[0],'self');
    assert.throws(()=>compileEffects({...p,kind:'npc'}),/only.*gear/);
    assert.throws(()=>compileEffects({...p,effects:{version:1,special:newSpecial(),passives:[]},settings:{specialFrom:1215,equipmentType:'WEAPON'}}),/original.*borrowed/);
    assert.throws(()=>compileEffects({...p,effects:{version:1,special:newSpecial(),passives:[]},settings:{specialFrom:-1,equipmentType:'SHIELD'}}),/Weapon/);
});
test('unsafe data, invalid hit timing and duplicate set slots fail closed',()=>{
    const invalids=[
        {...newEffects(),execute:'bad'}, {...newEffects(),version:2},
        {...newEffects(),special:{...newSpecial(),hitCount:5}},
        {...newEffects(),special:{...newSpecial(),animation:-1}},
        {...newEffects(),special:{...newSpecial(),hitDelayTicks:[1,0]}},
        {...newEffects(),special:{...newSpecial(),hitDelayTicks:[0,9],actions:[{type:'freeze',ticks:8}]}},
        {...newEffects(),special:{...newSpecial(),hitDelayTicks:[0,-1]},passives:[passive()]},
        {...newEffects(),special:{...newSpecial(),damageMultiplier:Infinity}},
        {...newEffects(),special:{...newSpecial(),sharedAccuracy:'yes'}},
        {...newEffects(),special:{...newSpecial(),minimumDamageMultiplier:2,maximumDamageMultiplier:1}},
        {...newEffects(),special:{...newSpecial(),attackSpeedTicks:0}},
        {...newEffects(),special:{...newSpecial(),actions:[{type:'poison',damage:21}]}},
        {...newEffects(),passives:[passive({actions:[{type:'freeze',ticks:8,phase:'launch'}]})]},
        {...newEffects(),passives:[passive({actions:[{type:'drain-levels',skill:'hitpoints',percent:50,basis:'current'}]})]},
        {...newEffects(),passives:[passive({actions:[{type:'drain-stats',order:['defence','defence']}]})]},
        {...newEffects(),passives:[passive({bonusDamage:8,trigger:'damage'})]},
        {...newEffects(),passives:[passive({actions:[{type:'freeze',ticks:33}]})]},
        {...newEffects(),passives:[passive({chance:NaN})]},
        {...newEffects(),passives:[passive({set:{required:2,pieces:[{slot:3,itemIds:[1215]},{slot:3,itemIds:[4587]}]}})]},
        {...newEffects(),passives:[passive({set:{required:2,pieces:[{slot:3,itemIds:['self']}]}})]},
        {...newEffects(),passives:[passive({set:{required:1,pieces:[{slot:3,itemIds:[65023]}]}})]},
        {...newEffects(),passives:[passive(),passive()]},
        {...newEffects(),passives:Array.from({length:9},(_,i)=>passive({id:`effect-${i}`}))},
    ];
    for(const config of invalids)assert.throws(()=>validateEffects(config));
    const compiled=manifest([passive()]);compiled.config.passives[0].chance=500;assert.throws(()=>validateManifest(compiled),/trigger/);
    const stages=manifest([],effectPreset('armadyl'));stages.config.special.damageStages=[10];assert.throws(()=>validateManifest(stages),/stages/);
});
test('damage preview matches staged rounding and uses native attack-versus-defence probability',()=>{
    const s=effectPreset('dagger'),r=previewSpecial(s,{maxHit:31,attackRoll:10000,defenceRoll:10000});
    assert.equal(r.maximumPerHit,35);assert.equal(r.maximumTotal,70);assert.equal(r.energyUses,4);assert.ok(r.accuracy>.5&&r.accuracy<.6);assert.equal(r.hits.length,2);
    assert.equal(previewSpecial(effectPreset('armadyl'),{maxHit:32}).maximumPerHit,43,'floor 32*1.1 then floor *1.25, rather than combining the multipliers');
    assert.throws(()=>previewSpecial(s,{maxHit:-1}),/maximum/);
    const blood=previewPassive(effectPreset('sanguinesti'),{rolledDamage:10,targetHp:100});assert.equal(blood.dealt,18);assert.equal(blood.extraDamage,8);assert.equal(blood.heal,9);assert.equal(blood.chance,.2);
    const capped=previewPassive(effectPreset('sanguinesti'),{rolledDamage:10,targetHp:3});assert.equal(capped.dealt,3);assert.equal(capped.extraDamage,0);assert.equal(capped.heal,1);
    assert.equal(previewPassive(effectPreset('guthans'),{rolledDamage:0}).chance,0);
    const fang=previewSpecial(effectPreset('fang'),{maxHit:40});assert.equal(fang.minimumPerHit,6);assert.equal(fang.maximumPerHit,40);
    assert.ok(previewSpecial(effectPreset('vesta')).accuracy>previewSpecial({...effectPreset('vesta'),defenceRollMultiplier:1}).accuracy);
    const magicDrain=previewPassive(passive({actions:[{type:'drain-levels',skill:'magic',basis:'current',percent:50}]}),{enemyLevels:{magic:40},enemyDefence:100});assert.equal(magicDrain.statDrain,20,'chosen-stat preview uses that stat rather than Defence');
});
test('named animations, set items and graphics exist in the active native cache',()=>{
    const cache=new BuilderCache(root);
    try {
        for(const [id] of EFFECT_ANIMATIONS)assert.equal(cache.search('seq',String(id)).rows[0]?.id,id,`native animation ${id}`);
        for(const id of [4724,4726,4728,4730])assert.ok(cache.search('item',String(id),0,{references:true}).rows[0]?.name.toLowerCase().includes('guthan'));
        for(const id of [1292,1209,1210,1211,1212])assert.equal(cache.search('effect',String(id)).rows[0]?.id,id);
    } finally {cache.close();}
});
test('animation name search finds canonical special and character sources without known IDs',()=>{
    const cache=new BuilderCache(root);
    try {
        for(const [query,id] of [['Dragon longsword',1058],['Dragon dagger',1062],['Granite maul',1667],['Ancient godsword',9171],['Staff of light',7967],['Sanguinesti staff',1167]] as const)
            assert.ok(cache.search('seq',query).rows.some(row=>row.id===id),`${query} has a named animation`);
        assert.ok(cache.search('seq','goblin').total>0,'character animation sources are searchable');
    } finally {cache.close();}
});
test('every named reference compiles through the real plugin export with its effect schema intact',()=>{
    const cache=new BuilderCache(root);
    try {
        const source=cache.describe('item',4587,'inventory'),worn=['male','female'].map(variant=>makePart(cache.describe('item',4587,variant),variant));
        for(const preset of EFFECT_PRESETS){
            const p=newProject('reference-export','gear',source,{definition:60888,modelBase:1100010},cache.info.name),value=effectPreset(preset.id);
            p.parts.push(...structuredClone(worn));
            p.settings.equipmentType='WEAPON';p.effects={version:1,special:preset.kind==='special'?value:null,passives:preset.kind==='special'?[]:[value]};
            const compiled=compileProject(p,cache);
            assert.equal(compiled.manifest.category,'@ Ghost Plugins @');assert.deepEqual(validateManifest(compiled.content.effects),compileEffects(p));
            assert.match(compiled.code,/checkEffectCapabilities/);assert.match(compiled.code,/registerEffects/);
        }
    } finally {cache.close();}
});

// Real native PendingHit, HitDamage, CombatSpecial and melee method. Only randomness
// and final damage-roll inputs are controlled, with no World, saves or services.
test('portable effects use real native hit rolls, impact hooks and isolated registrations',async()=>{
    const previous=process.cwd();process.chdir(path.join(root,'server'));
    try {
    const {PendingHit}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/PendingHit');
    const {CombatSpecial}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatSpecial');
    const {CombatFactory}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatFactory');
    const {CombatType}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatType');
    const {MeleeCombatMethod}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/method/impl/MeleeCombatMethod');
    const {RangedCombatMethod}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/method/impl/RangedCombatMethod');
    const {WeaponProfiles}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/WeaponProfile');
    const {AccuracyFormulasDpsCalc}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc');
    const {HitDamage}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitDamage');
    const {HitMask}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitMask');
    const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager');
    const {Skill}=await import('../../../server/src/main/typescript/elvarg/game/model/Skill');
    const {Animation}=await import('../../../server/src/main/typescript/elvarg/game/model/Animation');
    const {Graphic}=await import('../../../server/src/main/typescript/elvarg/game/model/Graphic');
    const original={roll:AccuracyFormulasDpsCalc.rollAccuracyCount,ordinary:AccuracyFormulasDpsCalc.rollAccuracy,damage:CombatFactory.getHitDamage,damageHook:PluginManager.emitCombatHitDamage,prepare:PluginManager.emitCombatHitPrepare,rollHook:PluginManager.emitCombatHitRoll,drain:CombatSpecial.drain,freeze:CombatFactory.freeze,poison:CombatFactory.poisonEntity};
    const snapshot={registry:[...(CombatSpecial as any).registry],byId:new Map((CombatSpecial as any).byId),byItemId:new Map((CombatSpecial as any).byItemId)};
    const damages:number[]=[],outcomes:boolean[]=[],damageHooks:any[]=[],resolvedHooks:any[]=[],shutdown:any[]=[],freezes:any[]=[],poisons:any[]=[],bounds:any[]=[];
    let drains:number[]=[],rolls=0;
    const core:any={PendingHit,CombatSpecial,CombatFactory,CombatType,MeleeCombatMethod,RangedCombatMethod,WeaponProfiles,HitDamage,HitMask,Skill,Animation,Graphic};
    const ownerApi=PluginManager.createApi('CreatorEffectsNativeTest');
    const unregister=(id:string)=>ownerApi.unregisterCombatSpecial(id);
    const api:any={core,registerCombatSpecial:(d:any)=>ownerApi.registerCombatSpecial(d),unregisterCombatSpecial:unregister,onCombatHitDamage:(fn:any)=>damageHooks.push(fn),onCombatHitResolved:(fn:any)=>resolvedHooks.push(fn),onServerShutdown:(fn:any)=>shutdown.push(fn)};
    const levels=(hp=20)=>{
        const values=new Map([[Skill.HITPOINTS,hp],[Skill.PRAYER,0],[Skill.DEFENCE,100],[Skill.STRENGTH,100],[Skill.ATTACK,100],[Skill.MAGIC,100],[Skill.RANGED,100]]);
        return {values,getCurrentLevel:(s:any)=>values.get(s)??0,getMaxLevel:()=>99,setCurrentLevels:(s:any,n:number)=>values.set(s,n)};
    };
    const player=(itemId=60888)=>{
        const skills=levels(),equipment=new Map([[3,itemId]]);
        const p:any={skills,equipment,active:true,isPlayer:()=>true,isNpc:()=>false,getAsPlayer:()=>p,getSkillManager:()=>skills,getHitpoints:()=>skills.getCurrentLevel(Skill.HITPOINTS),getEquipment:()=>({get:(slot:number)=>({getId:()=>equipment.get(slot)??-1})}),isSpecialActivated:()=>p.active,getCombatSpecial:()=>CombatSpecial.getForWeaponId(equipment.get(3)),performAnimation:(a:any)=>p.animation=a.getId(),performGraphic:(g:any)=>p.graphic=g.getId()};return p;
    };
    const npc=(hp=200)=>{const manager=levels(hp),n:any={isPlayer:()=>false,isNpc:()=>true,getAsNpc:()=>n,getHitpoints:()=>manager.getCurrentLevel(Skill.HITPOINTS),getCurrentLevel:manager.getCurrentLevel,setCurrentLevels:manager.setCurrentLevels};return n;};
    const resolve=(attacker:any,target:any,hit:any)=>{for(const fn of resolvedHooks)fn({attacker,target,hit});for(const damage of hit.getHits())damage.notifyApplied(damage.getDamage());};
    const withInput=(damage:number[],accuracy:boolean[])=>{damages.splice(0,damages.length,...damage);outcomes.splice(0,outcomes.length,...accuracy);};
    try {
        (AccuracyFormulasDpsCalc as any).rollAccuracyCount=()=>{rolls++;return (outcomes.shift()??true)?1:0;};
        (AccuracyFormulasDpsCalc as any).rollAccuracy=()=>{rolls++;return outcomes.shift()??true;};
        (CombatFactory as any).getHitDamage=(...args:any[])=>{bounds.push(args[4]);return new HitDamage(damages.shift()??20,HitMask.RED);};
        PluginManager.emitCombatHitDamage=(event:any)=>damageHooks.forEach(fn=>fn(event));PluginManager.emitCombatHitPrepare=()=>{};PluginManager.emitCombatHitRoll=()=>{};
        CombatSpecial.drain=(_a:any,amount:number)=>{drains.push(amount);};CombatFactory.freeze=(...args:any[])=>{freezes.push(args);};CombatFactory.poisonEntity=(...args:any[])=>{poisons.push(args);};
        const dagger=registerEffects(api,manifest([],effectPreset('dagger'))),attacker=player(),target=npc(100);
        const registered=CombatSpecial.getForWeaponId(60888)!;assert.equal(registered.getTraits()!.hitCount,2);
        const method=registered.getCombatMethod();method.start(attacker,target);assert.deepEqual(drains,[25]);assert.equal(attacker.animation,1062);
        withInput([24],[false,true]);rolls=0;const [hit]=method.hits(attacker,target);assert.equal(rolls,2,'each dagger splat has an independent native accuracy roll');assert.equal(hit.getTotalDamage(),24);assert.equal(hit.getHits().length,2);assert.deepEqual(hit.getHitDelays(),[0,0]);
        dagger.setEnabled(false);assert.equal(CombatSpecial.getForWeaponId(60888),null);assert.deepEqual(method.hits(attacker,target),[]);dagger.setEnabled(true);assert.ok(CombatSpecial.getForWeaponId(60888));dagger.dispose();assert.equal(CombatSpecial.getForWeaponId(60888),null);
        const abyssal=registerEffects(api,manifest([],effectPreset('abyssal-dagger')));
        withInput([12,13],[true,false]);rolls=0;const [puncture]=CombatSpecial.getForWeaponId(60888)!.getCombatMethod().hits(attacker,target);assert.equal(rolls,1);assert.equal(puncture.getTotalDamage(),25,'shared accuracy retains independent damage rolls');abyssal.dispose();
        const feint=registerEffects(api,manifest([],effectPreset('vesta')));withInput([20],[true]);
        CombatSpecial.getForWeaponId(60888)!.getCombatMethod().hits(attacker,target);assert.equal(bounds.at(-1).minimumMultiplier,.2);assert.equal(bounds.at(-1).maximumMultiplier,1.2);assert.equal(CombatSpecial.getForWeaponId(60888)!.getTraits()!.defenceRollMultiplier,.25);feint.dispose();
        assert.throws(()=>registerEffects({...api,unregisterCombatSpecial:undefined},manifest([],effectPreset('dagger'))),/unregister/);
        const recovery=registerEffects(api,manifest([],effectPreset('saradomin'))),sgs=CombatSpecial.getForWeaponId(60888)!.getCombatMethod();
        withInput([60],[true]);const [overkill]=sgs.hits(attacker,npc(5));assert.equal(overkill.getTotalDamage(),5);resolve(attacker,overkill.getTarget(),overkill);assert.equal(attacker.getHitpoints(),50,'heals 30 from potential 60 despite target HP cap');assert.equal(attacker.skills.getCurrentLevel(Skill.PRAYER),15);
        resolve(attacker,overkill.getTarget(),overkill);assert.equal(attacker.getHitpoints(),50,'same hit cannot proc twice');recovery.dispose();
        const hammer=registerEffects(api,manifest([],effectPreset('warhammer'))),dwh=CombatSpecial.getForWeaponId(60888)!.getCombatMethod(),armoured=npc();
        withInput([0],[true]);let [smash]=dwh.hits(attacker,armoured);resolve(attacker,armoured,smash);assert.equal(armoured.getCurrentLevel(Skill.DEFENCE),100,'accurate zero does not drain');
        withInput([20],[true]);[smash]=dwh.hits(attacker,armoured);resolve(attacker,armoured,smash);assert.equal(armoured.getCurrentLevel(Skill.DEFENCE),70);hammer.dispose();
        const maul=registerEffects(api,manifest([],effectPreset('elder-maul'))),maulMethod=CombatSpecial.getForWeaponId(60888)!.getCombatMethod(),maulTarget=npc();
        assert.equal(maulMethod.attackSpeed(attacker),7);withInput([0],[true]);const [pulverize]=maulMethod.hits(attacker,maulTarget);resolve(attacker,maulTarget,pulverize);assert.equal(maulTarget.getCurrentLevel(Skill.DEFENCE),65);maul.dispose();
        let poisonRoll=.5;const binding=registerEffects(api,manifest([],effectPreset('tentacle')),{random:()=>poisonRoll}),lash=CombatSpecial.getForWeaponId(60888)!.getCombatMethod(),beforeBind=freezes.length;
        lash.start(attacker,target);assert.equal(freezes.length,beforeBind+1);assert.equal(freezes.at(-1)[1],4.8);assert.equal(poisons.length,0,'individual poison chance excludes the upper boundary');
        withInput([],[false]);const [missedLash]=lash.hits(attacker,target);resolve(attacker,target,missedLash);assert.equal(freezes.length,beforeBind+1,'launch bind is not repeated at impact');
        poisonRoll=.499999;lash.start(attacker,target);assert.deepEqual(poisons.at(-1),[target,20,1],'uses native poison potency and immunity handler');binding.dispose();
        const freeze=registerEffects(api,manifest([],effectPreset('zamorak'))),zgs=CombatSpecial.getForWeaponId(60888)!.getCombatMethod();
        withInput([0],[true]);const [ice]=zgs.hits(attacker,target);resolve(attacker,target,ice);assert.equal(freezes.at(-1)[1],19.2,'freeze calls the native immunity-aware method even on an accurate zero');freeze.dispose();
        const bandos=registerEffects(api,manifest([],effectPreset('bandos'))),bgs=CombatSpecial.getForWeaponId(60888)!.getCombatMethod(),weak=npc();weak.setCurrentLevels(Skill.DEFENCE,10);
        withInput([30],[true]);const [drain]=bgs.hits(attacker,weak);resolve(attacker,weak,drain);assert.equal(weak.getCurrentLevel(Skill.DEFENCE),0);assert.equal(weak.getCurrentLevel(Skill.STRENGTH),80);bandos.dispose();
        const floor=registerEffects(api,manifest([],effectPreset('bandos'))),floorTarget=npc();floorTarget.setCurrentLevels(Skill.DEFENCE,10);
        const setLevel=floorTarget.setCurrentLevels;floorTarget.setCurrentLevels=(skill:any,n:number)=>setLevel(skill,skill===Skill.DEFENCE?Math.max(5,n):n);
        withInput([30],[true]);const [floored]=CombatSpecial.getForWeaponId(60888)!.getCombatMethod().hits(attacker,floorTarget);resolve(attacker,floorTarget,floored);assert.equal(floorTarget.getCurrentLevel(Skill.DEFENCE),5);assert.equal(floorTarget.getCurrentLevel(Skill.STRENGTH),100,'native encounter floors stop the stat-drain spill');floor.dispose();
        const set=effectPreset('guthans');set.set.pieces[1].itemIds=['self'];set.chance=100;
        const guthans=registerEffects(api,manifest([set]));attacker.active=false;attacker.skills.setCurrentLevels(Skill.HITPOINTS,20);
        attacker.equipment.set(0,4724);attacker.equipment.set(4,4728);attacker.equipment.set(7,4730);
        withInput([20],[true]);const full=new PendingHit(attacker,target,new MeleeCombatMethod());attacker.equipment.delete(0);resolve(attacker,target,full);assert.equal(attacker.getHitpoints(),40,'set membership is captured at the attack, survives unequipping before impact');
        withInput([20],[true]);const incomplete=new PendingHit(attacker,target,new MeleeCombatMethod());attacker.equipment.set(0,4724);resolve(attacker,target,incomplete);assert.equal(attacker.getHitpoints(),40,'equipping after launch does not enable an earlier hit');
        withInput([20],[true]);const secondary=new PendingHit(attacker,target,new MeleeCombatMethod(),{handleAfterHitEffects:false});resolve(attacker,target,secondary);assert.equal(attacker.getHitpoints(),40,'secondary attacks with effects disabled do not proc');guthans.dispose();
        const before=damageHooks.length;assert.throws(()=>registerEffects({...api,core:{...core,PendingHit:{}}},manifest([effectPreset('sanguinesti')])),/ROLL_CONTEXT_VERSION/);assert.equal(damageHooks.length,before,'missing capability fails before attaching hooks');
        const readyApi=api;
        const suppressed=new PendingHit(attacker,target,new MeleeCombatMethod(),{handleAfterHitEffects:false});
        const leech=effectPreset('sanguinesti');leech.chance=100;leech.style='any';
        const life=registerEffects(readyApi,manifest([leech]));attacker.skills.setCurrentLevels(Skill.HITPOINTS,20);
        withInput([10],[true]);const blood=new PendingHit(attacker,target,new MeleeCombatMethod());assert.equal(blood.getHits().length,1);assert.equal(blood.getTotalDamage(),18,'adds eight to the existing native hit before its HP cap');
        assert.equal(attacker.getHitpoints(),20,'healing waits for impact');resolve(attacker,target,blood);assert.equal(attacker.getHitpoints(),29);
        withInput([30],[true]);const capped=new PendingHit(attacker,npc(3),new MeleeCombatMethod());assert.equal(capped.getTotalDamage(),3,'the normal target HP cap still applies to added damage');resolve(attacker,capped.getTarget(),capped);assert.equal(attacker.getHitpoints(),30,'dealt-damage healing uses the capped result');
        withInput([10,10],[true,true]);const multiple=new PendingHit(attacker,target,new MeleeCombatMethod(),{hitAmount:2});assert.equal(multiple.getTotalDamage(),28,'a passive adds damage once per attack, not once to every splat');
        const ignored=new HitDamage(10,HitMask.RED);for(const hook of damageHooks)hook({attacker,target,combatType:CombatType.MELEE,hit:suppressed,damage:ignored,accurate:true});assert.equal(ignored.getDamage(),10,'an explicitly suppressed hit cannot gain proc damage');
        attacker.skills.setCurrentLevels(Skill.HITPOINTS,20);withInput([30],[true]);const reducedAtImpact=new PendingHit(attacker,target,new MeleeCombatMethod());
        for(const fn of resolvedHooks)fn({attacker,target,hit:reducedAtImpact});
        assert.equal(attacker.getHitpoints(),20,'resolving queues damage but must not heal before health is lost');
        reducedAtImpact.getHits()[0].notifyApplied(2);
        assert.equal(attacker.getHitpoints(),21,'healing uses health actually lost after earlier same-cycle damage');
        withInput([20],[true]);const stoppedAfterResolve=new PendingHit(attacker,target,new MeleeCombatMethod());for(const fn of resolvedHooks)fn({attacker,target,hit:stoppedAfterResolve});
        life.setEnabled(false);life.setEnabled(true);stoppedAfterResolve.getHits()[0].notifyApplied(20);assert.equal(attacker.getHitpoints(),21,'disable/re-enable cancels callbacks already attached to native damage');
        life.dispose();
        const weaken=registerEffects(api,manifest([passive({actions:[{type:'drain-levels',skill:'magic',percent:50,basis:'dealt'}]})]));
        withInput([30],[true]);const statHit=new PendingHit(attacker,target,new MeleeCombatMethod());resolve(attacker,target,statHit);assert.equal(target.getCurrentLevel(Skill.MAGIC),85);weaken.dispose();
        let chanceRoll=.249999;
        const odds=registerEffects(api,manifest([passive({chance:25})]),{random:()=>chanceRoll});
        attacker.skills.setCurrentLevels(Skill.HITPOINTS,20);withInput([10],[true]);const success=new PendingHit(attacker,target,new MeleeCombatMethod());resolve(attacker,target,success);assert.equal(attacker.getHitpoints(),30);
        chanceRoll=.25;withInput([10],[true]);const failure=new PendingHit(attacker,target,new MeleeCombatMethod());resolve(attacker,target,failure);assert.equal(attacker.getHitpoints(),30,'the exact upper chance boundary does not proc');
        chanceRoll=0;withInput([10,10],[true,true]);const staggered=new PendingHit(attacker,target,new MeleeCombatMethod(),{hitAmount:2,hitDelays:[0,2]});for(const fn of resolvedHooks)fn({attacker,target,hit:staggered});staggered.getHits()[0].notifyApplied(10);assert.equal(attacker.getHitpoints(),40,'only the first landed hit contributes recovery');staggered.getHits()[1].notifyApplied(10);assert.equal(attacker.getHitpoints(),50,'staggered recovery uses the actual health lost across all hits');odds.dispose();
        const other=registerEffects(api,manifest([passive() ],null,'other',60890));attacker.equipment.set(12,60890);
        const own=registerEffects(api,manifest([passive()]));
        withInput([10],[true]);const inFlight=new PendingHit(attacker,target,new MeleeCombatMethod());own.setEnabled(false);attacker.skills.setCurrentLevels(Skill.HITPOINTS,20);resolve(attacker,target,inFlight);assert.equal(attacker.getHitpoints(),30,'disabling one package cancels its pending effects and preserves another package');own.dispose();other.dispose();
        const first=registerEffects(api,manifest([],newSpecial(),'first',60889));
        assert.throws(()=>registerEffects(api,manifest([],newSpecial(),'second',60889)),/another special/);first.dispose();
        // Preserve the real native ranged method. Spies isolate launch inputs
        // while proving that the helper delegates payment/flight to that method.
        const rangedOriginal={start:RangedCombatMethod.prototype.start,canAttack:RangedCombatMethod.prototype.canAttack,landing:RangedCombatMethod.landingDelays,ranged:WeaponProfiles.ranged,checkAmmo:CombatFactory.checkAmmo,decrementAmmo:CombatFactory.decrementAmmo};
        try {
            let launch=0,hasAmmo=true,profile={projectiles:[{}]};const payments:any[]=[];
            RangedCombatMethod.prototype.start=()=>{launch++;};RangedCombatMethod.landingDelays=()=>[3];WeaponProfiles.ranged=()=>profile as any;
            CombatFactory.checkAmmo=()=>hasAmmo;CombatFactory.decrementAmmo=(...args:any[])=>{payments.push(args);};
            const ranged=registerEffects(api,manifest([],effectPreset('blowpipe'))),bow=CombatSpecial.getForWeaponId(60888)!.getCombatMethod();attacker.active=true;
            assert.ok(bow instanceof RangedCombatMethod);assert.equal(bow.canAttack(attacker,target),true);hasAmmo=false;assert.equal(bow.canAttack(attacker,target),false,'native ammo eligibility remains mandatory');hasAmmo=true;bow.start(attacker,target);assert.equal(launch,1,'uses native ranged launch path');assert.equal(attacker.animation,876);
            withInput([20],[true]);const [shot]=bow.hits(attacker,target);assert.equal(shot.getCombatType(),CombatType.RANGED);assert.equal(shot.getDelay(),3);
            (RangedCombatMethod as any).pendingShots.set(attacker,{pos:'launch-location',amount:1,flightTicks:3});bow.finished(attacker,target);bow.finished(attacker,target);
            assert.deepEqual(payments,[[attacker,'launch-location',1,3]],'inherited native completion pays a launched shot exactly once');
            profile={projectiles:[{},{}]};assert.equal(bow.canAttack(attacker,target),false);assert.deepEqual(bow.hits(attacker,target),[],'multi-projectile profiles cannot multiply the configured hit count');ranged.dispose();
        } finally {RangedCombatMethod.prototype.start=rangedOriginal.start;RangedCombatMethod.prototype.canAttack=rangedOriginal.canAttack;RangedCombatMethod.landingDelays=rangedOriginal.landing;WeaponProfiles.ranged=rangedOriginal.ranged;CombatFactory.checkAmmo=rangedOriginal.checkAmmo;CombatFactory.decrementAmmo=rangedOriginal.decrementAmmo;(RangedCombatMethod as any).pendingShots.delete(attacker);}
    } finally {
        for(const stop of shutdown)stop();
        AccuracyFormulasDpsCalc.rollAccuracyCount=original.roll;AccuracyFormulasDpsCalc.rollAccuracy=original.ordinary;CombatFactory.getHitDamage=original.damage;PluginManager.emitCombatHitDamage=original.damageHook;PluginManager.emitCombatHitPrepare=original.prepare;PluginManager.emitCombatHitRoll=original.rollHook;CombatSpecial.drain=original.drain;CombatFactory.freeze=original.freeze;CombatFactory.poisonEntity=original.poison;
        Object.assign(CombatSpecial as any,snapshot);
    }
    } finally {process.chdir(previous);}
});

test('helper embeds in a standalone plugin without requiring a development checkout',()=>{
    const code=effectRuntimeSource(),module={exports:{} as any};
    vm.runInNewContext(`(function(module){${code}\n})(module)`,{module});
    assert.equal(typeof module.exports.registerEffects,'function');assert.ok(!code.includes('require('));
    assert.deepEqual(JSON.parse(JSON.stringify(module.exports.validateManifest(manifest([passive()])))),manifest([passive()]));
    const recipe={...newSpecial(),recipe:true,ruleFeatures:[{id:'rule-1',type:'guaranteedHit',value:true},{id:'rule-2',type:'hitDelayTicks',value:[0]}],extraFeatures:[]},portable=manifest([],recipe),validated=module.exports.validateManifest(portable);assert.deepEqual(JSON.parse(JSON.stringify(validated)),portable,'modular recipes also run without Node globals or a source tree');
    validated.config.special.ruleFeatures[1].value[0]=3;assert.equal(portable.config.special.ruleFeatures[1].value[0],0,'portable validation copies nested recipe values without changing the input');
});
