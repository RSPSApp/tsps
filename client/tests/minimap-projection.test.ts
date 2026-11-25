import assert from "node:assert/strict";
import { createMinimapGeometry } from "../game/scene/minimapProjection";

const minimap = createMinimapGeometry({
    plane: 0, scale: 1, worldX: 3200, worldY: 3200, centerX: 100, centerY: 100,
    project: (x, y) => ({ x: 100 + x / 2, y: 100 + y / 2 }),
    contains: (x, y) => Math.hypot(x - 100, y - 100) < 70,
});
assert.deepEqual(minimap.worldToMinimap(3219, 3200), [138, 100]);
assert.equal(minimap.worldToMinimap(3220, 3200), undefined, "legacy reach ends at 80 minimap pixels even zoomed out");
assert.equal(minimap.worldToMinimap(3216, 3212), undefined, "the legacy cutoff is radial");
assert.deepEqual(minimap.projectMarker?.(3221, 3200), { x: 142, y: 100, edge: false, angle: 0 });
const edge = minimap.projectMarker?.(3300, 3200);
assert.ok(edge?.edge && edge.x > 163 && edge.x < 164);
assert.equal(edge.y, 100);

const zoomedIn = createMinimapGeometry({
    plane: 0, scale: 1, worldX: 3200, worldY: 3200, centerX: 100, centerY: 100,
    project: (x, y) => ({ x: 100 + x * 2, y: 100 + y * 2 }),
    contains: (x, y) => Math.hypot(x - 100, y - 100) < 70,
});
assert.deepEqual(zoomedIn.worldToMinimap(3210, 3200), [180, 100], "legacy projection does not clip against the mask");
assert.equal(zoomedIn.projectMarker?.(3210, 3200)?.edge, true);
