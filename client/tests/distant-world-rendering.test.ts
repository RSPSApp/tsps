import assert from "node:assert/strict";
import { test } from "node:test";
import "./register-render-assets";
import { ActorDataWriter } from "../render/webgpu/actors/actorPacking";
import { MapManager } from "../game/MapManager";
import { ClientState } from "../game/ClientState";
import { sceneryBuildOptions, syncSceneryDetail } from "../render/SceneryPolicy";
(globalThis as any).self = globalThis;
const { WebGPUActors } = require("../render/webgpu/actors/WebGPUActors");
const { addUnbatchedNpcRenderData } = require("../render/render/draw");
const highlight = require("../render/render/interact/highlight");
const { resolveInteractHighlightTargetFromEntry, updateInteractHighlightHoverTarget, onInteractHighlightEntryInvoked } = require("../render/render/interact/highlight4");
const { resolveNpcHighlightTargetFromEntry } = require("../render/render/interact/highlight3");
const { ClientPluginManager } = require("../game/plugins/ClientPluginManager");
const { MenuTargetType } = require("../rs/MenuEntry");
const { resolveEffectiveRenderDistanceTiles } = require("../render/render/draw2");
const { resolveEffectiveLodThresholdTiles } = require("../render/render/misc");
const { resolveWebGPURenderDistance, resolveWebGPULodDistance } = require("../render/webgpu/frameConfig");
const actor = { key: "cosmetic", typeId: 1, x: 3300.5, y: 3200.5, plane: 0, seqId: 3, frameId: 2, rotation: 512 };
const map = { mapX: 51, mapY: 50, timeLoaded: 0, getRenderBaseTileX: () => 3264, getRenderBaseTileY: () => 3200,
    getTileRenderFlag: () => 2 };
const rejectEcs = new Proxy({}, { get() { throw new Error('cosmetic draw accessed authoritative ECS'); } });

test("distant sheep hover resolves its cosmetic identity rather than falling back to the nearby imp", () => {
    let actors = [{ ...actor, key: 'distant-sheep', typeId: 43 }];
    const host: any = { osrsClient: { menuTile: { tileX: 3200, tileY: 3200 }, npcEcs: {
        isActive: () => true, isLinked: () => true, getNpcTypeId: () => 708,
        queryByTile: () => [], getAllActiveIds: () => [0], getServerId: () => 42, getLevel: () => 0,
    }, clientPlugins: { cosmeticNpcs: () => actors, interactHighlightConfig: () => ({ enabled: true, showHover: true }) } },
        getNpcWorldTile: () => ({ x: 3200, y: 3200 }),
    };
    host.resolveNpcHighlightTargetFromEntry = (entry: any, tile: any) => resolveNpcHighlightTargetFromEntry(host, entry, tile);
    host.resolveInteractHighlightTargetFromEntry = (entry: any, tile: any) => resolveInteractHighlightTargetFromEntry(host, entry, tile);
    host.clearInteractHighlightHoverTarget = () => { host.interactHighlightHoverTarget = undefined; };
    const entry = { option: 'Shear', targetType: MenuTargetType.NPC, targetId: 43, cosmeticNpcKey: 'distant-sheep', opcode: 0 };
    const expected = { kind: 'cosmetic-npc', key: 'distant-sheep', plane: 0 };
    assert.deepEqual(host.resolveInteractHighlightTargetFromEntry(entry), expected);
    updateInteractHighlightHoverTarget(host, [entry]);
    assert.deepEqual(host.interactHighlightHoverTarget, expected);
    onInteractHighlightEntryInvoked(host, entry);
    assert.deepEqual(host.interactHighlightActiveTarget, expected);
    actors = [];
    assert.equal(host.resolveInteractHighlightTargetFromEntry(entry), undefined, 'stale menu keys must not fall back to any live NPC');
    updateInteractHighlightHoverTarget(host, [entry]);
    assert.equal(host.interactHighlightHoverTarget, undefined);
    assert.equal(resolveNpcHighlightTargetFromEntry(host, entry), undefined, 'direct native-NPC resolution must also reject cosmetic keys');
});

