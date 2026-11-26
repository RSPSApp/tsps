import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentationSequence,nextVisualOptions} from '../shared/presentation.mjs';
import {newVisual} from '../shared/visuals.mjs';

test('sequence display follows actual cue time instead of insertion order and leaves saved clips unchanged',()=>{
 const clips=[newVisual(398,{delayMs:0,nativeFeature:'sacrifice',nativeGraphic:377,nativeRecipient:'target'}),newVisual(1211,{recipient:'player',phase:'launch',speed:.5}),newVisual(369,{delayMs:250})],before=JSON.stringify(clips);
 const rows=presentationSequence(clips,{impactMs:600,previewClips:[{...clips[0],previewIndex:0,delayMs:4800}],naturalDuration:()=>1200});
 assert.deepEqual(rows.map(row=>row.index),[1,2,0]);assert.deepEqual(rows.map(row=>row.start),[0,850,5400]);assert.equal(rows[0].length,2400);assert.equal(JSON.stringify(clips),before);
});
test('overlap and identical scheduling are reported only on matching recipients',()=>{
 const clips=[newVisual(398),newVisual(398,{hueShift:0}),newVisual(369,{recipient:'player'}),newVisual(1211,{recipient:'both',delayMs:100})],rows=presentationSequence(clips);
 assert.deepEqual(rows[0].duplicates,[1]);assert.deepEqual(rows[0].overlaps,[1,3]);assert.deepEqual(rows.find(row=>row.index===2).overlaps,[3]);
 const variants=presentationSequence([newVisual(398,{durationMs:2000}),newVisual(398,{durationMs:2000,height:32}),newVisual(398,{durationMs:2000,speed:.5}),newVisual(398,{durationMs:2000,loop:true})]);
 assert.ok(variants.every(row=>row.duplicates.length===0),'different placement, speed or repetition must not be labelled as identical effects');
});
test('adding after a clip follows its speed, duration, cue and placement without copying its appearance',()=>{
 const clip=newVisual(398,{speed:.5,recipient:'target',phase:'impact',delayMs:200,nativeFeature:'sacrifice',nativeGraphic:377,nativeRecipient:'target',height:32,heightMode:'custom',hueShift:90});
 assert.deepEqual(nextVisualOptions(clip,1200),{recipient:'target',phase:'impact',delayMs:2600,height:32,nativeFeature:'sacrifice',nativeGraphic:377,nativeRecipient:'target',heightMode:'custom'});
 assert.equal(nextVisualOptions({...clip,durationMs:3000},1200).delayMs,3200);assert.throws(()=>nextVisualOptions({...clip,delayMs:119000},1200),/120-second limit/);
});
