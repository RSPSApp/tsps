import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { scaleFromRuneliteResizableScalingPercent } from "../../../ui/UiScale";
import type { LoginStretch } from "../../login/renderer/types";
import { StretchedModeConfig } from "./StretchedModeConfig";

/** Size of the fixed gameframe (toplevel 548) in layout units. */
const FIXED_WIDTH = 765;
const FIXED_HEIGHT = 503;

export interface FixedStretch {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
}

/**
 * Fits the 765x503 fixed gameframe to a buffer of bufW x bufH device pixels. `minScale` is the
 * unstretched scale (the integer device-pixel ratio), so a small window never shrinks the frame.
 */
export function computeFixedStretch(
    bufW: number,
    bufH: number,
    minScale: number,
    keepAspectRatio: boolean,
    integerScaling: boolean,
): FixedStretch {
    let scaleX = bufW / FIXED_WIDTH;
    let scaleY = bufH / FIXED_HEIGHT;
    if (keepAspectRatio) scaleX = scaleY = Math.min(scaleX, scaleY);
    if (integerScaling) {
        scaleX = Math.floor(scaleX);
        scaleY = Math.floor(scaleY);
    }
    scaleX = Math.max(minScale, scaleX);
    scaleY = Math.max(minScale, scaleY);
    return {
        scaleX,
        scaleY,
        offsetX: Math.max(0, Math.floor((bufW - FIXED_WIDTH * scaleX) / 2)),
        offsetY: Math.max(0, Math.floor((bufH - FIXED_HEIGHT * scaleY) / 2)),
    };
}

/**
 * Scales a resizable layout of width x height (at interface scale 1) up by `factor` on top of
 * the in-game interface scale, but never so far that the layout drops below the fixed
 * gameframe's 765x503, and never below the in-game scale itself.
 */
export function computeResizableScale(uiScale: number, factor: number, width: number, height: number): number {
    const largest = Math.min(width / FIXED_WIDTH, height / FIXED_HEIGHT);
    return Math.max(uiScale, Math.min(uiScale * factor, largest));
}

/**
 * Stretched mode, as in RuneLite: the fixed gameframe is scaled up to fill the window instead
 * of sitting at 765x503 in a corner of it, resizable mode is drawn larger by a percentage, and
 * the 3D scene can be drawn at a lower resolution. The login screen grows with large windows
 * instead of staying 1:1, though not to fill them. Interfaces are drawn at the scaled size
 * rather than stretched from a smaller image, so they stay sharp. The renderer asks
 * fixedStretch, resizableScale and sceneResolutionScale each frame.
 */
export class StretchedModePlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Stretched Mode",
        description: "Stretches fixed mode to fill the window and draws resizable mode larger.",
        tags: ["resize", "ui", "interface", "stretch", "scaling", "fixed", "resizable"],
        enabledByDefault: false,
        configKey: "stretchedmodeplugin",
    };

    static config = StretchedModeConfig;

    private readonly configManager = inject(ConfigManager);
    private keepAspectRatio = true;
    private integerScaling = false;
    private resizableScaling = 0;
    private sceneResolution = 100;

    constructor() {
        super();
        this.readConfig();
    }

    /** Config events only reach a started plugin, so pick up changes made while it was off. */
    protected override async startUp(): Promise<void> {
        this.readConfig();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === StretchedModeConfig.group) this.readConfig();
    }

    /** The fixed gameframe's transform for this buffer, or null when stretching is off. */
    fixedStretch(bufW: number, bufH: number, minScale: number): FixedStretch | null {
        if (!this.isEnabled()) return null;
        return computeFixedStretch(bufW, bufH, minScale, this.keepAspectRatio, this.integerScaling);
    }

    /**
     * The resizable interface scale: the in-game `uiScale` grown by the Resizable scaling
     * percentage, for a layout of width x height at scale 1.
     */
    resizableScale(uiScale: number, width: number, height: number): number {
        if (!this.isStretchingResizable()) return uiScale;
        const factor = scaleFromRuneliteResizableScalingPercent(this.resizableScaling);
        return computeResizableScale(uiScale, factor, width, height);
    }

    /** The login screen's stretch settings, or null when it should stay 1:1. */
    loginStretch(): LoginStretch | null {
        return this.isEnabled() ? { integerScaling: this.integerScaling } : null;
    }

    isStretchingResizable(): boolean {
        return this.isEnabled() && this.resizableScaling > 0;
    }

    /** Fraction of full resolution the 3D scene is drawn at. */
    sceneResolutionScale(): number {
        return this.isEnabled() ? this.sceneResolution / 100 : 1;
    }

    private readConfig(): void {
        const config = this.configManager.getConfig(StretchedModeConfig);
        this.keepAspectRatio = config.keepAspectRatio();
        this.integerScaling = config.integerScaling();
        this.resizableScaling = Math.max(0, config.resizableScaling());
        this.sceneResolution = Math.max(50, Math.min(100, config.sceneResolution()));
    }
}
