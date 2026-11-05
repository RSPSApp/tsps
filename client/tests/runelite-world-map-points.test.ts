import { strict as assert } from "node:assert";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { WorldMapPoint } from "@runelite/client/ui/overlay/worldmap/WorldMapPoint";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { layoutWorldMapPoint, type RenderedWorldMapPoint, renderedWorldMapPointAt, syncWorldMapPoints } from "@runelite/client/ui/overlay/worldmap/worldMapLayout";

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

// --- One world map path: the manager's points join the client's plugin points ----------------------
{
    const client: any = { pluginWorldMapPoints: [{ x: 1, y: 2, plane: 0, color: 0xff0000, snapToEdge: true, owner: "questhelper" }] };
    const synced = new WorldMapPointManager(() => syncWorldMapPoints(client, synced));
    const marker = new WorldMapPoint(new WorldPoint(3222, 3218, 0), image);
    marker.setName("Clue Scroll");
    marker.setJumpOnClick(true);
    marker.setSnapToEdge(true);
    synced.add(marker);
    assert.equal(client.pluginWorldMapPoints.length, 2, "beside Quest Helper's point");
    const entry = client.pluginWorldMapPoints.find((p: any) => p.owner === "runelite");
    assert.deepEqual([entry.x, entry.y, entry.plane, entry.snapToEdge], [3222, 3218, 0, true]);
    assert.equal(entry.point, marker, "the entry carries the point for its image and hooks");
    synced.remove(marker);
    // The entry follows the point: setWorldPoint after add moves the drawn marker and its jump target together.
    synced.add(marker);
    marker.setWorldPoint(new WorldPoint(3300, 3301, 1));
    const moved = client.pluginWorldMapPoints.find((p: any) => p.owner === "runelite");
    assert.deepEqual([moved.x, moved.y, moved.plane], [3300, 3301, 1], "the entry reads the point's current tile");
    synced.remove(marker);
    assert.equal(client.pluginWorldMapPoints.length, 1, "removed: Quest Helper's point stays");
    assert.equal(client.pluginWorldMapPoints[0].owner, "questhelper");
}

// --- Hit bounds for the tooltip and click-to-jump -----------------------------------------------------
{
    const marker = new WorldMapPoint(new WorldPoint(3222, 3218, 0), image);
    marker.setName("Clue Scroll");
    marker.setJumpOnClick(true);
    const rendered: RenderedWorldMapPoint[] = [{ x0: 100, y0: 50, x1: 132, y1: 89, point: marker }];
    assert.equal(renderedWorldMapPointAt(rendered, 110, 60), marker);
    assert.equal(renderedWorldMapPointAt(rendered, 133, 60), null, "just outside");
    const noJump = new WorldMapPoint(new WorldPoint(1, 1, 0), image);
    assert.equal(renderedWorldMapPointAt([{ x0: 0, y0: 0, x1: 10, y1: 10, point: noJump }], 5, 5, true), null, "a point that does not jump is not a click target");
    assert.equal(renderedWorldMapPointAt([{ x0: 0, y0: 0, x1: 10, y1: 10, point: noJump }], 5, 5), noJump, "but it still has a tooltip");
}

console.log("runelite-world-map-points: ok");
