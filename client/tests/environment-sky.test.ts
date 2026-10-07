import { strict as assert } from "node:assert";

import { environmentRegionAt, updateSkyColor } from "../render/render/environment";
import { setSkyColor } from "../render/render/settings";

// A packed REBUILD_REGION template chunk (see client/common/instance/InstanceTypes.ts).
const pack = (plane: number, chunkX: number, chunkY: number, rotation = 0) =>
    ((plane & 3) << 24) | ((chunkX & 0x3ff) << 14) | ((chunkY & 0x7ff) << 3) | ((rotation & 3) << 1);

function host(overrides: Record<string, unknown> = {}): any {
    return {
        instanceActive: false, instanceTemplateChunks: null, instanceRegionX: 0, instanceRegionY: 0,
        skyColor: new Float32Array([185 / 255, 214 / 255, 1, 1]), skyColorOverride: false,
        playerPosUni: new Float32Array([0, 0]),
        ...overrides,
    };
}

function instanceTilesUseTheirTemplateRegion(): void {
    // A Gauntlet room copied from chunk (232, 704) - region 7512 - into scene chunk (6, 6).
    const chunks = Array.from({ length: 4 }, () => Array.from({ length: 13 }, () => new Array(13).fill(-1)));
    chunks[1][6][6] = pack(1, 232, 704, 2);
    const regionX = 1030;
    const regionY = 210;
    const inside = host({ instanceActive: true, instanceTemplateChunks: chunks, instanceRegionX: regionX, instanceRegionY: regionY });
    const tileX = regionX * 8 + 3;
    const tileY = regionY * 8 + 5;
    assert.equal(environmentRegionAt(inside, tileX, tileY), 7512, "the Gauntlet room's own region");
    assert.equal(environmentRegionAt(inside, tileX + 8, tileY), (((tileX + 8) >> 6) << 8) | (tileY >> 6),
        "an empty chunk falls back to where it is");
    assert.equal(environmentRegionAt(host(), 3222, 3218), 12850, "the normal map uses its own region");
}

function theSkyFollowsTheAreaUnlessPicked(): void {
    const chunks = Array.from({ length: 4 }, () => Array.from({ length: 13 }, () => new Array(13).fill(-1)));
    chunks[1][6][6] = pack(1, 232, 704);
    const renderer = host({ instanceActive: true, instanceTemplateChunks: chunks, instanceRegionX: 1030, instanceRegionY: 210,
        playerPosUni: new Float32Array([1030 * 8 + 4, 210 * 8 + 4]) });
    for (let frame = 0; frame < 60; frame++) updateSkyColor(renderer);
    // 117HD's THE_GAUNTLET: fog colour (9, 6, 6).
    assert.deepEqual(Array.from(renderer.skyColor.slice(0, 3), (c: number) => Math.round(c * 255)), [9, 6, 6]);

    setSkyColor(renderer, 9, 6, 6);
    assert.equal(renderer.skyColorOverride, false, "the panel echoing the current colour isn't a pick");
    setSkyColor(renderer, 255, 0, 0);
    assert.equal(renderer.skyColorOverride, true);
    updateSkyColor(renderer);
    assert.equal(Math.round(renderer.skyColor[0] * 255), 255, "a picked colour stays");
}

instanceTilesUseTheirTemplateRegion();
theSkyFollowsTheAreaUnlessPicked();
console.log("Environment sky tests passed");
