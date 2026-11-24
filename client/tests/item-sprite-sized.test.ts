import assert from "node:assert/strict";
import { test } from "node:test";

import { Dat2CacheLoaderFactory } from "../rs/cache/loader/Dat2CacheLoaderFactory";
import { ItemIconRenderer } from "../ui/item/ItemIconRenderer";

// OSRS draws an item in a component larger than 36x32 from the item's model at that size (the
// model brought closer by width / 32) and without a stack number. It is not the small icon
// stretched.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { info, cache } = createCacheVm();
const loaders = new Dat2CacheLoaderFactory(info, "dat2", cache);

type Shot = { width: number; height: number; rgba: Uint8ClampedArray };
const shots: Shot[] = [];
(globalThis as any).document = {
    createElement: () => {
        const canvas: any = { width: 0, height: 0 };
        canvas.getContext = () => ({
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: (image: { data: Uint8ClampedArray }) => shots.push({ width: canvas.width, height: canvas.height, rgba: image.data }),
        });
        return canvas;
    },
};

function bounds(shot: Shot) {
    let minX = shot.width, maxX = -1, minY = shot.height, maxY = -1, filled = 0;
    for (let y = 0; y < shot.height; y++) {
        for (let x = 0; x < shot.width; x++) {
            if (shot.rgba[(y * shot.width + x) * 4 + 3] === 0) continue;
            filled++;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    }
    return { filled, w: maxX - minX + 1, h: maxY - minY + 1 };
}

test("a larger component gets a sprite drawn at its size", () => {
    const icons = new ItemIconRenderer(loaders.getObjTypeLoader(), loaders.getModelLoader(), loaders.getTextureLoader(), cache);
    const WHIP = 4151;
    shots.length = 0;
    const small = icons.renderToCanvas(WHIP, 1, { quantityMode: 0 });
    assert.ok(small);
    const smallShot = shots[shots.length - 1];
    assert.deepEqual([smallShot.width, smallShot.height], [36, 32]);

    const big = icons.renderToCanvas(WHIP, 1, { quantityMode: 0, width: 108, height: 96 });
    assert.ok(big);
    const bigShot = shots[shots.length - 1];
    assert.deepEqual([bigShot.width, bigShot.height], [108, 96]);

    const a = bounds(smallShot), b = bounds(bigShot);
    assert.ok(a.filled > 0 && b.filled > 0, "both draw the model");
    assert.ok(b.w > a.w * 2 && b.h > a.h * 2, `the model is drawn about three times as large (${a.w}x${a.h} -> ${b.w}x${b.h})`);
});

test("a size at or below 36x32 is the standard icon", () => {
    const icons = new ItemIconRenderer(loaders.getObjTypeLoader(), loaders.getModelLoader(), loaders.getTextureLoader(), cache);
    shots.length = 0;
    icons.renderToCanvas(4151, 1, { quantityMode: 0, width: 18, height: 16 });
    assert.deepEqual([shots[0].width, shots[0].height], [36, 32]);
});
