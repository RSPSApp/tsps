import { strict as assert } from "node:assert";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { WorldMapPoint } from "@runelite/client/ui/overlay/worldmap/WorldMapPoint";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { layoutWorldMapPoint } from "@runelite/client/ui/overlay/worldmap/worldMapLayout";

// RuneLite's WorldMapPoint and WorldMapPointManager: plugin markers the world map draws, with an
// image anchored at an image point, snapped to the map's edge when off-screen (swapping to the
// edge image through onEdgeSnap/onEdgeUnsnap).

class CluePoint extends WorldMapPoint {
    snaps = 0;
    unsnaps = 0;
    onEdgeSnap(): void {
        this.snaps++;
    }
    onEdgeUnsnap(): void {
        this.unsnaps++;
    }
}

// --- The manager ---------------------------------------------------------------------------------------
const manager = new WorldMapPointManager();
const a = new WorldMapPoint(new WorldPoint(3200, 3200, 0), null);
const b = new CluePoint(new WorldPoint(3300, 3300, 0), null);
const c = new CluePoint(new WorldPoint(3400, 3400, 0), null);
manager.add(a);
manager.add(b);
manager.add(c);
assert.deepEqual(manager.getPoints(), [a, b, c]);
manager.removeIf((p) => p instanceof CluePoint);
assert.deepEqual(manager.getPoints(), [a], "removeIf by class keeps the others");
manager.remove(a);
assert.deepEqual(manager.getPoints(), []);
manager.add(b);
manager.remove(c);
assert.deepEqual(manager.getPoints(), [b], "removing an absent point is harmless");

// --- Point fields ----------------------------------------------------------------------------------------
const image = { width: 32, height: 39 } as HTMLCanvasElement;
const point = new CluePoint(new WorldPoint(3222, 3218, 0), image);
assert.equal(point.getWorldPoint().getX(), 3222);
assert.equal(point.getImage(), image);
assert.equal(point.getImagePoint(), null, "no anchor: the image is centred on the tile");
point.setImagePoint({ x: 16, y: 39 });
assert.deepEqual(point.getImagePoint(), { x: 16, y: 39 });
point.setSnapToEdge(true);
point.setJumpOnClick(true);
point.setName("Clue Scroll");
assert.equal(point.isSnapToEdge(), true);
assert.equal(point.isJumpOnClick(), true);
assert.equal(point.getName(), "Clue Scroll");
assert.equal(point.isCurrentlyEdgeSnapped(), false);

// --- Layout: inside the map, the image sits with its anchor on the tile --------------------------------
const bounds = { x: 100, y: 50, w: 400, h: 300 };
const inside = layoutWorldMapPoint(point, { x: 250, y: 150 }, bounds)!;
assert.deepEqual(inside, { x: 250 - 16, y: 150 - 39, snapped: false }, "top left = projected tile minus the anchor");
assert.equal(point.snaps, 0);
assert.equal(point.isCurrentlyEdgeSnapped(), false);

// --- Layout: off the map and snapping, the image is clamped to the edge ---------------------------------
const snapped = layoutWorldMapPoint(point, { x: 700, y: -20 }, bounds)!;
assert.equal(snapped.snapped, true);
assert.equal(snapped.x, bounds.x + bounds.w - image.width, "flush with the right edge");
assert.equal(snapped.y, bounds.y, "flush with the top edge");
assert.equal(point.snaps, 1, "onEdgeSnap fires once when the point starts snapping");
assert.equal(point.isCurrentlyEdgeSnapped(), true);
layoutWorldMapPoint(point, { x: 700, y: -20 }, bounds);
assert.equal(point.snaps, 1, "and not again while it stays snapped");

const back = layoutWorldMapPoint(point, { x: 250, y: 150 }, bounds)!;
assert.equal(back.snapped, false);
assert.equal(point.unsnaps, 1, "onEdgeUnsnap fires when it comes back on screen");
assert.equal(point.isCurrentlyEdgeSnapped(), false);

// --- Layout: off the map and not snapping, nothing is drawn --------------------------------------------
point.setSnapToEdge(false);
assert.equal(layoutWorldMapPoint(point, { x: 700, y: -20 }, bounds), null);

// --- An unanchored image is centred ---------------------------------------------------------------------
const plain = new WorldMapPoint(new WorldPoint(1, 1, 0), image);
assert.deepEqual(layoutWorldMapPoint(plain, { x: 250, y: 150 }, bounds), { x: 250 - 16, y: 150 - 19, snapped: false }, "centred: half the width and height, truncated");

console.log("runelite-world-map-points: ok");
