import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import {
    classifyNpcSpawnPatch,
    HiddenNpcSpawns,
    parseNpcSpawnRecords,
    parseNpcSpawns,
} from "../game/plugins/editmode/hostProtocol/npcSpawnMessage";
import type { EditModeSelection } from "../game/plugins/editmode/types";

const dom = new JSDOM('<canvas tabindex="0"></canvas><input>', { pretendToBeVisual: true });
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    self: dom.window,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
const canvas = document.querySelector("canvas")!;

{
    // A stacked tile (two of the same NPC) pairs one for one with the patch, as the server's loader does.
    const man = { id: 3, tileX: 3300, tileY: 3300, plane: 0 };
    const pair = [man, man];
    assert.deepEqual(classifyNpcSpawnPatch(pair, [{ ...man, remove: true }, { ...man, wanderRadius: 3 }]),
        ["remove", "add"], "moved back onto its own tile: the record fills the slot its removal freed");
    assert.deepEqual(classifyNpcSpawnPatch(pair, [{ ...man, wanderRadius: 0 }, { ...man, wanderRadius: 1 }, { ...man }]),
        ["override", "override", "add"], "each record overrides one canonical spawn, then adds");
    assert.deepEqual(classifyNpcSpawnPatch([man], [{ ...man, remove: true }, { ...man, remove: true }]),
        ["remove", "remove"]);
    assert.deepEqual(classifyNpcSpawnPatch(pair, [{ ...man, wanderRadius: 0 }, { ...man, remove: true }]),
        ["override", "remove"], "one stacked spawn's wander changed and the other removed: one spawn left");

    // One marker hides one of the pair; the other stays visible.
    const hidden = new HiddenNpcSpawns();
    const key = "3:3300:3300:0";
    hidden.hide(key);
    assert.equal(hidden.visible(pair).length, 1, "one marker hides one stacked spawn");
    hidden.hide(key);
    assert.equal(hidden.visible(pair).length, 0);
    hidden.show(key);
    assert.equal(hidden.visible(pair).length, 1, "undoing a marker brings one back");
    hidden.show(key);
    assert.equal(hidden.visible([...pair, { id: 4, tileX: 3300, tileY: 3300, plane: 0 }]).length, 3);
}

{
    const spawns = parseNpcSpawns(JSON.stringify([
        { level: 0, name: "Goblin", wanderRadius: 3, x: 3222, y: 3218, id: 3 },
        { level: 0, name: "Elena", x: 2592, y: 3336, key: "ELENA_2" },
        { level: 1, name: "Removed", x: 3200, y: 3200, id: 4, remove: true },
    ]));
    assert.deepEqual(spawns, [
        { id: 3, tileX: 3222, tileY: 3218, plane: 0, wanderRadius: 3 },
    ], "spawn entries keep their tile and wander range; keyed and removed entries are skipped");
    assert.throws(() => parseNpcSpawns("[{\"x\":0,\"y\":0,\"level\":9}]"), "invalid planes are rejected");
    assert.deepEqual(parseNpcSpawnRecords(JSON.stringify([
        { id: 3, x: 3222, y: 3218, level: 0, remove: true },
        { id: 3, x: 3222, y: 3218, level: 0, wanderRadius: 0 },
    ])), [
        { id: 3, tileX: 3222, tileY: 3218, plane: 0, remove: true },
        { id: 3, tileX: 3222, tileY: 3218, plane: 0, wanderRadius: 0 },
    ], "patch records keep removals and their file order");
}

type Call = [string, ...unknown[]];
const calls: Call[] = [];
let pointer = { tileX: 3222, tileY: 3218, plane: 0 };
let selected: EditModeSelection | undefined;
let nextServerId = 60000;

