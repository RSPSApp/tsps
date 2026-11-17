import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { hintArrow } from "../game/HintArrow";
import { WidgetManager } from "../widgets/WidgetManager";
import { minimapSignature } from "../widgets/gl/minimapSignature";

// The minimap is redrawn every frame it is on screen: zooming it, walking and moving dots never
// mark it dirty themselves, so without this the widget layer showed a new zoom only when
// something else (the compass turning, an orb update) redrew that region.
function managerWith(minimap: any): WidgetManager {
    const manager = new WidgetManager({} as any, {} as any);
    if (minimap) {
        (manager as any).widgetByUid.set(minimap.uid, minimap);
        manager.minimapWidget = minimap;
    }
    return manager;
}
const minimap = { uid: (161 << 16) | 30, parentUid: -1, contentType: 1338, hidden: false } as any;

const none = managerWith(null);
none.updateMinimap();
assert.deepEqual(none.getPreciseDirtyWidgets(), [], "no minimap, nothing to redraw");

const shown = managerWith(minimap);
shown.updateMinimap();
assert.deepEqual(shown.getPreciseDirtyWidgets(), [minimap], "its own rectangle is redrawn");

const hidden = managerWith({ ...minimap, hidden: true });
hidden.updateMinimap();
assert.deepEqual(hidden.getPreciseDirtyWidgets(), [], "a hidden minimap is left alone");

console.log("minimap redraw test passed");

none.updateCompassAngle(512);
assert.deepEqual(none.getPreciseDirtyWidgets(), [], "no compass, nothing to redraw");

// Camera rotation must not dirty the compass's entire fixed or resizable gameframe.
for (const groupId of [161, 164, 548]) {
    const manager = managerWith(null);
    const root = { uid: groupId << 16, parentUid: -1 } as any;
    manager.registerRootWidget(root, 0, 0, 800, 600);
    const compass = { uid: root.uid | 1, parentUid: root.uid, rootIndex: root.rootIndex } as any;
    manager.compassWidget = compass;
    manager.consumeAllRootDirty();

    manager.updateCompassAngle(512);
    assert.equal(compass.spriteAngle, 49152, "the compass turns opposite the camera");
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [compass], "only the compass redraws");
    assert.equal(manager.isAnyRootDirty(), false, "camera rotation leaves the gameframe clean");

    manager.beginFrame();
    manager.updateCompassAngle(512);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [], "an unchanged angle needs no redraw");

    manager.updateCompassAngle(-512);
    assert.equal(compass.spriteAngle, 16384, "negative camera yaw wraps correctly");
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [compass]);
    assert.equal(manager.isAnyRootDirty(), false);
}

console.log("compass redraw test passed");

// With a signature of what it shows, an unchanged minimap is not redrawn every frame, but still
// at least every refresh interval (minimap plugin overlays treat its geometry as stale at 500 ms).
{
    const manager = managerWith(minimap);
    manager.updateMinimap(7, 1000, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "the first frame draws it");
    manager.beginFrame();
    manager.updateMinimap(7, 1016, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [], "an unchanged minimap is left alone");
    manager.updateMinimap(8, 1033, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "a change redraws it at once");
    manager.beginFrame();
    manager.updateMinimap(8, 1100, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [], "still unchanged");
    manager.updateMinimap(8, 1233, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "redrawn again after the refresh interval");
    manager.beginFrame();
    manager.updateMinimap(NaN, 1240, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "NaN (cannot tell) always redraws");
    manager.beginFrame();
    manager.updateMinimap(NaN, 1250, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "NaN never matches itself");
    manager.beginFrame();
    manager.updateMinimap();
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [minimap], "without a signature it redraws every frame");
    manager.beginFrame();
    const other = { ...minimap };
    manager.minimapWidget = other;
    (manager as any).widgetByUid.set(other.uid, other);
    manager.updateMinimap(8, 1260, 200);
    assert.deepEqual(manager.getPreciseDirtyWidgets(), [other], "a new minimap widget draws at once");
}

// The signature follows everything the minimap draws.
{
    const players: Record<number, { x: number; y: number; level: number; hidden?: boolean; view?: number }> = {
        1: { x: 3200 * 128, y: 3200 * 128, level: 0 },
        2: { x: 3205 * 128, y: 3201 * 128, level: 0 },
    };
    const npcs: Record<number, { x: number; y: number; map: number; level: number; type: number }> = {
        5: { x: 640, y: 640, map: (50 << 8) | 50, level: 0, type: 3 },
    };
    let groundVersion = 1;
    const client = {
        controlledPlayerServerId: 1,
        minimapZoom: 4,
        camera: { yaw: 0 },
        playerMovementSync: { getState: () => ({ level: 0 }) },
        playerEcs: {
            getIndexForServerId: (id: number) => (players[id] ? id : undefined),
            getAllServerIds: () => Object.keys(players).map(Number),
            getX: (i: number) => players[i].x,
            getY: (i: number) => players[i].y,
            getLevel: (i: number) => players[i].level,
            getWorldViewId: (i: number) => players[i].view ?? -1,
            getIsHidden: (i: number) => !!players[i].hidden,
        },
        npcEcs: {
            getAllActiveIds: () => Object.keys(npcs).map(Number),
            getX: (i: number) => npcs[i].x,
            getY: (i: number) => npcs[i].y,
            getMapId: (i: number) => npcs[i].map,
            getLevel: (i: number) => npcs[i].level,
            getNpcTypeId: (i: number) => npcs[i].type,
        },
        groundItems: { getVersion: () => groundVersion },
    };
    const base = minimapSignature(client);
    assert.equal(minimapSignature(client), base, "the same state gives the same signature");
    const changes: [string, () => void, () => void][] = [
        ["the player moving", () => (players[1].x += 1), () => (players[1].x -= 1)],
        ["the camera turning", () => (client.camera.yaw = 10), () => (client.camera.yaw = 0)],
        ["the zoom", () => (client.minimapZoom = 5), () => (client.minimapZoom = 4)],
        ["another player moving", () => (players[2].y += 64), () => (players[2].y -= 64)],
        ["an NPC moving", () => (npcs[5].x += 8), () => (npcs[5].x -= 8)],
        ["an NPC changing", () => (npcs[5].type = 4), () => (npcs[5].type = 3)],
        ["a ground item", () => (groundVersion = 2), () => (groundVersion = 1)],
        ["the destination flag", () => (ClientState.destinationWorldX = 3210), () => (ClientState.destinationWorldX = 0)],
    ];
    for (const [what, change, undo] of changes) {
        change();
        assert.notEqual(minimapSignature(client), base, `${what} changes the signature`);
        undo();
        assert.equal(minimapSignature(client), base, `undoing ${what} restores it`);
    }
    players[1].view = 3;
    assert.ok(Number.isNaN(minimapSignature(client)), "on a boat it cannot tell (the deck moves)");
    players[1].view = -1;
    hintArrow.type = 2;
    assert.ok(Number.isNaN(minimapSignature(client)), "a hint arrow blinks, so it always redraws");
    hintArrow.type = 0;
}

console.log("minimap redraw signature test passed");
