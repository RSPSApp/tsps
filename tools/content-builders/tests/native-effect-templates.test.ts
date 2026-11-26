import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compileEffects,newNativeSpecial,newEffects,newSpecial} from '../shared/effects.mjs';
import {resolveMechanics,mechanicPreview,attackFeaturePreview} from '../shared/native-mechanics.mjs';
import {newVisual} from '../shared/visuals.mjs';
import {BuilderCache} from '../cache';
const root=path.resolve(import.meta.dirname,'../../..'),require=createRequire(import.meta.url),{registerEffects}=require('../runtime.effects.cjs');

test('native references expose delayed mechanics with editable values instead of hiding them behind the template',()=>{
    const cache=new BuilderCache(root);
    try{
        const reference=cache.specialDonors('Ancient godsword').rows.find(row=>row.name==='Ancient godsword');
        const sacrifice=reference.mechanics?.find(row=>row.id==='blood-sacrifice');
        assert.ok(sacrifice,'the follow-up damage, timing, escape and healing must be visible to the shared editor');
        const values=Object.fromEntries(sacrifice.parameters.map(row=>[row.key,row.value]));
        assert.deepEqual(values,{enabled:true,damage:25,delayTicks:8,escapeDistance:5,healPercent:15,npcHealCap:25,playerHealCap:15,graphic:377});
    }finally{cache.close();}
});

test('feature parameters are portable, bounded and independent of the weapon used as a base',()=>{
    const cache=new BuilderCache(root);try{
        const reference=cache.specialDonors('Ancient godsword').rows.find(row=>row.name==='Ancient godsword'),special=newSpecial();
        special.nativeFeatures=[{id:'feature-1',source:reference.id,mechanic:'blood-sacrifice',values:{damage:37,delayTicks:4}}];
        const project={id:'modular-test',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}},manifest=compileEffects(project);
        assert.equal(manifest.config.special.nativeFrom,undefined,'the feature does not replace the base attack');
        assert.ok(manifest.requires.includes('native-special-features/1'));
        const preview=mechanicPreview(reference.mechanics,{'blood-sacrifice':special.nativeFeatures[0].values});assert.equal(preview[0].damage,37);assert.equal(preview[0].delayMs,2400);
        assert.throws(()=>resolveMechanics(reference.mechanics,{'blood-sacrifice':{damage:1001}}),/invalid/);
        assert.throws(()=>resolveMechanics(reference.mechanics,{'blood-sacrifice':{unknown:1}}),/not support/);
        const other=[{id:'unrelated-feature',name:'Another feature',parameters:[{key:'amount',type:'number',value:8,min:0,max:20,step:1}]}];assert.equal(resolveMechanics(other,{'unrelated-feature':{amount:12}})['unrelated-feature'].amount,12,'no weapon or mechanic IDs are hardcoded in the shared contract');
    }finally{cache.close();}
});

test('every published native feature has valid defaults and remains an editable data block',()=>{
    const cache=new BuilderCache(root);try{
        const rows=cache.specialFeatures().rows;assert.ok(rows.length>=10,'publish reusable native mechanics beyond the initial example');
        for(const row of rows){const values=resolveMechanics([row.group]);assert.equal(Object.keys(values[row.group.id]).length,row.group.parameters.length,row.sourceName);assert.ok(['handleAfterHitEffects','applySpecialFeature','getSpecialFeatureTraits'].includes(row.group.hook));}
        const ordered=rows.find(row=>row.group.id==='ordered-drain').group,order=resolveMechanics([ordered])[ordered.id].order;
        assert.throws(()=>resolveMechanics([ordered],{[ordered.id]:{order:[order[0],order[0]]}}),/invalid/);
        assert.throws(()=>resolveMechanics([ordered],{[ordered.id]:{order:['hitpoints']}}),/invalid/);
    }finally{cache.close();}
});

