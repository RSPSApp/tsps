import type { OsrsClient } from "../../OsrsClient";

/** CPU scene data retained by both native rendering backends. */
export interface HelperSceneMap {
    borderSize: number;
    heightMapSize: number;
    heightMapData: Int16Array;
    tileRenderFlags: Uint8Array[][];
    getRenderBaseTileX(): number;
    getRenderBaseTileY(): number;
    getLocalTileSpan(): number;
    getLocIdsAtLocal(plane: number, x: number, y: number): number[];
    getLocTypeRotsAtLocal(plane: number, x: number, y: number): number[];
}

export function resolveHelperSceneMap(client: OsrsClient, x: number, y: number): HelperSceneMap | undefined {
    const renderer = client.renderer;
    const backend = renderer as typeof renderer & {
        getPreferredMapForWorldTile?: (x: number, y: number) => HelperSceneMap | undefined;
    };
    if (backend.getPreferredMapForWorldTile) return backend.getPreferredMapForWorldTile(x, y);
    // WebGPU uses the same preferred-world-view policy in its overlay host. Ship decks
    // are deliberately excluded from MapManager's ordinary world-tile lookup.
    const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    const viewId = index === undefined ? -1 : client.playerEcs.getWorldViewId?.(index) ?? -1;
    if (viewId >= 0) {
        const view = client.worldViewManager.getWorldView(viewId);
        if (view?.containsTile(x, y)) {
            const overlay = client.worldViewManager.getOverlayMapSquare(viewId, renderer.mapManager);
            if (overlay) return overlay as unknown as HelperSceneMap;
        }
    }
    if (!renderer.mapManager?.getMapForWorldTile) throw new Error("Native scene maps are unavailable for this renderer.");
    return renderer.mapManager.getMapForWorldTile(x, y) as unknown as HelperSceneMap | undefined;
}

export function helperMapLocalTile(map: HelperSceneMap, x: number, y: number): {x:number;y:number} | undefined {
    const localX = x - map.getRenderBaseTileX(), localY = y - map.getRenderBaseTileY();
    const span = map.getLocalTileSpan();
    return localX >= 0 && localY >= 0 && localX < span && localY < span ? {x:localX,y:localY} : undefined;
}

export function collectHelperSceneObjects(client: OsrsClient, scene: {baseX:number;baseY:number}): {id:number;x:number;y:number;plane:number;type?:number;orientation?:number}[] {
    const result: {id:number;x:number;y:number;plane:number;type?:number;orientation?:number}[] = [];
    const renderer = client.renderer as typeof client.renderer & {getLocIdsAtTileAllLevels?:(x:number,y:number)=>{id:number;level:number;typeRot?:number}[]};
    for (let x=scene.baseX;x<scene.baseX+104;x++) for(let y=scene.baseY;y<scene.baseY+104;y++) {
        // Keep the existing WebGL query usable for lightweight hosts without MapManager.
        if (!renderer.mapManager && renderer.getLocIdsAtTileAllLevels) {
            for(const loc of renderer.getLocIdsAtTileAllLevels(x,y)) {
                if(result.length>=20000)throw new Error("Scene object snapshot exceeds the safety bound.");
                result.push({id:loc.id,x,y,plane:loc.level,type:loc.typeRot===undefined?undefined:loc.typeRot&63,orientation:loc.typeRot===undefined?undefined:loc.typeRot>>>6});
            }
            continue;
        }
        const map=resolveHelperSceneMap(client,x,y);
        const local=map?helperMapLocalTile(map,x,y):undefined;
        if(!map||!local)continue; // unloaded tiles remain absent, as in the native visible scene
        if(!map.getLocIdsAtLocal||!map.getLocTypeRotsAtLocal)throw new Error("Native scene object data is unavailable.");
        for(let plane=0;plane<4;plane++) {
            const ids=map.getLocIdsAtLocal(plane,local.x,local.y);
            const rotations=map.getLocTypeRotsAtLocal(plane,local.x,local.y);
            for(let i=0;i<ids.length;i++) {
                if(result.length>=20000)throw new Error("Scene object snapshot exceeds the safety bound.");
                const packed=rotations[i];
                result.push({id:ids[i],x,y,plane,type:packed===undefined?undefined:packed&63,orientation:packed===undefined?undefined:packed>>>6});
            }
        }
    }
    return result;
}
