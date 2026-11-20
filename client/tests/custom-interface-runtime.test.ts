import assert from "node:assert/strict";

import {
    getDynamicWidgetGroup,
    loadFromPayload,
    setCustomInterface,
} from "../common/gamemode/GamemodeContentStore";
import { CustomInterfaceRuntime, filterRows, spanHeaders } from "../widgets/custom/CustomInterfaceRuntime";

// A server-declared interface: one search box, a 2x2 grid of result slots, status text.
const GROUP_ID = 30002;
const declaration = {
    groupId: GROUP_ID,
    search: {
        inputComponent: 4,
        backgroundComponent: 10,
        focusComponents: [4, 10],
        maxLength: 8,
        placeholder: "<col=8f7f66>Search items...</col>",
        caret: "|",
        textTemplate: "<col=e8ded0>%s</col>",
        focusColor: 0x3a3125,
        blurColor: 0x2b241b,
        endpoint: "/api/content/items",
        queryParam: "q",
        limit: 5,
        debounceMs: 0,
    },
    list: {
        viewComponent: 8,
        slotCount: 4,
        columns: 2,
        rowHeight: 44,
        iconStart: 100,
        iconBaseY: 2,
        backgroundStart: 20,
        itemLabel: "<col=ffcf70>%name</col> (id %id)",
    },
    status: {
        component: 5,
        idle: "idle",
        loading: "searching...",
        empty: "no matches",
        error: "search unavailable",
        matches: "Matches: %total",
        truncated: "Matches: %total (showing %shown)",
    },
    hint: { component: 6, text: "type to search" },
    scroll: [{ viewComponent: 12, scrollbarComponent: 13, contentHeight: 538 }],
};

// A definition fetched from /api/interfaces/<groupId> installs both halves: its widgets
// become a loadable group, and the rest becomes the behaviour declaration.
assert.equal(
    setCustomInterface({
        ...declaration,
        widgets: [
            { uid: (GROUP_ID << 16) | 0, parentUid: -1 },
            { uid: (GROUP_ID << 16) | 4, parentUid: (GROUP_ID << 16) | 0 },
        ],
    }),
    true,
);
assert.equal(getDynamicWidgetGroup(GROUP_ID)?.widgets.size, 2, "widgets become a group");
assert.equal(setCustomInterface({ groupId: 0 }), false, "a definition needs a group and widgets");

// The push channel still works for anything that has not moved to a resource yet.
loadFromPayload({
    gamemodeId: "test",
    datasets: [{ key: "customInterfaces", rows: [declaration] }],
} as any);

const uid = (component: number) => (GROUP_ID << 16) | component;
const widgets = new Map<number, any>();
for (const component of [4, 5, 6, 8, 10, 12, 13, 20, 21, 22, 23, 100, 101, 102, 103]) {
    widgets.set(uid(component), { uid: uid(component), width: 200, height: 88, scrollY: 0 });
}

const invalidatedScrolls: number[] = [];
const widgetManager = {
    getWidgetByUid: (id: number) => widgets.get(id),
    isEffectivelyHidden: (id: number) => !widgets.has(id) || !!widgets.get(id).hidden || !!widgets.get(id).isHidden,
    getInterfaceParentContainerUid: () => (1 << 16) | 16,
    invalidateWidgetRender: () => {},
    invalidateWidget: () => {},
    invalidateScroll: (widget: { uid: number }) => invalidatedScrolls.push(widget.uid),
} as any;

let requestedUrl = "";
(globalThis as any).fetch = async (url: string) => {
    requestedUrl = url;
    return {
        ok: true,
        json: async () => ({
            total: 9,
            rows: [
                { id: 4151, name: "Abyssal whip" },
                { id: 4152, name: "Abyssal whip (t)" },
            ],
        }),
    };
};

const scripts: number[] = [];
const sent: any[] = [];
const runtime = new CustomInterfaceRuntime({
    widgetManager,
    getCacheSystem: () => undefined,
    runWidgetScopedClientScript: (_uid, scriptId) => scripts.push(scriptId),
    fetchContent: async (path) => (await fetch(`http://localhost:43594${path}`)).json(),
    sendWidgetAction: (action) => sent.push(action),
});

// A group with no declaration is not ours to drive.
assert.equal(runtime.onInterfaceOpened(161), false);

assert.equal(runtime.onInterfaceOpened(GROUP_ID), true, "declared groups are adopted");
assert.equal(runtime.isSearchFocused(), true, "a search interface opens focused");
assert.equal(widgets.get(uid(6)).text, "type to search", "the hint is server supplied");
assert.equal(widgets.get(uid(5)).text, "idle", "empty query shows the idle status");
assert.equal(widgets.get(uid(4)).text, "|", "an empty focused box is just the caret");

