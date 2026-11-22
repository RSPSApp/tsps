import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
for (const extension of [".png", ".jpg", ".webp"]) require.extensions[extension] = (module, file) => { module.exports = file; };
const { OsrsClient } = require("../game/OsrsClient");

const REGION_X = 48;
const REGION_Y = 54;
const archiveIcon = { localX: 12, localY: 23, elementId: 1, category: 0, spriteId: 1 };

/** The fields getWorldMapIcons reads, with an edited region at (48, 54). */
function client(opts: { minimapIcons?: any[]; minimapLoaded: boolean; areaId?: number; edited?: boolean }) {
    const key = (x: number, y: number, level = 0) => (level << 16) | (x << 8) | y;
    return {
        renderer: {
            mapRegionReplacements: new Map(opts.edited === false ? [] : [[(REGION_X << 8) | REGION_Y, {}]]),
            getMinimapIcons: () => opts.minimapIcons,
        },
        minimapImageUrls: new Map(opts.minimapLoaded ? [[key(REGION_X, REGION_Y), "blob:edited"]] : []),
        getMinimapImageKey: key,
        worldMap: {
            worldMapState: { getCurrentMapAreaId: () => opts.areaId ?? 0 },
            getWorldMapIcons: () => [archiveIcon],
        },
    };
}

const icons = (c: any) => OsrsClient.prototype.getWorldMapIcons.call(c, REGION_X, REGION_Y, 0);

test("an edited region uses its minimap icons on the world map", () => {
    const edited = [{ localX: 1, localY: 2, elementId: 5, category: 0, spriteId: 9 }];
    assert.deepEqual(icons(client({ minimapIcons: edited, minimapLoaded: true })), edited);
});

test("a loaded edited region whose icons were all removed shows none, not the archive's", () => {
    assert.equal(icons(client({ minimapIcons: undefined, minimapLoaded: true })), undefined);
});

test("an edited region not loaded yet, a non-surface area, and unedited regions use the archive", () => {
    assert.deepEqual(icons(client({ minimapIcons: undefined, minimapLoaded: false })), [archiveIcon]);
    assert.deepEqual(icons(client({ minimapIcons: [], minimapLoaded: true, areaId: 7 })), [archiveIcon]);
    assert.deepEqual(icons(client({ minimapIcons: undefined, minimapLoaded: true, edited: false })), [archiveIcon]);
});
