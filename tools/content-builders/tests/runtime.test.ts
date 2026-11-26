// Exercise exported packages with real TSPS registries, without starting a game or touching saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { BuilderCache } from '../cache';
import { newSpecial, newPassive } from '../shared/effects.mjs';
import { compileProject } from '../export.mjs';
import { SET_FORMAT, fullSetRequirement } from '../shared/gear-set.mjs';
import { makePart, newProject } from '../shared/project.mjs';
import {newGearVisuals,newModelTrack} from '../shared/gear-visuals.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
test('exported creature and gear load into real TSPS registries and leave cache templates intact', async () => {
    const previous = process.cwd(); process.chdir(path.join(root, 'server'));
    const { CachePipeline } = await import('../../../server/src/main/typescript/elvarg/game/cache/CachePipeline');
    const manifest = path.join(root, 'server/caches/caches.json'); const manifestBefore = fs.readFileSync(manifest, 'utf8');
    let cache: BuilderCache;
    try {
        await CachePipeline.initialize(process.cwd());
        const { CacheDefinitions } = await import('../../../server/src/main/typescript/elvarg/game/cache/CacheDefinitions');
        const { ItemDefinition } = await import('../../../server/src/main/typescript/elvarg/game/definition/ItemDefinition');
        const { NpcDefinition } = await import('../../../server/src/main/typescript/elvarg/game/definition/NpcDefinition');
        const { CombatType } = await import('../../../server/src/main/typescript/elvarg/game/content/combat/CombatType');
        const { WeaponInterfaces } = await import('../../../server/src/main/typescript/elvarg/game/content/combat/WeaponInterfaces');
        const { encodeContentData } = await import('../../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
        cache = new BuilderCache(root);
        const originalNpc = JSON.stringify(CacheDefinitions.getNpc(655)), originalItem = JSON.stringify(CacheDefinitions.getItem(4587)), originalModels = CacheDefinitions.getCustomModels();
        const creature = newProject('native-creature', 'npc', cache.describe('npc', 655), { definition: 58990, modelBase: 1180000 }, cache.info.name);
        const gear = newProject('native-gear', 'gear', cache.describe('item', 4587, 'inventory'), { definition: 60990, modelBase: 1180010 }, cache.info.name);
        for (const variant of ['male', 'female']) gear.parts.push(makePart(cache.describe('item', 4587, variant), variant));
        gear.visuals=newGearVisuals();gear.visuals.models.push(newModelTrack(gear.parts[1].id));
        const { PluginManager } = await import('../../../server/src/main/typescript/elvarg/plugins/PluginManager');
        gear.effects = { version:1, special:newSpecial(), passives:[{...newPassive(),chance:100}] };
        const set:any={format:SET_FORMAT,id:'native-armor-set',kind:'gear',name:'Custom rune set',items:[1163,1127,1079].map((baseId,i)=>{
            const p=newProject(`set-piece-${i}`,'gear',cache.describe('item',baseId,'inventory'),{definition:60991+i,modelBase:1180020+i*5},cache.info.name);
            p.name=`Custom piece ${i}`;for(const variant of ['male','female'])p.parts.push(makePart(cache.describe('item',baseId,variant),variant));return p;
        })};
        set.items[0].effects={version:1,special:null,passives:[{...newPassive(),chance:100,actions:[{type:'heal',percent:50,minimum:0,basis:'dealt'}],set:fullSetRequirement(set,set.items[0].id)}]};
        const hooks: any[] = [], shutdown: any[] = [], damageHooks:any[]=[],resolvedHooks:any[]=[];
        const core = { ...PluginManager.getCoreApi(), CacheDefinitions, ItemDefinition, NpcDefinition, CombatType, WeaponInterfaces, encodeContentData };
        const authored=structuredClone(creature);authored.id='authored-creature';authored.ids={definition:58991,modelBase:1180005,sequenceBase:50100};authored.parts[0].motion.mode='still';authored.parts[0].motion.keys.attack=[{time:0,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},{time:400,position:[0,0,0],rotation:[20,0,0],scale:[1,1,1]}];
        for (const p of [creature, gear,authored,set]) {
            const compiled = compileProject(p, cache), module = { exports: {} as any };
            if(p===gear) { assert.equal(compiled.content.effects.config.special.hitCount,2); assert.deepEqual(compiled.content.item.specialAttack,{energy:25}); }
            vm.runInNewContext(compiled.code, { module, console, Math, Buffer });
            const api = { ...PluginManager.createApi(compiled.manifest.name), core, onServerShutdown: fn => shutdown.push(fn), onServerStartup: fn => hooks.push(fn), onCustomEvent: () => {}, log: () => {},...(p===set?{onCombatHitDamage:fn=>damageHooks.push(fn),onCombatHitResolved:fn=>resolvedHooks.push(fn)}:{}) };
            module.exports.register(api); module.exports.registerDeferred?.(api);
        }
        assert.equal(CacheDefinitions.getNpc(creature.ids.definition).name, creature.name, 'definition is available before saved NPC spawns load');
        // A collision on the last set member must fail before publishing earlier members.
        const setStartup=hooks.at(-1),oldModels=CacheDefinitions.getCustomModels(),oldItems=CacheDefinitions.getCustomItems();
        CacheDefinitions.setCustomModels([...oldModels,compileProject(set,cache).content.items[2].models[0]]);
        assert.throws(()=>setStartup(),/model ID collides/);assert.deepEqual(CacheDefinitions.getCustomItems(),oldItems);assert.equal(damageHooks.length,0);
        CacheDefinitions.setCustomModels(oldModels);
        hooks.forEach(startup => startup());
        for(const [i,p]of set.items.entries()){
            assert.equal(ItemDefinition.forId(p.ids.definition).getName(),`Custom piece ${i}`);
            assert.equal(ItemDefinition.forId(p.ids.definition).getEquipmentType().getSlot(),[0,4,7][i]);
            assert.ok(CacheDefinitions.getCustomModels().some(row=>row.id===p.ids.modelBase));
        }
        assert.equal(damageHooks.length,1,'one set bonus owner registers one damage hook');assert.equal(resolvedHooks.length,1);
        const {HitDamage}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitDamage');
        const {HitMask}=await import('../../../server/src/main/typescript/elvarg/game/content/combat/hit/HitMask');
        const equipment=new Map([[0,set.items[0].ids.definition],[4,set.items[1].ids.definition],[7,set.items[2].ids.definition]]);let hp=20;
        const skills={getCurrentLevel:()=>hp,getMaxLevel:()=>99,setCurrentLevels:(_skill,n)=>hp=n};
        const attacker:any={isPlayer:()=>true,getAsPlayer:()=>attacker,getEquipment:()=>({get:slot=>({getId:()=>equipment.get(slot)??-1})}),getSkillManager:()=>skills,getHitpoints:()=>hp};
        const strike=()=>{const damage=new HitDamage(10,HitMask.RED),hit={getHandleAfterHitEffects:()=>true,getHitDelays:()=>[0],getHits:()=>[damage],isAccurate:()=>true},target={};
            damageHooks.forEach(fn=>fn({attacker,target,hit,damage,accurate:true,combatType:CombatType.MELEE}));resolvedHooks.forEach(fn=>fn({attacker,target,hit}));resolvedHooks.forEach(fn=>fn({attacker,target,hit}));damage.notifyApplied(10);};
        strike();assert.equal(hp,25,'complete custom set heals once per hit');
        equipment.set(4,1127);strike();assert.equal(hp,25,'the vanilla template cannot substitute for the custom sibling');
        equipment.set(4,set.items[1].ids.definition);equipment.delete(0);strike();assert.equal(hp,25,'the owning set item must be worn');equipment.set(0,set.items[0].ids.definition);
        strike();assert.equal(hp,30);
        assert.equal(NpcDefinition.forId(creature.ids.definition).getExamine(), creature.examine);
        assert.equal(NpcDefinition.forId(creature.ids.definition).getMaxHit(), creature.settings.maxHit);
        assert.equal(NpcDefinition.forId(creature.ids.definition).getHitpoints(), creature.settings.hitpoints);
        assert.equal(NpcDefinition.forId(authored.ids.definition).getAttackAnim(),50103,'combat uses the exported custom attack');assert.ok(CacheDefinitions.getCustomAnimations().some(row=>row.id===50103));
        assert.equal(ItemDefinition.forId(gear.ids.definition).getName(), gear.name);
        assert.equal(ItemDefinition.forId(gear.ids.definition).getEquipmentType().getSlot(), 3);
        assert.deepEqual(CacheDefinitions.getCustomItems().find(row=>row.id===gear.ids.definition).retainWornModelForAnimations,
            compileProject(gear,cache).content.item.retainWornModelForAnimations,'login datasets must retain the authored pose policy');
        assert.deepEqual(CacheDefinitions.getCustomItems().find(row=>row.id===gear.ids.definition).visuals,
            compileProject(gear,cache).content.item.visuals,'item visuals must survive server registration and login datasets');
        assert.deepEqual(ItemDefinition.forId(gear.ids.definition).getBonuses(), gear.settings.bonuses);
        assert.ok(CacheDefinitions.getCustomModels().some(m => m.id === creature.ids.modelBase));
        assert.ok(CacheDefinitions.getCustomModels().some(m => m.id === gear.ids.modelBase));
        assert.equal(JSON.stringify(CacheDefinitions.getNpc(655)), originalNpc);
        assert.equal(JSON.stringify(CacheDefinitions.getItem(4587)), originalItem);
        CacheDefinitions.registerCustomDefinitions([], 'content-builder:native-creature');
        CacheDefinitions.registerCustomDefinitions([],'content-builder:authored-creature');CacheDefinitions.registerSampledAnimations([],'content-builder:authored-creature');
        assert.ok(core.CombatSpecial.getForWeaponId(gear.ids.definition),'exported original special is registered');
        shutdown.forEach(fn=>fn());strike();assert.equal(hp,30,'shutdown disables the set bonus');
        assert.equal(core.CombatSpecial.getForWeaponId(gear.ids.definition),null,'shutdown removes the authored special');
        CacheDefinitions.registerCustomItems([]); CacheDefinitions.setCustomModels(originalModels);
        assert.equal(CacheDefinitions.getCustomDefinitionOwner('npc', creature.ids.definition), undefined);
        assert.equal(CacheDefinitions.getCustomItems().length, 0);
    } finally {
        cache?.close(); CachePipeline.getStore().close(); process.chdir(previous);
        assert.equal(fs.readFileSync(manifest, 'utf8'), manifestBefore, 'test did not modify the cache manifest');
    }
});

test('exported multi-attack methods keep per-NPC turns and immutable delayed-hit styles',()=>{
    const content={kind:'npc',id:58000,baseId:655,name:'Attack test',source:'content-builder:attack-test',cache:'fixture',definition:{kind:'npc',id:58000,fields:{}},models:[],animationRows:[],settings:{attackType:'MELEE',stats:Array(18).fill(1),attackSpeed:4},animations:{attack:50003,block:-1,death:-1},attacks:[{name:'Melee',style:'MELEE',animation:50003,speed:4,range:1,maxHit:8,delay:0,weight:1,projectileId:-1,launchGraphicId:-1},{name:'Magic',style:'MAGIC',animation:50006,speed:8,range:10,maxHit:6,delay:3,weight:1,projectileId:448,launchGraphicId:2}],attackMode:'cycle'};
    const code=fs.readFileSync(path.join(root,'tools/content-builders/runtime.cjs'),'utf8').replace('/* BUILDER_CONTENT */ null',JSON.stringify(content));
    const module={exports:{} as any},hooks:any={},registered:any[]=[];vm.runInNewContext(code,{module,Math});
    class CombatMethod{};class Animation{constructor(public id:number){}};class Graphic{constructor(public id:number){}};
    class PendingHit{damage=20;style:number;constructor(public npc:any,public target:any,public method:any,public delay:number){this.style=method.type();}getTotalDamage(){return this.damage;}setTotalDamage(value:number){this.damage=value;}}
    const sent:any[]=[],core={CombatMethod,Animation,Graphic,PendingHit,Projectile:{createProjectile:(...args:any[])=>({sendProjectile:()=>sent.push(args)})},CombatType:{MELEE:0,RANGED:1,MAGIC:2},encodeContentData:()=>{},CacheDefinitions:{getBaseCounts:()=>({npcs:20000,items:40000}),getCacheInfo:()=>({name:'fixture'}),getCustomDefinitionOwner:()=>undefined,getCustomModels:()=>[],getCustomItems:()=>[],registerCustomDefinitions:()=>{},setCustomModels:()=>{}},NpcDefinition:{invalidateCache:()=>{},forId:()=>({})}};
    const api={core,onServerStartup:(fn:Function)=>hooks.start=fn,onCustomEvent:()=>{},registerNpcCombatMethodProvider:(id:number,ctor:any,options:any)=>registered.push({id,ctor,options})};module.exports.register(api);assert.equal(registered.length,0,'registration remains attach-only');hooks.start();
    assert.equal(registered.length,1);assert.equal(registered[0].options.singleton,false);
    const Ctor=registered[0].ctor,animations:any[]=[],delays:any[]=[],npc={calculateDistance:()=>1,performAnimation:(a:any)=>animations.push(a.id),performGraphic:()=>{},getCombat:()=>({setAttackDelay:(n:number)=>delays.push(n)})},target={};
    const first=new Ctor(npc);first.start(npc,target);const melee=first.hits(npc,target)[0];
    const second=new Ctor(npc);second.start(npc,target);const magic=second.hits(npc,target)[0];
    const third=new Ctor(npc);third.start(npc,target);third.hits(npc,target);
    assert.deepEqual(animations,[50003,50006,50003]);assert.deepEqual(delays,[4,8,4]);assert.equal(magic.delay,3);assert.equal(magic.damage,6);assert.equal(melee.damage,8);assert.equal(magic.style,2);assert.equal(magic.method.type(),2);assert.equal(sent.length,1);
    const another={...npc};const fresh=new Ctor(another);fresh.start(another,target);assert.equal(fresh.type(),0,'another NPC starts its own turn order');
    const distant={...npc,calculateDistance:()=>5};const far=new Ctor(distant);far.start(distant,target);assert.equal(far.type(),2,'melee is unavailable out of reach');assert.equal(far.canAttack({...npc,calculateDistance:()=>11},target),false);
});
