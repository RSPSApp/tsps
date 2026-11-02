import assert from "node:assert/strict";
import { test } from "node:test";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { IndexType } from "../rs/cache/IndexType";
import { WorldMapState, compositeMapFileFor, worldMapGroupId } from "../rs/map/WorldMapArea";
import { worldMapFormatForTests as F } from "../rs/map/WorldMapArchiveRenderer";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * The world map reads its areas, composite maps and geography in either cache format: before
 * rev 241 by archive name with explicit geography references and headed files; from 241 by
 * fixed group ids, region-keyed geography (one file per area), headerless, with loc ids as ints.
 */
test("a chunk region's geography follows the composite map's entry order, not chunk x/y order", () => {
    // Each entry's chunk is 64 simple tiles (flags 1, then an underlay id). The Stronghold of
    // Security lists its chunks out of x/y order; reading the file in x/y order puts every
    // chunk's tiles under the wrong chunk and scrambles the map.
    const chunks = [[5, 3], [5, 1], [4, 7], [0, 0]];
    const bytes = new Int8Array(chunks.length * 64 * 3);
    let offset = 0;
    chunks.forEach((_, index) => {
        for (let tile = 0; tile < 64; tile++) {
            bytes[offset++] = 1;
            bytes[offset++] = (1000 + index) >> 8;
            bytes[offset++] = (1000 + index) & 0xff;
        }
    });
    const entries = chunks.map(([chunkX, chunkY]) => ({
        kind: 1,
        minPlane: 0,
        planes: 1,
        regionXLow: 0,
        regionYLow: 0,
        chunkXLow: 0,
        chunkYLow: 0,
        regionX: 29,
        regionY: 81,
        chunkX,
        chunkY,
        groupId: 7505,
        fileId: 18,
        headerless: true,
        geographyLoaded: false,
    })) as any[];
    F.decodeHeaderlessChunkRegion(entries, bytes);
    entries.forEach((entry, index) => {
        const tile = ((entry.chunkX * 8) << 6) | (entry.chunkY * 8);
        assert.equal(entry.floorUnderlayIds[tile], 1000 + index, `chunk ${entry.chunkX},${entry.chunkY}`);
        assert.equal(entry.geographyLoaded, true);
    });
});

test("every world map area, composite map and geography file in the cache decodes", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const cache = CacheSystem.fromFiles(info, loadCache(info).files);
    const state: any = WorldMapState.load(cache);
    assert.ok(state.areasById.size > 0 && state.mainArea, "the areas load, main among them");

    const index: any = cache.getIndex(IndexType.OSRS.worldMap);
    const geography: any = cache.getIndex(IndexType.OSRS.worldMapGeography);
    const composite = index.getArchive(worldMapGroupId(index, "compositemap"));
    let regions = 0;
    for (const area of state.areasById.values()) {
        const file = compositeMapFileFor(composite, area);
        if (!file) continue;
        const { data0, data1 } = F.readCompositeMap(file.data, true, area.id);
        for (const data of data0 as any[]) {
            F.decodeWorldMapData0Geography(data, geography.getFile(data.groupId, data.fileId).data);
            regions++;
        }
        const byFile = new Map<string, any[]>();
        for (const data of data1 as any[]) {
            const key = `${data.groupId}/${data.fileId}`;
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key)!.push(data);
        }
        for (const entries of byFile.values()) {
            if (!entries[0].headerless) continue; // before 241: a file per chunk, read on demand
            F.decodeHeaderlessChunkRegion(entries, geography.getFile(entries[0].groupId, entries[0].fileId).data);
            regions++;
        }
    }
    assert.ok(regions > 1000, `${regions} regions decoded (${info.name})`);
});
