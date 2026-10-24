import assert from "node:assert/strict";

import { GameRenderer } from "../game/GameRenderer";
import { WorldViewManager } from "../game/worldview/WorldViewManager";
import { getMapSquareId } from "../rs/map/MapFileIndex";

// A varp multiloc stands in a world square and on a boat's deck (deck scenes are drawn as the
// overlay map square 200+index). A change to its varp reloads the world square as a map square
// but rebuilds the deck from its template: a plain reload of the deck's square built an empty
// square in its place and the boat vanished.
const multiloc = {
    transforms: [1, 2],
    transformVarbit: -1,
    transformVarp: 42,
    transform: (vars: any) => ({ id: vars.getVarp(42) === 1 ? 2 : 1 }),
};
const locTypeLoader: any = { load: (id: number) => (id === 100 ? multiloc : undefined) };
let varp42 = 0;
const varbitLoader: any = { load: () => undefined };
let factoryVarBitLoaderCalls = 0;
const withMultiloc = [Int32Array.from([100])];

const worldViews = new WorldViewManager();
worldViews.createWorldView(3008, 104, 104);
const deckMapId = worldViews.getWorldView(3008)!.overlayMapId;

const reloaded: string[] = [];
const rebuiltDecks: number[] = [];
const renderer: any = {
    changedVarps: new Set([42]),
    multiLocBuilds: new Map(),
    osrsClient: {
        varManager: { getVarp: () => varp42, getVarbit: () => 0, varbitLoader },
        loaderFactory: {
            getVarBitTypeLoader: () => {
                factoryVarBitLoaderCalls++;
                return { load: () => undefined };
            },
        },
        locTypeLoader,
        updateVars: () => {},
        worldViewManager: worldViews,
    },
    mapManager: {
        mapSquares: new Map([
            [getMapSquareId(50, 50), { mapX: 50, mapY: 50, tileLocIdsByLevel: withMultiloc }],
            [deckMapId, { mapX: deckMapId >> 8, mapY: deckMapId & 0xff, tileLocIdsByLevel: withMultiloc }],
        ]),
        worldEntityMapIds: new Set([deckMapId]),
    },
    reloadMultiLocSquare: (mapX: number, mapY: number) => reloaded.push(`${mapX},${mapY}`),
    scheduleWorldEntityLocRebuild: (entityIndex: number) => rebuiltDecks.push(entityIndex),
};

(GameRenderer.prototype as any).reloadMultiLocSquares.call(renderer);
assert.deepEqual(reloaded, ["50,50"], "the world square reloads as a map square");
assert.deepEqual(rebuiltDecks, [3008], "the deck rebuilds from its template");

// Another change to varp 42 that leaves the multiloc showing the same variant (an unrelated
// varbit on it) rebuilds nothing: a rebuild restarts every loc animation in the square.
renderer.changedVarps = new Set([42]);
(GameRenderer.prototype as any).reloadMultiLocSquares.call(renderer);
assert.deepEqual(reloaded, ["50,50"], "an unchanged variant leaves the square alone");

varp42 = 1;
renderer.changedVarps = new Set([42]);
(GameRenderer.prototype as any).reloadMultiLocSquares.call(renderer);
assert.deepEqual(reloaded, ["50,50", "50,50"], "a changed variant reloads it");
assert.equal(factoryVarBitLoaderCalls, 0, "reloads reuse the VarManager's varbit loader");

console.log("multiloc-deck-reload: ok");
