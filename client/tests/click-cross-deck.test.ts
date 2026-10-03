import assert from "node:assert/strict";

// PicoGL expects a browser global when the renderer modules load.
(globalThis as any).self = globalThis;
const { spawnClickCross } = require("../render/render/interact/highlight4");

// A click on a boat picks a tile in the boat's deck scene (9600+); the cross must be anchored
// where that scene is drawn, or it's projected far off-screen and never seen.
const spawned: number[][] = [];
const deckView = { id: 3000 };
const host: any = {
    getPlayerBasePlane: () => 0,
    clickCrossOverlay: { spawn: (x: number, y: number, _sx: number, _sy: number, plane: number) => spawned.push([x, y, plane]) },
    osrsClient: {
        worldViewManager: {
            findWorldViewAt: (x: number, y: number) => (x >= 9600 && y >= 9600 ? deckView : { id: -1 }),
        },
    },
    // Deck tile (9603, 9604) is drawn over main-world tile (3069, 2987).
    worldEntityAnimator: {
        getMovement: () => {
            const m = new Float32Array(16);
            m[0] = m[5] = m[10] = m[15] = 1;
            m[12] = 3069 - 9603;
            m[14] = 2987 - 9604;
            return m;
        },
    },
};

spawnClickCross(host, { tileX: 9603, tileY: 9604, plane: 1 }, { sx: 10, sy: 20 }, "yellow");
assert.deepEqual(spawned.pop(), [3069, 2987, 0], "a deck click is anchored where the deck is drawn");

spawnClickCross(host, { tileX: 3070, tileY: 2990, plane: 0 }, { sx: 10, sy: 20 }, "red");
assert.deepEqual(spawned.pop(), [3070, 2990, 0], "a main-world click is unchanged");

console.log("click cross deck check passed");
