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
    return createHelperSceneMapResolver(client)(x, y);
}

/**
 * A per-snapshot resolver of the map square behind a world tile. The controlled player's world
 * view is looked up once and plain squares are remembered by 64-tile square, so walking the
 * scene costs one map lookup per square instead of one per tile. MapManager's miss path scans
 * every square, which made that walk the dearest part of a snapshot on low-end clients, where
 * most of the 104x104 scene is deliberately unbuilt.
 */
export function createHelperSceneMapResolver(client: OsrsClient): (x: number, y: number) => HelperSceneMap | undefined {
    const renderer = client.renderer;
    const backend = renderer as typeof renderer & {
        getPreferredMapForWorldTile?: (x: number, y: number) => HelperSceneMap | undefined;
    };
    const mapManager = renderer.mapManager;
    if (!mapManager) {
        if (backend.getPreferredMapForWorldTile) return (x, y) => backend.getPreferredMapForWorldTile!(x, y);
        throw new Error("Native scene maps are unavailable for this renderer.");
    }
    if (!mapManager.getMapForWorldTile) throw new Error("Native scene maps are unavailable for this renderer.");
    // WebGPU uses the same preferred-world-view policy in its overlay host. Ship decks
    // are deliberately excluded from MapManager's ordinary world-tile lookup.
    const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    const viewId = index === undefined ? -1 : client.playerEcs.getWorldViewId?.(index) ?? -1;
    const view = viewId >= 0 ? client.worldViewManager.getWorldView(viewId) : undefined;
    const overlay = view ? (client.worldViewManager.getOverlayMapSquare(viewId, mapManager) as unknown as HelperSceneMap | undefined) : undefined;
    const squares = new Map<number, HelperSceneMap | undefined>();
    return (x, y) => {
        if (view && overlay && view.containsTile(x, y)) return overlay;
        const key = ((x >> 6) << 16) | (y >> 6);
        const known = squares.get(key);
        if (known && helperMapLocalTile(known, x, y)) return known;
        if (known === undefined && squares.has(key)) return undefined;
        const map = mapManager.getMapForWorldTile(x, y) as unknown as HelperSceneMap | undefined;
        squares.set(key, map);
        return map;
    };
}

export function helperMapLocalTile(map: HelperSceneMap, x: number, y: number): {x:number;y:number} | undefined {
    const localX = x - map.getRenderBaseTileX(), localY = y - map.getRenderBaseTileY();
    const span = map.getLocalTileSpan();
    return localX >= 0 && localY >= 0 && localX < span && localY < span ? {x:localX,y:localY} : undefined;
}

export type HelperSceneObject = {id:number;x:number;y:number;plane:number;type?:number;orientation?:number};

export function collectHelperSceneObjects(client: OsrsClient, scene: {baseX:number;baseY:number}): HelperSceneObject[] {
    const result: HelperSceneObject[] = [];
    const renderer = client.renderer as typeof client.renderer & {getLocIdsAtTileAllLevels?:(x:number,y:number)=>{id:number;level:number;typeRot?:number}[]};
    // Keep the existing WebGL query usable for lightweight hosts without MapManager.
    if (!renderer.mapManager && renderer.getLocIdsAtTileAllLevels) {
        for (let x=scene.baseX;x<scene.baseX+104;x++) for(let y=scene.baseY;y<scene.baseY+104;y++) {
            for(const loc of renderer.getLocIdsAtTileAllLevels(x,y)) {
                if(result.length>=20000)throw new Error("Scene object snapshot exceeds the safety bound.");
                result.push({id:loc.id,x,y,plane:loc.level,type:loc.typeRot===undefined?undefined:loc.typeRot&63,orientation:loc.typeRot===undefined?undefined:loc.typeRot>>>6});
            }
        }
        return result;
    }
    const resolve = createHelperSceneMapResolver(client);
    for (let x=scene.baseX;x<scene.baseX+104;x++) for(let y=scene.baseY;y<scene.baseY+104;y++) {
        const map=resolve(x,y);
        const local=map?helperMapLocalTile(map,x,y):undefined;
        if(!map||!local)continue; // unloaded tiles remain absent, as in the native visible scene
        if(!map.getLocIdsAtLocal||!map.getLocTypeRotsAtLocal)throw new Error("Native scene object data is unavailable.");
        for(let plane=0;plane<4;plane++) {
            const ids=map.getLocIdsAtLocal(plane,local.x,local.y);
            if(!ids.length)continue;
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
