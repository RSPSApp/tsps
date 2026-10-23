import assert from "node:assert/strict";
import { test } from "node:test";

import { CLASSIC_FLAME_PALETTES, buildFlamePalette } from "../game/login/LoginScreenAnimation";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { GraphicsDefaults } from "../rs/config/defaults/GraphicsDefaults";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/** The palettes the client hardcoded before reading them from the cache. */
function hardcoded(): Int32Array[] {
    const red = new Int32Array(256), green = new Int32Array(256), blue = new Int32Array(256);
    for (let i = 0; i < 64; i++) {
        red[i] = i * 262144;
        red[i + 64] = i * 1024 + 0xff0000;
        red[i + 128] = i * 4 + 0xffff00;
        red[i + 192] = 0xffffff;
        green[i] = i * 1024;
        green[i + 64] = i * 4 + 0xff00;
        green[i + 128] = i * 262144 + 0xffff;
        green[i + 192] = 0xffffff;
        blue[i] = i * 4;
        blue[i + 64] = i * 262144 + 0xff;
        blue[i + 128] = i * 1024 + 0xff00ff;
        blue[i + 192] = 0xffffff;
    }
    return [red, green, blue];
}

test("the classic five colours build the classic flame palettes exactly", () => {
    hardcoded().forEach((expected, index) => {
        assert.deepEqual(buildFlamePalette(CLASSIC_FLAME_PALETTES[index]), expected, `palette ${index + 1}`);
    });
});

test("a palette runs through its five colours, 64 entries apart", () => {
    const palette = buildFlamePalette([0x000000, 0x006600, 0x00ff00, 0x99ff33, 0xffffff]);
    assert.equal(palette[0], 0x000000);
    assert.equal(palette[64], 0x006600);
    assert.equal(palette[128], 0x00ff00);
    assert.equal(palette[192], 0x99ff33);
    assert.equal(palette[255], 0xfefffc, "the last entry is one step short of white");
});

/** The login screen's flames take their colours from the cache (Raids 4 made them green). */
test("the cache's graphics defaults hold the three flame palettes", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const defaults = GraphicsDefaults.load(info, CacheSystem.fromFiles(info, loadCache(info).files));
    assert.equal(defaults.flamePalettes?.length, 3, info.name);
    for (const colours of defaults.flamePalettes!) {
        assert.equal(colours.length, 5);
        assert.ok(colours.every((colour) => colour >= 0 && colour <= 0xffffff));
    }
});
