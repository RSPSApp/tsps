import type { OsrsClient } from "../../OsrsClient";
import { resolveHelperSceneMap, helperMapLocalTile } from "./QuestHelperScene";
import type { HelperGeometry } from "./QuestHelperProtocol";

function base64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/** Camera uses world tiles, downward Y and the same signed heights as RuneLite. */
export function collectQuestHelperGeometry(client: OsrsClient, scene: {baseX:number;baseY:number}, includeTerrain: boolean): HelperGeometry {
    const camera=client.camera;
    const renderer=client.renderer;
    const x=(camera.pos[0]-scene.baseX)*128,y=(camera.pos[2]-scene.baseY)*128,z=camera.pos[1]*128;
    const pitch=camera.getScenePitchAngle(),yaw=camera.yaw;
    const geometry:HelperGeometry={
        x:0,y:0,width:renderer.canvas.width,height:renderer.canvas.height,
        mouse: client.inputManager ? {x:client.inputManager.mouseX,y:client.inputManager.mouseY}:undefined,
        baseX:scene.baseX,baseY:scene.baseY,projectionType:camera.projectionType===0?"perspective":"orthographic",
        gpu:true,cameraX:Math.trunc(x),cameraY:Math.trunc(y),cameraZ:Math.trunc(z),cameraPitch:Math.trunc(pitch),cameraYaw:Math.trunc(yaw),
        cameraFpX:x,cameraFpY:y,cameraFpZ:z,cameraFpPitch:pitch*Math.PI/1024,cameraFpYaw:yaw*Math.PI/1024,
        scale:camera.viewportZoom*camera.getViewZoomScale(),viewportWidth:camera.viewportWidth,viewportHeight:camera.viewportHeight,
        viewportXOffset:camera.viewportXOffset,viewportYOffset:camera.viewportYOffset,
        screenWidth:camera.screenWidth||renderer.canvas.width,screenHeight:camera.screenHeight||renderer.canvas.height,
        viewProjectionMatrix:Array.from(camera.viewProjMatrix),
    };
    if(!includeTerrain)return geometry;
    const heights=new Uint8Array(4*105*105*2),heightView=new DataView(heights.buffer),settings=new Uint8Array(4*104*104);
    for(let x=0;x<105;x++)for(let y=0;y<105;y++){
        // The final vertex may belong to the previous tile's loaded border.
        const sampleX=scene.baseX+Math.min(x,103),sampleY=scene.baseY+Math.min(y,103);
        const map=resolveHelperSceneMap(client,sampleX,sampleY);
        const local=map?helperMapLocalTile(map,sampleX,sampleY):undefined;
        if(!map||!local)throw new Error(`Projection terrain is unavailable at ${sampleX},${sampleY}.`);
        const ix=local.x+map.borderSize+(x===104?1:0),iy=local.y+map.borderSize+(y===104?1:0),size=map.heightMapSize;
        if(ix<0||iy<0||ix>=size||iy>=size)throw new Error("Projection terrain vertex is unavailable.");
        for(let plane=0;plane<4;plane++){
            const height=map.heightMapData[plane*size*size+iy*size+ix];
            if(height===undefined)throw new Error("Projection height plane is unavailable.");
            heightView.setInt16(((plane*105+x)*105+y)*2,height,true);
            if(x<104&&y<104){
                const flag=map.tileRenderFlags[plane]?.[local.x+map.borderSize]?.[local.y+map.borderSize];
                if(flag===undefined)throw new Error("Projection tile settings are unavailable.");
                settings[(plane*104+x)*104+y]=flag;
            }
        }
    }
    // These virtual scene tiles represent known GPU terrain, including empty floor.
    // Missing map/vertex data above aborts the snapshot; it is never fabricated as zero.
    const loaded=new Uint8Array(Math.ceil(4*104*104/8));
    for(let index=0;index<4*104*104;index++)loaded[index>>3]|=1<<(index&7);
    geometry.loadedTilesPacked={encoding:"bitset-lsb-base64",shape:[4,104,104],data:base64(loaded)};
    geometry.tileHeightsPacked={encoding:"int16-le-base64",shape:[4,105,105],multiplier:-8,data:base64(heights)};
    geometry.tileSettingsPacked={encoding:"uint8-base64",shape:[4,104,104],data:base64(settings)};
    return geometry;
}
