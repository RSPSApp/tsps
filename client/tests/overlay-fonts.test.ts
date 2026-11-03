import { strict as assert } from "node:assert";

import { ConfigManager, parseConfigValue, serializeConfigValue } from "@runelite/client/config/ConfigManager";
import { FontType } from "@runelite/client/config/FontType";
import { RuneLiteConfig } from "@runelite/client/config/RuneLiteConfig";
import { bindOverlayFonts, boldFont, overlayFont, overlayFontsVersion, resolveFontType } from "@runelite/client/ui/overlay/OverlayFonts";
import { FONT_BOLD_12, FONT_PLAIN_11, FONT_PLAIN_12 } from "../ui/fonts";
import { GroundItemsOverlay } from "../game/plugins/grounditems/GroundItemsOverlay";
import { BitmapFont } from "../rs/font/BitmapFont";

// FontType: RuneLite's presets, JSON storage, legacy enum names, bad input.
assert.equal(FontType.SMALL.family, "RuneScape Small");
assert.equal(FontType.REGULAR.size, 16);
assert.equal(FontType.BOLD.bold, true);
const custom = new FontType("RuneScape", 24, true);
assert.equal(String(custom), '{"family":"RuneScape","size":24,"bold":true}');
assert.ok(FontType.parse(String(custom), FontType.SMALL).equals(custom), "round trip");
assert.equal(FontType.parse("BOLD", FontType.SMALL), FontType.BOLD, "legacy enum name");
assert.equal(FontType.parse("not json", FontType.SMALL), FontType.SMALL, "unreadable: the fallback");
assert.equal(FontType.parse('{"family":"Comic Sans","size":20}', FontType.SMALL).family, "RuneScape Small",
    "an unknown family keeps the fallback's");
assert.equal(FontType.parse('{"family":"RuneScape","size":999}', FontType.SMALL).size, FontType.MAX_SIZE, "size clamped");
assert.equal(FontType.parse('{"family":"RuneScape","size":20,"italic":true}', FontType.SMALL).size, 20,
    "RuneLite's italic key is ignored");
assert.equal(FontType.SMALL.withSize(0).size, FontType.MIN_SIZE);

// Config items: the four slots in Overlay settings, with RuneLite's keys and defaults.
const items = RuneLiteConfig.items;
assert.equal(items.dynamicOverlayFont.keyName, "fontType");
assert.equal(items.tooltipFont.keyName, "tooltipFontType");
assert.equal(items.interfaceFont.keyName, "interfaceFontType");
assert.equal(items.infoboxFont.keyName, "infoboxFontType");
assert.equal(items.dynamicOverlayFont.default, FontType.SMALL);
assert.equal(items.tooltipFont.default, FontType.SMALL);
assert.equal(items.interfaceFont.default, FontType.REGULAR);
assert.equal(items.infoboxFont.default, FontType.REGULAR);
assert.equal(RuneLiteConfig.sections?.overlaySettings?.name, "Overlay settings");
assert.equal(serializeConfigValue(items.tooltipFont, custom), String(custom));
assert.ok((parseConfigValue(items.tooltipFont, String(custom)) as FontType).equals(custom));
assert.equal(parseConfigValue(items.tooltipFont, undefined), FontType.SMALL, "unset: the default");

// Cache fonts: RuneScape is p12 (bold b12), RuneScape Small p11 (bold b12); 16pt is unscaled.
assert.deepEqual(resolveFontType(FontType.REGULAR), { id: FONT_PLAIN_12, scale: 1 });
assert.deepEqual(resolveFontType(FontType.SMALL), { id: FONT_PLAIN_11, scale: 1 });
assert.deepEqual(resolveFontType(FontType.BOLD), { id: FONT_BOLD_12, scale: 1 });
assert.deepEqual(resolveFontType(FontType.SMALL.withBold(true).withSize(24)), { id: FONT_BOLD_12, scale: 1.5 });
assert.deepEqual(boldFont({ id: FONT_PLAIN_11, scale: 2 }), { id: FONT_BOLD_12, scale: 2 });

