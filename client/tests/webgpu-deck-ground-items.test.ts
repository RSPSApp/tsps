import "./browser-self";
import { strict as assert } from "node:assert";

import { getMapSquareId } from "../rs/map/MapFileIndex";
import { GroundItemMeshes } from "../render/webgpu/overlays/GroundItemMeshes";

// WebGPU: an item dropped on a boat's deck is drawn on that boat's own scene square and moves
// with the boat, as WebGL does. It used to look for a main-world map square under the deck's
// coordinates, find none, and draw nothing, so a dropped item seemed to vanish.
const DECK = 7;
const DECK_MAP = getMapSquareId(200 + DECK, 200 + DECK);
const deckView = { id: DECK, overlayMapId: DECK_MAP, isTopLevel: () => false };
const transform = new Float32Array(16).fill(2);
const writes: Array<{ buffer: unknown; offset: number; bytes: number[] }> = [];
const renderer: any = {
    worldEntityOverlays: new Map([[DECK, {}]]),
    worldEntityAnimator: { getTransform: (entity: number) => (entity === DECK ? transform : undefined) },
    mapManager: {
        worldEntityMapIds: new Set([DECK_MAP]),
        getMap: (mapX: number, mapY: number) => ({ mapX, mapY }),
    },
    osrsClient: {
        worldViewManager: { findWorldViewAt: (x: number) => (x >= 9600 ? deckView : undefined) },
    },
};
const device: any = {
    queue: {
        writeBuffer: (buffer: unknown, offset: number, data: ArrayBufferLike | ArrayBufferView, dataOffset = 0, size?: number) => {
            const bytes = ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data, dataOffset, size);
            writes.push({ buffer, offset, bytes: Array.from(bytes) });
        },
    },
};

const meshes = new GroundItemMeshes(renderer, device) as any;
const built: number[] = [];
meshes.rebuildMap = (map: { mapX: number; mapY: number }) => {
    built.push(getMapSquareId(map.mapX, map.mapY));
    return { pending: false };
};

const stack = (id: number, x: number, y: number) => ({ id, itemId: 1351, quantity: 1, tile: { x, y, level: 0 } });
meshes.update([stack(1, 9603, 9602), stack(2, 3200, 3200)]);
assert.deepEqual(
    built.sort((a, b) => a - b),
    [getMapSquareId(50, 50), DECK_MAP].sort((a, b) => a - b),
    "the deck stack builds on the boat's scene square, the other on its world square",
);

// The deck's items take the boat's placement matrix each frame; a world square's stay put.
const deckBuffer = { label: "deck" };
const worldBuffer = { label: "world" };
meshes.maps.set(DECK_MAP, { mapId: DECK_MAP, rangeCount: 2, mapUniformBuffer: deckBuffer });
meshes.maps.set(getMapSquareId(50, 50), { mapId: getMapSquareId(50, 50), rangeCount: 1, mapUniformBuffer: worldBuffer });
meshes.placeDeckItems();
assert.ok(writes.every((write) => write.buffer === deckBuffer), "only the deck's items are moved");
const matrix = Array.from(new Uint8Array(transform.buffer));
const flag = Array.from(new Uint8Array(new Uint32Array([1]).buffer));
assert.deepEqual(
    writes.map((write) => [write.offset, write.bytes]),
    [[0, matrix], [92, flag], [256, matrix], [348, flag]],
    "every draw range's entry gets the matrix and the placement flag",
);

console.log("webgpu-deck-ground-items: ok");