const plugin = new EditModePlugin();
plugin.attach({
    getCanvas: () => canvas,
    getPointerTile: () => pointer,
    getPointerLoc: () => undefined,
    selectPointer: () => selected!,
    getLocName: () => "Tree",
    getNpcName: () => "Goblin",
    search: async () => [],
    spawnNpc: (npcTypeId, tile, rotation) => {
        calls.push(["spawnNpc", npcTypeId, tile, rotation]);
        return nextServerId++;
    },
    despawnNpc: (serverId) => calls.push(["despawnNpc", serverId]),
    hideNpcSpawn: (spawn) => calls.push(["hideNpcSpawn", spawn]),
    showNpcSpawn: (spawn) => calls.push(["showNpcSpawn", spawn]),
    onLocAddChange: () => {},
    onLocDel: () => {},
    setTerrainOverlay: () => {},
    clearTerrainOverride: () => {},
    setFreeCamera: () => {},
    jumpCameraToTile: () => {},
    cancelPendingClick: () => {},
    levelCamera: () => {},
    isLoggedIn: () => true,
});
plugin.setConfig({ enabled: true, active: true, tool: "select" });

const spawnSelection = (): EditModeSelection => ({
    kind: "npc",
    ...pointer,
    locId: 3,
    locName: "Goblin",
    npcServerId: 60000,
    npcSource: "spawn",
    npcSpawn: { id: 3, tileX: pointer.tileX, tileY: pointer.tileY, plane: pointer.plane, direction: 2 },
    npcWanderRadius: 7,
});

// Selecting a persisted spawn exposes its wander range.
selected = spawnSelection();
plugin.applyAtPointer();
assert.equal(plugin.getState().selection?.npcSource, "spawn");
assert.equal(plugin.getState().selection?.npcWanderRadius, 7);

// Changing it stores a small override instead of a new spawn.
calls.length = 0;
plugin.setSelectionWanderRadius(0);
assert.deepEqual(calls, [], "changing the wander range touches no NPC geometry");
assert.deepEqual(plugin.getConfig().edits, [{
    kind: "npcWander",
    locId: 3,
    tileX: 3222,
    tileY: 3218,
    plane: 0,
    shape: 0,
    rotation: 0,
    wanderRadius: 0,
    direction: 2,
}]);
assert.equal(plugin.getState().selection?.npcWanderRadius, 0);
plugin.clearEdits();

// Delete key removes a selected spawn and records its removal.
selected = spawnSelection();
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(calls, [["hideNpcSpawn", { id: 3, tileX: 3222, tileY: 3218, plane: 0 }]]);
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["npcDelete"]);
assert.equal(plugin.getState().selection, undefined, "a deleted NPC clears the selection");

// Deleting the other spawn stacked on that tile keeps the first marker: one marker per spawn.
selected = { ...spawnSelection(), npcServerId: 60001 };
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(calls, [["hideNpcSpawn", { id: 3, tileX: 3222, tileY: 3218, plane: 0 }]]);
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["npcDelete", "npcDelete"],
    "both stacked spawns are removed, one marker each");

// Deleting one stacked spawn, then changing the other's wander range, saves the override before the marker,
// which the loader reads as that spawn's wander plus one removal (not a moved-back spawn filling the slot).
plugin.clearEdits();
selected = spawnSelection();
plugin.applyAtPointer();
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
selected = { ...spawnSelection(), npcServerId: 60001 };
plugin.applyAtPointer();
plugin.setSelectionWanderRadius(0);
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["npcWander", "npcDelete"]);
plugin.setSelectionWanderRadius(1);
assert.deepEqual(plugin.getConfig().edits.map((edit) => [edit.kind, edit.wanderRadius]),
    [["npcWander", 1], ["npcDelete", undefined]], "a second change still goes before the marker");
plugin.clearEdits();

// Deleting one stacked spawn, then moving the other away, keeps the first marker: both leave the tile.
selected = spawnSelection();
plugin.applyAtPointer();
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
selected = { ...spawnSelection(), npcServerId: 60001 };
plugin.applyAtPointer();
plugin.moveSelection();
calls.length = 0;
pointer = { tileX: 3226, tileY: 3218, plane: 0 };
plugin.applyAtPointer();
pointer = { tileX: 3222, tileY: 3218, plane: 0 };
assert.deepEqual(plugin.getConfig().edits.map((edit) => [edit.kind, edit.tileX]),
    [["npcDelete", 3222], ["npcDelete", 3222], ["npc", 3226]], "one marker per spawn gone from 3222");
