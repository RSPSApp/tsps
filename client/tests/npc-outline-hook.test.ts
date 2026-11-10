import { strict as assert } from "node:assert";
import { ModelHighlightManager } from "../game/highlights/ModelHighlightManager";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { packWorldMapCoord } from "../rs/map/WorldMapArea";
import { getInteractHighlightDrawTargets } from "../render/render/interact/highlight";

// Plugin NPC outlines go through the shared resolver both renderers use, even with Interact
// Highlight switched off; width becomes the per-target outline radius.
const built: unknown[] = [];
const host: any = {
    interactHighlightDrawTargets: [],
    osrsClient: {
        modelHighlightManager: new ModelHighlightManager(),
        clientPlugins: {
            npcOutlines: () => [{ ecsId: 3, serverId: 30, color: 0x00ffff, alpha: 1, width: 4 }],
            interactHighlightConfig: () => undefined,
        },
        npcEcs: { getNpcTypeId: () => 655, getLevel: () => 0, getWorldViewId: () => -1 },
    },
    buildNpcModelHighlightTriangles: (target: unknown) => {
        built.push(target);
        return [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    },
};
const targets = getInteractHighlightDrawTargets(host);
assert.equal(targets.length, 1);
assert.deepEqual(built, [{ kind: "npc", ecsId: 3, serverId: 30, npcTypeId: 655, plane: 0 }]);
assert.equal(targets[0].color, 0x00ffff);
assert.equal(targets[0].alpha, 1);
assert.equal(targets[0].outlineRadius, 3.8);
host.osrsClient.clientPlugins.npcOutlines = () => [];
assert.equal(getInteractHighlightDrawTargets(host).length, 0, "Interact Highlight off and no plugin outlines");
// Cache 242's Agility helper configures its styles before registering obstacle targets.
const handlers: HandlerMap = new Map();
registerClientOps(handlers);
function run(op: Opcodes, ...args: number[]): number[] {
    const ctx: any = {
        widgetManager: { osrsClient: host.osrsClient },
        popInt: () => args.pop(),
        pushInt: (value: number) => args.push(value),
    };
    handlers.get(op)!(ctx, 0, null as any);
    return args;
}

const map = {
    tileLocIdsByLevel: [Int32Array.of(111)],
    tileLocOffsetsByLevel: [Uint32Array.of(0, 1)],
    tileLocTypeRotByLevel: [Uint8Array.of(10)],
    getLocalTileSpan: () => 1,
    getRenderBaseTileX: () => 10,
    getRenderBaseTileY: () => 20,
};
const triangles = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
host.getPlayerBasePlane = () => 0;
host.getPreferredMapForWorldTile = () => map;
host.mapManager = { visibleMapCount: 1, visibleMaps: [map] };
host.buildLocModelHighlightTriangles = () => triangles;
host.osrsClient.npcEcs.forEachActive = (visit: (id: number) => void) => visit(3);
host.osrsClient.npcEcs.getServerId = () => 30;

const green = 0x00ff00;
const coord = packWorldMapCoord({ x: 10, y: 20, plane: 0 });
assert.deepEqual(run(Opcodes.HIGHLIGHT_LOCTYPE_SETUP, 11, green, 1, 30, 5), []);
assert.deepEqual(run(Opcodes.HIGHLIGHT_LOCTYPE_ON, 111, 11), []);
assert.deepEqual(run(Opcodes.HIGHLIGHT_LOCTYPE_GET, 111, 11), [1]);
assert.deepEqual(getInteractHighlightDrawTargets(host).map((target) => target.color), [green]);
run(Opcodes.HIGHLIGHT_LOCTYPE_CLEAR, 11);
assert.equal(getInteractHighlightDrawTargets(host).length, 0);

run(Opcodes.HIGHLIGHT_LOC_SETUP, 11, green, 1, 30, 5);
run(Opcodes.HIGHLIGHT_LOC_ON, 111, coord, 11, 1);
run(Opcodes.HIGHLIGHT_LOC_ON, 111, coord, 11, 2);
run(Opcodes.HIGHLIGHT_LOC_OFF, 111, coord, 11, 1);
assert.deepEqual(run(Opcodes.HIGHLIGHT_LOC_GET, 111, coord, 11, 1), [0]);
assert.deepEqual(run(Opcodes.HIGHLIGHT_LOC_GET, 111, coord, 11, 2), [1]);
assert.equal(getInteractHighlightDrawTargets(host).length, 1);

run(Opcodes.HIGHLIGHT_NPCTYPE_SETUP, 11, green, 1, 30, 5);
run(Opcodes.HIGHLIGHT_NPCTYPE_ON, 655, 11);
assert.equal(getInteractHighlightDrawTargets(host).length, 2);
run(Opcodes.HIGHLIGHT_LOC_SETUP, 11, green, 1, 0, 0);
run(Opcodes.HIGHLIGHT_NPCTYPE_SETUP, 11, green, 1, 0, 0);
assert.equal(getInteractHighlightDrawTargets(host).length, 0);
console.log("NPC and native model outline tests passed");
