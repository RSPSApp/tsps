import type { EnumTypeLoader } from "../../rs/config/enumtype/EnumTypeLoader";

/**
 * Server gameframe mounts address their target by the OSRS-stretch (161) child.
 * The other gameframe layouts have their own children, related to the standard
 * ones by the cache's pane-redirect enums - the same enums script 914 uses to
 * switch tabs per layout. Keeping mounts 161-based lets the server keep one
 * mount table for every layout.
 */
export const STANDARD_GAMEFRAME_ROOT = 161;
/** Stock mobile toplevel (toplevel_osm); see MOBILE_GAMEFRAME_ROOT on the server. */
const MOBILE_GAMEFRAME_ROOT = 601;

const PANE_REDIRECT_ENUM_BY_ROOT: Readonly<Record<number, number>> = {
    [STANDARD_GAMEFRAME_ROOT]: 1130,
    164: 1131,
    165: 1132,
    548: 1129,
    // Mobile toplevel (toplevel_osm): enum 1745 maps every standard 161 child
    // onto its 601 counterpart, so the one server mount table works on phones.
    [MOBILE_GAMEFRAME_ROOT]: 1745,
};

// toplevel_osm children for the standard server mounts, mirroring the mobile
// mount table. Fills in any standard pane the cache enum omits so a mobile
// login never drops an interface (tabs 76-89, main modal 16, orbs 33, ...).
const MOBILE_PANE_FALLBACK: ReadonlyArray<readonly [number, number]> = [
    [96, 49],  // chatbox
    [9, 21],   // username
    [33, 22],  // minimap/orbs
    [7, 30],   // xp counter
    [6, 12],   // buff bar
    [16, 27],  // main modal
    [98, 134], // popout panel
    ...Array.from({ length: 14 }, (_, i) => [76 + i, 116 + i] as const),
];

function applyMobilePaneFallback(redirect: Map<number, number>): Map<number, number> {
    for (const [child, mobileChild] of MOBILE_PANE_FALLBACK) {
        if (!redirect.has(child)) redirect.set(child, mobileChild);
    }
    return redirect;
}

/**
 * Standard (161) child -> child in `root`, or undefined when the root has no
 * redirect table. Entries mapped to -1 have no equivalent component and must
 * not be mounted.
 */
export function loadGameframePaneRedirect(
    enumLoader: EnumTypeLoader | undefined,
    root: number,
): Map<number, number> | undefined {
    const enumId = PANE_REDIRECT_ENUM_BY_ROOT[root | 0];
    if (enumId === undefined) return undefined;

    const redirect = new Map<number, number>();
    const enumType = enumLoader?.load(enumId);
    if (enumType?.keys?.length && enumType.intValues?.length) {
        for (let i = 0; i < enumType.keys.length; i++) {
            const key = enumType.keys[i] | 0;
            if (((key >>> 16) & 0xffff) !== STANDARD_GAMEFRAME_ROOT) continue;
            const value = (enumType.intValues[i] ?? -1) | 0;
            redirect.set(key & 0xffff, value < 0 ? -1 : value & 0xffff);
        }
    } else if (root !== MOBILE_GAMEFRAME_ROOT) {
        return undefined;
    }
    return root === MOBILE_GAMEFRAME_ROOT ? applyMobilePaneFallback(redirect) : redirect;
}
