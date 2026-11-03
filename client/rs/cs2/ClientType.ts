import {
    TOPLEVEL,
    TOPLEVEL_DISPLAY,
    TOPLEVEL_OSRS_STRETCH,
    TOPLEVEL_PRE_EOC,
} from "@runelite/api/gameval/InterfaceID";
import { isMobileMode } from "../../common/utils/DeviceUtil";

/**
 * The client type cache scripts see (the clienttype opcode): 7, the mobile client, on the mobile
 * layout, otherwise 10, the enhanced (Steam C++) client. Both are the current client to the cache
 * (scripts 1445 and 2476, which script 100 combines); 2, the pre-2024 android client, left the
 * mobile layout on the old branches, where script 876 never makes the minimap zoomable (#1510).
 * The cache's own on_mobile check (script 1972) looks for 7.
 */
export const CLIENT_TYPE_ENHANCED = 10;
export const CLIENT_TYPE_MOBILE = 7;
/** Client types scripts 1445 and 2476 treat as the current client. */
const CURRENT_CLIENT_TYPES = new Set([4, 5, 7, 8, 10]);
export const MOBILE_ROOT_INTERFACE = 601;
const DESKTOP_ROOT_INTERFACES = new Set([
    TOPLEVEL,
    TOPLEVEL_DISPLAY,
    TOPLEVEL_OSRS_STRETCH,
    TOPLEVEL_PRE_EOC,
]);

/**
 * One source of truth for "cache scripts are talking to a mobile client": the same
 * active gameframe, falling back to the startup platform before a gameframe is loaded.
 * Touch hardware alone must not count, or a touchscreen laptop (desktop layout)
 * gets told it is mobile and mobile scripts hide the mouseover text (#358).
 */
export function isMobileClient(rootInterface: number | undefined): boolean {
    if (rootInterface !== undefined && DESKTOP_ROOT_INTERFACES.has(rootInterface)) return false;
    return rootInterface === MOBILE_ROOT_INTERFACE || isMobileMode;
}

export function reportedClientType(rootInterface: number | undefined): number {
    return isMobileClient(rootInterface) ? CLIENT_TYPE_MOBILE : CLIENT_TYPE_ENHANCED;
}

/** Whether the cache draws the mouseover text itself for this client type (script 4726). */
export function isCurrentClientType(clientType: number): boolean {
    return CURRENT_CLIENT_TYPES.has(clientType);
}
