import { strict as assert } from "node:assert";

import { hintArrow, hintArrowTileOffset, setHintArrowNpc, setHintArrowTile } from "../game/HintArrow";
import { HintArrowLayer } from "../render/webgpu/overlays/HintArrowLayer";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";

/**
 * Tile hint arrows as OSRS sends them: the height byte (the arrow sits height * 2 world units
 * up) and the position type (the tile's centre or one of its edges), with the floor beside it.
 */
function tileHintsKeepPositionHeightAndPlane(): void {
    // A door's arrow on the tutorial: west edge, height 128, floor 0.
    setHintArrowTile(3098, 3107, 128, (3 << 2) | 0);
    assert.equal(hintArrow.type, 2);
    assert.equal(hintArrow.height, 128);
    assert.equal(hintArrow.position, 3);
    assert.equal(hintArrow.plane, 0);

    setHintArrowTile(3088, 9520, 5, (2 << 2) | 1);
    assert.equal(hintArrow.position, 2);
    assert.equal(hintArrow.plane, 1);

    // An unknown position type falls back to the centre.
    setHintArrowTile(1, 1, 0, 7 << 2);
    assert.equal(hintArrow.position, 2);
}

function offsetsMatchTheOsrsClient(): void {
    assert.deepEqual(hintArrowTileOffset(2), [64, 64]);
    assert.deepEqual(hintArrowTileOffset(3), [0, 64]);
    assert.deepEqual(hintArrowTileOffset(4), [128, 64]);
    assert.deepEqual(hintArrowTileOffset(5), [64, 0]);
    assert.deepEqual(hintArrowTileOffset(6), [64, 128]);
}

/** #748: WebGPU, the default renderer, drew no in-world hint arrow at all; only the minimap had one. */
function webgpuDrawsTheArrow(): void {
    const sprite = Object.assign(new IndexedSprite(), { width: 25, height: 25, subWidth: 25, subHeight: 25, palette: new Int32Array(2), pixels: new Uint8Array(625) });
    SpriteLoader.loadIntoIndexedSprites = () => [sprite];
    const queued: number[][] = [];
    const host: any = {
        osrsClient: {
            cacheSystem: { getIndex: () => ({ getArchiveId: () => 1 }) },
            npcEcs: { getEcsIdForServer: () => 7, getMapId: () => 0, getNpcTypeId: () => 0, getX: () => 0, getY: () => 0, getLevel: () => 0 },
        },
        buildUpdateArgs: () => ({
            state: { playerLevel: 0 },
            helpers: { getMinTileHeightInRadius: () => 0, worldToScreen: (x: number, _y: number, z: number) => [x * 10, z * 10] },
        }),
        resolveNpcOverlayAnchor: () => ({ worldX: 30, worldZ: 40, logicalHeightTiles: 1 }),
    };
    const screen: any = {
        createPixelTexture: (_pixels: Uint8Array, width: number, height: number) => ({ width, height }),
        queueTexture: (_texture: unknown, x: number, y: number, w: number, h: number) => queued.push([x, y, w, h]),
    };
    const layer = new HintArrowLayer(host, screen);
    const now = performance.now;
    performance.now = () => 0; // blink on
    try {
        setHintArrowTile(10, 20, 0, 2 << 2);
        layer.draw();
        setHintArrowNpc(1);
        layer.draw();
    } finally {
        performance.now = now;
    }
    // The tile's centre and the NPC's anchor, drawn at (x - 12, y - 28) as the OSRS client does.
    assert.deepEqual(queued, [[105 - 12, 205 - 28, 25, 25], [300 - 12, 400 - 28, 25, 25]]);
}

tileHintsKeepPositionHeightAndPlane();
offsetsMatchTheOsrsClient();
webgpuDrawsTheArrow();
