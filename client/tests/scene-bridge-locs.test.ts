import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LocModelType } from "../rs/config/loctype/LocModelType";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { CachePipeline } from "../../server/src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheMaps } from "../../server/src/main/typescript/elvarg/game/cache/CacheMaps";

// The server (as OSRS) sends a bridge's locs a plane below where the map stores them: the
// Motherlode Mine's upper level is plane 0 to the server and plane 1 in the map. A rockfall
// removed up there must disappear, and a vein spawned there must be drawn on the bridge.
// This integration check requires the project's installed cache and never downloads one.
async function bridgeLocsUseTheServerPlane(): Promise<void> {
    const root = resolve(__dirname, "../../server");
    const target = readFileSync(resolve(root, "target.txt"), "utf8").trim();
    assert.ok(existsSync(resolve(root, "caches", target, "main_file_cache.dat2")), "Run server ensure-cache first");
    await CachePipeline.initialize(root);
    try {
        const builder = new SceneBuilder({ game: "oldschool", revision: CachePipeline.getActive().revision } as any,
            {} as any, {} as any, {} as any,
            { load: () => ({ sizeX: 1, sizeY: 1 }) } as any, {} as any, new Map());
        const bridge = () => Array.from({ length: 64 }, () => new Uint8Array(64).fill(2));
        const flat = () => Array.from({ length: 64 }, () => new Uint8Array(64));
        const scene = { sizeX: 64, sizeY: 64, levels: 4, tileRenderFlags: [flat(), bridge(), flat(), flat()], collisionMaps: [] } as any;
        const mine = (58 << 8) | 88;
        const objectData = new Int8Array(CacheMaps.getRegion(mine)!.objectData!);
        const decode = () => {
            const placed: number[][] = [];
            builder.addLoc = (_scene, plane, x, y, id, shape) => { placed.push([plane, x, y, id, shape]); };
            builder.decodeLocs(scene, objectData, 0, 0, LocLoadType.NO_MODELS);
            return placed;
        };

        const upper = decode().find(([plane, , , id]) => plane === 1 && id === 26680);
        assert.ok(upper, "an upper-level rockfall is stored on map plane 1");
        const [, x, y, , shape] = upper;
        builder.setLocOverride(x, y, 0, -1, 0, undefined, undefined, undefined, undefined, undefined, shape as LocModelType);
        assert.ok(!decode().some(([plane, px, py, id]) => plane === 1 && px === x && py === y && id === 26680),
            "removed by the server on plane 0");
        builder.clearLocOverrides();

        builder.setLocSpawn(x, y, 0, 26661, LocModelType.WALL, 0);
        assert.ok(decode().some(([plane, px, py, id]) => plane === 1 && px === x && py === y && id === 26661),
            "spawned by the server on plane 0, drawn on the bridge");
        builder.clearLocSpawns();
        console.log("Bridge locs: server-plane removals and spawns passed");
    } finally {
        CachePipeline.getStore().close();
    }
}
bridgeLocsUseTheServerPlane().catch((error) => { console.error(error); process.exitCode = 1; });
