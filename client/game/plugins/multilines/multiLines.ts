/** A zone box of the server's own world.json (the data Wilderness.isMulti reads), inclusive. */
export type Box = { minX: number; maxX: number; minY: number; maxY: number; z: number };
/** A border segment on the grid: the line between two tiles, from (x1, y1) to (x2, y2), one axis constant. */
export type Segment = { x1: number; y1: number; x2: number; y2: number };

/** The "multi-combat" zones of the server's world definition (served as gameplay bounds, so world.local.json applies); a zone's `z` defaults to the surface. */
export function multiBoxes(zones: readonly any[]): Box[] {
    return zones
        .filter((zone) => zone.minX !== undefined && zone.tags?.includes("multi-combat"))
        .map((zone) => ({ minX: zone.minX, maxX: zone.maxX, minY: zone.minY, maxY: zone.maxY, z: zone.z ?? 0 }));
}

/** Wilderness.LEVELLED_AREAS' surface strip: level = floor((y - 3520) / 8) + 1, from x 2944 to 3391. */
const WILDERNESS = { minX: 2944, maxX: 3391, minY: 3520 };
/** The y of the first tile of a Wilderness level (the line below it). */
export const wildernessLineY = (level: number) => WILDERNESS.minY + (level - 1) * 8;

export type Window = { minX: number; maxX: number; minY: number; maxY: number };

export function isMultiAt(boxes: readonly Box[], x: number, y: number, z: number): boolean {
    return boxes.some((b) => b.z === z && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);
}

/**
 * The borders between multi and non-multi tiles on a plane inside the window (tiles, inclusive),
 * as runs: a horizontal run is the line at y between tiles y - 1 and y.
 */
export function multiBorders(boxes: readonly Box[], z: number, w: Window): Segment[] {
    const near = boxes.filter((b) => b.z === z && b.minX <= w.maxX + 1 && b.maxX >= w.minX - 1 && b.minY <= w.maxY + 1 && b.maxY >= w.minY - 1);
    const out: Segment[] = [];
    if (near.length === 0) return out;
    // Scan one axis along each grid line, extending a run while the two tiles beside the line differ.
    const scan = (lo: number, hi: number, aLo: number, aHi: number, differs: (line: number, t: number) => boolean, push: (line: number, from: number, to: number) => void) => {
        for (let line = lo; line <= hi + 1; line++) {
            let from = -1;
            for (let t = aLo; t <= aHi + 1; t++) {
                const d = t <= aHi && differs(line, t);
                if (d && from < 0) from = t;
                else if (!d && from >= 0) { push(line, from, t); from = -1; }
            }
        }
    };
    const m = (x: number, y: number) => isMultiAt(near, x, y, z);
    scan(w.minY, w.maxY, w.minX, w.maxX, (y, x) => m(x, y - 1) !== m(x, y), (y, a, b) => out.push({ x1: a, y1: y, x2: b, y2: y }));
    scan(w.minX, w.maxX, w.minY, w.maxY, (x, y) => m(x - 1, y) !== m(x, y), (x, a, b) => out.push({ x1: x, y1: a, x2: x, y2: b }));
    return out;
}

/** The level 20 and 30 lines (the edge of those levels' first tile row), clipped to the window. */
export function wildernessLines(w: Window): Segment[] {
    const x1 = Math.max(w.minX, WILDERNESS.minX);
    const x2 = Math.min(w.maxX + 1, WILDERNESS.maxX + 1);
    return [20, 30].map(wildernessLineY).filter((y) => y >= w.minY && y <= w.maxY + 1 && x2 > x1).map((y) => ({ x1, y1: y, x2, y2: y }));
}