test("GPU and 117 HD own scenery settings while cosmetic NPCs remain available", () => {
    const plugins = new ClientPluginManager();
    let gpu: any, hd = false;
    plugins.add({ scenerySettings: () => ({ drawDistance: 384, detailDistance: 40 }),
        gpuSettings: () => gpu, hdEnabled: () => hd, cosmeticNpcs: () => [actor] });
    assert.equal(plugins.scenerySettings().drawDistance, 384);
    gpu = { drawDistance: 60, overrideDeviceCaps: true };
    assert.equal(plugins.scenerySettings(), undefined);
    assert.deepEqual(plugins.cosmeticNpcs(), [actor]);
    gpu = undefined; hd = true;
    assert.equal(plugins.scenerySettings(), undefined);
    assert.deepEqual(plugins.cosmeticNpcs(), [actor]);
    hd = false;
    assert.equal(plugins.scenerySettings().drawDistance, 384, 'disabling graphics plugins restores the standalone scenery setting');
    const host: any = { osrsClient: { clientPlugins: plugins, renderDistance: 120, lodDistance: 35 },
        syncBrowserQualityProfile: () => ({ renderDistanceCap: 90, lodThresholdCap: 90 }) };
    let frame = 0;
    host.getFrameRenderDistanceTiles = () => resolveEffectiveRenderDistanceTiles(host, ++frame);
    for (const settings of [{ gpu: { drawDistance: 60, overrideDeviceCaps: true }, hd: false, distance: 60, lod: 58 },
        { gpu: undefined, hd: true, distance: 120, lod: 35 },
        { gpu: { drawDistance: 140, overrideDeviceCaps: true }, hd: true, distance: 140, lod: 48 }]) {
        gpu = settings.gpu; hd = settings.hd;
        assert.equal(resolveEffectiveRenderDistanceTiles(host, ++frame), settings.distance);
        assert.equal(resolveWebGPURenderDistance(host), settings.distance);
        assert.equal(resolveEffectiveLodThresholdTiles(host, ++frame), settings.lod);
        assert.equal(resolveWebGPULodDistance(host), settings.lod);
        assert.equal(sceneryBuildOptions({ ...clientAt(3200, 3200), clientPlugins: plugins }, 54, 50).farOnly, false,
            'Distant World must not compact scenery managed by a graphics plugin');
    }
});

test("cosmetic outlines follow the keyed actor's current pose, rotation, bridge height and lifecycle without ECS", () => {
    let actors = [{ ...actor, key: 'sheep', x: 3300.5, y: 3200.5 }];
    const heightMapData = new Int16Array(4 * 65 * 65).fill(16);
    heightMapData.fill(32, 65 * 65, 2 * 65 * 65);
    const models: any[] = [];
    const model = { verticesX: [0, 128, 0], verticesY: [0, -128, 0], verticesZ: [0, 0, 128] };
    const ground = { ...map, heightMapData, heightMapSize: 65 };
    const host: any = { osrsClient: { npcEcs: rejectEcs, npcTypeLoader: { load: (id: number) => ({ id }) },
        clientPlugins: { cosmeticNpcs: () => actors } },
        mapManager: { getMapForWorldTile: () => ground },
        getInteractNpcModelLoader: () => ({ getModel: (...args: any[]) => { models.push(args); return model; } }),
        buildModelTrianglePoints: (_model: any, project: (i: number) => any) => [0, 1, 2].map(i => {
            const v = project(i); return [v.x, v.y, v.z];
        }),
    };
    const target = { kind: 'cosmetic-npc', key: 'sheep', plane: 0 };
    const points = highlight.buildHighlightTrianglePoints(host, target);
    assert.deepEqual(models[0], [{ id: 1 }, 3, 2]);
    assert.deepEqual(points[0], [3300.5, -2 - 10 / 128, 3200.5], 'the outline uses the bridge-promoted actor floor and ordinary clearance');
    assert.equal(points[1][2], 3199.5, 'rotation 512 faces the same direction as the rendered proxy');
    actors[0] = { ...actors[0], x: 3301, frameId: 4 };
    assert.equal(highlight.buildHighlightTrianglePoints(host, target)[0][0], 3301);
    assert.equal(models.at(-1)[2], 4, 'animation follows the current shared pose rather than the clicked snapshot');
    assert.equal(highlight.isSameInteractHighlightTarget(host, target, { ...target }), true);
    assert.equal(highlight.isSameInteractHighlightTarget(host, target, { ...target, key: 'other-sheep' }), false);
    host.interactHighlightActiveTarget = target;
    host.clearInteractHighlightActiveTarget = () => { host.interactHighlightActiveTarget = undefined; };
    actors = [];
    assert.equal(highlight.buildHighlightTrianglePoints(host, target), undefined);
    highlight.maybeExpireInteractHighlightTarget(host);
    assert.equal(host.interactHighlightActiveTarget, undefined, 'handoff, disable or catalog eviction removes the cosmetic outline');
});

