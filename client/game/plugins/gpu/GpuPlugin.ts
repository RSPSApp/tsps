import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";
import { lowEndDeviceModeExplicit } from "../lowenddevice/LowEndDeviceMode";
import { AntiAliasingMode, GpuConfig, MAX_DRAW_DISTANCE, MIN_DRAW_DISTANCE } from "./GpuConfig";

/** What the renderers apply while the plugin is on. */
export interface GpuSettings {
    /** MSAA sample count asked for: 0 for none, else 2, 4, 8 or 16. */
    msaaSamples: number;
    fxaa: boolean;
    /** Draw distance in tiles. */
    drawDistance: number;
    /** Frame-rate cap; 0 for none. */
    fpsLimit: number;
    /** The shaders' u_colorBanding: 255 is smooth, lower rounds colours into fewer steps. */
    colorBanding: number;
    /** Fog start follows the draw distance (autoFogDepthFactor) or sits at fogDepth tiles. */
    autoFogDepth: boolean;
    autoFogDepthFactor: number;
    fogDepth: number;
    /** These are the user's choices, so the mobile profile's distance caps must not lower them. */
    overrideDeviceCaps: boolean;
}

const MSAA_SAMPLES: Readonly<Record<string, number>> = {
    [AntiAliasingMode.MSAA_2]: 2,
    [AntiAliasingMode.MSAA_4]: 4,
    [AntiAliasingMode.MSAA_8]: 8,
    [AntiAliasingMode.MSAA_16]: 16,
};

const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Reads the config into what the renderers apply. */
export function resolveGpuSettings(config: {
    antiAliasingMode: string;
    drawDistance: number;
    fpsLimit: number;
    colorBanding: number;
    autoFog: boolean;
    fogStart: number;
    manualFogStart: number;
}): GpuSettings {
    return {
        msaaSamples: MSAA_SAMPLES[config.antiAliasingMode] ?? 0,
        fxaa: config.antiAliasingMode === AntiAliasingMode.FXAA,
        drawDistance: clamp(config.drawDistance | 0, MIN_DRAW_DISTANCE, MAX_DRAW_DISTANCE),
        fpsLimit: clamp(config.fpsLimit | 0, 0, 1000),
        // The same mapping as the dev panel's Color Banding slider.
        colorBanding: 255 - clamp(config.colorBanding | 0, 0, 100) * 2,
        autoFogDepth: config.autoFog,
        autoFogDepthFactor: clamp(config.fogStart, 0, 100) / 100,
        fogDepth: clamp(config.manualFogStart, 0, 400),
        overrideDeviceCaps: true,
    };
}

/**
 * RuneLite's GPU plugin: anti-aliasing (FXAA or MSAA x2 to x16), draw distance, an FPS cap
 * and colour banding, kept across sessions. While it is on, its settings replace the
 * renderer's defaults and the browser quality profile's; the renderers ask `gpuSettings()` each
 * frame, so changes apply straight away on WebGL and WebGPU alike.
 */
export class GpuPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "GPU",
        description: "Anti-aliasing, draw distance, FPS limit and other graphics settings.",
        tags: ["gpu", "graphics", "anti-aliasing", "msaa", "fxaa", "draw distance", "fps", "banding"],
        enabledByDefault: false,
        configKey: "gpuplugin",
    };

    static config = GpuConfig;

    private readonly configManager = inject(ConfigManager);
    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private current: GpuSettings;

    constructor() {
        super();
        this.current = this.readConfig();
    }

    /** Config events only reach a started plugin, so pick up changes made while it was off. */
    protected override async startUp(): Promise<void> {
        this.current = this.readConfig();
        if (this.configManager.getConfiguration(GpuConfig.group, "brightness") !== undefined) {
            this.client.applyScreenBrightness(this.configManager.getConfig(GpuConfig).brightness());
        }
        this.applySkyColor();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== GpuConfig.group) return;
        this.current = this.readConfig();
        if (event.getKey() === "brightness") {
            this.client.applyScreenBrightness(this.configManager.getConfig(GpuConfig).brightness());
        }
        if (event.getKey() === "skyColor") this.applySkyColor();
    }

    private applySkyColor(): void {
        const renderer = this.client.renderer as {
            setSkyColor?: (r: number, g: number, b: number, explicit?: boolean) => void;
            clearSkyColorOverride?: () => void;
        } | undefined;
        if (this.configManager.getConfiguration(GpuConfig.group, "skyColor") === undefined) {
            renderer?.clearSkyColorOverride?.();
            return;
        }
        const color = this.configManager.getConfig(GpuConfig).skyColor() >>> 0;
        renderer?.setSkyColor?.((color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff, true);
    }

    /** The settings to apply, or undefined while the plugin is off or an explicit Low-end Device wins. */
    gpuSettings(): GpuSettings | undefined {
        return this.isEnabled() && !lowEndDeviceModeExplicit ? this.current : undefined;
    }

    private readConfig(): GpuSettings {
        const config = this.configManager.getConfig(GpuConfig);
        return resolveGpuSettings({
            antiAliasingMode: config.antiAliasingMode(),
            drawDistance: config.drawDistance(),
            fpsLimit: config.fpsLimit(),
            colorBanding: config.colorBanding(),
            autoFog: config.autoFog(),
            fogStart: config.fogStart(),
            manualFogStart: config.manualFogStart(),
        });
    }
}
