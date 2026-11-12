import type { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import type { VarBitTypeLoader } from "../../rs/config/vartype/bit/VarBitTypeLoader";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import { isDoorLocType } from "./SceneLocs";

/** The loaded square's loc ids per level, as both renderers keep them for picking. */
export type TileLocIds = Int32Array[] | undefined;

export type MultiLocReloadGroup = "loc" | "full";

const varpsBySquare = new WeakMap<Int32Array[], Map<number, MultiLocReloadGroup>>();

/**
 * The varps a map square's multilocs read: each one's transform varp, or its varbit's base varp.
 * Ordinary variants only need the loc mesh rebuilt. A varp with a possible door variant
 * can affect both meshes, so it needs a full build.
 * Cached per build (a rebuild hands the square new arrays).
 */
export function multiLocVarps(
    tileLocIds: TileLocIds,
    locTypeLoader: LocTypeLoader,
    varbitLoader: VarBitTypeLoader,
): Map<number, MultiLocReloadGroup> {
    if (!tileLocIds) return new Map();
    const cached = varpsBySquare.get(tileLocIds);
    if (cached) return cached;
    const varps = new Map<number, MultiLocReloadGroup>();
    const seen = new Set<number>();
    for (const ids of tileLocIds) {
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i] | 0;
            if (seen.has(id)) continue;
            seen.add(id);
            const type = locTypeLoader.load(id);
            if (!type?.transforms) continue;
            const varp = type.transformVarbit !== -1
                ? varbitLoader.load(type.transformVarbit)?.baseVar
                : type.transformVarp;
            if (varp === undefined || varp === -1 || varps.get(varp) === "full") continue;
            const hasDoorVariant = type.transforms.some((variantId) => {
                if (variantId < 0) return false;
                const variant = locTypeLoader.load(variantId);
                return variant && isDoorLocType(variant);
            });
            varps.set(varp, hasDoorVariant ? "full" : "loc");
        }
    }
    varpsBySquare.set(tileLocIds, varps);
    return varps;
}

/**
 * What a square's multilocs show right now: each one's resolved variant, in a stable order. Many
 * varps pack unrelated varbits (the Mixology lab's progress counters share a varp with a mixer
 * slot), so a square is only rebuilt when this changes, not on every change to a varp it reads:
 * a rebuild restarts every loc animation in the square.
 */
export function multiLocVariants(
    tileLocIds: TileLocIds,
    locTypeLoader: LocTypeLoader,
    varManager: VarManager,
): string {
    if (!tileLocIds) return "";
    const seen = new Set<number>();
    const parts: string[] = [];
    for (const ids of tileLocIds) {
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i] | 0;
            if (seen.has(id)) continue;
            seen.add(id);
            const type = locTypeLoader.load(id);
            if (!type?.transforms) continue;
            parts.push(`${id}:${type.transform(varManager, locTypeLoader)?.id ?? -1}`);
        }
    }
    return parts.join(",");
}
