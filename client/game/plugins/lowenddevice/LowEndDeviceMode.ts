/** Runtime override; saved graphics preferences are kept for when the mode is disabled. */
export let lowEndDeviceModeEnabled = false;

export function setLowEndDeviceModeEnabled(enabled: boolean): void {
    lowEndDeviceModeEnabled = enabled;
}
