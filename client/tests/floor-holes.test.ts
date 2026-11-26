import { strict as assert } from "node:assert";
import path from "node:path";

import { Scene } from "../rs/scene/Scene";
import { LocEntity } from "../rs/scene/entity/LocEntity";
import { ModelData } from "../rs/model/ModelData";
import { CachePipeline } from "../../server/src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheMaps } from "../../server/src/main/typescript/elvarg/game/cache/CacheMaps";
import { CacheIndexDat2 } from "../../server/src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { OverlayFloorType } from "../rs/config/floortype/OverlayFloorType";
import { ByteBuffer } from "../rs/io/ByteBuffer";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { getIdFromTag } from "../rs/scene/entity/EntityTag";
import { LOC_OVERRIDE_REMOVED } from "../rs/scene/LocOverride";
import { getSceneLocs } from "../render/loc/SceneLocs";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

/**
 * Floor holes (ladder and trapdoor openings) are tiles the map gives no floor. They must draw
 * a dark surface so the sky is not visible through the opening, while unloaded map edges must
 * stay open to the sky.
 */
function floorHolesDrawDark(): void {
    const scene = new Scene(1, 12, 12);
    for (let x = 0; x < scene.sizeX; x++) {
        for (let y = 0; y < scene.sizeY; y++) {
            scene.tileUnderlays[0][x][y] = 1; // a real floor type
        }
    }
    scene.tileUnderlays[0][6][6] = 0; // enclosed floor hole
    scene.tileUnderlays[0][0][6] = 0; // unloaded map edge

    const floorType = {
        getHueBlend: () => 0,
        getHueMultiplier: () => 1,
        saturation: 0,
        lightness: 0,
    };
    const builder = new SceneBuilder(
        {} as any,
        {} as any,
        { load: () => floorType } as any,
        {} as any,
        {} as any,
        {} as any,
        new Map(),
    );
    builder.addTileModels(scene, false);

    const hole = scene.tiles[0][6][6]?.tileModel;
    assert.ok(hole, "an enclosed floor hole gets a tile model");
    assert.equal(hole.faces.length, 20, "pit: bottom plus four walls, drawn both windings");
    const deepest = Math.max(
        ...hole.faces.flatMap((face: any) => face.vertices.map((vertex: any) => vertex.y)),
    );
    assert.ok(deepest >= 60, "the pit bottom is below the floor in the client's y-down space");

    const edge = scene.tiles[0][0][6]?.tileModel;
    assert.equal(edge, undefined, "an unloaded map edge stays open");

    const floor = scene.tiles[0][5][6]?.tileModel;
    assert.ok(floor, "normal floor tiles still build");
}

floorHolesDrawDark();

function assertPit(model: any, label: string): void {
    assert.ok(model, label);
    assert.equal(model.faces.length, 20, `${label}: existing double-sided pit geometry`);
    assert.equal(model.underlayId, 0, `${label}: no HD ground material from the surrounding underlay`);
    assert.equal(model.overlayId, 0, `${label}: no HD overlay material`);
    const vertices = model.faces.flatMap((face: any) => face.vertices);
    assert.ok(vertices.every((vertex: any) => vertex.textureId === -1), `${label}: untextured`);
    assert.ok(vertices.every((vertex: any) => vertex.hsl === 0 || vertex.hsl === 7), `${label}: black bottom and dark walls`);
    assert.ok(Math.max(...vertices.map((v: any) => v.y)) - Math.min(...vertices.map((v: any) => v.y)) >= 60,
        `${label}: depth below the rim`);
}

