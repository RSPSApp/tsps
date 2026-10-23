import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { Camera } from "../game/Camera";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";

require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const dom = new JSDOM('<canvas tabindex="0"></canvas>', { url: "http://localhost:3116/?edit=1" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, self: dom.window, HTMLAnchorElement: dom.window.HTMLAnchorElement, HTMLElement: dom.window.HTMLElement });
dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as any;
const { OverlayHost } = require("../render/webgpu/overlays/OverlayHost");
const { EditorOverlays } = require("../render/webgpu/overlays/EditorOverlays");
const { installEditMode } = require("../game/plugins/editmode/install");
const { GameState } = require("../game/login/GameState");

async function main() {
    const intervals: (() => void)[] = [];
    dom.window.setInterval = ((callback: () => void) => { intervals.push(callback); return intervals.length; }) as any;
    dom.window.clearInterval = () => {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ spawn: { x: 3090, y: 3520, z: 0 }, zones: [] }));
    let reloaded: number[] = [];
    const canvas = document.querySelector("canvas")!;
    const client: any = {
        cameraSpeed: 2,
        camera: new Camera(3090, -10, 3520, 210, 0),
        tileHighlightManager: new TileHighlightManager(),
        gameState: GameState.LOGIN_SCREEN,
        loadedCache: {},
        isLoggedIn: () => false,
        inputManager: { mouseX: -1, mouseY: -1 },
        playerEcs: { size: () => 0, getIndexForServerId: () => undefined },
        // Edit mode loads no plugins.
        clientPlugins: new ClientPluginManager(),
    };
    const renderer: any = {
        osrsClient: client, canvas, stats: { frameCount: 0 },
        mapManager: { getMapForWorldTile: () => undefined, visibleMaps: [], visibleMapCount: 0 },
        worldEntityOverlays: new Map(),
        terrainOverrides: new Map(), mapRegionReplacements: new Map(),
        locUpdates: { getMapIdForWorldTile: () => 12342, scheduleReload: (x: number, y: number, group: string) => { assert.equal(group, "full"); reloaded = [x, y]; } },
        getMinimapIcons: () => [],
        sampleHeightAtExactPlane: () => 0,
    };
    renderer.interactionHost = new OverlayHost(renderer);
    renderer.editorOverlays = new EditorOverlays(renderer);
    renderer.interactionHost.getEffectivePlaneForTile = (_x: number, _y: number, plane: number) => plane + 1;
    client.renderer = renderer;
    const plugin = installEditMode(client);
    assert.equal(plugin.getConfig().enabled, true, "native host installs without WebGL draw hooks or pending-loc state");
    await new Promise(resolve => setTimeout(resolve, 0));
    intervals[0]();
    assert.equal(client.cameraSpeed, 2, "editor leaves normal camera speed unchanged");
    assert.equal(client.scenePreviewEnabled, true, "?edit=1 enters the native scene preview");
    assert.equal(plugin.getState().scenePreview, true);
    plugin.setConfig({ heightLevel: 2 });
    assert.equal(renderer.interactionHost.getPlayerRawPlane(), 2);
    assert.equal(renderer.interactionHost.getEffectivePlaneForTile(3090, 3520, 2), 2, "editor highlights use the chosen physical level, including bridge tiles");
    assert.equal(renderer.interactionHost.getRoofPlaneLimit(), 2);
    plugin.setConfig({ renderAllHeightLevels: true });
    assert.equal(renderer.interactionHost.getRoofPlaneLimit(), 3);
    plugin.setConfig({ heightLevel: 0 });
    assert.equal(plugin.getConfig().renderAllHeightLevels, true, "returning to ground restores all floors by default");
    plugin.setConfig({ heightLevel: 2 });
    assert.equal(plugin.getConfig().renderAllHeightLevels, false, "upper floors default to hiding floors above them");
    const host = (plugin as any).host;
    const tile = { tileX: 3090, tileY: 3520, plane: 2 };
    host.setTerrainOverlay(tile, 5, 0, 1);
    assert.deepEqual(renderer.terrainOverrides.get("3090,3520,2"), { overlay: 5, shape: 0, rotation: 1 });
    assert.deepEqual(reloaded, [48, 54], "terrain edits reload the real WebGPU square");
    host.clearTerrainOverride(tile);
    assert.equal(renderer.terrainOverrides.size, 0);
    plugin.setConfig({ active: false });
    assert.equal(client.scenePreviewEnabled, false, "leaving editor restores normal rendering");
    assert.equal(renderer.interactionHost.getPlayerRawPlane(), 0);
    assert.equal(renderer.interactionHost.getEffectivePlaneForTile(3090, 3520, 2), 3, "leaving editor restores game plane resolution");
    assert.equal(client.cameraSpeed, 2, "leaving editor restores the previous camera speed");
    renderer.editorOverlays.dispose();
    renderer.interactionHost.dispose();
    globalThis.fetch = originalFetch;
    dom.window.close();
    console.log("WebGPU editor installation, height filtering and terrain reload tests passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; dom.window.close(); });
