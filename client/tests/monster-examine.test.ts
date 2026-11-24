import assert from 'node:assert/strict';
import { menuAction, setNpcExamineIdResolver } from '../ui/menu/MenuAction';
import { MenuOpcode } from '../ui/menu/MenuState';
import { flushPackets, setPacketSocket } from '../network/packet';
import { state } from '../network/serverConnection/state';
import { decodeClientPackets } from '../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol';
import { CustomInterfaceRuntime, filterRows } from '../widgets/custom/CustomInterfaceRuntime';
import { setCustomInterface } from '../common/gamemode/GamemodeContentStore';
import { ConfigManager } from '@runelite/client/config/ConfigManager';
import { defaultConfigStorage } from '@runelite/client/config/ConfigStorage';
import { EventBus } from '@runelite/client/eventbus/EventBus';
import { CLIENT_TOKEN } from '@runelite/client/plugins/PluginInjector';
import { PluginManager } from '@runelite/client/plugins/PluginManager';
import { MonsterExaminePlugin } from '../game/plugins/monsterexamine/MonsterExaminePlugin';
import { ClientPluginManager } from '../game/plugins/ClientPluginManager';
import { menuClickListeners } from '../ui/menu/menuEvents';
import { WidgetManager } from '../widgets/WidgetManager';
import { CacheSystem } from '../rs/cache/CacheSystem';
import { BitmapFont } from '../rs/font/BitmapFont';
import { getCacheLoaderFactory } from '../rs/cache/loader/CacheLoaderFactory';
import { loadCache, loadCacheInfos, loadCacheList } from '../scripts/cache/load-util';
import { ClientScriptLoader } from '../game/cs2/ClientScriptLoader';
import { VarManager } from '../rs/config/vartype/VarManager';
import { Cs2Vm } from '../rs/cs2/Cs2Vm';
import { WidgetActionRouter } from '../game/widgets/WidgetActionRouter';
import { processWidgetClickInput } from '../game/widgets/input/widgetClickInput';
import { createPrimaryWidgetActionResolver } from '../game/widgets/input/widgetPrimaryAction';
import { tooltipManager } from '@runelite/client/ui/overlay/tooltip/TooltipManager';
import { collectInputWidgetsAtPoint } from '../game/widgets/interaction/widgetClickProbe';
import { layoutCards } from '../widgets/custom/cardLayout';
import { deriveMenuEntriesForWidget } from '../widgets/menu/utils';
const { DEFINITION, GROUP_ID, C, DATA_COMPONENTS, ROW_HEIGHT, SLOTS, uid } = require('../../server/plugins/interface/monsterexamine/Layout.MonsterExamine');
const { buildDrops, groupRows } = require('../../server/plugins/interface/monsterexamine/Drops.MonsterExamine');
const { createWidgetGroup } = require('../../server/plugins/interface/widgetGroup');
const { MAINMODAL_BACKGROUND_SCRIPT, EXPANDED_MODAL_SIZE } = require('../../server/plugins/interface/MonsterExamine.entry')._test;

function testNativeModalSizing(): void {
    const info = loadCacheList(loadCacheInfos()).latest;
    const cache = CacheSystem.fromFiles(info, loadCache(info).files);
    const smallFont = BitmapFont.tryLoad(cache, 494)!;
    assert.ok(smallFont.measure('1-30 (8.05 avg)') <= DEFINITION.list.cards.minWidth - 16,
        'the Guard range and weighted average fit together at the minimum card width using the real cache font');
    const loaders = getCacheLoaderFactory(info, cache);
    const scripts = new ClientScriptLoader({ getCacheSystem: () => cache });
    const vars = new VarManager(loaders.getVarBitTypeLoader());
    vars.setVarbit(4606, 2); // displaymode: Resizable modern, as the active gameframe uses.
    const manager = new WidgetManager(cache);
    (manager as any).osrsClient = { camera: { viewportWidth: 1280, viewportHeight: 900,
        computeViewportMetricsForSize: (width: number, height: number) => ({ viewportWidth: width, viewportHeight: height }) },
        renderer: { canvas: { width: 1280, height: 900 } } };
    const vm = new Cs2Vm({ widgetManager: manager, varManager: vars,
        loadScript: (id: number) => scripts.load(id), enumTypeLoader: loaders.getEnumTypeLoader(),
        setViewportFovValues() {}, setViewportZoomRange() {}, setViewportClampFov() {},
        windowMode: 2, canvasWidth: 1280, canvasHeight: 900 } as any);
    manager.resize(1280, 900);
    manager.setRootInterface(161);
    const pane = manager.getWidgetByUid((161 << 16) | 16)!;
    manager.ensureLayout(pane);
    assert.deepEqual([pane.width, pane.height], [512, 334], 'the real cache modal starts at a fixed size');
    setCustomInterface(DEFINITION);
    manager.openSubInterface(pane.uid, GROUP_ID);
    vm.execute(scripts.load(MAINMODAL_BACKGROUND_SCRIPT)!, [-1, EXPANDED_MODAL_SIZE]);
    // The cache gameframe calls this resize procedure on its sub-change and
    // resize events. Use it directly to avoid booting the game or other services.
    const gameframe = manager.getGroupRoot(161)!;
    vm.execute(scripts.load(909)!, [gameframe.uid, 1130]);
    manager.ensureLayout(pane);
    const parent = manager.getWidgetByUid(pane.parentUid)!;
    manager.ensureLayout(parent);
    assert.equal(pane.height, parent.height, 'the cache expansion fills the real native parent height');
    assert.equal(pane.width, parent.width, 'the cache expansion fills the real native parent width');
    assert.ok(pane.height > 334, 'Resizable no longer limits the plugin to the default 334px modal');
    manager.ensureLayout(manager.getWidgetByUid(uid(C.ROOT))!);
    assert.ok(manager.getWidgetByUid(uid(C.ROOT))!.height > 600);
    manager.closeSubInterface(pane.uid);
}

