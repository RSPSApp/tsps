import assert from "node:assert/strict";
import { test } from "node:test";
import { newDrawRange } from "../render/DrawRange";
import { compactFarGeometry, compactFarMap, mapTransferables } from "../render/loader/FarMapData";
import { DistantWorldState, MAX_DISTANT_SPAWNS, idleFrame, cosmeticActor, type DistantSpawn } from "../game/plugins/distantworld/DistantWorldState";
import { DistantApproach } from "../game/plugins/distantworld/DistantApproach";
import { DistantNpcMotion, canDistantNpcStep } from "../game/plugins/distantworld/DistantNpcMotion";
import { packWorldPoint } from "../game/plugins/shortestpath/WorldPointUtil";
import type { PathSearchListener } from "../game/plugins/shortestpath/pathfinder/PathSearch";
import { MenuTargetType } from "../rs/MenuEntry";
import { minMenuSnapshot } from "../rs/cs2/minimenu";
import { MenuOpcode, MenuState } from "../ui/menu/MenuState";
import { chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import { setMenuTransform } from "../ui/menu/menuTransforms";
import { dispatchMenuAction, menuClickListeners } from "../ui/menu/menuEvents";
import { ORBS, ORBS_NOMAP } from "../runelite/api/gameval/InterfaceID";
import { OrbComponent } from "../game/plugins/orbWidgets";
import { BLACK_DEMON, GREEN_DRAGON, MAN } from "@runelite/api/gameval/NpcID";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";

const spawn: DistantSpawn = { key: "1:3300:3200:0", typeId: 1, x: 3300, y: 3200, plane: 0, name: "Guard" };
const catalog = (extra = {}) => ({ type: "catalog", request: 7, supported: true, viewDistance: 15, spawns: [spawn], links: [], ...extra });

test("catalog validation is atomic and stale messages cannot resurrect previews", () => {
    const state = new DistantWorldState();
    assert.equal(state.accept(catalog(), 7), true);
    assert.equal(state.accept(catalog({ request: 6 }), 7), false);
    assert.equal(state.accept(catalog({ spawns: [spawn, spawn] }), 7), false);
    assert.equal(state.accept(catalog({ links: [null] }), 7), false);
    assert.equal(state.accept(catalog({ spawns: [{ ...spawn, x: NaN }] }), 7), false);
    assert.equal(state.accept(catalog({ spawns: new Array(MAX_DISTANT_SPAWNS + 1).fill(spawn) }), 7), false);
    assert.deepEqual(state.spawns, [{ ...spawn, radius: 0 }]);
    assert.equal(state.accept(catalog({ links: [{ key: spawn.key, index: 42 }] }), 7), true);
    assert.equal(state.visible({ x: 3200, y: 3200, plane: 0 }, 384, 96, id => id === 42).length, 0);
    assert.equal(state.visible({ x: 3282, y: 3200, plane: 0 }, 384, 96, () => false).length, 0, "the update square has a three-tile handoff margin");
    assert.equal(state.visible({ x: 3200, y: 3200, plane: 1 }, 384, 96, () => false).length, 0);
    state.clear();
    assert.equal(state.spawns.length, 0);
    assert.equal(state.links.size, 0);
});

test("shared, quantized cosmetic poses have independent world coordinates", () => {
    assert.equal(idleFrame([5, 5, 10], 0), 0);
    assert.equal(idleFrame([5, 5, 10], 100), 1);
    assert.equal(idleFrame([5, 5, 10], 199), 1);
    assert.equal(idleFrame([5, 5, 10], 200), 2);
    assert.equal(idleFrame([], 1000), 0);
    assert.deepEqual(cosmeticActor(spawn, 2, 10, 3), { key: spawn.key, typeId: 1, x: 3301, y: 3201, plane: 0, rotation: 0, seqId: 10, frameId: 3 });
});

function geometryGroup() {
    const vertices = new Uint8Array(6 * 12);
    for (let i = 0; i < 6; i++) vertices.fill(i, i * 12, (i + 1) * 12);
    const far = newDrawRange(12, 3, 2); far.chunk = [8, 16]; far.bounds = [8, 0, 16, 16, 5, 24];
    const alpha = newDrawRange(24, 3);
    return { vertices, indices: new Int32Array([0, 1, 2, 3, 4, 3, 5, 4, 3]),
        drawRanges: [newDrawRange(0, 3)], drawRangesAlpha: [], drawRangesLod: [far], drawRangesLodAlpha: [alpha],
        modelTextureData: new Uint16Array([1]), modelTextureDataAlpha: new Uint16Array(0),
        modelTextureDataLod: new Uint16Array([22]), modelTextureDataLodAlpha: new Uint16Array([33]),
        drawRangesLodPlanes: new Uint8Array([1]), drawRangesLodAlphaPlanes: new Uint8Array([2]) };
}

test("far compaction preserves byte offsets, instances, bounds and shared vertices", () => {
    const g = geometryGroup();
    const packed = compactFarGeometry(g.vertices, g.indices, [g.drawRangesLod, g.drawRangesLodAlpha]);
    assert.equal(packed.vertices.byteLength, 36, "unused full-detail vertices are dropped");
    assert.deepEqual([...packed.indices], [0, 1, 0, 2, 1, 0]);
    assert.deepEqual([...packed.vertices], [...new Array(12).fill(3), ...new Array(12).fill(4), ...new Array(12).fill(5)]);
    assert.equal(packed.ranges[0][0][0], 0);
    assert.equal(packed.ranges[1][0][0], 12);
    assert.equal(packed.ranges[0][0][2], 2);
    assert.deepEqual(packed.ranges[0][0].bounds, g.drawRangesLod[0].bounds);
    assert.deepEqual(packed.ranges[0][0].chunk, [8, 16]);
    assert.equal(g.drawRangesLod[0][0], 12, "source ranges stay unchanged");
});

test("far map drops pick meshes and authoritative actors and transfers aliased buffers once", () => {
    const data: any = { ...geometryGroup(), loc: geometryGroup(),
        locsAnimated: [{ mesh: new Uint8Array(1000) }], npcs: [{ id: 5 }],
        doorVertices: new Uint8Array(1000), doorIndices: new Int32Array(30), doorDrawRanges: [newDrawRange(0, 30)],
        doorDrawRangesPlanes: new Uint8Array([0]), doorModelTextureData: new Uint16Array(20),
        npcVertices: new Uint8Array(1000), npcIndices: new Int32Array(30),
        terrainPickTileOffsets: new Uint32Array(10), terrainPickVertices: new Float32Array(30), terrainPickPlanes: new Uint8Array(10),
        minimapBlobs: [], minimapIcons: [], worldMapIcons: [], heightMapTextureData: new Int16Array([3, 4]) };
    compactFarMap(data);
    assert.equal(data.farOnly, true);
    assert.equal(data.vertices.byteLength, 36);
    assert.equal(data.loc.vertices.byteLength, 36);
    assert.equal(data.drawRanges, data.drawRangesLod);
    assert.equal(data.modelTextureData, data.modelTextureDataLod);
    assert.equal(data.npcs.length + data.locsAnimated.length + data.terrainPickVertices.length + data.doorVertices.length, 0);
    const transfers = mapTransferables(data);
    assert.equal(new Set(transfers).size, transfers.length);
    const clone = structuredClone(data, { transfer: transfers });
    assert.equal(clone.vertices.byteLength, 36);
    assert.deepEqual([...clone.heightMapTextureData], [3, 4]);
});

function approachFixture() {
    let now = 0, player = { x: 3200, y: 3200, plane: 0 }, listener: PathSearchListener | undefined;
    let cancelled = 0, stopped = 0, resolves = 0;
    const walks: [number, number][] = [], statuses: string[] = [];
    const approach = new DistantApproach({
        enabled: () => true,
        backend: () => ({ ready: Promise.resolve(), map: () => undefined, dispose() {}, search: (_request, next) => { listener = next; return () => cancelled++; } }),
        position: () => player, walk: (x, y) => walks.push([x, y]), stop: () => stopped++, resolve: () => resolves++,
        status: text => statuses.push(text), now: () => now,
    });
    return { approach, walks, statuses, setPlayer: (x: number, y = 3200, plane = 0) => player = { x, y, plane },
        advance: (ms: number) => now += ms, get cancelled() { return cancelled; }, get stopped() { return stopped; }, get resolves() { return resolves; },
        finish(reached = true, transport = -1) { listener!.done({ start: 0, target: 0, reached, path: Array.from({ length: 101 }, (_, i) => ({ packed: packWorldPoint(3200 + i, 3200, 0), transport })), cost: 100, nodesChecked: 100, transportsChecked: 0, elapsedMillis: 1, terminationReason: "TARGET_REACHED" }); },
    };
}

test("approach advances only on authoritative movement, sends bounded segments, and cancels stalled or teleported routes", async () => {
    const f = approachFixture();
    await f.approach.begin({ spawn }); f.finish(); f.approach.tick(15);
    assert.deepEqual(f.walks, [[3224, 3200]]);
    f.advance(500); f.approach.tick(15);
    assert.equal(f.walks.length, 1, "no packet spam while the waypoint is pending");
    for (let x = 3204; x <= 3224; x += 4) { f.setPlayer(x); f.advance(500); f.approach.tick(15); }
    assert.deepEqual(f.walks[1], [3248, 3200]);
    f.advance(13000); f.approach.tick(15);
    assert.equal(f.approach.intent, undefined);
    assert.equal(f.stopped, 1);
    await f.approach.begin({ spawn }); f.finish(); f.setPlayer(3300); f.approach.tick(15);
    assert.equal(f.approach.intent, undefined, "a teleport cancels deferred interaction");
});

test("cancelled searches cannot revive intents, and unreachable or transport routes never walk", async () => {
    const f = approachFixture();
    await f.approach.begin({ spawn }); f.approach.cancel(); f.finish(); f.approach.tick(15);
    assert.equal(f.walks.length, 0); assert.equal(f.cancelled, 1);
    await f.approach.begin({ spawn }); f.finish(false); f.approach.tick(15); assert.equal(f.walks.length, 0);
    await f.approach.begin({ spawn }); f.finish(true, 2); f.approach.tick(15); assert.equal(f.walks.length, 0);
});

test("approach resolves only near the real update square and rate limits resolution requests", async () => {
    const f = approachFixture(); f.setPlayer(3288);
    await f.approach.begin({ spawn, action: "Talk-to", actionIndex: 0 });
    f.approach.tick(15); assert.equal(f.resolves, 1);
    f.advance(500); f.approach.tick(15); assert.equal(f.resolves, 1);
    f.advance(1100); f.approach.tick(15); assert.equal(f.resolves, 2);
    f.setPlayer(3288, 3200, 1); f.approach.tick(15);
    assert.equal(f.approach.intent, undefined);
});

test("sidebar lifecycle keeps proxies out of ECS, suppresses live actors, and clears late replies after disable", async () => {
    const { DistantWorldPlugin } = await import("../game/plugins/distantworld/DistantWorldPlugin");
    const { PluginInjector, CLIENT_TOKEN } = await import("../runelite/client/plugins/PluginInjector");
    const { ConfigManager } = await import("../runelite/client/config/ConfigManager");
    const { ClientToolbar } = await import("../runelite/client/ui/ClientToolbar");
    const { ClientState } = await import("../game/ClientState");
    const { PluginMessage, GameStateChanged } = await import("../runelite/api/events");
    const { GameState } = await import("../runelite/api/GameState");
    const savedWindow = globalThis.window;
    const savedKeyboardEvent = globalThis.KeyboardEvent;
    (globalThis as any).KeyboardEvent = class extends Event { key = ""; };
    (globalThis as any).window = new EventTarget();
    const wasReady = ClientState.scenePositionReady, wasInstance = ClientState.inInstance;
    ClientState.scenePositionReady = true; ClientState.inInstance = false;
    const canvas = new EventTarget(), manager = new ConfigManager(), toolbar = new ClientToolbar();
    let linked = false, deck = -1, playerX = 3200, overWidget = false, stoppedWalking = 0;
    let gpuDistance: number | undefined, hd = false;
    const routed: [number, number, boolean, boolean][] = [];
    const clickCrosses: unknown[][] = [];
    const spawnClickCross = (...args: unknown[]) => { clickCrosses.push(args); };
    const playerEcs = { getIndexForServerId: () => 0, getWorldViewId: () => deck, getX: () => playerX * 128, getY: () => 3200 * 128, getLevel: () => 0 };
    const npcEcs = { getEcsIdForServer: (index: number) => linked && index === 42 ? 0 : undefined, isActive: () => linked, isLinked: () => linked,
        getServerLinkedEcsIds: () => linked ? [0] : [], getWorldViewId: () => -1, getNpcTypeId: () => 1,
        getWorldX: () => 3300 * 128, getWorldY: () => 3200 * 128, getLevel: () => 0 };
    const type = { id: 1, name: 'Guard', combatLevel: 22, size: 1, getIdleSeqId: () => -1, getWalkSeqId: () => -1, actions: ['Talk-to'] };
    const client: any = { playerEcs, npcEcs, controlledPlayerServerId: 1, isLoggedIn: () => true,
        clientPlugins: { gpuSettings: () => gpuDistance === undefined ? undefined : { drawDistance: gpuDistance }, hdEnabled: () => hd },
        npcTypeLoader: { load: () => type }, renderer: { canvas, spawnClickCross, toGLClickXY: () => ({sx:100,sy:95}), stats: { geometryGpuBytes: 0 },
            resolveEffectiveRenderDistanceTiles: () => gpuDistance ?? 120,
            mapManager: { loadingMapIds: new Set(), visibleMaps: [{ mapX: 51, mapY: 50 }] } },
        inputManager: { getInteractionMouseX: () => 100, getInteractionMouseY: () => 95 },
        sceneGeometry: { tileHeight: () => 0, npcHeight: () => 128, worldToScreen: (_x: number, h: number) => [100, 100 + h * 10] },
        runMode: true, stopPlayerWalking() { stoppedWalking++; }, isPointOverWidget: () => overWidget,
        routePlayerTo: (x: number, y: number, running: boolean, immediate: boolean) => routed.push([x, y, running, immediate]) };
    const injector = new PluginInjector(manager).provide(CLIENT_TOKEN, client).provide(ConfigManager, manager).provide(ClientToolbar, toolbar);
    const plugin = injector.runWith(() => new DistantWorldPlugin());
    try {
        assert.equal(plugin.isEnabled(), false);
        await plugin.start();
        assert.equal(plugin.config.deferredActions(), false);
        plugin.setConfig('npcLimit', 500);
        assert.equal(plugin.getState().previewLimit, 500, 'the configured count applies immediately rather than growing from a hidden 96-NPC cap');
        assert.equal(toolbar.getNavigations().length, 1);
        plugin.onClientTick();
        const request = (plugin as any).catalogRequest;
        plugin.onPluginMessage(new PluginMessage('distant-world', catalog({ request })));
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 1);
        assert.equal(npcEcs.getServerLinkedEcsIds().length, 0, 'previews never create an entity');
        const standaloneDistance = plugin.scenerySettings()!.drawDistance;
        gpuDistance = 60;
        assert.equal(plugin.scenerySettings(), undefined);
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 0, 'NPC selection follows GPU render distance rather than the saved distant scenery distance');
        gpuDistance = 140;
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 1);
        client.renderer.stats.geometryGpuBytes = 1024 * 1048576;
        for (const now of [1000, 2000, 3000]) (plugin as any).budget(now);
        assert.equal((plugin as any).effective, standaloneDistance, 'graphics-plugin scenery budgets are not adjusted by Distant World');
        gpuDistance = undefined; hd = true;
        assert.equal(plugin.scenerySettings(), undefined);
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 1, '117 HD retains distant NPC previews inside its horizon');
        (plugin as any).publish();
        assert.equal(plugin.getState().sceneryOwner, '117 HD');
        assert.equal(plugin.getState().distance, 120);
        hd = false; client.renderer.stats.geometryGpuBytes = 0;
        assert.equal(plugin.scenerySettings()!.drawDistance, standaloneDistance);
        const baseMenu = [{ option: 'Walk here', opcode: MenuOpcode.WalkHere }, { option: 'Cancel', opcode: MenuOpcode.Cancel }];
        const menuContext = { surface: 'world', menu: true } as const;
        assert.equal(plugin.transformMenuEntries(baseMenu, menuContext), baseMenu, 'previews are passive by default');
        plugin.setConfig('deferredActions', true);
        (plugin as any).buildActors(plugin.player(), performance.now());
        const menu = plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true });
        const preview = menu[1];
        assert.deepEqual(menu.map(row => row.option), ['Walk here', 'Talk-to', 'Examine', 'Cancel']);
        assert.match(preview.target!, /^<col=ffff00>Guard<col=[a-f0-9]+>  \(level-22\)<\/col> \(distant preview\)$/);
        client.menuActiveSimpleEntries = menu;
        assert.equal(minMenuSnapshot(client).option, 'Walk here');
        assert.equal(chooseDefaultMenuEntry(menu, { hasSelectedItem: true, hasSelectedSpell: true }), baseMenu[0]);
        assert.equal(preview.npcServerId, undefined);
        assert.equal(preview.cosmeticNpcKey, spawn.key, 'native NPC menus retain a separate identity for cosmetic highlighting');
        assert.equal(preview.opcode, MenuOpcode.Custom, 'NPC appearance must not dispatch an NPC packet for a preview');
        assert.equal(preview.identifier, undefined);
        assert.equal(preview.actionIndex, undefined, 'preview slots cannot be chosen as native shift-click actions');
        const banker = { option: 'Talk-to', target: 'Banker', opcode: MenuOpcode.NpcFirstOption, npcServerId: 77 };
        const door = { option: 'Open', target: 'Door', opcode: MenuOpcode.GameObjectFirstOption };
        const doorExamine = { option: 'Examine', target: 'Door', opcode: MenuOpcode.ExamineObject };
        const withRealTargets = plugin.transformMenuEntries([banker, door, baseMenu[0], doorExamine, baseMenu[1]], menuContext);
        assert.deepEqual(withRealTargets.slice(0, 4), [banker, door, baseMenu[0], doorExamine]);
        assert.equal(chooseDefaultMenuEntry(withRealTargets), banker);
        const cancelOnly = [baseMenu[1]];
        assert.equal(plugin.transformMenuEntries(cancelOnly, menuContext), cancelOnly);
        type.actions = ['Talk-to', 'Attack', 'Trade'];
        const previousAttackOption = ClientState.npcAttackOption;
        const previousCombatLevel = ClientState.localPlayerCombatLevel;
        try {
            ClientState.npcAttackOption = 2;
            assert.deepEqual(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true }).map(row => row.option),
                ['Walk here', 'Attack', 'Talk-to', 'Trade', 'Examine', 'Cancel']);
            ClientState.npcAttackOption = 1;
            assert.deepEqual(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true }).map(row => row.option),
                ['Walk here', 'Talk-to', 'Trade', 'Attack', 'Examine', 'Cancel']);
            ClientState.npcAttackOption = 3;
            assert.equal(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true }).some(row => row.option === 'Attack'), false);
            ClientState.npcAttackOption = 0; ClientState.localPlayerCombatLevel = 3;
            assert.equal(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true })[1].option, 'Talk-to');
            ClientState.localPlayerCombatLevel = 99;
            assert.equal(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true })[1].option, 'Attack');
            client.minimenuBlockModes = [];
            client.minimenuBlockModes[2] = 0;
            assert.deepEqual(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true }).map(row => row.option), ['Walk here', 'Examine', 'Cancel']);
            client.minimenuBlockModes[9] = 0;
            assert.deepEqual(plugin.transformMenuEntries(baseMenu, { surface: 'world', menu: true }), baseMenu);
        } finally {
            ClientState.npcAttackOption = previousAttackOption; ClientState.localPlayerCombatLevel = previousCombatLevel;
            type.actions = ['Talk-to']; client.minimenuBlockModes = [];
        }

        const selected: any[] = [];
        const begin = plugin.approach.begin;
        plugin.approach.begin = async intent => { selected.push(intent); };
        setMenuTransform((entries, context) => plugin.transformMenuEntries(entries, context));
        try {
            const state = new MenuState();
            const rows = worldEntriesToSimple([{ option: 'Walk here', targetId: -1, targetType: MenuTargetType.NONE, targetName: '', targetLevel: -1 }], { menuState: state });
            client.menuActiveSimpleEntries = rows;
            const talk = rows.find(row => row.option === 'Talk-to')!;
            assert.equal(minMenuSnapshot(client).option, 'Walk here', 'native mouseover scripts see the regular default action');
            assert.equal(chooseDefaultMenuEntry(rows), rows[0]);
            assert.equal(talk.cosmeticNpcKey, spawn.key, 'menu registration retains the preview identity');
            assert.equal(clickCrosses.length, 0, 'hovering does not animate a click cross');
            const actor = plugin.cosmeticNpcs()[0];
            const clickedTile = {tileX:Math.floor(actor.x),tileY:Math.floor(actor.y),plane:actor.plane};
            state.invoke(talk.menuStateIndex!, 102, 96, {source:'primary'});
            assert.deepEqual(selected, [], 'a primary click cannot start an automated approach');
            assert.deepEqual(clickCrosses, []);
            state.invoke(talk.menuStateIndex!, 103, 97, {source:'menu'});
            assert.deepEqual(clickCrosses, [[clickedTile,{sx:103,sy:97},'red']],
                'selecting a preview option immediately uses the native targeted cross');
            // WebGPU exposes the same native feedback through its interaction host.
            (client.renderer as any).interactionHost = {spawnClickCross};
            state.invoke(rows.find(row => row.option === 'Examine')!.menuStateIndex!, 125, 115, {source:'menu'});
            assert.deepEqual(clickCrosses[1], [clickedTile,{sx:125,sy:115},'red'],
                'context-menu actions also animate through the WebGPU interaction host');
            assert.deepEqual(selected, [{ spawn: plugin.world.spawns[0], action: 'Talk-to', actionIndex: 0 }, { spawn: plugin.world.spawns[0], examine: true }],
                'native-looking rows must invoke deferred intents through the real menu-state path');
            plugin.setConfig('deferredActions', false);
            state.invoke(talk.menuStateIndex!, 110, 105, {source:'menu'});
            assert.equal(clickCrosses.length, 2, 'stale preview rows cannot act after disabling the switch');
            delete (client.renderer as any).interactionHost;
            assert.equal(selected.length, 2);
            plugin.setConfig('deferredActions', true);
        } finally { setMenuTransform(undefined); plugin.approach.begin = begin; delete (client.renderer as any).interactionHost; }
        (plugin as any).backend = { ready: Promise.resolve(), dispose() {}, search: (_request: unknown, listener: PathSearchListener) => {
            listener.done({ start: 0, target: 0, reached: true, path: Array.from({ length: 101 }, (_, i) => ({ packed: packWorldPoint(3200 + i, 3200, 0), transport: -1 })),
                cost: 100, nodesChecked: 100, transportsChecked: 0, elapsedMillis: 1, terminationReason: 'TARGET_REACHED' });
            return () => {};
        } };
        const interaction = { spawn, action: 'Talk-to', actionIndex: 0 };
        await plugin.approach.begin(interaction);
        plugin.approach.tick(15);
        assert.deepEqual(routed[0], [3224, 3200, true, true], 'clicking a distant preview honors the enabled run toggle');
        const stopsBeforeToggle = stoppedWalking;
        const notifyPlugins = (action: any) => plugin.onMenuOptionClicked(action);
        menuClickListeners.add(notifyPlugins);
        const toggleRun = (group: number, child: number, running: boolean, opcode = MenuOpcode.CC_OP) => {
            overWidget = true;
            canvas.dispatchEvent(new Event('pointerdown'));
            assert.equal(plugin.approach.intent, interaction, 'pressing a native run widget must preserve the approach');
            dispatchMenuAction({param0:-1,param1:(group<<16)|child,opcode,identifier:1,itemId:-1,
                option:'Toggle Run',target:'',screenX:100,screenY:95}, () => { client.runMode = running; });
            assert.equal(plugin.approach.intent, interaction, 'the native run menu operation must preserve the deferred interaction');
            assert.equal(stoppedWalking, stopsBeforeToggle, 'toggling run must not send an interaction-stop request');
        };
        try {
            toggleRun(ORBS, OrbComponent.RUNBUTTON.orbs, false);
            playerX = 3212; plugin.approach.tick(15);
            playerX = 3224; plugin.approach.tick(15);
            assert.deepEqual(routed[1], [3248, 3200, false, true], 'later route segments pick up run being disabled');
            toggleRun(ORBS_NOMAP, OrbComponent.RUNBUTTON.nomap, true, MenuOpcode.CC_OP_LowPriority);
            playerX = 3236; plugin.approach.tick(15);
            playerX = 3248; plugin.approach.tick(15);
            assert.deepEqual(routed[2], [3272, 3200, true, true], 'later route segments pick up run being enabled again');
            overWidget = false;
            canvas.dispatchEvent(new Event('pointerdown'));
            assert.equal(plugin.approach.intent, undefined, 'an actual manual world click still cancels the deferred route');
            assert.equal(stoppedWalking, stopsBeforeToggle + 1);
            await plugin.approach.begin(interaction);
            overWidget = true;
            canvas.dispatchEvent(new Event('pointerdown'));
            assert.equal(plugin.approach.intent, interaction, 'a widget press waits for its operation before cancelling');
            const stopsBeforeOtherAction = stoppedWalking;
            dispatchMenuAction({param0:-1,param1:(ORBS<<16)|OrbComponent.RUNBUTTON.orbs,opcode:MenuOpcode.CC_OP,
                identifier:1,itemId:-1,option:'Open',target:'Bank',screenX:100,screenY:95}, () => {});
            assert.equal(plugin.approach.intent, undefined, 'unrelated widget operations still cancel the deferred interaction');
            assert.equal(stoppedWalking, stopsBeforeOtherAction + 1);
        } finally { menuClickListeners.delete(notifyPlugins); overWidget = false; }
        playerX = 3200;
        await plugin.approach.begin(interaction);
        plugin.approach.tick(15);
        const walksBeforeDisable = routed.length, stopsBeforeDisable = stoppedWalking;
        plugin.setConfig('deferredActions', false);
        assert.equal(stoppedWalking, stopsBeforeDisable + 1, 'disabling the option stops the active walk');
        await plugin.approach.begin(interaction);
        plugin.approach.tick(15);
        assert.equal(plugin.approach.intent, undefined);
        assert.equal(routed.length, walksBeforeDisable, 'disabled approaches send no more walks');
        plugin.setConfig('deferredActions', true);
        linked = true;
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 0, 'a real walking NPC suppresses a preview immediately');
        plugin.world.accept(catalog({ request, spawns: [{ ...spawn, radius: 10 }, { ...spawn, key: 'neighbor', x: spawn.x + 2, radius: 10 }] }), request);
        (plugin as any).buildActors(plugin.player(), performance.now());
        assert.equal(plugin.cosmeticNpcs().length, 1, 'one real NPC must not hide all neighboring spawns of the same type');
        plugin.world.accept(catalog({ request }), request);
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOADING));
        assert.equal(plugin.world.spawns.length, 1, 'scene rebases do not reset walking intents');
        // A server reply may arrive after the chosen option changes or after a newer request.
        const dispatched: any[] = [];
        const capture = (action: any) => { dispatched.push(action); return true; };
        menuClickListeners.add(capture);
        try {
            playerX = 3290;
            const intent = { spawn, action: "Talk-to", actionIndex: 0 };
            plugin.approach.intent = intent; (plugin as any).pendingResolve = { request: 91, intent };
            const resolved = (request = 91, typeId = 1) => new PluginMessage('distant-world', { type: 'resolved', request, key: spawn.key, index: 42, typeId });
            plugin.setConfig('deferredActions', false);
            plugin.onPluginMessage(resolved());
            assert.equal(dispatched.length, 0, 'disabling the option blocks a pending final interaction');
            plugin.setConfig('deferredActions', true);
            plugin.approach.intent = { ...intent };
            plugin.onPluginMessage(resolved());
            assert.equal(dispatched.length, 0, 'an old reply cannot act on a replacement intent for the same spawn');
            plugin.approach.intent = intent; (plugin as any).pendingResolve = { request: 91, intent };
            plugin.onPluginMessage(resolved(90));
            assert.equal(plugin.approach.intent, intent);
            plugin.onPluginMessage(resolved(91, 2));
            assert.equal(dispatched.length, 0, 'a changed NPC type is not the intended real actor');
            type.actions[0] = "Trade"; plugin.onPluginMessage(resolved());
            assert.equal(dispatched.length, 0, 'a changed action is cancelled');
            assert.equal(plugin.approach.intent, undefined);
            type.actions[0] = "Talk-to"; plugin.approach.intent = intent;
            plugin.onPluginMessage(resolved());
            assert.equal(dispatched.length, 1);
            assert.equal(dispatched[0].opcode, 9); assert.equal(dispatched[0].identifier, 42);
            assert.equal(plugin.approach.intent, undefined, 'the deferred action dispatches only once');
            const examineIntent = { spawn, examine: true };
            plugin.approach.intent = examineIntent; (plugin as any).pendingResolve = { request: 91, intent: examineIntent };
            plugin.onPluginMessage(resolved());
            assert.equal(dispatched.length, 2);
            assert.equal(dispatched[1].opcode, MenuOpcode.ExamineNpc); assert.equal(dispatched[1].identifier, 42);
            assert.equal(plugin.approach.intent, undefined, 'Examine resolves a real NPC before dispatching its native opcode');
        } finally { menuClickListeners.delete(capture); playerX = 3200; }
        plugin.onPluginMessage(new PluginMessage('distant-world', { type: 'unavailable' }));
        assert.match(plugin.getState().status, /has not loaded/);
        assert.equal(plugin.cosmeticNpcs().length, 0);
        ClientState.inInstance = true;
        assert.equal(plugin.scenerySettings(), undefined);
        assert.equal(plugin.cosmeticNpcs().length, 0);
        ClientState.inInstance = false; deck = 2;
        assert.equal(plugin.scenerySettings(), undefined);
        deck = -1;
        await plugin.stop();
        assert.equal(toolbar.getNavigations().length, 0);
        plugin.onPluginMessage(new PluginMessage('distant-world', catalog({ request })));
        assert.equal(plugin.world.spawns.length, 0);
        assert.equal(plugin.scenerySettings(), undefined);
    } finally {
        await plugin.stop(); ClientState.scenePositionReady = wasReady; ClientState.inInstance = wasInstance;
        (globalThis as any).window = savedWindow;
        if (savedKeyboardEvent === undefined) delete (globalThis as any).KeyboardEvent;
        else (globalThis as any).KeyboardEvent = savedKeyboardEvent;
    }
});

