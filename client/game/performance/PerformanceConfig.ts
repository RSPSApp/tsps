import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** The saved graphics preset. Auto resolves from the device; the rest are explicit. */
export enum PerformanceMode {
    AUTO = "auto",
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
}

/** True when the active client renderer is WebGPU; used to mark scene resolution unsupported. */
export function isWebGPURendererActive(): boolean {
    try {
        return (globalThis as any)?.__osrsClient?.renderer?.type === "webgpu";
    } catch {
        return false;
    }
}

/**
 * One place for every low-end switch. The old Low-end Device plugin is migrated into `mode`
 * (see PerformancePolicy); the old GPU draw-distance/FPS/AA settings remain explicit
 * overrides when the GPU plugin is on.
 */
export const PerformanceConfig = ConfigGroup("performance", {
    mode: ConfigItem({
        name: "Graphics preset",
        description:
            "Auto picks a preset from the device and a small startup GPU probe. Low keeps the scene " +
            "at half resolution, one render worker and 30 FPS. Medium is a balanced desktop preset. " +
            "High uses the normal desktop resolution and limits. Phone/tablet memory caps still apply " +
            "on High. Changing the worker count, cache budgets or map-building mode needs a reload; " +
            "scene resolution, draw distance, FPS, AA and HUD limits apply immediately.",
        position: 1,
        enum: {
            Auto: PerformanceMode.AUTO,
            Low: PerformanceMode.LOW,
            Medium: PerformanceMode.MEDIUM,
            High: PerformanceMode.HIGH,
        },
        default: PerformanceMode.AUTO,
    }),
    sceneResolution: ConfigItem({
        name: "Scene resolution",
        description:
            "Override the preset's 3D resolution (50-100%). 0 follows the preset. The UI stays sharp. " +
            "WebGL only: the WebGPU renderer has no scene-resolution scaling yet.",
        position: 2,
        units: "%",
        range: { min: 0, max: 100 },
        step: 5,
        default: 0,
        disabled: isWebGPURendererActive,
        disabledReason:
            "Unsupported by the WebGPU renderer. Use WebGL for scene-resolution scaling; " +
            "WebGPU support is follow-up work.",
    }),
    drawDistance: ConfigItem({
        name: "Draw distance",
        description:
            "Override the preset's draw-distance cap, in tiles. 0 follows the preset. The hard range " +
            "is 25-160; above 90 needs 117 HD.",
        position: 3,
        units: " tiles",
        range: { min: 0, max: 160 },
        step: 5,
        default: 0,
    }),
    fpsLimit: ConfigItem({
        name: "FPS limit",
        description:
            "Override the preset's frame-rate cap. -1 follows the preset, 0 removes the preset cap " +
            "(the game's FPS setting and hidden-tab cap still apply). Handheld battery limits from " +
            "the game scripts also apply.",
        position: 4,
        units: " fps",
        range: { min: -1, max: 1000 },
        step: 1,
        default: -1,
    }),
});

export type PerformanceConfigValues = {
    mode: PerformanceMode;
    sceneResolution: number;
    drawDistance: number;
    fpsLimit: number;
};
