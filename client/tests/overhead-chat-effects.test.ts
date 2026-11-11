import assert from "node:assert/strict";
import { appendPlayerOverheadText } from "../render/render/overlays3";

// Row 34 "Show chat effects" (varp 171): 1 draws every player's overhead chat plain yellow and static.
function overheadWith(optionChat: number) {
    const chat = { text: "hello", color: 6, effect: 1, pattern: new Int32Array([1, 2]), duration: 150, remaining: 150 };
    const host: any = {
        shouldRenderPlayerIndex: () => true,
        osrsClient: {
            varManager: { getVarp: (id: number) => (id === 171 ? optionChat : 0) },
            playerEcs: {
                getOverheadChat: () => chat,
                getX: () => 3200 * 128, getY: () => 3200 * 128, getLevel: () => 0, getWorldViewId: () => -1,
                getServerIdForIndex: () => 1,
            },
        },
        acquireOverheadTextEntry: () => ({}),
        makeActorGroupKey: () => 1,
        mapOverheadColor: (raw: number) => (raw === 0 ? 0xffff00 : raw),
        resolveModIcon: () => undefined,
        computeOverheadAlpha: () => 1,
        resolvePlayerLogicalHeightTiles: () => 1,
    };
    const out: any[] = [];
    appendPlayerOverheadText(host, 0, out, 10, 1);
    assert.equal(out.length, 1);
    return out[0];
}

const shown = overheadWith(0);
assert.equal(shown.colorId, 6, "effects on: the typed colour");
assert.equal(shown.effect, 1, "effects on: the typed effect");
assert.ok(shown.pattern, "effects on: the pattern");

const plain = overheadWith(1);
assert.equal(plain.colorId, 0, "effects off: yellow");
assert.equal(plain.color, 0xffff00);
assert.equal(plain.effect, 0, "effects off: static");
assert.equal(plain.pattern, undefined);
console.log("Overhead chat effects tests passed");
