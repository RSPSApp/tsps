import "./browser-self";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { matchingLocSlotIds } from "../render/loc/LocSlots";
import { LocUpdates } from "../render/webgpu/locUpdates";
import { onLocAddChange } from "../render/render/locs";
import { onLocDel } from "../render/render/locs2";
import { LOC_OVERRIDE_REMOVED } from "../rs/scene/LocOverride";
import { SceneBuilder, LocLoadType } from "../rs/scene/SceneBuilder";
import { loadCacheSystem } from "../scripts/cache/cs2-sweep";
import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeLocAddChange, encodeLocDel } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * Issue #1748: a fire's LOC_ADD_CHANGE erased the tile's paving at the Grand Exchange. The
 * paving is cache scenery in a *different* rotation slot than the fire, and an add/delete must
 * only replace the loc in its own (shape, rotation) slot.
 */

const FIRE = 26185;
const TILE = { x: 3169, y: 3487 };
const PAVING = 16010; // unnamed NORMAL loc, rotation 1, one per GE tile
const CACHE_LOC = 123; // an object in the same slot as the fire
const DYNAMIC = 5000; // an object the server spawns over CACHE_LOC

/** A map square whose per-tile loc index the test can advance to its post-build shape. */
function stubSquare(ids: number[], typeRots: number[]) {
    return {
        ids,
        typeRots,
        getLocIdsAtLocal: () => ids,
        getLocTypeRotsAtLocal: () => typeRots,
        getRenderBaseWorldX: () => 3136,
        getRenderBaseWorldY: () => 3456,
    };
}

/** Replaces the square's index with the *built* scene: the dynamic loc, not the cache loc. */
function advanceToBuiltScene(
    square: ReturnType<typeof stubSquare>,
    dynamicId = DYNAMIC,
    rotation = 0,
) {
    square.ids.length = 0;
    square.typeRots.length = 0;
    square.ids.push(dynamicId);
    square.typeRots.push((rotation << 6) | 10);
}

const tileKey = (id: number) => `${TILE.x},${TILE.y},0,${id}`;

// The slot rule on its own: shape 10 rotation 0 (a fire) must not touch shape 10 rotation 1
// (the GE paving tile), and vice versa.
{
    const ids = [PAVING, CACHE_LOC, 55];
    const typeRots = [(1 << 6) | 10, (0 << 6) | 10, (2 << 6) | 10];
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 0), [CACHE_LOC], "only the same rotation matches");
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 1), [PAVING]);
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 22, 0), [], "floor decorations are another shape");
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 3), []);
}