assert.ok(!calls.some(([name]) => name === "showNpcSpawn"), "the deleted spawn is not shown again");
plugin.clearEdits();

// Delete key removes a selected object too.
plugin.clearEdits();
selected = { kind: "loc", ...pointer, locId: 1276, locName: "Tree", shape: 10, rotation: 0 };
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["delete"], "Delete key deletes the selected object");

// Moving a spawn hides the original and carries its range and facing to the new one.
plugin.clearEdits();
selected = spawnSelection();
plugin.applyAtPointer();
plugin.moveSelection();
assert.equal(plugin.getConfig().tool, "place");
assert.equal(plugin.getConfig().placeKind, "npc");
assert.equal(plugin.getConfig().npcId, 3);
calls.length = 0;
pointer = { tileX: 3226, tileY: 3218, plane: 0 };
plugin.applyAtPointer();
assert.deepEqual(plugin.getConfig().edits, [
    { kind: "npcDelete", locId: 3, tileX: 3222, tileY: 3218, plane: 0, shape: 0, rotation: 0 },
    {
        kind: "npc", locId: 3, tileX: 3226, tileY: 3218, plane: 0, shape: 10, rotation: 0,
        wanderRadius: 7, direction: 2,
    },
]);
assert.deepEqual(calls, [
    ["hideNpcSpawn", { id: 3, tileX: 3222, tileY: 3218, plane: 0 }],
    ["spawnNpc", 3, { tileX: 3226, tileY: 3218, plane: 0 }, 0],
]);
assert.equal(plugin.getConfig().tool, "select", "moving returns to the selection tool");

// A moved editor spawn has no removal marker, and its wander range stays on the edit.
plugin.clearEdits();
pointer = { tileX: 3230, tileY: 3218, plane: 0 };
plugin.setConfig({ tool: "place", placeKind: "npc", npcId: 3 });
plugin.applyAtPointer();
plugin.setConfig({ tool: "select" });
selected = {
    kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcServerId: 60002,
    npcSource: "custom", npcWanderRadius: 5,
};
plugin.applyAtPointer();
calls.length = 0;
plugin.setSelectionWanderRadius(4);
assert.deepEqual(plugin.getConfig().edits, [{
    kind: "npc", locId: 3, tileX: 3230, tileY: 3218, plane: 0, shape: 10, rotation: 0, wanderRadius: 4,
}]);
assert.deepEqual(calls, [], "a custom spawn's range is stored on its own edit");

// A saved patch imported into a fresh profile rebuilds removal and spawn edits
// once, so a later export still contains them.
plugin.clearEdits();
calls.length = 0;
const imported = [
    { kind: "npcDelete" as const, locId: 3, tileX: 3220, tileY: 3220, plane: 0, shape: 0, rotation: 0 },
    { kind: "npc" as const, locId: 3, tileX: 3224, tileY: 3220, plane: 0, shape: 10, rotation: 0, wanderRadius: 2 },
];
assert.equal(plugin.importNpcSpawnEdits(imported), true, "the first import adds the patch edits");
assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.kind), ["npcDelete", "npc"]);
assert.deepEqual(calls, [
    ["hideNpcSpawn", { id: 3, tileX: 3220, tileY: 3220, plane: 0 }],
    ["spawnNpc", 3, { tileX: 3224, tileY: 3220, plane: 0 }, 0],
]);
calls.length = 0;
assert.equal(plugin.importNpcSpawnEdits(imported), false, "re-importing the same patch is a no-op");
assert.deepEqual(calls, []);
assert.equal(plugin.getConfig().edits.length, 2, "imported edits are retained for export");

// A spawn moved away and back to its own tile loads as [remove A, add A]: the
// replacement sits on top of the canonical spawn's removal marker.
const moveBackPatch = [
    { kind: "npcDelete" as const, locId: 3, tileX: 3240, tileY: 3240, plane: 0, shape: 0, rotation: 0 },
    { kind: "npc" as const, locId: 3, tileX: 3240, tileY: 3240, plane: 0, shape: 10, rotation: 0 },
];
pointer = { tileX: 3240, tileY: 3240, plane: 0 };
const moveBackSelection = (): EditModeSelection => ({
    kind: "npc", tileX: 3240, tileY: 3240, plane: 0,
    locId: 3, locName: "Goblin", npcSource: "custom", npcWanderRadius: 5,
});

