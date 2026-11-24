import assert from "node:assert/strict";

import { BitmapFont } from "../rs/font/BitmapFont";

// The widget tree renderer itself, with only the DOM/GL surface replaced: legacy (IF1) layers,
// tooltips and text, the hidden compass, lines and the held rectangle.
const noop = () => {};
const hover: { id: string | null } = { id: null };
const pointer = { x: -1, y: -1 };
const clicks: any = new Proxy({ getHoverTarget: () => (hover.id ? { id: hover.id } : null), isHover: () => false },
    { get: (obj, key) => (obj as any)[key] ?? noop });
const mask = { width: 4, height: 4, xStarts: new Int32Array([1, 0, 0, 1]), xWidths: new Int32Array([2, 4, 4, 2]) };
const canvas: any = { width: 800, height: 600, style: {}, addEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: noop }),
    __textureCache: new Proxy({ beginFrame: noop, endFrame: noop, getWidgetSpriteMaskById: () => mask },
        { get: (obj, key) => (obj as any)[key] ?? noop }),
    __inputBridge: { getClicks: () => clicks, getPointerPos: () => pointer } };
(globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };
let rafCalls = 0;
(globalThis as any).requestAnimationFrame = () => ++rafCalls;

const font = new BitmapFont();
font.ascent = font.maxAscent = 10;
for (let ch = 0; ch < 256; ch++) {
    font.advances[ch] = font.widths[ch] = font.heights[ch] = 1;
    font.glyphPixels[ch] = new Uint8Array([1]);
}