test("WebGPU cosmetic draws use ordinary NPC pipelines and zero interaction ids without reading ECS", () => {
    const host: any = Object.create(WebGPUActors.prototype);
    const geometry = { key: 'pose', opaqueVertices: new Uint8Array(20), opaqueIndices: new Int32Array([0, 1, 2]), alphaVertices: new Uint8Array(0), alphaIndices: new Int32Array(0) };
    host.renderer = { osrsClient: { npcEcs: rejectEcs } }; host.writer = new ActorDataWriter();
    host.asyncNpcPoses = { get: () => geometry };
    host.geometry = { getOrCreate: (_key: string, vertices: Uint8Array) => vertices.length ? { vertices } : null };
    host.pipelines = new Map([['npc', [{}, {}]]]); host.actorEntry = () => 0;
    const state = { opaque: [], alpha: [] };
    host.packCosmeticNpc(state, map, actor);
    assert.equal(host.writer.count, 1);
    assert.deepEqual([...host.writer.data.slice(0, 8)], [4672, 64, 1 | 512 << 2, 0, 0, 0, 0, 0]);
    assert.equal(state.opaque.length, 1); assert.equal(state.alpha.length, 0);
    assert.equal((state.opaque[0] as any).cosmetic, true);
    host.writer.count = 8192; host.packCosmeticNpc(state, map, actor);
    assert.equal(state.opaque.length, 1, 'cosmetics cannot evict real actor slots');
});

test("WebGL cosmetic packing is independent of NPC indices and respects the actor texture capacity", () => {
    const host: any = { unifiedActorData: true, loadNpcs: true, actorRenderCount: 0, actorRenderData: new Uint16Array(8),
        unbatchedNpcRenderEntries: [], mapManager: { visibleMaps: [map], visibleMapCount: 1 },
        osrsClient: { npcEcs: { getServerLinkedEcsIds: () => [] }, clientPlugins: { cosmeticNpcs: () => [actor] } } };
    addUnbatchedNpcRenderData(host);
    assert.equal(host.actorRenderCount, 1);
    assert.deepEqual([...host.actorRenderData.slice(0, 8)], [4672, 64, 1 | 512 << 2, 0, 0, 0, 0, 0]);
    assert.equal(host.unbatchedNpcRenderEntries[0].ecsId, -1);
    assert.equal(host.unbatchedNpcRenderEntries[0].cosmetic, actor);
    host.actorRenderCount = 8192; addUnbatchedNpcRenderData(host);
    assert.equal(host.unbatchedNpcRenderEntries.length, 0);
});

