import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** Anti-aliasing modes, as in RuneLite's GPU plugin. */
export enum AntiAliasingMode {
    DISABLED = "disabled",
    FXAA = "fxaa",
    MSAA_2 = "msaa2",
    MSAA_4 = "msaa4",
    MSAA_8 = "msaa8",
    MSAA_16 = "msaa16",
}

export const MIN_DRAW_DISTANCE = 25;
export const MAX_DRAW_DISTANCE = 160;

export const GpuConfig = ConfigGroup("gpu", {
    antiAliasingMode: ConfigItem({
        name: "Anti-aliasing",
        description:
            "Smooths jagged edges in the 3D scene. MSAA is capped at what the graphics card supports; " +
            "the WebGPU renderer only has x4, which every MSAA level uses there. " +
            "Replaces 117 HD's own anti-aliasing while this plugin is on.",
        position: 1,
        enum: {
            Disabled: AntiAliasingMode.DISABLED,
            FXAA: AntiAliasingMode.FXAA,
            "MSAA x2": AntiAliasingMode.MSAA_2,
            "MSAA x4": AntiAliasingMode.MSAA_4,
            "MSAA x8": AntiAliasingMode.MSAA_8,
            "MSAA x16": AntiAliasingMode.MSAA_16,
        },
        default: AntiAliasingMode.MSAA_4,
    }),
    drawDistance: ConfigItem({
        name: "Draw distance",
        description: "How far the scene is drawn, in tiles. Above 90 needs 117 HD.",
        position: 2,
        units: " tiles",
        range: { min: MIN_DRAW_DISTANCE, max: MAX_DRAW_DISTANCE },
        default: MIN_DRAW_DISTANCE,
    }),
    fpsLimit: ConfigItem({
        name: "FPS limit",
        description: "Caps the frame rate. 0 draws as fast as the display allows.",
        position: 3,
        units: " fps",
        range: { min: 0, max: 1000 },
        default: 240,
    }),
    colorBanding: ConfigItem({
        name: "Colour banding",
        description: "Rounds model colours into fewer steps for a retro look. 0 keeps them smooth.",
        position: 4,
        units: "%",
        range: { min: 0, max: 100 },
        default: 0,
    }),
});
