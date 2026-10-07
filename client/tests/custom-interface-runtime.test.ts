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

    console.log("custom-interface-runtime.test.ts: all tests passed");
}

void main();
