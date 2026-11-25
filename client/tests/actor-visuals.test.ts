import assert from 'node:assert/strict';
import {GfxManager,graphicAgeMs} from '../render/gfx/GfxManager';
import {receiveActorVisual} from '../render/gfx/ActorVisuals';

const manager=new GfxManager({gfxRenderer:{getCache:()=>({getDurationTicks:()=>50})}} as any);
const message=(patch:any={})=>({channel:'actor-visuals',data:{type:'play',token:'v1',actor:{kind:'npc',index:4},clip:{kind:'graphic',id:398,speed:2,durationMs:2400,loop:true,height:64},...patch}});
receiveActorVisual(message(),manager);
const first=[...manager.getActorInstances('npc',4)][0];assert.ok(first);assert.equal(first.durationMs,2400);assert.equal(first.sourceDurationMs,1000);assert.equal(first.yOffsetTiles,.5);
first.startTimeMs=100;assert.equal(graphicAgeMs(first,350),500);assert.equal(graphicAgeMs({...first,repeatVisual:false},1100),999);
assert.equal(manager.getActorGraphic('npc',4),-1,'custom VFX do not occupy native slot zero');manager.spawnAttachedToNpc(369,4,'ground',0,false,undefined,0);manager.clearAttachedSlotNpc(4,0);assert.equal([...manager.getActorInstances('npc',4)].length,1,'clearing native slots preserves queued clips');
receiveActorVisual(message({token:'v2'}),manager);assert.equal([...manager.getActorInstances('npc',4)].length,2,'independent clips overlap');
receiveActorVisual({channel:'actor-visuals',data:{type:'clear',token:'v1'}},manager);assert.equal([...manager.getActorInstances('npc',4)].length,1);
receiveActorVisual(message({clip:{kind:'graphic',id:398,speed:Infinity,durationMs:0,loop:false,height:0}}),manager);assert.equal([...manager.getActorInstances('npc',4)].length,1);
for(let n=3;n<90;n++)receiveActorVisual(message({token:`v${n}`}),manager);assert.equal([...manager.getActorInstances('npc',4)].length,48);
manager.clearVisualToken('v89');assert.equal([...manager.getActorInstances('npc',4)].length,47);
console.log('Actor visuals timing, isolation, bounds and cancellation passed');

const slow=new GfxManager({gfxRenderer:{getCache:()=>({getDurationTicks:()=>50})}} as any);
receiveActorVisual(message({clip:{kind:'graphic',id:398,speed:.25,durationMs:0,loop:false,height:0,hueShift:120}}),slow);
const coloured=[...slow.getActorInstances('npc',4)][0];assert.equal(coloured.durationMs,4000);assert.equal(coloured.hueShift,120);coloured.startTimeMs=0;assert.equal(graphicAgeMs(coloured,2000),500);
receiveActorVisual(message({token:'v999',clip:{kind:'graphic',id:398,speed:1,durationMs:0,loop:false,height:0,hueShift:181}}),slow);assert.equal([...slow.getActorInstances('npc',4)].length,1);
