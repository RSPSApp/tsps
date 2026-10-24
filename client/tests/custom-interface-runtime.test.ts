import assert from "node:assert/strict";

import {
    getDynamicWidgetGroup,
    loadFromPayload,
    setCustomInterface,
} from "../common/gamemode/GamemodeContentStore";
import { CustomInterfaceRuntime } from "../widgets/custom/CustomInterfaceRuntime";

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

const widgetManager = {
    getWidgetByUid: (id: number) => widgets.get(id),
    getInterfaceParentContainerUid: () => (1 << 16) | 16,
    invalidateWidgetRender: () => {},
    invalidateWidget: () => {},
    invalidateScroll: () => {},
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
const runtime = new CustomInterfaceRuntime({
    widgetManager,
    getCacheSystem: () => undefined,
    runWidgetScopedClientScript: (_uid, scriptId) => scripts.push(scriptId),
    fetchContent: async (path) => (await fetch(`http://localhost:43594${path}`)).json(),
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

    console.log("custom-interface-runtime.test.ts: all tests passed");
}

void main();
