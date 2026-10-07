import assert from "node:assert/strict";
import { test } from "node:test";

import { CacheSystem } from "../rs/cache/CacheSystem";
import { GraphicsDefaults } from "../rs/config/defaults/GraphicsDefaults";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * The compass, map markers, head icons and scrollbars come from the cache's graphics defaults.
 * Rev 241 moved its sprite list to a new opcode; decoded wrong, every sprite reads -1 and the
 * compass and world map vanish.
 */
test("the cache's graphics defaults name every sprite the client draws with", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const defaults: any = GraphicsDefaults.load(info, CacheSystem.fromFiles(info, loadCache(info).files));
    for (const key of ["compass", "mapEdge", "mapScenes", "headIconsPk", "headIconsPrayer", "headIconsHint", "mapMarkers", "crosses", "mapDots", "scrollBars", "modIcons"]) {
        assert.ok(defaults[key] >= 0, `${key} (${info.name})`);
    }
});