async function testPluginToggle(): Promise<void> {
    const sent: Uint8Array[] = [];
    (globalThis as any).WebSocket = { OPEN: 1 };
    state.socket = { readyState: 1, send: (packet: Uint8Array) => sent.push(packet) } as any;
    setPacketSocket(state.socket);
    const resolveNpcExamineTypeId = (index: number) => index === 123 ? 132 : undefined;
    setNpcExamineIdResolver(resolveNpcExamineTypeId);
    const storage = defaultConfigStorage();
    function createManager(): PluginManager {
        const bus = new EventBus();
        const manager = new PluginManager(bus, new ConfigManager(bus, storage));
        manager.getInjector().provide(CLIENT_TOKEN, { resolveNpcExamineTypeId });
        manager.loadCorePlugins([MonsterExaminePlugin]);
        return manager;
    }
    const manager = createManager();
    const plugin = manager.getPlugin(MonsterExaminePlugin)!;
    assert.equal(manager.getDescriptor(plugin).name, 'Monster Examine');
    assert.equal(manager.getDescriptor(plugin).hidden, undefined, 'visible in the plugin list');
    assert.equal(manager.isEnabled(plugin), true, 'enabled for new profiles');
    const hooks = new ClientPluginManager();
    hooks.add(plugin);
    const menuClick = (action: Parameters<typeof hooks.onMenuOptionClicked>[0]) => hooks.onMenuOptionClicked(action);
    menuClickListeners.add(menuClick);
    function examine(opcode = MenuOpcode.ExamineNpc, index = 123): ReturnType<typeof decodeClientPackets> {
        sent.length = 0;
        menuAction(0, 0, opcode, index, -1, 'Examine', 'Hobgoblin', 0, 0);
        flushPackets();
        return decodeClientPackets(Buffer.concat(sent.map(packet => Buffer.from(packet))));
    }
    const contextual = [{ type: 'plugin_message', channel: 'entity-examine', data: { kind: 'npc', id: 132, index: 123 } }];
    assert.deepEqual(examine(), contextual, 'enabled plugin consumes examine and sends exactly one contextual request');
    assert.deepEqual(examine(MenuOpcode.ExamineNpc + 2000), contextual, 'deprioritized examines work');
    assert.deepEqual(examine(MenuOpcode.ExamineNpc, 999), [], 'stale entities do not become unrelated type examines');
    assert.equal(plugin.onMenuOptionClicked({ opcode: MenuOpcode.Cancel } as any), false, 'other menu actions remain native');
    await manager.setPluginEnabled(plugin, false);
    assert.equal(plugin.isStarted(), false);
    assert.deepEqual(examine(), [{ type: 'examine_npc', id: 132 }], 'disable immediately restores the native text path');
    const restored = createManager();
    assert.equal(restored.isEnabled(MonsterExaminePlugin), false, 'disabled preference survives a fresh manager');
    assert.equal(restored.getPlugin(MonsterExaminePlugin)!.isStarted(), false);
    await manager.setPluginEnabled(plugin, true);
    assert.deepEqual(examine(), contextual, 're-enable restores the window request');
    const enabledAgain = createManager();
    assert.equal(enabledAgain.isEnabled(MonsterExaminePlugin), true, 'enabled preference is saved too');
    await enabledAgain.setPluginEnabled(MonsterExaminePlugin, false);
    await manager.setPluginEnabled(plugin, false);
    menuClickListeners.delete(menuClick);
    assert.deepEqual(examine(), [{ type: 'examine_npc', id: 132 }], 'uninstalled client plugin retains native examine');
    setPacketSocket(null);
    state.socket = null;
    setNpcExamineIdResolver(null);
}