test("paged spawn catalogs publish atomically, out of order, and discard obsolete partial requests", () => {
    const state = new DistantWorldState();
    state.accept(catalog({ revision: 1 }), 7);
    const page = (part: number, request = 8, revision = 2) =>
        catalog({ request, revision, part, parts: 2, spawns: [{ ...spawn, key: `page:${part}`, x: 3300 + part }] });
    assert.equal(state.accept(page(1), 8), false);
    assert.equal(state.spawns[0].key, spawn.key, 'a partial catalog does not replace the visible one');
    assert.equal(state.revision, 1, 'only a completed catalog can be acknowledged');
    assert.equal(state.accept(page(0, 8, 3), 8), false, 'pages from a different revision cannot be mixed');
    assert.equal(state.accept(page(1), 8), false, 'duplicate pages are ignored');
    assert.equal(state.accept(page(0), 8), true);
    assert.equal(state.revision, 2);
    assert.deepEqual(state.spawns.map(s => s.key), ['page:0', 'page:1']);
    assert.equal(state.accept(page(0, 9), 9), false);
    assert.equal(state.accept(page(1, 9), 10), false, 'old request cannot finish after the next request');
    assert.equal(state.accept(page(1, 10), 10), false);
    state.clear();
    assert.equal(state.accept(page(0, 10), 10), false, 'clear also drops pending assemblies');
    assert.equal(state.spawns.length, 0);
});