async function main() {
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    const GROUP = 300;
    const uid = (child: number) => (GROUP << 16) | child;
    const cycles = { cycleCntr: 1000 };
    const state = { compassVisible: true, clicked: null as any, waiting: null as any };

    function render(children: any[], vars: Record<number, number> = {}) {
        const rects: number[][] = [];
        const glyphRuns: number[] = [];
        const glyphColours: number[] = [];
        const drawn: number[] = [];
        const root: any = { uid: uid(0), id: uid(0), groupId: GROUP, type: 0, isIf3: false,
            x: 0, y: 0, width: 765, height: 503, children };
        for (const child of children) Object.assign(child, { id: child.uid, groupId: GROUP, parentUid: root.uid });
        const byUid = new Map<number, any>([[root.uid, root]]);
        const index = (w: any) => { byUid.set(w.uid, w); for (const c of w.children ?? []) index(c); };
        children.forEach(index);
        const osrsClient = { inputManager: {}, transmitCycles: cycles, widgetInteraction: { clickedWidget: state.clicked },
            objTypeLoader: { load: (id: number) => (id === 995 ? { name: "Coins", stackability: 1 } : { name: "Abyssal whip", stackability: 0 }) },
            varManager: { getVarp: (id: number) => vars[id] ?? 0 } };
        const wm: any = new Proxy({
            osrsClient,
            getWidgetByUid: (id: number) => byUid.get(id),
            findWidget: (group: number, file: number) => byUid.get((group << 16) | file),
            getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
            getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: (w: any) => w.children ?? [],
            interfaceParents: new Map(), groups: new Map(), meslayerContinueWidget: state.waiting,
            isMinimapCompassVisible: () => state.compassVisible, compassSpriteId: -1,
        }, { get: (obj, key) => (obj as any)[key] ?? noop });
        const glr: any = new Proxy({ canvas, gl: new Proxy({}, { get: () => noop }), width: 800, height: 600,
            createTextureFromCanvas: () => ({}),
            drawRect: (x: number, y: number, w: number, h: number, c: number[]) =>
                rects.push([x, y, w, h, Math.round(c[0] * 255) << 16 | Math.round(c[1] * 255) << 8 | Math.round(c[2] * 255), Math.round(c[3] * 255)]),
            drawTextureQuads: (_t: unknown, _d: unknown, count: number, _s: number, rgb: number[]) => {
                glyphRuns.push(count);
                glyphColours.push(Math.round(rgb[0] * 255) << 16 | Math.round(rgb[1] * 255) << 8 | Math.round(rgb[2] * 255));
            },
        }, { get: (obj, key) => (obj as any)[key] ?? noop });
        renderWidgetTreeGL(glr, root, { widgetManager: wm, spriteIndex: {} as any, game: { osrsClient },
            fontLoader: () => font, visible: new Map(), debug: false, hostW: 800, hostH: 600, skipTooltip: true,
            afterWidgetDrawn: (id) => drawn.push(id & 0xffff) });
        return { rects, glyphRuns, glyphColours, drawn };
    }
    const rect = (child: number, extra: object = {}) => ({ uid: uid(child), type: 3, isIf3: false,
        x: 10, y: 10, width: 20, height: 20, filled: true, textColor: 0x123456, ...extra });

    // C7c: a hidden legacy layer is skipped, but drawn while a mouse-over redirect points at it.
    const layer = () => ({ uid: uid(2), type: 0, isIf3: false, hidden: true, x: 0, y: 0, width: 100, height: 100,
        children: [{ ...rect(3), parentUid: uid(2), id: uid(3), groupId: GROUP }] });
    const button = () => ({ ...rect(1, { x: 200 }), mouseOverRedirect: 2 });
    hover.id = null;
    assert.deepEqual(render([button(), layer()]).drawn.filter((c) => c === 3), [], "a hidden legacy layer draws no children");
    hover.id = `widget:${uid(1)}`;
    assert.deepEqual(render([button(), layer()]).drawn.filter((c) => c === 3), [3], "the moused-over hidden layer is drawn");
    assert.deepEqual(render([button(), { ...layer(), isIf3: true }]).drawn.filter((c) => c === 3), [], "a hidden modern layer never is");
    hover.id = null;

    // C8: the hidden compass fills its sprite mask rows with black.
    const compass = () => ({ uid: uid(4), type: 5, isIf3: true, contentType: 1339, spriteId: 5, x: 100, y: 100, width: 4, height: 4 });
    state.compassVisible = false;
    assert.deepEqual(render([compass()]).rects, [[101, 100, 2, 1, 0, 255], [100, 101, 4, 2, 0, 255], [101, 103, 2, 1, 0, 255]]);
    state.compassVisible = true;
    assert.deepEqual(render([compass()]).rects, [], "a visible compass fills nothing");

    // C7a: legacy text fills %1 from the component's client script; modern text does not.
    const text = (isIf3: boolean) => ({ uid: uid(5), type: 4, isIf3, x: 0, y: 0, width: 200, height: 40, fontId: 1,
        text: "Value: %1", textColor: 0xffffff, cs1Instructions: [[5, 7, 0]] });
    assert.deepEqual(render([text(false)], { 7: 1234 }).glyphRuns, ["Value: 1234".length]);
    assert.deepEqual(render([text(false)], { 7: 999999999 }).glyphRuns, ["Value: *".length]);
    assert.deepEqual(render([text(true)], { 7: 1234 }).glyphRuns, ["Value: %1".length]);

    // C11: a modern text component that holds an item shows the item's name and quantity.
    const itemText = (itemId: number, itemQuantity: number, isIf3 = true) => ({ uid: uid(9), type: 4, isIf3, x: 0, y: 0,
        width: 200, height: 40, fontId: 1, text: "old text", textColor: 0xffffff, itemId, itemQuantity });
    let item = render([itemText(4151, 1)]);
    assert.deepEqual([item.glyphRuns, item.glyphColours], [["Abyssal whip".length], [0xffffff]]);
    item = render([itemText(995, 5)]);
    assert.deepEqual([item.glyphRuns, item.glyphColours], [["Coins".length, " x ".length, 1], [0xff9040, 0xffffff, 0xffff00]]);
    assert.deepEqual(render([itemText(995, 5, false)]).glyphRuns, ["old text".length], "legacy text keeps its own text");

    // C11: "Please wait..." is drawn in the base colour, not the hover colour.
    const waiting = { uid: uid(10), type: 4, isIf3: true, x: 0, y: 0, width: 200, height: 40, fontId: 1,
        text: "Click here to continue", textColor: 0x0000ff, mouseOverColor: 0xffffff, onClick: [1] };
    hover.id = `widget:${uid(10)}`;
    clicks.isHover = (id: string) => id === hover.id;
    assert.deepEqual(render([waiting]).glyphColours, [0xffffff], "hovered text takes the hover colour");
    state.waiting = waiting;
    const wait = render([waiting]);
    assert.deepEqual([wait.glyphRuns, wait.glyphColours], [["Please wait...".length], [0x0000ff]]);
    state.waiting = null;
    hover.id = null;
    clicks.isHover = () => false;

    // C7b: a legacy tooltip draws nothing until the mouse has been on it for 50 cycles.
    const tooltip = () => ({ uid: uid(6), type: 8, isIf3: false, x: 100, y: 50, width: 80, height: 20, text: "Hello world<br>Bye" });
    pointer.x = 120; pointer.y = 60;
    let frame = render([tooltip()]);
    for (let i = 0; i < 49; i++) {
        cycles.cycleCntr++;
        frame = render([tooltip()]);
        assert.equal(frame.rects.length + frame.glyphRuns.length, 0, "nothing is drawn while the timer runs");
    }
    assert.ok(rafCalls > 0, "the running timer asks for the next draw pass");
    cycles.cycleCntr++;
    frame = render([tooltip()]);
    // 11 one-pixel characters + 6 wide with its right edge 5 inside the component, two lines of
    // ascent 10 + 1 and 7 more tall, 5 below.
    assert.deepEqual(frame.rects[0], [158, 75, 17, 29, 0xffffa0, 255], "the pale yellow box");
    assert.deepEqual(frame.rects.slice(1).map((r) => r[4]), [0, 0, 0, 0], "with a black outline");
    assert.deepEqual(frame.glyphRuns, [11, 3], "and its two lines of text");
    state.clicked = {};
    cycles.cycleCntr++;
    assert.equal(render([tooltip()]).rects.length, 0, "no tooltip while a component is held");
    state.clicked = null;
    pointer.x = 400;
    cycles.cycleCntr++;
    assert.equal(render([tooltip()]).rects.length, 0, "nor once the mouse has left");
    pointer.x = pointer.y = -1;

    // C11: a line of width 0 is a vertical line (one column), not a diagonal.
    const line = { uid: uid(7), type: 9, isIf3: true, x: 50, y: 50, width: 0, height: 5, textColor: 0xff0000, lineWidth: 1 };
    assert.deepEqual(render([line]).rects.map((r) => [r[0], r[1]]), [[50, 50], [50, 51], [50, 52], [50, 53], [50, 54], [50, 55]]);

    // C9: the held rectangle is drawn at transparency 128, unless it renders in place.
    const alphaOf = (extra: object) => render([rect(8, { isIf3: true, color: 0x123456, ...extra })]).rects[0][5];
    assert.equal(alphaOf({}), 255);
    assert.equal(alphaOf({ _isDragActive: true, dragRenderBehaviour: 1 }), 127);
    assert.equal(alphaOf({ _isDragActive: true, dragRenderBehaviour: 1, isScrollBar: true }), 255);

    console.log("widget-if1-render: ok");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
