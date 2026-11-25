import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setCustomInterface } from '../common/gamemode/GamemodeContentStore';
import { CustomInterfaceRuntime } from '../widgets/custom/CustomInterfaceRuntime';
import { WidgetManager } from '../widgets/WidgetManager';
import { collectWidgetsAtPointAcrossRoots, deriveMenuEntriesForWidget } from '../widgets/menu/utils';
import { widgetEntriesToSimple } from '../ui/menu/MenuBridge';
import { createPrimaryWidgetActionResolver } from '../game/widgets/input/widgetPrimaryAction';
import { processWidgetClickInput } from '../game/widgets/input/widgetClickInput';
import { buildWidgetActionPayload } from '../game/widgets/widgetActionPayload';
const Layout = require('../../server/plugins/interface/bestiary/Layout.Bestiary');
const { createWidgetGroup } = require('../../server/plugins/interface/widgetGroup');
const { C, GROUP_ID, DATA_COMPONENTS, uid } = Layout;

function fixture(entries?: any[]) {
    const base = createWidgetGroup(161);
    const root = base.add(0, -1, { rawWidth: 1000, rawHeight: 800 });
    base.add(16, root, { rawWidth: 1000, rawHeight: 800 });
    setCustomInterface({ groupId: 161, widgets: base.widgets });
    setCustomInterface(Layout.DEFINITION);
    const wm = new WidgetManager({ getIndex: () => undefined } as any);
    wm.resize(1000, 800); wm.setRootInterface(161);
    wm.openSubInterface((161 << 16) | 16, GROUP_ID, 0); wm.ensureLayout(wm.getWidgetByUid(uid(C.ROOT))!);
    const runtime = new CustomInterfaceRuntime({ widgetManager: wm, getCacheSystem: () => undefined,
        runWidgetScopedClientScript() {}, fetchContent: async () => ({}) });
    runtime.onInterfaceOpened(GROUP_ID);
    const rows = entries ?? Array.from({ length: 3862 }, (_, index) => ({ id: index + 1, name: `Creature ${index}`,
        npc: index, animation: 808, detail: '50', terms: String(index), panel: { stats: `NPC ID ${index}` } }));
    DATA_COMPONENTS.forEach((component: number, i: number) => runtime.handleSetText(uid(component), JSON.stringify(i === 0 ? rows : [])));
    const layout = () => {
        for (const { uid } of Layout.DEFINITION.widgets) wm.ensureLayout(wm.getWidgetByUid(uid)!);
    };
    const tick = () => { layout(); runtime.tick(); layout(); };
    tick();
    const widget = (component: number) => wm.getWidgetByUid(uid(component))!;
    const view = widget(C.LIST);
    const row = (slot = 0) => runtime.rowIdAt(GROUP_ID, C.NAME + slot);
    const models = () => Array.from({ length: Layout.SLOTS }, (_, slot) => widget(C.MODEL + slot)).filter(w => !w.hidden && w.isNpcChathead);
    return { wm, runtime, widget, view, row, models, tick };
}

