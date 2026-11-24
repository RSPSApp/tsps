import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {combatSoundTimeline} from '../shared/combat-audio.mjs';
import {createCombatAudio} from '../public/combat-audio.mjs';
import {newVisual} from '../shared/visuals.mjs';
import {BuilderCache} from '../cache';
const root=path.resolve(import.meta.dirname,'../../..');

test('native cache audio preserves frame timing, sampled PCM, combat metadata and bounded repeat playback',()=>{
 const cache=new BuilderCache(root);try{
  const cues=cache.sequenceSounds(879);assert.ok(cues.some(row=>row.id===2735));assert.ok(cues.every(row=>row.timeMs>=0));
  const wave=cache.sound(2735),repeated=cache.sound(2735,3);assert.equal(wave.toString('ascii',0,4),'RIFF');assert.equal(wave.readUInt32LE(40),wave.length-44);assert.ok(wave.subarray(44).some(v=>v!==0));assert.ok(repeated.length>wave.length);assert.ok(repeated.length<=44+wave.readUInt32LE(24)*40);
  const combat=cache.combatAudio(2486,1215);assert.ok(combat.npc.attack.length);assert.ok(combat.npc.hit.length);assert.equal(combat.player.hit,513);assert.equal(combat.player.blockAnimation,388);
  assert.throws(()=>cache.sound(2735,11));
 }finally{cache.close();}
});

test('the audible exchange includes explicit effects, animation/VFX frames, each impact and retaliation at stage time',()=>{
 const asset=(id:number,timeMs:number)=>({frames:[{duration:1000}],soundEvents:[{id,timeMs,loops:1}]}),clip=newVisual(398,{speed:.5,delayMs:200,recipient:'target'}),scene:any={player:asset(10,100),target:asset(20,0),targetBlock:asset(30,0),targetAttack:asset(40,100),playerBlock:asset(50,0),enemy:{id:2486},clips:[clip],assets:new Map([['graphic:398:target',asset(60,200)]]),events:[{delayMs:2400,damage:25}],audioInfo:{npc:{hit:[[472,2]],attack:[[3520,0]],attackBase:394},player:{hit:513}}};
 const rule:any={recipe:true,ruleFeatures:[{id:'rule-1',type:'hitCount',value:2},{id:'rule-2',type:'hitDelayTicks',value:[0,1]}],extraFeatures:[{id:'extra-1',type:'sound',values:{id:3869,event:'launch',delayCycles:5,loops:2,recipient:'player'}}]},events=combatSoundTimeline(rule,scene,{impactMs:600,random:()=>0});
 const times=(id:number)=>events.filter(e=>e.id===id).map(e=>e.timeMs);
 assert.deepEqual(times(3869),[100]);assert.deepEqual(times(472),[640,1240,3040]);assert.deepEqual(times(60),[1200]);assert.deepEqual(times(3520),[1600]);assert.deepEqual(times(394),[1600]);assert.deepEqual(times(40),[1700]);assert.deepEqual(times(513),[2200]);assert.equal(events.find(e=>e.id===60).rate,.5);assert.equal(events.find(e=>e.id===3869).loops,2);
 const silentEnemy=combatSoundTimeline(rule,scene,{retaliate:false,random:()=>0});assert.equal(silentEnemy.some(e=>[3520,394,513].includes(e.id)),false);
});

test('Web Audio schedules decoded samples, resumes with offsets, changes speed and cancels stale playback',async()=>{
 const nodes:any[]=[],gains:any[]=[];let current=10,loads=0,resolveLoad:any;
 class Context{state='running';destination={};get currentTime(){return current;}resume(){return Promise.resolve();}createGain(){const gain={gain:{value:0},connect(){}};gains.push(gain);return gain;}async decodeAudioData(){return {duration:2,length:2000};}createBufferSource(){const node={playbackRate:{value:1},connect(){},disconnect(){},start(...args:any[]){this.started=args;},stop(){this.stopped=true;},started:null,stopped:false};nodes.push(node);return node;}}
 const audio=createCombatAudio({Context,load:async()=>{loads++;return new ArrayBuffer(4);}});await audio.unlock();const events=[{id:2735,loops:1,timeMs:1000,rate:1}];await audio.prepare(events);await audio.start(events,0,2);assert.deepEqual(nodes[0].started,[10.5,0]);assert.equal(nodes[0].playbackRate.value,2);audio.stop();assert.ok(nodes[0].stopped);
 current=12;await audio.start(events,1500,.5);assert.deepEqual(nodes[1].started,[12,.5]);assert.equal(loads,1,'repeat previews reuse the decoded sample');audio.setMuted(true);assert.equal(gains[0].gain.value,0);assert.ok(nodes[1].stopped);
 const stale=createCombatAudio({Context,load:()=>new Promise(resolve=>resolveLoad=resolve)});await stale.unlock();const work=stale.start(events,0);stale.stop();resolveLoad(new ArrayBuffer(4));await work;assert.equal(nodes.length,2,'a sample loaded after Pause never starts');audio.clear();stale.clear();
});