test('native templates retain split-roll functions, area targeting, utility behavior and native hook identity',async()=>{
    const cwd=process.cwd();process.chdir(path.join(root,'server'));
    try{
        const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager');
        const {ActorPresentation}=await import('../../../server/src/main/typescript/elvarg/game/model/ActorPresentation');
        const {Mobile}=await import('../../../server/src/main/typescript/elvarg/game/entity/impl/Mobile');
        const {Task}=await import('../../../server/src/main/typescript/elvarg/game/task/Task');
        const {HitDamage}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitDamage');
        const owner=PluginManager.createApi('NativeEffectTemplatesTest'),core:any={...owner.core,Sounds:{playAreaSoundAt(){},sendSound(){}}},api:any={...owner,core};
        const {CombatSpecial,Graphic,Animation}=core,snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)},drain=CombatSpecial.drain;
        try{
            for(const file of ['DragonClaw','Dragon2hSword','DragonBattleaxe'])require(path.join(root,`server/plugins/combat/specials/${file}.SpecialAttack.js`))(api);
            const template=(id:number,overrides:any={})=>({...newNativeSpecial({id,name:'Native example',energy:35,animations:[1062]}),...overrides});
            const manifest=(s:any)=>compileEffects({id:'native-example',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special:s}});
            const player:any=Object.create(Mobile.prototype);Object.assign(player,{animation:null,animationGeneration:0,graphic:null,isPlayer:()=>true,getAsPlayer:()=>player,getEquipment:()=>({get:()=>({getId:()=>60888})}),getCombatSpecial:()=>CombatSpecial.getForWeaponId(60888),getUpdateFlag:()=>({flag(){}})});
            CombatSpecial.drain=()=>{};
            let life=registerEffects(api,manifest(template(core.ItemIdentifiers.DRAGON_CLAWS,{replaceGraphics:true,nativeOverrides:['animation']})));
            const source=CombatSpecial.getForWeaponId(core.ItemIdentifiers.DRAGON_CLAWS),custom=CombatSpecial.getForWeaponId(60888);
            assert.equal(custom.getId(),source.getId(),'native plugin hook guards retain their behavior identity');assert.equal(CombatSpecial.weaponIdFor(player),core.ItemIdentifiers.DRAGON_CLAWS);
            const traits=custom.getTraitsFor(player);assert.equal(traits.hitCount,4);assert.deepEqual(traits.hitDelayTicks,[0,0,1,1]);assert.equal(traits.firstSuccessfulAccuracyDamageRanges[0].distributeDamage,source.getTraits().firstSuccessfulAccuracyDamageRanges[0].distributeDamage);
            assert.deepEqual(traits.firstSuccessfulAccuracyDamageRanges[0].distributeDamage(20),[20,10,5,6]);
            const costMethods={restore:CombatSpecial.ensureRestoreTask,bar:CombatSpecial.updateBar,event:PluginManager.emitCustomEvent,cost:CombatSpecial.cost};let spent=0;
            try{CombatSpecial.drain=drain;CombatSpecial.ensureRestoreTask=()=>false;CombatSpecial.updateBar=()=>{};PluginManager.emitCustomEvent=()=>{};CombatSpecial.cost=(_actor:any,_special:any,base:number)=>({cost:base});player.decrementSpecialPercentage=(n:number)=>spent=n;
                CombatSpecial.drain(player,50);assert.equal(spent,35,'configured cost overrides native fixed cost');CombatSpecial.drain(player,0,false);assert.equal(spent,35,'zero-cost and resource-based templates also honor an explicit energy cost');
            }finally{CombatSpecial.drain=()=>{};CombatSpecial.ensureRestoreTask=costMethods.restore;CombatSpecial.updateBar=costMethods.bar;PluginManager.emitCustomEvent=costMethods.event;CombatSpecial.cost=costMethods.cost;}

            const resolved=custom.resolveProvidedMethod({type(){return core.CombatType.MELEE;},start(actor:any){actor.performGraphic(new Graphic(398));}});resolved.start(player,{});assert.equal(player.graphic,null,'dynamic item providers receive the same scoped customization');
            custom.getCombatMethod().start(player,{});assert.equal(player.animation.getId(),1062);assert.equal(player.graphic,null,'native graphics can be replaced without changing hit behavior');
            player.performGraphic(new Graphic(398));assert.equal(player.graphic.getId(),398,'an unrelated graphic after the call is untouched');life.dispose();
            const play=core.ActorVisuals.play,queued:any[]=[];
            try{core.ActorVisuals.play=(actor:any,clips:any[])=>{queued.push({actor,clips});return {cancel(){},finished:Promise.resolve()};};
                const mapped=template(core.ItemIdentifiers.DRAGON_CLAWS,{replaceGraphics:true,visuals:[{kind:'graphic',id:398,recipient:'player',phase:'launch',delayMs:75,speed:2,durationMs:1200,loop:false,height:0,nativeGraphic:1171,nativeRecipient:'player'}]});
                const cueLife=registerEffects(api,manifest(mapped));player.animation=null;player.graphic=null;CombatSpecial.getForWeaponId(60888).getCombatMethod().start(player,{});assert.equal(queued.length,1,'a mapped clip follows its native graphic cue without duplicate launch playback');assert.equal(queued[0].clips[0].id,398);assert.equal(queued[0].clips[0].delayMs,75);assert.equal(queued[0].clips[0].speed,2);cueLife.dispose();
                for(const durationMs of [45000,120000]){
                    const delayMs=durationMs===120000?0:75,extended=structuredClone(mapped);Object.assign(extended.visuals[0],{durationMs,delayMs,hueShift:120});
                    const extendedLife=registerEffects(api,manifest(extended));
                    try{CombatSpecial.getForWeaponId(60888).getCombatMethod().start(player,{});assert.equal(queued.at(-1).clips[0].delayMs,delayMs,'extended native cues retain a valid nonnegative delay');assert.equal(queued.at(-1).clips[0].hueShift,120);}
                    finally{extendedLife.dispose();}
                }
            }finally{core.ActorVisuals.play=play;}
            assert.equal(core.ItemAliases.baseOf(60888),null,'native profile alias is removed with its owner');assert.equal(CombatSpecial.getForWeaponId(core.ItemIdentifiers.DRAGON_CLAWS),source);
            life=registerEffects(api,manifest(template(core.ItemIdentifiers.DRAGON_2H_SWORD)));assert.deepEqual(CombatSpecial.getForWeaponId(60888).getTraitsFor(player).targeting,CombatSpecial.getForWeaponId(core.ItemIdentifiers.DRAGON_2H_SWORD).getTraits().targeting);life.dispose();
            life=registerEffects(api,manifest(template(core.ItemIdentifiers.DRAGON_BATTLEAXE)));assert.equal(CombatSpecial.getForWeaponId(60888).getTraitsFor(player).skipAttack,true);assert.equal(CombatSpecial.getForWeaponId(60888).getCombatMethod().hits(player,null),null);life.dispose();
            const tasks:any[]=[],damageHooks:any[]=[],resolvedHooks:any[]=[],queuedDamage:any[]=[],healed:number[]=[];
            require(path.join(root,'server/plugins/combat/specials/AncientGodsword.SpecialAttack.js'))({...api,core:{...core,TaskManager:{submit:(task:any)=>tasks.push(task)}}});
            Object.assign(player,{isRegistered:()=>true,isSpecialActivated:()=>true,getHitpoints:()=>99,calculateDistance:()=>2,heal:(n:number)=>healed.push(n)});
            const target:any={isRegistered:()=>true,isPlayer:()=>false,isNpc:()=>true,getAsNpc:()=>target,getHitpoints:()=>100,getMaxHitpoints:()=>100,sendMessage(){},performGraphic(){},getCombat:()=>({getHitQueue:()=>({addPendingDamage:(rows:any[])=>queuedDamage.push(...rows)})})};
            const featureApi={...api,onCombatHitDamage:(fn:any)=>damageHooks.push(fn),onCombatHitResolved:(fn:any)=>resolvedHooks.push(fn)};
            for(const nativeFrom of [undefined,core.ItemIdentifiers.ANCIENT_GODSWORD]){
                const special:any=nativeFrom===undefined?newSpecial():template(nativeFrom);special.nativeFeatures=[{id:'feature-1',source:core.ItemIdentifiers.ANCIENT_GODSWORD,mechanic:'blood-sacrifice',values:{damage:37,delayTicks:4,healPercent:20,npcHealCap:18}}];
                const featureLife=registerEffects(featureApi,manifest(special));damageHooks.splice(0,damageHooks.length-1);resolvedHooks.splice(0,resolvedHooks.length-1);
                try{
                    const damage=new HitDamage(10,core.HitMask.RED),hit:any={isAccurate:()=>true,getAttacker:()=>player,getTarget:()=>target,getTotalDamage:()=>10,getHits:()=>[damage],getHandleAfterHitEffects:()=>true};
                    CombatSpecial.getForWeaponId(60888).getCombatMethod().handleAfterHitEffects?.(hit);assert.equal(tasks.length,0,'the base does not also run a hidden copy of the imported feature');
                    damageHooks[0]({attacker:player,target,hit,damage,accurate:true,combatType:core.CombatType.MELEE});resolvedHooks[0]({attacker:player,target,hit});assert.equal(tasks.length,1,'an independent feature runs once on any base');
                    const task=tasks.pop();assert.equal(task.getDelay(),4);task.execute();assert.equal(queuedDamage.pop().getDamage(),37);assert.equal(healed.pop(),18);
                    damageHooks[0]({attacker:player,target,hit,damage,accurate:true,combatType:core.CombatType.MELEE});
                    const another={...hit};damageHooks[0]({attacker:player,target,hit:another,damage,accurate:true,combatType:core.CombatType.MELEE});resolvedHooks[0]({attacker:player,target,hit:another});assert.equal(tasks.length,1);featureLife.setEnabled(false);tasks.pop().execute();assert.equal(queuedDamage.length,0,'disabling a feature cancels pending gameplay, not only its graphics');
                }finally{featureLife.dispose();tasks.length=0;}
            }
            const targetGraphic=target.performGraphic,actorPlay=core.ActorVisuals.play,played:any[]=[];
            Object.setPrototypeOf(target,Mobile.prototype);delete target.performGraphic;target.getUpdateFlag=()=>({flag(){}});target.graphic=null;
            core.ActorVisuals.play=(actor:any,clips:any[])=>{played.push({actor,clips});return {cancel(){},finished:Promise.resolve()};};
            try{
                const special:any={...newSpecial(),recipe:true,ruleFeatures:[],extraFeatures:[],explicitVisuals:true,nativeFeatures:[{id:'feature-1',source:core.ItemIdentifiers.ANCIENT_GODSWORD,mechanic:'blood-sacrifice',values:{damage:13,delayTicks:2}},{id:'feature-2',source:core.ItemIdentifiers.ANCIENT_GODSWORD,mechanic:'blood-sacrifice',values:{damage:17,delayTicks:3}}],visuals:[newVisual(398,{nativeFeature:'feature-2',nativeGraphic:377,nativeRecipient:'target',recipient:'target',hueShift:90})]};
                const life=registerEffects(featureApi,manifest(special));damageHooks.splice(0,damageHooks.length-1);resolvedHooks.splice(0,resolvedHooks.length-1);
                try{
                    const damage=new HitDamage(10,core.HitMask.RED),hit:any={isAccurate:()=>true,getAttacker:()=>player,getTarget:()=>target,getTotalDamage:()=>10,getHits:()=>[damage],getHandleAfterHitEffects:()=>true};
                    damageHooks[0]({attacker:player,target,hit,damage,accurate:true,combatType:core.CombatType.MELEE});resolvedHooks[0]({attacker:player,target,hit});assert.equal(tasks.length,2);
                    const first=tasks.shift();ActorPresentation.run(first,()=>first.execute());assert.equal(queuedDamage.pop().getDamage(),13,'hiding VFX preserves delayed damage');assert.equal(target.graphic,null);assert.equal(played.length,0,'a suppressed instance does not play another instance’s mapped VFX');
                    const second=tasks.shift();ActorPresentation.run(second,()=>second.execute());assert.equal(queuedDamage.pop().getDamage(),17);assert.equal(target.graphic,null,'the mapped VFX replaces its native cue');assert.equal(played.length,1);assert.equal(played[0].clips[0].id,398);assert.equal(played[0].clips[0].hueShift,90);
                }finally{life.dispose();tasks.length=0;}
                let frozen=0;
                require(path.join(root,'server/plugins/combat/specials/ZamorakGodsword.SpecialAttack.js'))({...api,core:{...core,CombatFactory:{...core.CombatFactory,freeze:()=>frozen++}}});
                const freeze:any={...newSpecial(),nativeFeatures:[{id:'feature-ice',source:core.ItemIdentifiers.ZAMORAK_GODSWORD,mechanic:'freeze',values:{durationTicks:12}}],disabledFeatureVisuals:['feature-ice']},freezeLife=registerEffects(featureApi,manifest(freeze));damageHooks.splice(0,damageHooks.length-1);resolvedHooks.splice(0,resolvedHooks.length-1);
                try{const damage=new HitDamage(10,core.HitMask.RED),hit:any={isAccurate:()=>true,getAttacker:()=>player,getTarget:()=>target,getTotalDamage:()=>10,getHits:()=>[damage],getHandleAfterHitEffects:()=>true};damageHooks[0]({attacker:player,target,hit,damage,accurate:true,combatType:core.CombatType.MELEE});resolvedHooks[0]({attacker:player,target,hit});assert.equal(frozen,1,'a feature without a graphic parameter can hide only its VFX');assert.equal(target.graphic,null);}finally{freezeLife.dispose();}
            }finally{core.ActorVisuals.play=actorPlay;target.performGraphic=targetGraphic;}
            // A task and an on-applied callback created in the scope keep the same
            // presentation even after the launch call has returned.
            let deferred:any,damage:any;player.graphic=null;let valid=true;
            core.ActorVisuals.withPresentation([{entity:player,suppressGraphics:true}],()=>valid,()=>{
                class Later extends Task {execute(){player.performGraphic(new Graphic(398));}}deferred=new Later(0);deferred.setRunning(true);
                damage=new HitDamage(1);damage.onApplied(()=>player.performGraphic(new Graphic(398)));
            });
            deferred.tick();assert.equal(player.graphic,null);damage.notifyApplied(1);assert.equal(player.graphic,null);valid=false;deferred.tick();assert.equal(player.graphic.getId(),398,'an invalidated scope releases its override');
            assert.equal(ActorPresentation.for(player),undefined);
            const firstAlias=core.ItemAliases.registerScoped(60980,1215),secondAlias=core.ItemAliases.registerScoped(60980,13652);firstAlias.dispose();secondAlias.dispose();assert.equal(core.ItemAliases.baseOf(60980),null,'out-of-order disposal cannot revive an old alias');
        }finally{CombatSpecial.drain=drain;CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
    }finally{process.chdir(cwd);}
});

