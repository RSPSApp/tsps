import assert from "node:assert/strict";

const noop = () => {};
const mouseListeners = new Map<string, (event: any) => void>();
const canvas: any = {
    width: 200, height: 200, style: {},
    addEventListener: (name: string, callback: (event: any) => void) => mouseListeners.set(name, callback),
    removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    __textureCache: {
        beginFrame: noop, endFrame: noop, getByNameToken: () => undefined,
        getWidgetSpriteMaskById: () => ({ width: 200, height: 200, texture: {},
            contains: (x: number, y: number) => Math.hypot(x - 100, y - 100) < 100 }),
    },
    __minimapRenderer: new Proxy({}, { get: () => noop }),
};
(globalThis as any).window ??= { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1 };
(globalThis as any).document ??= { createElement: () => canvas, addEventListener: noop, removeEventListener: noop };
(globalThis as any).WebSocket ??= { OPEN: 1 };
// A coarse-pointer desktop layout uses the same capped HUD as mobile devices.
Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: "Chrome", maxTouchPoints: 1 },
});
(globalThis as any).matchMedia = (query: string) => ({ matches: query === "(pointer: coarse)" });

async function main() {
    const { ClientState } = await import("../game/ClientState");
    const { ClickMode, InputManager } = await import("../game/InputManager");
    const { ClientPacket, getPacketWriter } = await import("../network/packet");
    const { UIInputBridge } = await import("../widgets/gl/ui-input");
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

    // Exercise the actual frame-synchronized input owner and HUD cap, rather than
    // calling the bridge directly: a stationary press can fall between HUD redraws.
    const { isLowEndDevice, isMobileMode } = await import("../common/utils/DeviceUtil");
    assert.equal(isLowEndDevice, true);
    assert.equal(isMobileMode, false);
    const { WidgetsOverlay } = await import("../ui/devoverlay/WidgetsOverlay");
    const { RenderPhase } = await import("../ui/devoverlay/Overlay");
    const { WebRtcGameSocket } = await import("../network/serverConnection/connection/WebRtcGameSocket");
    const realInput = new InputManager();
    realInput.init(canvas);
    client.inputManager = realInput;
    const cappedBridge = new UIInputBridge(canvas);
    canvas.__inputBridge = cappedBridge;
    renderWidgetTreeGL(glr, minimap, {
        widgetManager: wm, spriteIndex: {} as any, fontLoader: () => undefined,
        hostW: 200, hostH: 200, skipTooltip: true, visible: new Map(), game: { osrsClient: client } as any,
    });
    const overlay: any = new WidgetsOverlay(undefined as any, { getGameContext: () => ({ osrsClient: client }) } as any);
    Object.assign(overlay, {
        app: { gl: { canvas } }, glRenderer: glr, overlayCanvas: canvas,
        hasPresentedFrame: true, widgetEntries: [{ root: minimap }],
        lastDrawAt: 1000, lastDrawMouse: (120 << 16) | 100,
    });
    const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance")!;
    let now = 1001;
    Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
    const cappedSent: Uint8Array[] = [];
    // Keep the real WebRTC send adapter; stub only its established DataChannel.
    const rtcSocket: any = Object.create(WebRtcGameSocket.prototype);
    Object.assign(rtcSocket, { state: 1, channel: { send: (bytes: Uint8Array) => cappedSent.push(bytes) } });
    writer.setSocket(rtcSocket);
    const event = { clientX: 120, clientY: 100, button: 0, preventDefault: noop };
    const cappedFrame = () => {
        realInput.onFrameStart();
        overlay.draw(RenderPhase.PostPresent);
        writer.flush();
        realInput.onFrameEnd();
    };
    try {
        mouseListeners.get("mousedown")!(event);
        cappedFrame();
        assert.equal(cappedSent.length, 1, "a stationary press reaches the minimap during a skipped HUD redraw");
        assert.equal(cappedSent[0][0], ClientPacket.MOVE_GAMECLICK);
        now = 1017;
        cappedFrame();
        mouseListeners.get("mouseup")!(event);
        now = 1033;
        cappedFrame();
        assert.equal(cappedSent.length, 1, "held and released frames do not duplicate the minimap walk");
        now = 1034;
        mouseListeners.get("mousedown")!(event);
        cappedFrame();
        assert.equal(cappedSent.length, 2, "a release on a skipped redraw rearms the next stationary press");
        mouseListeners.get("mouseup")!(event);
        now = 1035;
        cappedFrame();
        let orbPresses = 0;
        cappedBridge.getClicks().register({ id: "orb", priority: 100,
            rect: { x: 110, y: 90, w: 20, h: 20 }, onDown: () => orbPresses++ });
        mouseListeners.get("mousedown")!(event);
        now = 1036;
        cappedFrame();
        assert.equal(orbPresses, 1, "higher-priority widgets still consume a press on a skipped redraw");
        assert.equal(cappedSent.length, 2);
        assert.equal(overlay.lastDrawAt, 1000, "processing input preserves the visual redraw cap");
    } finally {
        Object.defineProperty(globalThis, "performance", originalPerformance);
        realInput.cleanUp();
        writer.setSocket(null);
    }
    console.log("minimap click timing: press, hold, release, mask, overlay and consumed press passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
