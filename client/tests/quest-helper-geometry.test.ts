import { strict as assert } from 'node:assert';
import { collectQuestHelperGeometry } from '../game/plugins/questhelper/QuestHelperGeometry';
const size=107;const map:any={heightMapSize:size,borderSize:1,heightMapData:new Int16Array(4*size*size).fill(30),tileRenderFlags:Array.from({length:4},()=>Array.from({length:size},()=>new Uint8Array(size).fill(2)))};
Object.assign(map,{getRenderBaseTileX:()=>3150,getRenderBaseTileY:()=>3150,getLocalTileSpan:()=>105});
const client:any={camera:{pos:[3200,-6,3201],yaw:123,pitch:200,getScenePitchAngle:()=>255,getViewZoomScale:()=>1,viewportZoom:512,viewportWidth:765,viewportHeight:503,viewportXOffset:0,viewportYOffset:0,screenWidth:765,screenHeight:503,viewProjMatrix:new Float32Array(16).fill(1),projectionType:0},renderer:{canvas:{width:765,height:503},getPreferredMapForWorldTile:()=>map,getMapLocalTile:(_:any,x:number,y:number)=>({x:x-3150,y:y-3150})}};
const geometry=collectQuestHelperGeometry(client,{baseX:3150,baseY:3150},true);const heightBytes=Buffer.from(geometry.tileHeightsPacked!.data,"base64");const flags=Buffer.from(geometry.tileSettingsPacked!.data,"base64");
assert.equal(Buffer.from(geometry.loadedTilesPacked!.data,'base64').length,5408);
assert.equal(Buffer.from(geometry.loadedTilesPacked!.data,'base64')[5407],255);
assert.equal(geometry.cameraFpX,6400);assert.equal(geometry.cameraFpY,6528);assert.equal(geometry.cameraFpZ,-768);assert.equal(geometry.cameraFpPitch,255*Math.PI/1024);assert.equal(heightBytes.readInt16LE(((3*105+104)*105+104)*2)*-8,-240);assert.equal(flags[(2*104+103)*104+103],2);
client.renderer.getPreferredMapForWorldTile=()=>undefined;assert.throws(()=>collectQuestHelperGeometry(client,{baseX:3150,baseY:3150},true),/unavailable/i);
console.log('quest helper lossless geometry and missing-map boundaries passed');

import { Camera } from '../game/Camera';
import { worldToScreen } from '../render/render/terrain/pick';
const camera=new Camera(3200,-2,3200,0,0);camera.setViewPitchOverride(0);camera.update(765,503);
const projection=collectQuestHelperGeometry({camera,renderer:{canvas:{width:765,height:503}}} as any,{baseX:3150,baseY:3150},false);
const matrix=projection.viewProjectionMatrix!;
const localX=(3201-3150)*128,localY=(3210-3150)*128,rlHeight=-240;
const vector=[localX/128+3150,rlHeight/128,localY/128+3150,1];
const clip=Array.from({length:4},(_,row)=>vector.reduce((sum,value,column)=>sum+value*matrix[column*4+row],0));
const projected=[(clip[0]/clip[3]+1)*.5*765,(1-clip[1]/clip[3])*.5*503];
const native=worldToScreen({osrsClient:{camera},app:{width:765,height:503}} as any,3201,-240/128,3210)!;
assert.ok(Math.abs(native[0]-projected[0])<.01);assert.ok(Math.abs(native[1]-projected[1])<.01,'RuneLite height sign matches native Y directly');
console.log('quest helper projection matrix matches native worldToScreen');

