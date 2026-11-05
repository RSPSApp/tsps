import type { WorldMapPoint } from "./WorldMapPoint";

/** The world map's plugin markers (RuneLite's WorldMapPointManager); `inject(WorldMapPointManager)`. */
export class WorldMapPointManager {
    private readonly points: WorldMapPoint[] = [];

    add(point: WorldMapPoint): void {
        this.points.push(point);
    }

    remove(point: WorldMapPoint): void {
        const index = this.points.indexOf(point);
        if (index >= 0) this.points.splice(index, 1);
    }

    removeIf(predicate: (point: WorldMapPoint) => boolean): void {
        for (let i = this.points.length - 1; i >= 0; i--) {
            if (predicate(this.points[i])) this.points.splice(i, 1);
        }
    }

    /** The current points, in the order they were added (a copy). */
    getPoints(): WorldMapPoint[] {
        return [...this.points];
    }
}
