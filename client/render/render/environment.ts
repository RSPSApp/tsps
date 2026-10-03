import { type HdEnvironment, resolveHdEnvironmentForRegion } from "../../game/plugins/hd/HdEnvironment";
import type { WebGLOsrsRendererHost } from "./hostInterface";

/** How far the sky moves toward a new area's colour each frame. */
const SKY_BLEND_PER_FRAME = 0.15;

/**
 * The map region whose environment applies to a tile. In an instance that is the region its
 * template chunk was copied from (as 117HD does): a Gauntlet room sits at allocated tiles far
 * outside the map, but it is region 7512's room and takes the Gauntlet's colours.
 */
export function environmentRegionAt(host: WebGLOsrsRendererHost, tileX: number, tileY: number): number {
    const x = Math.floor(tileX);
    const y = Math.floor(tileY);
    const chunks = host.instanceActive ? host.instanceTemplateChunks : null;
    if (chunks) {
        const chunkX = (x >> 3) - (host.instanceRegionX - 6);
        const chunkY = (y >> 3) - (host.instanceRegionY - 6);
        for (const plane of chunks) {
            const packed = plane?.[chunkX]?.[chunkY] ?? -1;
            if (packed === -1) continue;
            const sourceChunkX = (packed >> 14) & 0x3ff;
            const sourceChunkY = (packed >> 3) & 0x7ff;
            return ((sourceChunkX >> 3) << 8) | (sourceChunkY >> 3);
        }
    }
    return ((x >> 6) << 8) | (y >> 6);
}

export function environmentAt(host: WebGLOsrsRendererHost, tileX: number, tileY: number): HdEnvironment {
    return resolveHdEnvironmentForRegion(environmentRegionAt(host, tileX, tileY));
}

/**
 * The void (clear colour) and fog tint follow the area's environment, unless a colour was
 * picked in the dev panel. Changes blend over a few frames rather than snapping.
 */
export function updateSkyColor(host: WebGLOsrsRendererHost): void {
    if (host.skyColorOverride) return;
    const target = environmentAt(host, host.playerPosUni[0], host.playerPosUni[1]).fogColor;
    for (let i = 0; i < 3; i++) {
        const delta = target[i] - host.skyColor[i];
        host.skyColor[i] = Math.abs(delta) < 1 / 512 ? target[i] : host.skyColor[i] + delta * SKY_BLEND_PER_FRAME;
    }
}
