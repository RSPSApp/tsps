import "./browser-self";
import assert from "node:assert/strict";
import { test } from "node:test";

import { isDoorLoc } from "../render/loc/SceneLocs";
import { LocUpdates } from "../render/webgpu/locUpdates";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

// The Al Kharid toll gate: nameless leaves 44598/44599 resolve, by Prince Ali Rescue's varp, to
// the "Gate" 44052 (Pay-toll) or 44050. Its open leaves 1573/1574 are nameless, as is the
// invisible wall 38848 that holds the closed tile.
const gate = { id: 44050, name: "Gate", actions: ["Open"], seqId: -1 };
const leaf = { id: 44598, name: "null", actions: [], seqId: -1, transforms: [44052, 44050], transform: () => gate };
const openLeaf = { id: 1573, name: "null", actions: [], seqId: -1 };
const types: Record<number, unknown> = { 44050: gate, 44598: leaf, 1573: openLeaf, 38848: openLeaf };
const loader: any = { load: (id: number) => types[id] };
const varManager: any = { getVarp: () => 0, getVarbit: () => 0 };

test("a multiloc is a door when the variant it shows is one", () => {
    assert.equal(isDoorLoc(leaf as any, varManager, loader), true);
    assert.equal(isDoorLoc(openLeaf as any, varManager, loader), false);
    assert.equal(isDoorLoc({ ...leaf, transform: () => undefined } as any, varManager, loader), false,
        "a multiloc showing nothing is drawn nowhere");
});

function fixture() {
    const reloads: string[] = [];
    const renderer: any = {
        instanceActive: false,
        addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(),
        mapManager: {
            getMap: () => ({}),
            getMapForWorldTile: () => undefined,
            loadingMapIds: new Set<number>(),
        },
        osrsClient: { locTypeLoader: loader, varManager },
        queueLocReload: (mapX: number, mapY: number, group: string) => reloads.push(`${mapX},${mapY},${group}`),
    };
    return { reloads, updates: new LocUpdates(renderer) };
}

test("the toll gate's closed leaves rebuild the door geometry they are drawn in", async () => {
    const { reloads, updates } = fixture();
    updates.onLocAddChange(44598, { x: 3268, y: 3227 }, 0, 0, 0);
    await flush();
    assert.deepEqual(reloads, ["51,50,door"]);
});

test("swinging the toll gate rebuilds both its door and its loc geometry (issue #1706)", async () => {
    const { reloads, updates } = fixture();
    // Closing: the open leaves go and the closed leaves come back in one batch.
    updates.onLocDel({ x: 3267, y: 3227 }, 0, 0, 3);
    updates.onLocAddChange(1573, { x: 3267, y: 3227 }, 0, 0, 3);
    updates.onLocAddChange(44598, { x: 3268, y: 3227 }, 0, 0, 0);
    await flush();
    assert.deepEqual(reloads, ["51,50,full"], "a loc-only rebuild left the closed leaves out of the door geometry");
});
