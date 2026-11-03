import { strict as assert } from "node:assert";

import { ConfigManager, parseConfigValue, serializeConfigValue } from "@runelite/client/config/ConfigManager";
import { FontType } from "@runelite/client/config/FontType";
import { RuneLiteConfig } from "@runelite/client/config/RuneLiteConfig";
import { bindOverlayFonts, boldFont, overlayFont, overlayFontsVersion, resolveFontType } from "@runelite/client/ui/overlay/OverlayFonts";
import { FONT_BOLD_12, FONT_PLAIN_11, FONT_PLAIN_12 } from "../ui/fonts";

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

console.log("overlay-fonts: ok");
