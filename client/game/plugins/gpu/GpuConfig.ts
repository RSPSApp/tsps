import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { isLowEndDevice } from "../../../common/utils/DeviceUtil";
import { SCREEN_BRIGHTNESS_MAX, loadScreenBrightness } from "../../../ui/ScreenBrightness";

/** Anti-aliasing modes, as in RuneLite's GPU plugin. */
export enum AntiAliasingMode {
    DISABLED = "disabled",
    FXAA = "fxaa",
    MSAA_2 = "msaa2",
    MSAA_4 = "msaa4",
    MSAA_8 = "msaa8",
    MSAA_16 = "msaa16",
}

/** The renderer backend; the debug panel's Render > Renderer, kept across sessions. */
export enum RendererChoice {
    AUTOMATIC = "auto",
    WEBGL = "webgl",
    WEBGPU = "webgpu",
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
        default: isLowEndDevice ? AntiAliasingMode.DISABLED : AntiAliasingMode.MSAA_4,
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
    renderer: ConfigItem({
        name: "Renderer",
        description: "WebGL or WebGPU. Automatic prefers WebGPU when the browser has it. Takes effect after a reload.",
        position: 5,
        enum: { Automatic: RendererChoice.AUTOMATIC, WebGL: RendererChoice.WEBGL, WebGPU: RendererChoice.WEBGPU },
        default: RendererChoice.AUTOMATIC,
    }),
    brightness: ConfigItem({
        name: "Brightness",
        description: "The Settings tab's Screen brightness (0 darkest, 100 brightest).",
        position: 6,
        range: { min: 0, max: SCREEN_BRIGHTNESS_MAX },
        default: loadScreenBrightness(),
    }),
    autoFog: ConfigItem({
        name: "Dynamic fog",
        description: "Fog starts at a share of the draw distance. Off uses the manual fog start.",
        position: 7,
        default: true,
    }),
    fogStart: ConfigItem({
        name: "Fog start",
        description: "Where dynamic fog begins, as a share of the draw distance.",
        position: 8,
        units: "%",
        range: { min: 0, max: 100 },
        default: 85,
    }),
    manualFogStart: ConfigItem({
        name: "Manual fog start",
        description: "Where fog begins when dynamic fog is off.",
        position: 9,
        units: " tiles",
        range: { min: 0, max: 400 },
        default: 24,
    }),
    skyColor: ConfigItem({
        name: "Sky colour",
        description: "Overrides the area's sky and fog colour once picked; the debug panel's Sky.",
        position: 10,
        color: true,
        default: 0,
    }),
});
