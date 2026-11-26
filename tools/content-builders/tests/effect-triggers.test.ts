import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {newEffects,newPassive,compileEffects,validateEffects} from '../shared/effects.mjs';
const require=createRequire(import.meta.url),{validateManifest,registerEffects}=require('../runtime.effects.cjs');
const project=(passive:any)=>({id:'trigger-test',kind:'gear',settings:{equipmentType:'BODY',specialFrom:-1},ids:{definition:60888},effects:{...newEffects(),passives:[passive]}});
test('set triggers, conditions and cooldowns survive validation and portable compilation',()=>{
    for(const trigger of ['damage','accurate','attack','taken','hit-received','kill','interval','hp-below','prayer-below','equip']){
        const rule={...newPassive(),trigger,cooldownTicks:20,conditions:{hpBelowPercent:60,prayerBelowPercent:80,inCombat:true},actions:[{type:'heal',percent:10,minimum:0,basis:'max'}],...(trigger==='interval'?{intervalTicks:5}:{}),...(['hp-below','prayer-below'].includes(trigger)?{thresholdPercent:30}:{})};
        const manifest=compileEffects(project(rule));assert.deepEqual(validateManifest(manifest),manifest);
        assert.equal(manifest.config.passives[0].trigger,trigger);assert.equal(manifest.config.passives[0].cooldownTicks,20);
    }
    for(const patch of [{trigger:'interval',intervalTicks:0},{trigger:'hp-below',thresholdPercent:101},{cooldownTicks:-1},{conditions:{inCombat:'yes'}},{trigger:'interval',intervalTicks:5,bonusDamage:3}])assert.throws(()=>validateEffects(project({...newPassive(),...patch}).effects));
});

function fixture(patch:any){
    const hooks:any={},current=[20,20],maximum=[100,100];let tick=0,equipped=true;
    const core:any={HitDamage:class{onApplied(){}},Skill:{HITPOINTS:0,PRAYER:1},CombatType:{MELEE:0},CombatSpecial:{},World:{getProcessCycle:()=>tick}};
    const api:any={core,onCombatHitDamage:(fn:any)=>hooks.damage=fn,onCombatHitResolved:(fn:any)=>hooks.resolved=fn,onPlayerProcess:(fn:any)=>hooks.process=fn,onNpcDeath:(fn:any)=>hooks.npcDeath=fn,onPlayerDeath:(fn:any)=>hooks.playerDeath=fn};
    const player:any={isPlayer:()=>true,getAsPlayer:()=>player,getHitpoints:()=>current[0],getSkillManager:()=>({getCurrentLevel:(s:number)=>current[s],getMaxLevel:(s:number)=>maximum[s],setCurrentLevels:(s:number,n:number)=>current[s]=n}),getEquipment:()=>({get:(s:number)=>({getId:()=>equipped&&s===4?60888:-1})}),getCombat:()=>({getTarget:()=>null})};
    const enemy:any={isPlayer:()=>false,getHitpoints:()=>50};
    const life=registerEffects(api,compileEffects(project({...newPassive(),chance:100,actions:[{type:'heal',percent:10,minimum:0,basis:'max'}],...patch})),{random:()=>0});
    function hit(incoming=false,values=[8],accurate=true){const callbacks:any[]=[],damages=values.map((v,i)=>({getDamage:()=>v,setDamage:(n:number)=>values[i]=n,onApplied:(fn:any)=>callbacks[i]=fn})),pending={getHandleAfterHitEffects:()=>true,getHitDelays:()=>values.map(()=>0),getHits:()=>damages,isAccurate:()=>accurate},event={attacker:incoming?enemy:player,target:incoming?player:enemy,hit:pending,combatType:0};for(const damage of damages)hooks.damage({...event,damage,accurate});hooks.resolved(event);return (amounts=values)=>amounts.forEach((v,i)=>callbacks[i]?.(v));}
    return {player,enemy,current,life,hit,death:()=>hooks.npcDeath?.({npc:enemy,lastDamager:player,killer:player}),process:(n:number)=>{tick=n;hooks.process?.({player});},equip:(v:boolean)=>equipped=v};
}
test('intervals count native ticks, obey cooldowns and pause while unequipped',()=>{
    const f=fixture({trigger:'interval',intervalTicks:3,cooldownTicks:5});
    f.process(10);f.process(12);assert.equal(f.current[0],20);f.process(13);assert.equal(f.current[0],30);
    f.process(16);assert.equal(f.current[0],30);f.process(19);assert.equal(f.current[0],40);
    f.equip(false);f.process(20);f.equip(true);f.process(25);assert.equal(f.current[0],40);f.process(28);assert.equal(f.current[0],50);
    f.life.setEnabled(false);f.process(40);assert.equal(f.current[0],50);f.life.dispose();
});
test('HP and Prayer triggers fire on crossing, rearm above the threshold and share cooldowns',()=>{
    const f=fixture({trigger:'hp-below',thresholdPercent:30,cooldownTicks:5});
    f.process(1);assert.equal(f.current[0],30);f.process(2);assert.equal(f.current[0],30,'remaining below does not repeat');
    f.current[0]=50;f.process(3);f.current[0]=10;f.process(4);assert.equal(f.current[0],10,'cooldown blocks a new crossing');f.process(8);assert.equal(f.current[0],10,'a blocked crossing must rearm');
    f.current[0]=50;f.process(9);f.current[0]=20;f.process(10);assert.equal(f.current[0],30);f.life.dispose();
    const p=fixture({trigger:'prayer-below',thresholdPercent:25,actions:[{type:'prayer',percent:10,minimum:0,basis:'max'}]});p.process(0);assert.equal(p.current[1],30);p.process(1);assert.equal(p.current[1],30);p.life.dispose();
});
test('NPC attacks activate victim effects once per attack with cumulative actual damage',()=>{
    const f=fixture({trigger:'taken',actions:[{type:'heal',percent:50,minimum:0,basis:'dealt'}]});
    f.hit(true,[12,12])([4,6]);assert.equal(f.current[0],25);f.hit(false)();assert.equal(f.current[0],25);f.life.dispose();
    const z=fixture({trigger:'hit-received'});z.hit(true,[0],true)();assert.equal(z.current[0],30);z.hit(true,[0],false)();assert.equal(z.current[0],30);z.life.dispose();
});
test('attack, kill and equipment triggers have distinct events and condition checks',()=>{
    const a=fixture({trigger:'attack',cooldownTicks:3});const apply=a.hit(false,[0],false);assert.equal(a.current[0],30,'attack launch can activate without damage');apply();assert.equal(a.current[0],30);a.life.dispose();
    const k=fixture({trigger:'kill'});k.hit()();assert.equal(k.current[0],20);k.enemy.getHitpoints=()=>0;k.hit()();assert.equal(k.current[0],20,'zero HP can be a phase change; wait for native death');k.death();assert.equal(k.current[0],30);k.death();assert.equal(k.current[0],30);k.life.dispose();
    const e=fixture({trigger:'equip',conditions:{hpBelowPercent:25}});e.process(1);assert.equal(e.current[0],30);e.process(2);assert.equal(e.current[0],30);e.equip(false);e.process(3);e.equip(true);e.process(4);assert.equal(e.current[0],30,'conditions evaluate at activation');e.life.dispose();
});