test("WebGPU cosmetic animation reuses labelled resident geometry and shared pose rows", () => {
    const host: any = Object.create(WebGPUActors.prototype);
    const labels = new Uint8Array([0, 0, 0, 0]);
    const posed = { key: 'resident-body', poseKey: 'shared-walk', matrices: new Float32Array(12),
        opaqueVertices: new Uint8Array(20), opaqueIndices: new Int32Array([0, 1, 2]), opaqueLabels: labels,
        alphaVertices: new Uint8Array(0), alphaIndices: new Int32Array(0) };
    let uniforms: any[], uploadedLabels: unknown;
    host.renderer = { osrsClient: { npcEcs: rejectEcs } }; host.writer = new ActorDataWriter();
    host.npcPose = { resolve: () => posed }; host.poseRowFor = () => 7;
    host.asyncNpcPoses = { get() { throw new Error('resident poses must not rebuild CPU meshes'); } };
    host.geometry = { getOrCreate: (_key: string, vertices: Uint8Array, _indices: unknown, inputLabels: unknown) => {
        if (!vertices.length) return null;
        uploadedLabels = inputLabels; return { vertices };
    } };
    host.pipelines = new Map([['npc', [{}, {}]]]); host.actorEntry = (...args: any[]) => { uniforms = args; return 0; };
    const state = { opaque: [], alpha: [] };
    host.packCosmeticNpc(state, map, actor);
    assert.equal(state.opaque.length, 1); assert.equal(uploadedLabels, labels);
    assert.equal(uniforms![8], 7, 'the ordinary actor pipeline reads the shared pose row');
    assert.equal(host.writer.data[3], 0, 'resident cosmetics still have no server interaction id');
});

test("500 identical distant NPCs upload map uniforms once and draw as one instance batch", () => {
    const host: any = Object.create(WebGPUActors.prototype);
    const mesh = { key: 'shared', opaqueVertices: new Uint8Array(20), opaqueIndices: new Int32Array([0, 1, 2]),
        alphaVertices: new Uint8Array(0), alphaIndices: new Int32Array(0) };
    const gpu = { vertices: {}, indices: {}, indexCount: 3 }, pipeline = {};
    let entries = 0, flushes = 0;
    const state = { id: 51 << 8 | 50, opaque: [], alpha: [], npcByEcsId: new Map(), playerByPid: new Map(), uniforms: {
        renderPosX: 51, renderPosY: 50, reset: () => { entries = 0; }, setWorldEntityTransform() {},
        addEntry: () => entries++, flush: () => flushes++, bindGroupFor: () => ({}),
    } };
    Object.assign(host, { world: { sampleCount: 1 }, stats: {}, lastUpdateTimeSec: -1, writer: new ActorDataWriter(),
        poseRows: new Map(), frameMaps: [], mapStates: new Map([[state.id, state]]),
        renderer: { stats: { frameCount: 1 }, mapManager: { visibleMaps: [map] }, worldEntityForMap: () => undefined,
            osrsClient: { clientPlugins: { cosmeticNpcs: () => Array.from({ length: 500 }, (_, i) => ({ ...actor, key: String(i) })) } } },
        tileSelection: { ensureForFrame() {} }, getCullTile: () => ({ x: 3300, y: 3200 }), resolveRenderDistanceTiles: () => 384,
        isMapWithinRenderDistance: () => true, stepNpcClientAnimations() {},
        geometry: { beginFrame() {}, getOrCreate: (_key: string, vertices: Uint8Array) => vertices.length ? gpu : null },
        asyncNpcPoses: { get: () => mesh }, pipelines: new Map([['npc', [pipeline, pipeline]]]),
        variants: new Map(), posePipelines: new Set(), actorData: { update() {}, updatePoses() {} },
    });
    for (const name of ['packMapNpcs', 'packMapPlayers', 'packMapProjectiles', 'packMapWorldGfx', 'packMapAttachedGfx']) host[name] = () => {};
    host.update(1, null);
    assert.equal(entries, 500); assert.equal(host.writer.count, 500);
    assert.equal(flushes, 1, 'uniform upload count must depend on map count, not NPC count');
    const draws: number[] = [];
    host.drawOpaque({ setBindGroup() {}, setPipeline() {}, setVertexBuffer() {}, setIndexBuffer() {},
        drawIndexed: (_count: number, instances: number) => draws.push(instances) });
    assert.deepEqual(draws, [500]);
});

