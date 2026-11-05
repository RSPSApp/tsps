/*
 * Copyright (c) 2019, Jordan Atwood <nightfirecat@protonmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Text } from "@runelite/client/util/Text";

const DEVICE_USED_START_TEXT = "The device is ";

/**
 * What the strange device says and how far (Chebyshev tiles) the dig spot then is (RuneLite's
 * HotColdTemperature). Beginner and master devices differ in their two hottest readings.
 */
export class HotColdTemperature {
    private constructor(
        private readonly text: string,
        private readonly minDistance: number,
        private readonly maxDistance: number,
    ) {}

    getText(): string {
        return this.text;
    }

    getMinDistance(): number {
        return this.minDistance;
    }

    getMaxDistance(): number {
        return this.maxDistance;
    }

    static readonly ICE_COLD = new HotColdTemperature("ice cold", 500, 5000);
    static readonly VERY_COLD = new HotColdTemperature("very cold", 200, 499);
    static readonly COLD = new HotColdTemperature("cold", 150, 199);
    static readonly WARM = new HotColdTemperature("warm", 100, 149);
    static readonly HOT = new HotColdTemperature("hot", 70, 99);
    static readonly VERY_HOT = new HotColdTemperature("very hot", 30, 69);
    static readonly BEGINNER_INCREDIBLY_HOT = new HotColdTemperature("incredibly hot", 4, 29);
    static readonly BEGINNER_VISIBLY_SHAKING = new HotColdTemperature("visibly shaking", 0, 3);
    static readonly MASTER_INCREDIBLY_HOT = new HotColdTemperature("incredibly hot", 5, 29);
    static readonly MASTER_VISIBLY_SHAKING = new HotColdTemperature("visibly shaking", 0, 4);

    static readonly BEGINNER_HOT_COLD_TEMPERATURES: ReadonlySet<HotColdTemperature> = new Set([
        HotColdTemperature.ICE_COLD,
        HotColdTemperature.VERY_COLD,
        HotColdTemperature.COLD,
        HotColdTemperature.WARM,
        HotColdTemperature.HOT,
        HotColdTemperature.VERY_HOT,
        HotColdTemperature.BEGINNER_INCREDIBLY_HOT,
        HotColdTemperature.BEGINNER_VISIBLY_SHAKING,
    ]);

    static readonly MASTER_HOT_COLD_TEMPERATURES: ReadonlySet<HotColdTemperature> = new Set([
        HotColdTemperature.ICE_COLD,
        HotColdTemperature.VERY_COLD,
        HotColdTemperature.COLD,
        HotColdTemperature.WARM,
        HotColdTemperature.HOT,
        HotColdTemperature.VERY_HOT,
        HotColdTemperature.MASTER_INCREDIBLY_HOT,
        HotColdTemperature.MASTER_VISIBLY_SHAKING,
    ]);

    /**
     * The temperature a device message names, from the given set, or null. "very cold" contains
     * "cold", so the longest matching text wins.
     */
    static getFromTemperatureSet(temperatureSet: ReadonlySet<HotColdTemperature> | null, message: string): HotColdTemperature | null {
        if (!message.startsWith(DEVICE_USED_START_TEXT) || !temperatureSet) return null;
        const messageStart = Text.fromCSV(message)[0] ?? "";
        let best: HotColdTemperature | null = null;
        for (const temperature of temperatureSet) {
            if (messageStart.includes(temperature.text) && (!best || temperature.text.length > best.text.length)) best = temperature;
        }
        return best;
    }
}