// WebGPU path.
{
    const square = stubSquare([PAVING], [(1 << 6) | 10]);
    const renderer: any = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        locSpawns: new Map(),
        instanceActive: false,
        mapManager: {
            getMapForWorldTile: () => square,
            getMap: () => square,
            loadingMapIds: new Set<number>(),
        },
        osrsClient: { locTypeLoader: { load: () => ({ seqId: -1, name: "crate" }) } },
        queueLocReload: () => {},
    };
    const updates = new LocUpdates(renderer);

    // A fire on a tile whose only loc is paving of another rotation: nothing is suppressed.
    updates.onLocAddChange(FIRE, TILE, 0, 10, 0);
    assert.equal(renderer.addedLocs.size, 1, "the fire is recorded");
    assert.deepEqual([...renderer.locOverrides.keys()], [], "the rotation-1 paving loc is left alone");

    // A fire over an object in its own slot: that loc is suppressed, and removing the fire
    // restores it.
    square.ids.length = 0;
    square.typeRots.length = 0;
    square.ids.push(CACHE_LOC);
    square.typeRots.push(10);
    updates.onLocAddChange(FIRE, TILE, 0, 10, 0);
    assert.deepEqual(renderer.locOverrides.get(tileKey(CACHE_LOC)), { newId: LOC_OVERRIDE_REMOVED }, "the same-slot loc is replaced");
    updates.onLocDel(TILE, 0, 10, 0);
    assert.equal(renderer.locOverrides.has(tileKey(CACHE_LOC)), false, "removing the fire restores it");

    // A replay after the square rebuilt: the index now describes the built scene (the dynamic
    // object replaced the cache loc), so the recorded replacement must survive, and deleting the
    // dynamic object must restore the cache loc.
    square.ids.length = 0;
    square.typeRots.length = 0;
    square.ids.push(CACHE_LOC);
    square.typeRots.push(10);
    updates.onLocAddChange(DYNAMIC, TILE, 0, 10, 0);
    assert.deepEqual(renderer.locOverrides.get(tileKey(CACHE_LOC)), { newId: LOC_OVERRIDE_REMOVED });
    advanceToBuiltScene(square);
    updates.onLocAddChange(DYNAMIC, TILE, 0, 10, 0);
    assert.deepEqual(
        renderer.addedLocs.get(`${TILE.x},${TILE.y},0,10`).replacedIds,
        [CACHE_LOC],
        "a replay keeps the replacements the first add recorded",
    );
    assert.deepEqual(renderer.locOverrides.get(tileKey(CACHE_LOC)), { newId: LOC_OVERRIDE_REMOVED }, "the original suppression is kept");
    assert.equal(renderer.locOverrides.has(tileKey(DYNAMIC)), false, "the dynamic id is never suppressed");
    updates.onLocDel(TILE, 0, 10, 0);
    assert.equal(renderer.locOverrides.has(tileKey(CACHE_LOC)), false, "deleting after a replay restores the cache loc");

    // A different object taking over the slot without a delete inherits its predecessor's
    // replacements, so the cache loc still comes back when the last one goes.
    square.ids.length = 0;
    square.typeRots.length = 0;
    square.ids.push(CACHE_LOC);
    square.typeRots.push(10);
    updates.onLocAddChange(DYNAMIC, TILE, 0, 10, 0);
    advanceToBuiltScene(square);
    updates.onLocAddChange(DYNAMIC + 1, TILE, 0, 10, 0);
    assert.deepEqual(
        renderer.addedLocs.get(`${TILE.x},${TILE.y},0,10`).replacedIds,
        [CACHE_LOC, DYNAMIC],
        "the replacement record is carried over",
    );
    updates.onLocDel(TILE, 0, 10, 0);
    assert.equal(renderer.locOverrides.has(tileKey(CACHE_LOC)), false, "the cache loc is restored");

    updates.dispose();
}

// WebGL path: the same lifecycle through the renderer's own handlers.
{
    const square = stubSquare([PAVING], [(1 << 6) | 10]);
    const reloads: number[] = [];
    const host: any = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => ({ seqId: -1, name: "crate" }) } },
        getLocIdsAtTileAllLevels: () =>
            square.ids.map((id, index) => ({ id, level: 0, typeRot: square.typeRots[index] })),
        scheduleLocGeometryUpdate: () => reloads.push(1),
    };

    onLocAddChange(host, FIRE, TILE, 0, 10, 0);
    assert.equal(host.addedLocs.size, 1);
    assert.deepEqual([...host.locOverrides.keys()], [], "paving in another rotation slot stays");

    square.ids.push(CACHE_LOC);
    square.typeRots.push(10);
    onLocAddChange(host, FIRE, TILE, 0, 10, 0);
    assert.deepEqual(host.locOverrides.get(tileKey(CACHE_LOC)), { newId: LOC_OVERRIDE_REMOVED });

    onLocDel(host, TILE, 0, 10, 0);
    assert.equal(host.locOverrides.has(tileKey(CACHE_LOC)), false, "the replaced loc comes back");
    assert.equal(host.addedLocs.size, 0);
    assert.ok(reloads.length >= 3, "each change reloads geometry");

    // Replay after the build, then delete: the cache loc is still restored.
    const before = reloads.length;
    onLocAddChange(host, DYNAMIC, TILE, 0, 10, 0);
    assert.deepEqual(host.locOverrides.get(tileKey(CACHE_LOC)), { newId: LOC_OVERRIDE_REMOVED });
    advanceToBuiltScene(square);
    onLocAddChange(host, DYNAMIC, TILE, 0, 10, 0);
    assert.equal(reloads.length, before + 1, "a replay with its suppressions in place needs no rebuild");
    assert.deepEqual(host.addedLocs.get(`${TILE.x},${TILE.y},0,10`).replacedIds, [CACHE_LOC]);
    onLocDel(host, TILE, 0, 10, 0);
    assert.equal(host.locOverrides.has(tileKey(CACHE_LOC)), false, "deleting after a replay restores the cache loc");
}

