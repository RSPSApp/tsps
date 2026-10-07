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
