import "./browser-self";
import { strict as assert } from "node:assert";
import { onLocAddChange } from "../render/render/locs";
import { onLocAnim, onLocDel } from "../render/render/locs2";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import {
    LOC_OVERRIDE_KEEP_ID,
    LOC_OVERRIDE_REMOVED,
    locOverrideIdFromChange,
    resolveLocOverrideId,
} from "../rs/scene/LocOverride";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";

// Loc id 0 is a real loc: Dwarf Cannon's remains (mcannonremains_multiloc, 2567,3444,2) shows
// "Dwarf remains" at varp 0 = 3. Overrides mark a removal with their own value, not 0.

assert.equal(resolveLocOverrideId(undefined, 0), 0, "a map loc 0 with no override stays");
assert.equal(resolveLocOverrideId({ newId: LOC_OVERRIDE_KEEP_ID }, 0), 0, "an animation keeps loc 0");
assert.equal(resolveLocOverrideId({ newId: 0 }, 15590), 0, "an override can change a loc into loc 0");
assert.equal(resolveLocOverrideId({ newId: LOC_OVERRIDE_REMOVED }, 0), -1, "a removal removes loc 0");
assert.equal(resolveLocOverrideId({ newId: LOC_OVERRIDE_REMOVED }, 100), -1);
assert.equal(locOverrideIdFromChange(0), LOC_OVERRIDE_REMOVED, "a LOC_CHANGE to 0 is a removal");
assert.equal(locOverrideIdFromChange(15596), 15596);

// The map decoder places loc 0 and only an explicit removal takes it away.
{
    const builder = new SceneBuilder({ game: "oldschool", revision: 237 } as any,
        {} as any, {} as any, {} as any,
        { load: () => ({ sizeX: 1, sizeY: 1 }) } as any, {} as any, new Map());
    const scene = { sizeX: 104, sizeY: 104, levels: 4, tileRenderFlags: [], collisionMaps: [] } as any;
    // Loc id 0 (id delta 1), shape 10, rotation 1, at (2,3) on plane 0.
    const data = Int8Array.from([1, 128, 132, 41, 0, 0]);
    const placements: number[][] = [];
    builder.addLoc = (_scene, plane, x, y, id, shape, rotation) => { placements.push([plane, x, y, id, shape, rotation]); };
    const decode = () => {
        placements.length = 0;
        builder.decodeLocs(scene, data, 0, 0, LocLoadType.NO_MODELS);
        return placements;
    };
    assert.deepEqual(decode(), [[0, 2, 3, 0, 10, 1]], "loc 0 is added to the scene");
    builder.setLocOverride(2, 3, 0, -1, LOC_OVERRIDE_KEEP_ID, undefined, undefined, undefined, 1234);
    assert.deepEqual(decode(), [[0, 2, 3, 0, 10, 1]], "an animated loc 0 stays");
    builder.clearLocOverrides();
    builder.setLocOverride(2, 3, 0, -1, LOC_OVERRIDE_REMOVED, undefined, undefined, undefined, undefined, undefined, LocModelType.NORMAL);
    assert.deepEqual(decode(), [], "a LOC_DEL removes loc 0");
}

// LOC_DEL and LOC_ADD_CHANGE write the removal marker, never id 0.
{
    const host = {
        addedLocs: new Map(), locOverrides: new Map(), instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => undefined } },
        getLocIdsAtTileAllLevels: () => [{ id: 0, level: 2, typeRot: (1 << 6) | LocModelType.NORMAL }],
        scheduleLocGeometryUpdate: () => {},
    } as any;
    // Loc 0 is found in the tile's slot like any other loc, and its removal is keyed by its id.
    const removals = () => [...host.locOverrides.entries()].map(([key, value]: [string, any]) => [key, value.newId]);
    onLocDel(host, { x: 2567, y: 3444 }, 2, LocModelType.NORMAL, 1);
    assert.deepEqual(removals(), [["2567,3444,2,0", LOC_OVERRIDE_REMOVED]], "a LOC_DEL removes loc 0");
    host.locOverrides.clear();
    onLocAddChange(host, 15596, { x: 2567, y: 3444 }, 2, LocModelType.NORMAL, 1);
    assert.deepEqual(removals(), [["2567,3444,2,0", LOC_OVERRIDE_REMOVED]], "an add replaces loc 0 in its slot");
}

// An animation on loc 0 keeps it: the exact key holds id 0, the tile-wide key keeps the map's id.
{
    const host: any = {
        locOverrides: new Map(), locAnimTimers: new Map(), addedLocs: new Map(),
        osrsClient: { seqTypeLoader: { load: () => ({ frameStep: 1, frameLengths: [1] }) } },
        reloadLocAnimationTile: () => {},
        getLocAnimationDurationMs: () => 600,
        clearInteractHighlightActiveTarget: () => {},
        clearInteractHighlightHoverTarget: () => {},
    };
    onLocAnim(host, 0, { x: 2567, y: 3444 }, 2, LocModelType.NORMAL, 1, 1234);
    assert.equal(resolveLocOverrideId(host.locOverrides.get("2567,3444,2,0"), 0), 0);
    assert.equal(host.locOverrides.get("2567,3444,2,-1")?.newId, LOC_OVERRIDE_KEEP_ID);
}

console.log("loc-zero: ok");
