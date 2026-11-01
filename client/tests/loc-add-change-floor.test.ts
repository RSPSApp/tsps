import "./browser-self";
import assert from "node:assert/strict";

import { matchingLocSlotIds } from "../render/loc/LocSlots";
import { LocUpdates } from "../render/webgpu/locUpdates";
import { onLocAddChange } from "../render/render/locs";
import { onLocDel } from "../render/render/locs2";

/**
 * Issue #1748: a fire's LOC_ADD_CHANGE erased the tile's paving at the Grand Exchange. The
 * paving is cache scenery in a *different* rotation slot than the fire, and an add/delete must
 * only replace the loc in its own (shape, rotation) slot.
 */

// The slot rule on its own: shape 10 rotation 0 (a fire) must not touch shape 10 rotation 1
// (the GE paving tile), and vice versa.
{
    const ids = [16010, 123, 55];
    const typeRots = [(1 << 6) | 10, (0 << 6) | 10, (2 << 6) | 10];
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 0), [123], "only the same rotation matches");
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 1), [16010]);
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 22, 0), [], "floor decorations are another shape");
    assert.deepEqual(matchingLocSlotIds(ids, typeRots, 10, 3), []);
}

// WebGPU path: a fire at 3169,3487 where the map has only the paving loc (id 16010, rotation 1).
{
    const locIds = [16010];
    const typeRots = [(1 << 6) | 10];
    const square = {
        getLocIdsAtLocal: () => locIds,
        getLocTypeRotsAtLocal: () => typeRots,
        getRenderBaseWorldX: () => 3136,
        getRenderBaseWorldY: () => 3456,
    };
    const reloads: string[] = [];
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
        queueLocReload: (x: number, y: number, group: string) => reloads.push(`${x},${y},${group}`),
    };
    const updates = new LocUpdates(renderer);

    updates.onLocAddChange(26185, { x: 3169, y: 3487 }, 0, 10, 0);
    assert.equal(renderer.addedLocs.size, 1, "the fire is recorded");
    assert.deepEqual([...renderer.locOverrides.keys()], [], "the rotation-1 paving loc is left alone");
    updates.dispose();

    // The same add where the tile does hold the fire's own slot: that loc is replaced, and
    // removing the fire later puts it back.
    locIds.length = 0;
    typeRots.length = 0;
    locIds.push(123);
    typeRots.push((0 << 6) | 10);
    updates.onLocAddChange(26185, { x: 3169, y: 3487 }, 0, 10, 0);
    assert.deepEqual(renderer.locOverrides.get("3169,3487,0,123"), { newId: 0 }, "the same-slot loc is replaced");
    updates.onLocDel({ x: 3169, y: 3487 }, 0, 10, 0);
    assert.equal(renderer.locOverrides.has("3169,3487,0,123"), false, "removing the fire restores it");
    updates.dispose();
}

// WebGL path: the same two cases through the renderer's own handlers.
{
    const tileLocs = [{ id: 16010, level: 0, typeRot: (1 << 6) | 10 }];
    const reloads: number[] = [];
    const host: any = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => ({ seqId: -1, name: "crate" }) } },
        getLocIdsAtTileAllLevels: () => tileLocs,
        scheduleLocGeometryUpdate: () => reloads.push(1),
    };

    onLocAddChange(host, 26185, { x: 3169, y: 3487 }, 0, 10, 0);
    assert.equal(host.addedLocs.size, 1);
    assert.deepEqual([...host.locOverrides.keys()], [], "paving in another rotation slot stays");

    tileLocs.push({ id: 123, level: 0, typeRot: (0 << 6) | 10 } as any);
    onLocAddChange(host, 26185, { x: 3169, y: 3487 }, 0, 10, 0);
    assert.deepEqual(host.locOverrides.get("3169,3487,0,123"), { newId: 0 });

    onLocDel(host, { x: 3169, y: 3487 }, 0, 10, 0);
    assert.equal(host.locOverrides.has("3169,3487,0,123"), false, "the replaced loc comes back");
    assert.equal(host.addedLocs.size, 0);
    assert.ok(reloads.length >= 3, "each change reloads geometry");
}

// WebGL delete of a cache loc suppresses exactly that loc, not every loc of its shape.
{
    const host: any = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => ({ seqId: -1, name: "Tree" }) } },
        getLocIdsAtTileAllLevels: () => [
            { id: 1276, level: 0, typeRot: (0 << 6) | 10 },
            { id: 16010, level: 0, typeRot: (1 << 6) | 10 },
        ],
        scheduleLocGeometryUpdate: () => {},
    };
    onLocDel(host, { x: 3200, y: 3200 }, 0, 10, 0);
    assert.deepEqual(host.locOverrides.get("3200,3200,0,1276"), { newId: 0 }, "the chopped tree is removed");
    assert.equal(host.locOverrides.has("3200,3200,0,16010"), false, "the paving beside it stays");
}

console.log("loc add/change floor checks passed");
