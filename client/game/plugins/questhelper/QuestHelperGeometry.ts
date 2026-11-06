import type { OsrsClient } from "../../OsrsClient";
import { createHelperSceneMapResolver, helperMapLocalTile, type HelperSceneMap } from "./QuestHelperScene";
import type { HelperGeometry } from "./QuestHelperProtocol";
import { encodeBase64 } from "../../../common/network/ChunkedPluginMessages";
import { digest } from "./QuestHelperReuse";

/** The terrain parts of HelperGeometry, packed as the bridge reads them. */
export type PackedTerrain = Required<Pick<HelperGeometry, "loadedTilesPacked" | "tileHeightsPacked" | "tileSettingsPacked">>;

/** The scene's terrain, sampled once; packed only when the bridge doesn't already hold it. */
export type HelperTerrain = {
    /** Changes with the terrain; the server is told it by name once, then by digest. */
    digest: string;
    pack(): PackedTerrain;
};

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
    return {...geometry,...collectQuestHelperTerrain(client,scene).pack()};
}

/**
 * The scene's heights and tile flags for upstream's Perspective. A tile whose map square the
 * client hasn't built (low-end devices only build squares near the player) is reported unloaded
 * rather than aborting the snapshot: the bridge's scene then lacks that tile, as the client's
 * does. Nothing is fabricated for a loaded tile, and a scene with no terrain at all still fails.
 */
export function collectQuestHelperTerrain(client: OsrsClient, scene: {baseX:number;baseY:number}): HelperTerrain {
    const resolve=createHelperSceneMapResolver(client);
    const heights=new Int16Array(4*105*105),settings=new Uint8Array(4*104*104);
    const loaded=new Uint8Array(Math.ceil(4*104*104/8));
    let loadedTiles=0;
    // A vertex belongs to four tiles; its height is read from whichever of them has a built map,
    // through that map's loaded border (dx, dy offset into the vertex row/column of the tile to
    // its west or south). The scene's last row and column of vertices only have such neighbours.
    const vertex=(x:number,y:number):{map:HelperSceneMap;ix:number;iy:number}|undefined=>{
        for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]] as const){
            const tileX=x-dx,tileY=y-dy;
            if(tileX<0||tileY<0||tileX>103||tileY>103)continue;
            const sampleX=scene.baseX+tileX,sampleY=scene.baseY+tileY;
            const map=resolve(sampleX,sampleY);
            const local=map?helperMapLocalTile(map,sampleX,sampleY):undefined;
            if(!map||!local)continue;
            const ix=local.x+map.borderSize+dx,iy=local.y+map.borderSize+dy,size=map.heightMapSize;
            if(ix<0||iy<0||ix>=size||iy>=size)throw new Error("Projection terrain vertex is unavailable.");
            return {map,ix,iy};
        }
        return undefined;
    };
    for(let x=0;x<105;x++)for(let y=0;y<105;y++){
        const at=vertex(x,y);
        if(!at)continue;
        const {map,ix,iy}=at,size=map.heightMapSize;
        for(let plane=0;plane<4;plane++){
            const height=map.heightMapData[plane*size*size+iy*size+ix];
            if(height===undefined)throw new Error("Projection height plane is unavailable.");
            heights[(plane*105+x)*105+y]=height;
        }
        if(x===104||y===104)continue;
        // The tile's own flags and loaded bit come from its own map; a vertex borrowed from a
        // neighbour doesn't make an unbuilt tile loaded.
        const sampleX=scene.baseX+x,sampleY=scene.baseY+y;
        const own=resolve(sampleX,sampleY);
        const local=own?helperMapLocalTile(own,sampleX,sampleY):undefined;
        if(!own||!local)continue;
        for(let plane=0;plane<4;plane++){
            const flag=own.tileRenderFlags[plane]?.[local.x+own.borderSize]?.[local.y+own.borderSize];
            if(flag===undefined)throw new Error("Projection tile settings are unavailable.");
            settings[(plane*104+x)*104+y]=flag;
            // These virtual scene tiles represent known GPU terrain, including empty floor.
            const index=(plane*104+x)*104+y;
            loaded[index>>3]|=1<<(index&7);
            loadedTiles++;
        }
    }
    if(!loadedTiles)throw new Error(`Projection terrain is unavailable at ${scene.baseX},${scene.baseY}.`);
    const heightBytes=new Uint8Array(heights.buffer,heights.byteOffset,heights.byteLength);
    if(new Uint8Array(new Uint16Array([1]).buffer)[0]!==1)throw new Error("Projection terrain needs a little-endian host.");
    return {
        digest: digest([scene.baseX,scene.baseY,bytesDigest(loaded),bytesDigest(heightBytes),bytesDigest(settings)]),
        pack: () => ({
            loadedTilesPacked:{encoding:"bitset-lsb-base64",shape:[4,104,104],data:encodeBase64(loaded)},
            tileHeightsPacked:{encoding:"int16-le-base64",shape:[4,105,105],multiplier:-8,data:encodeBase64(heightBytes)},
            tileSettingsPacked:{encoding:"uint8-base64",shape:[4,104,104],data:encodeBase64(settings)},
        }),
    };
}

/** FNV-1a over raw bytes, as a number the terrain digest folds in. */
function bytesDigest(bytes: Uint8Array): number {
    let hash = 0x811c9dc5 | 0;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
    return hash | 0;
}
