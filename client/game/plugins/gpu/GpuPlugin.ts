import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
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
}): GpuSettings {
    return {
        msaaSamples: MSAA_SAMPLES[config.antiAliasingMode] ?? 0,
        fxaa: config.antiAliasingMode === AntiAliasingMode.FXAA,
        drawDistance: clamp(config.drawDistance | 0, MIN_DRAW_DISTANCE, MAX_DRAW_DISTANCE),
        fpsLimit: clamp(config.fpsLimit | 0, 0, 1000),
        // The same mapping as the dev panel's Color Banding slider.
        colorBanding: 255 - clamp(config.colorBanding | 0, 0, 100) * 2,
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
    private current: GpuSettings;

    constructor() {
        super();
        this.current = this.readConfig();
    }

    /** Config events only reach a started plugin, so pick up changes made while it was off. */
    protected override async startUp(): Promise<void> {
        this.current = this.readConfig();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === GpuConfig.group) this.current = this.readConfig();
    }

    /** The settings to apply, or undefined while the plugin is off. */
    gpuSettings(): GpuSettings | undefined {
        return this.isEnabled() ? this.current : undefined;
    }

    private readConfig(): GpuSettings {
        const config = this.configManager.getConfig(GpuConfig);
        return resolveGpuSettings({
            antiAliasingMode: config.antiAliasingMode(),
            drawDistance: config.drawDistance(),
            fpsLimit: config.fpsLimit(),
            colorBanding: config.colorBanding(),
        });
    }
}
