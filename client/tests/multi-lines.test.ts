import { state } from "../network/serverConnection/state";
import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { multiBoxes, multiBorders, wildernessLines, wildernessLineY } from "../game/plugins/multilines/multiLines";
import { MultiLinesPlugin } from "../game/plugins/multilines/MultiLinesPlugin";

assert.equal(MultiLinesPlugin.descriptor.enabledByDefault, false, "fresh installs start disabled");

// Border edges: a 2x2 box at (10..11, 20..21) has a square outline of 4 runs of 2.
const box = [{ minX: 10, maxX: 11, minY: 20, maxY: 21, z: 0 }];
const W = { minX: 0, maxX: 30, minY: 0, maxY: 40 };
assert.deepEqual(multiBorders(box, 0, W).map((s) => [s.x1, s.y1, s.x2, s.y2]).sort(),
    [[10, 20, 10, 22], [10, 20, 12, 20], [10, 22, 12, 22], [12, 20, 12, 22]].sort());
assert.deepEqual(multiBorders(box, 1, W), [], "per plane");
// Two touching boxes have no border between them.
const touching = [...box, { minX: 12, maxX: 13, minY: 20, maxY: 21, z: 0 }];
assert.equal(multiBorders(touching, 0, W).length, 4, "merged into one outline");
assert.deepEqual(multiBorders(box, 0, { minX: 10, maxX: 11, minY: 20, maxY: 20 }).map((s) => [s.x1, s.y1, s.x2, s.y2]).sort(),
    [[10, 20, 10, 21], [10, 20, 12, 20], [12, 20, 12, 21]].sort(), "clipped to the window");

// Wilderness lines: level 20 starts at y 3672, level 30 at 3752.
assert.deepEqual([wildernessLineY(20), wildernessLineY(30)], [3672, 3752]);
assert.deepEqual(wildernessLines({ minX: 3000, maxX: 3100, minY: 3650, maxY: 3700 }), [{ x1: 3000, y1: 3672, x2: 3101, y2: 3672 }]);
assert.deepEqual(wildernessLines({ minX: 3000, maxX: 3100, minY: 3200, maxY: 3300 }), []);

// Zones as /api/world serves them: only multi-combat boxes with bounds count; z defaults to 0.
const MULTI_BOXES = multiBoxes([
    { tags: ["blast-furnace"] },
    { minX: 3000, maxX: 3100, minY: 3500, maxY: 3600, z: 0, tags: ["pvp"] },
    { minX: 3190, maxX: 3327, minY: 3648, maxY: 3839, tags: ["multi-combat"] },
]);
assert.deepEqual(MULTI_BOXES, [{ minX: 3190, maxX: 3327, minY: 3648, maxY: 3839, z: 0 }]);
assert.ok(multiBorders(MULTI_BOXES, 0, { minX: 3180, maxX: 3200, minY: 3640, maxY: 3660 }).length > 0, "the multi edge at x 3190 / y 3648");

// The plugin draws them, in the scene and on the minimap.
const config = inject(ConfigManager);
const client: any = {
    gameState: 30,
    controlledPlayerServerId: 1,
    playerEcs: { getIndexForServerId: () => 0, getX: () => 3200 * 128, getY: () => 3660 * 128, getLevel: () => 0 },
    sceneGeometry: { tileHeight: () => 0, worldToScreen: (x: number, h: number, y: number) => [x, y + h] },
    minimapGeometry: { drawnAt: performance.now(), plane: 0, scale: 1, worldToMinimap: (x: number, y: number) => [x, -y] },
};
(async () => {
    const plugin = new MultiLinesPlugin(client, { configManager: config });
    await plugin.start();
    let requests = 0;
    state.webRtcConfig = {} as any;
    state.socket = { fetchContent: async (path: string) => {
        requests++;
        assert.equal(path, "/api/multi-combat");
        return MULTI_BOXES;
    } } as any;
    plugin.segments();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(plugin.boxes, MULTI_BOXES);
    assert.equal(requests, 1);
    const [scene, minimap] = plugin.widgetOverlays() as any[];
    assert.equal(scene.drawBelowWidgets, true);
    assert.equal(minimap.drawBelowWidgets, false);
    const lines = (o: any) => JSON.parse(o.signature())[1];
    const colors = (o: any) => new Set(lines(o).map((l: any) => l[1].join()));
    assert.deepEqual([...colors(scene)].sort(), ["1,0,0,1", "1,0.6470588235294118,0,1"].sort(), "multi and level 20 line");
    assert.ok(lines(minimap).length > 0);
    config.setConfigValue(MultiLinesPlugin.config, "showOnMinimap", false);
    assert.deepEqual(lines(minimap), []);
    config.setConfigValue(MultiLinesPlugin.config, "showWildernessLines", false);
    assert.deepEqual([...colors(scene)], ["1,0,0,1"]);
    const beforeWidth = scene.signature();
    config.setConfigValue(MultiLinesPlugin.config, "borderWidth", 4);
    assert.notEqual(scene.signature(), beforeWidth, "width changes invalidate the overlay");
    let finishOld!: (boxes: any[]) => void;
    state.socket = { fetchContent: () => new Promise((resolve) => { finishOld = resolve; }) } as any;
    plugin.segments();
    assert.deepEqual(plugin.boxes, [], "switching connections clears old world bounds");
    state.socket = { fetchContent: async () => [] } as any;
    plugin.segments();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishOld(MULTI_BOXES);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(plugin.boxes, [], "late old-world responses cannot replace new-world bounds");
    state.socket = null;
    state.webRtcConfig = undefined;
    console.log("multi-lines ok");
})();
