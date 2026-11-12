import assert from "node:assert/strict";

// The real widget renderer and right-click handler over a tanner-like IF1 interface: four
// buttons stacked over one hide (Tan All, Tan X, Tan 5, Tan 1, the last on top).
const noop = () => {};
const canvas: any = {
    width: 200, height: 200, style: {},
    addEventListener: noop, removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    __textureCache: new Proxy({}, { get: () => noop }),
};
(globalThis as any).window ??= { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop, removeEventListener: noop };
(globalThis as any).WebSocket ??= { OPEN: 1 };
(globalThis as any).requestAnimationFrame ??= () => 0;

async function main() {
    const { UIInputBridge } = await import("../widgets/gl/ui-input");
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    const { minMenuSnapshot } = await import("../rs/cs2/minimenu");

    const GROUP = 324;
    const root: any = { uid: GROUP << 16, groupId: GROUP, fileId: 0, parentUid: -1, type: 0, isIf3: false,
        x: 0, y: 0, width: 200, height: 200 };
    const button = (fileId: number, text: string): any => ({
        uid: (GROUP << 16) | fileId, groupId: GROUP, fileId, parentUid: root.uid, type: 3, isIf3: false,
        x: 10, y: 10, width: 96, height: 112, buttonType: 1, buttonText: text, actions: [text],
        flags: 0x400000 | (1 << 1),
    });
    const stack = [button(124, "Tan All"), button(132, "Tan X"), button(140, "Tan 5"), button(148, "Tan 1")];
    const byUid = new Map<number, any>([root, ...stack].map((w) => [w.uid, w]));
    const wm: any = new Proxy({
        getWidgetFlags: (w: any) => w?.flags ?? 0, getWidgetFlagsVersion: () => 0,
        getWidgetOpMask: () => 0, getWidgetByUid: (uid: number) => byUid.get(uid),
        getStaticChildrenByParentUid: (uid: number) => (uid === root.uid ? stack : []),
        getDynamicChildrenByParent: () => [], interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const clicked: number[] = [];
    const client: any = { inputManager: { mouseX: 50, mouseY: 60 }, widgetManager: wm, renderer: { canvas } };
    const bridge = new UIInputBridge(canvas);
    canvas.__inputBridge = bridge;
    const glr: any = new Proxy({ canvas, width: 200, height: 200, gl: new Proxy({}, { get: () => noop }) },
        { get: (obj, key) => (obj as any)[key] ?? noop });
    renderWidgetTreeGL(glr, root, {
        widgetManager: wm, spriteIndex: {} as any, fontLoader: () => undefined,
        hostW: 200, hostH: 200, skipTooltip: true, visible: new Map(), game: { osrsClient: client } as any,
    });
    canvas.__ui.onWidgetAction = (event: any) => clicked.push(event.widget.fileId);

    const rightClick = (x: number, y: number): string[] => {
        canvas.__ui.menu = undefined;
        (bridge as any).menuHandler(x, y);
        return (canvas.__ui.menu?.entries ?? []).map((entry: any) => entry.option);
    };

    // The hit-scan path (nothing hovered yet) and the hovered-target path give the same menu.
    assert.deepEqual(rightClick(50, 60), ["Tan 1", "Tan 5", "Tan X", "Tan All", "Cancel"]);
    const clicks = bridge.getClicks() as any;
    clicks.getHoverTarget = () => clicks.pick(50, 60);
    assert.equal(clicks.getHoverTarget()?.id, `widget:${stack[3].uid}`, "Tan 1 is the hovered target");
    assert.deepEqual(rightClick(50, 60), ["Tan 1", "Tan 5", "Tan X", "Tan All", "Cancel"]);
    for (const entry of canvas.__ui.menu.entries.slice(0, 4)) entry.onClick?.();
    assert.deepEqual(clicked, [148, 140, 132, 124], "each option clicks its own button");

    // The mouseover text counts the stacked options: "Tan 1 / 3 more options".
    canvas.__ui.mouseX = 50;
    canvas.__ui.mouseY = 60;
    const snapshot = minMenuSnapshot(client);
    assert.equal(snapshot.option, "Tan 1");
    assert.equal(snapshot.numOps, 4);

    // A lone IF1 button keeps its single option.
    stack.splice(0, 3);
    for (const fileId of [124, 132, 140]) clicks.unregister(`widget:${(GROUP << 16) | fileId}`);
    assert.deepEqual(rightClick(50, 60), ["Tan 1", "Cancel"]);
    assert.equal(minMenuSnapshot(client).numOps, 1);

    console.log("if1 stacked buttons menu: right-click and mouseover ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
