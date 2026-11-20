import assert from "node:assert/strict";
import { test } from "node:test";

import { setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { CustomInterfaceRuntime } from "../widgets/custom/CustomInterfaceRuntime";

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
let nextGroup = 30140;
const key = (extra: Partial<KeyboardEvent> = {}) => ({
    key: "F1", repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...extra,
}) as KeyboardEvent;

function fixture(options: { gate?: number; target?: number } = { gate: 2 }) {
    const groupId = nextGroup++;
    const uid = (component: number) => (groupId << 16) | component;
    setCustomInterface({
        groupId, overlay: true,
        hotkeys: { gate: options.gate, keys: [{ key: "F1", component: options.target ?? 4 }] },
        widgets: [
            { uid: uid(0), parentUid: -1, type: 0, rawWidth: 200, rawHeight: 120 },
            { uid: uid(1), parentUid: uid(0), type: 0, rawWidth: 200, rawHeight: 120 },
            { uid: uid(2), parentUid: uid(1), type: 0, rawWidth: 100, rawHeight: 30 },
            { uid: uid(3), parentUid: uid(0), type: 0, rawWidth: 200, rawHeight: 120 },
            { uid: uid(4), parentUid: uid(3), type: 4, rawWidth: 100, rawHeight: 20,
                flags: 2, actions: ["Apply"], text: "Apply" },
        ],
    });
    manager.rootInterface = groupId;
    manager.getGroup(groupId);
    const sent: Array<{ groupId: number; childId: number; opId: number }> = [];
    const runtime = new CustomInterfaceRuntime({
        widgetManager: manager, getCacheSystem: () => undefined,
        runWidgetScopedClientScript() {}, fetchContent: async () => [],
        sendWidgetAction: action => sent.push(action),
    });
    assert.equal(runtime.onInterfaceOpened(groupId), true);
    const widget = (component: number) => manager.getWidgetByUid(uid(component))!;
    const passThrough = (message: string) => {
        const before = sent.length;
        assert.equal(runtime.handleHotkey(key()), false, message);
        assert.equal(sent.length, before, "an unconsumed key sends no overlay action");
    };
    return { groupId, uid, widget, runtime, sent, passThrough };
}

test("visible overlay hotkeys retain their action and ignore modified or closed keys", () => {
    const f = fixture();
    assert.equal(f.runtime.handleHotkey(key()), true);
    assert.deepEqual(f.sent.map(a => [a.groupId, a.childId, a.opId]), [[f.groupId, 4, 1]]);
    for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { key: "F2" }]) {
        assert.equal(f.runtime.handleHotkey(key(extra)), false);
    }
    assert.equal(f.sent.length, 1);
    f.runtime.onInterfaceClosed(f.groupId);
    f.passThrough("closed overlays leave the side-panel key available");
});

test("hidden roots, gate ancestors and target ancestors leave hotkeys unconsumed", () => {
    const f = fixture();
    try {
        for (const [component, description] of [[0, "root"], [1, "gate ancestor"], [3, "target ancestor"],
            [2, "gate"], [4, "target"]] as const) {
            f.widget(component).hidden = true;
            f.passThrough(`a hidden ${description} cannot activate an overlay action`);
            f.widget(component).hidden = false;
            assert.equal(f.runtime.handleHotkey(key()), true, "showing the branch restores its action");
        }
    } finally { f.runtime.onInterfaceClosed(f.groupId); }
});

test("hidden mount containers and their ancestors suppress an otherwise visible overlay", () => {
    const f = fixture();
    const hostGroup = nextGroup++;
    const hostUid = (component: number) => (hostGroup << 16) | component;
    setCustomInterface({ groupId: hostGroup, widgets: [
        { uid: hostUid(0), parentUid: -1, type: 0, rawWidth: 400, rawHeight: 200 },
        { uid: hostUid(1), parentUid: hostUid(0), type: 0, rawWidth: 400, rawHeight: 200 },
        { uid: hostUid(2), parentUid: hostUid(1), type: 0, rawWidth: 200, rawHeight: 120 },
    ] });
    manager.rootInterface = hostGroup;
    manager.getGroup(hostGroup);
    manager.openSubInterface(hostUid(2), f.groupId, 1);
    try {
        assert.equal(f.runtime.handleHotkey(key()), true, "a visible mounted overlay works");
        for (const component of [2, 1, 0]) {
            const host = manager.getWidgetByUid(hostUid(component))!;
            host.hidden = true;
            f.passThrough("a hidden mount chain cannot consume the side-panel key");
            host.hidden = false;
        }
    } finally {
        f.runtime.onInterfaceClosed(f.groupId);
        manager.closeSubInterface(hostUid(2));
    }
});

test("declared missing gates and targets refuse actions while an omitted gate stays optional", () => {
    for (const options of [{ gate: 99 }, { gate: 2, target: 99 }]) {
        const f = fixture(options);
        try { f.passThrough("missing declared widgets cannot consume a hotkey"); }
        finally { f.runtime.onInterfaceClosed(f.groupId); }
    }
    const f = fixture({});
    try {
        assert.equal(f.runtime.handleHotkey(key()), true, "a declaration may omit the gate");
        f.widget(3).hidden = true;
        f.passThrough("an ungated target still respects its ancestors");
    } finally { f.runtime.onInterfaceClosed(f.groupId); }
});

test("an invisible first overlay does not steal a shared key from a visible second overlay", () => {
    const f = fixture();
    const other = nextGroup++;
    const otherUid = (component: number) => (other << 16) | component;
    setCustomInterface({ groupId: other, overlay: true,
        hotkeys: { keys: [{ key: "F1", component: 1 }] }, widgets: [
            { uid: otherUid(0), parentUid: -1, type: 0, rawWidth: 100, rawHeight: 40 },
            { uid: otherUid(1), parentUid: otherUid(0), type: 4, rawWidth: 100, rawHeight: 20,
                flags: 2, actions: ["Apply"], text: "Other" },
        ] });
    manager.openSubInterface(f.uid(3), other, 1);
    f.runtime.onInterfaceOpened(other);
    try {
        f.widget(1).hidden = true;
        assert.equal(f.runtime.handleHotkey(key()), true);
        assert.deepEqual(f.sent.map(a => [a.groupId, a.childId, a.opId]), [[other, 1, 1]],
            "only the effectively visible overlay receives the shared key");
        manager.getWidgetByUid(otherUid(0))!.hidden = true;
        f.passThrough("when both are invisible neither consumes the key");
    } finally {
        f.runtime.onInterfaceClosed(other);
        f.runtime.onInterfaceClosed(f.groupId);
        manager.closeSubInterface(f.uid(3));
    }
});
