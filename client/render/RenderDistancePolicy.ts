import { clamp } from "../common/utils/MathUtil";

export const MOBILE_ADAPTIVE_RENDER_DISTANCE_BUSY = 10;
export const MOBILE_ADAPTIVE_RENDER_DISTANCE_HEAVY = 8;

type EffectiveRenderDistanceOptions = {
    baseRenderDistance: number;
    currentEffectiveRenderDistance: number;
    isTouchDevice: boolean;
    mobilePressure: number;
    triangles: number;
    batches: number;
};

type FogRangeOptions = {
    renderDistance: number;
    autoFogDepth: boolean;
    autoFogDepthFactor: number;
    manualFogDepth: number;
    hd?: boolean;
};

export function resolveNextEffectiveRenderDistanceTiles(
    options: EffectiveRenderDistanceOptions,
): number {
    const base = clamp(options.baseRenderDistance | 0, 25, 90);
    if (!options.isTouchDevice) {
        return base;
    }

    let target = base;

    if (options.mobilePressure >= 1 || options.triangles >= 1_000_000 || options.batches >= 900) {
        target = Math.min(target, MOBILE_ADAPTIVE_RENDER_DISTANCE_BUSY);
    }
    if (options.mobilePressure >= 2 || options.triangles >= 1_350_000 || options.batches >= 1200) {
        target = Math.min(target, MOBILE_ADAPTIVE_RENDER_DISTANCE_HEAVY);
    }

    const floor = Math.max(4, Math.min(8, base));
    target = Math.max(floor, Math.min(base, target));

    const seededCurrent =
        (options.currentEffectiveRenderDistance | 0) > 0
            ? options.currentEffectiveRenderDistance | 0
            : base;
    const current = Math.max(floor, Math.min(base, seededCurrent));
    if (target < current) {
        return Math.max(target, current - 1);
    }
    if (target > current) {
        return Math.min(target, current + 1);
    }
    return current;
}

/** The fog options resolveFogRange takes: the GPU plugin's while it is on, else the renderer's own. */
export function fogSettings(host: {
    osrsClient: { clientPlugins: { gpuSettings(): { autoFogDepth: boolean; autoFogDepthFactor: number; fogDepth: number } | undefined } };
    autoFogDepth: boolean; autoFogDepthFactor: number; fogDepth: number;
}) {
    const gpu = host.osrsClient.clientPlugins.gpuSettings() ?? host;
    return { autoFogDepth: gpu.autoFogDepth, autoFogDepthFactor: gpu.autoFogDepthFactor, manualFogDepth: gpu.fogDepth };
}

export function resolveFogRange(options: FogRangeOptions): { fogEnd: number; fogDepth: number } {
    // Short views keep most nearby scenery clear. Longer views spread haze
    // over the distance and leave a larger obscured margin for cheap culling.
    const longView = clamp((options.renderDistance - 25) / 135, 0, 1);
    const fogEnd = options.renderDistance * (options.hd ? 0.75 + 0.24 * (1 - longView) : 1);
    const autoDepth = options.hd
        ? Math.min(36 - 12 * longView, options.renderDistance * (0.15 + 0.63 * (1 - longView)),
            fogEnd * options.autoFogDepthFactor)
        : fogEnd * options.autoFogDepthFactor;
    const fogDepth = options.autoFogDepth ? Math.max(0, autoDepth) : options.manualFogDepth;
    return { fogEnd, fogDepth: Math.min(fogDepth, Math.max(0, fogEnd - 1)) };
}
