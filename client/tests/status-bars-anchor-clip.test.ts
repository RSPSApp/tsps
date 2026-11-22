import assert from "node:assert/strict";

// The status bars draw from inside the widget tree, right after their side-panel anchor. In the
// resizable modern layout they sit left of the panel, outside the anchor's container
// (ToplevelPreEoc 164:96 holds SIDE_BACKGROUND 164:70), so they must draw under the pass's root
// clip, not the container's, or the container clips them away. Widgets drawn after the anchor
// keep the container's clip.
const noop = () => {};
const W = 998, H = 768;
const canvas: any = { width: W, height: H, style: {}, addEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
    __textureCache: { beginFrame: noop, endFrame: noop } };
(globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };

type Box = { x: number; y: number; w: number; h: number };

async function main() {
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    const ROOT = (164 << 16) | 66, CONTAINER = (164 << 16) | 96, ANCHOR = (164 << 16) | 70;
    const SIBLING = (164 << 16) | 71;
    const rect = (uid: number, parentUid: number, x: number, y: number, width: number, height: number) =>
        ({ uid, id: uid, parentUid, type: 3, isIf3: true, x, y, width, height, fill: true, color: 0 });
    const anchor = rect(ANCHOR, CONTAINER, 1, 1, 202, 273);
    const sibling = rect(SIBLING, CONTAINER, 1, 1, 202, 273);
    const container: any = { uid: CONTAINER, id: CONTAINER, parentUid: ROOT, type: 0, isIf3: true,
        x: 794, y: 457, width: 204, height: 275, children: [anchor, sibling] };
    const root: any = { uid: ROOT, id: ROOT, parentUid: -1, type: 0, isIf3: true,
        x: 0, y: 0, width: W, height: H, children: [container] };
    const wm: any = new Proxy({
        getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
        getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: (w: any) => w.children ?? [],
        interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });

    function render(rootClip?: { x0: number; y0: number; x1: number; y1: number }) {
        let box: Box | undefined;
        const gl = new Proxy({
            scissor: (x: number, y: number, w: number, h: number) => { box = { x, y: H - (y + h), w, h }; },
        }, { get: (obj, key) => (obj as any)[key] ?? noop });
        const glr: any = new Proxy({ canvas, gl, width: W, height: H },
            { get: (obj, key) => (obj as any)[key] ?? noop });
        delete canvas.__scissorStack;
        let atAnchor: Box | undefined;
        let atSibling: Box | undefined;
        renderWidgetTreeGL(glr, root, { widgetManager: wm, spriteIndex: {} as any,
            fontLoader: () => undefined, visible: new Map(), debug: false, hostW: W, hostH: H,
            skipTooltip: true, rootClip,
            widgetOverlayAnchors: new Set([ANCHOR]),
            widgetOverlayAnchorDrawn: () => { atAnchor = box && { ...box }; },
            afterWidgetDrawn: (uid) => { if (uid === SIBLING) atSibling = box && { ...box }; } });
        return { atAnchor, atSibling };
    }

    const full = render();
    assert.deepEqual(full.atAnchor, { x: 0, y: 0, w: W, h: H },
        "a full pass draws the bars under the whole canvas, not the side panel's container");
    assert.deepEqual(full.atSibling, { x: 794, y: 457, w: 204, h: 275 },
        "widgets after the anchor are clipped to their container again");

    const partial = render({ x0: 700, y0: 500, x1: 900, y1: 700 });
    assert.deepEqual(partial.atAnchor, { x: 700, y: 500, w: 200, h: 200 },
        "a partial pass draws the bars clipped to the dirty rect being redrawn");
    assert.deepEqual(partial.atSibling, { x: 794, y: 500, w: 106, h: 200 });

    console.log("status bars anchor clip: root clip at the anchor, container clip after it");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
