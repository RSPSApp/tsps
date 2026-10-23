import { LocAnimated } from "./LocAnimated";

/**
 * Locs whose models reach below the floor and are meant to be seen down there: the Fractured
 * Archive's void (Ocellus' degen bomb, debris and cracks, 62701-62705). OSRS paints a loc after
 * its floor with no depth test, so a pit modelled under the ground shows, and gains depth as the
 * camera turns; a depth-tested floor hides it. These are drawn again after the opaque scene: once
 * with the floor's depth under them reset to the far plane, then normally.
 */
export const SUNKEN_LOC_IDS: ReadonlySet<number> = new Set([62701, 62702, 62703, 62704, 62705]);

type SunkenRanges = { opaque: number[]; alpha: number[] };
const NONE: SunkenRanges = { opaque: [], alpha: [] };
/** Per animated-loc list (a square replaces its list when its locs load), so frames don't rescan. */
const cache = new WeakMap<readonly LocAnimated[], SunkenRanges>();

/** The draw range indices (full detail, not interact) of a square's sunken animated locs. */
export function sunkenRangeIndices(locs: readonly LocAnimated[], alpha: boolean): readonly number[] {
    let ranges = cache.get(locs);
    if (!ranges) {
        ranges = NONE;
        for (const loc of locs) {
            if (!SUNKEN_LOC_IDS.has(loc.id)) continue;
            if (ranges === NONE) ranges = { opaque: [], alpha: [] };
            const opaque = loc.getDrawRangeIndex(false, false, false);
            const translucent = loc.getDrawRangeIndex(true, false, false);
            if (opaque !== -1) ranges.opaque.push(opaque);
            if (translucent !== -1) ranges.alpha.push(translucent);
        }
        cache.set(locs, ranges);
    }
    return alpha ? ranges.alpha : ranges.opaque;
}

/** Whether a square has any sunken loc (cached with its loc list). */
export function hasSunkenLocs(locs: readonly LocAnimated[]): boolean {
    return sunkenRangeIndices(locs, false).length > 0 || sunkenRangeIndices(locs, true).length > 0;
}