// A declared scroll region gets the height it needs to scroll over.
assert.equal(widgets.get(uid(12)).scrollHeight, 538, "the view scrolls its declared content");
assert.equal(widgets.get(uid(12)).scrollWidth, 200);
assert.equal(widgets.get(uid(13)).scrollBarTargetUid, uid(12), "the scrollbar drives the view");
assert.equal(widgets.get(uid(13)).scrollBarAxis, "y");
const resizeCount = scripts.filter((scriptId) => scriptId === 72).length;
runtime.tick();
runtime.tick();
assert.equal(scripts.filter((scriptId) => scriptId === 72).length, resizeCount,
    "unchanged scrollbars are not resized every client tick");

// Typing renders through the server's template and respects maxLength.
const type = (text: string) =>
    runtime.handleSearchKeyEvents(
        [...text].map((char) => ({ keyTyped: 0, keyPressed: char.charCodeAt(0) })),
    );
assert.equal(type("whip"), true);
assert.equal(widgets.get(uid(4)).text, "<col=e8ded0>whip</col>|");
type("toolongtotype");
assert.equal(widgets.get(uid(4)).text, "<col=e8ded0>whiptool</col>|", "maxLength clamps input");

// Backspace, then blur.
runtime.handleSearchKeyEvents([{ keyTyped: 85, keyPressed: 0 }]);
assert.equal(widgets.get(uid(4)).text, "<col=e8ded0>whiptoo</col>|");
assert.equal(runtime.handleWidgetClick(GROUP_ID, 999), false, "clicks elsewhere blur the box");
assert.equal(runtime.isSearchFocused(), false);
assert.equal(widgets.get(uid(4)).text, "<col=e8ded0>whiptoo</col>", "an unfocused box drops the caret");
assert.equal(runtime.handleWidgetClick(GROUP_ID, 10), true, "clicking the box refocuses it");
assert.equal(runtime.isSearchFocused(), true);

