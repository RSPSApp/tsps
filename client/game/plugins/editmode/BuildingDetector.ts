export interface BuildingMapLoc {
    id: number;
    level: number;
    typeRot?: number;
}

export interface BuildingTile {
    x: number;
    y: number;
}

export interface DetectedBuilding {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minPlane: number;
    maxPlane: number;
    wallId?: number;
    shape: "Rectangle" | "Irregular";
    tiles: BuildingTile[];
    structureTiles: BuildingTile[];
    boundaryWalls: ReadonlySet<string>;
    terrainRoofPlane?: number;
}

interface WallEdge {
    a: string;
    b: string;
    x: number;
    y: number;
    id: number;
    level: number;
    door: boolean;
    typeRot: number;
}

const MAX_ROOF_TILES = 4096;
// ponytail: widest roofless interior observed in cache buildings; raise with map evidence.
const MAX_ROOF_GAP = 4;
const CARDINAL = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const WEST = 1;
const NORTH = 2;
const EAST = 4;
const SOUTH = 8;
const point = (x: number, y: number): string => `${x}:${y}`;
const tile = (key: string): BuildingTile => {
    const [x, y] = key.split(":").map(Number);
    return { x, y };
};
const isRoof = (loc: BuildingMapLoc): boolean => {
    const type = (loc.typeRot ?? -1) & 0x3f;
    return type >= 12 && type <= 21;
};
const wallSides = (loc: BuildingMapLoc): number => {
    const type = (loc.typeRot ?? -1) & 0x3f;
    const rotation = ((loc.typeRot ?? 0) >>> 6) & 3;
    if (type === 0) return [WEST, NORTH, EAST, SOUTH][rotation];
    if (type === 2) return [WEST | NORTH, NORTH | EAST, EAST | SOUTH, SOUTH | WEST][rotation];
    return 0;
};

const edge = (
    x: number,
    y: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): [string, string, number, number] => [point(ax, ay), point(bx, by), x, y];

const wallSegments = (x: number, y: number, typeRot = -1): Array<[string, string, number, number]> => {
    const type = typeRot & 0x3f;
    const rotation = (typeRot >>> 6) & 3;
    const straight = [
        edge(x, y, x, y, x, y + 1),
        edge(x, y, x, y + 1, x + 1, y + 1),
        edge(x, y, x + 1, y, x + 1, y + 1),
        edge(x, y, x, y, x + 1, y),
    ];
    if (type === 0) return [straight[rotation]];
    if (type === 2) return [straight[rotation], straight[(rotation + 1) & 3]];
    if (type === 1 || type === 3 || type === 9) {
        return rotation & 1
            ? [edge(x, y, x, y + 1, x + 1, y)]
            : [edge(x, y, x, y, x + 1, y + 1)];
    }
    return [];
};

/** Returns the largest connected cycle which surrounds the roof's extent. */
function closedWallCycle(
    edges: WallEdge[],
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
): WallEdge[] {
    const unique = new Map<string, WallEdge>();
    for (const candidate of edges) {
        const key =
            candidate.a < candidate.b
                ? `${candidate.a}|${candidate.b}`
                : `${candidate.b}|${candidate.a}`;
        const current = unique.get(key);
        if (!current || candidate.level < current.level) unique.set(key, candidate);
    }
    const candidates = [...unique.values()];
    const byPoint = new Map<string, Set<number>>();
    candidates.forEach((candidate, index) => {
        for (const endpoint of [candidate.a, candidate.b]) {
            const indexes = byPoint.get(endpoint) ?? new Set<number>();
            indexes.add(index);
            byPoint.set(endpoint, indexes);
        }
    });

    // Remove dangling fence branches. What remains is the graph's cycle core.
    const active = new Set(candidates.map((_, index) => index));
    const queue = [...byPoint].filter(([, indexes]) => indexes.size < 2).map(([key]) => key);
    while (queue.length) {
        const endpoint = queue.pop()!;
        for (const index of [...(byPoint.get(endpoint) ?? [])]) {
            if (!active.delete(index)) continue;
            const candidate = candidates[index];
            for (const other of [candidate.a, candidate.b]) {
                const indexes = byPoint.get(other)!;
                indexes.delete(index);
                if (indexes.size === 1) queue.push(other);
            }
        }
    }

    let best: WallEdge[] = [];
    const unseen = new Set(active);
    while (unseen.size) {
        const first = unseen.values().next().value as number;
        const stack = [first];
        const component: WallEdge[] = [];
        unseen.delete(first);
        while (stack.length) {
            const index = stack.pop()!;
            const candidate = candidates[index];
            component.push(candidate);
            for (const endpoint of [candidate.a, candidate.b]) {
                for (const neighbour of byPoint.get(endpoint) ?? []) {
                    if (unseen.delete(neighbour)) stack.push(neighbour);
                }
            }
        }
        if (component.length < 4) continue;
        const points = component.flatMap((candidate) => [tile(candidate.a), tile(candidate.b)]);
        const xs = points.map(({ x }) => x);
        const ys = points.map(({ y }) => y);
        if (
            Math.max(...xs) - Math.min(...xs) >= Math.max(1, maxX - minX - 2) &&
            Math.max(...ys) - Math.min(...ys) >= Math.max(1, maxY - minY - 2) &&
            component.length > best.length
        ) {
            best = component;
        }
    }
    return best;
}