async function main(): Promise<void> {
    const cardStyle = DEFINITION.list.cards;
    assert.equal(cardStyle.height, 132, 'the unused percentage line is removed from every card');
    const ratePart = cardStyle.parts.find((part: any) => part.start === C.RATE);
    const sourcePart = cardStyle.parts.find((part: any) => part.start === C.SOURCE);
    assert.equal(sourcePart.y - ratePart.y - ratePart.height, 2, 'conditions follow the rate without an empty text line');
    assert.equal(sourcePart.y + sourcePart.height, cardStyle.height - 4);
    assert.equal(new Set(DEFINITION.widgets.map((widget: any) => widget.uid)).size, DEFINITION.widgets.length,
        'the larger bounded row pool has no overlapping component ranges');
    const sample = [{ id: 1, header: true }, { id: 2, expandable: true },
        { id: 3, parentId: 2 }, { id: 4, parentId: 2 }, { id: 5 }];
    const grid = layoutCards(sample, 648, cardStyle, 50, 64, 6, 18);
    assert.equal(grid.placements[0].width, 648, 'section bands span the complete grid');
    assert.ok(grid.placements[1].card && grid.placements[1].width < 200, 'collapsed groups use the same compact tiles as items');
    assert.equal(grid.placements[2].y, grid.placements[3].y, 'sibling rewards share a card row');
    assert.ok(grid.placements[3].x > grid.placements[2].x);
    assert.ok(grid.placements[4].y > grid.placements[3].y, 'changing source flushes the card row');
    for (const width of [222, 510, 648]) {
        const entries = Array.from({ length: 200 }, (_, i) => ({ id: i + 1,
            header: i % 23 === 0, expandable: i % 17 === 0 }));
        const result = layoutCards(entries, width, cardStyle, 50, 64, 6, 18);
        for (let y = 0; y < result.height; y += 23) {
            const visible = result.placements.filter(p => p.y < y + 801 && p.y + p.height > y);
            assert.ok(visible.length <= SLOTS, 'the bounded pool covers every intersecting card and band');
        }
        for (const p of result.placements) assert.ok(p.x >= 0 && p.x + p.width <= width);
    }
    await testPluginToggle();
    const nested = [
        { id: 1, name: 'Main table', header: true },
        { id: 2, name: 'Ammunition', expandable: true, collapsed: true },
        { id: 3, name: 'Arrows', parentId: 2, expandable: true, collapsed: true },
        { id: 4, name: 'Steel arrow', parentId: 3 },
        { id: 5, name: 'Malformed cycle', parentId: 5 },
        { id: 6, name: 'Waiting for parent', parentId: 99 },
    ];
    assert.deepEqual(filterRows(nested, '').map(row => row.id), [1, 2]);
    assert.deepEqual(filterRows(nested, '', new Map([[2, true]])).map(row => row.id), [1, 2, 3]);
    assert.deepEqual(filterRows(nested, 'Steel').map(row => row.id), [1, 2, 3, 4], 'search reveals every matching ancestor');
    assert.deepEqual(filterRows(nested, 'Main table').map(row => row.id), [1, 2, 3, 4], 'section names also match their contents');
    testNativeModalSizing();
    // Drive the actual server-declared layout with real custom runtime filtering and row pooling.
    assert.equal(setCustomInterface(DEFINITION), true);
    const host = createWidgetGroup(161);
    const hostRoot = host.add(0, -1, { widthMode: 1, heightMode: 1 });
    host.add(16, hostRoot, { widthMode: 1, heightMode: 1 });
    setCustomInterface({ groupId: 161, widgets: host.widgets });
    const wm = new WidgetManager({ getIndex: () => undefined } as any);
    wm.resize(512, 334);
    wm.setRootInterface(161);
    wm.openSubInterface((161 << 16) | 16, GROUP_ID);
    const widgets = new Map<number, any>(DEFINITION.widgets.map((widget: any) => [widget.uid, wm.getWidgetByUid(widget.uid)]));
    let pointer: { x: number; y: number } | undefined;
    const examined: number[] = [], messages: string[] = [];
    const runtime = new CustomInterfaceRuntime({ widgetManager: wm, getPointer: () => pointer,
    examineItem: itemId => examined.push(itemId), showInfo: text => messages.push(text),
    getCacheSystem: () => undefined, runWidgetScopedClientScript() {},
    fetchContent: async () => { throw new Error('player-specific rows must not fetch a public endpoint'); } });
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, icon: 314,
        name: `Feather ${i}`, panel: { quantity: '<col=b9ab96>Qty:</col> 1-10', rate: '[1/128] 0.781%', source: 'Conditional' } }));
    widgets.get(uid(C.HEIGHT)).text = '750';
    assert.equal(runtime.onInterfaceOpened(GROUP_ID), true);
    DATA_COMPONENTS.forEach((component: number, index: number) => {
        runtime.handleSetText(uid(component), JSON.stringify(rows.slice(index * 50, (index + 1) * 50)));
    });
    runtime.tick();
    const painted = wm.getStaticChildrenByParentUid(uid(C.LIST));
    assert.ok(painted.indexOf(widgets.get(uid(C.BACKGROUND))) < painted.indexOf(widgets.get(uid(C.ICON))),
        'drop row backgrounds must paint before item icons instead of covering them');
    assert.ok(painted.indexOf(widgets.get(uid(C.BACKGROUND))) < painted.indexOf(widgets.get(uid(C.LABEL))),
        'drop row backgrounds must paint before names and rates');
    assert.ok(painted.indexOf(widgets.get(uid(C.GROUP_BORDER))) < painted.indexOf(widgets.get(uid(C.BACKGROUND))),
        'subtree decoration pools paint below every interactive card');
    assert.ok(DEFINITION.widgets.filter((widget: any) => widget.fileId >= C.GROUP_BACKGROUND && widget.fileId < C.GROUP_BORDER + SLOTS)
        .every((widget: any) => !widget.flags && !widget.actions?.length && !widget.noClickThrough),
        'shared frames never intercept item actions or scrolling');
    assert.equal(widgets.get(uid(C.LEFT)).scrollHeight, 750);
    assert.equal(widgets.get(uid(C.ICON)).itemId, 314);
    assert.equal(widgets.get(uid(C.LABEL)).text, 'Feather 0');
    assert.match(widgets.get(uid(C.QUANTITY)).text, /Qty:.*1-10/);
    assert.match(widgets.get(uid(C.RATE)).text, /1\/128.*0.781%/);
    assert.ok(widgets.get(uid(C.LIST)).scrollHeight >= 200 * cardStyle.height);
    widgets.get(uid(C.LIST)).scrollY = 100 * (cardStyle.height + cardStyle.gap);
    runtime.tick();
    assert.match(widgets.get(uid(C.LABEL)).text, /Feather 100/);
    runtime.handleSearchKeyEvents([...('Feather 199')].map(char => ({ keyTyped: 0, keyPressed: char.charCodeAt(0) })));
    runtime.tick();
    assert.match(widgets.get(uid(C.LABEL)).text, /Feather 199/);
    assert.equal(widgets.get(uid(C.LIST)).scrollY, 0);
    assert.equal(widgets.get(uid(C.LABEL + 1)).hidden, true);

    // Run actual layout validation at both gameframe sizes, including after data
    // and search. A fixed number of short rows previously left tall modals blank.
    const view = widgets.get(uid(C.LIST));
    runtime.handleSetText(uid(C.INPUT), '');
    for (const [width, height] of [[1280, 900], [800, 600], [512, 334]]) {
        wm.resize(width, height);
        runtime.tick();
        for (const widget of widgets.values()) wm.ensureLayout(widget);
        const root = widgets.get(uid(C.ROOT));
        assert.equal(root.height, height - 18, 'the modal expands vertically with its native mount');
        assert.equal(root.width, Math.min(width - 18, 920), 'the modal uses available width with a readable cap');
        assert.ok(root.x >= 0 && root.y >= 0 && root.x + root.width <= width && root.y + root.height <= height);
        assert.ok(view.height > 0 && view.y + view.height < root.height);
        assert.equal(view.scrollWidth, view.width, 'row widths follow the resized viewport');
        const columns = width === 1280 ? 5 : width === 800 ? 4 : 1;
        assert.ok(SLOTS >= columns * Math.ceil((view.height + cardStyle.height - 1) / (cardStyle.height + cardStyle.gap)),
            'the pool covers the largest viewport, including partial card rows');
        assert.ok(widgets.get(uid(C.LABEL)).width >= 40, 'the smallest modal keeps a readable item column');
        const qty = widgets.get(uid(C.QUANTITY)), rate = widgets.get(uid(C.RATE));
        assert.ok(qty.y + qty.height <= rate.y && rate.x + rate.width <= view.width, 'card quantity and rate cells do not overlap');
        const item = widgets.get(uid(C.ICON)), name = widgets.get(uid(C.LABEL));
        assert.equal(item.width, 48, 'item thumbnails use the existing native item renderer at a readable compact size');
        assert.ok(name.y + name.height <= item.y && item.y + item.height < qty.y);
        assert.equal(view.scrollY, 0);
        for (let column = 1; column < columns; column++) {
            const previous = widgets.get(uid(C.BACKGROUND + column - 1));
            const next = widgets.get(uid(C.BACKGROUND + column));
            assert.equal(previous.y, next.y, 'the runtime paints sibling cards on the same line');
            assert.ok(previous.x + previous.width < next.x && next.x + next.width <= view.width);
        }
        view.scrollY = 4 * (cardStyle.height + cardStyle.gap) + 17;
        runtime.tick();
        assert.equal(widgets.get(uid(C.LABEL)).text, `Feather ${4 * columns}`,
            'scroll pooling retains the first card of a partly visible multi-column row');
        const lastVisible = Math.min(199, (Math.ceil((view.scrollY + view.height) / (cardStyle.height + cardStyle.gap))) * columns - 1);
        assert.ok(Array.from({ length: SLOTS }, (_, slot) => widgets.get(uid(C.LABEL + slot)).text).includes(`Feather ${lastVisible}`),
            'pooling supplies every visible card through the viewport bottom');
        view.scrollY = 0;
        runtime.tick();
    }
    // Actual drop projection -> multipart socket data -> loaded widgets, including
    // formatted rates and group headers. Search keeps only matching groups.
    const display = groupRows(buildDrops({ table: { main_max_roll: 128, entries: [
        { item_id: 526, name: 'Bones', quantity: [1, 1], always: true },
        { item_id: 314, name: 'Feather', quantity: [10, 20], weight: 1, out_of: 128 },
    ], tertiary: [{ item_id: 995, name: 'Coins', quantity: [100, 100], weight: 1, out_of: 500 }] } }, () => 'Item').rows);
    runtime.handleSetText(uid(C.INPUT), '');
    DATA_COMPONENTS.forEach((component: number, index: number) => runtime.handleSetText(uid(component), JSON.stringify(index === 0 ? display : [])));
    runtime.tick();
    assert.match(widgets.get(uid(C.LABEL)).text, /Guaranteed/);
    assert.equal(widgets.get(uid(C.RATE)).hidden, true, 'group headers have no invented item rate');
    assert.equal(widgets.get(uid(C.ICON + 1)).itemId, 526);
    assert.match(widgets.get(uid(C.RATE + 1)).text, /80df91.*\[1\/1\] 100%/);
    runtime.handleSetText(uid(C.INPUT), 'Feather');
    runtime.tick();
    assert.match(widgets.get(uid(C.LABEL)).text, /Main table/);
    assert.equal(widgets.get(uid(C.LABEL + 1)).text, 'Feather');
    assert.match(widgets.get(uid(C.QUANTITY + 1)).text, /10-20/);
    assert.match(widgets.get(uid(C.RATE + 1)).text, /1\/128.*0.781%/);
    assert.equal(widgets.get(uid(C.ICON + 1)).hidden, false);
    assert.equal(widgets.get(uid(C.RATE + 2)).hidden, true, 'unused rate cells disappear with their rows');
    const folded = groupRows(buildDrops({ table: { main_max_roll: 128, entries: [
        { item_id: 995, name: 'Coins', quantity: [1, 1], weight: 16 },
        { item_id: 995, name: 'Coins', quantity: [10, 10], weight: 8 },
        { item_id: 314, name: 'Feather', quantity: [1, 1], weight: 1 },
    ] } }, () => 'Item').rows);
    runtime.handleSetText(uid(C.INPUT), '');
    runtime.handleSetText(uid(C.DATA), JSON.stringify(folded));
    wm.resize(1280, 900);
    runtime.tick();
    for (const widget of widgets.values()) wm.ensureLayout(widget);
    assert.match(widgets.get(uid(C.LABEL + 1)).text, /Coins/);
    assert.equal(widgets.get(uid(C.TOGGLE_GLYPH + 1)).text, '+');
    assert.equal(widgets.get(uid(C.TOGGLE + 1)).hidden, false, 'folders have a visible framed native disclosure button');
    assert.equal(widgets.get(uid(C.BORDER + 1)).hidden, false, 'folders are outlined cards');
    assert.equal(widgets.get(uid(C.SOURCE + 1)).text, '2 amounts', 'group counts fit without repeating the disclosure instruction');
    assert.match(widgets.get(uid(C.QUANTITY + 1)).text, /1-10.*4.*avg/);
    assert.doesNotMatch(widgets.get(uid(C.QUANTITY + 1)).text, /Qty:/, 'group summaries reserve their width for the range and average');
    assert.equal(widgets.get(uid(C.QUANTITY + 1)).overflowScroll, true, 'large ranges remain readable in narrow cards');
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Feather', 'duplicate amounts start collapsed');
    assert.equal(widgets.get(uid(C.BACKGROUND + 1)).y, widgets.get(uid(C.BACKGROUND + 2)).y,
        'a collapsed amount tile flows beside the next item rather than taking a whole row');
    assert.equal(widgets.get(uid(C.ICON + 1)).hidden, false, 'amount tiles show their item thumbnail');
    assert.deepEqual(deriveMenuEntriesForWidget(widgets.get(uid(C.ICON + 1)), false,
        widget => wm.getWidgetFlags(widget)).filter(op => op.option !== 'Cancel').map(op => op.option),
        ['Expand', 'Examine'], 'amount tiles retain primary expansion and a separate item examine action');
    assert.equal(widgets.get(uid(C.BACKGROUND + 1)).rawHeight, cardStyle.height);
    assert.equal(widgets.get(uid(C.RATE + 1)).rawHeight, 14, 'the bracketed ratio and percentage share one line');
    assert.match(widgets.get(uid(C.RATE + 1)).text, /18.75%/);
    assert.equal(widgets.get(uid(C.LABEL)).fontId, 496, 'sections use the native bold font');
    assert.equal(widgets.get(uid(C.ICON)).hidden, true, 'sections never resemble item rows');
    assert.equal(widgets.get(uid(C.BACKGROUND)).hidden, false, 'sections have a distinct full-width background');
    assert.ok(widgets.get(uid(C.LABEL)).width > view.width - 30, 'section headings span the row');
    assert.match(widgets.get(uid(C.SOURCE)).text, /regular reward roll/, 'section subtitles explain the roll type');
    assert.equal(widgets.get(uid(C.TOGGLE)).hidden, true, 'section dividers are not disclosure buttons');
    assert.equal(widgets.get(uid(C.GUIDE)).hidden, false, 'section dividers have a native accent rule');
    assert.ok(painted.indexOf(widgets.get(uid(C.TOGGLE))) < painted.indexOf(widgets.get(uid(C.TOGGLE_GLYPH))), 'disclosure outlines paint below their glyphs');
    const folderPackets: Uint8Array[] = [];
    setPacketSocket({ readyState: 1, send: (packet: Uint8Array) => folderPackets.push(packet) } as any);
    const router = new WidgetActionRouter({ getWidgetManager: () => wm, getCustomInterfaces: () => runtime } as any);
    // Exercise the real mouse-down path, not only right-click's action router.
    const clicked = widgets.get(uid(C.TOGGLE_GLYPH + 1));
    const modal = widgets.get(uid(C.ROOT));
    const input = { leftClickX: modal.x + view.x + clicked.x + 11,
        leftClickY: modal.y + view.y + clicked.y + 11 } as any;
    assert.ok(collectInputWidgetsAtPoint(wm, input.leftClickX, input.leftClickY).includes(clicked),
        'the real input hit-test finds the disclosure glyph inside its clipped modal');
    const interaction = { clickedWidget: null, resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false, isWidgetDraggable: () => false } as any;
    let transmitted = 0;
    const clickDeps = { getTransmitCycles: () => ({ cycleCntr: 0 }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        getCustomInterfaces: () => runtime, getCs2Vm: () => ({ invokeEventHandler: () => false }),
        handleTradeWidgetAction: () => false, getPlayerDesign: () => ({}),
        resolveTransmitFlagWidget: (widget: any) => widget,
        buildWidgetActionPayload: ({ widget }: any) => { transmitted++; return { widgetId: widget.uid, opId: 1 }; },
    } as any;
    const primary = createPrimaryWidgetActionResolver(clickDeps, input, wm, interaction);
    assert.equal(primary(clicked).option, 'Expand');
    processWidgetClickInput(clickDeps, {} as any, { input, collectFromAllRoots: (x: number, y: number) => collectInputWidgetsAtPoint(wm, x, y),
        getWidgetFlags: (widget: any) => wm.getWidgetFlags(widget) } as any, wm, interaction, primary, true);
    assert.equal(transmitted, 0, 'primary click is consumed before gameplay payload construction');
    flushPackets();
    assert.deepEqual(folderPackets, [], 'native folder clicks do not send gameplay packets');
    setPacketSocket(null);
    runtime.tick();
    assert.equal(widgets.get(uid(C.TOGGLE_GLYPH + 1)).text, '-');
    assert.equal(widgets.get(uid(C.GROUP_BACKGROUND)).hidden, false, 'expanded rewards share a native background');
    assert.equal(widgets.get(uid(C.GROUP_BORDER)).hidden, false, 'the expanded subtree has a shared frame');
    assert.equal(widgets.get(uid(C.SOURCE + 1)).text, '2 amounts', 'disclosure state is shown by the native button and menu');
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Coins');
    assert.match(widgets.get(uid(C.QUANTITY + 3)).text, /10/);
    const padding = cardStyle.groupBackdrops.padding;
    assert.equal(widgets.get(uid(C.BACKGROUND + 2)).rawY, 50 + cardStyle.height + 2 * cardStyle.gap + padding,
        'expanded children follow their parent tile in a separate grid row');
    assert.equal(widgets.get(uid(C.BACKGROUND + 2)).rawX, 6 + padding, 'child cards are indented inside their source frame');
    assert.equal(widgets.get(uid(C.GUIDE + 2)).hidden, true, 'cards use their frame rather than a stray folder guide');
    view.scrollY = 50 + cardStyle.height + 2 * cardStyle.gap + padding;
    runtime.tick();
    assert.equal(widgets.get(uid(C.GROUP_BACKGROUND)).hidden, false, 'the group background remains when its parent card scrolls out');
    assert.ok(widgets.get(uid(C.GROUP_BACKGROUND)).rawY < view.scrollY, 'the background uses full subtree coordinates');
    assert.equal(widgets.get(uid(C.LABEL)).text, 'Coins', 'scrolling uses the compact header offset');
    assert.equal(widgets.get(uid(C.LABEL)).rawHeight, 18, 'a reused section slot takes the card title layout');
    assert.equal(widgets.get(uid(C.BACKGROUND)).rawHeight, cardStyle.height, 'a reused section slot takes the card height');
    view.scrollY = 0;
    runtime.tick();
    assert.equal(runtime.handleWidgetClick(GROUP_ID, C.RATE + 1), true, 'all folder cells toggle the same group');
    runtime.tick();
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Feather');
    assert.equal(widgets.get(uid(C.GROUP_BACKGROUND)).hidden, true, 'collapsing hides the shared background');
    runtime.handleSetText(uid(C.INPUT), 'Coins');
    runtime.tick();
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Coins', 'search reveals matching children inside collapsed folders');
    assert.equal(widgets.get(uid(C.GROUP_BACKGROUND)).hidden, false, 'matching descendants retain their group background');
    runtime.handleSetText(uid(C.INPUT), '');
    runtime.tick();
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Feather', 'clearing search restores the collapsed state');
    for (const widget of widgets.values()) wm.ensureLayout(widget);
    const reward = widgets.get(uid(C.ICON + 2));
    pointer = { x: modal.x + view.x + reward.x + 4, y: modal.y + view.y + reward.y + 4 };
    assert.match(tooltipManager.getTooltips().map(tip => tip.text).join(' '), /Feather.*Amount:/,
        'hovering the actual item hit area shows its full explanation through the shared TooltipManager');
    assert.equal(runtime.handleWidgetClick(GROUP_ID, C.LABEL + 2), true, 'ordinary row clicks stay local');
    assert.ok(DEFINITION.widgets.every((widget: any) => ![33, 34, 35].includes(widget.fileId)), 'the bottom details region is removed');
    assert.ok(DEFINITION.widgets.every((widget: any) => ![C.HEADER, C.ITEM_HEADER].includes(widget.fileId)),
        'the redundant rewards/hover heading is removed');
    assert.equal(widgets.get(uid(C.SOURCE + 2)).overflowScroll, true);
    assert.equal(view.y + view.height, modal.height - 12, 'drops reclaim the bottom details area');
    pointer = undefined;
    assert.deepEqual(tooltipManager.getTooltips(), [], 'leaving the row clears the tooltip');
    router.handleWidgetAction({ widget: widgets.get(uid(C.TOGGLE + 1)), option: 'Expand', opIndex: 1 } as any);
    runtime.tick();
    runtime.onInterfaceClosed(GROUP_ID);
    runtime.onInterfaceOpened(GROUP_ID, true);
    runtime.tick();
    assert.equal(widgets.get(uid(C.TOGGLE_GLYPH + 1)).text, '-', 'a gameframe remount keeps the expanded groups');
    runtime.onInterfaceClosed(GROUP_ID);
    runtime.onInterfaceOpened(GROUP_ID);
    runtime.handleSetText(uid(C.DATA), JSON.stringify(folded));
    runtime.tick();
    assert.equal(widgets.get(uid(C.TOGGLE_GLYPH + 1)).text, '+', 'a new examine starts with collapsed groups');
    assert.ok(widgets.get(uid(C.MODEL)).rawHeight >= 150 && widgets.get(uid(C.MODEL)).rawWidth >= 214,
        'the native body preview has larger fitted bounds');
    const tree = groupRows(buildDrops({ table: { main_max_roll: 1, entries: [{ shared_table: 'rareDrop', weight: 1 }] },
        shared: { rareDrop: [{ itemId: 561, name: 'Nature rune', quantity: [50, 50], weight: 1, outOf: 4 },
            { ref: 'gem', weight: 1, outOf: 4 }],
            gem: [{ itemId: 1601, name: 'Diamond', quantity: [1, 1], weight: 1, outOf: 2 }] } }, () => 'Item').rows);
    runtime.onInterfaceClosed(GROUP_ID);
    runtime.onInterfaceOpened(GROUP_ID);
    runtime.handleSetText(uid(C.DATA), JSON.stringify(tree));
    wm.resize(800, 600);
    runtime.tick();
    assert.match(widgets.get(uid(C.LABEL + 1)).text, /Rare drop table/);
    assert.equal(widgets.get(uid(C.ICON + 1)).actions.includes('Examine'), false,
        'a table representative thumbnail is not presented as a single examinable item');
    runtime.handleWidgetClick(GROUP_ID, C.TOGGLE_GLYPH + 1);
    runtime.tick();
    assert.equal(widgets.get(uid(C.LABEL + 2)).text, 'Nature rune');
    assert.match(widgets.get(uid(C.LABEL + 3)).text, /Gem table/);
    assert.equal(widgets.get(uid(C.BACKGROUND + 3)).rawX > 6, true, 'nested folders occupy their own tile in the parent card row');
    runtime.handleWidgetClick(GROUP_ID, C.TOGGLE + 3);
    runtime.tick();
    for (const widget of widgets.values()) wm.ensureLayout(widget);
    assert.equal(widgets.get(uid(C.LABEL + 4)).text, 'Diamond');
    const nestedCard = widgets.get(uid(C.BACKGROUND + 4)), nestedIcon = widgets.get(uid(C.ICON + 4));
    assert.equal(nestedCard.x, 12 + padding, 'nested reward layout follows its complete table ancestry');
    assert.ok(Math.abs(nestedIcon.x + nestedIcon.width / 2 - nestedCard.x - nestedCard.width / 2) <= 1,
        'nested thumbnails remain centered inside the indented card');
    assert.equal(widgets.get(uid(C.TOGGLE + 4)).hidden, true, 'pooled leaf rows never retain disclosure controls');
    assert.equal(widgets.get(uid(C.BORDER + 4)).hidden, false, 'leaf thumbnails have their own native frame');
    assert.ok([...widgets.values()].every(widget => Number.isFinite(widget.rawHeight)), 'unused pooled controls retain valid dimensions');
    const rulesRows = groupRows(buildDrops({ table: { main_max_roll: 4, entries: [
        { item_id: 314, name: 'Feather', quantity: [1, 1], weight: 1 },
        { item_id: 995, name: 'Coins', quantity: [10, 10], weight: 1, notes: ['Requires a perfect kill.'] },
    ] } }, () => 'Item').rows);
    runtime.onInterfaceClosed(GROUP_ID);
    runtime.onInterfaceOpened(GROUP_ID);
    runtime.handleSetText(uid(C.DATA), JSON.stringify(rulesRows));
    runtime.tick();
    const ops = (slot: number) => deriveMenuEntriesForWidget(widgets.get(uid(C.ICON + slot)), false,
        widget => wm.getWidgetFlags(widget), id => wm.getWidgetByUid(id)).filter(op => op.option !== 'Cancel');
    const ordinaryOps = ops(1);
    assert.deepEqual(ordinaryOps.map(op => op.option), ['Examine'], 'an ordinary item offers Examine without a filler Drop info action');
    assert.equal(widgets.get(uid(C.SOURCE + 1)).text, '', 'ordinary items have no filler conditions');
    assert.equal(widgets.get(uid(C.BACKGROUND + 1)).rawHeight, cardStyle.height);
    router.handleWidgetAction({ widget: widgets.get(uid(C.ICON + 1)), ...ordinaryOps[0], source: 'menu' } as any);
    assert.deepEqual(examined, [314], 'the real widget menu routes Examine to the host inventory-item handler');
    assert.deepEqual(messages, []);
    const conditionalOps = ops(3);
    assert.deepEqual(conditionalOps.map(op => op.option), ['Drop info', 'Examine']);
    const info = conditionalOps.find(op => op.option === 'Drop info')!;
    router.handleWidgetAction({ widget: widgets.get(uid(C.ICON + 3)), ...info, source: 'menu' } as any);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Coins.*Requires a perfect kill/);
    assert.deepEqual(examined, [314], 'Drop info does not trigger Examine or a folder toggle');
    runtime.handleSetText(uid(C.INPUT), 'Feather');
    runtime.tick();
    assert.deepEqual(ops(1).map(op => op.option), ['Examine'], 'reused slots discard old rule actions after search');
    runtime.onInterfaceClosed(GROUP_ID);
    console.log('monster examine saved plugin toggle, native/contextual transport, item icons, multi-part search and scrolling passed');
}

void main();