// WebGL delete of a cache loc suppresses exactly that loc, not every loc of its shape.
{
    const host: any = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => ({ seqId: -1, name: "Tree" }) } },
        getLocIdsAtTileAllLevels: () => [
            { id: 1276, level: 0, typeRot: 10 },
            { id: PAVING, level: 0, typeRot: (1 << 6) | 10 },
        ],
        scheduleLocGeometryUpdate: () => {},
    };
    onLocDel(host, { x: 3200, y: 3200 }, 0, 10, 0);
    assert.deepEqual(host.locOverrides.get("3200,3200,0,1276"), { newId: LOC_OVERRIDE_REMOVED }, "the chopped tree is removed");
    assert.equal(host.locOverrides.has(`3200,3200,0,${PAVING}`), false, "the paving beside it stays");
}

// Issues #1845/#1846: ObjectManager's region replay sends a restored closed door as an add.
// Deleting that replay is a deletion of the cache loc itself, rather than an overlay removal.
// Decode real cache landscapes and native packets, then rebuild the per-tile index as the worker does.
{
    const cacheDir = path.resolve(__dirname, "../../server/caches", fs.readFileSync(path.resolve(__dirname, "../../server/target.txt"), "utf8").trim());
    const { cache, info } = loadCacheSystem(cacheDir);
    const loaders = new Dat2CacheLoaderFactory(info, "dat2", cache);
    const maps = loaders.getMapFileLoader(), locTypes = loaders.getLocTypeLoader();
    const cacheKeys = JSON.parse(fs.readFileSync(path.join(cacheDir, "keys.json"), "utf8"));
    for (const [id, x, y, shape, rotation, openX, openY, openRotation] of [
        [23972, 3109, 3167, 0, 3, 3109, 3166, 0], // Wizards' Tower, straight wall door
        [23972, 3107, 3162, 9, 1, 3108, 3162, 2], // its diagonal entrance
        [1535, 3108, 9570, 0, 0, 3107, 9570, 1], // basement
    ]) for (const backend of ["WebGL", "WebGPU"]) {
        const mapX = x >> 6, mapY = y >> 6, baseX = mapX * 64 - 1, baseY = mapY * 64 - 1;
        const keys = new Map<number, number[]>([[maps.mapFileIndex.getLocArchiveId(mapX, mapY), cacheKeys[(mapX << 8) | mapY] ?? [0, 0, 0, 0]]]);
        const data = maps.getLocData(mapX, mapY, keys);
        assert.ok(data, "the cache landscape decodes");
        assert.ok(locTypes.load(id).actions.includes("Open"));
        assert.ok(locTypes.load(id + 1).actions.includes("Close"));
        type Placement = { id: number; x: number; y: number; level: number; shape: number; rotation: number };
        let built: Placement[] = [];
        const at = (level: number, lx: number, ly: number) => built.filter(loc => loc.level === level && loc.x === lx + mapX * 64 && loc.y === ly + mapY * 64);
        const square = {
            getRenderBaseWorldX: () => mapX * 64, getRenderBaseWorldY: () => mapY * 64,
            getLocIdsAtLocal: (level: number, lx: number, ly: number) => at(level, lx, ly).map(loc => loc.id),
            getLocTypeRotsAtLocal: (level: number, lx: number, ly: number) => at(level, lx, ly).map(loc => (loc.rotation << 6) | loc.shape),
        };
        const renderer: any = {
            addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(), instanceActive: false,
            osrsClient: { locTypeLoader: locTypes },
            mapManager: {
                getMapForWorldTile: (wx: number, wy: number) => (wx >> 6) === mapX && (wy >> 6) === mapY ? square : undefined,
                getMap: (mx: number, my: number) => mx === mapX && my === mapY ? square : undefined,
                loadingMapIds: new Set(),
            },
            getLocIdsAtTileAllLevels: (wx: number, wy: number) => built.filter(loc => loc.x === wx && loc.y === wy)
                .map(loc => ({ id: loc.id, level: loc.level, typeRot: (loc.rotation << 6) | loc.shape })),
            scheduleLocGeometryUpdate() {}, queueLocReload() {},
        };
        const updates = backend === "WebGPU" ? new LocUpdates(renderer) : null;
        const builder = new SceneBuilder(info, maps, {} as any, {} as any, locTypes, {} as any, keys);
        const scene: any = { sizeX: 66, sizeY: 66, levels: 4, tileRenderFlags: [], collisionMaps: [] };
        const rebuild = () => {
            built = []; builder.clearLocOverrides();
            for (const [key, value] of renderer.locOverrides) {
                const [wx, wy, level, oldId] = key.split(",").map(Number);
                builder.setLocOverride(wx - baseX, wy - baseY, level, oldId, value.newId, value.newRotation,
                    undefined, undefined, value.seqId, value.seqRandomStart, value.matchType, value.matchRotation);
            }
            builder.addLoc = (_scene, level, lx, ly, locId, type, face) => {
                built.push({ id: locId, x: lx + baseX, y: ly + baseY, level, shape: type, rotation: face });
            };
            builder.decodeLocs(scene, data, 1, 1, LocLoadType.NO_MODELS);
            for (const loc of renderer.addedLocs.values()) {
                if ((loc.x >> 6) !== mapX || (loc.y >> 6) !== mapY) continue;
                builder.addLocToBuiltScene(scene, loc.level, loc.x - baseX, loc.y - baseY, loc.locId, loc.shape, loc.rotation, LocLoadType.NO_MODELS);
            }
        };
        const apply = (...packets: Uint8Array[]) => {
            for (const packet of packets) {
                const { type, payload: p } = decodeServerPacket(packet) as any;
                if (type === "loc_add_change") {
                    if (updates) updates.onLocAddChange(p.locId, p.tile, p.level, p.shape, p.rotation);
                    else onLocAddChange(renderer, p.locId, p.tile, p.level, p.shape, p.rotation);
                } else {
                    assert.equal(type, "loc_del");
                    if (updates) updates.onLocDel(p.tile, p.level, p.shape, p.rotation);
                    else onLocDel(renderer, p.tile, p.level, p.shape, p.rotation);
                }
            }
        };
        const doors = () => built.filter(loc => loc.level === 0 && (loc.id === id || loc.id === id + 1) && Math.abs(loc.x - x) <= 1 && Math.abs(loc.y - y) <= 1);
        const closed = { id, x, y, level: 0, shape, rotation };
        const opened = { id: id + 1, x: openX, y: openY, level: 0, shape, rotation: openRotation };
        try {
            rebuild(); assert.deepEqual(doors(), [closed], "the exact closed placement comes from the cache");
            const replay = encodeLocAddChange(id, x, y, 0, shape, rotation);
            apply(replay); rebuild(); apply(replay); rebuild();
            assert.deepEqual(doors(), [closed], "replays leave one closed door after rebuilding");
            assert.ok(renderer.addedLocs.get(`${x},${y},0,${shape}`).replacedIds.includes(id));
            apply(encodeLocDel(x, y, 0, shape, rotation), encodeLocAddChange(id + 1, openX, openY, 0, shape, openRotation));
            rebuild(); assert.deepEqual(doors(), [opened], `${backend}: opening a replayed door leaves only its moved open leaf`);
            apply(encodeLocDel(openX, openY, 0, shape, openRotation), replay);
            rebuild(); assert.deepEqual(doors(), [closed], "closing restores one closed door");
        } finally { updates?.dispose(); }
    }
}

console.log("loc add/change floor checks passed");