test("camera-visible previews take priority over closer off-screen spawns", () => {
    const state = new DistantWorldState();
    const offscreen = { ...spawn, key: 'offscreen', x: 3220 };
    assert.equal(state.accept(catalog({ spawns: [offscreen, spawn] }), 7), true);
    assert.deepEqual(state.visible({ x: 3200, y: 3200, plane: 0 }, 384, 1, () => false,
        s => s.key === spawn.key ? 0 : 1).map(s => s.key), [spawn.key]);
});

test("an expired first catalog can finish across client ticks without its partial pages being erased", async () => {
    const { DistantWorldPlugin } = await import('../game/plugins/distantworld/DistantWorldPlugin');
    const plugin: any = Object.create(DistantWorldPlugin.prototype), world = new DistantWorldState();
    const page = (part: number) => catalog({ request: 1, part, parts: 2, spawns: [{ ...spawn, key: String(part) }] });
    Object.assign(plugin, { world, isStarted: () => true, bindCanvas() {}, player: () => ({ x: 3200, y: 3200, plane: 0 }),
        context: '0:50:50', nextTick: 0, nextCatalog: Infinity, nextBudget: Infinity, catalogAt: -10000,
        buildActors() {}, approach: { tick() {} } });
    assert.equal(world.accept(page(0), 1), false);
    plugin.onClientTick();
    assert.equal(world.accept(page(1), 1), true);
    assert.equal(world.spawns.length, 2);
});

