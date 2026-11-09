import assert from "node:assert/strict";

import { buildGroundItemGeometry } from "../render/ground/GroundItemMeshBuilder";
import { ObjModelLoader } from "../rs/config/objtype/ObjModelLoader";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

// An item on a boat's deck lies on the deck's plane, where the deck's floor and locs are, not on
// the scene's level 0 under it: there it sank into the hull and showed through its windows.
const info = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
const textures = factory.getTextureLoader();
const objModels = new ObjModelLoader(factory.getObjTypeLoader(), factory.getModelLoader(), textures);

function planesFor(interactionPlane: number): { sampled: number[]; drawn: number[] } {
    const sampled: number[] = [];
    const map: any = {
        mapX: 50,
        mapY: 50,
        interactionPlane,
        getRenderBaseTileX: () => 3200,
        getRenderBaseTileY: () => 3200,
        getLocalTileSpan: () => 64,
        getTileRenderFlag: () => 0,
        getObjSurfaceHeight: (level: number) => {
            sampled.push(level);
            return 0;
        },
    };
    const stacks = [{ id: 1, itemId: 995, quantity: 500, tile: { x: 3205, y: 3206, level: 0 } }];
    const data = buildGroundItemGeometry(map, stacks as any, objModels, textures, new Map());
    assert.ok(data, "the coins build");
    return { sampled, drawn: Array.from(data!.planes.main) };
}

const deck = planesFor(1);
assert.deepEqual(deck.sampled, [1], "on a deck the height comes from the deck plane");
assert.ok(deck.drawn.length > 0 && deck.drawn.every((plane) => plane === 1), "and it is drawn on that plane");

const land = planesFor(-1);
assert.deepEqual(land.sampled, [0], "elsewhere the tile's own level is used");
assert.ok(land.drawn.every((plane) => plane === 0));

console.log("deck-ground-item-plane: ok");
