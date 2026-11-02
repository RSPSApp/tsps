import "./browser-self";
import assert from "node:assert/strict";

import { matchingLocSlotIds } from "../render/loc/LocSlots";
import { LocUpdates } from "../render/webgpu/locUpdates";
import { onLocAddChange } from "../render/render/locs";
import { onLocDel } from "../render/render/locs2";
import { LOC_OVERRIDE_REMOVED } from "../rs/scene/LocOverride";

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

console.log("loc add/change floor checks passed");