test('every audited native reference imports explicit rules and mechanics with Windows path separators', async (t) => {
    const relative = path.relative;
    t.mock.method(path, 'relative', (from: string, to: string) => {
        const result = relative(from, to);
        return from === root && to.startsWith(path.join(root, 'server/plugins') + path.sep)
            ? result.replaceAll('/', '\\')
            : result;
    });
    const {validateRuleFeatures}=await import('../shared/attack-rules.mjs'),{validateExtraFeatures}=await import('../shared/attack-features.mjs');
    const cache=new BuilderCache(root);try{
        const references=[];for(let offset=0;;offset+=50){const result=cache.specialDonors('',offset);references.push(...result.rows);if(references.length>=result.total)break;}
        const native=references.filter(row=>row.source.includes('/combat/specials/'));
        assert.ok(native.length>100);
        for(const reference of native){
            assert.ok(reference.recipe,`${reference.name} (${reference.specialName}) needs an explicit audited recipe`);
            validateRuleFeatures(reference.recipe.rules);validateExtraFeatures(reference.recipe.extras);
            const rule=newNativeSpecial(reference);assert.equal(rule.recipe,true,reference.name);assert.ok(Array.isArray(rule.ruleFeatures));assert.ok(Array.isArray(rule.extraFeatures));
        }
        const ancient=newNativeSpecial(references.find(row=>row.name==='Ancient godsword'));
        assert.ok(ancient.nativeFeatures.some(row=>row.mechanic==='blood-sacrifice'));
        assert.ok(ancient.modifiers.some(row=>row.type==='damage'));assert.ok(ancient.modifiers.some(row=>row.type==='accuracy'));
        const portable=compileEffects({id:'recipe-roundtrip',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special:ancient}});
        assert.ok(portable.requires.includes('modular-attack-recipes/1'));require('../runtime.effects.cjs').validateManifest(portable);
    }finally{cache.close();}
});

