import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { parseNpcSpawnRecords, parseNpcSpawns, parseCustomNpcSpawnSnapshot, requestCustomNpcSpawnSnapshot, CUSTOM_NPC_SPAWNS_MESSAGE, CUSTOM_NPC_SPAWNS_REQUEST_MESSAGE } from "../game/plugins/editmode/hostProtocol/npcSpawnMessage";
import { requestLiveNpcSpawn, LiveNpcSpawns } from "../game/plugins/editmode/LiveNpcSpawn";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { state } from "../network/serverConnection/state";
import { emitPluginMessage } from "../network/serverConnection/domain/pluginMessages";
import { parsePluginMessage } from "../common/network/PluginMessage";
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
let liveRegistry: LiveNpcSpawns | undefined;
let resolveSpawn: (selection: EditModeSelection) => Promise<any> = async () => undefined;

const plugin = new EditModePlugin();
plugin.attach({
    getCanvas: () => canvas,
    getPointerTile: () => pointer,
    getPointerLoc: () => undefined,
    selectPointer: () => selected!,
    resolveNpcSpawn: (selection) => resolveSpawn(selection),
    getLocName: () => "Tree",
    getNpcName: () => "Goblin",
    search: async () => [],
    spawnNpc: (npcTypeId, tile, rotation) => {
        calls.push(["spawnNpc", npcTypeId, tile, rotation]);
        return nextServerId++;
    },
    despawnNpc: (serverId) => calls.push(["despawnNpc", serverId]),
    hideNpcSpawn: (spawn) => { calls.push(["hideNpcSpawn", spawn]); liveRegistry?.hide(spawn); },
    showNpcSpawn: (spawn) => { calls.push(["showNpcSpawn", spawn]); liveRegistry?.show(spawn); },
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
    // A pending baseline blocks mutations, so a late import cannot resurrect
    // a spawn the user deleted while the host was still loading.
    plugin.clearEdits();
    selected = spawnSelection();
    plugin.applyAtPointer();
    await plugin.loadPersistedNpcSpawnEdits();
    plugin.deleteSelection();
    plugin.moveSelection();
    plugin.setSelectionWanderRadius(2);
    assert.deepEqual(plugin.getConfig().edits, []);
    assert.equal(plugin.getConfig().tool, "select");
    plugin.setConfig({ tool: "place", placeKind: "npc", npcId: 3 });
    plugin.applyAtPointer();
    assert.deepEqual(plugin.getConfig().edits, [], "placing also waits for the saved baseline");
    plugin.importNpcSpawnEdits([]);
    plugin.setConfig({ tool: "select" });

    const baseline = [
        { kind: "npc" as const, locId: 3, tileX: 3260, tileY: 3260, plane: 0, shape: 10, rotation: 0, wanderRadius: 5, npcName: "First" },
        { kind: "npc" as const, locId: 3, tileX: 3270, tileY: 3270, plane: 0, shape: 10, rotation: 0, npcName: "Untouched" },
    ];
    calls.length = 0;
    plugin.importNpcSpawnEdits(baseline, false);
    assert.deepEqual(calls, [], "host baseline import does not duplicate server NPCs");
    pointer = { tileX: 3260, tileY: 3260, plane: 0 };
    selected = { kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcSource: "custom", npcSpawn: { id: 3, ...pointer } };
    plugin.applyAtPointer();
    assert.equal(plugin.getState().selection?.npcSource, "spawn");
    plugin.setSelectionWanderRadius(2);
    calls.length = 0;
    plugin.reapply();
    plugin.reapplyNpcsForMap(3260 >> 6, 3260 >> 6);
    assert.deepEqual(calls, [], "metadata changes leave saved additions data-only");

    let completeLookup: (spawn: any) => void = () => {};
    resolveSpawn = () => new Promise((resolve) => { completeLookup = resolve; });
    pointer = { tileX: 3264, tileY: 3261, plane: 0 };
    const liveSelection: EditModeSelection = { kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcServerId: 7 };
    selected = liveSelection;
    plugin.applyAtPointer();
    assert.equal(plugin.getState().selection, undefined, "pending source lookups cannot be edited");
    const beforePendingDelete = plugin.getConfig().edits;
    plugin.deleteSelection();
    assert.deepEqual(plugin.getConfig().edits, beforePendingDelete);
    selected = { kind: "loc", ...pointer, locId: 1276, locName: "Tree" };
    plugin.applyAtPointer();
    const origin = { id: 3, tileX: 3260, tileY: 3260, plane: 0, wanderRadius: 5, direction: 2, name: "First" };
    completeLookup(origin);
    await Promise.resolve();
    assert.equal(plugin.getState().selection?.kind, "loc", "stale lookups cannot replace a newer click");

    resolveSpawn = async () => origin;
    selected = liveSelection;
    plugin.applyAtPointer();
    await Promise.resolve();
    plugin.deleteSelection();
    assert.deepEqual(plugin.getConfig().edits.map(({ persistedNpc, ...edit }) => edit), [
        baseline[1],
        { kind: "npcDelete", locId: 3, tileX: 3260, tileY: 3260, plane: 0, shape: 0, rotation: 0 },
    ], "deleting a wandered saved addition removes its source row and tombstones its origin");
    assert.equal(plugin.undo(), true);
    selected = liveSelection;
    plugin.applyAtPointer();
    await Promise.resolve();
    plugin.moveSelection();
    pointer = { tileX: 3268, tileY: 3262, plane: 0 };
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.some((edit) => edit.tileX === 3264 && edit.tileY === 3261), false);
    savedFiles.length = 0;
    assert.deepEqual(JSON.parse(await savedNpcPatch()), [
        { id: 3, x: 3270, y: 3270, level: 0, name: "Untouched" },
        { id: 3, x: 3260, y: 3260, level: 0, remove: true },
        { id: 3, x: 3268, y: 3262, level: 0, direction: 2, wanderRadius: 5, name: "First" },
    ], "saving preserves untouched fields and moves from the original spawn, not its wandered position");

    plugin.clearEdits();
    resolveSpawn = async () => undefined;
    selected = liveSelection;
    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    await Promise.resolve();
    calls.length = 0;
    plugin.deleteSelection();
    plugin.moveSelection();
    assert.deepEqual(calls, [], "unknown/plugin spawns are not silently hidden for one session");
    assert.deepEqual(plugin.getConfig().edits, []);
    assert.equal(plugin.getConfig().tool, "select");

    // Actual binary socket messages, without listening or opening a connection.
    const originalSocket = state.socket;
    let sent: ReturnType<typeof parsePluginMessage> | undefined;
    state.socket = { readyState: 1, send: (packet: Uint8Array) => { sent = parsePluginMessage(packet.subarray(3)); } } as any;
    try {
        const pending = requestLiveNpcSpawn(liveSelection);
        assert.equal(sent?.channel, "npc-editor");
        assert.deepEqual(sent?.data, { type: "spawn", request: sent?.data.request, index: 7, id: 3, x: 3264, y: 3261, plane: 0 });
        emitPluginMessage({ channel: "npc-editor", data: { type: "spawn", request: Number(sent!.data.request) + 1, spawn: origin } });
        emitPluginMessage({ channel: "npc-editor", data: { type: "spawn", request: sent!.data.request, spawn: origin } });
        assert.deepEqual(await pending, origin);
        const unavailable = requestLiveNpcSpawn(liveSelection);
        emitPluginMessage({ channel: "npc-editor", data: { type: "spawn", request: sent!.data.request } });
        assert.equal(await unavailable, undefined);

        const ecs = new NpcEcs();
        const tiles = new Map<number, { x: number; y: number }>();
        const makeNpc = (serverId: number, x: number, y: number) => {
            const id = ecs.createNpc(x >> 6, y >> 6, 3, 1, 64, 64, 0, 0, x & 63, y & 63);
            ecs.setServerMapping(id, serverId);
            tiles.set(id, { x, y });
            return id;
        };
        const despawned: number[] = [];
        let previewId = 60000;
        liveRegistry = new LiveNpcSpawns(ecs, (id) => tiles.get(id), (source) => {
            const serverId = previewId++;
            makeNpc(serverId, source.tileX, source.tileY);
            return serverId;
        }, (serverId) => {
            despawned.push(serverId);
            const id = ecs.getEcsIdForServer(serverId);
            if (id !== undefined) ecs.destroyNpc(id);
        });
        makeNpc(7, liveSelection.tileX, liveSelection.tileY);
        const liveLookup = liveRegistry.resolve(liveSelection);
        emitPluginMessage({ channel: "npc-editor", data: { type: "spawn", request: sent!.data.request, spawn: origin } });
        assert.deepEqual(await liveLookup, origin);
        liveRegistry.hide(origin);
        assert.deepEqual(despawned, [7]);
        makeNpc(7, liveSelection.tileX, liveSelection.tileY);
        liveRegistry.show(origin);
        assert.ok(ecs.getEcsIdForServer(7), "undo never overwrites a reused real index");
        assert.deepEqual(liveRegistry.source(60000), origin, "undo previews retain their exact persisted source");
        plugin.clearEdits();
        pointer = { tileX: origin.tileX, tileY: origin.tileY, plane: origin.plane };
        selected = { kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcServerId: 60000,
            npcSource: "spawn", npcSpawn: liveRegistry.source(60000) };
        plugin.applyAtPointer();
        plugin.deleteSelection();
        assert.equal(ecs.getEcsIdForServer(60000), undefined, "reselecting an undo preview can delete it again");
        assert.ok(ecs.getEcsIdForServer(7), "deleting the preview leaves the new real NPC alone");
        plugin.undo();
        assert.deepEqual(liveRegistry.source(60001), origin);
        selected = { ...selected, npcServerId: 60001, npcSpawn: liveRegistry.source(60001) };
        plugin.applyAtPointer();
        plugin.moveSelection();
        pointer = { tileX: 3269, tileY: 3269, plane: 0 };
        plugin.applyAtPointer();
        assert.equal(ecs.getEcsIdForServer(60001), undefined, "an undo preview can be moved too");
        assert.equal(plugin.getConfig().edits[0].kind, "npcDelete");

        // Even reuse of the same ECS slot, server index and type invalidates an in-flight lookup.
        plugin.clearEdits();
        assert.deepEqual(liveRegistry.source(60002), origin);
        const oldPreview = ecs.getEcsIdForServer(60002)!;
        ecs.destroyNpc(oldPreview);
        makeNpc(60002, 3300, 3300);
        assert.equal(liveRegistry.source(60002), undefined, "reused synthetic IDs cannot inherit an old undo source");
        const staleLookup = liveRegistry.resolve(liveSelection);
        const oldId = ecs.getEcsIdForServer(7)!;
        ecs.destroyNpc(oldId);
        const reusedId = makeNpc(7, liveSelection.tileX, liveSelection.tileY);
        assert.equal(reusedId, oldId, "the test exercises actual ECS slot reuse");
        emitPluginMessage({ channel: "npc-editor", data: { type: "spawn", request: sent!.data.request, spawn: origin } });
        assert.equal(await staleLookup, undefined);
        despawned.length = 0;
        liveRegistry.hide(origin);
        assert.equal(despawned.includes(7), false, "stale identity data cannot hide a reused NPC");
        assert.ok(ecs.getEcsIdForServer(7));
        liveRegistry = undefined;
    } finally { state.socket = originalSocket; liveRegistry = undefined; }

    const snapshot = [{ id: 3, tileX: 3270, tileY: 3270, plane: 0, name: "Kept", wanderRadius: 0, direction: 2 },
        { id: 3, tileX: 3260, tileY: 3260, plane: 0, remove: true }];
    assert.deepEqual(parseCustomNpcSpawnSnapshot(snapshot), snapshot);
    assert.throws(() => parseCustomNpcSpawnSnapshot([{ ...snapshot[0], unexpected: "must not disappear" }]), /Unsupported/);
    assert.throws(() => parseCustomNpcSpawnSnapshot([{ ...snapshot[0], wanderRadius: 256 }]), /Invalid/);
    const hostMessages: unknown[] = [];
    const host = { closed: false, postMessage: (message: unknown, origin: string) => { hostMessages.push([message, origin]); } };
    Object.defineProperty(window, "opener", { configurable: true, value: host });
    const snapshotRequest = requestCustomNpcSpawnSnapshot();
    assert.deepEqual(hostMessages[0], [{ type: CUSTOM_NPC_SPAWNS_REQUEST_MESSAGE }, "null"]);
    window.dispatchEvent(new dom.window.MessageEvent("message", { source: host as any, origin: "https://unrelated.invalid", data: { type: CUSTOM_NPC_SPAWNS_MESSAGE, replace: true, spawns: [] } }));
    window.dispatchEvent(new dom.window.MessageEvent("message", { source: host as any, origin: "null", data: { type: CUSTOM_NPC_SPAWNS_MESSAGE, replace: true, spawns: snapshot } }));
    assert.deepEqual(await snapshotRequest, snapshot);
    hostMessages.length = 0;
    plugin.importNpcSpawnEdits([baseline[0], baseline[0], baseline[1]], false);
    pointer = { tileX: 3270, tileY: 3270, plane: 0 };
    selected = { kind: "npc", ...pointer, locId: 3, locName: "Goblin", npcSource: "spawn", npcSpawn: { id: 3, ...pointer } };
    plugin.applyAtPointer();
    plugin.setSelectionWanderRadius(1);
    download.click();
    const savedHost = hostMessages.find((entry: any) => entry[0]?.type === CUSTOM_NPC_SPAWNS_MESSAGE) as any;
    assert.equal(savedHost?.[0].replace, true, "host saves replace the loaded full snapshot");
    assert.equal(savedHost[0].spawns.some((spawn: any) => spawn.name === "Untouched"), true);
    assert.equal(savedHost[0].spawns.filter((spawn: any) => spawn.name === "First").length, 2,
        "an unrelated edit/save preserves same-source duplicate count and order");
    Object.defineProperty(window, "opener", { configurable: true, value: null });

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