function edgeBordersFootprint(candidate: WallEdge, footprint: Set<string>): boolean {
    const a = tile(candidate.a);
    const b = tile(candidate.b);
    if (a.x === b.x) {
        const y = Math.min(a.y, b.y);
        return footprint.has(point(a.x - 1, y)) !== footprint.has(point(a.x, y));
    }
    if (a.y === b.y) {
        const x = Math.min(a.x, b.x);
        return footprint.has(point(x, a.y - 1)) !== footprint.has(point(x, a.y));
    }
    return footprint.has(point(candidate.x, candidate.y));
}

function rectangleBoundaryCovered(
    edges: WallEdge[],
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
): boolean {
    const west = new Set<number>();
    const east = new Set<number>();
    const south = new Set<number>();
    const north = new Set<number>();
    for (const candidate of edges) {
        const a = tile(candidate.a);
        const b = tile(candidate.b);
        if (a.x === b.x) {
            const y = Math.min(a.y, b.y);
            if (y < minY || y > maxY) continue;
            if (a.x === minX) west.add(y);
            if (a.x === maxX + 1) east.add(y);
        } else if (a.y === b.y) {
            const x = Math.min(a.x, b.x);
            if (x < minX || x > maxX) continue;
            if (a.y === minY) south.add(x);
            if (a.y === maxY + 1) north.add(x);
        }
    }
    return west.size > 0 && east.size > 0 && south.size > 0 && north.size > 0;
}

interface BuildingDetectionOptions {
    isIndoor?: (x: number, y: number, level: number) => boolean;
}

export function buildingWallKey(x: number, y: number, loc: BuildingMapLoc): string {
    return `${loc.id}:${x}:${y}:${loc.level}:${loc.typeRot}`;
}

