import type { WorldMapPoint } from "./WorldMapPoint";

/**
 * The world map's plugin markers (RuneLite's WorldMapPointManager); `inject(WorldMapPointManager)`.
 * `sync` runs after every change so the points can be handed to the client's plugin-point list.
 */
export class WorldMapPointManager {
    private readonly points: WorldMapPoint[] = [];

    constructor(private readonly sync: () => void = () => {}) {}

    add(point: WorldMapPoint): void {
        this.points.push(point);
        this.sync();
    }

    remove(point: WorldMapPoint): void {
        const index = this.points.indexOf(point);
        if (index >= 0) {
            this.points.splice(index, 1);
            this.sync();
        }
    }

    removeIf(predicate: (point: WorldMapPoint) => boolean): void {
        let removed = false;
        for (let i = this.points.length - 1; i >= 0; i--) {
            if (predicate(this.points[i])) {
                this.points.splice(i, 1);
                removed = true;
            }
        }
        if (removed) this.sync();
    }

    /** The current points, in the order they were added (a copy). */
    getPoints(): WorldMapPoint[] {
        return [...this.points];
    }
}
