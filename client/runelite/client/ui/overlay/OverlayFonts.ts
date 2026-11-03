import { FONT_BOLD_12, FONT_PLAIN_11, FONT_PLAIN_12 } from "../../../../ui/fonts";
import type { ConfigManager } from "../../config/ConfigManager";
import { FontType } from "../../config/FontType";
import { RuneLiteConfig } from "../../config/RuneLiteConfig";

/**
 * The fonts RuneLite's OverlayRenderer hands each overlay by its position: DYNAMIC and DETACHED
 * overlays get the dynamic overlay font, TOOLTIP the tooltip font and the rest the interface
 * font; InfoBoxOverlay sets the infobox font itself.
 */
export type OverlayFontSlot = "dynamic" | "tooltip" | "interface" | "infobox";

/** A slot's font as the overlays draw it: a cache font and a scale on top of their own. */
export type OverlayFont = { id: number; scale: number };

const DEFAULTS: Record<OverlayFontSlot, FontType> = {
    dynamic: RuneLiteConfig.items.dynamicOverlayFont.default as FontType,
    tooltip: RuneLiteConfig.items.tooltipFont.default as FontType,
    interface: RuneLiteConfig.items.interfaceFont.default as FontType,
    infobox: RuneLiteConfig.items.infoboxFont.default as FontType,
};

/** RuneLiteConfig's key for each slot. */
const KEYS: Record<OverlayFontSlot, string> = {
    dynamic: "fontType",
    tooltip: "tooltipFontType",
    interface: "interfaceFontType",
    infobox: "infoboxFontType",
};

/**
 * A FontType as a cache font: RuneScape is p12_full and its bold face b12_full, RuneScape Small
 * is p11_full. RuneScape Small has no bold face, so bold takes b12_full there too. The cache
 * fonts are bitmaps drawn at 16pt, so another size scales them.
 */
export function resolveFontType(type: FontType): OverlayFont {
    const id = type.bold ? FONT_BOLD_12 : type.family === FontType.RUNESCAPE_SMALL ? FONT_PLAIN_11 : FONT_PLAIN_12;
    return { id, scale: FontType.clampSize(type.size) / FontType.DEFAULT_SIZE };
}

let fonts: Record<OverlayFontSlot, OverlayFont> = {
    dynamic: resolveFontType(DEFAULTS.dynamic),
    tooltip: resolveFontType(DEFAULTS.tooltip),
    interface: resolveFontType(DEFAULTS.interface),
    infobox: resolveFontType(DEFAULTS.infobox),
};
let version = 0;

/** The font's bold face at the same scale, for text RuneLite draws bold whatever the font. */
export function boldFont(font: OverlayFont): OverlayFont {
    return { id: FONT_BOLD_12, scale: font.scale };
}

/** The slot's current font (its default until `bindOverlayFonts` runs). */
export function overlayFont(slot: OverlayFontSlot): OverlayFont {
    return fonts[slot];
}

/** Changes whenever any slot's font does, so every overlay redraws (OverlayRenderer's font cache). */
export function overlayFontsVersion(): number {
    return version;
}

/** Reads the slots from RuneLiteConfig now and on every change; returns the unbind. */
export function bindOverlayFonts(configManager: ConfigManager): () => void {
    const config = configManager.getConfig(RuneLiteConfig);
    const load = () => {
        fonts = {
            dynamic: resolveFontType(config.dynamicOverlayFont() as FontType),
            tooltip: resolveFontType(config.tooltipFont() as FontType),
            interface: resolveFontType(config.interfaceFont() as FontType),
            infobox: resolveFontType(config.infoboxFont() as FontType),
        };
        version++;
    };
    load();
    const keys = new Set(Object.values(KEYS));
    return configManager.addListener((event) => {
        if (event.getGroup() === RuneLiteConfig.group && keys.has(event.getKey())) load();
    });
}
