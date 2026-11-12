import assert from "node:assert/strict";
import { vec3 } from "gl-matrix";

import { Ray } from "../game/math/Raycast";
import { InteractType } from "../render/InteractType";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

// An item on a boat's deck is drawn resting on the deck plane, so its click box must be there
// too. The box took the item's resting height from the deck scene's level 0 instead, where the
// hull's loc stands 177 units high, and floated well above the item.
const BASE_X = 10704;
const BASE_Y = 9552;
const TILE_X = 10755;
const TILE_Y = 9608;
const DECK_Y = -2; // the deck plane's ground height at the tile, in tiles (up is negative)

function clickBox(interactionPlane: number): number | undefined {
    const map = {
        id: 1,
        interactionPlane,
        getRenderBaseTileX: () => BASE_X,
        getRenderBaseTileY: () => BASE_Y,
        getLocalTileSpan: () => 104,
        getLocIdsAtLocal: () => [],
        getObjSurfaceHeight: (level: number) => (level === 0 ? 177 : 0),
    };
    const raycaster = new SceneRaycaster({}, { varManager: {} });
    raycaster.sampleHeightAt = () => DECK_Y;
    raycaster.getPreferredMapForWorldTile = () => map;
    raycaster.getMapLocalTile = (_map: unknown, x: number, y: number) => ({ x: x - BASE_X, y: y - BASE_Y });
    raycaster.osrsClient = {
        ...raycaster.osrsClient,
        groundItems: {
            getStacksAt: (x: number, y: number, level: number) =>
                x === TILE_X && y === TILE_Y && level === 0 ? [{ id: 5, itemId: 995, quantity: 500 }] : undefined,
        },
    };
    // Straight down onto the middle of the tile, from 100 tiles up.
    const ray = new Ray(vec3.fromValues(TILE_X + 0.5, -100, TILE_Y + 0.5), vec3.fromValues(0, 1, 0));
    const hits: Array<{ t: number; interactType: number }> = [];
    raycaster.collectTileHits(map, ray, TILE_X, TILE_Y, 1000, hits, undefined, undefined, 0);
    const hit = hits.find((entry) => entry.interactType === InteractType.OBJ);
    return hit === undefined ? undefined : -100 + hit.t;
}

// The box's top sits 0.2 tiles above the item.
const deckTop = clickBox(1);
assert.ok(deckTop !== undefined, "the deck item is clickable");
assert.ok(Math.abs(deckTop! - (DECK_Y - 0.2)) < 1e-6, `on a deck the box sits on the deck plane (top ${deckTop})`);

const landTop = clickBox(-1);
assert.ok(Math.abs(landTop! - (DECK_Y - 177 / 128 - 0.2)) < 1e-6, "elsewhere the tile's own level is used");

console.log("scene-raycaster-deck-ground-item: ok");