test("links-only refreshes update the live handoff and retain complete spawn rows", () => {
    const state = new DistantWorldState();
    const response = { type: 'links', request: 8, revision: 1, viewDistance: 20, links: [{ key: spawn.key, index: 42 }] };
    assert.equal(state.accept(response, 8), false, 'links need a complete catalog');
    assert.equal(state.accept(catalog({ revision: 1, truncated: true }), 7), true);
    const spawns = state.spawns;
    assert.equal(state.accept({ ...response, revision: 2 }, 8), false);
    assert.equal(state.accept({ ...response, links: [{ key: 'obsolete', index: 42 }] }, 8), false);
    assert.equal(state.accept(response, 9), false, 'links from a superseded request are ignored');
    assert.equal(state.accept(response, 8), true);
    assert.equal(state.spawns, spawns);
    assert.equal(state.truncated, true);
    assert.equal(state.links.get(spawn.key), 42);
    assert.equal(state.viewDistance, 20);
    assert.equal(state.accept({ ...response, request: 9, links: [] }, 9), true);
    assert.equal(state.links.size, 0, 'unlinked NPCs are removed at the next refresh');
    state.clear();
    assert.equal(state.revision, undefined);
    assert.equal(state.accept(response, 8), false);
});

test("cosmetic wandering stays in its radius, respects walls and interpolates without simulating skipped time", () => {
    const motion = new DistantNpcMotion(), replay = new DistantNpcMotion();
    const walker = { ...spawn, radius: 5 };
    const actor = cosmeticActor(walker, 1, 0, 0), copy = { ...actor };
    const flags = (_plane: number, x: number) => x === 3301 ? 0x100 : 0;
    const positions = new Set<string>();
    let interpolated = false;
    for (let now = 0; now < 120000; now += 100) {
        motion.advance(walker, 1, true, now, flags); replay.advance(walker, 1, true, now, flags);
        motion.apply(actor, now + 50); replay.apply(copy, now + 50);
        assert.deepEqual(actor, copy, 'each spawn has deterministic, independent motion');
        assert.ok(Math.abs(actor.x - 3300.5) <= 5 && Math.abs(actor.y - 3200.5) <= 5);
        assert.ok(actor.x <= 3300.5, 'the wall east of the spawn cannot be crossed');
        positions.add(`${actor.x}:${actor.y}`);
        interpolated ||= !Number.isInteger(actor.x - .5) || !Number.isInteger(actor.y - .5);
    }
    assert.ok(positions.size > 10, 'a walking spawn must move around its area');
    assert.ok(interpolated, 'render-time positions must interpolate between simulation steps');
    const before = { ...actor };
    motion.advance(walker, 1, true, 7200000, flags); motion.apply(actor, 7200000);
    assert.ok(Math.max(Math.abs(actor.x - before.x), Math.abs(actor.y - before.y)) <= 1, 'a background tab must not catch up millions of steps');
    assert.equal(canDistantNpcStep(() => undefined, 0, 3300, 3200, 1, 0, 1), false, 'unloaded collision holds position');
    assert.equal(canDistantNpcStep((_p, x, y) => x === 3301 && y === 3200 ? 0x100 : 0, 0, 3300, 3200, 1, 1, 1), false, 'cannot cut a diagonal corner');
    assert.equal(canDistantNpcStep((_p, x) => x === 3302 ? 0x100 : 0, 0, 3300, 3200, 1, 0, 2), false, 'the whole large-NPC footprint must fit');
});

