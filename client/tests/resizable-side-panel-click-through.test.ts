import assert from "node:assert/strict";

import { isMouseInUIRegion } from "../render/render/interact/menu2";

// Outside the fixed frame, the only static UI region is the minimap corner. Everything else the
// interface takes (the side panel, its tab stones, the chatbox) is decided by the widgets drawn
// there, so the world around them stays clickable in every layout and screen size.

const MINIMAP_WIDTH = 216;
const MINIMAP_HEIGHT = 172;

function hostFor(width: number, height: number): any {
    return {
        canvas: { width, height },
        osrsClient: {
            widgetManager: { rootInterface: 161 },
            getWidgetInteractionState: () => ({ isPointerOverMinimapClickTarget: () => false }),
            camera: { containsScreenPoint: () => true },
        },
    };
}

for (const [width, height] of [[765, 503], [874, 620], [998, 768], [1274, 560], [1874, 950]]) {
    const host = hostFor(width, height);
    const inMinimapCorner = (x: number, y: number) => x >= width - MINIMAP_WIDTH && y <= MINIMAP_HEIGHT;
    for (let y = 0; y < height; y += 3) {
        for (let x = 0; x < width; x += 3) {
            assert.equal(
                isMouseInUIRegion(host, x, y),
                inMinimapCorner(x, y),
                `${width}x${height} at ${x},${y}: ${inMinimapCorner(x, y) ? "minimap corner" : "not a static UI region"}`,
            );
        }
    }
}

console.log("resizable side panel click-through: ok");