function clientAt(x: number, y: number, settings: any = { detailDistance: 40 }) {
    return { clientPlugins: { scenerySettings: () => settings }, controlledPlayerServerId: 1, playerEcs: {
        getIndexForServerId: () => 0, getWorldViewId: () => -1, getX: () => x * 128, getY: () => y * 128,
    } } as any;
}

test("streamed far squares keep a playable margin and upgrade ahead of optional downgrades", t => {
    const oldInstance = ClientState.inInstance; ClientState.inInstance = false;
    t.after(() => { ClientState.inInstance = oldInstance; });
    const client = clientAt(3200, 3200);
    assert.equal(sceneryBuildOptions(client, 50, 50).farOnly, false);
    assert.equal(sceneryBuildOptions(client, 51, 50).farOnly, false);
    assert.equal(sceneryBuildOptions(client, 54, 50).farOnly, true);
    assert.equal(sceneryBuildOptions(clientAt(3200, 3200, null), 54, 50).farOnly, false);
    ClientState.inInstance = true;
    assert.equal(sceneryBuildOptions(client, 54, 50).farOnly, false);
    ClientState.inInstance = false;
    const loaded = new Map([[1, { mapX: 60, mapY: 50, farOnly: false }], [2, { mapX: 50, mapY: 50, farOnly: true }]]);
    const loads: number[][] = [];
    const renderer: any = { osrsClient: client, mapManager: { mapSquares: loaded, worldEntityMapIds: new Set(), loadingMapIds: new Set(), loadMap: (...args: number[]) => loads.push(args) } };
    syncSceneryDetail(renderer);
    assert.deepEqual(loads, [[50, 50, true]], 'the near map upgrade precedes a distant downgrade');
});

test("a teleport into a far square waits for full geometry and expanded bounds retain the requested horizon", t => {
    const oldInstance = ClientState.inInstance, oldLow = MapManager.lowEnd;
    ClientState.inInstance = false; MapManager.lowEnd = false;
    t.after(() => { ClientState.inInstance = oldInstance; MapManager.lowEnd = oldLow; });
    const loads: number[][] = [];
    const manager = new MapManager<any>(4, (x, y) => loads.push([x, y]));
    const camera: any = { getPosX: () => 3200, getPosZ: () => 3200, frustum: { intersectsBox: () => true } };
    const update = (frame: number) => manager.update(3200, 3200, camera, frame, 17, 3148, 3148, MapManager.getSceneryPadding(1024), 1024);
    update(0);
    const ids = manager.getGridMapIdsSnapshot();
    assert.ok(ids.length > 900, 'the distant grid is wider than the original expanded-scene cap');
    for (const id of ids) manager.addMap(id >> 8, id & 255, { mapX: id >> 8, mapY: id & 255, farOnly: true, canRender: () => true, delete() {} });
    update(1);
    assert.equal(manager.isSquareReadyAt(3200, 3200, 1), false);
    assert.ok(loads.length > 4, 'required far squares are requeued as full-detail builds');
    for (const id of ids) manager.addMap(id >> 8, id & 255, { mapX: id >> 8, mapY: id & 255, farOnly: false, canRender: () => true, delete() {} });
    update(2);
    assert.equal(manager.isSquareReadyAt(3200, 3200, 2), true);
    const bounds = manager.getGridTileBounds()!;
    assert.ok(bounds.maxX - bounds.minX > 2000);
});
