import { strict as assert } from "node:assert";
import path from "node:path";

import { Scene } from "../rs/scene/Scene";
import { CachePipeline } from "../../server/src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheMaps } from "../../server/src/main/typescript/elvarg/game/cache/CacheMaps";
import { CacheIndexDat2 } from "../../server/src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { OverlayFloorType } from "../rs/config/floortype/OverlayFloorType";
import { ByteBuffer } from "../rs/io/ByteBuffer";
import { SceneBuilder } from "../rs/scene/SceneBuilder";

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
    } finally {
        CachePipeline.getStore().close();
    }
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
    scene.tileOverlays[0][1][6] = 1;
    scene.tileUnderlays[0][0][6] = 0; // full cutout beside missing terrain is not an enclosed pit
    const floor = { getHueBlend: () => 0, getHueMultiplier: () => 1, saturation: 0, lightness: 0 };
    const builder = new SceneBuilder({} as any, {} as any, { load: () => floor } as any,
        { load: (id: number) => ({ primaryRgb: 0xff00ff, textureId: id === 1 ? 7 : -1, secondaryRgb: -1 }) } as any,
        {} as any, { textureLoader: { isSd: () => true, getAverageHsl: () => 0 } } as any, new Map());
    builder.addTileModels(scene, false);
    assertPit(scene.tiles[0][6][6]?.tileModel, "generic full cutout");
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

castleWarsNativeCutouts().then(transparentOverlayControls).catch(error => { console.error(error); process.exitCode = 1; });
