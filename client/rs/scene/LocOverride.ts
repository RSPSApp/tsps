/**
 * A loc override's `newId` for "no loc here": a LOC_DEL, or a cache loc that a server-added one
 * replaced. Loc id 0 is a real loc (Dwarf Cannon's `mcannonremains_multiloc`), so removal needs
 * its own marker.
 */
export const LOC_OVERRIDE_REMOVED = -2;

/** A loc override's `newId` that keeps the matched loc's own id (an animation, a rotation). */
export const LOC_OVERRIDE_KEEP_ID = -1;

/**
 * The override `newId` for a loc id from a LOC_CHANGE or a gamemode world loc change, where 0
 * means the loc was removed.
 */
export function locOverrideIdFromChange(newId: number): number {
    return (newId | 0) === 0 ? LOC_OVERRIDE_REMOVED : newId | 0;
}

/** The loc a map loc `id` becomes under `override`, or -1 when the override removes it. */
export function resolveLocOverrideId(override: { newId: number } | undefined, id: number): number {
    if (!override) return id;
    const newId = override.newId | 0;
    if (newId === LOC_OVERRIDE_REMOVED) return -1;
    return newId >= 0 ? newId : id;
}
