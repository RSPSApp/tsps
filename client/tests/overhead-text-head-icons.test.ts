import assert from "node:assert/strict";

import { OverheadPrayerLayer } from "../render/webgpu/overlays/OverheadPrayerLayer";
import { OverheadTextLayer } from "../render/webgpu/overlays/OverheadTextLayer";

Object.assign(globalThis, { self: globalThis });

// A player saying something while skulled with a protection prayer on. The text layer
// draws first and reserves its part of the actor stack; the head icons go above it.
// At every device pixel scale the lowest head icon must end above the text's glyphs.
const FONT_ASCENT = 12; // the layer's fallback when no font is loaded
const SPRITE_SIZE = 24;

for (const scale of [1, 2, 3]) {
    const stacks = new Map<number, number>();
    const textEntry: any = { worldX: 0, worldZ: 0, plane: 0, groupKey: 1, heightOffsetTiles: 0.9,
        text: "Overhead text test", life: 1, duration: 150, remaining: 150, effect: 0 };
    const iconEntry: any = { worldX: 0, worldZ: 0, plane: 0, groupKey: 1, heightOffsetTiles: 0.9,
        headIconPk: 0, headIconPrayer: 2 };
    const args: any = {
        time: 0,
        state: { playerLevel: 0, overheadTexts: [textEntry], overheadPrayers: [iconEntry],
            actor2dStacks: stacks },
        helpers: { getMinTileHeightInRadius: () => 0, worldToScreen: () => [500, 500] },
    };

    const textTops: number[] = [];
    const text = new OverheadTextLayer(
        { buildUpdateArgs: () => args, canvas: { width: 1000, height: 1000 } } as any,
        { queueTexture(_: unknown, _x: number, y: number) { textTops.push(y); },
            releaseTexture() {} } as any,
    );
    text.scale = scale;
    Object.assign(text, {
        ensureFont() {},
        getTextTexture: () => ({ texture: {}, w: 120, h: 16 }),
    });
    text.draw();
    assert.equal(textTops.length, 1, `scale ${scale}: the text is drawn`);
    // The texture top sits V_PADDING (2) scaled pixels above the glyph top.
    const glyphTop = textTops[0] + Math.round(2 * scale);
    assert.equal(stacks.get(1), -2 + Math.round(FONT_ASCENT * scale),
        `scale ${scale}: the text reserves its scaled height in the actor stack`);

    const icons: Array<{ y: number; h: number }> = [];
    const sprite: any = { width: SPRITE_SIZE, height: SPRITE_SIZE };
    const prayer = new OverheadPrayerLayer(
        { overheadPrayerOutput: [iconEntry], buildUpdateArgs: () => args } as any,
        { queueTexture(_: unknown, _x: number, y: number, _w: number, h: number) { icons.push({ y, h }); },
            releaseTexture() {} } as any,
    );
    prayer.scale = scale;
    Object.assign(prayer, { getSprite: (_kind: string, index: number) => index >= 0 ? sprite : undefined });
    prayer.draw();
    assert.equal(icons.length, 2, `scale ${scale}: skull and prayer are drawn`);
    assert.equal(icons[0].h, SPRITE_SIZE * scale, `scale ${scale}: icons are drawn at device scale`);

    const lowestIconBottom = Math.max(...icons.map((icon) => icon.y + icon.h));
    assert.ok(lowestIconBottom <= glyphTop,
        `scale ${scale}: head icons (bottom ${lowestIconBottom}) must not cover the text (top ${glyphTop})`);
    assert.ok(icons[1].y + icons[1].h <= icons[0].y, `scale ${scale}: prayer sits above the skull`);
}

console.log("overhead text head icon test passed");