// Deleting the replacement removes it but keeps the marker, so the canonical
// spawn stays gone instead of returning from underneath.
plugin.clearEdits();
plugin.importNpcSpawnEdits(moveBackPatch);
selected = moveBackSelection();
plugin.applyAtPointer();
calls.length = 0;
canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
assert.deepEqual(plugin.getConfig().edits, [
    { kind: "npcDelete", locId: 3, tileX: 3240, tileY: 3240, plane: 0, shape: 0, rotation: 0 },
], "deleting a replacement keeps the canonical spawn's removal marker");
assert.equal(calls.some(([name]) => name === "showNpcSpawn"), false, "the canonical spawn stays hidden");
assert.ok(calls.some(([name]) => name === "despawnNpc"), "the deleted replacement is despawned");

// Moving it again keeps the marker too, so the original cannot reappear beside
// the moved copy.
plugin.clearEdits();
plugin.importNpcSpawnEdits(moveBackPatch);
selected = moveBackSelection();
plugin.applyAtPointer();
plugin.moveSelection();
pointer = { tileX: 3244, tileY: 3240, plane: 0 };
plugin.applyAtPointer();
assert.deepEqual(plugin.getConfig().edits, [
    { kind: "npcDelete", locId: 3, tileX: 3240, tileY: 3240, plane: 0, shape: 0, rotation: 0 },
    {
        kind: "npc", locId: 3, tileX: 3244, tileY: 3240, plane: 0, shape: 10, rotation: 0,
        wanderRadius: 5,
    },
], "moving a replacement leaves the canonical removal marker behind");

// Deleting the last saved custom NPC still writes an empty patch, so the old
// file can no longer spawn it.
plugin.clearEdits();
plugin.importNpcSpawnEdits([{
    kind: "npc", locId: 3, tileX: 3240, tileY: 3240, plane: 0, shape: 10, rotation: 0,
}]);
const { mountEditorUi } = require("../game/plugins/editmode/EditorUi");
const FileSaver = require("file-saver");
const savedFiles: Array<{ name: string; contents: Promise<string> }> = [];
const originalSaveAs = FileSaver.saveAs;
FileSaver.saveAs = (blob: Blob, name: string) => {
    savedFiles.push({ name, contents: blob.text() });
};
const removeUi = mountEditorUi(plugin);
const download = [...document.querySelectorAll('[role="toolbar"] button')]
    .find((button) => button.getAttribute("aria-label") === "Download world and map edits") as HTMLButtonElement;
assert.ok(download, "standalone editors have the download action");
const savedNpcPatch = async (): Promise<string> => {
    download.click();
    const file = savedFiles.find((saved) => saved.name === "npc-spawns-custom.json");
    assert.ok(file, "the editor writes npc-spawns-custom.json");
    return file.contents;
};

void (async () => {
    plugin.clearEdits();
    assert.equal(
        await savedNpcPatch(), "[]\n",
        "an emptied spawn list still exports [] instead of reporting nothing to save",
    );

    // Deleting the moved-back replacement downloads its removal, not nothing.
    savedFiles.length = 0;
    plugin.clearEdits();
    plugin.importNpcSpawnEdits(moveBackPatch);
    selected = moveBackSelection();
    plugin.applyAtPointer();
    canvas.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Delete", code: "Delete", bubbles: true }));
    assert.equal(
        await savedNpcPatch(),
        '[\n  {"id":3,"x":3240,"y":3240,"level":0,"remove":true}\n]\n',
        "the exported patch still suppresses the canonical spawn",
    );
    FileSaver.saveAs = originalSaveAs;
    removeUi();
    plugin.clearEdits();
    dom.window.close();
    console.log("Edit mode NPC spawn tests passed");
})().catch((error) => {
    FileSaver.saveAs = originalSaveAs;
    console.error(error);
    process.exit(1);
});