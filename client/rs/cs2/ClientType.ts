import { isMobileMode } from "../../common/utils/DeviceUtil";

/**
 * The client type cache scripts see (the clienttype opcode): 2 (android) on the mobile layout,
 * otherwise 10, the enhanced (Steam C++) client.
 */
export const CLIENT_TYPE_ENHANCED = 10;
export const CLIENT_TYPE_ANDROID = 2;
export const MOBILE_ROOT_INTERFACE = 601;

/**
 * One source of truth for "cache scripts are talking to a mobile client": the same
 * platform decision that picks the mobile layout, plus the runtime mobile root.
 * Touch hardware alone must not count, or a touchscreen laptop (desktop layout)
 * gets told it is mobile and mobile scripts hide the mouseover text (#358).
 */
export function isMobileClient(rootInterface: number | undefined): boolean {
    return isMobileMode || rootInterface === MOBILE_ROOT_INTERFACE;
}

export function reportedClientType(rootInterface: number | undefined): number {
    return isMobileClient(rootInterface) ? CLIENT_TYPE_ANDROID : CLIENT_TYPE_ENHANCED;
}
