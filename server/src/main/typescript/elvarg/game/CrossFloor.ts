import { PluginManager } from "../plugins/PluginManager";
import type { Location } from "./model/Location";

/** World-configured cross-floor visibility and ranged combat; old environment settings are fallbacks. */
export class CrossFloor {
    /** Legacy combined switch remains supported when the newer switches are unset. */
    private static legacyEnabled(): boolean { return process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT === "1"; }
    static enabled(): boolean {
        const configured = PluginManager.getPluginConfig<unknown>("CrossFloor:visibility");
        if (typeof configured === "boolean") return configured;
        return process.env.CROSS_FLOOR_VISIBILITY === undefined
            ? CrossFloor.legacyEnabled()
            : process.env.CROSS_FLOOR_VISIBILITY === "1";
    }
    static combatEnabled(): boolean {
        if (!CrossFloor.enabled()) return false;
        const configured = PluginManager.getPluginConfig<unknown>("CrossFloor:combat");
        if (typeof configured === "boolean") return configured;
        return process.env.CROSS_FLOOR_COMBAT === undefined
            ? (process.env.CROSS_FLOOR_VISIBILITY === undefined && CrossFloor.legacyEnabled())
            : process.env.CROSS_FLOOR_COMBAT === "1";
    }
    static distance(a: Location, b: Location): number {
        return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
    }
    /** Projectile travel follows OSRS's horizontal Chebyshev tile distance on every floor. */
    static projectileDistance(a: Location, b: Location): number {
        return CrossFloor.distance(a, b);
    }
    static canCross(a: Location, b: Location): boolean {
        return CrossFloor.combatEnabled() && a.getZ() >= 0 && a.getZ() < 4 && b.getZ() >= 0 && b.getZ() < 4;
    }
    /** Render entities on the viewer's floor and below it; do not estimate roof occlusion server-side. */
    static visible(viewer: Location, target: Location, range: number): boolean {
        if (viewer.getZ() === target.getZ()) return CrossFloor.distance(viewer, target) <= range;
        if (!CrossFloor.enabled() || viewer.getZ() < 0 || viewer.getZ() >= 4 || target.getZ() < 0 || target.getZ() >= 4) {
            return false;
        }
        return target.getZ() < viewer.getZ() && CrossFloor.distance(viewer, target) <= range;
    }

    static projectileVisible(viewer: Location, target: Location, range: number): boolean {
        return CrossFloor.visible(viewer, target, range);
    }
}
