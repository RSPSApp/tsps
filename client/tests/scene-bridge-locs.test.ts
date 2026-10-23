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

// LOC_ADD_CHANGE locs are added after the scene is built, when the bridge's tiles are already a
// plane down but its heights are not. A vein the server spawns on plane 0 at the Motherlode
// Mine's upper level must stand on plane 1's heights (the walkway), not the cave floor below it.
function locsAddedToABuiltSceneStandOnTheBridge(): void {
    const vein = { sizeX: 1, sizeY: 1, contourGroundType: 1, contourGroundParam: -1, isInteractive: 1, seqId: -1, clipType: 0, clipped: false };
    const builder = new SceneBuilder({ game: "oldschool", revision: 241 } as any,
        {} as any, {} as any, {} as any, { load: () => vein } as any, {} as any, new Map());
    const heights = (height: number) => Array.from({ length: 64 }, () => new Int32Array(64).fill(height));
    const flags = () => Array.from({ length: 64 }, () => new Uint8Array(64));
    const renderFlags = [flags(), flags(), flags(), flags()];
    renderFlags[1][40][20] = 2;
    const walls: Array<{ level: number; x: number; height: number; entityLevel: number }> = [];
    const scene = {
        sizeX: 64, sizeY: 64, levels: 4,
        tileHeights: [heights(-184), heights(-504), heights(-504), heights(-504)],
        tileRenderFlags: renderFlags,
        collisionMaps: [],
        newWall: (level: number, x: number, _y: number, height: number, entity: any) => {
            walls.push({ level, x, height, entityLevel: entity.level });
        },
    } as any;

    builder.addLocToBuiltScene(scene, 0, 40, 20, 26661, LocModelType.WALL, 0, LocLoadType.NO_MODELS);
    builder.addLocToBuiltScene(scene, 0, 41, 20, 26661, LocModelType.WALL, 0, LocLoadType.NO_MODELS);
    assert.deepEqual(walls, [
        { level: 0, x: 40, height: -504, entityLevel: 1 },
        { level: 0, x: 41, height: -184, entityLevel: 0 },
    ], "drawn on the server's plane, at the map plane's height on a bridge only");
    console.log("Bridge locs: locs added to a built scene stand on the bridge passed");
}

bridgeLocsUseTheServerPlane()
    .then(locsAddedToABuiltSceneStandOnTheBridge)
    .catch((error) => { console.error(error); process.exitCode = 1; });
