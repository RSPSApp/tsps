import { Location } from "../Location";
import { Mobile } from "../../entity/impl/Mobile";
import { Area } from "./Area";
import { Wilderness } from "../../content/wilderness/Wilderness";

export class AreaManager {
    public static areas: Area[] = [];
    private static readonly AREA_INDEX_BUCKET_SIZE = 64;
    private static readonly areaHints = new WeakMap<Mobile, AreaHint>();
    private static areaSearchIndex: AreaSearchIndexState | null = null;
    /**
     * Processes areas for the given character.
     *
     * @param c
     */
    public static process(c: Mobile): void {
        let position = c.getLocation();
        let area = c.getArea();
        const hint = AreaManager.areaHints.get(c);

        let previousArea: Area | null = null;
        let boundaryIndex = -1;

        if (area != null) {
            boundaryIndex = AreaManager.findBoundaryIndex(position, area, hint != null && hint.area === area ? hint.boundaryIndex : -1);
            if (boundaryIndex === -1) {
                area.leave(c, false);
                previousArea = area;
                area = null;
            }
        }

        if (area == null) {
            if (hint != null
                && hint.area == null
                && hint.x === position.getX()
                && hint.y === position.getY()
                && hint.z === position.getZ()) {
                area = null;
            } else {
                const resolved = AreaManager.getWithBoundaryIndex(position);
                area = resolved.area;
                boundaryIndex = resolved.boundaryIndex;
            }
            if (area != null) {
                area.enter(c);
            }
        }

        // Handle processing..
        if (area != null) {
            // Record the area first: process() may move the actor into another area
            // (Pest Control), which is only detectable against what was recorded.
            c.setArea(area);
            const processedArea = area;
            area.process(c);
            if (c.getArea() !== processedArea) {
                area = c.getArea();
                boundaryIndex = area == null
                    ? -1
                    : AreaManager.findBoundaryIndex(c.getLocation(), area);
            }
        }

        // Handle multiicon update..
        if (c.isPlayer()) {
            let player = c.getAsPlayer();
            const multiIcon = AreaManager.inMulti(c) ? 1 : 0;

            if (player.getMultiIcon() != multiIcon) {
                player.setMultiIcon(multiIcon);
            }
        }

        // Update area..
        c.setArea(area);
        const currentPosition = c.getLocation();
        AreaManager.areaHints.set(c, {
            area,
            boundaryIndex,
            x: currentPosition.getX(),
            y: currentPosition.getY(),
            z: currentPosition.getZ(),
        });

    }

    public static inMulti(c: Mobile): boolean {
        if (c.getArea()?.isMulti()) {
            return true;
        }
        const location = c.getLocation();
        return Wilderness.isMulti(location.getX(), location.getY(), location.getZ());
    }

    /**
     * Gets a {@link Area} based on a given {@link Location}.
     *
     * @param position
     * @return
     */
    public static get(position: Location): Area | null {
        return AreaManager.getWithBoundaryIndex(position).area;
    }

    private static getWithBoundaryIndex(position: Location): AreaSearchResult {
        const candidates = AreaManager.getCandidateBoundaries(position);
        for (const candidate of candidates) {
            if (AreaManager.boundaryMatches(position, candidate.area, candidate.boundaryIndex)) {
                return {
                    area: candidate.area,
                    boundaryIndex: candidate.boundaryIndex,
                };
            }
        }
        return { area: null, boundaryIndex: -1 };
    }

    /**
     * Checks if a position is inside of an area's boundaries.
     *
     * @param position
     * @return
     */
    public static inside(position: Location, area: Area): boolean {
        return AreaManager.findBoundaryIndex(position, area) !== -1;
    }

    private static findBoundaryIndex(position: Location, area: Area, hintBoundaryIndex: number = -1): number {
        const boundaries = area.getBoundaries();
        if (boundaries == null || boundaries.length === 0) {
            return -1;
        }

        if (AreaManager.boundaryMatches(position, area, hintBoundaryIndex)) {
            return hintBoundaryIndex;
        }

        for (let index = 0; index < boundaries.length; index++) {
            if (index !== hintBoundaryIndex && AreaManager.boundaryMatches(position, area, index)) {
                return index;
            }
        }
        return -1;
    }

    private static boundaryMatches(position: Location, area: Area, boundaryIndex: number): boolean {
        const boundaries = area.getBoundaries();
        if (
            boundaries == null
            || boundaryIndex < 0
            || boundaryIndex >= boundaries.length
        ) {
            return false;
        }
        return boundaries[boundaryIndex].inside(position);
    }

