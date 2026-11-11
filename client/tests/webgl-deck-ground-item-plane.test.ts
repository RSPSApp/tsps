import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// WebGL: a boat's scene square is rebuilt when the boat sets sail, and the new square builds its
// ground items before the frame loop sets its deck plane. Built on level 0, the items floated
// above the deck, so the loop rebuilds them once it sets the plane.
const source = fs.readFileSync(path.resolve(__dirname, "../render/render/frame/render.ts"), "utf8");
const setPlane = source.indexOf("overlayMap.interactionPlane = basePlane;");
assert.ok(setPlane >= 0, "the frame loop sets the deck plane");
assert.equal(source.indexOf("overlayMap.interactionPlane = basePlane;", setPlane + 1), -1, "once");
const guard = source.lastIndexOf("if (overlayMap.interactionPlane !== basePlane)", setPlane);
assert.ok(guard >= 0 && setPlane - guard < 120, "only when the plane changes");
const rebuild = source.indexOf(
    "host.rebuildGroundItemsForMap(overlayMap, host.groundItemStacks.get(overlayMapId))",
    setPlane,
);
assert.ok(rebuild > setPlane && rebuild - setPlane < 400, "then rebuilds the square's ground items on the deck");

console.log("webgl-deck-ground-item-plane: ok");