test("all real banker spawns stay fixed and non-walking types never wander", () => {
    const bankers = require('../../server/data/definitions/npc-spawns.json').filter((s: any) => s.name === 'Banker');
    assert.ok(bankers.length > 100);
    const motion = new DistantNpcMotion();
    for (const row of bankers) {
        assert.equal(row.wanderRadius, 0);
        const banker = { ...spawn, key: `${row.id}:${row.x}:${row.y}:${row.level}`, typeId: row.id, x: row.x, y: row.y, plane: row.level,
            name: row.name, radius: row.wanderRadius, rotation: 1024 };
        const actor = cosmeticActor(banker, 1, 0, 0);
        for (let now = 0; now <= 60000; now += 600) {
            motion.advance(banker, 1, true, now, () => 0); motion.apply(actor, now);
            assert.equal(actor.x, row.x + .5); assert.equal(actor.y, row.y + .5); assert.equal(actor.rotation, 1024);
        }
    }
    const actor = cosmeticActor(spawn, 1, 0, 0);
    for (let now = 0; now <= 60000; now += 600) {
        motion.advance({ ...spawn, radius: 5 }, 1, false, now, () => 0); motion.apply(actor, now);
        assert.equal(actor.x, spawn.x + .5); assert.equal(actor.y, spawn.y + .5);
    }
    motion.retain([]);
    assert.equal((motion as any).states.size, 0, 'catalog eviction releases cosmetic walk state');
});