    private static getCandidateBoundaries(position: Location): IndexedBoundaryRef[] {
        const state = AreaManager.ensureAreaSearchIndex();
        if (state.bucketed.size === 0) {
            return state.fallback;
        }

        const bucketKey = AreaManager.getAreaBucketKey(
            position.getX(),
            position.getY(),
            position.getZ(),
        );
        const bucketCandidates = state.bucketed.get(bucketKey);

        if (!bucketCandidates || bucketCandidates.length === 0) {
            return state.fallback;
        }

        if (state.fallback.length === 0) {
            return bucketCandidates;
        }

        return AreaManager.mergeIndexedBoundaryRefs(bucketCandidates, state.fallback);
    }

    private static ensureAreaSearchIndex(): AreaSearchIndexState {
        let boundaryCount = 0;
        for (const area of AreaManager.areas) {
            boundaryCount += area.getBoundaries()?.length ?? 0;
        }

        if (
            AreaManager.areaSearchIndex != null
            && AreaManager.areaSearchIndex.areaCount === AreaManager.areas.length
            && AreaManager.areaSearchIndex.boundaryCount === boundaryCount
        ) {
            return AreaManager.areaSearchIndex;
        }

        const bucketed = new Map<string, IndexedBoundaryRef[]>();
        const fallback: IndexedBoundaryRef[] = [];

        for (let areaOrder = 0; areaOrder < AreaManager.areas.length; areaOrder++) {
            const area = AreaManager.areas[areaOrder];
            const boundaries = area.getBoundaries();
            if (boundaries == null || boundaries.length === 0) {
                continue;
            }

            for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
                const boundary = boundaries[boundaryIndex];
                const entry: IndexedBoundaryRef = { area, boundaryIndex, areaOrder };

                const minX = boundary.getX?.();
                const maxX = boundary.getX2?.();
                const minY = boundary.getY?.();
                const maxY = boundary.getY2?.();
                const z = boundary.height;

                if (
                    !Number.isFinite(minX)
                    || !Number.isFinite(maxX)
                    || !Number.isFinite(minY)
                    || !Number.isFinite(maxY)
                    || !Number.isFinite(z)
                ) {
                    fallback.push(entry);
                    continue;
                }

                const minBucketX = AreaManager.toAreaBucketCoordinate(minX);
                const maxBucketX = AreaManager.toAreaBucketCoordinate(maxX);
                const minBucketY = AreaManager.toAreaBucketCoordinate(minY);
                const maxBucketY = AreaManager.toAreaBucketCoordinate(maxY);

                for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
                    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
                        const key = AreaManager.getAreaBucketKey(bucketX, bucketY, z, true);
                        let entries = bucketed.get(key);
                        if (entries == null) {
                            entries = [];
                            bucketed.set(key, entries);
                        }
                        entries.push(entry);
                    }
                }
            }
        }

        AreaManager.areaSearchIndex = {
            areaCount: AreaManager.areas.length,
            boundaryCount,
            bucketed,
            fallback,
        };
        return AreaManager.areaSearchIndex;
    }

    private static toAreaBucketCoordinate(value: number): number {
        return Math.trunc(value / AreaManager.AREA_INDEX_BUCKET_SIZE);
    }

    private static getAreaBucketKey(x: number, y: number, z: number, preBucketed: boolean = false): string {
        const bucketX = preBucketed ? x : AreaManager.toAreaBucketCoordinate(x);
        const bucketY = preBucketed ? y : AreaManager.toAreaBucketCoordinate(y);
        return `${z}:${bucketX}:${bucketY}`;
    }

    private static mergeIndexedBoundaryRefs(
        primary: IndexedBoundaryRef[],
        secondary: IndexedBoundaryRef[],
    ): IndexedBoundaryRef[] {
        const merged: IndexedBoundaryRef[] = [];
        let i = 0;
        let j = 0;

        while (i < primary.length && j < secondary.length) {
            if (primary[i].areaOrder <= secondary[j].areaOrder) {
                merged.push(primary[i++]);
            } else {
                merged.push(secondary[j++]);
            }
        }

        while (i < primary.length) {
            merged.push(primary[i++]);
        }

        while (j < secondary.length) {
            merged.push(secondary[j++]);
        }

        return merged;
    }
}

type AreaSearchResult = {
    area: Area | null;
    boundaryIndex: number;
};

type AreaHint = {
    area: Area | null;
    boundaryIndex: number;
    x: number;
    y: number;
    z: number;
};

type IndexedBoundaryRef = {
    area: Area;
    boundaryIndex: number;
    areaOrder: number;
};

type AreaSearchIndexState = {
    areaCount: number;
    boundaryCount: number;
    bucketed: Map<string, IndexedBoundaryRef[]>;
    fallback: IndexedBoundaryRef[];
};
