import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { loadFromPayload, setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { STANDARD_GAMEFRAME_ROOT, loadGameframePaneRedirect } from "../game/widgets/gameframePanes";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { CustomInterfaceRuntime } from "../widgets/custom/CustomInterfaceRuntime";
import { PendingInterfaceUpdates } from "../widgets/custom/PendingInterfaceUpdates";
import { HeldWidgetProperties } from "../widgets/HeldWidgetProperties";
import { markWidgetInteractionDirty } from "../widgets/WidgetInteraction";
import { WidgetManager } from "../widgets/WidgetManager";
import {
    encodeWidgetOpenSub,
    encodeWidgetSetRoot,
    encodeWidgetSetText,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// A server-defined interface opened right after login, while the welcome screen is the root:
// its definition is fetched, the data sent with the open is held and applied, and pressing
// Play (the gameframe replacing the welcome screen) must not lose it. Runs OsrsClient's own
// widget handler on wire packets, with widget groups the server defines (no cache needed).
const log = console.log;
console.log = () => {}; // OsrsClient and the content store log every step
const source = ts.createSourceFile("OsrsClient.ts",
    fs.readFileSync(path.resolve(__dirname, "../game/OsrsClient.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const METHODS = new Set(["mountSubInterface", "mapGameframeTargetUid", "getGameframePaneRedirect",
    "holdForUnloadedGroup", "cancelPendingInterfaceOpen"]);
const methods: string[] = [];
let handlerSource = "";
let heldActionsSource = "";
const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleWidgetPayload") handlerSource = node.initializer!.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "HELD_WIDGET_ACTIONS") heldActionsSource = node.initializer!.getText(source);
    if (ts.isMethodDeclaration(node) && METHODS.has(node.name.getText(source))) methods.push(node.getText(source));
    ts.forEachChild(node, visit);
};
visit(source);
assert.ok(handlerSource && heldActionsSource);
assert.equal(methods.length, METHODS.size);
const compile = (code: string) => ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const Methods = new Function("STANDARD_GAMEFRAME_ROOT", "loadGameframePaneRedirect", "markWidgetsLoaded", "HELD_WIDGET_ACTIONS",
    compile(`class Methods {${methods.join("\n")}}; return Methods;`))(
    STANDARD_GAMEFRAME_ROOT, loadGameframePaneRedirect, () => {}, new Function(`return ${heldActionsSource}`)());

const { createWidgetGroup, FLAG_OP1, TYPE_RECTANGLE, TYPE_TEXT } = require("../../server/plugins/interface/widgetGroup");
const GROUP = 30090;
const C = { ROOT: 0, VIEW: 1, INPUT: 2, STATUS: 3, DATA: 4, LAYOUT: 5, TAB: 6, TAB_LABEL: 8, BACKGROUND: 10, ICON: 14, LABEL: 18 };
const SLOTS = 4;
const box = (width: number, height: number) => ({ width, height, rawWidth: width, rawHeight: height });
const { widgets, add } = createWidgetGroup(GROUP);
const root = add(C.ROOT, -1, box(400, 300));
add(C.INPUT, root, { type: TYPE_TEXT, ...box(300, 20) });
add(C.STATUS, root, { type: TYPE_TEXT, ...box(300, 16) });
add(C.DATA, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
add(C.LAYOUT, root, { type: TYPE_TEXT, hidden: true, isHidden: true });
for (const tab of [0, 1]) {
    add(C.TAB + tab, root, { type: TYPE_RECTANGLE, actions: ["Show"], flags: FLAG_OP1, ...box(80, 20) });
    add(C.TAB_LABEL + tab, root, { type: TYPE_TEXT, ...box(80, 20) });
}
const view = add(C.VIEW, root, box(300, SLOTS * 16));
for (let slot = 0; slot < SLOTS; slot++) {
    add(C.BACKGROUND + slot, view, box(300, 16));
    add(C.ICON + slot, view, box(16, 16));
    add(C.LABEL + slot, view, { type: TYPE_TEXT, actions: ["Choose"], flags: FLAG_OP1, ...box(280, 16) });
}
const definition = {
    groupId: GROUP, widgets,
    search: { inputComponent: C.INPUT, dataComponent: C.DATA, caret: "|", textTemplate: "Search: %s" },
    list: { viewComponent: C.VIEW, slotCount: SLOTS, columns: 1, rowHeight: 16, iconStart: C.ICON,
        backgroundStart: C.BACKGROUND, labelStart: C.LABEL, itemLabel: "%name", headerLabel: "[%name]", clickable: true },
    status: { component: C.STATUS, matches: "%total listed", empty: "Nothing to show here." },
    tabs: { components: [C.TAB, C.TAB + 1], labelComponents: [C.TAB_LABEL, C.TAB_LABEL + 1], labels: ["Mine", "All"],
        activeTemplate: "<col=ffffff>%s</col>", inactiveTemplate: "<col=ffd27f>%s</col>", layoutComponent: C.LAYOUT },
};

// The two roots involved: the gameframe (its main modal pane is 161:16) and the welcome screen.
const rootGroup = (groupId: number, panes: number[]) => {
    const group = createWidgetGroup(groupId);
    const top = group.add(0, -1, box(800, 600));
    for (const pane of panes) group.add(pane, top, box(500, 340));
    return { groupId, widgets: group.widgets };
};
loadFromPayload({ gamemodeId: "test", datasets: [{ key: "customWidgets", rows: [rootGroup(161, [16]), rootGroup(378, [])] }] });

const wm = new WidgetManager({ getIndex: () => undefined } as any);
const client: any = Object.assign(Object.create(Methods.prototype), {
    widgetManager: wm, pendingInterfaceUpdates: new PendingInterfaceUpdates(),
    heldWidgetProperties: new HeldWidgetProperties(), pendingInterfaceOpens: new Map(),
    serverSubInterfaces: new Map(), gameframePaneRedirects: new Map(),
    loaderFactory: { getEnumTypeLoader: () => undefined }, cs2Vm: { clearHandlerCaches() {} },
    varManager: { setVarcInt() {}, getVarcInt: () => 3, setVarbit() {} },
    widgetInputController: { invalidateHoverCache() {} },
    triggerInitialVarTransmitForGroup() {}, runWidgetScopedClientScript() {},
    isCloseOnOutsideClickTarget: () => true,
});
client.customInterfaces = new CustomInterfaceRuntime({
    widgetManager: wm, getCacheSystem: () => undefined, runWidgetScopedClientScript() {}, fetchContent: async () => ({}),
});
let deliver: (definition: unknown) => void = () => assert.fail("no definition was requested");
const fetchInterfaceDefinition = (groupId: number) => {
    assert.equal(groupId, GROUP);
    return new Promise((resolve) => { deliver = resolve; });
};
const handle = new Function("fetchInterfaceDefinition", "setCustomInterface", "markWidgetsLoaded", "markWidgetInteractionDirty",
    "VARBIT_POPOUT_OPEN", "VARBIT_POPOUT_PANEL_DESKTOP_DISABLED", compile(`return ${handlerSource}`)).call(client,
    fetchInterfaceDefinition, setCustomInterface, () => {}, markWidgetInteractionDirty, 13090, 13982);
client.handleWidgetPayload = handle;
// As OsrsClient wires them up.
wm.onInterfaceClose = (groupId: number) => client.customInterfaces.onInterfaceClosed(groupId);
wm.onGroupLoaded = (groupId: number) => client.heldWidgetProperties.take(groupId).forEach(handle);

const send = (packet: Buffer) => handle((decodeServerPacket(packet) as any).payload);
const uid = (component: number) => (GROUP << 16) | component;
const MAIN_MODAL = (161 << 16) | 16;
const text = (component: number) => wm.getWidgetByUid(uid(component))?.text;
const shown = () => ({
    status: text(C.STATUS),
    rows: Array.from({ length: SLOTS }, (_, slot) => wm.getWidgetByUid(uid(C.LABEL + slot)))
        .filter((label) => label && !label.hidden).map((label) => label!.text),
    tabs: [text(C.TAB_LABEL), text(C.TAB_LABEL + 1)],
    input: text(C.INPUT),
});

async function main() {
    try {
        wm.resize(800, 600);
        send(encodeWidgetSetRoot(161));
        send(encodeWidgetSetRoot(378)); // an existing account logs in to the welcome screen

        // The open and its contents arrive in one batch; the definition is still on its way.
        send(encodeWidgetOpenSub(MAIN_MODAL, GROUP, 0));
        send(encodeWidgetSetText(uid(C.DATA), JSON.stringify([
            { id: 1, name: "Alpha" }, { id: 2, name: "Bravo" }, { id: 3, name: "Charlie" },
        ])));
        send(encodeWidgetSetText(uid(C.LAYOUT), JSON.stringify({ active: 1, tabs: [[1], [{ header: "Section" }, 2, 3]] })));
        send(encodeWidgetSetText(uid(C.INPUT), ""));
        assert.equal(client.pendingInterfaceUpdates.size, 1, "held until the definition arrives");
        assert.equal(wm.getWidgetByUid(uid(C.STATUS)), undefined);

        deliver(definition);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(client.pendingInterfaceUpdates.size, 0);
        assert.deepEqual(shown(), {
            status: "2 listed", rows: ["[Section]", "Bravo", "Charlie"],
            tabs: ["<col=ffd27f>Mine</col>", "<col=ffffff>All</col>"], input: "|",
        }, "the held rows and layout are applied once the fetched interface mounts");

        client.customInterfaces.handleSearchKeyEvents([{ keyTyped: 0, keyPressed: "h".charCodeAt(0) }]);
        const searched = {
            status: "1 listed", rows: ["[Section]", "Charlie"],
            tabs: ["<col=ffd27f>Mine</col>", "<col=ffffff>All</col>"], input: "Search: h|",
        };
        assert.deepEqual(shown(), searched);

        // Play: the gameframe replaces the welcome screen and the client re-mounts the open
        // interfaces. The server sends nothing again, so what it sent with the open stays.
        send(encodeWidgetSetRoot(161));
        assert.equal(wm.getSubInterface(MAIN_MODAL)?.group, GROUP);
        assert.deepEqual(shown(), searched, "a root change keeps the rows, tab and query");

        // A new open from the server starts again; its contents come with it.
        send(encodeWidgetOpenSub(MAIN_MODAL, GROUP, 0));
        assert.deepEqual(shown(), {
            status: "Nothing to show here.", rows: [],
            tabs: ["<col=ffffff>Mine</col>", "<col=ffd27f>All</col>"], input: "|",
        }, "a new open does not take back the previous one's rows");
    } finally {
        console.log = log;
    }
    console.log("custom-interface-first-open.test.ts: all tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
