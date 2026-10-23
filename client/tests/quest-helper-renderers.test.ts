import { strict as assert } from 'node:assert';
import { collectHelperSceneObjects, resolveHelperSceneMap } from '../game/plugins/questhelper/QuestHelperScene';
import { collectQuestHelperGeometry } from '../game/plugins/questhelper/QuestHelperGeometry';


async function main(){ Object.assign(globalThis,{self:globalThis}); const {WebGLMapSquare}=await import('../render/WebGLMapSquare'); const {WebGPUMapSquare}=await import('../render/webgpu/WebGPUMapSquare');
function fixture(Ctor:any){const map:any=Object.create(Ctor.prototype); const span=104,size=106;const offsets=Array.from({length:4},()=>new Uint32Array(span*span+1));for(let i=1;i<offsets[0].length;i++)offsets[0][i]=1;Object.assign(map,{mapX:99,mapY:99,renderPosX:50,renderPosY:50,borderSize:1,heightMapSize:size,heightMapData:new Int16Array(4*size*size).fill(12),tileRenderFlags:Array.from({length:4},()=>Array.from({length:size},()=>new Uint8Array(size).fill(2))),tileLocOffsetsByLevel:offsets,tileLocIdsByLevel:[Int32Array.of(100),new Int32Array(),new Int32Array(),new Int32Array()],tileLocTypeRotByLevel:[Uint8Array.of(10|(3<<6)),new Uint8Array(),new Uint8Array(),new Uint8Array()],locIdsAtLocalBuffer:[],locTypeRotsAtLocalBuffer:[]});return map;}
const camera:any={pos:[3200,-6,3201],yaw:123,getScenePitchAngle:()=>255,getViewZoomScale:()=>1,viewportZoom:512,viewportWidth:765,viewportHeight:503,viewportXOffset:0,viewportYOffset:0,screenWidth:765,screenHeight:503,viewProjMatrix:new Float32Array(16),projectionType:0};
for(const Ctor of [WebGLMapSquare,WebGPUMapSquare]){
const map=fixture(Ctor);const client:any={camera,controlledPlayerServerId:1,playerEcs:{getIndexForServerId:()=>0,getWorldViewId:()=>-1},renderer:{canvas:{width:765,height:503},mapManager:{getMapForWorldTile:()=>map}},worldViewManager:{}};
const objects=collectHelperSceneObjects(client,{baseX:3200,baseY:3200});assert.deepEqual(objects,[{id:100,x:3200,y:3200,plane:0,type:10,orientation:3}],Ctor.name+' uses actual CSR scene IDs/rotations');
const geometry=collectQuestHelperGeometry(client,{baseX:3200,baseY:3200},true);assert.equal(Buffer.from(geometry.tileHeightsPacked!.data,'base64').readInt16LE(0),12);assert.equal(Buffer.from(geometry.tileSettingsPacked!.data,'base64')[0],2);
const overlay=fixture(Ctor);client.playerEcs.getWorldViewId=()=>5;client.worldViewManager={getWorldView:()=>({containsTile:()=>true}),getOverlayMapSquare:()=>overlay};assert.equal(resolveHelperSceneMap(client,3200,3200),overlay,'controlled subworld takes precedence');
}
console.log('quest helper WebGL/WebGPU native maps, instances, subworlds and packed geometry passed');
} main().catch(error=>{console.error(error);process.exitCode=1;});