test('legacy authors keep their values and custom visuals when the native base is materialized',async()=>{
    const {materializeSpecial,validateEffects}=await import('../shared/effects.mjs'),cache=new BuilderCache(root);try{
        const reference=cache.specialDonors('Ancient godsword').rows.find(row=>row.name==='Ancient godsword');
        const legacy:any={...newSpecial(),name:'Zarosian Sword special',nativeFrom:reference.id,nativeOverrides:[],replaceGraphics:true,energy:50,actions:[{type:'freeze',ticks:8},{type:'prayer',percent:100,minimum:10,basis:'flat'}],visuals:[{kind:'graphic',id:1996,recipient:'player',phase:'launch',delayMs:0,speed:1,durationMs:0,loop:false,height:0,nativeGraphic:1996,nativeRecipient:'player'},{kind:'graphic',id:8,recipient:'target',phase:'launch',delayMs:0,speed:.75,durationMs:0,loop:false,height:0,hueShift:128}]},before=structuredClone(legacy);
        const recipe=validateEffects({...newEffects(),special:materializeSpecial(legacy,reference)}).special;
        assert.equal(recipe.recipe,true);assert.equal(recipe.name,legacy.name);assert.deepEqual(recipe.actions,legacy.actions);assert.equal(recipe.visuals[1].hueShift,128);assert.equal(recipe.visuals[1].speed,.75);assert.equal(recipe.visuals[0].nativeGraphic,undefined,'a launch cue is made explicit rather than waiting for the source method');assert.ok(recipe.nativeFeatures.some(row=>row.mechanic==='blood-sacrifice'));assert.deepEqual(legacy,before,'reading/migrating never mutates the old saved document');
    }finally{cache.close();}
});

test('portable recipe schemas match editor schemas and preserve exact native split rounding',async()=>{
    const rules=await import('../shared/attack-rules.mjs'),features=await import('../shared/attack-features.mjs'),runtime=require('../runtime.attack.cjs');
    assert.deepEqual(runtime.ATTACK_RULES,rules.ATTACK_RULES);assert.deepEqual(runtime.ATTACK_FEATURES,features.ATTACK_FEATURES);
    for(const type of Object.keys(features.ATTACK_FEATURES)){const rows=[{id:'extra-1',type,values:features.featureDefaults(type)}];assert.deepEqual(runtime.validateExtraFeatures(rows),features.validateExtraFeatures(rows));}
    assert.throws(()=>rules.validateRuleFeatures([{id:'rule-1',type:'__proto__',value:{}}]),/Invalid/);
    const cache=new BuilderCache(root);try{const reference=cache.specialDonors('Dragon claws').rows.find(row=>row.name==='Dragon claws'),traits=runtime.ruleTraits(reference.recipe.rules),first=traits.firstSuccessfulAccuracyDamageRanges;for(let damage=0;damage<=100;damage++){
        assert.deepEqual(first[0].distributeDamage(damage),[damage,Math.floor(damage/2),Math.floor(damage/4),Math.floor(damage/4)+1]);
        assert.deepEqual(first[1].distributeDamage(damage),[0,damage,Math.floor(damage/2),Math.floor(damage/2)+1]);
        assert.deepEqual(first[2].distributeDamage(damage),[0,0,damage,damage+1]);
    }}finally{cache.close();}
});

test('all catalog recipes register without a native alias, hidden method or native identity',async()=>{
    const cwd=process.cwd();process.chdir(path.join(root,'server'));const cache=new BuilderCache(root);
    try{
        const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager');
        const owner=PluginManager.createApi('ModularRecipeCoverageTest'),core:any=owner.core,{CombatSpecial}=core,snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)};
        try{
            require(path.join(root,'server/plugins/combat/SpecialAttacks.plugin.js')).register(owner);
            const references=[];for(let offset=0;;offset+=50){const result=cache.specialDonors('',offset);references.push(...result.rows);if(references.length>=result.total)break;}
            let checked=0;
            for(const reference of references){if(!reference.recipe)continue;
                const special=newNativeSpecial(reference),manifest=compileEffects({id:'recipe-coverage',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}});
                const lifecycle=registerEffects(owner,manifest);try{
                    const custom=CombatSpecial.getForWeaponId(60888);assert.equal(custom.getId(),'content-builder:recipe-coverage:special',reference.name);assert.equal(core.ItemAliases.baseOf(60888),null,reference.name);assert.ok(custom.getCombatMethod() instanceof core.CombatMethod);if(special.activation==='ranged'&&special.extraFeatures.some(row=>row.type==='ammunition'&&row.values.mode==='weapon'))assert.ok(custom.getCombatMethod() instanceof core.RangedCombatMethod);
                    assert.equal(custom.getCombatMethod().handleAfterHitEffects,core.CombatMethod.prototype.handleAfterHitEffects,'no hidden native callback');
                    const expected=require('../runtime.attack.cjs').attackTraits(manifest.config.special);if(special.activation==='self'||expected.skipAttack!==undefined)expected.skipAttack=special.activation==='self';
                    assert.equal(custom.getMetadata().activationType,special.activation,reference.name);assert.deepEqual(JSON.parse(JSON.stringify(custom.getTraitsFor(null))),JSON.parse(JSON.stringify(expected)),reference.name);checked++;
                }finally{lifecycle.dispose();}
            }
            assert.ok(checked>=248);
        }finally{CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
    }finally{cache.close();process.chdir(cwd);}
});