/** Detect a roof made of locs or enclosed indoor tiles covered by terrain. */
/** Detects a connected roof and, for non-rectangles, its closed wall circumference. */
export function detectRectangularBuilding(
    pointerX: number,
    pointerY: number,
    getLocs: (x: number, y: number) => BuildingMapLoc[],
    isDoor: (id: number) => boolean = () => false,
    options: BuildingDetectionOptions = {},
): DetectedBuilding | undefined {
    const cache = new Map<string, BuildingMapLoc[]>();
    const at = (x: number, y: number): BuildingMapLoc[] => {
        const key = point(x, y);
        let locs = cache.get(key);
        if (!locs) {
            locs = getLocs(x, y);
            cache.set(key, locs);
        }
        return locs;
    };
    const blockedBetween = (x: number, y: number, nextX: number, nextY: number): boolean => {
        const [side, opposite] =
            nextX < x
                ? [WEST, EAST]
                : nextX > x
                  ? [EAST, WEST]
                  : nextY > y
                    ? [NORTH, SOUTH]
                    : [SOUTH, NORTH];
        return (
            at(x, y).some((loc) => wallSides(loc) & side) ||
            at(nextX, nextY).some((loc) => wallSides(loc) & opposite)
        );
    };

    const describe = (
        footprint: Set<string>,
        maxPlane: number,
        roofGap: boolean,
        terrainRoofPlane?: number,
    ): DetectedBuilding | undefined => {
        const tiles = [...footprint].map(tile);
        const xs = tiles.map(({ x }) => x);
        const ys = tiles.map(({ y }) => y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = maxX - minX + 1;
        const depth = maxY - minY + 1;
        const rectangular = footprint.size === width * depth;
        const edges: WallEdge[] = [];
        // Visit only the footprint and its neighbours, even for a winding roof.
        const wallAnchors = new Set(footprint);
        for (const { x, y } of tiles) {
            for (const [dx, dy] of CARDINAL) wallAnchors.add(point(x + dx, y + dy));
        }
        for (const key of wallAnchors) {
            const { x, y } = tile(key);
            for (const loc of at(x, y)) {
                if (loc.level > maxPlane || loc.typeRot === undefined) continue;
                const segments = wallSegments(x, y, loc.typeRot);
                if (segments.length === 0) continue;
                const door = isDoor(loc.id);
                for (const [a, b] of segments) {
                    edges.push({ a, b, x, y, id: loc.id, level: loc.level, door, typeRot: loc.typeRot });
                }
            }
        }

        const boundary = edges.filter((candidate) => edgeBordersFootprint(candidate, footprint));
        const cycle = closedWallCycle(edges, minX, maxX, minY, maxY);
        const cyclePoints = cycle.flatMap((candidate) => [tile(candidate.a), tile(candidate.b)]);
        const cycleEnclosesFootprint =
            cyclePoints.length > 0 &&
            Math.min(...cyclePoints.map(({ x }) => x)) <= minX &&
            Math.max(...cyclePoints.map(({ x }) => x)) >= maxX + 1 &&
            Math.min(...cyclePoints.map(({ y }) => y)) <= minY &&
            Math.max(...cyclePoints.map(({ y }) => y)) >= maxY + 1;
        const hasPerimeter = cycleEnclosesFootprint ||
            (rectangular && rectangleBoundaryCovered(boundary, minX, maxX, minY, maxY));
        const cornerTiles = new Set(
            edges.filter(({ typeRot }) => [1, 2, 3, 9].includes(typeRot & 0x3f))
                .map(({ x, y }) => point(x, y)),
        );
        const reachesEverySide =
            edges.some(({ x }) => x <= minX + 1) && edges.some(({ x }) => x >= maxX - 1) &&
            edges.some(({ y }) => y <= minY + 1) && edges.some(({ y }) => y >= maxY - 1);
        // Long roof strips without a perimeter are often bridges. Very small roofs and terrain
        // ceilings also need perimeter evidence to distinguish buildings from map decoration.
        if (!hasPerimeter && (
            terrainRoofPlane !== undefined || footprint.size < 4 || Math.min(width, depth) === 1 ||
            (rectangular && !roofGap && Math.min(width, depth) <= 3 && Math.max(width, depth) >= Math.min(width, depth) * 3)
        )) return undefined;
        if (!rectangular && !cycle.length && (!reachesEverySide || cornerTiles.size < 4)) return undefined;

        const walls = [...boundary];
        for (const candidate of edges) {
            // Ground and upper walls often use different IDs, and a roof overhang can leave
            // ground walls inset by one tile. Retain those floors even when a higher cycle closes.
            if (footprint.has(point(candidate.x, candidate.y))) walls.push(candidate);
        }
        const counts = new Map<number, number>();
        const wallIds = new Set<string>();
        let minPlane = maxPlane;
        const structure = new Set(footprint);
        for (const candidate of walls) {
            const key = buildingWallKey(candidate.x, candidate.y, candidate);
            if (wallIds.has(key)) continue;
            wallIds.add(key);
            structure.add(point(candidate.x, candidate.y));
            minPlane = Math.min(minPlane, candidate.level);
            if (!candidate.door) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
        }
        const wallId = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (wallId === undefined) return undefined;
        return {
            minX, maxX, minY, maxY, minPlane, maxPlane, wallId,
            shape: rectangular ? "Rectangle" : "Irregular",
            tiles,
            structureTiles: [...structure].map(tile),
            boundaryWalls: new Set(boundary.map((candidate) => buildingWallKey(candidate.x, candidate.y, candidate))),
            terrainRoofPlane,
        };
    };

    const roofChecked = new Set<string>();
    const indoorChecked = Array.from({ length: 3 }, () => new Set<string>());
    for (let radius = 0; radius <= 1; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const seedX = pointerX + dx;
                const seedY = pointerY + dy;
                const seedKey = point(seedX, seedY);
                if (!roofChecked.has(seedKey) && at(seedX, seedY).some(isRoof)) {
                    const roof = new Set<string>();
                    const gaps = new Set<string>();
                    const queue: Array<readonly [number, number]> = [[seedX, seedY]];
                    let maxPlane = 0;
                    for (let i = 0; i < queue.length && roof.size <= MAX_ROOF_TILES; i++) {
                        const [x, y] = queue[i];
                        const key = point(x, y);
                        if (roof.has(key)) continue;
                        roof.add(key);
                        roofChecked.add(key);
                        for (const loc of at(x, y)) {
                            if (isRoof(loc)) maxPlane = Math.max(maxPlane, loc.level);
                        }
                        for (const [offsetX, offsetY] of CARDINAL) {
                            const adjacentX = x + offsetX;
                            const adjacentY = y + offsetY;
                            if (at(adjacentX, adjacentY).some(isRoof)) {
                                queue.push([adjacentX, adjacentY]);
                                continue;
                            }
                            if (blockedBetween(x, y, x - offsetX, y - offsetY)) continue;
                            let previousX = x;
                            let previousY = y;
                            for (let distance = 1; distance <= MAX_ROOF_GAP + 1; distance++) {
                                const nextX = x + offsetX * distance;
                                const nextY = y + offsetY * distance;
                                if (blockedBetween(previousX, previousY, nextX, nextY)) break;
                                if (at(nextX, nextY).some(isRoof)) {
                                    if (blockedBetween(nextX, nextY, nextX + offsetX, nextY + offsetY)) break;
                                    queue.push([nextX, nextY]);
                                    for (let gap = 1; gap < distance; gap++) {
                                        gaps.add(point(x + offsetX * gap, y + offsetY * gap));
                                    }
                                    break;
                                }
                                previousX = nextX;
                                previousY = nextY;
                            }
                        }
                    }
                    if (roof.size <= MAX_ROOF_TILES) {
                        const footprint = new Set([...roof, ...gaps]);
                        if (footprint.size <= MAX_ROOF_TILES) {
                            const building = describe(footprint, maxPlane, gaps.size > 0);
                            if (building) return building;
                        }
                    }
                }
                if (!options.isIndoor) continue;
                for (let level = 0; level < indoorChecked.length; level++) {
                    const checked = indoorChecked[level];
                    if (checked.has(seedKey) || !options.isIndoor(seedX, seedY, level)) continue;
                    const indoor = new Set<string>([seedKey]);
                    const queue = [[seedX, seedY]];
                    for (let i = 0; i < queue.length && indoor.size <= MAX_ROOF_TILES; i++) {
                        const [x, y] = queue[i];
                        for (const [dx, dy] of CARDINAL) {
                            const nextX = x + dx, nextY = y + dy;
                            const key = point(nextX, nextY);
                            if (indoor.has(key) || !options.isIndoor(nextX, nextY, level)) continue;
                            indoor.add(key);
                            queue.push([nextX, nextY]);
                        }
                    }
                    for (const key of indoor) checked.add(key);
                    if (indoor.size > MAX_ROOF_TILES) continue;
                    const roofPlane = level + 1;
                    let hasRoofLocs = false;
                    for (const key of indoor) {
                        const { x, y } = tile(key);
                        if (at(x, y).some((loc) => loc.level >= roofPlane && isRoof(loc))) {
                            hasRoofLocs = true;
                            break;
                        }
                    }
                    if (hasRoofLocs) continue;
                    const building = describe(indoor, roofPlane, false, roofPlane);
                    if (building) return building;
                }
            }
        }
    }
    return undefined;
}
