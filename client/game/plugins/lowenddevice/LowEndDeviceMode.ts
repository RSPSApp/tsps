/** Runtime override; saved graphics preferences are kept for when the mode is disabled. */
export let lowEndDeviceModeEnabled = false;
/**
 * True only when the user explicitly switched Low-end Device on. The mobile
 * default is on without being explicit, so an enabled GPU plugin outranks it;
 * an explicit Low-end Device selection still wins.
 */
export let lowEndDeviceModeExplicit = false;

export function setLowEndDeviceModeEnabled(enabled: boolean, explicit = false): void {
    lowEndDeviceModeEnabled = enabled;
    lowEndDeviceModeExplicit = enabled && explicit;
}
