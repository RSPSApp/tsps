/*
 * Copyright (c) 2018, Eadgars Ruse <https://github.com/Eadgars-Ruse>
 * Copyright (c) 2019, Jordan Atwood <nightfirecat@protonmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Rectangle } from "@runelite/awt/Shapes";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import type { HotColdLocation } from "./HotColdLocation";
import type { HotColdTemperature } from "./HotColdTemperature";
import { HotColdTemperatureChange } from "./HotColdTemperatureChange";

/**
 * Narrows the possible dig spots from each strange device reading (RuneLite's HotColdSolver):
 * the reading's distance band rules spots in or out, and warmer/colder/same against the last
 * reading's position rules out spots that would have read otherwise.
 */
export class HotColdSolver {
    private lastWorldPoint: WorldPoint | null = null;

    constructor(private readonly possibleLocations: Set<HotColdLocation>) {}

    getPossibleLocations(): Set<HotColdLocation> {
        return this.possibleLocations;
    }

    getLastWorldPoint(): WorldPoint | null {
        return this.lastWorldPoint;
    }

    signal(worldPoint: WorldPoint, temperature: HotColdTemperature, temperatureChange: HotColdTemperatureChange | null): Set<HotColdLocation> {
        // The reading means the dig spot's centre is this many squares away (Chebyshev distance).
        const maxSquaresAway = temperature.getMaxDistance();
        const minSquaresAway = temperature.getMinDistance();
        const maxDistanceArea = new Rectangle(worldPoint.getX() - maxSquaresAway, worldPoint.getY() - maxSquaresAway, 2 * maxSquaresAway + 1, 2 * maxSquaresAway + 1);
        const minDistanceArea = new Rectangle(worldPoint.getX() - minSquaresAway, worldPoint.getY() - minSquaresAway, 2 * minSquaresAway + 1, 2 * minSquaresAway + 1);
        // Drop spots entirely within the minimum range or entirely outside the maximum range.
        this.removeIf((entry) => minDistanceArea.containsRect(entry.getRect()) || !maxDistanceArea.intersects(entry.getRect()));

        const last = this.lastWorldPoint;
        if (last && temperatureChange) {
            if (temperatureChange === HotColdTemperatureChange.COLDER) {
                this.removeIf((location) => location.getWorldPoint().distanceTo2D(worldPoint) <= location.getWorldPoint().distanceTo2D(last));
            } else if (temperatureChange === HotColdTemperatureChange.WARMER) {
                this.removeIf((location) => location.getWorldPoint().distanceTo2D(worldPoint) >= location.getWorldPoint().distanceTo2D(last));
            } else if (temperatureChange === HotColdTemperatureChange.SAME) {
                this.removeIf((location) => location.getWorldPoint().distanceTo2D(worldPoint) !== location.getWorldPoint().distanceTo2D(last));
            }
        }
        this.lastWorldPoint = worldPoint;
        return this.possibleLocations;
    }

    private removeIf(predicate: (location: HotColdLocation) => boolean): void {
        for (const location of [...this.possibleLocations]) if (predicate(location)) this.possibleLocations.delete(location);
    }
}
