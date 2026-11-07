/*
 * Copyright (c) 2019, Jordan Atwood <nightfirecat@protonmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */

/** Whether the device got warmer, stayed the same or got colder since the last reading. */
export class HotColdTemperatureChange {
    private constructor(private readonly text: string) {}

    static readonly WARMER = new HotColdTemperatureChange("and warmer than");
    static readonly SAME = new HotColdTemperatureChange("and the same temperature as");
    static readonly COLDER = new HotColdTemperatureChange("but colder than");

    /** The change a device message names, or null for a first reading (no "... last time."). */
    static of(message: string): HotColdTemperatureChange | null {
        if (!message.endsWith(" last time.")) return null;
        for (const change of [HotColdTemperatureChange.WARMER, HotColdTemperatureChange.SAME, HotColdTemperatureChange.COLDER]) {
            if (message.includes(change.text)) return change;
        }
        return null;
    }
}