// Before binding: the defaults.
assert.deepEqual(overlayFont("dynamic"), { id: FONT_PLAIN_11, scale: 1 });
assert.deepEqual(overlayFont("interface"), { id: FONT_PLAIN_12, scale: 1 });

// Bound: each change to a slot is read at once and bumps the version; other keys do not.
const config = new ConfigManager(undefined);
const unbind = bindOverlayFonts(config);
const v0 = overlayFontsVersion();
config.setConfigValue(RuneLiteConfig, "dynamicOverlayFont", FontType.REGULAR.withSize(32).withBold(true));
assert.deepEqual(overlayFont("dynamic"), { id: FONT_BOLD_12, scale: 2 });
assert.ok(overlayFontsVersion() > v0, "a font change bumps the version");
const v1 = overlayFontsVersion();
config.setConfigValue(RuneLiteConfig, "sidebarMode", "overlay");
assert.equal(overlayFontsVersion(), v1, "other settings leave the fonts alone");
config.setConfigValue(RuneLiteConfig, "infoboxFont", FontType.SMALL);
assert.deepEqual(overlayFont("infobox"), { id: FONT_PLAIN_11, scale: 1 });
config.setDefaultConfiguration(RuneLiteConfig, true);
assert.deepEqual(overlayFont("dynamic"), { id: FONT_PLAIN_11, scale: 1 }, "reset: back to the default");
unbind();

// Ground item labels: the rects draw() and coverage() report hold every glyph quad, its shadow
// and outline included, at every size. Partial redraws clear and scissor to them, so a label
// reaching past them leaves old pixels behind (PR #2044 review). The font is shaped like the cache
// fonts: an ascent of 12 and descenders reaching 3 px below the baseline, plus the shadow's 1 px.
(globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
    }) }),
};
const font = new BitmapFont();
font.ascent = font.maxAscent = 12;
font.maxDescent = 3;
for (let ch = 32; ch < 127; ch++) {
    font.advances[ch] = 7;
    font.widths[ch] = 6;
    font.heights[ch] = 13;
    font.topBearings[ch] = 2;
    font.glyphPixels[ch] = new Uint8Array(6 * 13).fill(1);
}
let quads: number[][] = [];
const renderer: any = {
    createTextureFromCanvas: (_key: string, canvas: any) => ({ tex: {}, w: canvas.width, h: canvas.height }),
    deleteTexture() {},
    drawTextureQuads(_texture: unknown, data: Float32Array, count: number) {
        for (let q = 0; q < count; q++) quads.push([...data.subarray(q * 16, q * 16 + 16)].filter((_, i) => i % 4 < 2));
    },
};
const holds = (r: { x: number; y: number; w: number; h: number }, points: number[]) => {
    for (let i = 0; i < points.length; i += 2) {
        if (points[i] < r.x || points[i] > r.x + r.w || points[i + 1] < r.y || points[i + 1] > r.y + r.h) return false;
    }
    return true;
};
for (const size of [8, 16, 24, 32, 48, 64]) for (const outline of [false, true]) {
    const overlay: any = new GroundItemsOverlay({} as any);
    overlay.frame = {
        tiles: [], backgrounds: [], boxes: [], pies: [], signature: "label",
        texts: [{ text: "Abyssal whip (GE: 751K gp) gjpqy", x: 100, y: 200, color: 0xffffffff, outline }],
        font: resolveFontType(FontType.SMALL.withSize(size)),
    };
    quads = [];
    const [drawn] = overlay.draw({ renderer, fontLoader: () => font });
    const [covered] = overlay.coverage();
    const bottom = Math.max(...quads.flatMap((q) => q.filter((_, i) => i % 2 === 1)));
    assert.ok(bottom > 200, `${size}pt: the descenders reach below the baseline`);
    for (const q of quads) {
        assert.ok(holds(drawn, q), `${size}pt ${outline ? "outline" : "shadow"}: draw() holds every quad`);
        assert.ok(holds(covered, q), `${size}pt ${outline ? "outline" : "shadow"}: coverage() holds every quad`);
    }
}

console.log("overlay-fonts: ok");