test('independent native trait features compose with accuracy and damage effects on a different weapon',async()=>{
    const cwd=process.cwd();process.chdir(path.join(root,'server'));try{
        const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager'),api=PluginManager.createApi('CrossWeaponTraitsTest'),{core}=api,{CombatSpecial,ItemIdentifiers,Skill}=core,snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)};
        try{
            require(path.join(root,'server/plugins/combat/specials/AbyssalBludgeon.SpecialAttack.js'))(api);
            const special:any={...newSpecial(),hitCount:1,hitDelayTicks:[0],recipe:true,ruleFeatures:[],extraFeatures:[],modifiers:[{id:'damage-1',type:'damage',multiplier:1.2},{id:'accuracy-1',type:'accuracy',multiplier:1.3}],nativeFeatures:[{id:'feature-1',source:ItemIdentifiers.ABYSSAL_BLUDGEON,mechanic:'missing-resource-bonus',values:{damagePerPoint:1,accuracyPerPoint:2}}]},manifest=compileEffects({id:'trait-combination',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}});
            const player:any={isPlayer:()=>true,getAsPlayer:()=>player,getSkillManager:()=>({getCurrentLevel:(skill:any)=>skill===Skill.PRAYER?1:99,getMaxLevel:()=>99})};let life=registerEffects(api,manifest);try{const traits=CombatSpecial.getForWeaponId(60888).getTraitsFor(player);assert.ok(Math.abs(traits.damageMultiplier-2.376)<1e-9);assert.ok(Math.abs(traits.accuracyMultiplier-3.848)<1e-9);}finally{life.dispose();}
            special.nativeFeatures=[];life=registerEffects(api,compileEffects({...{id:'trait-combination',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888}},effects:{...newEffects(),special}}));try{const traits=CombatSpecial.getForWeaponId(60888).getTraitsFor(player);assert.equal(traits.damageMultiplier,1.2);assert.equal(traits.accuracyMultiplier,1.3);}finally{life.dispose();}
        }finally{CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
    }finally{process.chdir(cwd);}
});

test('modular status, resource and follow-up effects use native hooks and cancel their own pending work',async()=>{
    const {featureDefaults}=await import('../shared/attack-features.mjs'),{createAttackRuntime}=require('../runtime.attack.cjs'),hooks:any={},tasks:any[]=[],queued:any[]=[],Skill=Object.fromEntries(['hitpoints','prayer','attack','strength','defence','ranged','magic'].map((name,index)=>[name.toUpperCase(),index]));let active=true,cycle=0;
    class Task {running=true;constructor(public delay:number){}stop(){this.running=false;}}
    class Pending {constructor(public attacker:any,public target:any,public method:any,public config:any){}setTotalDamage(n:number){this.config.damage=n;}setHandleAfterHitEffects(value:boolean){this.config.handleAfterHitEffects=value;} }
    const api:any={core:{Skill:{...Skill,values:()=>Object.values(Skill)},Equipment:{WEAPON_SLOT:3},CombatType:{MELEE:0,RANGED:1,MAGIC:2},World:{getProcessCycle:()=>cycle},CombatMethod:class{},PendingHit:Pending,Task,TaskManager:{submit:(task:any)=>tasks.push(task)},CombatFactory:{addPendingHit:(hit:any)=>queued.push(hit),poisonEntity(){}}},registerIncomingDamageModifier:(fn:any)=>hooks.incoming=fn,onPlayerHitModify:(fn:any)=>hooks.block=fn,onPlayerDealtDamage:(fn:any)=>hooks.amplify=fn,registerRunEnergyDrainModifier:(fn:any)=>hooks.run=fn};
    function actor(){const levels=[99,50,99,99,99,99,99],entity:any={levels,isPlayer:()=>true,getAsPlayer:()=>entity,isRegistered:()=>true,getHitpoints:()=>levels[0],getSkillManager:()=>({getCurrentLevel:(id:number)=>levels[id],getMaxLevel:()=>99,setCurrentLevels:(id:number,value:number)=>levels[id]=value}),getEquipment:()=>({get:()=>({getId:()=>60888})}),run:100,getRunEnergy:()=>entity.run,setRunEnergy:(v:number)=>entity.run=v,getPacketSender:()=>({sendRunEnergy(){},sendRunStatus(){}}),setRunning(){}};return entity;}
    const player=actor(),target=actor(),feature=(type:string,values={})=>({id:`extra-${type}`,type,values:{...featureDefaults(type),...values}}),rule={extraFeatures:[feature('transfer',{basis:'damage',resource:'prayer',percent:100,overheal:true}),feature('protection',{requiresEquipped:false}),feature('hamstring'),feature('follow-up',{minimum:7,maximum:7}),feature('bleed',{percent:100,chunk:5})]};
    const runtime=createAttackRuntime(api,rule,{itemId:60888,isActive:()=>active,isSpecial:()=>true}),hit={isAccurate:()=>true,getHits:()=>[{getDamage:()=>10}]};runtime.launch(player,target);runtime.onResolved(hit,{attacker:player,target,rolled:10});assert.equal(target.levels[1],40);assert.equal(player.levels[1],60);assert.equal(queued[0].config.damage,7);assert.equal(queued[0].method.type(),2);assert.equal(queued[0].config.ordinary,true,'follow-up damage cannot borrow a newly armed special');assert.equal(queued[0].config.handleAfterHitEffects,false,'a follow-up cannot recursively trigger itself');
    const damage={value:20,getDamage(){return this.value;},setDamage(v:number){this.value=v;}};hooks.incoming(player,damage,{type:0});assert.equal(damage.value,10);assert.equal(hooks.run(target,2),12);cycle=101;damage.value=20;hooks.incoming(player,damage,{type:0});assert.equal(damage.value,20);assert.equal(hooks.run(target,2),2);active=false;for(const task of tasks)task.execute();assert.ok(tasks.every(task=>!task.running),'disable cancels delayed damage');runtime.dispose();
});