test("terrain memory pressure reduces scenery before removing NPC coverage", async () => {
    const { DistantWorldPlugin } = await import('../game/plugins/distantworld/DistantWorldPlugin');
    const plugin: any = Object.create(DistantWorldPlugin.prototype);
    const stats = { geometryGpuBytes: 200 * 1048576, frameTimeJs: 2 };
    Object.assign(plugin, { config: { distance: () => 384, memoryBudget: () => 64, npcLimit: () => 500 },
        client: { renderer: { stats, mapManager: { loadingMapIds: new Set() } } }, effective: 384, previewLimit: 500,
        pressure: 0, npcPressure: 0, lastPreviewGrowth: 0, lastGrowth: 0, poseInterval: 100 });
    for (const now of [0, 1000, 2000]) plugin.budget(now);
    assert.equal(plugin.effective, 320); assert.equal(plugin.previewLimit, 500);
    stats.frameTimeJs = 35;
    for (const now of [3000, 4000, 5000]) plugin.budget(now);
    assert.equal(plugin.previewLimit, 250, 'sustained CPU frame pressure still bounds NPC work');
});

test("real Varrock and Barbarian Village catalogs keep all NPC types and produce guard/barbarian geometry", async () => {
    const { CacheSystem } = await import('../rs/cache/CacheSystem');
    const { getCacheLoaderFactory } = await import('../rs/cache/loader/CacheLoaderFactory');
    const { VarManager } = await import('../rs/config/vartype/VarManager');
    const { loadCache, loadCacheInfos, loadCacheList } = await import('../scripts/cache/load-util');
    const { DynamicNpcAnimLoader } = await import('../render/npc/DynamicNpcAnimLoader');
    const { SceneBuilder, LocLoadType } = await import('../rs/scene/SceneBuilder');
    const { LocModelLoader } = await import('../rs/config/loctype/LocModelLoader');
    const { DistantWorldPlugin } = await import('../game/plugins/distantworld/DistantWorldPlugin');
    const server = require('../../server/plugins/world/DistantWorld.plugin.js');
    const rows: { id: number; x: number; y: number; level: number; wanderRadius?: number }[] = require('../../server/data/definitions/npc-spawns.json');
    const cache = loadCache(loadCacheList(loadCacheInfos()).latest);
    const factory = getCacheLoaderFactory(cache.info, CacheSystem.fromFiles(cache.info, cache.files));
    const types = factory.getNpcTypeLoader(), vars = new VarManager(factory.getVarBitTypeLoader());
    const seqs = factory.getSeqTypeLoader();
    const locs = factory.getLocTypeLoader(), textures = factory.getTextureLoader();
    const models = new NpcModelLoader(types, factory.getModelLoader(), textures, seqs, factory.getSeqFrameLoader(),
        factory.getSkeletalSeqLoader(), vars, 2);
    for (const id of [MAN, BLACK_DEMON, MAN, GREEN_DRAGON]) {
        assert.ok(models.getModel(types.load(id), -1, -1), `NPC ${id} produces a cacheable model`);
    }
    assert.deepEqual([...models.modelCache.keys()], [MAN, GREEN_DRAGON], 'preview model cache evicts the least recently used model');
    const locModels = new LocModelLoader(locs, factory.getModelLoader(), textures, seqs, factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const builder = new SceneBuilder(cache.info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(), factory.getOverlayTypeLoader(), locs, locModels, cache.xteas);
    const maps = new Map([48, 49].map(mapX => {
        const mapY = 53, border = 6;
        const scene = builder.buildScene(mapX * 64 - border, mapY * 64 - border, 76, 76, false, LocLoadType.NO_MODELS);
        return [(mapX << 8) | mapY, { mapX, mapY, border, collisionMaps: scene.collisionMaps }];
    }));
    const renderer = { mapManager: { mapSquares: maps, visibleMaps: [...maps.values()] }, getCollisionFlagAt: (plane: number, x: number, y: number) => {
        const map = maps.get(((x >> 6) << 8) | (y >> 6));
        return map?.collisionMaps[plane]?.getFlag((x & 63) + map.border, (y & 63) + map.border) ?? 0x100;
    } };
    const geometry = new DynamicNpcAnimLoader(types, factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader(), vars);
    geometry.setTextureIdIndexMap(new Map());
    const point = (x: number, y: number, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });
    const definitions = rows.map(s => ({ getPosition: () => point(s.x, s.y, s.level), getId: () => s.id, getRadius: () => s.wanderRadius ?? 5 }));
    for (const origin of [{ x: 3130, y: 3425, plane: 0 }, { x: 3140, y: 3420, plane: 0 }]) {
        const pages: any[] = [];
        const player = { getLocation: () => point(origin.x, origin.y), getPrivateArea: () => null, getArea: () => null,
            getNpcViewDistance: () => 15, getPacketSender: () => vars, getLocalNpcs: () => [], getSession: () => ({ sendClientPacket: (p: any) => pages.push(p) }) };
        const core = { NpcSpawnDefinition: { all: () => definitions }, CacheDefinitions: { getNpc: (id: number) => types.load(id),
            resolveNpc: (id: number) => types.load(id).transform(vars, types) }, World: { getNpcs: () => new Map() }, encodePluginMessage: (_c: string, d: any) => d };
        server._test.receive({ core }, { channel: 'distant-world', player, data: { type: 'catalog', request: 1, radius: 128 } });
        const world = new DistantWorldState();
        for (const page of pages) world.accept(page, 1);
        assert.ok(world.spawns.length > 384, 'catalog pages must preserve the local population beyond the old cap');
        let poseUpdates = 0;
        const plugin: any = Object.create(DistantWorldPlugin.prototype);
        Object.assign(plugin, { world, catalogAt: 0, effective: 128, previewLimit: 500, poseInterval: 100, poses: new Map(), motion: new DistantNpcMotion(), poseCursor: 0,
            config: { npcs: () => true, npcLimit: () => 500 }, client: { npcEcs: { getEcsIdForServer: () => undefined, getServerLinkedEcsIds: () => [] },
                npcTypeLoader: types, basTypeLoader: factory.getBasTypeLoader(), seqTypeLoader: { load: (id: number) => { poseUpdates++; return seqs.load(id); } }, varManager: vars, renderer } });
        const targets = world.spawns.filter(s => /^(Guard|Barbarian)$/.test(s.name) && s.x >= 3065 && s.x <= 3190 && s.y >= 3400 && s.y <= 3440);
        assert.ok(targets.some(s => s.name === 'Guard') && targets.some(s => s.name === 'Barbarian'));
        const moved = new Set<string>();
        for (let tick = 0; tick < 600; tick++) {
            poseUpdates = 0;
            plugin.catalogAt = tick * 100;
            plugin.buildActors(origin, tick * 100);
            assert.ok(poseUpdates <= 64, 'pose updates remain bounded even as type coverage increases');
            assert.ok(targets.every(s => plugin.actors.some((a: any) => a.key === s.key)), `missing guards/barbarians at ${origin.x},${origin.y}`);
            assert.ok(new Set(plugin.actors.map((a: any) => a.typeId)).size > 16, 'animation budgeting must not remove NPC types');
            for (const s of targets) {
                const actor = plugin.actors.find((a: any) => a.key === s.key);
                if (actor.x !== s.x + .5 || actor.y !== s.y + .5) moved.add(s.name);
            }
        }
        assert.ok(moved.has('Guard') && moved.has('Barbarian'), 'both real populations must wander using their actual map collision');
        for (const id of new Set(targets.map(s => s.typeId))) {
            const actor = plugin.actors.find((a: any) => a.typeId === id);
            const mesh = geometry.getFrameGeometry(id, actor.seqId, actor.frameId);
            assert.ok(mesh && mesh.opaqueIndices.length + mesh.alphaIndices.length > 0, `real cache model ${id} must render`);
        }
    }
});
