import assert from "node:assert/strict";
import { onLocAnim } from "../render/render/locs2";

/** Just what onLocAnim touches; frameSteps maps a seq id to its frame step. */
function stubHost(frameSteps: Record<number, number>) {
    const reloads: number[] = [];
    const host: any = {
        locOverrides: new Map<string, any>(),
        locAnimTimers: new Map<string, ReturnType<typeof setTimeout>>(),
        addedLocs: new Map<string, any>(),
        osrsClient: { seqTypeLoader: { load: (id: number) => ({ frameStep: frameSteps[id] ?? -1, frameLengths: [1] }) } },
        reloadLocAnimationTile: (_tile: unknown, locId: number) => reloads.push(locId),
        getLocAnimationDurationMs: () => 600,
        clearInteractHighlightActiveTarget: () => {},
        clearInteractHighlightHoverTarget: () => {},
    };
    return { host, reloads };
}

const tile = { x: 3679, y: 5140 };
const removal = { newId: 0, matchType: 10 };

// A loc the server added over a map loc: the removal of the map loc (tile-wide key) must
// survive an animation on the added one, or the old loc shows again beside it.
{
    const { host } = stubHost({ 9505: 1 });
    host.addedLocs.set("3679,5140,0,10", { locId: 44934, x: 3679, y: 5140, level: 0, shape: 10, rotation: 2 });
    host.locOverrides.set("3679,5140,0,-1", removal);
    onLocAnim(host, 44934, tile, 0, 10, 2, 9505);
    assert.equal(host.locOverrides.get("3679,5140,0,-1"), removal, "the replaced map loc stays removed");
    assert.equal(host.locOverrides.get("3679,5140,0,44934")?.seqId, 9505, "the added loc animates");
    // 9505 has a frame step (it holds its last frames), so it keeps going: no revert timer.
    assert.equal(host.locAnimTimers.size, 0);
}

// A map loc still animates through the tile-wide key (its id may be a multiloc's parent), and
// a sequence without a frame step plays once and reverts.
{
    const { host } = stubHost({});
    onLocAnim(host, 46220, tile, 0, 10, 2, 1234);
    assert.equal(host.locOverrides.get("3679,5140,0,-1")?.seqId, 1234);
    assert.equal(host.locAnimTimers.size, 2, "both keys revert after one play");
    for (const timer of new Set(host.locAnimTimers.values())) clearTimeout(timer as ReturnType<typeof setTimeout>);
}

console.log("loc anim override checks passed");