test('legacy borrowed selections export as explicit recipes without changing the saved project',async()=>{
 const {newProject,makePart}=await import('../shared/project.mjs'),{compileProject}=await import('../export.mjs'),cache=new BuilderCache(root);try{const source=cache.describe('item',4587,'inventory'),project=newProject('old-borrow','gear',source,{definition:60888,modelBase:1100010},cache.info.name);for(const variant of ['male','female'])project.parts.push(makePart(cache.describe('item',4587,variant),variant));project.settings.equipmentType='WEAPON';project.settings.specialFrom=4587;project.settings.specialEnergy=30;const before=JSON.stringify(project),compiled=compileProject(project,cache);assert.equal(compiled.content.effects.config.special.recipe,true);assert.equal(compiled.content.effects.config.special.energy,30);assert.equal(compiled.content.settings.specialFrom,-1);assert.equal(compiled.content.item.specialAttack.from,undefined);assert.equal(JSON.stringify(project),before);assert.ok(!compiled.code.includes('require('),'both combat runtimes are embedded in the exported plugin');}finally{cache.close();}
});

test('the effect library covers every native roll trait',async()=>{
 const fs=await import('node:fs'),{ATTACK_RULES}=await import('../shared/attack-rules.mjs'),source=fs.readFileSync(path.join(root,'server/src/main/typescript/elvarg/game/content/combat/WeaponSpecialTraits.ts'),'utf8').split('export interface WeaponSpecialTraits {')[1].split('\n}')[0];for(const [,key] of source.matchAll(/readonly\s+(\w+)\??:/g))assert.ok(Object.hasOwn(ATTACK_RULES,key),`${key} must be editable and reusable`);
});

test('queued modular follow-ups keep ownership and ammo-free ranged recipes work on other weapon types',async()=>{
 const cwd=process.cwd();process.chdir(path.join(root,'server'));try{
  const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager'),{ActorPresentation}=await import('../../../server/src/main/typescript/elvarg/game/model/ActorPresentation'),{HitDamage}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitDamage'),{featureDefaults}=await import('../shared/attack-features.mjs');
  const owner=PluginManager.createApi('ModularLifecycleTest'),actual:any=owner.core,{CombatSpecial}=actual,snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)},hooks:any={},queued:any[]=[],checks:any[]=[],oldCheck=actual.CombatFactory.checkAmmo;
  class CapturedHit{config:any;constructor(_a:any,_b:any,_method:any,config:any){this.config=config;ActorPresentation.capture(this);}setTotalDamage(n:number){this.config.damage=n;}setHandleAfterHitEffects(value:boolean){this.config.handleAfterHitEffects=value;}}
  const api:any={...owner,core:{...actual,PendingHit:CapturedHit,CombatFactory:{...actual.CombatFactory,addPendingHit:(hit:any)=>queued.push(hit)}},onCombatHitDamage:(fn:any)=>hooks.damage=fn,onCombatHitResolved:(fn:any)=>hooks.resolved=fn};
  const player:any={isNpc:()=>false,isPlayer:()=>true,getAsPlayer:()=>player,isSpecialActivated:()=>true,getHitpoints:()=>99,getEquipment:()=>({get:()=>({getId:()=>60888})}),getSkillManager:()=>({getCurrentLevel:()=>99,getMaxLevel:()=>99}),getCombatSpecial:()=>CombatSpecial.getForWeaponId(60888)},target:any={isPlayer:()=>false,isNpc:()=>true,getAsNpc:()=>target,getHitpoints:()=>100};
  const special:any={...newSpecial(),recipe:true,ruleFeatures:[],nativeFeatures:[],extraFeatures:[{id:'extra-1',type:'follow-up',values:{...featureDefaults('follow-up'),delayTicks:4}}]},manifest=()=>compileEffects({id:'owned-followup',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}});
  try{
   let life=registerEffects(api,manifest());try{const damage=new HitDamage(10,actual.HitMask.RED),hit={isAccurate:()=>true,getAttacker:()=>player,getTarget:()=>target,getHits:()=>[damage],getTotalDamage:()=>10,getHandleAfterHitEffects:()=>true};hooks.damage({attacker:player,target,hit,damage,accurate:true,combatType:actual.CombatType.MELEE});hooks.resolved({attacker:player,target,hit});assert.equal(queued[0].config.delay,4);assert.ok(queued[0].config.damage>0);life.setEnabled(false);assert.equal(queued[0].config.damage,0,'disabled plugins cannot apply a queued follow-up');assert.equal(queued[0].config.handleAfterHitEffects,false);life.setEnabled(true);assert.equal(queued[0].config.damage,0,'reenabling cannot resurrect an old follow-up');}finally{life.dispose();}
   special.style='ranged';special.activation='ranged';special.extraFeatures=[{id:'extra-1',type:'ammunition',values:{...featureDefaults('ammunition'),mode:'none'}}];actual.CombatFactory.checkAmmo=(...args:any[])=>{checks.push(args);return false;};life=registerEffects(api,manifest());try{const method=CombatSpecial.getForWeaponId(60888).getCombatMethod();assert.equal(method.canAttack(player,target),true,'explicitly ammo-free ranged specials can be used with melee weapon types');assert.equal(checks.length,0);assert.equal(method.hits(player,target)[0].config.delay,2);}finally{life.dispose();}
  }finally{actual.CombatFactory.checkAmmo=oldCheck;CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
 }finally{process.chdir(cwd);}
});


test('staged accuracy, damage and dynamic bonuses compose instead of masking each other',async()=>{
 const {attackTraits,scaleTrait}=await import('../shared/attack-rules.mjs'),runtime=require('../runtime.attack.cjs'),rule={modifiers:[{type:'damage',multiplier:1.1},{type:'damage',multiplier:1.25},{type:'accuracy',multiplier:1.2},{type:'accuracy',multiplier:1.5}],ruleFeatures:[{id:'rule-1',type:'accuracyMultiplierStages',value:[2]}]},traits=attackTraits(rule);assert.deepEqual(traits.damageMultiplierStages,[1.1,1.25]);assert.deepEqual(traits.accuracyMultiplierStages,[1.2,1.5,2]);const before=structuredClone(traits),dynamic={...traits};scaleTrait(dynamic,'damageMultiplier',1.98);scaleTrait(dynamic,'accuracyMultiplier',2.96);assert.deepEqual(dynamic.damageMultiplierStages,[1.1,1.25,1.98]);assert.deepEqual(dynamic.accuracyMultiplierStages,[1.2,1.5,2,2.96]);assert.deepEqual(traits,before,'dynamic scaling never mutates another player’s base stages');assert.deepEqual(runtime.attackTraits(rule),traits);
});


