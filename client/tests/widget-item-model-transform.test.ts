import assert from "node:assert/strict";

import { InputManager } from "../game/InputManager";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerWidgetOps } from "../rs/cs2/handlers/WidgetOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

async function main() {
    const noop = () => {};
    const canvas: any = { width: 800, height: 600, style: {}, addEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        __textureCache: { beginFrame: noop, endFrame: noop } };
    (globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
    (globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    const widget: any = { uid: (378 << 16) | 84, groupId: 378, fileId: 84,
        parentUid: -1, type: 6, isIf3: true, x: 0, y: 0, width: 48, height: 48,
        rawWidth: 48, rawHeight: 48, modelId: -1 };
    const wm: any = new Proxy({ getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
        getWidgetByUid: () => widget,
        getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: () => [],
        interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const glr: any = new Proxy({ canvas, width: 800, height: 600,
        gl: new Proxy({}, { get: () => noop }) }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const obj = { xan2d: 369, yan2d: 15, zan2d: 8, zoom2d: 1200,
        offsetX2d: 2, offsetY2d: -3 };
    const objLoader: any = { load: () => obj };
    const handlers: HandlerMap = new Map();
    registerWidgetOps(handlers);
    const op = (opcode: number, args: number[]) => {
        const ctx: any = { intStack: Int32Array.from(args), intStackSize: args.length,
            activeWidget: widget, dotWidget: null, widgetManager: wm, objTypeLoader: objLoader };
        handlers.get(opcode)!(ctx, 0, null);
    };
    const draw = () => {
        let result: any;
        renderWidgetTreeGL(glr, widget, { widgetManager: wm, spriteIndex: {} as any,
            objLoader, fontLoader: () => undefined, hostW: 800, hostH: 600,
            skipTooltip: true, visible: new Map(),
            game: { osrsClient: { inputManager: new InputManager() } } as any,
            renderModelCanvas: (_id, params) => { result = params; return undefined; } });
        assert.ok(result, "the item model reaches the real widget renderer");
        return result;
    };
    op(Opcodes.CC_SETOBJECT, [556, 1]);
    const initial = draw();
    assert.equal(initial.zoom2d, 800, "ordinary item previews normalize once at set-object");
    assert.deepEqual([initial.xan2d, initial.yan2d, initial.zan2d], [369, 15, 8]);
    // welcome_screen's loading_icon_init sets an item then sets its model angle/zoom;
    // loading_icon_resize changes that zoom on every client timer tick.
    for (const zoom of [3000, 3020, 1000, 1020]) {
        op(Opcodes.CC_SETMODELANGLE, [0, 0, 512, 1024, 0, zoom]);
        const frame = draw();
        assert.equal(frame.zoom2d, zoom, "the pulse reaches rendering without item defaults replacing it");
        assert.deepEqual([frame.xan2d, frame.yan2d, frame.zan2d], [512, 1024, 0]);
        assert.deepEqual([frame.offsetX2d, frame.offsetY2d], [0, 0]);
    }
    op(Opcodes.IF_SETMODELANGLE, [7, -5, 64, 128, 256, 1700, widget.uid]);
    assert.equal(draw().zoom2d, 1700, "IF setters also retain their transform");
    op(Opcodes.CC_SETOBJECT, [555, 1]);
    assert.equal(draw().zoom2d, 800, "replacing the item restores its own defaults");
    console.log("widget item model transform: defaults, pulse, IF setter and replacement pass");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
