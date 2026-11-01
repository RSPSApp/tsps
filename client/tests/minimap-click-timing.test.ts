import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { ClickMode } from "../game/InputManager";
import { ClientPacket, getPacketWriter } from "../network/packet";
import { UIInputBridge } from "../widgets/gl/ui-input";

const noop = () => {};
const canvas: any = {
    width: 200, height: 200, style: {}, addEventListener: noop,
    __textureCache: {
        beginFrame: noop, endFrame: noop, getByNameToken: () => undefined,
        getWidgetSpriteMaskById: () => ({ width: 200, height: 200, texture: {},
            contains: (x: number, y: number) => Math.hypot(x - 100, y - 100) < 100 }),
    },
    __minimapRenderer: new Proxy({}, { get: () => noop }),
};
(globalThis as any).window ??= { addEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop };
(globalThis as any).WebSocket ??= { OPEN: 1 };

async function main() {
    const { renderWidgetTreeGL } = await import("../widgets/gl/widgetsGl/renderWidgetTree");
    const input: any = {
        mouseX: 120, mouseY: 100, saveClickX: 120, saveClickY: 100,
        clickMode2: ClickMode.LEFT, clickMode3: ClickMode.LEFT,
        middleClickX: -1, middleClickY: -1, middleClickSequence: 0,
    };
    const bridge = new UIInputBridge(canvas);
    canvas.__inputBridge = bridge;
    const wm: any = new Proxy({
        getWidgetFlags: () => 0, getWidgetFlagsVersion: () => 0,
        getStaticChildrenByParentUid: () => [], getDynamicChildrenByParent: () => [],
        interfaceParents: new Map(), groups: new Map(),
    }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const client: any = {
        camera: { yaw: 0 }, controlledPlayerServerId: 1, inputManager: input,
        playerMovementSync: { getState: () => ({ tileX: 3200, tileY: 3200, level: 0 }) },
    };
    const glr: any = new Proxy({ canvas, width: 200, height: 200,
        gl: new Proxy({}, { get: () => noop }) }, { get: (obj, key) => (obj as any)[key] ?? noop });
    const minimap: any = { uid: (161 << 16) | 30, parentUid: -1, type: 5, isIf3: true,
        contentType: 1338, spriteId: 1, x: 0, y: 0, width: 200, height: 200 };
    renderWidgetTreeGL(glr, minimap, {
        widgetManager: wm, spriteIndex: {} as any, fontLoader: () => undefined,
        hostW: 200, hostH: 200, skipTooltip: true, visible: new Map(), game: { osrsClient: client } as any,
    });
    assert.equal(bridge.getClicks().pick(120, 100)?.id, "minimap:click-to-walk");

    ClientState.baseX = 3152;
    ClientState.baseY = 3152;
    const sent: Uint8Array[] = [];
    const writer = getPacketWriter();
    writer.setSocket({ readyState: 1, send: (bytes: Uint8Array) => sent.push(bytes) } as any);
    const flushInput = () => { bridge.processInput(input); writer.flush(); };
    flushInput();
    assert.equal(sent.length, 1, "minimap movement is sent on press, while the button is still held");
    assert.equal(sent[0][0], ClientPacket.MOVE_GAMECLICK);
    assert.equal(ClientState.destinationWorldX, 3205);
    assert.equal(ClientState.destinationWorldY, 3200);

    // A long hold and a release at a different tile must not send another route.
    input.clickMode3 = ClickMode.NONE;
    for (let frame = 0; frame < 30; frame++) flushInput();
    input.mouseX = 140;
    input.clickMode2 = ClickMode.NONE;
    flushInput();
    assert.equal(sent.length, 1, "holding and releasing do not duplicate or redirect the press");

    // The circular mask and higher-priority orbs still own their hit testing.
    input.mouseX = input.saveClickX = 0;
    input.mouseY = input.saveClickY = 0;
    input.clickMode2 = input.clickMode3 = ClickMode.LEFT;
    flushInput();
    assert.equal(sent.length, 1, "outside the minimap mask cannot start a walk");
    input.clickMode2 = input.clickMode3 = ClickMode.NONE;
    flushInput();
    bridge.getClicks().register({ id: "orb", priority: 100, rect: { x: 110, y: 90, w: 20, h: 20 } });
    input.mouseX = input.saveClickX = 120;
    input.mouseY = input.saveClickY = 100;
    input.clickMode2 = input.clickMode3 = ClickMode.LEFT;
    flushInput();
    assert.equal(sent.length, 1, "an overlapping orb consumes the press without walking");
    input.clickMode2 = input.clickMode3 = ClickMode.NONE;
    flushInput();

    // A press the orb's widget consumed, released on the minimap beside it, is still the orb's.
    input.clickMode2 = ClickMode.LEFT;
    flushInput();
    input.mouseX = 60;
    input.clickMode2 = ClickMode.NONE;
    flushInput();
    assert.equal(sent.length, 1, "a consumed press on the orb cannot walk when released off it");
    bridge.getClicks().unregister("orb");

    // A drag-only widget over the minimap has no click target, so nothing above the minimap
    // takes the release, but the real widget click path clears the press before the bridge (#1797).
    const { processWidgetClickInput } = await import("../game/widgets/input/widgetClickInput");
    const dragHandle = { uid: (160 << 16) | 99, groupId: 160, fileId: 99, childIndex: -1,
        x: 0, y: 0, width: 200, height: 200, isDraggable: true };
    const press = () => {
        input.mouseX = input.saveClickX = input.leftClickX = 80;
        input.mouseY = input.saveClickY = input.leftClickY = 100;
        input.clickMode2 = input.clickMode3 = ClickMode.LEFT;
        processWidgetClickInput(
            { getTransmitCycles: () => ({ cycleCntr: 0 }),
                getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }) } as any,
            { cachedHoverHits: null } as any,
            { input, collectFromAllRoots: () => [dragHandle], getWidgetFlags: () => 0 } as any,
            { invalidateWidgetRender: noop, getWidgetByUid: noop } as any,
            { clickedWidget: null, resolveClickedWidgetParent: noop,
                handleTradeRequestChatClick: () => false, isWidgetDraggable: () => true } as any,
            (() => ({ option: "", target: "" })) as any,
            true,
        );
        assert.equal(input.clickMode3, ClickMode.NONE, "the widget click path consumed the press");
    };
    press();
    flushInput();
    assert.equal(sent.length, 1, "a consumed press sends nothing until release");
    input.mouseX = 110;
    input.clickMode2 = ClickMode.NONE;
    flushInput();
    assert.equal(sent.length, 2, "the release of a consumed press walks exactly once");
    assert.equal(ClientState.destinationWorldX, 3195, "the walk goes to where the press landed");
    assert.equal(ClientState.destinationWorldY, 3200);
    flushInput();
    assert.equal(sent.length, 2, "later frames do not repeat the walk");

    // A consumed press outside the minimap mask, or cleared by a menu, cannot walk on release.
    input.saveClickX = input.saveClickY = 0;
    input.clickMode2 = ClickMode.LEFT;
    flushInput();
    input.mouseX = 120;
    input.mouseY = 100;
    input.clickMode2 = ClickMode.NONE;
    flushInput();
    assert.equal(sent.length, 2, "a press that began off the minimap cannot walk when released on it");
    input.saveClickX = input.saveClickY = -1;
    input.clickMode2 = ClickMode.LEFT;
    flushInput();
    input.clickMode2 = ClickMode.NONE;
    flushInput();
    assert.equal(sent.length, 2, "a press with no saved position cannot walk on release");
    console.log("minimap click timing: press, hold, release, mask, overlay and consumed press passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
