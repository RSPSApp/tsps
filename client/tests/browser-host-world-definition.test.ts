import assert from "node:assert/strict";

(globalThis as any).self = globalThis;
const {
    requestBrowserHostWorldDefinition,
    parseBrowserHostShops,
    parseBrowserHostWorldDefinition,
    parseEditModeWorldDefinition,
} = require("../game/plugins/editmode/install");
const {
    WORLD_DEFINITION_MESSAGE,
    WORLD_DEFINITION_REQUEST_MESSAGE,
} = require("../game/plugins/editmode/hostProtocol/worldDefinitionMessage");

assert.deepEqual(
    parseBrowserHostShops(JSON.stringify([{
        id: 1,
        name: "General Store",
        currency: "COINS",
        defaultRestockTicks: 10,
        originalStock: [{ id: 995, amount: 1, price: 1 }],
    }])),
    [{
        id: 1,
        name: "General Store",
        currency: "COINS",
        defaultRestockTicks: 10,
        originalStock: [{ id: 995, amount: 1, price: 1 }],
    }],
);
assert.throws(() => parseBrowserHostShops('[{"id":1,"name":"Bad","originalStock":[{"id":0,"amount":1}]}]'));

const parsedWorld = {
    spawn: { x: 3089, y: 3524, z: 0 },
    zones: [{ minX: 1, maxX: 2, minY: 3, maxY: 4, z: 0, tags: ["pvp"] }],
    disabledPlugins: ["PvpMode"],
    experienceMultiplier: 5,
};
for (const tags of [[], ["custom:arena", "__proto__"], ["duel"], ["pvp"], ["pvp", "multi-combat"], ["pvp", "all-buildings-safe"]]) {
    const world = { ...parsedWorld, zones: [{ tags }, ...parsedWorld.zones] };
    const parsed = parseBrowserHostWorldDefinition(JSON.stringify(world));
    assert.deepEqual(parsed, world, "Global rules must not reject the spawn or be lost on save");
    assert.deepEqual(parseBrowserHostWorldDefinition(JSON.stringify(parsed)), world);
}
const configuredWorld = { ...parsedWorld, pluginConfig: { "TutorialIsland:allowSkip": false }, futureKey: [1] };
assert.deepEqual(parseBrowserHostWorldDefinition(JSON.stringify(configuredWorld)), configuredWorld,
    "Saving must keep pluginConfig and any other key the editor does not edit");
const f2pWorld = { ...parsedWorld, membersWorld: false };
assert.deepEqual(parseBrowserHostWorldDefinition(JSON.stringify(f2pWorld)), f2pWorld, "Saving must not reset a free-to-play world");
for (const zone of [{ minX: 1, tags: ["pvp"] }, { tags: [123] }, { ...parsedWorld.zones[0], tags: [] }]) {
    assert.throws(() => parseEditModeWorldDefinition({ ...parsedWorld, zones: [zone] }));
}
// Local zone interaction becomes available after asynchronous world loading.
const { EditorWorldMap } = require("../game/plugins/editmode/EditorWorldMap");
let visibleZones: unknown;
const map = new EditorWorldMap({}, () => {}, () => visibleZones, () => {}, () => {}, () => {}, () => {});
Object.assign(map, { canvas: { width: 100, height: 100 }, centerX: 1, centerY: 3, pixelsPerTile: 1 });
assert.equal(map.zoneAt(50, 50), undefined);
visibleZones = { zones: parsedWorld.zones, showPvp: true, showMulti: true };
assert.equal(map.zoneAt(50, 50), 0, "loaded world enables zone selection without a browser host");
visibleZones = undefined;
assert.equal(map.zoneAt(50, 50), undefined);

const { EditModePlugin } = require("../game/plugins/editmode/EditModePlugin");
const zoneEditor = new EditModePlugin();
zoneEditor.world = { loading: false, definition: { ...parsedWorld, zones: [] } };
for (const tag of ["pvp", "multi-combat", "safe", "duel", "f2p"]) {
    zoneEditor.addWorldZone({ minX: 1, maxX: 2, minY: 3, maxY: 4 }, tag);
}
assert.deepEqual(zoneEditor.getWorldDefinitionForSave().zones.map((zone: any) => zone.tags), [["pvp"], ["multi-combat"], ["safe"], ["duel"], ["f2p"]]);
assert.equal(zoneEditor.getConfig().showSafeZones, true);
assert.equal(zoneEditor.getConfig().showF2pZones, true);
assert.equal(zoneEditor.getConfig().showDuelZones, true);
visibleZones = { zones: [{ ...parsedWorld.zones[0], tags: ["duel"] }], showDuel: true };
assert.equal(map.zoneAt(50, 50), 0, "Duel zones remain selectable with only Duel enabled");
assert.deepEqual(parseEditModeWorldDefinition(zoneEditor.getWorldDefinitionForSave()).zones[2].tags, ["safe"]);
zoneEditor.setWorldZoneType(0, "safe");
assert.deepEqual(zoneEditor.getWorldDefinitionForSave().zones[0].tags, ["safe"]);
visibleZones = { zones: zoneEditor.getWorldDefinitionForSave().zones, showPvp: false, showMulti: false, showSafe: true };
assert.equal(map.zoneAt(50, 50), 2, "safe zones remain selectable with only Safe enabled");

const originalWindow = globalThis.window;
const listeners = new Set<(event: MessageEvent) => void>();
const sent: Array<{ message: unknown; origin: string }> = [];
const host = {
    closed: false,
    postMessage(message: unknown, origin: string) {
        sent.push({ message, origin });
        queueMicrotask(() => {
            for (const listener of listeners) {
                listener({
                    origin: "https://host.rsps.test",
                    source: host,
                    data: {
                        type: WORLD_DEFINITION_MESSAGE,
                        contents: JSON.stringify({ spawn: { x: 3089, y: 3524, z: 2 }, zones: [{ tags: [] }] }),
                    },
                } as MessageEvent);
            }
        });
    },
};
(globalThis as any).window = {
    location: {
        origin: "https://client.rsps.test",
        search: "?browser-host-client=1&browser-host-origin=https%3A%2F%2Fhost.rsps.test",
    },
    opener: null,
    parent: host,
    setTimeout,
    clearTimeout,
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
};

void requestBrowserHostWorldDefinition().then((definition: { spawn: unknown }) => {
    assert.deepEqual(definition.spawn, { x: 3089, y: 3524, z: 2 });
    assert.deepEqual(sent, [{ message: { type: WORLD_DEFINITION_REQUEST_MESSAGE }, origin: "https://host.rsps.test" }]);
    assert.equal(listeners.size, 0, "reply listener is removed after the host responds");
    (globalThis as any).window = originalWindow;
    console.log("Browser-host world-definition handshake passed");
});