async function castleWarsNativeCutouts(): Promise<void> {
    await CachePipeline.initialize(path.resolve(__dirname, "../../server"));
    try {
        const cacheInfo = { game: "oldschool", revision: CachePipeline.getActive().revision } as any;
        const configs = CacheIndexDat2.fromStore(2, CachePipeline.getStore());
        const overlayLoader = { load(id: number) {
            const type = new OverlayFloorType(id, cacheInfo);
            type.decode(new ByteBuffer(new Int8Array(configs.getFile(4, id)!.data)));
            type.post();
            return type;
        } };
        const cutout = overlayLoader.load(41);
        assert.equal(cutout.primaryRgb, 0xff00ff);
        assert.equal(cutout.textureId, -1);
        assert.equal(cutout.hideUnderlay, false);
        const floor = { getHueBlend: () => 0, getHueMultiplier: () => 1, saturation: 0, lightness: 0 };
        const builder = new SceneBuilder(cacheInfo, {} as any, { load: () => floor } as any,
            overlayLoader as any, {} as any, { textureLoader: { isSd: () => false } } as any, new Map());
        const scene = new Scene(4, 64, 64);
        const region = CacheMaps.getRegion((37 << 8) | 48)!;
        builder.decodeTerrain(scene, new Int8Array(region.terrainData), 0, 0, 2368, 3072, 37, 48);
        for (const [x, y, underlay] of [[31, 27, 56], [32, 36, 98]]) {
            assert.equal(scene.tileUnderlays[0][x][y], underlay);
            assert.equal(scene.tileOverlays[0][x][y], 42);
            assert.equal(scene.tileShapes[0][x][y], 0);
        }
        builder.addTileModels(scene, false);
        assertPit(scene.tiles[0][31][27]?.tileModel, "Castle Wars 2399,3099");
        assertPit(scene.tiles[0][32][36]?.tileModel, "Castle Wars 2400,3108");
        // These cache regions are predominantly full transparent floor cutouts, not individual openings.
        for (const [mapX, mapY] of [[27, 79], [28, 79], [51, 90]]) {
            const control = new Scene(1, 64, 64);
            const data = CacheMaps.getRegion((mapX << 8) | mapY)!;
            builder.decodeTerrain(control, new Int8Array(data.terrainData), 0, 0, mapX * 64, mapY * 64, mapX, mapY);
            builder.addTileModels(control, false);
            const transparent = (x: number, y: number): boolean => {
                const id = (control.tileOverlays[0][x][y] & 0x7fff) - 1;
                if (id < 0 || control.tileShapes[0][x][y] !== 0) return false;
                const overlay = overlayLoader.load(id);
                return overlay.textureId === -1 && overlay.primaryRgb === 0xff00ff;
            };
            let checked = 0;
            for (let x = 1; x < 63; x++) for (let y = 1; y < 63; y++) {
                if (!transparent(x, y) || ![[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([nx,ny]) => transparent(nx,ny))) continue;
                assert.equal(control.tiles[0][x][y]!.tileModel!.faces.length, 0,
                    `cache ${mapX},${mapY} tile ${x},${y}: adjacent transparent cutouts stay hidden`);
                checked++;
            }
            assert.ok(checked > 1000, `cache ${mapX},${mapY}: exercised a large transparent floor region`);
            console.info(`Transparent region ${mapX},${mapY}: ${checked} adjacent cutouts remain hidden`);
        }
    } finally {
        CachePipeline.getStore().close();
    }
}

function nativeShaftGeometry(): void {
    const info = loadCacheList(loadCacheInfos()).latest;
    const cache = loadCache(info);
    const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
    const locTypes = factory.getLocTypeLoader();
    const models = new LocModelLoader(locTypes, factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const builder = new SceneBuilder(info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
        factory.getOverlayTypeLoader(), locTypes, models, cache.xteas);
    const castle = builder.buildScene(2368, 3072, 64, 64, false, LocLoadType.MODELS);
    const locs = getSceneLocs(locTypes, castle, 0, 3).locs;
    for (const [worldX, worldY] of [[2369, 3125], [2430, 3082]]) {
        const x = worldX - 2368, y = worldY - 3072;
        const ladder = locs.find(loc => loc.interactId === 4912 && loc.level === 0 &&
            (loc.sceneX >> 7) === x && (loc.sceneZ >> 7) === y);
        assert.ok(ladder, `native ladder at ${worldX},${worldY} is in the full built scene`);
        assert.equal(Math.max(...ladder.model.verticesY), 192, "the ladder shaft extends below the old 64-unit pit bottom");
        assert.equal(castle.tiles[0][x][y]!.tileModel!.faces.length, 0,
            `Castle Wars ${worldX},${worldY}: terrain must not cover the existing ladder shaft`);
    }
    assertPit(castle.tiles[0][31][27]?.tileModel, "full build Castle Wars 2399,3099");
    assertPit(castle.tiles[0][32][36]?.tileModel, "full build Castle Wars 2400,3108");
    // The server opens closed trapdoor 1579 in place as 1581: a shaft 128 deep with black walls and
    // no bottom. The pit must stay (no sky through the shaft) but never cover the shaft or share its walls.
    for (const [worldX, worldY] of [[2399, 3099], [2400, 3108]]) {
        const closed = castle.tiles[0][worldX - 2368][worldY - 3072]!.floorDecoration!;
        assert.equal(getIdFromTag(closed.tag), 1579, `closed trapdoor at ${worldX},${worldY}`);
        const checkOpened = (pit: any, shaft: any, label: string): void => {
            assert.equal(getIdFromTag(shaft.tag), 1581, `${label}: open trapdoor placed`);
            const model = shaft.entity as any;
            const ys = model.contourVerticesY ?? model.verticesY;
            const shaftX: number[] = [], shaftY: number[] = [], shaftZ: number[] = [];
            for (let i = 0; i < model.verticesCount; i++) {
                shaftX.push(shaft.x + model.verticesX[i]);
                shaftY.push(shaft.height + ys[i]);
                shaftZ.push(shaft.y + model.verticesZ[i]);
            }
            assert.equal(Math.max(...shaftY) - shaft.height, 128, `${label}: 1581 reaches 128 below the floor`);
            assertPit(pit, `${label}: a pit still closes the shaft from the sky`);
            const lowest = Math.max(...shaftY);
            const [minX, maxX, minZ, maxZ] = [Math.min(...shaftX), Math.max(...shaftX), Math.min(...shaftZ), Math.max(...shaftZ)];
            // Every pit face reaching into the shaft's footprint lies wholly below the shaft.
            let below = 0;
            for (const face of pit!.faces) {
                const xs = face.vertices.map(v => v.x), zs = face.vertices.map(v => v.z);
                if (Math.max(...xs) <= minX || Math.min(...xs) >= maxX || Math.max(...zs) <= minZ || Math.min(...zs) >= maxZ) continue;
                const top = Math.min(...face.vertices.map(v => v.y));
                assert.ok(top > lowest, `${label}: pit face at y ${top} is above the shaft's lowest point ${lowest}`);
                below++;
            }
            assert.equal(below, 4, `${label}: only the pit bottom (both windings) lies under the shaft`);
            // Planes of the shaft's vertical walls (x = c or z = c) and of the pit's walls.
            const planes = (faces: number[][][]): Set<string> => {
                const out = new Set<string>();
                for (const face of faces) {
                    if (face.every(v => v[0] === face[0][0]) && new Set(face.map(v => v[1])).size > 1) out.add(`x${face[0][0]}`);
                    if (face.every(v => v[2] === face[0][2]) && new Set(face.map(v => v[1])).size > 1) out.add(`z${face[0][2]}`);
                }
                return out;
            };
            const shaftFaces: number[][][] = [];
            for (let f = 0; f < model.faceCount; f++) {
                shaftFaces.push([model.indices1[f], model.indices2[f], model.indices3[f]]
                    .map((i: number) => [shaftX[i], shaftY[i], shaftZ[i]]));
            }
            const shaftWalls = planes(shaftFaces);
            assert.ok(shaftWalls.size >= 4, `${label}: the shaft has its four walls`);
            for (const wall of planes(pit!.faces.map(face => face.vertices.map(v => [v.x, v.y, v.z])))) {
                assert.ok(!shaftWalls.has(wall), `${label}: pit wall ${wall} is coplanar with a shaft wall`);
            }
        };
        const rotation = (closed.flags >> 6) & 3;
        // A full reload: closed 1579 removed by its override, 1581 injected after terrain.
        builder.setLocOverride(8, 8, 0, 1579, LOC_OVERRIDE_REMOVED);
        const reloaded = builder.buildScene(worldX - 8, worldY - 8, 16, 16, false, LocLoadType.MODELS);
        builder.clearLocOverrides();
        assert.equal(reloaded.tiles[0][8][8]?.floorDecoration, undefined, "closed 1579 removed");
        builder.addLocToBuiltScene(reloaded, 0, 8, 8, 1581, LocModelType.FLOOR_DECORATION, rotation, LocLoadType.MODELS);
        const shaft = reloaded.tiles[0][8][8]!.floorDecoration!;
        checkOpened(reloaded.tiles[0][8][8]!.tileModel, shaft, `reloaded open Castle Wars trapdoor ${worldX},${worldY}`);
        // Terrain built with the closed trapdoor is kept when the server swaps the loc in place
        // (loc-only and door-only loads), so that pit must already clear the opened shaft.
        const kept = builder.buildScene(worldX - 8, worldY - 8, 16, 16, false, LocLoadType.MODELS);
        assert.equal(getIdFromTag(kept.tiles[0][8][8]!.floorDecoration!.tag), 1579);
        checkOpened(kept.tiles[0][8][8]!.tileModel, shaft, `in-place open Castle Wars trapdoor ${worldX},${worldY}`);
    }
    const trapdoorScene = builder.buildScene(2992, 3136, 32, 32, false, LocLoadType.MODELS);
    const trapdoor = getSceneLocs(locTypes, trapdoorScene, 0, 3, 32).locs.find(loc => loc.interactId === 1738 &&
        (loc.sceneX >> 7) === 16 && (loc.sceneZ >> 7) === 14);
    assert.ok(trapdoor, "the native deep trapdoor control is present");
    assert.ok(Math.max(...trapdoor.model.verticesY) > 64, "the trapdoor has its own deep model geometry");
    assert.equal(trapdoorScene.tiles[0][16][14]!.tileModel!.faces.length, 0,
        "deep trapdoors outside Castle Wars also retain their original shaft");
}

function transparentOverlayControls(): void {
    const scene = new Scene(1, 12, 12);
    for (let x = 0; x < scene.sizeX; x++) for (let y = 0; y < scene.sizeY; y++) {
        scene.tileUnderlays[0][x][y] = 1;
    }
    scene.tileOverlays[0][6][6] = 1; // enclosed full cutout
    scene.tileOverlays[0][3][3] = 1;
    scene.tileShapes[0][3][3] = 1; // partial cutout keeps its underlay geometry
    scene.tileOverlays[0][8][8] = 2; // textured magenta floor stays textured
    scene.tileOverlays[0][7][3] = scene.tileOverlays[0][9][3] = 1;
    scene.newFloorDecoration(0, 7, 3, 0, new LocEntity(1, 22, 0, 0, 7, 3, -1, false), 0n, 0);
    const shaft = new ModelData();
    shaft.verticesY = new Int32Array([0, 192]);
    scene.newFloorDecoration(0, 9, 3, 0, shaft, 0n, 0);
    scene.tileUnderlays[0][2][8] = 0; // legacy missing-floor holes retain their enclosure rule
    scene.tileOverlays[0][3][8] = 1;
    scene.tileOverlays[0][4][8] = scene.tileOverlays[0][5][8] = 1; // adjacent cutouts, even over underlays
    scene.tileOverlays[0][1][6] = 1;
    scene.tileUnderlays[0][0][6] = 0; // full cutout beside missing terrain is not an enclosed pit
    const floor = { getHueBlend: () => 0, getHueMultiplier: () => 1, saturation: 0, lightness: 0 };
    const builder = new SceneBuilder({} as any, {} as any, { load: () => floor } as any,
        { load: (id: number) => ({ primaryRgb: 0xff00ff, textureId: id === 1 ? 7 : -1, secondaryRgb: -1 }) } as any,
        {} as any, { textureLoader: { isSd: () => true, getAverageHsl: () => 0 } } as any, new Map());
    builder.addTileModels(scene, false);
    assertPit(scene.tiles[0][6][6]?.tileModel, "generic full cutout");
    assertPit(scene.tiles[0][2][8]?.tileModel, "legacy missing-floor hole beside a cutout");
    assert.equal(scene.tiles[0][7][3]!.tileModel!.faces.length, 0, "deferred animated/multiloc geometry is not covered");
    assert.equal(scene.tiles[0][9][3]!.tileModel!.faces.length, 0, "unlit scenery model data preserves its shaft too");
    assert.equal(scene.tiles[0][4][8]!.tileModel!.faces.length, 0, "adjacent cutouts do not enclose one another");
    assert.equal(scene.tiles[0][5][8]!.tileModel!.faces.length, 0, "underlays beneath a full cutout are not rendered floor");
    const partial = scene.tiles[0][3][3]!.tileModel!;
    assert.equal(partial.faces.length, 1);
    assert.equal(partial.underlayId, 1);
    assert.equal(partial.overlayId, 1);
    const textured = scene.tiles[0][8][8]!.tileModel!;
    assert.equal(textured.faces.length, 2);
    assert.ok(textured.faces.flatMap(face => face.vertices).every(vertex => vertex.textureId === 7));
    assert.equal(textured.overlayId, 2);
    assert.equal(scene.tiles[0][1][6]!.tileModel!.faces.length, 0, "unenclosed cutout keeps existing hidden geometry");
    assert.equal(scene.tiles[0][5][6]!.tileModel!.faces.length, 2, "ordinary floor is unchanged");
}

castleWarsNativeCutouts().then(nativeShaftGeometry).then(transparentOverlayControls).catch(error => { console.error(error); process.exitCode = 1; });