test('feature VFX suppressions and instance mappings survive portable validation and preview without suppressing gameplay',()=>{
 const cache=new BuilderCache(root);try{
  const reference=cache.specialDonors('Ancient godsword').rows.find(row=>row.name==='Ancient godsword'),special:any=newNativeSpecial(reference),feature=special.nativeFeatures[0];
  special.nativeFeatures.push({...structuredClone(feature),id:'feature-second',values:{...feature.values,damage:37,delayTicks:4}});
  special.disabledFeatureVisuals=[feature.id];special.visuals.push(newVisual(398,{nativeFeature:'feature-second',nativeGraphic:377,nativeRecipient:'target',recipient:'both',speed:.5,hueShift:80}));
  const project={id:'feature-visuals',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}},manifest=compileEffects(project);assert.deepEqual(require('../runtime.effects.cjs').validateManifest(manifest),manifest);
  const before=structuredClone(special),preview=attackFeaturePreview(special,[reference]);assert.deepEqual(special,before);assert.equal(preview.events.filter(row=>row.damage!==undefined).length,2,'both gameplay events stay visible');const mapped=preview.clips.filter(clip=>clip.nativeFeature==='feature-second');assert.equal(mapped.length,1);assert.equal(mapped[0].delayMs,2400);assert.equal(mapped[0].speed,.5);assert.equal(preview.clips.some(clip=>clip.id===377),false,'removed native VFX do not reappear');
  for(const disabledFeatureVisuals of [['unknown'],[feature.id,feature.id],null]){const invalid=structuredClone(project);invalid.effects.special.disabledFeatureVisuals=disabledFeatureVisuals;assert.throws(()=>compileEffects(invalid));const bad=structuredClone(manifest);bad.config.special.disabledFeatureVisuals=disabledFeatureVisuals;assert.throws(()=>require('../runtime.effects.cjs').validateManifest(bad));}
  const invalid=structuredClone(project);invalid.effects.special.visuals.at(-1).nativeFeature='unknown';assert.throws(()=>compileEffects(invalid));
 }finally{cache.close();}
});

test('the feature browser explains every available building block',async()=>{
 const {attackFeatureChoices}=await import('../public/attack-feature-browser.mjs'),cache=new BuilderCache(root);try{const rows=attackFeatureChoices(cache.specialFeatures());assert.ok(rows.length>80);for(const row of rows){assert.ok(row.description?.length>=20,row.key+' needs a useful explanation');assert.ok(row.schema);assert.ok(row.initial!==undefined);assert.ok(row.example?.name);assert.ok(row.category);}}finally{cache.close();}
});

test('removing hit-count, timing and cooldown blocks clears their runtime behavior instead of reviving legacy fields',async()=>{
 const cwd=process.cwd();process.chdir(path.join(root,'server'));try{
  const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager'),owner=PluginManager.createApi('RemovedRuleTest'),{CombatSpecial}=owner.core,snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)};
  const api={...owner,core:{...owner.core,MeleeCombatMethod:class extends owner.core.MeleeCombatMethod {attackSpeed(){return 7;}},PendingHit:class {constructor(_attacker:any,_target:any,_method:any,public config:any){}}}};
  const special:any={...newSpecial(),hitCount:4,hitDelayTicks:[0,1,2,3],attackSpeedTicks:5,recipe:true,modifiers:[],nativeFeatures:[],extraFeatures:[],ruleFeatures:[{id:'rule-hits',type:'hitCount',value:3},{id:'rule-delays',type:'hitDelayTicks',value:[0,1,2]},{id:'rule-speed',type:'attackSpeedTicks',value:2}]},manifest=()=>compileEffects({id:'removed-rule',kind:'gear',settings:{equipmentType:'WEAPON',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),special}}),player={},target={};
  try{
   let life=registerEffects(api,manifest());try{const method=CombatSpecial.getForWeaponId(60888).getCombatMethod();assert.equal(method.hits(player,target)[0].config.hitAmount,3);assert.deepEqual(method.hits(player,target)[0].config.hitDelays,[0,1,2]);assert.equal(method.attackSpeed(player),2);}finally{life.dispose();}
   special.ruleFeatures=[];const removed=manifest();removed.config.special.hitCount=4;removed.config.special.hitDelayTicks=[0,1,2,3];life=registerEffects(api,removed);try{const method=CombatSpecial.getForWeaponId(60888).getCombatMethod();assert.equal(method.hits(player,target)[0].config.hitAmount,1,'removed hit count defaults to one');assert.deepEqual(method.hits(player,target)[0].config.hitDelays,[0],'removed timing defaults to immediate impact');assert.equal(method.attackSpeed(player),7,'removed cooldown uses the equipped weapon');}finally{life.dispose();}
  }finally{CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
 }finally{process.chdir(cwd);}
});


test('imported VFX are explicit queue entries and can be removed or detached without reviving the source graphic',async()=>{
 const {materializeFeatureVisuals}=await import('../shared/native-mechanics.mjs'),cache=new BuilderCache(root);try{
  const reference=cache.specialDonors('Ancient godsword').rows.find(row=>row.name==='Ancient godsword'),imported=newNativeSpecial(reference),before=structuredClone(imported),cue=imported.visuals.find(clip=>clip.nativeFeature);
  assert.equal(imported.explicitVisuals,true);assert.ok(cue);assert.equal(cue.id,377);assert.deepEqual(materializeFeatureVisuals(imported,[reference]),imported);
  imported.visuals=imported.visuals.filter(clip=>!clip.nativeFeature);const removed=attackFeaturePreview(imported,[reference]);assert.equal(removed.clips.some(clip=>clip.id===377),false);assert.equal(removed.events[0].damage,25);
  const detached=structuredClone(before),clip=detached.visuals.find(clip=>clip.nativeFeature);delete clip.nativeFeature;delete clip.nativeGraphic;delete clip.nativeRecipient;clip.phase='launch';clip.id=398;clip.delayMs=200;
  const preview=attackFeaturePreview(detached,[reference]);assert.equal(preview.clips.some(row=>row.id===377),false);assert.equal(preview.clips.filter(row=>row.id===398).length,1);assert.equal(preview.clips.find(row=>row.id===398).phase,'launch');
  const old=structuredClone(before);delete old.explicitVisuals;old.visuals=old.visuals.filter(row=>!row.nativeFeature);const prior=structuredClone(old),upgraded=materializeFeatureVisuals(old,[reference]);assert.deepEqual(old,prior,'migration never writes the original project');assert.equal(upgraded.visuals.filter(row=>row.nativeFeature).length,1);
 }finally{cache.close();}
});


