import assert from "node:assert/strict";

// Exercise production tree traversal, replacing only the DOM/GL drawing surface.
// Cache241 script31 creates six children even when the target has no overflow.
const noop = () => {};
const canvas: any = { width: 800, height: 600, style: {}, addEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    __textureCache: { beginFrame: noop, endFrame: noop } };
(globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };

async function main() {
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    function render(range: number, hidden = false, override = true) {
        const targetUid = (642 << 16) | 7, barUid = (642 << 16) | 27;
        const rects: unknown[] = [], drawn: number[] = [];
        const child = (index: number) => ({ uid: barUid, id: barUid, childIndex: index,
            type: 3, isIf3: true, parentUid: barUid, x: 0, y: index * 20,
            width: 16, height: 16, fill: true, color: 0xff0000 });
        const children = Array.from({ length: 6 }, (_, i) => child(i));
        Object.assign(children[0], { onClick: [34, barUid, targetUid, -2147483646] });
        Object.assign(children[1], { onDrag: [35, barUid, targetUid, -2147483646, false] });
        Object.assign(children[4], { onHold: [32, barUid, targetUid] });
        Object.assign(children[5], { onHold: [33, barUid, targetUid] });
        for (const w of [children[0], children[1], children[4], children[5]])
            Object.assign(w, { eventHandlers: new Map([[w === children[0] ? "onClick" : w === children[1] ? "onDrag" : "onHold", { intArgs: [barUid, targetUid] }]]) });
        const bar: any = { uid: barUid, id: barUid, type: 0, isIf3: true,
            x: 0, y: 0, width: 16, height: 250, hidden, children };
        const target = { uid: targetUid, width: 144, height: 250, scrollHeight: range ? 250 + range : 0 };
        const wm: any = new Proxy({
            getWidgetByUid: (uid: number) => uid === targetUid ? target : uid === barUid ? bar : undefined,
            getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
            getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: (w: any) => w.children ?? [], interfaceParents: new Map(), groups: new Map(),
        }, { get: (obj, key) => (obj as any)[key] ?? noop });
        const gl = new Proxy({}, { get: () => noop });
        const glr: any = new Proxy({ canvas, gl, width: 800, height: 600,
            drawRect: (...args: unknown[]) => rects.push(args) }, { get: (obj, key) => (obj as any)[key] ?? noop });
        renderWidgetTreeGL(glr, bar, { widgetManager: wm, spriteIndex: {} as any,
            fontLoader: () => undefined, visible: new Map([[barUid, override]]),
            debug: false, hostW: 800, hostH: 600, skipTooltip: true,
            afterWidgetDrawn: (_uid, w) => drawn.push(w.childIndex ?? -1) });
        return { drawn, rects };
    }
    assert.ok(render(0).drawn.includes(4), "cache-visible zero-range scrollbar must reach renderer, including its up arrow");
    assert.ok(render(100).drawn.includes(5), "overflow scrollbar still renders its down arrow");
    assert.equal(render(0, true).drawn.length, 0, "explicit cache hide still hides descendants");
    assert.equal(render(0, false, false).drawn.length, 0, "explicit visibility override still hides descendants");
    const scrollUid = (642 << 16) | 40;
    const staleChild: any = { uid: scrollUid + 1, id: scrollUid + 1, parentUid: scrollUid, type: 5,
        isIf3: true, x: 0, y: 0, width: 32, height: 32, itemId: 101, _absY: 0 };
    const scrolledParent: any = { uid: scrollUid, id: scrollUid, type: 0, isIf3: true,
        x: 0, y: 0, width: 100, height: 100, scrollY: 300, scrollHeight: 500, children: [staleChild] };
    const scrollManager: any = new Proxy({
        getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
        getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: (w: any) => w.children ?? [],
        interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const scrollRenderer: any = new Proxy({ canvas, gl: new Proxy({}, { get: () => noop }), width: 800, height: 600 }, { get: (obj, key) => (obj as any)[key] ?? noop });
    renderWidgetTreeGL(scrollRenderer, scrolledParent, { widgetManager: scrollManager, spriteIndex: {} as any,
        fontLoader: () => undefined, visible: new Map(), debug: false, hostW: 800, hostH: 600, skipTooltip: true });
    assert.equal(staleChild._absY, -300, "scroll traversal refreshes a culled child's absolute position before culling it");
    console.log("cache scrollbar render: visibility, clipping and pre-cull bounds passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
