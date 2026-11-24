import assert from "node:assert/strict";
import { test } from "node:test";
import { getCustomInterface, getDynamicWidgetGroup, setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { CustomInterfaceRuntime } from "../widgets/custom/CustomInterfaceRuntime";
import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { buildWidgetActionPayload } from "../game/widgets/widgetActionPayload";
import { WidgetManager } from "../widgets/WidgetManager";
import { collectWidgetsAtPointAcrossRoots } from "../widgets/menu/utils";
const Layout = require("../../server/plugins/tools/adminpanel/Layout.AdminPanel");
const { GROUP_ID, COMPONENT: C, DATA_COMPONENTS, BUTTONS, uid } = Layout;

function fixture(configure?: (definition: any) => void) {
    const definition = Layout.buildInterface();
    configure?.(definition);
    definition.search.debounceMs = 5;
    assert.equal(setCustomInterface(definition), true);
    const widgets = new Map<number, any>(definition.widgets.map((widget: any) => [widget.uid, { ...widget }]));
    const packets: any[] = [];
    const widgetManager = { getWidgetByUid: (id: number) => widgets.get(id),
        getInterfaceParentContainerUid: () => (161 << 16) | 16,
        getWidgetFlags: (w: any) => w.flags ?? 0, getWidgetOpMask: () => 0,
        invalidateWidgetRender() {}, invalidateWidget() {}, invalidateScroll() {},
    } as any;
    const runtime = new CustomInterfaceRuntime({ widgetManager, getCacheSystem: () => undefined,
        runWidgetScopedClientScript() {}, sendWidgetAction() {}, sendWidgetActionMessage: packet => { packets.push(packet); },
        fetchContent: async () => { throw new Error("Private admin rows must not use HTTP"); },
    });
    runtime.onInterfaceOpened(GROUP_ID);
    runtime.handleSetText(uid(C.SEARCH_SESSION), "fixture-session");
    let tabRows: number[][] = [];
    const commit = (index: number, extra = {}) => runtime.handleSetText(uid(C.LAYOUT),JSON.stringify({active:index,tabs:tabRows,...extra}));
    const data = (rows: any[], tabs: number[][]) => {
        tabRows=tabs;
        DATA_COMPONENTS.forEach((component: number, i: number) => runtime.handleSetText(uid(component), JSON.stringify(i === 0 ? rows : [])));
        runtime.handleSetText(uid(C.LAYOUT), JSON.stringify({ active: 0, tabs }));
    };
    const tab = (index: number) => { runtime.handleWidgetOp(GROUP_ID, C.TAB_START + index); commit(index); };
    const row = (slot = 0) => runtime.rowIdAt(GROUP_ID, C.ROW_LABEL_START + slot);
    const query = (value: string) => runtime.handleSetText(uid(C.SEARCH_INPUT), value);
    const respond = (packet: any, rows: any[], extra = {}) => runtime.handleSetText(uid(C.SEARCH_RESPONSE), JSON.stringify({
        ...JSON.parse(packet.target), rows, total: rows.length, ...extra,
    }));
    const click = (component: number) => {
        const widget = widgets.get(uid(component));
        const interaction = { clickedWidget: null, clickedWidgetParent: null,
            resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false,
            isWidgetDraggable: () => false } as any;
        const deps = { getCustomInterfaces: () => runtime, getTransmitCycles: () => ({ cycleCntr: 0 }),
            getCs2Vm: () => ({ invokeEventHandler: () => false }),
            getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
            handleTradeWidgetAction: () => false, executeScriptListener() {},
            buildWidgetActionPayload: (event: any) => { const payload = buildWidgetActionPayload(widgetManager, event); packets.push({ event, payload }); return payload; },
            resolveTransmitFlagWidget: (w: any) => w } as any;
        const flags = (w: any) => w.flags ?? 0;
        processWidgetClickInput(deps, {} as any, {
            input: { leftClickX: 10, leftClickY: 10 }, collectFromAllRoots: () => [widget], getWidgetFlags: flags,
        } as any, widgetManager, interaction,
        createPrimaryWidgetActionResolver(deps, {} as any, widgetManager, interaction), true);
    };
    return { definition, widgets, packets, runtime, data, tab, row, query, respond, click, commit };
}
const waitForDebounce = () => new Promise(resolve => setTimeout(resolve, 15));

test('private search loads nearby pages on scroll, evicts distant metadata and rejects stale pages', async () => {
    const f=fixture();f.data([], [[],[],[],[],[],[]]);f.tab(2);f.query('ancient');await waitForDebounce();
    const rows=Array.from({length:1000},(_,i)=>({id:1000+i,name:`Ancient piece ${i}`,icon:60000+i}));
    const request=(offset:number)=>f.packets.findLast(p=>p.target&&JSON.parse(p.target).offset===offset);
    const page=(offset:number)=>{const p=request(offset);assert.ok(p,`page ${offset} is requested lazily`);f.respond(p,rows.slice(offset,offset+40),{offset,pageSize:40,total:rows.length});};
    assert.equal(JSON.parse(request(0).target).offset,0);page(0);page(40);
    assert.equal((f.runtime as any).rows.filter(Boolean).length,80,'only nearby item metadata is loaded');
    assert.match(f.widgets.get(uid(C.STATUS)).text,/1000/,'the true count is shown, not the page length');
    const view=f.widgets.get(uid(C.LIST_VIEW));view.scrollY=400*46;(f.runtime as any).refreshVisibleSlots();
    for(const offset of [360,400,440])page(offset);
    assert.equal((f.runtime as any).rows.filter(Boolean).length,120,'only three nearby pages remain resident');
    assert.equal((f.runtime as any).rows[0],undefined,'distant result metadata is unloaded');
    assert.equal(f.widgets.get(uid(C.ROW_ICON_START)).itemId,60400,'visible slots bind the later-page preview');
    assert.equal(f.row(0),1400,'later-page rows keep their actionable identity');
    f.runtime.handleRowOp(1400,1);f.runtime.onInterfaceClosed(GROUP_ID);f.runtime.onInterfaceOpened(GROUP_ID,true);
    assert.equal(f.row(0),1400,'a root remount preserves the paged scroll position');
    assert.equal((f.runtime as any).selectedRowId,1400);
    view.scrollY=0;(f.runtime as any).refreshVisibleSlots();page(0);page(40);
    assert.equal(f.row(0),1000,'scrolling back reloads an evicted page');
    assert.ok((f.runtime as any).rows.filter(Boolean).length<=120);
    const stale=request(400);f.query('cape');await waitForDebounce();f.respond(stale,rows.slice(400,440),{offset:400,pageSize:40,total:rows.length});
    assert.equal((f.runtime as any).rows.length,0,'the previous query cannot add rows to the new query');
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('Admin commits Player editor atomically and auto-focuses each newly opened search without stealing focus on refresh', async () => {
    const f = fixture(); f.data([{id: 1, name: 'Alice'}], [[1], [], [], [], [], []]);
    f.runtime.handleWidgetOp(GROUP_ID, C.TAB_START + 3);
    for (const component of [C.LIST_VIEW, C.PANEL, C.SKILL_VIEW, C.SECTION_START]) {
        assert.equal(f.widgets.get(uid(component)).hidden, true);
    }
    assert.equal(f.runtime.handleSetHidden(uid(C.LIST_VIEW), false), true);
    assert.equal(f.widgets.get(uid(C.LIST_VIEW)).hidden, true, 'incoming partial visibility cannot reveal old rows');
    f.commit(3, {visibility: [
        {component:C.LIST_VIEW,hidden:true}, {component:C.PANEL,hidden:true},
        {component:C.SKILL_VIEW,hidden:false}, {component:C.SECTION_START,hidden:false},
    ]});
    assert.equal(f.widgets.get(uid(C.SKILL_VIEW)).hidden, false);
    assert.equal(f.widgets.get(uid(C.LIST_VIEW)).hidden, true);
    const type = (char: string) => f.runtime.handleSearchKeyEvents([{keyTyped:0,keyPressed:char.charCodeAt(0)}]);
    for (const tab of [2, 5]) {
        f.commit(tab, {visibility:[{component:C.SEARCH_INPUT,hidden:false}],focusSearch:true});
        assert.equal(f.runtime.isSearchFocused(), true);
        assert.equal(type('a'), true, 'typing goes straight into a newly opened item/NPC search');
        f.runtime.handleWidgetFocus(GROUP_ID, C.PANEL);
        assert.equal(f.runtime.isSearchFocused(), false);
        f.commit(tab);
        assert.equal(type('b'), false, 'same-view refresh respects click-away');
        f.commit(tab, {focusSearch:true});
        assert.equal(type('c'), true, 'a new Spawn kind search can explicitly claim focus');
    }
    f.commit(3, {visibility:[{component:C.SEARCH_INPUT,hidden:true}]});
    assert.equal(type('d'), false, 'hidden Player editor search cannot consume typing');
    f.runtime.onInterfaceClosed(GROUP_ID);
    await waitForDebounce();
});

test('Admin keeps list, preview, actions and expanded folder hit targets aligned in Fixed and Resizable', () => {
    const { createWidgetGroup } = require('../../server/plugins/interface/widgetGroup');
    for (const [width, height] of [[512, 334], [1000, 800]]) {
        const base = createWidgetGroup(161), baseRoot = base.add(0, -1, { rawWidth: width, rawHeight: height });
        base.add(16, baseRoot, { rawWidth: width, rawHeight: height });
        setCustomInterface({ groupId: 161, widgets: base.widgets });
        const definition = Layout.buildInterface(); setCustomInterface(definition);
        const wm = new WidgetManager({ getIndex: () => undefined } as any);
        wm.resize(width, height); wm.setRootInterface(161); wm.openSubInterface((161 << 16) | 16, GROUP_ID, 0);
        const runtime = new CustomInterfaceRuntime({ widgetManager: wm, getCacheSystem: () => undefined,
            runWidgetScopedClientScript() {}, fetchContent: async () => ({}) });
        runtime.onInterfaceOpened(GROUP_ID);
        const widget = (component: number) => wm.getWidgetByUid(uid(component))!;
        const tick = () => { for (const w of definition.widgets) wm.ensureLayout(wm.getWidgetByUid(w.uid)!); runtime.tick();
            for (const w of definition.widgets) wm.ensureLayout(wm.getWidgetByUid(w.uid)!); };
        const rows = [{ id: 1, name: 'Spellbooks', expandable: true, collapsed: true },
            { id: 2, name: 'Standard', expandable: true, parentId: 1, collapsed: true },
            { id: 3, name: 'Varrock', parentId: 2 }, { id: 4, name: 'Jewellery', expandable: true, collapsed: true },
            { id: 5, name: 'Edgeville', parentId: 4 }];
        runtime.handleSetText(uid(DATA_COMPONENTS[0]), JSON.stringify(rows));
        runtime.handleSetText(uid(C.LAYOUT), JSON.stringify({ active: 0, tabs: [[], [1, 2, 3, 4, 5], [], [], [], []] })); tick();
        const list = widget(C.LIST_VIEW), panel = widget(C.PANEL), root = widget(C.ROOT);
        assert.ok(list.x + list.width < panel.x, 'the list cannot overlap its preview');
        assert.equal(list.y, panel.y); assert.ok(list.y + list.height <= root.height - 14);
        assert.ok(widget(C.DETAIL_VIEW).height > 0, 'Fixed mode retains a scrollable details pane');
        for (const { button } of BUTTONS) {
            const w = widget(button);
            assert.ok(w.x >= panel.x && w.x + w.width <= panel.x + panel.width);
            assert.ok(w.y >= panel.y && w.y + w.height <= panel.y + panel.height);
        }
        runtime.handleWidgetOp(GROUP_ID, C.TAB_START + 1); tick();
        assert.equal(list.hidden,true,'a tab cannot show different rows in the preceding layout while its server update is pending');
        runtime.handleSetText(uid(C.LAYOUT),JSON.stringify({active:1,tabs:[[],[1,2,3,4,5],[],[],[],[]]})); tick();
        assert.ok(list.width > panel.width, 'Teleports use the full content width');
        runtime.handleWidgetClick(GROUP_ID, C.ROW_GLYPH_START); tick();
        runtime.handleWidgetClick(GROUP_ID, C.ROW_GLYPH_START + 1); tick();
        assert.equal(runtime.rowIdAt(GROUP_ID, C.ROW_LABEL_START + 2), 3);
        for (let slot = 0; slot < 4; slot++) {
            const w = widget(C.ROW_LABEL_START + slot), background = widget(C.ROW_BACKGROUND_START + slot);
            assert.ok(w.y >= background.y && w.y + w.height <= background.y + background.height);
            const x = root.x + list.x + w.x + w.width / 2;
            const y = root.y + list.y + w.y - list.scrollY + w.height / 2;
            if (y >= root.y + list.y + list.height) continue;
            const hits = collectWidgetsAtPointAcrossRoots(wm.getInputRoots(), x, y, new Map(),
                id => wm.getStaticChildrenByParentUid(id), id => wm.getAllGroupRoots(wm.interfaceParents.get(id)?.group ?? -1));
            assert.ok(hits.some(hit => hit.uid === w.uid), `expanded row ${slot} is clickable where it is painted ${JSON.stringify({x,y,root:[root.x,root.y,root.width,root.height],list:[list.x,list.y,list.width,list.height,list.scrollY],row:runtime.rowIdAt(GROUP_ID,C.ROW_LABEL_START+slot),hidden:[w.hidden,w.isHidden],text:w.text,w:[w.x,w.y,w.width,w.height],hits:hits.map(h=>h.fileId)})}`);
            assert.ok(!hits.some(hit => hit.fileId >= C.ROW_LABEL_START && hit.fileId < C.ROW_LABEL_START + 64 && hit.uid !== w.uid),
                'no adjacent row steals the pointer');
        }
        runtime.onInterfaceClosed(GROUP_ID);
    }
});

test("native primary row input visibly replaces selected details and action labels", () => {
    const f = fixture();
    f.data([{ id: 91, name: "Alice", panel: { title: "Alice", primary: "Edit player" } },
        { id: 92, name: "Bob", panel: { title: "Bob", primary: "Edit player" } }], [[91, 92]]);
    f.click(C.ROW_LABEL_START);
    assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Alice", JSON.stringify(f.packets.map(p => ({option: p.event?.option, op: p.payload?.opId, slot: p.payload?.slot}))));
    assert.equal(f.widgets.get(uid(BUTTONS[0].label)).text, "Edit player");
    f.click(C.ROW_LABEL_START + 1);
    assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Bob");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("Cheats combines testing and temporary modes with native selection and named actions", () => {
    const f = fixture();
    const rows = [{ id: 91, name: "Standard spellbook", panel: { title: "Standard spellbook", primary: "Switch" } },
        { id: 92, name: "Invisible", panel: { title: "Invisible", primary: "Enable", secondary: "Disable" } }];
    f.data(rows, [[], [], [], [], [91, 92], []]); f.tab(4);
    f.click(C.ROW_LABEL_START); assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Standard spellbook");
    f.click(C.ROW_LABEL_START + 1); assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Invisible");
    assert.equal(f.widgets.get(uid(BUTTONS[1].label)).text, "Disable");
    assert.equal(f.widgets.get(uid(BUTTONS[1].button)).hidden, false);
    assert.equal(f.widgets.get(uid(BUTTONS[2].button)).hidden, true);
    f.query("invisible"); assert.equal(f.row(), 92);
    assert.ok(f.packets.every(p => !p.target), "cheat filters never use private search");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("AdminPanel and thumbnail Monster Examine retain separate interface definitions", () => {
    const examine = require("../../server/plugins/interface/monsterexamine/Layout.MonsterExamine").DEFINITION;
    const admin = Layout.buildInterface();
    setCustomInterface(admin); setCustomInterface(examine);
    assert.equal(getCustomInterface(admin.groupId)?.tabs?.labels[0], "Players");
    assert.equal(getCustomInterface(examine.groupId)?.list?.cards?.maxColumns, 5);
    for (const definition of [admin, examine]) {
        const group = getDynamicWidgetGroup(definition.groupId)!;
        assert.equal(group.widgets.size, definition.widgets.length);
        assert.ok(definition.widgets.every((widget: any) => widget.uid >>> 16 === definition.groupId));
    }
});

test("private refresh replaces details after native primary selection and clears stale actions", () => {
    const f = fixture();
    const rows = [{ id: 1, name: "Alice", panel: { title: "Alice", primary: "Edit player", info: "Before" } },
        { id: 2, name: "Bob", panel: { title: "Bob", primary: "Edit player", secondary: "Go to", info: "" } }];
    f.data(rows, [[1, 2], [], [], [], [], []]);
    f.click(C.ROW_LABEL_START); rows[0].panel.info = "After";
    f.runtime.handleSetText(uid(DATA_COMPONENTS[0]), JSON.stringify(rows));
    assert.equal(f.widgets.get(uid(C.PANEL_INFO)).text, "After");
    f.click(C.ROW_LABEL_START + 1);
    assert.equal(f.widgets.get(uid(BUTTONS[1].button)).hidden, false);
    f.click(C.ROW_LABEL_START);
    assert.equal(f.widgets.get(uid(BUTTONS[1].button)).hidden, true);
    f.query("missing"); assert.equal(f.row(), null);
    assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("teleport folders start collapsed, reveal matching descendants and restore browsing state", () => {
    const f = fixture();
    const rows = [
        { id: 1, name: "Spellbooks", expandable: true, collapsed: true },
        { id: 2, name: "Standard spellbook", parentId: 1, expandable: true, collapsed: true },
        { id: 3, name: "Varrock teleport", parentId: 2 },
        { id: 4, name: "Falador teleport", parentId: 2 },
        { id: 5, name: "Jewellery", expandable: true, collapsed: true },
        { id: 6, name: "Amulet of glory", parentId: 5, expandable: true, collapsed: true },
        { id: 7, name: "Edgeville", parentId: 6 },
    ];
    f.data(rows, [[], rows.map(row => row.id), [], [], [], []]); f.tab(1);
    assert.deepEqual([f.row(0), f.row(1), f.row(2)], [1, 5, null]);
    f.query("varrock"); assert.deepEqual([f.row(0), f.row(1), f.row(2), f.row(3)], [1, 2, 3, null]);
    f.query(""); assert.deepEqual([f.row(0), f.row(1), f.row(2)], [1, 5, null]);
    assert.equal(f.runtime.handleWidgetClick(GROUP_ID, C.ROW_LABEL_START), true);
    assert.equal(f.row(1), 2);
    f.runtime.handleWidgetFocus(GROUP_ID, C.ROW_LABEL_START);
    assert.equal(f.row(1), 2, "focus pass does not toggle a folder twice");
    f.runtime.handleWidgetClick(GROUP_ID, C.ROW_LABEL_START + 1);
    assert.equal(f.row(2), 3);
    f.query("edgeville"); assert.deepEqual([f.row(0), f.row(1), f.row(2), f.row(3)], [5, 6, 7, null]);
    f.query(""); assert.deepEqual([f.row(0), f.row(1), f.row(2), f.row(3)], [1, 2, 3, 4]);
    f.runtime.onInterfaceClosed(GROUP_ID); f.runtime.onInterfaceOpened(GROUP_ID, true);
    assert.equal(f.row(2), 3, "browsing state survives a root remount");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("the visible item filter debounces typing and ignores late, repeated-query and old-session results", async () => {
    const f = fixture(); f.data([], [[], [], [], [], [], []]); f.tab(2);
    f.runtime.handleWidgetClick(GROUP_ID, C.SEARCH_INPUT);
    for (const char of "scythe") f.runtime.handleSearchKeyEvents([{ keyTyped: 0, keyPressed: char.charCodeAt(0) }]);
    assert.equal(f.packets.length, 0);
    await waitForDebounce(); assert.equal(f.packets.length, 1);
    const first = f.packets[0];
    assert.deepEqual(JSON.parse(first.target).query, "scythe");
    assert.equal(first.childId, C.SEARCH_REQUEST);
    const scythe = { id: 100, name: "Scythe of vitur", terms: "22325", panel: { title: "Scythe of vitur", info: "Item 22325", primary: "Give 1" } };
    f.respond(first, [scythe]); assert.equal(f.row(), 100);
    f.runtime.handleRowOp(100, 1); assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Scythe of vitur");
    f.query("shark"); assert.equal(f.row(), null); assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "");
    await waitForDebounce(); const second = f.packets.at(-1);
    f.respond(first, [scythe]); assert.equal(f.row(), null);
    f.query("scythe"); await waitForDebounce(); const third = f.packets.at(-1);
    f.respond(first, [scythe]); assert.equal(f.row(), null, "a repeated query still needs its latest sequence");
    f.respond(third, [scythe], { session: "old-session" }); assert.equal(f.row(), null);
    f.respond(third, [scythe]); assert.equal(f.row(), 100);
    f.respond(second, [{ id: 101, name: "Shark" }]); assert.equal(f.row(), 100);
    f.query("882"); await waitForDebounce(); const numeric = f.packets.at(-1);
    f.respond(numeric, [{ id: 102, name: "Bronze arrow", terms: "882" }]); assert.equal(f.row(), 102);
    f.query(""); assert.equal(f.row(), null); await waitForDebounce();
    f.respond(numeric, [{ id: 102, name: "Bronze arrow" }]); assert.equal(f.row(), null);
    assert.match(f.widgets.get(uid(C.STATUS)).text, /Search a name/);
    f.query("arrow"); f.tab(0); await waitForDebounce();
    assert.notEqual(JSON.parse(f.packets.at(-1).target).query, "arrow", "switching tabs cancels pending requests");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("list pooling and scroll bounds follow a taller viewport", () => {
    const f = fixture();
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}` }));
    f.data(rows, [rows.map(row => row.id), [], [], [], [], []]);
    const view = f.widgets.get(uid(C.LIST_VIEW));
    view.height = 700; f.runtime.tick();
    assert.equal(view.scrollHeight, 100 * f.definition.list.rowHeight);
    assert.equal(f.row(14), 15);
    assert.ok(f.definition.list.slotCount >= Math.ceil(view.height / f.definition.list.rowHeight));
    assert.equal(f.widgets.get(uid(C.UTILITY)).yPositionMode, 2);
    assert.equal(f.widgets.get(uid(C.PANEL)).heightMode, 1);
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("refreshing private results keeps scroll and selected details across a root remount", async () => {
    const f = fixture(); f.data([], [[], [], [], [], [], []]); f.tab(2); f.query("arrow");
    await waitForDebounce(); const packet = f.packets.at(-1);
    const rows = Array.from({ length: 50 }, (_, index) => ({ id: 200 + index, name: `Arrow ${index}`,
        panel: { title: `Arrow ${index}`, info: "Before refresh" } }));
    f.respond(packet, rows);
    const view = f.widgets.get(uid(C.LIST_VIEW)); view.scrollY = 20 * f.definition.list.rowHeight; f.runtime.tick();
    f.runtime.handleRowOp(220, 1); rows[20].panel.info = "After refresh"; f.respond(packet, rows);
    assert.equal(view.scrollY, 20 * f.definition.list.rowHeight);
    assert.equal(f.widgets.get(uid(C.PANEL_INFO)).text, "After refresh");
    const sent = f.packets.length;
    f.runtime.onInterfaceClosed(GROUP_ID); f.runtime.onInterfaceOpened(GROUP_ID, true);
    await waitForDebounce();
    assert.equal(f.packets.length, sent, "a remount reuses the authenticated result snapshot");
    assert.equal(view.scrollY, 20 * f.definition.list.rowHeight); assert.equal(f.row(), 220);
    assert.equal(f.widgets.get(uid(C.PANEL_INFO)).text, "After refresh");
    f.runtime.onInterfaceClosed(GROUP_ID);
});


test("NPC results use fitted bodies and named quantities through native primary input", async () => {
    const f = fixture(); f.data([], [[], [], [], [], [], []]); f.tab(5); f.query("goblin");
    await waitForDebounce(); const packet = f.packets.at(-1);
    f.respond(packet, [{ id: 301, name: "Goblin", npc: 123, panel: { title: "Goblin", info: "Level 2 / 5 HP", primary: "Spawn 1", secondary: "Spawn quantity" } }]);
    const icon = f.widgets.get(uid(C.ROW_ICON_START));
    assert.equal(icon.type, 6); assert.equal(icon.npcTypeId, 123); assert.equal(icon.npcFullBody, true);
    f.click(C.ROW_LABEL_START);
    assert.equal(f.widgets.get(uid(C.PANEL_TITLE)).text, "Goblin");
    assert.equal(f.widgets.get(uid(C.PANEL_ICON)).npcTypeId, 123);
    assert.equal(f.widgets.get(uid(BUTTONS[1].label)).text, "Spawn quantity");
    f.tab(2); f.query("arrow"); await waitForDebounce();
    f.respond(f.packets.at(-1), [{ id: 302, name: "Bronze arrow", icon: 882, panel: { title: "Bronze arrow", primary: "Add 1" } }]);
    f.click(C.ROW_LABEL_START);
    assert.equal(f.widgets.get(uid(C.ROW_ICON_START)).type, 5, "an item row restores its native icon widget");
    assert.equal(f.widgets.get(uid(C.PANEL_ICON)).type, 6, "the larger item preview retains its model widget");
    assert.equal(f.widgets.get(uid(C.PANEL_ICON)).itemId, 882);
    assert.notEqual(f.widgets.get(uid(C.PANEL_ICON)).isNpcChathead, true, "the old NPC body is removed");
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("legacy selection keeps preview visibility and its declared model configuration", () => {
    const f = fixture(definition => {
        delete definition.list.select.actionComponents;
        delete definition.list.select.autoHideIcon;
        const preview = definition.widgets.find((widget: any) => widget.uid === uid(C.PANEL_ICON));
        Object.assign(preview, { type: 6, modelType: 1, modelId: 42, hidden: true, isHidden: true });
    });
    f.data([{ id: 91, name: "Legacy item", icon: 882, panel: { title: "Legacy item" } }], [[91]]);
    f.click(C.ROW_LABEL_START);
    const preview = f.widgets.get(uid(C.PANEL_ICON));
    assert.equal(preview.hidden, true, "visibility remains controlled by the legacy declaration/server");
    assert.equal(preview.modelType, 1);
    assert.equal(preview.modelId, 42);
    assert.equal(preview.itemId, 882);
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test("folder labels and icons stay inside their compact rows after expansion", () => {
    const f = fixture();
    f.data([{ id: 1, name: "Spellbooks", expandable: true, collapsed: true },
        { id: 2, name: "Standard", parentId: 1 },
        { id: 3, name: "Jewellery", expandable: true, collapsed: true },
        { id: 4, name: "Glory", parentId: 3 }], [[], [1,2,3,4], [], [], [], []]);
    f.tab(1);
    f.widgets.get(uid(C.LIST_VIEW)).height = 300; f.runtime.tick();
    const label=f.widgets.get(uid(C.ROW_LABEL_START));
    assert.equal(label.rawHeight, f.definition.list.groupHeight, "a tall label steals clicks from the next folder");
    assert.equal(f.widgets.get(uid(C.ROW_ICON_START)).hidden, true, "no empty icon may overlap another folder");
    f.click(C.ROW_LABEL_START);
    assert.equal(f.row(1), 2);
    assert.equal(f.widgets.get(uid(C.ROW_LABEL_START+2)).rawHeight, f.definition.list.groupHeight, JSON.stringify([0,1,2,3].map(i=>({id:f.row(i),height:f.widgets.get(uid(C.ROW_LABEL_START+i)).rawHeight}))));
    f.runtime.onInterfaceClosed(GROUP_ID);
});

test('container editing uses native slot widgets and has no Spawn items section', () => {
    const definition = Layout.buildInterface();
    assert.ok(!Layout.SECTION_LABELS.includes('Spawn items'));
    const slots = definition.widgets.filter((w: any) => w.adminContainer === 'inventory');
    assert.equal(slots.length, 28);
    assert.deepEqual(slots.map((w: any) => [w.rawX, w.rawY]), Array.from({length:28}, (_,i) => [12+i%4*42, 5+Math.floor(i/4)*36]));
    assert.ok(slots.every((w: any) => w.type === 5 && (w.flags & (1<<20)) && w.dragThreshold === 6));
    const equipment = definition.widgets.filter((w: any) => w.adminContainer === 'equipment');
    assert.equal(equipment.length, 11);
    assert.ok(definition.widgets.some((w: any) => w.spriteId === 172));
    assert.ok(definition.widgets.some((w: any) => w.spriteId === 170));
});

test('native inventory and bank expose an outline for every editable slot', () => {
    const definition=Layout.buildInterface();
    for (const container of ['inventory','bank']) {
        const slots=definition.widgets.filter((w:any)=>w.adminContainer===container);
        const frames=definition.widgets.filter((w:any)=>w.adminContainerFrame===container);
        assert.equal(frames.length,slots.length,`${container} empty slots need visible outlines`);
        for(let i=0;i<slots.length;i++) {
            assert.equal(frames[i].parentUid,slots[i].parentUid);
            assert.deepEqual([frames[i].rawX,frames[i].rawY,frames[i].rawWidth,frames[i].rawHeight],
                [slots[i].rawX,slots[i].rawY,slots[i].rawWidth,slots[i].rawHeight]);
            assert.equal(frames[i].filled,false);
            assert.equal((frames[i].flags??0)&0x3e,0,'grid outlines must not consume slot actions');
        }
    }
});

test('native slots release clicks and drags through the real widget packet path', () => {
    const { processWidgetReleaseInput } = require('../game/widgets/input/widgetReleaseInput');
    const { WidgetInteractionController } = require('../game/widgets/WidgetInteractionController');
    const { WidgetActionRouter } = require('../game/widgets/WidgetActionRouter');
    const { state } = require('../network/serverConnection/state');
    const { setPacketSocket, flushPackets, getPacketWriter } = require('../network/packet');
    const { decodeClientPackets } = require('../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
    const V = require('../../server/plugins/tools/adminpanel/Containers.AdminPanel').C;
    const frames: Buffer[] = [], previous = state.socket;
    const socket = {readyState:1,send:(data:Uint8Array)=>frames.push(Buffer.from(data))};
    (globalThis as any).WebSocket ??= {OPEN:1}; getPacketWriter().clearBuffer(); state.socket=socket; setPacketSocket(socket);
    try {
        for (const start of [V.INVENTORY_START,V.EQUIPMENT_START,V.BANK_START]) {
            const f=fixture();
            const source=f.widgets.get(uid(start)), target=f.widgets.get(uid(start+1));
            Object.assign(source,{hidden:false,isHidden:false,itemId:882,itemQuantity:8,actions:['Edit quantity']});
            Object.assign(target,{hidden:false,isHidden:false,itemId:-1});
            const wm:any={getWidgetByUid:(id:number)=>f.widgets.get(id),getWidgetFlags:(w:any)=>w.flags??0,getWidgetOpMask:()=>0,
                invalidateWidgetRender(){},invalidateWidget(){},invalidateAll(){},isEffectivelyHidden:()=>false};
            const interaction=new WidgetInteractionController({getWidgetManager:()=>wm,getInputManager:()=>undefined,
                getRendererCanvas:()=>undefined,getChatRequestsByName:()=>new Map()});
            let router:any;
            const deps:any=new Proxy({getWidgetManager:()=>wm,getWidgetInteraction:()=>interaction,
                getInputManager:()=>undefined,getVarManager:()=>undefined,getCustomInterfaces:()=>f.runtime,
                getCs2Vm:()=>({invokeEventHandler:()=>false}),
                getPlayerDesign:()=>({handleWidgetAction:()=>false}),getTransmitCycles:()=>({cycleCntr:1}),
                handleWidgetAction:(event:any)=>router.handleWidgetAction(event)},
                {get:(object:any,key:any)=>object[key]??(()=>undefined)});
            router=new WidgetActionRouter(deps);
            const primary=createPrimaryWidgetActionResolver(deps,{} as any,wm,interaction);
            const sent=()=>{flushPackets();const packets=frames.flatMap(frame=>decodeClientPackets(frame));frames.length=0;return packets;};
            const press=()=>processWidgetClickInput(deps,{cachedHoverHits:null} as any,{input:{leftClickX:10,leftClickY:10},
                collectFromAllRoots:()=>[source],getWidgetFlags:(w:any)=>w.flags??0} as any,wm,interaction,primary,true);
            assert.equal(interaction.isWidgetDraggable(source),true);
            press();assert.equal(sent().length,0,'a click waits until release');
            processWidgetReleaseInput(deps,{mx:10,my:10} as any,wm,interaction,primary,false);
            const click=sent().find((packet:any)=>packet.widgetId===source.uid);
            assert.ok(click,'the released slot emits a native widget action');
            assert.equal(click.groupId,GROUP_ID);assert.equal(click.childId,start);
            press();interaction.isDraggingWidget=true;interaction.draggedOnWidget=target;
            processWidgetReleaseInput(deps,{mx:60,my:10} as any,wm,interaction,primary,false);
            const drag=sent().find((packet:any)=>packet.type==='widget_drag');
            assert.ok(drag);assert.equal(drag.sourceWidgetId,source.uid);assert.equal(drag.targetWidgetId,target.uid);
            assert.equal(drag.sourceItemId,882);assert.equal(drag.targetItemId,65535,'empty slots use the native unsigned sentinel');
            f.runtime.onInterfaceClosed(GROUP_ID);
        }
    } finally {state.socket=previous;setPacketSocket(previous);}
});

test('container controls do not overlap native slot areas in Fixed or Resizable mode', () => {
    const { createWidgetGroup }=require('../../server/plugins/interface/widgetGroup');
    const V=require('../../server/plugins/tools/adminpanel/Containers.AdminPanel').C;
    for(const [width,height] of [[512,334],[1000,800]]) {
        const base=createWidgetGroup(161),root=base.add(0,-1,{rawWidth:width,rawHeight:height});
        base.add(16,root,{rawWidth:width,rawHeight:height});setCustomInterface({groupId:161,widgets:base.widgets});
        const definition=Layout.buildInterface();setCustomInterface(definition);
        const wm=new WidgetManager({getIndex:()=>undefined} as any);
        wm.resize(width,height);wm.setRootInterface(161);wm.openSubInterface((161<<16)|16,GROUP_ID,0);
        for(const w of definition.widgets) wm.ensureLayout(wm.getWidgetByUid(w.uid)!);
        const view=wm.getWidgetByUid(uid(V.VIEW))!,undo=wm.getWidgetByUid(uid(C.CONTAINER_ADD))!;
        const intersects=(a:any,b:any)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
        assert.equal(intersects(view,undo),false,'Add item must stay outside the interactive native inventory');
        const bank=wm.getWidgetByUid(uid(V.BANK_VIEW))!;
        assert.ok(8+7*48+36<=bank.width,'all eight native bank columns fit');
        assert.equal(intersects(bank,undo),false);
    }
});

test('Bots details and scrollable forms stay separated from their empty state and footer at both window sizes', () => {
    const BotView = require('../../server/plugins/tools/adminpanel/BotView.AdminPanel');
    const B = BotView.C;
    for (const [width, height] of [[512, 334], [1000, 800]]) {
        const { createWidgetGroup } = require('../../server/plugins/interface/widgetGroup');
        const base = createWidgetGroup(161), parent = base.add(0, -1, { rawWidth: width, rawHeight: height });
        base.add(16, parent, {rawWidth:width,rawHeight:height});setCustomInterface({groupId:161,widgets:base.widgets});
        const definition=Layout.buildInterface();
        assert.equal(new Set(definition.widgets.map((w:any)=>w.uid)).size,definition.widgets.length,'native widget IDs are unique');
        setCustomInterface(definition);
        const wm=new WidgetManager({getIndex:()=>undefined} as any);wm.resize(width,height);wm.setRootInterface(161);wm.openSubInterface((161<<16)|16,GROUP_ID,0);
        const runtime=new CustomInterfaceRuntime({widgetManager:wm,getCacheSystem:()=>undefined,runWidgetScopedClientScript(){},fetchContent:async()=>({})});runtime.onInterfaceOpened(GROUP_ID);
        const w=(id:number)=>wm.getWidgetByUid(uid(id))!;
        const tick=()=>{for(const widget of definition.widgets)wm.ensureLayout(wm.getWidgetByUid(widget.uid)!);runtime.tick();for(const widget of definition.widgets)wm.ensureLayout(wm.getWidgetByUid(widget.uid)!);};
        runtime.handleSetText(uid(DATA_COMPONENTS[0]),JSON.stringify([{id:1,name:'Recruit / follow me',panel:{title:'Recruit / follow me',info:'Built-in bot',description:'Spawn a geared recruit that follows you and joins your clan chat.',primary:'Configure'}}]));
        runtime.handleSetText(uid(C.LAYOUT),JSON.stringify({active:6,tabs:[[],[],[],[],[],[],[1]]}));runtime.handleRowOp(1,1);tick();
        assert.equal(w(C.PANEL_EMPTY).hidden,true);
        assert.ok(w(C.PANEL_TITLE).y+w(C.PANEL_TITLE).height<=w(C.PANEL_INFO).y);
        assert.ok(w(C.PANEL_INFO2).y+w(C.PANEL_INFO2).height<=w(C.PANEL_DESCRIPTION).y);
        assert.equal(w(C.PANEL_DESCRIPTION).width,w(C.PANEL_TITLE).width,'bot descriptions use the full preview width');
        const visibility=new Map<number,boolean>();
        const state:any={tab:6,botConfig:{category:'spawn',view:'setup',key:'activity:recruit',count:3,setup:{}},botSnapshot:{managed:2,capacity:100,limit:20,launchers:[{key:'activity:recruit',name:'Recruit / follow me',description:'Configure a recruit.',setupFields:[]}],controls:{}}};
        const sender={sendString(value:string,id:number){if(!runtime.handleSetText(id,String(value)))wm.getWidgetByUid(id)!.text=String(value);}};
        BotView.render({}, {getPacketSender:()=>sender},state,uid,(ids:number[],hidden:boolean)=>ids.forEach(id=>visibility.set(id,hidden)));
        runtime.handleSetText(uid(C.LAYOUT),JSON.stringify({active:6,tabs:[[],[],[],[],[],[],[]],visibility:[...visibility].map(([component,hidden])=>({component,hidden}))}));tick();
        const view=w(B.VIEW),footer=w(B.PRIMARY),feedback=w(B.FEEDBACK);
        assert.ok(view.y+view.height<=feedback.y,'the scrolling form ends before its feedback');
        assert.ok(feedback.y+feedback.height<=footer.y,'feedback does not overlap the spawn button');
        assert.ok(w(B.COUNT_LABEL).x+w(B.COUNT_LABEL).width<w(B.MINUS).x);
        assert.ok(w(B.MINUS).x+w(B.MINUS).width<=w(B.COUNT).x);
        assert.ok(w(B.COUNT).x+w(B.COUNT).width<=w(B.PLUS).x);
        assert.ok(w(B.LOCATION).x+w(B.LOCATION).width<=view.width);
        view.scrollY=10000;runtime.tick();assert.ok(view.scrollY<=view.scrollHeight-view.height,'the form clamps scrolling to its native content');
        assert.equal(w(B.PRIMARY_LABEL).text,'Spawn 3 bots');
        runtime.onInterfaceClosed(GROUP_ID);
    }
});