test('every feature example says Used by and recovery/control examples name actual native users',async()=>{
 const {attackFeatureChoices}=await import('../public/attack-feature-browser.mjs'),cache=new BuilderCache(root);try{
  const rows=attackFeatureChoices(cache.specialFeatures()),get=key=>rows.find(row=>row.key===key);
  for(const row of rows)assert.equal(row.exampleLabel,'Used by',row.key);
  assert.equal(get('action:prayer').example.name,'Saradomin godsword');
  assert.equal(get('action:drain').example.name,'Dragon warhammer');
  assert.equal(get('action:drain-levels').example.name,'Seercull');
  assert.equal(get('action:drain-stats').example.name,'Bandos godsword');
  assert.equal(get('rule:accuracyMultiplierStages').example.name,'Webweaver bow');
  assert.equal(get('rule:bestOf').example.name,'Obligator');
  assert.equal(get('rule:requireFirstAccurate').example.name,'Dual macuahuitl (ordinary attacks)');
  assert.equal(get('rule:maximumDamageCap').example.name,'Dark bow');
  assert.equal(get('rule:guaranteedFirstAccuracyRoll').example.name,'Custom attacks only');
 }finally{cache.close();}
});

test('activation controls reach independently of damage style, keeps offensive skip-hit spells targeted and executes self-cast boosts',async()=>{
 const cwd=process.cwd();process.chdir(path.join(root,'server'));const cache=new BuilderCache(root);
 try{
  const {PluginManager}=await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager'),owner=PluginManager.createApi('CreatorActivationTest'),actual:any=owner.core,{CombatSpecial,Skill}=actual;
  const snapshot={registry:[...CombatSpecial.registry],byId:new Map(CombatSpecial.byId),byItemId:new Map(CombatSpecial.byItemId)},drain=CombatSpecial.drain,spent=[],animations=[],visuals=[],poisons=[],blocks=[];
  class CapturedHit{config:any;constructor(_a:any,_b:any,_method:any,config:any){this.config=config;}}
  const api:any={...owner,onCombatHitDamage(){},onCombatHitResolved(){},core:{...actual,PendingHit:CapturedHit,Sounds:{playAreaSoundAt(){},sendSound(){}},TeleBlock:{apply:(...args)=>blocks.push(args)},CombatFactory:{...actual.CombatFactory,poisonEntity:(...args)=>poisons.push(args),checkAmmo(){throw new Error('This melee item has no ammunition.');}},ActorVisuals:{...actual.ActorVisuals,withPresentation:(_actors,_valid,fn)=>fn(),play:(actor,clips)=>{visuals.push({actor,clips});return {finished:Promise.resolve(),cancel(){}};}}}};
  const levels=new Map(),player:any={isNpc:()=>false,isPlayer:()=>true,getAsPlayer:()=>player,getHitpoints:()=>99,getUsername:()=> 'Preview tester',getEquipment:()=>({get:()=>({getId:()=>60888})}),getSkillManager:()=>({getCurrentLevel:s=>levels.get(s)??99,getMaxLevel:()=>99,setCurrentLevels:(s,v)=>levels.set(s,v)}),performAnimation:a=>animations.push(a.getId()),getCombatSpecial:()=>CombatSpecial.getForWeaponId(60888)},target:any={isPlayer:()=>true,getAsPlayer:()=>target,getHitpoints:()=>99};
  const manifest=special=>compileEffects({id:'activation-test',kind:'gear',ids:{definition:60888},settings:{equipmentType:'WEAPON',specialFrom:-1},effects:{...newEffects(),special}});
  let life;
  try{
   CombatSpecial.drain=(_player,cost)=>spent.push(cost);
   const special={...newSpecial(),activation:'ranged',style:'melee'};life=registerEffects(api,manifest(special));let definition=CombatSpecial.getForWeaponId(60888),method=definition.getCombatMethod();assert.equal(method.type(),actual.CombatType.MELEE);assert.equal(method.attackDistance(player),7);assert.equal(method.canAttack(player,target),true);assert.equal(method.hits(player,target)[0].config.delay,2);assert.notEqual(definition.getTraits().skipAttack,true);life.dispose();
   const previousReach=actual.WeaponProfiles.meleeAttackDistance;actual.WeaponProfiles.meleeAttackDistance=()=>2;try{life=registerEffects(api,manifest({...special,activation:'melee',style:'ranged',defence:'style'}));method=CombatSpecial.getForWeaponId(60888).getCombatMethod();assert.equal(method.attackDistance(player),2,'melee activation keeps native extended reach');assert.equal(method.type(),actual.CombatType.RANGED);assert.equal(method.canAttack(player,target),true);}finally{life?.dispose();actual.WeaponProfiles.meleeAttackDistance=previousReach;}
   const skipped={...special,recipe:true,ruleFeatures:[{id:'rule-skip',type:'skipAttack',value:true}],extraFeatures:[],nativeFeatures:[]};life=registerEffects(api,manifest(skipped));definition=CombatSpecial.getForWeaponId(60888);assert.equal(definition.getTraits().skipAttack,false,'offensive skip-primary must not trigger CombatSpecial.activateUtility');assert.deepEqual(definition.getCombatMethod().hits(player,target),[]);life.dispose();
   require(path.join(root,'server/plugins/combat/specials/DragonPickaxe.SpecialAttack.js'))(api);const reference=cache.specialDonors('Dragon pickaxe').rows.find(row=>row.name==='Dragon pickaxe'),utility=newNativeSpecial(reference);assert.equal(utility.activation,'self');utility.visuals=[newVisual(398,{recipient:'target',phase:'launch'})];life=registerEffects(api,manifest(utility));definition=CombatSpecial.getForWeaponId(60888);method=definition.getCombatMethod();assert.equal(definition.getTraits().skipAttack,true);method.start(player,null);assert.equal(levels.get(Skill.MINING),102);assert.equal(spent.at(-1),100);assert.equal(animations.at(-1),utility.animation);assert.equal(visuals.at(-1).actor,player);assert.deepEqual(method.hits(player,null),[]);life.dispose();
   life=registerEffects(api,manifest({...newSpecial(),activation:'self',actions:[{type:'venom'},{type:'teleblock',ticks:20}]}));CombatSpecial.getForWeaponId(60888).getCombatMethod().start(player,null);assert.deepEqual(poisons.at(-1),[player,6,2]);assert.deepEqual(blocks.at(-1),[player,'Preview tester',12]);
  }finally{life?.dispose();CombatSpecial.drain=drain;CombatSpecial.registry=snapshot.registry;CombatSpecial.byId=snapshot.byId;CombatSpecial.byItemId=snapshot.byItemId;}
 }finally{cache.close();process.chdir(cwd);}
});
