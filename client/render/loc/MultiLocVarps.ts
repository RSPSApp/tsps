import type { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import type { VarBitTypeLoader } from "../../rs/config/vartype/bit/VarBitTypeLoader";

/** The loaded square's loc ids per level, as both renderers keep them for picking. */
export type TileLocIds = Int32Array[] | undefined;

const varpsBySquare = new WeakMap<Int32Array[], Set<number>>();

/**
 * The varps a map square's multilocs read: each one's transform varp, or its varbit's base varp.
 * A build bakes the variant those vars chose, so a change to one of them needs the square rebuilt.
 * Cached per build (a rebuild hands the square new arrays).
 */
export function multiLocVarps(
    tileLocIds: TileLocIds,
    locTypeLoader: LocTypeLoader,
    varbitLoader: VarBitTypeLoader,
): Set<number> {
    if (!tileLocIds) return new Set();
    const cached = varpsBySquare.get(tileLocIds);
    if (cached) return cached;
    const varps = new Set<number>();
    const seen = new Set<number>();
    for (const ids of tileLocIds) {
        if (!ids) continue;
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i] | 0;
            if (seen.has(id)) continue;
            seen.add(id);
            const type = locTypeLoader.load(id);
            if (!type?.transforms) continue;
            if (type.transformVarbit !== -1) {
                const baseVar = varbitLoader.load(type.transformVarbit)?.baseVar;
                if (baseVar !== undefined) varps.add(baseVar);
            } else if (type.transformVarp !== -1) {
                varps.add(type.transformVarp);
            }
        }
    }
    varpsBySquare.set(tileLocIds, varps);
    return varps;
}
