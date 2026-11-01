/**
 * A tile keeps its locs in slots addressed by model type (shape) *and* rotation, so an object the
 * server adds or removes only replaces the cache loc in the same slot. Matching by shape alone
 * removed unrelated scenery from the tile: the Grand Exchange's paving is rotation-1 NORMAL
 * locs, so a rotation-0 fire erased the paving of the tile it was lit on (issue #1748).
 *
 * `typeRots` are the square's packed per-tile entries (`(rotation << 6) | type`), the same packing
 * the loc index uses everywhere else.
 */
export function matchingLocSlotIds(
    ids: ArrayLike<number>,
    typeRots: ArrayLike<number>,
    shape: number,
    rotation: number,
): number[] {
    const matching: number[] = [];
    const count = Math.min(ids.length, typeRots.length);
    for (let index = 0; index < count; index++) {
        const id = ids[index] | 0;
        if (id <= 0) continue;
        const typeRot = typeRots[index] | 0;
        if ((typeRot & 0x3f) !== (shape & 0x3f)) continue;
        if (((typeRot >> 6) & 0x3) !== (rotation & 0x3)) continue;
        matching.push(id);
    }
    return matching;
}

/** The subset of a loc override entry these helpers read and write. */
export interface LocSlotOverride {
    newId?: number;
    matchType?: number;
    matchRotation?: number;
}

type OverrideStore = {
    get(key: string): LocSlotOverride | undefined;
    set(key: string, value: LocSlotOverride): unknown;
};

/** The tile-wide (`-1`) removal a tile already holds for `shape`, if any. */
export function shapeSlotOverride(
    overrides: OverrideStore,
    x: number,
    y: number,
    level: number,
    shape: number,
): LocSlotOverride | undefined {
    const base = `${x | 0},${y | 0},${level | 0},-1`;
    const direct = overrides.get(base);
    if (typeof direct?.matchType === "number" && direct.matchType !== shape) {
        return overrides.get(`${base},${shape}`);
    }
    return direct;
}

/**
 * Removes a tile's loc slot by shape when its id is unknown. The `,shape` suffix keeps a second
 * shape's removal (a floor decoration beside a chair) from overwriting the first. Without
 * `rotation` the removal covers every rotation, which is what instance scenery needs: the server
 * never removes a template hotspot, and it may be placed at a different rotation than the
 * furniture replacing it.
 */
export function suppressShapeSlotAt(
    overrides: OverrideStore,
    x: number,
    y: number,
    level: number,
    shape: number,
    rotation?: number,
): void {
    const base = `${x | 0},${y | 0},${level | 0},-1`;
    const existing = overrides.get(base);
    const key = typeof existing?.matchType === "number" && existing.matchType !== shape ? `${base},${shape}` : base;
    const entry: LocSlotOverride = { newId: 0, matchType: shape & 0x3f };
    if (rotation !== undefined) entry.matchRotation = rotation & 0x3;
    overrides.set(key, entry);
}