test('Bestiary uses the available height and recycles native previews while scrolling and filtering', () => {
    const f = fixture();
    assert.ok(f.view.height > 600, String(f.view.height));
    assert.ok(f.view.scrollHeight > 100000);
    assert.ok(f.models().length > 6 && f.models().length < Layout.SLOTS, String(f.models().length));
    f.view.scrollY = 9000; f.tick(); assert.ok(f.row()! > 100);
    f.runtime.handleSetText(uid(C.SEARCH_TEXT), '3861'); f.tick();
    assert.equal(f.row(), 3862); assert.equal(f.row(1), null);
    assert.equal(f.models().length, 1);
    assert.equal(f.widget(C.MODEL + 1).sequenceId, -1, 'recycled slots release their sequence');
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('Find and Examine buttons resolve the visible creature through native layout and mouse input', () => {
    const f = fixture(); f.view.scrollY = 9000; f.tick();
    const packets: any[] = [];
    const deps = { getCustomInterfaces: () => f.runtime, getTransmitCycles: () => ({ cycleCntr: 0 }),
        getCs2Vm: () => ({ invokeEventHandler: () => false }), getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false, executeScriptListener() {}, resolveTransmitFlagWidget: (w: any) => w,
        buildWidgetActionPayload: (event: any) => { const p = buildWidgetActionPayload(f.wm, event); packets.push(p); return p; } } as any;
    const interaction = { clickedWidget: null, clickedWidgetParent: null, resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false, isWidgetDraggable: () => false } as any;
    const flags = (w: any) => f.wm.getWidgetFlags(w);
    const collect = (x: number, y: number) => collectWidgetsAtPointAcrossRoots(f.wm.getInputRoots(), x, y, new Map(),
        id => f.wm.getStaticChildrenByParentUid(id), id => f.wm.getAllGroupRoots(f.wm.interfaceParents.get(id)?.group ?? -1));
    const slot = 5, expected = f.row(slot);
    for (const [component, op] of [[C.FIND_TEXT + slot, 2], [C.EXAMINE_TEXT + slot, 1]]) {
        const w = f.widget(component), root = f.widget(C.ROOT);
        const x = root.x + f.view.x + w.x + w.width / 2;
        const y = root.y + f.view.y + w.y - f.view.scrollY + w.height / 2;
        assert.ok(collect(x, y).some(hit => hit.uid === w.uid), `button ${component} is under its painted bounds`);
        interaction.clickedWidget = null;
        processWidgetClickInput(deps, {} as any, { input: { leftClickX: x, leftClickY: y }, collectFromAllRoots: collect,
            getWidgetFlags: flags } as any, f.wm, interaction,
            createPrimaryWidgetActionResolver(deps, {} as any, f.wm, interaction), true);
        assert.equal(packets.at(-1)?.opId, op);
        assert.equal(packets.at(-1)?.slot, expected, 'the row ID survives pooling and scrolling');
    }
    const model = f.widget(C.MODEL + slot);
    const entries = widgetEntriesToSimple(deriveMenuEntriesForWidget(model, false, flags, id => f.wm.getWidgetByUid(id)), {
        chosenWidget: model, scheduleRender() {}, ui: { onWidgetAction: (event: any) => {
            event.slot = f.runtime.rowIdAt(GROUP_ID, model.fileId); packets.push(buildWidgetActionPayload(f.wm, event));
        } } });
    entries.find(entry => entry.option === 'Examine')!.onClick?.();
    assert.equal(packets.at(-1)?.opId, 1); assert.equal(packets.at(-1)?.slot, expected);
    entries.find(entry => entry.option === 'Find')!.onClick?.();
    assert.equal(packets.at(-1)?.opId, 2); assert.equal(packets.at(-1)?.slot, expected);
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('Back from Examine restores Bestiary scroll and filtering after an intermediate interface', () => {
    const f = fixture(); f.runtime.handleSetText(uid(C.SEARCH_TEXT), 'creature'); f.tick();
    f.view.scrollY = 9000; f.tick(); const expected = f.row();
    f.runtime.onInterfaceClosed(GROUP_ID); f.wm.closeSubInterface((161 << 16) | 16);
    const other = createWidgetGroup(30090); other.add(0, -1, { rawWidth: 100, rawHeight: 100 });
    setCustomInterface({ groupId: 30090, widgets: other.widgets });
    f.wm.openSubInterface((161 << 16) | 16, 30090, 0); f.runtime.onInterfaceOpened(30090);
    f.runtime.onInterfaceClosed(30090); f.wm.closeSubInterface((161 << 16) | 16);
    f.wm.openSubInterface((161 << 16) | 16, GROUP_ID, 0); f.runtime.onInterfaceOpened(GROUP_ID); f.tick();
    assert.equal(f.widget(C.LIST).scrollY, 9000);
    assert.equal(f.row(), expected); assert.match(f.widget(C.SEARCH_TEXT).text, /creature/);
    f.runtime.onInterfaceClosed(GROUP_ID);
});


test('same-name cards collapse, expand from See variants, and keep real actions on the individual forms', () => {
    const f = fixture([{ id: 500, name: 'Goblin', npc: 655, expandable: true, collapsed: true },
        { id: 656, parentId: 500, name: 'Goblin', npc: 655, terms: '655' },
        { id: 657, parentId: 500, name: 'Goblin', npc: 656, terms: '656' },
        { id: 10, name: 'Man', npc: 9, terms: '9' }]);
    assert.equal(f.row(), 500); assert.equal(f.row(1), 10);
    assert.equal(f.widget(C.VARIANTS_TEXT).hidden, false);
    assert.equal(f.widget(C.FIND_TEXT).hidden, false);
    assert.equal(f.widget(C.FIND_TEXT).text, 'Find variants');
    assert.equal(f.runtime.handleWidgetClick(GROUP_ID, C.FIND_TEXT, 2), false, 'Find variants transmits rather than toggling the group');
    f.tick(); assert.equal(f.row(1), 10, 'finding does not expand variants');
    assert.equal(f.runtime.handleWidgetClick(GROUP_ID, C.VARIANTS_TEXT), true, 'expansion is handled locally');
    f.tick(); assert.equal(f.row(1), 656); assert.equal(f.row(2), 657);
    assert.equal(f.widget(C.VARIANTS_TEXT).text, 'Hide variants');
    assert.equal(f.widget(C.FIND_TEXT + 1).hidden, false);
    assert.equal(f.widget(C.VARIANTS_TEXT + 1).hidden, true);
    f.runtime.handleWidgetClick(GROUP_ID, C.VARIANTS_TEXT); f.tick();
    f.runtime.handleSetText(uid(C.SEARCH_TEXT), 'goblin'); f.tick();
    assert.equal(f.row(), 500); assert.equal(f.row(1), null, 'name search retains collapsed groups');
    f.runtime.handleWidgetClick(GROUP_ID, C.VARIANTS_TEXT); f.tick();
    assert.equal(f.row(1), 656);
    f.runtime.handleSetText(uid(C.SEARCH_TEXT), '656'); f.tick();
    assert.equal(f.row(), 657); assert.equal(f.row(1), null, 'exact ID directly shows its individual variant');
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('the card stays highlighted across its thumbnail, text and buttons, and redraws when leaving it', async () => {
    const f = fixture([{ id: 656, name: 'Goblin', npc: 655, terms: '655' }]);
    const noop = () => {};
    const canvas: any = { width: 1000, height: 800, style: {}, addEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
        __textureCache: { beginFrame: noop, endFrame: noop } };
    (globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
    (globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };
    const { renderWidgetTreeGL } = await import('../widgets/gl/widgetsGl/renderWidgetTree');
    const { WidgetsOverlay } = await import('../ui/devoverlay/WidgetsOverlay');
    const colors: number[][] = [];
    const glr: any = new Proxy({ canvas, width: 1000, height: 800,
        gl: new Proxy({}, { get: () => noop }), drawRect: (_x: number, _y: number, _w: number, _h: number, color: number[]) => colors.push(color),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const card = f.widget(C.CARD);
    const draw = () => {
        colors.length = 0;
        renderWidgetTreeGL(glr, card, { widgetManager: f.wm, spriteIndex: {} as any,
            fontLoader: () => undefined, hostW: 1000, hostH: 800, skipTooltip: true, visible: new Map() });
        return colors[0].slice(0, 3);
    };
    draw(); const clicks = canvas.__clicks;
    const dirty: number[] = [];
    const invalidate = f.wm.invalidateWidgetRender.bind(f.wm);
    f.wm.invalidateWidgetRender = w => { if (w) dirty.push(w.uid); invalidate(w); };
    const overlay: any = new WidgetsOverlay({} as any, {} as any); overlay.glRenderer = glr;
    for (const component of [C.CARD, C.MODEL, C.NAME, C.STATS, C.FIND_TEXT, C.EXAMINE_TEXT]) {
        const widget = f.widget(component);
        clicks.register({ id: `widget:${widget.uid}`, widgetUid: widget.uid, priority: 100,
            rect: { x: 900, y: 700, w: 20, h: 20 } });
        clicks.onPointerMove(905, 705);
        dirty.length = 0; overlay.invalidateHoverVisuals(f.wm);
        assert.deepEqual(draw(), [0x49 / 255, 0x3d / 255, 0x2b / 255], `hover on component ${component} keeps the whole card highlighted`);
        assert.ok(dirty.includes(card.uid), 'the card redraws, including static previews');
        clicks.unregister(`widget:${widget.uid}`);
    }
    clicks.onPointerMove(-1, -1); dirty.length = 0; overlay.invalidateHoverVisuals(f.wm);
    assert.ok(dirty.includes(card.uid), 'leaving the card clears its previous highlight');
    assert.deepEqual(draw(), [0x28 / 255, 0x22 / 255, 0x1b / 255]);
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('level titles and bold variant counts share a frame that excludes other same-name levels', () => {
    const { groupedEntries } = require('../../server/plugins/interface/bestiary/Catalog.Bestiary');
    const source = [{ id: 1, name: 'Goblin', level: 3, hp: 4 },
        ...Array.from({ length: 18 }, (_, i) => ({ id: 100 + i, name: 'Goblin', level: 5, hp: 8 })),
        { id: 200, name: 'Goblin', level: 30, hp: 35 }];
    const rows = groupedEntries(source, () => -1), group = rows.find((row: any) => row.expandable);
    const f = fixture(rows), frame = () => f.widget(C.GROUP_BACKGROUND);
    const slotFor = (id: number) => Array.from({ length: Layout.SLOTS }, (_, i) => i).find(i => f.row(i) === id)!;
    assert.equal(frame().hidden, true, 'collapsed groups need no shared frame');
    assert.equal(f.widget(C.NAME).text, 'Goblin <col=00ff00>(Level-3)</col>');
    assert.equal(f.widget(C.STATS).text, 'NPC ID 1');
    assert.equal(f.widget(C.STATS).fontId, 496, 'native b12_full is slightly larger and bolder than p11_full');
    f.runtime.handleWidgetClick(GROUP_ID, C.VARIANTS_TEXT + slotFor(group.id)); f.tick();
    const slot = slotFor(group.id);
    assert.equal(f.widget(C.NAME + slot).text, 'Goblin <col=00ff00>(Level-5)</col>');
    assert.equal(f.widget(C.STATS + slot).text, '18 Variants');
    assert.equal(frame().hidden, false);
    assert.ok(C.GROUP_BORDER + Layout.GROUP_SLOTS <= C.CARD, 'frames paint below card components');
    assert.equal(f.widget(C.GROUP_BORDER).rawHeight, frame().rawHeight);
    for (const row of rows.filter((row: any) => row.id === group.id || row.parentId === group.id)) {
        const card = f.widget(C.CARD + slotFor(row.id));
        assert.ok(card.rawX >= frame().rawX && card.rawX + card.rawWidth <= frame().rawX + frame().rawWidth);
        assert.ok(card.rawY >= frame().rawY && card.rawY + card.rawHeight <= frame().rawY + frame().rawHeight);
    }
    const prior = f.widget(C.CARD + slotFor(2));
    assert.ok(prior.rawY + prior.rawHeight < frame().rawY, 'the lower-level Goblin is outside the group');
    f.view.scrollY = f.view.scrollHeight - f.view.height; f.tick();
    const next = f.widget(C.CARD + slotFor(201));
    assert.ok(next.rawY > frame().rawY + frame().rawHeight, 'the higher-level Goblin is outside the group');
    const groupY = frame().rawY;
    f.view.scrollY = groupY + 400; f.tick();
    assert.equal(frame().hidden, false, 'the shared background remains when its heading scrolls away');
    assert.equal(frame().rawY, groupY, 'pooling retains the original frame bounds');
    f.runtime.handleSetText(uid(C.SEARCH_TEXT), '100'); f.tick();
    assert.equal(f.row(), 101);
    assert.equal(f.widget(C.STATS).text, 'NPC ID 100', 'reused slots replace the group count');
    assert.equal(frame().hidden, true, 'an exact variant result clears the former group frame');
    f.runtime.onInterfaceClosed(GROUP_ID);
});
