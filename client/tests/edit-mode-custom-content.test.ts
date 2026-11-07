import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CustomDefinitionLoader, getCustomDefinitions } from "../custom/definitions/CustomDefinitionStore";
import { CustomModelRegistry } from "../custom/items/CustomModelRegistry";
import { IndexModelLoader } from "../rs/model/ModelLoader";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { searchEditorCache } from "../game/plugins/editmode/install";
import { applyEditorCustomContent, connectEditorCustomContent, EDITOR_CUSTOM_CONTENT_MESSAGE, EDITOR_CUSTOM_CONTENT_REQUEST } from "../game/plugins/editmode/EditorCustomContent";

async function main() {
    const dom = new JSDOM('<canvas tabindex="0"></canvas>', { url: "https://editor.rsps.app/", pretendToBeVisual: true });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
        self: dom.window, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) });
    const host = new JSDOM("", { url: "https://rsps.app/host/" }).window;
    const other = new JSDOM("", { url: "https://rsps.app/" }).window;
    const requests: unknown[] = [];
    host.postMessage = (message, origin) => { assert.equal(origin, "https://rsps.app"); requests.push(message); };
    const bytes = new Uint8Array([0,0,0,1,64,65,65,0,1, 0,3,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,3]);
    const base = { id: 1, name: "Cache goblin", modelIds: [1], actions: ["Talk-to"] };
    const types = new CustomDefinitionLoader<any>({ getCount: () => 2, clearCache() {}, load: id => id === 1 ? base : { id, name: "null" } }, "npc");
    const workerPayloads: any[] = [];
    let renders = 0;
    const client: any = { npcTypeLoader: types, renderer: { invalidateDefinitionCaches: () => renders++ },
        workerPool: { runAll: (send: any) => Promise.all([send({ setCustomContent: async (payload: any) => workerPayloads.push(payload) })]) } };
    const content = { type: EDITOR_CUSTOM_CONTENT_MESSAGE, definitions: [{ kind: "npc", id: 50001, baseId: 1,
        fields: { name: "Custom keeper", modelIds: [1000001], actions: ["Talk-to", null, "Trade"] } }],
        models: [{ id: 1000001, data: Buffer.from(bytes).toString("base64") }] };
    assert.deepEqual(await searchEditorCache("npc", types, "keeper"), [], "the old cache-only search is built before custom content arrives");
    let ready!: () => void;
    const loaded = new Promise<void>(resolve => { ready = resolve; });
    const disconnect = connectEditorCustomContent(client, host as unknown as Window, "https://rsps.app", () => ready());
    assert.deepEqual(requests, [{ type: EDITOR_CUSTOM_CONTENT_REQUEST }]);
    const deliver = (source: any, origin: string, data = content) => window.dispatchEvent(new dom.window.MessageEvent("message", { source, origin, data }));
    deliver(other, "https://rsps.app");
    deliver(host, "https://attacker.example");
    assert.deepEqual(getCustomDefinitions(), [], "other windows and origins cannot replace editor content");
    deliver(host, "https://rsps.app");
    await loaded;
    assert.equal(renders, 1);
    assert.deepEqual((await searchEditorCache("npc", types, "keeper")).map(row => row.id), [50001]);
    assert.equal((await searchEditorCache("npc", types, "50001"))[0].name, "Custom keeper");
    assert.equal(types.load(50001).id, 50001);
    assert.equal(types.load(1).name, "Cache goblin", "the inherited cache definition stays unchanged");
    const model = new IndexModelLoader({ getFile: () => undefined } as any).getModel(types.load(50001).modelIds[0]);
    assert.equal(model?.verticesCount, 3, "the game's real model loader decodes the uploaded NPC DAT");
    assert.equal(model?.faceCount, 1);
    assert.deepEqual(workerPayloads[0].datasets.map((row: any) => [row.key, row.rows.length]), [["customModels", 0], ["customModels", 1], ["customDefinitions", 1]]);

    const placements: number[] = [];
    const plugin = new EditModePlugin();
    plugin.attach({ getCanvas: () => document.querySelector("canvas")!, getPointerTile: () => ({ tileX: 3222, tileY: 3218, plane: 0 }),
        getPointerLoc: () => undefined, getLocName: () => "", getNpcName: id => types.load(id).name,
        search: (kind, query) => searchEditorCache(kind, types, query), spawnNpc: id => { placements.push(id); return 60000; },
        despawnNpc() {}, onLocAddChange() {}, onLocDel() {}, setFreeCamera() {}, cancelPendingClick() {}, jumpCameraToTile() {}, levelCamera() {}, isLoggedIn: () => true } as any);
    plugin.setConfig({ enabled: true, active: true, tool: "place", placeKind: "npc", npcId: 50001 });
    plugin.applyAtPointer();
    assert.deepEqual(placements, [50001]);
    assert.equal(plugin.getConfig().edits[0].locId, 50001, "placement/export retains the custom type ID");
    plugin.setConfig({ enabled: false, active: false });

    const renamed = { ...content, definitions: [{ ...content.definitions[0], fields: { ...content.definitions[0].fields, name: "Renamed keeper" } }] };
    await applyEditorCustomContent(client, renamed);
    assert.equal((await searchEditorCache("npc", types, "renamed"))[0].name, "Renamed keeper");
    assert.deepEqual(await searchEditorCache("npc", types, "custom keeper"), [], "saved names replace the cached search index");
    let release!: () => void;
    const workerReady = new Promise<void>(resolve => { release = resolve; });
    client.workerPool.runAll = async (send: any) => { await workerReady; return send({ setCustomContent: async (payload: any) => workerPayloads.push(payload) }); };
    const refreshed = new Promise<void>(resolve => { ready = () => { if (types.load(50001).name === "Latest keeper") resolve(); }; });
    deliver(host, "https://rsps.app", { ...content, definitions: [{ ...content.definitions[0], fields: { name: "Earlier keeper" } }] });
    deliver(host, "https://rsps.app", { ...content, definitions: [{ ...content.definitions[0], fields: { name: "Latest keeper" } }] });
    release();
    await refreshed;
    assert.equal((await searchEditorCache("npc", types, "latest"))[0].id, 50001, "saves arriving during worker sync are applied in order, including the latest one");
    const previous = getCustomDefinitions();
    for (const bad of [{ ...content, definitions: [{ ...content.definitions[0], id: -1 }] },
        { ...content, models: [...content.models, { id: 1000002, data: "bad" }] },
        { ...content, models: [content.models[0], content.models[0]] }]) {
        await assert.rejects(applyEditorCustomContent(client, bad));
        assert.deepEqual(getCustomDefinitions(), previous);
        assert.deepEqual(CustomModelRegistry.get(1000001), new Int8Array(bytes), "invalid snapshots do not clear current definitions/models");
    }
    await applyEditorCustomContent(client, { ...content, definitions: [{ ...content.definitions[0], fields: { name: "In-flight keeper" } }] });
    const pending = searchEditorCache("npc", types, "keeper");
    await applyEditorCustomContent(client, { ...content, definitions: [], models: [] });
    assert.deepEqual(await searchEditorCache("npc", types, "50001"), []);
    await pending;
    assert.deepEqual(await searchEditorCache("npc", types, "keeper"), [], "a stale index cannot restore deleted custom choices");
    assert.equal(CustomModelRegistry.get(1000001), undefined, "the next world's empty snapshot removes old models");

    const interval = window.setInterval, clear = window.clearInterval;
    let retry!: () => void;
    let stopped = false;
    window.setInterval = ((callback: () => void) => { retry = callback; return 1; }) as any;
    window.clearInterval = (() => { stopped = true; }) as any;
    requests.length = 0;
    const stopOldHost = connectEditorCustomContent(client, host as unknown as Window, "https://rsps.app", () => assert.fail("old host supplied nothing"));
    for (let i = 0; i < 8; i++) retry();
    assert.equal(requests.length, 5, "older website deployments receive bounded startup requests only");
    assert.equal(stopped, true);
    stopOldHost(); disconnect();
    window.setInterval = interval; window.clearInterval = clear;
    dom.window.close(); host.close(); other.close();
    console.log("editor custom content: trusted bridge, real model decode, placement, cache refresh and validation passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
