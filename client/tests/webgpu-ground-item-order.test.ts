import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WebGPUOverlays } from "../render/webgpu/overlays/WebGPUOverlays";

// Issue 2003: WebGPU drew ground items after the actors' alpha, so a loot beam's translucent
// glow over a dropped item (a broken Dharok's greataxe) had written its depth first and hid
// almost all of it. OSRS paints a tile's items before what stands on it, and WebGL draws them
// with their map, so the beam blends over the item.
test("WebGPU draws ground items before the actors' alpha", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../render/webgpu/WebGPURenderer.ts"), "utf8");
    const at = (needle: string) => {
        const index = source.indexOf(needle);
        assert.ok(index >= 0, needle);
        assert.equal(source.indexOf(needle, index + 1), -1, `${needle} once`);
        return index;
    };
    const mapsAlpha = at("visible[i].drawAlpha(pass, roofPlaneLimit, this.frameScenery);");
    const groundItems = at("this.overlays?.drawGroundItems(pass);");
    const actorsAlpha = at("this.actors?.drawAlpha(pass);");
    const overlays = at("this.overlays?.drawWorld(pass);");
    assert.ok(mapsAlpha < groundItems, "after the maps' alpha, as before");
    assert.ok(groundItems < actorsAlpha, "before the actors' alpha (loot beams)");
    assert.ok(actorsAlpha < overlays, "tile markers stay last");
});

test("the overlays' world draw no longer draws the ground items a second time", () => {
    const calls: string[] = [];
    const overlays = Object.create(WebGPUOverlays.prototype) as any;
    overlays.initialized = true;
    overlays.renderer = {};
    overlays.groundMeshes = { drawWorld: () => calls.push("ground items") };
    overlays.tileMarker = { drawWorld: () => calls.push("tile markers") };
    const pass = {} as GPURenderPassEncoder;
    overlays.drawGroundItems(pass);
    overlays.drawWorld(pass);
    assert.deepEqual(calls, ["ground items", "tile markers"]);
});