// The rows come from the declared endpoint and bind to the slot components.
async function main(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
        requestedUrl,
        "http://localhost:43594/api/content/items?q=whiptoo&limit=5",
        "the query goes to the declared endpoint",
    );
    assert.equal(widgets.get(uid(100)).itemId, 4151);
    assert.equal(widgets.get(uid(100)).text, "<col=ffcf70>Abyssal whip</col> (id 4151)");
    assert.equal(widgets.get(uid(100)).hidden, false);
    assert.equal(widgets.get(uid(101)).itemId, 4152);
    assert.equal(widgets.get(uid(102)).hidden, true, "slots past the results stay hidden");
    assert.equal(widgets.get(uid(102)).itemId, -1);
    assert.equal(
        widgets.get(uid(5)).text,
        "Matches: 9 (showing 2)",
        "a truncated result set says so",
    );

    // A slow request shows the loading row until the results arrive.
    let resolveSlow: ((value: any) => void) | undefined;
    (globalThis as any).fetch = async () =>
        await new Promise((resolve) => {
            resolveSlow = resolve;
        });
    runtime.handleSetText(uid(4), "slow");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(widgets.get(uid(5)).text, "searching...", "an in-flight fetch shows the loading row");
    resolveSlow!({ ok: true, json: async () => ({ total: 1, rows: [{ id: 1, name: "One" }] }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(widgets.get(uid(5)).text, "Matches: 1", "loading clears when the fetch resolves");

    // A failed request clears stale rows and explains the failure.
    (globalThis as any).fetch = async () => {
        throw new Error("boom");
    };
    runtime.handleSetText(uid(4), "fail");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(widgets.get(uid(5)).text, "search unavailable", "a failed fetch shows the error row");
    assert.equal(widgets.get(uid(100)).hidden, true, "stale rows are cleared on failure");

    // Closing releases the interface.
    runtime.onInterfaceClosed(GROUP_ID);
    assert.equal(runtime.isSearchFocused(), false);
    assert.equal(runtime.handleSearchKeyEvents([{ keyTyped: 0, keyPressed: 97 }]), false);

    // Use the actual Commands declaration with private rows sent over the game socket.
    const Commands = require("../../server/plugins/interface/Commands.plugin.js");
    let commandsDefinition: any;
    Commands.register({
        registerCustomInterface: (definition: any) => { commandsDefinition = definition; },
        registerCommand() {},
        onCustomEvent() {},
    });
    setCustomInterface(commandsDefinition);
    for (const widget of commandsDefinition.widgets) {
        widgets.set(widget.uid, { ...widget });
    }
    const { COMPONENT, uid: commandUid } = Commands._test;
    for (const component of [COMPONENT.SEARCH_BOX, COMPONENT.SEARCH_INPUT]) {
        assert.deepEqual(widgets.get(commandUid(component)).actions, ["Search"]);
        assert.ok(widgets.get(commandUid(component)).flags & (1 << 1), "search widgets accept a native menu click");
    }
    requestedUrl = "";
    runtime.onInterfaceOpened(commandsDefinition.groupId);
    const commandRows = Array.from({ length: 300 }, (_, index) => ({
        id: index + 1, name: `::test${index} - ${index === 299 ? "Teleport to coordinates" : "Plugin command"}`,
    }));
    runtime.handleSetText(commandUid(COMPONENT.DATA), JSON.stringify(commandRows));
    assert.equal(widgets.get(commandUid(COMPONENT.STATUS)).text, "Commands: 300");
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).text, "::test0 - Plugin command");
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).itemId, -1, "text results are not inventory items");
    const commandsView = widgets.get(commandUid(COMPONENT.LIST_VIEW));
    assert.equal(commandsView.scrollHeight, 300 * 16);
    commandsView.scrollY = 280 * 16;
    runtime.tick();
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).text, "::test280 - Plugin command",
        "virtual rows allow scrolling past the old 128-row limit");
    runtime.handleSetText(commandUid(COMPONENT.SEARCH_INPUT), "  TELEPORT  ");
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).text, "::test299 - Teleport to coordinates",
        "the prefill searches descriptions without case sensitivity");
    assert.equal(commandsView.scrollY, 0, "filtering resets scroll");
    runtime.handleSetText(commandUid(COMPONENT.SEARCH_INPUT), "test29");
    assert.equal(widgets.get(commandUid(COMPONENT.STATUS)).text, "Commands: 11", "names are searchable too");
    runtime.handleWidgetClick(commandsDefinition.groupId, COMPONENT.LIST_VIEW);
    assert.equal(runtime.isSearchFocused(), false);
    runtime.handleWidgetClick(commandsDefinition.groupId, COMPONENT.SEARCH_BOX);
    assert.equal(runtime.isSearchFocused(), true, "clicking the box resumes filtering");
    type("z");
    assert.equal(widgets.get(commandUid(COMPONENT.STATUS)).text, "No matching commands.");
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).hidden, true);
    runtime.handleSearchKeyEvents([{ keyTyped: 85, keyPressed: 0 }]);
    assert.equal(widgets.get(commandUid(COMPONENT.STATUS)).text, "Commands: 11");
    runtime.handleSetText(commandUid(COMPONENT.SEARCH_INPUT), "");
    assert.equal(widgets.get(commandUid(COMPONENT.STATUS)).text, "Commands: 300", "clearing restores the full catalog");
    runtime.handleSetText(commandUid(COMPONENT.DATA), "invalid JSON");
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).hidden, true, "bad data clears old rows");
    runtime.handleSetText(commandUid(COMPONENT.DATA), JSON.stringify(commandRows));
    runtime.onInterfaceClosed(commandsDefinition.groupId);
    runtime.onInterfaceOpened(commandsDefinition.groupId);
    assert.equal(widgets.get(commandUid(COMPONENT.ROW_START)).hidden, true, "reopening awaits the new player's catalog");
    assert.equal(requestedUrl, "", "private command rows never use a public HTTP endpoint");
    runtime.onInterfaceClosed(commandsDefinition.groupId);
    assert.equal(runtime.rowIdAt(commandsDefinition.groupId, COMPONENT.ROW_START), undefined,
        "rows of a list that did not ask for clicks are not ours");

    // A clickable list with separate icons and labels, section headers and hidden search terms.
    const LIST_GROUP = 30009;
    const listUid = (component: number) => (LIST_GROUP << 16) | component;
    setCustomInterface({
        groupId: LIST_GROUP,
        widgets: [{ uid: listUid(0), parentUid: -1 }],
        search: { inputComponent: 1, dataComponent: 2 },
        list: {
            viewComponent: 3, slotCount: 2, columns: 1, rowHeight: 20,
            iconStart: 10, labelStart: 20, labelBaseY: 4, backgroundStart: 30,
            itemLabel: "%name<col=ff0000>%detail</col>", headerLabel: "<col=ff981f>%name</col>",
            clickable: true,
            select: { texts: { title: 40, note: 41 }, iconComponent: 42, showComponents: [43] },
        },
    });
    for (const component of [1, 2, 3, 10, 11, 20, 21, 30, 31, 40, 41, 42, 43]) {
        widgets.set(listUid(component), { uid: listUid(component), width: 200, height: 40, scrollY: 0,
            actions: component >= 20 && component < 30 ? ["Select", "Teleport"] : undefined });
    }
    runtime.onInterfaceOpened(LIST_GROUP);
    runtime.handleSetText(listUid(2), JSON.stringify([
        { id: 1, name: "Bosses", header: true },
        { id: 2, name: "Nex", icon: 26348, terms: "godwars ancient", panel: { title: "<col=ff981f>Nex</col>", note: "Kill count: 3" } },
        { id: 3, name: "Callisto", icon: 13178, detail: " Lvl 44" },
        { id: 4, name: "Minigames", header: true },
        { id: 5, name: "Barrows", icon: 4708 },
    ]));
    const listView = widgets.get(listUid(3));
    assert.equal(listView.scrollHeight, 5 * 20, "headers take a row each");
    assert.equal(widgets.get(listUid(20)).text, "<col=ff981f>Bosses</col>", "a header uses its own label");
    assert.equal(widgets.get(listUid(10)).hidden, true, "a header has no icon");
    assert.equal(widgets.get(listUid(30)).hidden, true, "a header has no hover background");
    assert.deepEqual(widgets.get(listUid(20)).actions, [], "a header offers no ops");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 20), null, "a header click sends nothing");
    assert.equal(widgets.get(listUid(11)).itemId, 26348, "icons show the row's item, not its id");
    assert.equal(widgets.get(listUid(21)).text, "Nex<col=ff0000></col>");
    assert.equal(widgets.get(listUid(21)).rawY, 24, "labels follow their own base y");
    assert.deepEqual(widgets.get(listUid(21)).actions, ["Select", "Teleport"]);
    assert.equal(runtime.rowIdAt(LIST_GROUP, 21), 2, "a label click carries its row id");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 11), 2, "so does the icon");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 31), 2, "and the background");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 1), undefined, "other components are not rows");
    listView.scrollY = 40;
    runtime.tick();
    assert.equal(widgets.get(listUid(20)).text, "Callisto<col=ff0000> Lvl 44</col>", "detail is plain text in the template");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 20), 3, "scrolled slots carry the row they now show");
    assert.deepEqual(widgets.get(listUid(20)).actions, ["Select", "Teleport"], "a reused header slot gets its ops back");
    runtime.handleSetText(listUid(1), "ancient");
    assert.equal(widgets.get(listUid(20)).text, "<col=ff981f>Bosses</col>", "a header stays while its rows match");
    assert.equal(widgets.get(listUid(21)).text, "Nex<col=ff0000></col>", "hidden terms are searchable");
    assert.equal(widgets.get(listUid(31)).hidden, false);
    runtime.handleSetText(listUid(1), "barrows");
    assert.equal(widgets.get(listUid(20)).text, "<col=ff981f>Minigames</col>", "headers without matches drop out");
    assert.equal(runtime.rowIdAt(LIST_GROUP, 21), 5);
    // Selecting shows the row's panel at once; only the select op does.
    widgets.get(listUid(43)).hidden = true;
    widgets.get(listUid(43)).isHidden = true;
    runtime.handleRowOp(2, 2);
    assert.equal(widgets.get(listUid(40)).text, undefined, "other ops leave the panel to the server");
    runtime.handleRowOp(2, 1);
    assert.equal(widgets.get(listUid(40)).text, "<col=ff981f>Nex</col>", "panel text keeps server markup");
    assert.equal(widgets.get(listUid(41)).text, "Kill count: 3");
    assert.equal(widgets.get(listUid(42)).itemId, 26348, "the panel icon is the row's");
    assert.equal(widgets.get(listUid(43)).hidden, false, "declared components appear");
    runtime.handleRowOp(5, 1);
    assert.equal(widgets.get(listUid(40)).text, "", "a row without panel text clears it");
    runtime.handleRowOp(2, 1);
    runtime.handleSetText(listUid(1), "");
    listView.scrollY = 20;
    runtime.handleSetText(listUid(2), JSON.stringify([
        { id: 2, name: "Nex", icon: 26348, panel: { title: "Nex", note: "Kill count: 4" } },
        { id: 3, name: "Callisto" },
        { id: 5, name: "Barrows" },
        { id: 6, name: "Zulrah" },
    ]));
    assert.equal(widgets.get(listUid(41)).text, "Kill count: 4", "new data redraws the selected row's panel");
    assert.equal(listView.scrollY, 20, "new data for the same list keeps the scroll");
    runtime.handleSetText(listUid(1), "nex");
    assert.equal(listView.scrollY, 0, "a new query starts from the top");
    runtime.onInterfaceClosed(LIST_GROUP);

    // Tabs switch client-side over a catalog of rows and a per-tab layout.
    const TAB_GROUP = 30010;
    const tabUid = (component: number) => (TAB_GROUP << 16) | component;
    setCustomInterface({
        groupId: TAB_GROUP,
        widgets: [{ uid: tabUid(0), parentUid: -1 }],
        search: { inputComponent: 1, dataComponent: 2 },
        list: {
            viewComponent: 3, slotCount: 3, columns: 1, rowHeight: 20,
            iconStart: 10, labelStart: 20, backgroundStart: 30, itemLabel: "%name", clickable: true,
            select: { texts: { title: 40 } },
        },
        tabs: {
            components: [50, 51], labelComponents: [60, 61], labels: ["Bosses", "Saved"],
            activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>",
            layoutComponent: 4, clearQuery: true,
        },
    });
    for (const component of [1, 2, 3, 4, 10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 50, 51, 60, 61]) {
        widgets.set(tabUid(component), { uid: tabUid(component), width: 200, height: 60, scrollY: 0 });
    }
    runtime.onInterfaceOpened(TAB_GROUP);
    runtime.handleSetText(tabUid(2), JSON.stringify([
        { id: 1, name: "Nex", panel: { title: "Nex" } },
        { id: 2, name: "Zulrah", panel: { title: "Zulrah" } },
        { id: 3, name: "Vorkath", panel: { title: "Vorkath" } },
    ]));
    runtime.handleSetText(tabUid(4), JSON.stringify({ active: 0, tabs: [[{ header: "Bosses" }, 1, 2, 3], [2]] }));
    assert.equal(widgets.get(tabUid(60)).text, "<col=ffffff>Bosses</col>", "the active tab is highlighted");
    assert.equal(widgets.get(tabUid(61)).text, "<col=ffd27f>Saved</col>");
    assert.equal(widgets.get(tabUid(20)).text, "Bosses", "headers come from the layout");
    assert.equal(widgets.get(tabUid(21)).text, "Nex", "rows come from the catalog");
    assert.equal(runtime.rowIdAt(TAB_GROUP, 20), null, "a layout header is not clickable");
    runtime.handleSetText(tabUid(1), "zul");
    assert.equal(widgets.get(tabUid(21)).text, "Zulrah");
    runtime.handleWidgetOp(TAB_GROUP, 51);
    assert.equal(widgets.get(tabUid(61)).text, "<col=ffffff>Saved</col>", "a tab click switches at once");
    assert.equal(widgets.get(tabUid(60)).text, "<col=ffd27f>Bosses</col>");
    assert.equal(widgets.get(tabUid(1)).text, "", "and clears the search");
    assert.equal(widgets.get(tabUid(20)).text, "Zulrah");
    assert.equal(widgets.get(tabUid(21)).hidden, true, "only that tab's rows show");
    runtime.handleRowOp(2, 1);
    assert.equal(widgets.get(tabUid(40)).text, "Zulrah");
    runtime.handleSetText(tabUid(4), JSON.stringify({ tabs: [[1, 2, 3], [2, 3]] }));
    assert.equal(widgets.get(tabUid(61)).text, "<col=ffffff>Saved</col>", "a refresh without active keeps the tab");
    assert.equal(widgets.get(tabUid(21)).text, "Vorkath", "and shows the refreshed rows");
    runtime.handleWidgetOp(TAB_GROUP, 60);
    assert.equal(widgets.get(tabUid(60)).text, "<col=ffffff>Bosses</col>", "a label click switches too");
    runtime.handleWidgetOp(TAB_GROUP, 99);
    assert.equal(widgets.get(tabUid(60)).text, "<col=ffffff>Bosses</col>", "other widgets leave the tab");
    runtime.handleSetText(tabUid(2), JSON.stringify([{ id: 2, name: "Zulrah", panel: { title: "Zulrah (favourite)" } }]));
    assert.equal(widgets.get(tabUid(40)).text, "Zulrah (favourite)", "the selection redraws from a new catalog");
    runtime.onInterfaceClosed(TAB_GROUP);

    // A long list arrives in parts, joined in their declared order.
    const PART_GROUP = 30011;
    const partUid = (component: number) => (PART_GROUP << 16) | component;
    setCustomInterface({
        groupId: PART_GROUP,
        widgets: [{ uid: partUid(0), parentUid: -1 }],
        search: { inputComponent: 1, dataComponent: 2, extraDataComponents: [5] },
        list: { viewComponent: 3, slotCount: 3, columns: 1, rowHeight: 20, iconStart: 10, backgroundStart: 30, itemLabel: "%name", textOnly: true },
        status: { component: 4, matches: "%total" },
    });
    for (const component of [1, 2, 3, 4, 5, 10, 11, 12, 30, 31, 32]) {
        widgets.set(partUid(component), { uid: partUid(component), width: 200, height: 60, scrollY: 0 });
    }
    runtime.onInterfaceOpened(PART_GROUP);
    runtime.handleSetText(partUid(5), JSON.stringify([{ id: 3, name: "Three" }]));
    runtime.handleSetText(partUid(2), JSON.stringify([{ id: 1, name: "One" }, { id: 2, name: "Two" }]));
    assert.equal(widgets.get(partUid(4)).text, "3", "every part counts");
    assert.deepEqual([10, 11, 12].map((component) => widgets.get(partUid(component)).text), ["One", "Two", "Three"],
        "parts join in declared order, whichever arrives first");
    runtime.handleSetText(partUid(5), "[]");
    assert.equal(widgets.get(partUid(4)).text, "2", "a part can be replaced on its own");
    runtime.onInterfaceClosed(PART_GROUP);

    const SCROLL_GROUP = 30110;
    const scrollUid = (component: number) => (SCROLL_GROUP << 16) | component;
    setCustomInterface({ groupId: SCROLL_GROUP, widgets: [], scroll: [{
        viewComponent: 1, scrollbarComponent: 2, contentHeight: 500,
        contentHeightComponent: 3, resetOnComponents: [4],
    }, {
        viewComponent: 5, contentHeight: 500, contentHeightComponent: 6, resetOnComponents: [4],
    }] });
    widgets.set(scrollUid(1), { uid: scrollUid(1), width: 100, height: 100, scrollY: 75 });
    widgets.set(scrollUid(2), { uid: scrollUid(2), width: 16, height: 100 });
    widgets.set(scrollUid(3), { uid: scrollUid(3), text: "240" });
    widgets.set(scrollUid(5), { uid: scrollUid(5), width: 100, height: 100, scrollY: 75 });
    widgets.set(scrollUid(6), { uid: scrollUid(6), text: "240" });
    invalidatedScrolls.length = 0;
    assert.equal(runtime.onInterfaceOpened(SCROLL_GROUP), true);
    assert.ok(invalidatedScrolls.includes(scrollUid(5)), "dynamic height redraws a view without a scrollbar");
    const scrollView = widgets.get(scrollUid(1));
    assert.equal(scrollView.scrollHeight, 240, "server text controls scroll height");
    scrollView.scrollY = 75;
    assert.equal(runtime.handleWidgetClick(SCROLL_GROUP + 1, 4), false);
    assert.equal(scrollView.scrollY, 75, "another group's button does not reset this view");
    assert.equal(runtime.handleWidgetClick(SCROLL_GROUP, 7), false);
    assert.equal(scrollView.scrollY, 75, "only declared buttons reset scrolling");
    invalidatedScrolls.length = 0;
    assert.equal(runtime.handleWidgetClick(SCROLL_GROUP, 4), false, "the tab click still reaches the server");
    assert.equal(scrollView.scrollY, 0, "tab changes reset the scrolling view");
    assert.equal(widgets.get(scrollUid(5)).scrollY, 0, "one button can reset multiple regions");
    assert.ok(invalidatedScrolls.includes(scrollUid(5)), "reset redraws a view without a scrollbar");
    widgets.get(scrollUid(3)).text = "40";
    widgets.get(scrollUid(6)).text = "40";
    widgets.get(scrollUid(5)).scrollY = 75;
    scrollView.scrollY = 75;
    invalidatedScrolls.length = 0;
    runtime.tick();
    assert.equal(widgets.get(scrollUid(5)).scrollY, 0, "dynamic shrink works without a scrollbar");
    assert.ok(invalidatedScrolls.includes(scrollUid(5)), "dynamic shrink redraws the scrolling view");
    assert.equal(scrollView.scrollHeight, 100, "short content fills the view without blank scrolling");
    assert.equal(scrollView.scrollY, 0, "shrinking content clamps the existing scroll position");
    widgets.get(scrollUid(3)).text = "200";
    scrollView.scrollY = 175;
    runtime.tick();
    assert.equal(scrollView.scrollY, 100, "shrinking overflow clamps to its remaining range");
    widgets.get(scrollUid(3)).text = "0";
    runtime.tick();
    assert.equal(scrollView.scrollHeight, 100, "zero content height is valid and fills the viewport");
    for (const invalid of ["invalid", "", " ", "-1", "Infinity"]) {
        widgets.get(scrollUid(3)).text = invalid;
        runtime.tick();
        assert.equal(scrollView.scrollHeight, 500, "invalid dynamic heights use the declared fallback");
    }
    runtime.onInterfaceClosed(SCROLL_GROUP);

    // Search-only rows (other markets' items) appear only while a query is typed.
    const marketRows = [
        { id: 900, name: "Melee", header: true },
        { id: 1, name: "Rune sword" },
        { id: 901, name: "Vote", header: true, searchOnly: true },
        { id: 2, name: "Rune pouch", searchOnly: true },
    ];
    assert.deepEqual(filterRows(marketRows, "").map((row) => row.id), [900, 1], "browsing hides search-only rows");
    assert.deepEqual(filterRows(marketRows, "rune").map((row) => row.id), [900, 1, 901, 2], "a search reaches them");

    // Optional list extras: zebra stripes, a second text line, parts that ride with the row,
    // menu names, section jump buttons and full-width headers. All off unless declared.
    const EXTRA_GROUP = 30120;
    const extraUid = (component: number) => (EXTRA_GROUP << 16) | component;
    setCustomInterface({
        groupId: EXTRA_GROUP,
        widgets: [{ uid: extraUid(0), parentUid: -1 }],
        search: { inputComponent: 1, dataComponent: 2, focusOnOpen: false, placeholder: "Search..." },
        list: {
            viewComponent: 3, slotCount: 4, columns: 1, rowHeight: 20,
            iconStart: 10, labelStart: 20, backgroundStart: 30, itemLabel: "<b>%name</b>",
            detailStart: 40, detailLabel: "%detail", rowParts: [50],
            stripeColors: [0x111111, 0x222222], nameTarget: true, textOnly: true,
            jumpComponents: [60, 61], jumpLit: { components: [70, 71], textTemplate: "<col=ffffff>%s</col>" },
            jumpClearsQuery: true,
        },
    });
    for (const component of [1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 70, 71]) {
        widgets.set(extraUid(component), { uid: extraUid(component), width: 200, height: 40, scrollY: 0, rawY: component >= 50 && component < 60 ? 18 : 0 });
    }
    widgets.get(extraUid(60)).text = "Melee";
    widgets.get(extraUid(61)).text = "Magic";
    assert.equal(runtime.onInterfaceOpened(EXTRA_GROUP), true);
    assert.equal(runtime.isSearchFocused(), false, "focusOnOpen: false opens unfocused");
    assert.equal(widgets.get(extraUid(1)).text, "Search...", "so the placeholder shows");
    runtime.handleSetText(extraUid(2), JSON.stringify([
        { id: 900, name: "Melee", header: true },
        { id: 1, name: "Rune sword", detail: "Sharp" },
        { id: 2, name: "Rune axe", detail: "Chops" },
        { id: 901, name: "Magic", header: true },
        { id: 3, name: "Rune staff", detail: "Zaps" },
        { id: 4, name: "Air rune", detail: "Light" },
        { id: 5, name: "Fire rune", detail: "Hot" },
    ]));
    assert.equal(widgets.get(extraUid(31)).color, 0x222222, "row 1 takes the odd stripe");
    assert.equal(widgets.get(extraUid(32)).color, 0x111111, "row 2 takes the even stripe");
    assert.equal(widgets.get(extraUid(41)).text, "Sharp", "the detail line fills from detailLabel");
    assert.equal(widgets.get(extraUid(40)).text, "", "a header has no detail line");
    assert.equal(widgets.get(extraUid(52)).rawY, 18 + 40, "a row part keeps its own offset inside the row");
    assert.equal(widgets.get(extraUid(50)).hidden, true, "row parts hide on a header");
    assert.equal(widgets.get(extraUid(21)).opBase, "<col=ff9040>Rune sword</col>", "nameTarget names the row in menus");
    runtime.handleWidgetOp(EXTRA_GROUP, 61);
    assert.equal(widgets.get(extraUid(3)).scrollY, 60, "the second jump button scrolls to the second header");
    assert.equal(!!widgets.get(extraUid(71)).hidden, false, "its plate lights at once");
    assert.equal(widgets.get(extraUid(70)).hidden, true, "and the other plate goes dark");
    assert.equal(widgets.get(extraUid(61)).text, "<col=ffffff>Magic</col>", "its text takes the lit template");
    runtime.handleWidgetClick(EXTRA_GROUP, 1);
    type("axe");
    runtime.handleWidgetOp(EXTRA_GROUP, 60);
    assert.equal(runtime.isSearchFocused(), false, "jumpClearsQuery drops the query and the focus");
    assert.equal(widgets.get(extraUid(1)).text, "Search...");
    assert.equal(widgets.get(extraUid(61)).text, "Magic", "an unlit button goes back to plain text");
    runtime.onInterfaceClosed(EXTRA_GROUP);

    // headerSpan gives each header a whole grid row; spanHeaders pads the rows for it.
    const grid = spanHeaders([
        { id: 900, name: "Melee", header: true },
        { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
        { id: 901, name: "Magic", header: true },
        { id: 4, name: "d" },
    ], 2);
    assert.deepEqual(grid.map((row) => row.name), ["Melee", "", "a", "b", "c", "", "Magic", "", "d"],
        "headers sit alone on their row, blanks fill around them");

    // Header shapes belong to widgets, even when another interface reuses the same slot.
    for (const [groupId, width] of [[30121, 100], [30122, 250]]) {
        const rowUid = (component: number) => (groupId << 16) | component;
        setCustomInterface({
            groupId,
            widgets: [{ uid: rowUid(0), parentUid: -1 }],
            search: { inputComponent: 1, dataComponent: 2 },
            list: {
                viewComponent: 3, slotCount: 1, columns: 1, rowHeight: 20,
                iconStart: 10, labelStart: 20, backgroundStart: 30,
                headerSpan: {}, stripeColors: [0x111111, 0x222222],
            },
        });
        for (const component of [1, 2, 3, 10, 20, 30]) {
            widgets.set(rowUid(component), {
                uid: rowUid(component), width, rawWidth: width, height: 20, rawHeight: 20,
                rawY: 0, scrollY: 0, color: 0x999999,
            });
        }
        assert.equal(runtime.onInterfaceOpened(groupId), true);
        runtime.handleSetText(rowUid(2), JSON.stringify([
            { id: 900, name: "Section", header: true },
            { id: 1, name: "Item" },
            { id: 2, name: "Other item" },
        ]));
        const view = widgets.get(rowUid(3));
        for (const row of [1, 2]) {
            view.scrollY = row * 20;
            runtime.tick();
            assert.equal(widgets.get(rowUid(20)).width, width, "a recycled label restores this interface's width");
            assert.equal(widgets.get(rowUid(30)).width, width, "a recycled background restores this interface's width");
            assert.equal(widgets.get(rowUid(20)).height, 20, "the header height is restored for item rows");
            assert.equal(widgets.get(rowUid(30)).color, row % 2 ? 0x222222 : 0x111111,
                "stripes survive restoring the header shape and follow the scrolled row");
        }
        runtime.onInterfaceClosed(groupId);
    }

    // An overlay panel keeps no list state, and its hotkeys click its components.
    const OVERLAY_GROUP = 30130;
    const overlayUid = (component: number) => (OVERLAY_GROUP << 16) | component;
    setCustomInterface({
        groupId: OVERLAY_GROUP,
        widgets: [{ uid: overlayUid(0), parentUid: -1 }],
        overlay: true,
        hotkeys: { gate: 5, keys: [{ key: "F1", component: 6 }] },
    });
    widgets.set(overlayUid(5), { uid: overlayUid(5) });
    widgets.set(overlayUid(6), { uid: overlayUid(6) });
    assert.equal(runtime.onInterfaceOpened(OVERLAY_GROUP), true);
    const key = (name: string) => ({ key: name, repeat: false, ctrlKey: false, altKey: false, metaKey: false }) as any;
    assert.equal(runtime.handleHotkey(key("F2")), false, "undeclared keys pass through");
    assert.equal(runtime.handleHotkey(key("F1")), true, "a declared key is taken");
    assert.deepEqual(sent.map((action) => [action.childId, action.opId]), [[6, 1]], "and clicks op 1");
    widgets.get(overlayUid(5)).hidden = true;
    assert.equal(runtime.handleHotkey(key("F1")), false, "a hidden gate turns the hotkeys off");
    runtime.onInterfaceClosed(OVERLAY_GROUP);
    widgets.get(overlayUid(5)).hidden = false;
    assert.equal(runtime.handleHotkey(key("F1")), false, "a closed overlay has no hotkeys");
    console.log("custom-interface-runtime.test.ts: all tests passed");
}

void main();
