import assert from "node:assert/strict";
import { vec4 } from "gl-matrix";
import { CollisionFlag } from "../common/CollisionFlag";

import { Camera } from "../game/Camera";
import { GameRenderer } from "../game/GameRenderer";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";
import { collectWidgetsAtPointAcrossRoots } from "../widgets/menu/utils";
import { ClickMode, InputManager } from "../game/InputManager";
import { FirstPersonPlugin, crosshairPoint, crosshairRaisePixels } from "../game/plugins/firstperson/FirstPersonPlugin";
import { PlayerEcs } from "../game/ecs/PlayerEcs";
import { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";

const originalDocument = globalThis.document;
let pointerLockElement: HTMLElement | undefined;
const element = {
    width: 640,
    height: 480,
    requestPointerLock: () => {
        pointerLockElement = element as HTMLElement;
    },
} as HTMLElement;
Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        get pointerLockElement() {
            return pointerLockElement;
        },
        exitPointerLock: () => {
            pointerLockElement = undefined;
        },
    },
});

try {
    const input = new InputManager();
    input.element = element;
    pointerLockElement = element;
    input.setInteractionPointerOverride(320, 240);
    (element as any).getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480 });
    const move = (movementX: number) => (input as any).onMouseMove({ clientX: 10, clientY: 10, movementX, movementY: 0, shiftKey: false });
    move(4);
    assert.deepEqual([input.mouseX, input.mouseY], [320, 240],
        "looking around with a locked pointer keeps the mouse (and the game's mouseover tooltip) at the crosshair");
    assert.equal(input.getDeltaMouseX(), -4, "the movement still turns the camera");
    input.clearInteractionPointerOverride();
    move(0);
    assert.notDeepEqual([input.mouseX, input.mouseY], [320, 240], "without a crosshair the locked mouse reports its own position");
    input.setInteractionPointerOverride(320, 240);

    input.clickMode3 = ClickMode.LEFT;
    assert.equal(input.leftClickX, 320);
    assert.equal(input.leftClickY, 240);

    input.clickMode3 = ClickMode.RIGHT;
    assert.equal(input.pickX, 320);
    assert.equal(input.pickY, 240);

    input.clickMode3 = ClickMode.NONE;
    assert.equal(input.leftClickX, -1);
    assert.equal(input.pickX, -1);

    input.clearInteractionPointerOverride();
    input.clickMode3 = ClickMode.LEFT;
    input.saveClickX = 12;
    assert.equal(input.leftClickX, 12, "clearing an override should restore physical clicks");

    let menuCloseCount = 0;
    let inGame = true;
    let playerTileX = 3200;
    let chatText = "";
    let stoppedWalks = 0;
    let movementCalls = 0;
    let dialogueRoot: any;
    let inventoryTab = -1;
    const inventorySlots = Array.from({ length: 28 }, (_, slot) => ({
        uid: (149 << 16) | (slot + 1), type: 5, childIndex: slot,
        itemId: 315 + slot, width: 36, height: 32, isHidden: false,
        actions: [null, "Eat", "Use", "Drop"], flags: 0x7fe,
        groupId: 149, fileId: -1, parentUid: 149 << 16,
        x: (slot % 4) * 42, y: Math.floor(slot / 4) * 36,
        _absX: 460 + (slot % 4) * 42, _absY: 160 + Math.floor(slot / 4) * 36,
        keyboardOutline: undefined as boolean | undefined,
    }));
    let inventoryRoot: any = { uid: 149 << 16, x: 460, y: 160, width: 168, height: 252, type: 0, children: inventorySlots };
    const interfaceRoots = new Map<number, any[]>();
    let dialogueHidden = false;
    let pendingWidgetTextInput = false;
    let facingRotation: number | undefined;
    const walks: number[][] = [];
    const gameMessages: string[] = [];
    const client = {
        camera: new Camera(0, 0, 0, 256, 512),
        inputManager: input,
        renderSelf: true,
        firstPersonArmsVisible: false,
        followPlayerCamera: false,
        menuOpen: false,
        menuKeyboardIndex: undefined as number | undefined,
        menuKeyboardSelect: false,
        menuActiveSimpleEntries: ["Open", "Examine", "Cancel"],
        controlledPlayerServerId: 10,
        runMode: true,
        getControlledPlayerMovementTile: () => ({ tileX: playerTileX, tileY: 3200 }),
        stopKeyboardMovement: () => { stoppedWalks++; },
        setKeyboardRunMode: (running: boolean) => { client.runMode = running; },
        playerEcs: {
            getIndexForServerId: () => 0,
            getX: () => (playerTileX - 2) * 128 + 64,
            getY: () => 3200 * 128 + 64,
            getDefaultHeightTiles: () => 2,
            setRotationOverride: (_index: number, rotation: number | undefined) => { facingRotation = rotation; },
        },
        cs2Vm: { inputDialogType: 1 },
        isWidgetTextInputActive: () => pendingWidgetTextInput,
        varManager: { getVarcString: () => chatText },
        switchToTab: (tab: number, forceOpen?: boolean) => {
            assert.equal(forceOpen, true, "inventory focus must not toggle an already open inventory closed");
            inventoryTab = tab;
        },
        renderer: { widgetsOverlay: {
            getWidgetInputPoint: (widget: any) => WidgetsOverlay.prototype.getWidgetInputPoint.call(
                { overlayScaleX: 1, overlayScaleY: 1 } as any, widget),
        } },
        widgetManager: {
            rootInterface: -1,
            interfaceParents: new Map<number, { type: number; group?: number }>(),
            getAllGroupRoots: (group: number) => interfaceRoots.get(group) ?? [],
            getStaticChildrenByParentUid: () => [],
            getWidgetFlags: (widget: any) => widget.flags ?? 0,
            getWidgetByUid: (uid: number) => uid === (149 << 16) ? inventoryRoot : undefined,
            invalidateScroll: () => undefined,
            findWidget: (group: number) => group === 149 ? inventoryRoot : dialogueRoot,
            isEffectivelyHidden: () => dialogueHidden,
            invalidateWidgetRender: () => undefined,
        },
        setKeyboardMovement: (dx: number, dy: number, running: boolean) => {
            if (!dx && !dy) return;
            movementCalls++;
            const next = [Math.round(dx * 1000) / 1000 || 0, Math.round(dy * 1000) / 1000 || 0, Number(running)];
            if (JSON.stringify(walks.at(-1)) !== JSON.stringify(next)) walks.push(next);
        },
        isLoggedIn: () => inGame,
        addGameMessage: (message: string) => gameMessages.push(message),
        closeMenu: () => {
            menuCloseCount++;
            client.menuOpen = false;
            client.menuKeyboardIndex = undefined;
            client.menuKeyboardSelect = false;
        },
    };
    const plugin = new FirstPersonPlugin(client);
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(gameMessages.length, 1);
    assert.match(gameMessages[0], /Backquote.*exits close camera/);
    assert.match(gameMessages[0], /WASD to move.*Tab cycles movement, chat and inventory/);
    assert.equal(plugin.shouldKeepWorldMenuOpen(), false, "Backquote should not keep a closed menu alive");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(menuCloseCount, 3, "changing Backquote mode should discard stale menus");
    assert.equal(gameMessages.length, 1, "the controls hint should appear once per login session");
    // Free cursor (the mode Backquote starts in): steering with the keyboard parks the mouse on
    // the crosshair so hover and the game's mouseover tooltip follow it; the real mouse takes over
    // again as soon as it moves. No override, so mouse clicks still reach the UI.
    client.camera.update(640, 480);
    input.mouseX = 30;
    input.mouseY = 40;
    plugin.updateInteractionPointer(client.camera);
    assert.deepEqual([input.mouseX, input.mouseY], [30, 40], "before any keyboard steering the free cursor aims");
    plugin.onKeyDown({ code: "ArrowLeft", repeat: false } as KeyboardEvent);
    plugin.updateInteractionPointer(client.camera);
    const parked = crosshairPoint(client.camera);
    assert.deepEqual([input.mouseX, input.mouseY], [parked.x, parked.y], "keyboard steering aims with the crosshair");
    assert.equal(input.hasInteractionPointerOverride(), false, "the free cursor keeps UI clicks");
    plugin.onMouseMove({ movementX: 3, movementY: 0 } as MouseEvent);
    input.mouseX = 50;
    input.mouseY = 60;
    plugin.updateInteractionPointer(client.camera);
    assert.deepEqual([input.mouseX, input.mouseY], [50, 60], "moving the real mouse hands aiming back to it");
    input.keys.clear();
    assert.equal(client.renderSelf, true, "close camera mode keeps the local body visible");
    assert.equal(client.firstPersonArmsVisible, false, "close camera mode uses the full model");
    client.camera.update(640, 480);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), false, "arrow-key mode should keep the normal cursor");
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    assert.deepEqual(walks, [[1, 0, 1]], "WASD works immediately, without capturing the mouse");
    assert.equal(input.isPointerLock(), false, "entering first person leaves the mouse free");
    input.onKeyDown({ code: "KeyH", key: "h", keyCode: 72, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.length, 0, "ordinary letters cannot type into chat before Tab");
    plugin.onKeyUp({ code: "KeyW" } as KeyboardEvent);
    walks.length = 0;
    const unlockedNow = Date.now;
    let unlockedTime = 1000;
    Date.now = () => unlockedTime;
    try {
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        unlockedTime += 500;
        plugin.updateInteractionPointer(client.camera);
        assert.equal(input.clickMode1, ClickMode.RIGHT, "Space options also work without capturing the mouse");
        client.menuOpen = true;
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        plugin.onKeyDown({ code: "Escape" } as KeyboardEvent);
        assert.equal(input.isPointerLock(), false, "closing an uncaptured menu cannot capture the mouse");
        assert.equal(input.enablePointerLock, false);
    } finally {
        Date.now = unlockedNow;
    }
    input.keys.set("ArrowUp", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.ok((client.camera.getViewPitchOverride() ?? 0) < 152, "Backquote mode up must be inverted");
    assert.equal(facingRotation, 1536, "vertical look does not change player facing");
    input.keys.delete("ArrowUp");
    input.keys.set("ArrowRight", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(facingRotation, (client.camera.getYaw() + 1024) & 2047, "arrow turning aligns the player with the camera");
    input.keys.clear();
    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), true, "Alt should enable mouse-look targeting");
    assert.equal(input.enablePointerLock, true, "Alt should enable pointer lock for mouse look");
    input.keys.delete("ArrowUp");
    client.camera.snapToYaw(512);
    client.camera.setViewPitchOverride(128);
    const follow = (extra: object = {}) => plugin.handleCameraFollow({ camera: client.camera, playerX: 10, playerY: -3, playerZ: 20, ...extra });
    follow();
    // Pivot at 90% of the 2-tile model height, 2.6 tiles out at 22.5 degrees down.
    const reach = 2.6 * Math.cos(Math.PI / 8), rise = 2.6 * Math.sin(Math.PI / 8);
    assert.equal(client.camera.pos[0], Math.round((10 - reach) * 128) / 128, "camera follows behind the player");
    assert.ok(Math.abs(client.camera.getPosY() - (-3 - 1.8 - rise)) < 1e-6, "camera sits above the full player model");
    assert.equal(client.camera.pos[2], 20);
    plugin.handleCameraFollow({ camera: client.camera, playerX: 10, playerY: -3.001, playerZ: 20 });
    assert.ok(Math.abs(client.camera.getPosY() - (-3.001 - 1.8 - rise)) < 1e-6,
        "camera height follows fractional ground height without a whole-unit step");
    follow();
    const levelY = client.camera.getPosY();
    client.camera.snapToYaw(0);
    plugin.handleCameraFollow({ camera: client.camera, playerX: 10, playerZ: 20 });
    assert.deepEqual([client.camera.pos[0], client.camera.pos[2]], [10, Math.round((20 - reach) * 128) / 128],
        "yaw rotates the rear offset");
    assert.equal(client.camera.getPosY(), levelY, "unloaded terrain preserves height");

    client.camera.snapToYaw(512);
    client.camera.setViewPitchOverride(380);
    follow();
    assert.ok(client.camera.getPosY() < levelY - 1 && client.camera.pos[0] > 10 - reach,
        "looking down orbits the camera up and over the player");
    client.camera.setViewPitchOverride(-480);
    follow();
    assert.equal(client.camera.getViewPitchOverride(), -192, "pitch stops before the camera goes under the player");
    follow({ groundHeightAt: () => -4 });
    assert.ok(Math.abs(client.camera.getPosY() + 4.3) < 1e-6, "looking up keeps the lens above rising ground");
    client.camera.setViewPitchOverride(128);
    // At yaw 512 the camera trails west; a solid wall stands on the east side of tile 8.
    follow({ collisionFlagAt: (_plane: number, x: number) => x === 8 ? CollisionFlag.WALL_EAST_PROJECTILE_BLOCKER : 0 });
    assert.ok(client.camera.pos[0] > 9 && client.camera.pos[0] < 9.5, "a wall pulls the camera in front of it");
    follow({ collisionFlagAt: (_plane: number, x: number) => x === 8 ? CollisionFlag.WALL_EAST : 0 });
    assert.equal(client.camera.pos[0], Math.round((10 - reach) * 128) / 128, "fences that only block walking leave the view alone");

    const originalFollowNow = Object.getOwnPropertyDescriptor(performance, "now");
    let followNow = 1000;
    Object.defineProperty(performance, "now", { configurable: true, value: () => followNow });
    try {
        const ecs = client.playerEcs as any;
        ecs.isMoving = () => true;
        ecs.isRunVisual = () => true;
        for (let i = 0; i < 30; i++) { followNow += 50; follow(); }
        assert.ok(Math.abs(client.camera.getViewZoomScale() - 0.82) < 0.01, "running widens the view");
        ecs.isRunVisual = () => false;
        for (let i = 0; i < 40; i++) { followNow += 50; follow(); }
        assert.ok(Math.abs(client.camera.getViewZoomScale() - 1) < 0.01, "walking eases the view back");
        delete ecs.isMoving;
        delete ecs.isRunVisual;

        // Attacking: the game turns the player to face the opponent (rotation 0 faces south),
        // and the camera swings round behind them (looking south is camera yaw 1024).
        const startYaw = client.camera.yaw;
        ecs.getRotation = () => 0;
        ecs.getInteractionIndex = () => -1;
        for (let i = 0; i < 10; i++) { followNow += 50; follow(); }
        assert.equal(client.camera.yaw, startYaw, "without a target the camera keeps its own heading");
        ecs.getInteractionIndex = () => 7;
        followNow += 50;
        follow();
        assert.ok(client.camera.yaw > startYaw && client.camera.yaw < 1024, "the camera eases round rather than snapping");
        for (let i = 0; i < 40; i++) { followNow += 50; follow(); }
        assert.ok(Math.abs(client.camera.yaw - 1024) < 1, "the camera ends up behind the player facing its target");
        delete ecs.getRotation;
        delete ecs.getInteractionIndex;
        client.camera.snapToYaw(startYaw);

        follow();
        const rest = Array.from(client.camera.pos);
        plugin.onHitsplat({ targetType: "player", targetId: 99, damage: 20 });
        followNow += 30;
        follow();
        assert.deepEqual(Array.from(client.camera.pos), rest, "another player's hitsplat leaves the camera alone");
        plugin.onHitsplat({ targetType: "player", targetId: 10, damage: 0 });
        followNow += 30;
        follow();
        assert.deepEqual(Array.from(client.camera.pos), rest, "a block or miss neither shakes nor reddens");
        const host = { style: { setProperty: (name: string, value: string) => {
            if (name === "--first-person-poison") poison = Number(value);
            else redness = Number(value);
        } } };
        let redness = 0;
        let poison = 0;
        const inputElement = input.element;
        (input as any).element = { parentElement: host };
        const peak = (damage: number) => {
            plugin.onHitsplat({ targetType: "player", targetId: 10, damage });
            followNow += 1;
            follow();
            const value = redness;
            followNow += 1000;
            follow();
            return value;
        };
        const light = peak(4), heavy = peak(30);
        assert.ok(light > 0 && heavy > light * 2, "redness grows with the damage taken");
        assert.equal(redness, 0, "redness clears once the hit fades");
        plugin.onHitsplat({ targetType: "player", targetId: 10, damage: 4 });
        plugin.onHitsplat({ targetType: "player", targetId: 10, damage: 4 });
        followNow += 1;
        follow();
        assert.ok(redness > light, "hits in quick succession stack");
        followNow += 1000;
        follow();
        plugin.onHitsplat({ targetType: "player", targetId: 10, damage: 6, style: 65 });
        followNow += 1;
        follow();
        assert.ok(poison > 0 && redness === 0, "poison pulses the edge green, not red");
        const pulse: number[] = [];
        for (let i = 0; i < 24; i++) { followNow += 50; follow(); pulse.push(poison); }
        assert.ok(pulse.some((value, i) => i > 1 && value > pulse[i - 1] && pulse[i - 1] < pulse[i - 2]),
            "the green dims and brightens again (it pulses)");
        assert.equal(poison, 0, "the poison pulse clears");
        input.element = inputElement;
        plugin.onHitsplat({ targetType: "player", targetId: 10, damage: 20 });
        followNow += 30;
        follow();
        assert.notDeepEqual(Array.from(client.camera.pos), rest, "taking a hit jolts the camera");
        followNow += 400;
        follow();
        assert.deepEqual(Array.from(client.camera.pos), rest, "the jolt settles");
    } finally {
        if (originalFollowNow) Object.defineProperty(performance, "now", originalFollowNow);
        else delete (performance as any).now;
    }
    client.camera.setViewPitchOverride(152);
    follow();
    for (const [width, height] of [[640, 480], [512, 334]]) {
        client.camera.update(width, height);
        // The model is 2 tiles tall on ground at -3 (Y down): its head top is at -5.
        const head = vec4.fromValues(10, -5, 20, 1);
        vec4.transformMat4(head, head, client.camera.viewProjMatrix);
        const headScreenY = (1 - (head[1] / head[3] + 1) / 2) * client.camera.screenHeight;
        assert.ok(crosshairPoint(client.camera).y < headScreenY - 5,
            `the crosshair sits clear above the player's head in the ${width}x${height} default view`);
        // A standing NPC (feet to 1.5 tiles up) anywhere 3-6 tiles ahead is under the crosshair.
        const screenY = (x: number, y: number) => {
            const p = vec4.fromValues(x, y, 20, 1);
            vec4.transformMat4(p, p, client.camera.viewProjMatrix);
            return (1 - (p[1] / p[3] + 1) / 2) * client.camera.screenHeight;
        };
        for (const ahead of [3, 4, 5, 6]) {
            const aim = crosshairPoint(client.camera).y;
            assert.ok(screenY(10 + ahead, -4.5) <= aim && aim <= screenY(10 + ahead, -3),
                `the crosshair lands on an NPC ${ahead} tiles ahead in the ${width}x${height} default view`);
        }
        for (const y of [-3, -5]) {
            for (const x of [9.75, 10.25]) {
                const clip = vec4.fromValues(x, y, 20, 1);
                vec4.transformMat4(clip, clip, client.camera.viewProjMatrix);
                assert.ok(clip[3] > 0 && Math.abs(clip[0] / clip[3]) < 1 && Math.abs(clip[1] / clip[3]) < 1,
                    `head and feet remain visible in the ${width}x${height} default view`);
            }
        }
    }
    client.camera.update(640, 480);
    client.camera.setViewPitchOverride(0);
    input.deltaMouseY = 0.2;
    for (let i = 0; i < 10; i++) plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 8 });
    assert.ok((client.camera.getViewPitchOverride() ?? 0) < -1.3, "tiny mouse motion accumulates upward pitch");
    const pitchMoved = -(client.camera.getViewPitchOverride() ?? 0);
    const yawBefore = client.camera.yaw;
    input.deltaMouseY = 0;
    input.deltaMouseX = -0.2;
    for (let i = 0; i < 10; i++) plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 8 });
    assert.ok(Math.abs(Math.abs(client.camera.yaw - yawBefore) - pitchMoved) < 1e-6,
        "mouse look moves the same angle per pixel up/down as left/right");
    input.deltaMouseX = 0;
    input.deltaMouseY = 0;
    input.deltaMouseX = 20;
    plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 16 });
    assert.equal(facingRotation, (client.camera.getYaw() + 1024) & 2047, "mouse look turns the player too");
    input.deltaMouseX = 0;
    client.camera.snapToYaw(512);
    client.widgetManager.interfaceParents.set((161 << 16) | 96, { type: 1 });
    client.widgetManager.interfaceParents.set((162 << 16) | 55, { type: 1 });
    chatText = "unfinished chat draft";
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.length, 0, "movement keys do not type into chat");
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 16 });
    assert.deepEqual(walks, [[1, 0, 1]], "normal chat overlays and a saved draft must not block mouse-look movement");
    assert.equal(chatText, "unfinished chat draft", "movement preserves the chat draft");
    for (let i = 0; i < 30; i++) plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 16 });
    assert.equal(walks.length, 1, "held keys do not flood the same blocked destination");
    const beforeRelease = stoppedWalks;
    plugin.onKeyUp({ code: "KeyW" } as KeyboardEvent);
    assert.equal(stoppedWalks, beforeRelease + 1, "releasing movement stops between tile centres");
    input.keys.set("KeyD", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.deepEqual(walks.at(-1), [0, -1, 1], "D strafes relative to camera yaw");
    for (const block of ["dialog", "modal", "sideModal", "chatModal", "textFocus"] as const) {
        client.cs2Vm.inputDialogType = block === "dialog" ? 3 : 1;
        if (block === "modal") client.widgetManager.interfaceParents.set(1, { type: 0 });
        if (block === "sideModal") client.widgetManager.interfaceParents.set(1, { type: 3 });
        if (block === "chatModal") client.widgetManager.interfaceParents.set((162 << 16) | 567, { type: 0 });
        (document as any).activeElement = block === "textFocus" ? { matches: () => true } : undefined;
        input.keys.set("KeyW", true);
        assert.equal(plugin.onKeyDown({ code: "KeyW" } as KeyboardEvent), false, `${block} retains text input`);
        plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
        assert.equal(walks.length, 2, `${block} pauses movement`);
        assert.equal(facingRotation, undefined, `${block} restores normal player facing`);
        assert.equal(input.isKeyDown("KeyW"), false, `${block} clears held movement`);
        client.widgetManager.interfaceParents.clear();
    }
    chatText = "";
    client.cs2Vm.inputDialogType = 1;
    (document as any).activeElement = undefined;
    for (const [yaw, code, dx, dy] of [
        [0, "KeyW", 0, 1], [512, "KeyW", 1, 0], [1024, "KeyW", 0, -1],
        [1536, "KeyW", -1, 0], [0, "KeyA", -1, 0], [0, "KeyS", 0, -1], [0, "KeyD", 1, 0],
    ] as const) {
        input.keys.clear();
        plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
        client.camera.snapToYaw(yaw);
        plugin.onKeyDown({ code } as KeyboardEvent);
        plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
        assert.deepEqual(walks.at(-1), [dx, dy, 1], `${code} matches view yaw ${yaw}`);
    }
    input.keys.clear();
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    client.runMode = false;
    client.camera.snapToYaw(0);
    plugin.onKeyDown({ code: "KeyW" } as KeyboardEvent);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 16 });
    assert.deepEqual(walks.at(-1), [0, 1, 0], "walking supplies a continuous forward direction");
    input.shiftDown = true;
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 8 });
    assert.deepEqual(walks.at(-1), [0, 1, 1], "Shift immediately requests continuous running");
    client.camera.snapToYaw(512);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 8 });
    assert.deepEqual(walks.at(-1), [1, 0, 1], "steering does not wait for the route refresh interval");
    input.shiftDown = false;
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 8 });
    assert.deepEqual(walks.at(-1), [1, 0, 0], "releasing Shift restores walking even after the server enabled run");
    assert.equal(client.runMode, false);
    input.shiftDown = true;
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 8 });
    plugin.onKeyUp({ code: "KeyW" } as KeyboardEvent);
    assert.equal(client.runMode, false, "stopping restores the run preference from before WASD");
    input.shiftDown = false;
    client.runMode = true;
    input.keys.clear();
    const movementWalkCount = walks.length;
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        input.clickMode1 = ClickMode.NONE;
        input.clickMode3 = ClickMode.NONE;
        const keyEventCount = input.keyEvents.length;
        input.onKeyDown({ code: "Space", key: " ", keyCode: 32, repeat: false, preventDefault() {} } as KeyboardEvent);
        assert.equal(input.keyEvents.length, keyEventCount, "world Space does not type into chat");
        assert.equal(input.clickMode1, ClickMode.NONE, "Space waits to distinguish tap from hold");
        plugin.onKeyDown({ code: "Space", repeat: true } as KeyboardEvent);
        now += 100;
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        assert.equal(input.clickMode1, ClickMode.LEFT, "a short Space tap queues the usual default click");
        const aim = crosshairPoint(client.camera);
        assert.deepEqual([input.clickX, input.clickY], [aim.x, aim.y], "Space clicks the (raised) crosshair");
        input.onFrameStart();
        input.clickMode3 = ClickMode.NONE;
        input.clickMode2 = ClickMode.NONE;
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        now += 500;
        plugin.updateInteractionPointer(client.camera);
        assert.equal(input.clickMode1, ClickMode.RIGHT, "holding Space opens the options through the right-click path");
        assert.equal(client.menuKeyboardIndex, 0, "the first option starts selected");
        plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 0 });
        assert.equal(client.menuKeyboardIndex, 0, "a menu queued during a frame survives until its click is processed");
        input.onFrameStart();
        plugin.updateInteractionPointer(client.camera);
        client.menuOpen = true;
        plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 0 });
        input.clickMode3 = ClickMode.NONE;
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        assert.equal(client.menuKeyboardSelect, false, "releasing the opening hold does not choose an option");
        assert.equal(input.clickMode1, ClickMode.NONE, "a hold never also fires a default click");
        plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
        assert.equal(client.menuKeyboardIndex, 1);
        plugin.onKeyDown({ code: "ArrowDown", repeat: true } as KeyboardEvent);
        assert.equal(client.menuKeyboardIndex, 2, "held arrows can repeat through the options");
        plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
        assert.equal(client.menuKeyboardIndex, 2, "selection stays within the menu");
        plugin.onKeyDown({ code: "ArrowUp" } as KeyboardEvent);
        assert.equal(client.menuKeyboardIndex, 1);
        const pitch = client.camera.getViewPitchOverride();
        input.keys.set("ArrowDown", true);
        plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
        assert.equal(client.camera.getViewPitchOverride(), pitch, "menu navigation cannot tilt the camera");
        input.keys.delete("ArrowDown");
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        assert.equal(client.menuKeyboardSelect, true, "a fresh Space press confirms the highlighted option");
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        plugin.onKeyDown({ code: "Escape" } as KeyboardEvent);
        assert.equal(client.menuOpen, false);
        assert.equal(client.menuKeyboardIndex, undefined, "Escape clears keyboard selection and resumes mouse look");
        client.cs2Vm.inputDialogType = 3;
        assert.equal(plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent), false, "dialog Space keeps its normal continue action");
        client.cs2Vm.inputDialogType = 1;
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        (document as any).activeElement = { matches: () => true };
        now += 600;
        plugin.updateInteractionPointer(client.camera);
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        assert.equal(input.clickMode1, ClickMode.NONE, "moving focus to text cancels a pending hold");
        (document as any).activeElement = undefined;
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        now += 500;
        plugin.updateInteractionPointer(client.camera);
        assert.equal(input.clickMode1, ClickMode.RIGHT);
        plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        assert.equal(input.clickMode1, ClickMode.NONE, "returning to the cursor cancels a queued keyboard menu");
        assert.equal(client.menuKeyboardIndex, undefined);
        plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    } finally {
        Date.now = originalNow;
    }
    plugin.onKeyDown({ code: "Insert", repeat: false } as KeyboardEvent);
    assert.equal(client.firstPersonArmsVisible, false, "Insert must not replace the full body with arms");
    plugin.onKeyDown({ code: "Insert", repeat: false } as KeyboardEvent);
    assert.equal(client.firstPersonArmsVisible, false);
    input.wheelDeltaY = -120;
    assert.equal(
        plugin.handleCameraScroll({ camera: client.camera, input, deltaTime: 0 }),
        true,
        "Backquote mode should handle scroll in either cursor mode",
    );
    assert.ok(client.camera.getViewZoomScale() > 1, "scrolling up should zoom in");

    plugin.onMouseDown({ button: 2 } as MouseEvent);
    assert.equal(facingRotation, undefined, "world menus release camera-controlled facing");
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), true, "opening a menu should keep the reticle target");
    assert.deepEqual(input.getContextMenuAnchor(0, 0), { x: 320, y: crosshairPoint(client.camera).y - 12 },
        "the menu should open above the reticle");
    client.menuOpen = true;
    input.keys.set("KeyW", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(walks.length, movementWalkCount, "world menus pause movement");
    assert.equal(plugin.shouldKeepWorldMenuOpen(), true, "an open Backquote menu should remain available");
    assert.equal(input.isPointerLock(), true, "the virtual menu cursor should keep pointer lock active");
    plugin.onKeyDown({ code: "Insert", repeat: false } as KeyboardEvent);
    assert.equal(client.firstPersonArmsVisible, false, "Insert should not toggle arms while a menu is open");
    plugin.onMouseMove({ movementX: 10, movementY: 5 } as MouseEvent);
    assert.equal(input.mouseX, 330, "the virtual cursor should move from the reticle");
    const reticleY = crosshairPoint(client.camera).y;
    assert.equal(input.mouseY, reticleY + 5, "the virtual cursor should move from the reticle");
    input.clickX = 1;
    input.clickY = 1;
    plugin.onMouseDown({ button: 0 } as MouseEvent);
    assert.equal(client.menuOpen, true, "the menu action must receive the left click before closing");
    assert.equal(input.clickX, 330, "menu clicks should use the virtual cursor position");
    assert.equal(input.clickY, reticleY + 5, "menu clicks should use the virtual cursor position");
    assert.equal(input.isPointerLock(), true, "a left click should resume mouse look");
    client.menuOpen = false;

    plugin.onMouseDown({ button: 2 } as MouseEvent);
    plugin.updateInteractionPointer(client.camera);
    client.menuOpen = true;
    client.menuOpen = false;
    plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 0 });
    assert.equal(input.isPointerLock(), true, "dismissing a menu by leaving it should resume mouse look");

    plugin.onMouseDown({ button: 2 } as MouseEvent);
    client.menuOpen = true;
    input.clickMode1 = ClickMode.RIGHT;
    input.clickMode2 = ClickMode.RIGHT;
    plugin.onMouseDown({ button: 2 } as MouseEvent);
    assert.equal(client.menuOpen, false, "a second right click should close the menu");
    assert.equal(input.clickMode1, ClickMode.NONE, "closing a menu must not open another one");
    assert.equal(input.isPointerLock(), true, "a second right click should resume mouse look");

    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), false, "Alt returns the physical cursor");
    assert.equal(input.enablePointerLock, false, "Alt releases only mouse capture");
    const cursorMovementCalls = movementCalls;
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.length, 0, "WASD still owns the keyboard with the mouse free");
    assert.equal(movementCalls, cursorMovementCalls + 1, "releasing mouse capture does not disable WASD");
    chatText = "unfinished chat draft";
    input.onKeyDown({ code: "Tab", key: "Tab", keyCode: 9, repeat: false, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.isKeyDown("KeyW"), false, "Tab clears held movement immediately");
    input.onKeyDown({ code: "Tab", key: "Tab", keyCode: 9, repeat: true, preventDefault() {} } as KeyboardEvent);
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.at(-1)?.keyPressed, 119, "Tab enables ordinary chat letters and does not repeat-toggle");
    assert.equal(input.keyEvents.some((event) => event.code === "Tab"), false, "mode switching does not activate chat reply shortcuts");
    input.onKeyDown({ code: "Space", key: " ", keyCode: 32, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.at(-1)?.keyPressed, 32, "Space types normally in chat mode");
    const chatWalkCount = walks.length;
    const chatMovementCalls = movementCalls;
    const chatYaw = client.camera.getYaw();
    input.keys.set("ArrowRight", true);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(walks.length, chatWalkCount, "typing cannot move the player");
    assert.equal(movementCalls, chatMovementCalls, "typing cannot submit movement input");
    assert.equal(client.camera.getYaw(), chatYaw, "chat arrows do not turn the camera");
    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    assert.equal(input.isPointerLock(), true, "Option toggles mouse capture independently of chat mode");
    input.onKeyDown({ code: "Tab", key: "Tab", keyCode: 9, repeat: false, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.isPointerLock(), true, "Tab preserves the mouse capture setting");
    assert.equal(input.isKeyDown("KeyW"), false, "leaving chat cannot resume a key held while typing");
    assert.equal(input.isKeyDown("ArrowRight"), false, "leaving chat cannot turn from an arrow held while typing");
    assert.equal(chatText, "unfinished chat draft", "switching modes preserves unfinished chat");
    assert.equal(inventoryTab, 3, "the second Tab opens the native inventory tab");
    assert.equal(inventorySlots[0].keyboardOutline, true, "inventory focus starts with a white slot border");
    const chatEventCount = input.keyEvents.length;
    const inventoryYaw = client.camera.getYaw();
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(movementCalls, chatMovementCalls, "inventory focus pauses WASD movement");
    assert.equal(input.keyEvents.length, chatEventCount, "inventory letters cannot type into chat");
    input.keys.set("ArrowRight", true);
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(input.isKeyDown("ArrowRight"), false);
    assert.equal(inventorySlots[0].keyboardOutline, undefined);
    assert.equal(inventorySlots[1].keyboardOutline, true, "Right moves the border to the next item");
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(client.camera.getYaw(), inventoryYaw, "inventory arrows cannot rotate the camera");
    for (let i = 0; i < 10; i++) plugin.onKeyDown({ code: "ArrowRight", repeat: true } as KeyboardEvent);
    assert.equal(inventorySlots[3].keyboardOutline, true, "horizontal navigation stops at the row edge");
    for (let i = 0; i < 10; i++) plugin.onKeyDown({ code: "ArrowDown", repeat: true } as KeyboardEvent);
    assert.equal(inventorySlots[27].keyboardOutline, true, "vertical navigation stops at the last row");
    for (let i = 0; i < 10; i++) plugin.onKeyDown({ code: "ArrowUp", repeat: true } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(inventorySlots[1].keyboardOutline, true);
    assert.deepEqual(WidgetsOverlay.prototype.getWidgetInputPoint.call(
        { overlayScaleX: 2, overlayScaleY: 2 } as any,
        { _absX: 920, _absY: 320, _absWidth: 72, _absHeight: 64 } as any,
    ), { x: 478, y: 176 }, "inventory clicks account for overlay scaling");
    const nativeActions: any[] = [];
    const interaction = {
        clickedWidget: null as any, clickedWidgetParent: null, clickedWidgetHandled: false,
        isDraggingWidget: false,
        resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false,
        isWidgetDraggable: (widget: any) => (widget.itemId ?? -1) >= 0,
        clearWidgetInteractionState: () => { interaction.clickedWidget = null; },
    } as any;
    const nativeManager = { ...client.widgetManager, invalidateAll: () => undefined };
    const nativeDeps = {
        getCs2Vm: () => ({ invokeEventHandler: (widget: any) => { nativeActions.push({ widget, option: "Make" }); return true; } }),
        getSettings: () => ({ shiftClickEnabled: false }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        getTransmitCycles: () => ({ cycleCntr: 0 }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: () => null,
        executeScriptListener: () => undefined,
        handleWidgetAction: (action: any) => nativeActions.push(action),
    } as any;
    const primary = createPrimaryWidgetActionResolver(nativeDeps, input, nativeManager as any, interaction);
    let nativeUiCalls = 0;
    let nativeHoverCalls = 0;
    const nativeRenderer = {
        uiHidden: false,
        osrsClient: {
            ...client, loginState: { serverListOpen: false }, updateWidgets() {}, runMouseFollowingTimers() {},
            handleUiHover() { nativeHoverCalls++; },
            handleUiInput() {
                nativeUiCalls++;
                const frame = {
                    input, mx: input.mouseX, my: input.mouseY,
                    getWidgetFlags: nativeManager.getWidgetFlags,
                    collectFromAllRoots: (x: number, y: number) => collectWidgetsAtPointAcrossRoots(
                        interfaceRoots.get(client.widgetManager.rootInterface) ?? [inventoryRoot], x, y, new Map(),
                        () => [], (uid) => interfaceRoots.get(client.widgetManager.interfaceParents.get(uid)?.group ?? -1) ?? []),
                } as any;
                processWidgetClickInput(nativeDeps, { cachedHoverHits: null } as any, frame,
                    nativeManager as any, interaction, primary, input.leftClickX !== -1);
                processWidgetReleaseInput(nativeDeps, frame, nativeManager as any, interaction, primary, input.isDragging());
            },
        },
        handleKeyInput() {}, handleControllerInput() {}, handleMouseInput() {},
    };
    const dispatchTap = () => {
        // A draggable item's default action fires on release, on the next frame.
        for (let i = 0; i < 2; i++) {
            GameRenderer.prototype.handleInput.call(nativeRenderer as any, 16);
            input.onFrameEnd();
        }
    };
    // Aiming at the world, the crosshair drives widget hover (the game's mouseover tooltip)
    // but never widget clicks.
    input.flushInput();
    input.setInteractionPointerOverride(320, 200);
    nativeUiCalls = 0;
    GameRenderer.prototype.handleInput.call(nativeRenderer as any, 16);
    assert.deepEqual([nativeUiCalls, nativeHoverCalls], [0, 1], "a world crosshair runs widget hover only");
    input.clearInteractionPointerOverride();
    input.flushInput();
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    assert.deepEqual([input.clickX, input.clickY, input.clickMode1], [520, 176, ClickMode.LEFT],
        "Space clicks the focused item's centre through the normal inventory action path");
    assert.equal(input.isWidgetInteractionPointer(), true, "Space marks its virtual pointer as a widget target");
    dispatchTap();
    assert.deepEqual(nativeActions.map((action) => [action.option, action.slot, action.itemId]), [["Eat", 1, 316]],
        "a single Space tap reaches the native inventory action exactly once through the renderer");
    nativeActions.length = 0;
    input.flushInput();
    const inventoryNow = Date.now;
    let inventoryTime = 2000;
    Date.now = () => inventoryTime;
    try {
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        inventoryTime += 500;
        plugin.updateInteractionPointer(client.camera);
        assert.deepEqual([input.clickX, input.clickY, input.clickMode1], [520, 176, ClickMode.RIGHT],
            "holding Space opens the focused item's native context menu");
        (element as any).__ui = { menu: { open: true, source: "widgets", entries: ["Eat", "Use", "Drop", "Examine", "Cancel"] } };
        client.closeMenu(); // Native widget menu creation closes and resets the world menu.
        plugin.handleCameraMouse({ camera: client.camera, input, deltaTime: 0 });
        assert.equal(client.menuKeyboardIndex, 0, "the widget context menu highlights its first action");
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
        assert.equal(client.menuKeyboardIndex, 1, "Up/Down navigates item options instead of the inventory grid");
        plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
        assert.equal(client.menuKeyboardSelect, true, "Space confirms through the shared context menu action path");
        plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
        plugin.onKeyDown({ code: "Escape" } as KeyboardEvent);
        assert.equal((element as any).__ui.menu, undefined, "Escape closes widget context menus");
        assert.equal(inventorySlots[1].keyboardOutline, true, "closing the item menu retains the inventory selection");
    } finally {
        Date.now = inventoryNow;
    }
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    inventorySlots[2].isHidden = true;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(inventorySlots[2].keyboardOutline, undefined, "consumed items release the border");
    assert.equal(inventorySlots[0].keyboardOutline, true, "selection moves to an available item after consumption");
    inventorySlots[1].isHidden = true;
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(inventorySlots[3].keyboardOutline, true, "arrows skip empty gaps between items");
    for (const widget of inventorySlots) widget.isHidden = true;
    plugin.updateInteractionPointer(client.camera);
    input.flushInput();
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    assert.equal(input.clickMode1, ClickMode.NONE, "Space on an empty slot does not click the world behind it");
    for (const widget of inventorySlots) widget.isHidden = false;
    plugin.updateInteractionPointer(client.camera);
    const replacedSlots = inventorySlots.map((widget) => ({ ...widget }));
    inventoryRoot.children = replacedSlots;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(inventorySlots[3].keyboardOutline, undefined, "rebuilt inventory clears stale outlines");
    assert.equal(replacedSlots[3].keyboardOutline, true, "selection survives native inventory refreshes");
    input.onKeyDown({ code: "Tab", key: "Tab", keyCode: 9, repeat: false, preventDefault() {} } as KeyboardEvent);
    assert.ok(replacedSlots.every((widget) => !widget.keyboardOutline), "the third Tab clears inventory focus");
    assert.equal(input.isPointerLock(), true, "cycling inventory back to movement preserves mouse capture");
    input.flushInput();
    const movementEventCount = input.keyEvents.length;
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    assert.equal(input.keyEvents.length, movementEventCount, "the third Tab returns letters to movement");
    assert.equal(movementCalls, chatMovementCalls + 1);
    plugin.onKeyDown({ code: "AltLeft", repeat: false } as KeyboardEvent);
    assert.equal(input.isKeyDown("KeyW"), true, "Option does not interrupt a held direction");
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(movementCalls, chatMovementCalls + 2, "held movement continues with the mouse free");
    plugin.onKeyUp({ code: "KeyW" } as KeyboardEvent);
    plugin.onKeyDown({ code: "Insert", repeat: false } as KeyboardEvent);
    assert.equal(client.firstPersonArmsVisible, false, "cursor mode keeps the full model");

    input.flushInput();
    const group = 7000, sideGroup = 7001, frameGroup = 999;
    const item = (slot: number, groupId = group) => ({
        uid: (groupId << 16) | 2, groupId, fileId: -1, childIndex: slot,
        parentUid: (groupId << 16) | 2, type: 5, x: slot % 4 * 40, y: Math.floor(slot / 4) * 40,
        width: 32, height: 32, itemId: 100 + slot, actions: ["Withdraw-1", "Withdraw-All"], flags: 0x7fe,
        isHidden: false, keyboardOutline: undefined as boolean | undefined,
    });
    const bankItems = Array.from({ length: 12 }, (_, slot) => item(slot));
    const bankList = { uid: (group << 16) | 2, childIndex: -1, type: 0, x: 5, y: 5,
        width: 160, height: 60, scrollHeight: 120, scrollY: 0, children: bankItems };
    const closeButton = { uid: (group << 16) | 1, childIndex: -1, x: 165, y: 0, width: 20, height: 20,
        actions: ["Close"], flags: 2 };
    const mainRoot = { uid: group << 16, x: 3, y: 4, width: 200, height: 140, type: 0, children: [closeButton, bankList] };
    const sideItems = [item(0, sideGroup), item(1, sideGroup)];
    for (const widget of sideItems) widget.actions = ["Deposit-1", "Deposit-All"];
    const sideRoot = { uid: sideGroup << 16, x: 0, y: 0, width: 160, height: 140, type: 0, children: sideItems };
    const gameRoot = { uid: frameGroup << 16, type: 0, x: 20, y: 10, width: 300, height: 220,
        __widgetRenderScale: 2, __widgetRenderOffsetX: 4, __widgetRenderOffsetY: 6,
        children: [
            { uid: (frameGroup << 16) | 11, type: 0, x: 10, y: 15, width: 200, height: 140 },
            { uid: (frameGroup << 16) | 12, type: 0, x: 215, y: 15, width: 160, height: 140 },
        ],
    };
    interfaceRoots.set(frameGroup, [gameRoot]);
    interfaceRoots.set(group, [mainRoot]);
    interfaceRoots.set(sideGroup, [sideRoot]);
    client.widgetManager.rootInterface = frameGroup;
    client.widgetManager.interfaceParents.set((frameGroup << 16) | 11, { group, type: 0 });
    client.widgetManager.interfaceParents.set((frameGroup << 16) | 12, { group: sideGroup, type: 3 });
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[0].keyboardOutline, true, "an arbitrary container opens with its first item focused, rather than Close");
    const beforeInterfaceMovement = movementCalls;
    input.onKeyDown({ code: "KeyW", key: "w", keyCode: 87, preventDefault() {} } as KeyboardEvent);
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 16 });
    assert.equal(movementCalls, beforeInterfaceMovement, "interface focus pauses WASD");
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    // No render between changing the selection and pressing Space.
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    assert.deepEqual([input.clickX, input.clickY], [192, 106], "interface clicks include the mount, gameframe offsets and UI scaling");
    dispatchTap();
    assert.equal(nativeActions.at(-1)?.option, "Withdraw-1");
    assert.equal(nativeActions.at(-1)?.slot, 1, "an immediate tap clicks the new selection, not the previous virtual pointer");
    nativeActions.length = 0;
    plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
    assert.equal(bankItems[9].keyboardOutline, true);
    assert.equal(bankList.scrollY, 52, "moving below the visible bank list scrolls the selected item into view");
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    dispatchTap();
    assert.equal(nativeActions.at(-1)?.slot, 9, "Space can activate an item revealed by keyboard scrolling");
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(bankItems[11].keyboardOutline, true, "Right navigates within the container row first");
    (element as any).__ui = { menu: { open: true, source: "widgets", entries: ["Withdraw-1", "Cancel"] } };
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(bankItems[11].keyboardOutline, true, "an open context menu blocks panel switching");
    (element as any).__ui.menu = undefined;
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(bankItems[11].keyboardOutline, undefined);
    assert.equal(sideItems[0].keyboardOutline, true, "Right at the row edge crosses into the panel on the right");
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowRight", repeat: true } as KeyboardEvent);
    assert.equal(sideItems[1].keyboardOutline, true, "Right at the outside edge does not wrap to the left panel");
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(sideItems[0].keyboardOutline, true, "Left navigates within the inventory row first");
    for (const widget of sideItems) widget.isHidden = true;
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(bankItems[11].keyboardOutline, true, "Left returns from an empty inventory and remembers the container selection");
    assert.ok(sideItems.every((widget) => !widget.keyboardOutline));
    for (const widget of sideItems) widget.isHidden = false;
    plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(bankItems[11].keyboardOutline, true, "Left crosses back from the inventory's first column");
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(bankItems[9].keyboardOutline, true);
    plugin.onKeyDown({ code: "Tab", repeat: false } as KeyboardEvent);
    assert.equal(bankItems[9].keyboardOutline, undefined);
    assert.equal(sideItems[0].keyboardOutline, true, "Tab switches to the inventory replacement panel");
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    dispatchTap();
    assert.equal(nativeActions.at(-1)?.option, "Deposit-1", "the same tap executes the other panel's native default action");
    plugin.onKeyDown({ code: "Tab", repeat: false } as KeyboardEvent);
    assert.equal(bankItems[9].keyboardOutline, true, "Tab remembers each panel's selection");
    client.cs2Vm.inputDialogType = 3;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[9].keyboardOutline, undefined, "quantity entry temporarily releases keyboard selection");
    assert.equal(plugin.onKeyDown({ code: "Tab", repeat: false } as KeyboardEvent), false, "quantity entry retains Tab and text input");
    client.cs2Vm.inputDialogType = 1;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[9].keyboardOutline, true);
    pendingWidgetTextInput = true;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[9].keyboardOutline, undefined, "pending Withdraw-X/search input releases focus even with the default dialogue flag");
    assert.equal(input.hasInteractionPointerOverride(), false);
    assert.equal(plugin.onKeyDown({ code: "Digit5", key: "5", repeat: false } as KeyboardEvent), false,
        "quantity characters reach the native text handler");
    pendingWidgetTextInput = false;
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[9].keyboardOutline, true);
    interfaceRoots.set(149, [inventoryRoot]);
    client.widgetManager.interfaceParents.set((frameGroup << 16) | 12, { group: 149, type: 1 });
    plugin.updateInteractionPointer(client.camera);
    assert.equal(replacedSlots[3].keyboardOutline, true, "the ordinary inventory also participates in container focus");
    for (let i = 0; i < 4; i++) plugin.onKeyDown({ code: "ArrowLeft" } as KeyboardEvent);
    assert.equal(bankItems[9].keyboardOutline, true, "Left crosses from the ordinary inventory into the container");
    for (let i = 0; i < 3; i++) plugin.onKeyDown({ code: "ArrowRight" } as KeyboardEvent);
    assert.equal(replacedSlots[0].keyboardOutline, true, "Right returns to the ordinary inventory with its selection preserved");
    client.widgetManager.interfaceParents.clear();
    plugin.updateInteractionPointer(client.camera);
    assert.equal(bankItems[9].keyboardOutline, undefined, "closing the interface releases its focus box");
    const makeChoices = [0, 1, 2].map((slot) => ({
        uid: (group << 16) | (20 + slot), childIndex: -1, type: 4, text: `Make ${slot + 1}`,
        x: 10, y: slot * 30, width: 120, height: 22, eventHandlers: { onClick: {} },
        keyboardOutline: undefined as boolean | undefined,
    }));
    interfaceRoots.set(group, [{ uid: group << 16, type: 0, x: 0, y: 0, width: 160, height: 100, children: makeChoices }]);
    interfaceRoots.set(162, [{ uid: 162 << 16, type: 0, x: 0, y: 0, width: 200, height: 140,
        children: [{ uid: (162 << 16) | 567, type: 0, x: 0, y: 0, width: 160, height: 100 }] }]);
    client.widgetManager.interfaceParents.set((frameGroup << 16) | 11, { group: 162, type: 1 });
    client.widgetManager.interfaceParents.set((162 << 16) | 567, { group, type: 0 });
    plugin.updateInteractionPointer(client.camera);
    assert.equal(makeChoices[0].keyboardOutline, true, "crafting choices nested in the chat overlay use the same generic focus path");
    plugin.onKeyDown({ code: "ArrowDown" } as KeyboardEvent);
    assert.equal(makeChoices[1].keyboardOutline, true);
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    plugin.onKeyUp({ code: "Space" } as KeyboardEvent);
    dispatchTap();
    assert.equal(nativeActions.at(-1)?.widget, makeChoices[1], "Space invokes the focused option's native script listener");
    client.widgetManager.interfaceParents.clear();
    plugin.updateInteractionPointer(client.camera);
    assert.ok(makeChoices.every((widget) => !widget.keyboardOutline));
    client.widgetManager.rootInterface = -1;
    interfaceRoots.clear();
    input.setInteractionPointerOverride(320, 240);
    const nativeUiCallCount = nativeUiCalls;
    GameRenderer.prototype.handleInput.call(nativeRenderer as any, 16);
    assert.equal(nativeUiCalls, nativeUiCallCount, "a world reticle still skips widget input");
    input.clearInteractionPointerOverride();

    input.flushInput();
    const choices = ["Yes", "No", "Tell me more"].map((text, index) => ({
        uid: (219 << 16) | 1, type: 4, childIndex: index + 1, text, textColor: 0,
        keyboardTextColor: undefined as number | undefined,
    }));
    const heading = { type: 4, childIndex: 0, text: "Select an option" };
    dialogueRoot = { children: [heading, ...choices, { type: 5, childIndex: 4 }] };
    client.widgetManager.interfaceParents.set(162 << 16, { type: 0, group: 219 });
    plugin.updateInteractionPointer(client.camera);
    assert.deepEqual(choices.map((widget) => widget.keyboardTextColor), [0xffffff, 0, 0],
        "an options dialogue starts with only the first choice highlighted white");
    assert.equal((heading as any).keyboardTextColor, undefined, "the heading is not an option");
    plugin.onKeyDown({ code: "ArrowUp" } as KeyboardEvent);
    assert.equal(choices[0].keyboardTextColor, 0xffffff, "Up stops at the first choice");
    input.keys.set("ArrowDown", true);
    for (let i = 0; i < 4; i++) plugin.onKeyDown({ code: "ArrowDown", repeat: true } as KeyboardEvent);
    assert.deepEqual(choices.map((widget) => widget.keyboardTextColor), [0, 0, 0xffffff],
        "held Down advances through the options and stops at the last choice");
    assert.equal(input.isKeyDown("ArrowDown"), false, "dialogue arrows cannot turn the camera");
    plugin.onKeyDown({ code: "ArrowUp" } as KeyboardEvent);
    choices[0].textColor = 0xffffff; // Native mouse hover scripts may run while navigating.
    plugin.updateInteractionPointer(client.camera);
    assert.deepEqual(choices.map((widget) => widget.keyboardTextColor), [0, 0xffffff, 0],
        "keyboard selection overrides mouse hover colours without mutating them");
    const dialogueYaw = client.camera.getYaw();
    const dialogueMovementCalls = movementCalls;
    plugin.handleCameraKeys({ camera: client.camera, input, deltaTime: 100 });
    assert.equal(client.camera.getYaw(), dialogueYaw);
    assert.equal(movementCalls, dialogueMovementCalls, "choices pause world movement");
    input.onKeyDown({ code: "Space", key: " ", keyCode: 32, repeat: false, preventDefault() {} } as KeyboardEvent);
    assert.deepEqual(input.keyEvents.map((event) => [event.code, event.keyPressed]), [["Digit2", 50]],
        "Space selects the highlighted choice through the existing number-key handler");
    plugin.onKeyDown({ code: "Space", repeat: true } as KeyboardEvent);
    assert.equal(input.keyEvents.length, 1, "holding Space cannot submit repeated choices");
    input.flushInput();
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    assert.equal(input.keyEvents[0].keyPressed, 50,
        "Space can retry if the native dialogue temporarily blocks input while opening");
    const nextChoices = choices.slice(0, 2).map((widget) => ({ ...widget, text: `${widget.text} again` }));
    dialogueRoot.children = [heading, ...nextChoices];
    plugin.updateInteractionPointer(client.camera);
    assert.deepEqual(nextChoices.map((widget) => widget.keyboardTextColor), [0xffffff, 0],
        "rebuilding choices in the same chatbox resets selection to the first option");
    assert.ok(choices.every((widget) => widget.keyboardTextColor === undefined));
    input.flushInput();
    plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent);
    assert.equal(input.keyEvents[0].keyPressed, 49, "a new dialogue accepts selection again");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.ok(nextChoices.every((widget) => widget.keyboardTextColor === undefined), "leaving first person restores native colours");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(nextChoices[0].keyboardTextColor, 0xffffff);
    dialogueHidden = true;
    plugin.updateInteractionPointer(client.camera);
    assert.ok(nextChoices.every((widget) => widget.keyboardTextColor === undefined), "hidden dialogues release their selection");
    dialogueHidden = false;
    client.widgetManager.interfaceParents.clear();
    client.widgetManager.interfaceParents.set(162 << 16, { type: 0, group: 231 });
    assert.equal(plugin.onKeyDown({ code: "Space", repeat: false } as KeyboardEvent), false,
        "ordinary NPC dialogue retains the native Space-to-continue handler");
    client.widgetManager.interfaceParents.clear();
    input.flushInput();

    inGame = false;
    input.keys.set("KeyW", true);
    input.setInteractionPointerOverride(320, 240);
    plugin.updateInteractionPointer(client.camera);
    assert.equal(input.hasInteractionPointerOverride(), false, "the reticle must be hidden outside the game");
    assert.equal(input.isKeyDown("KeyW"), false, "logout clears held movement keys");
    inGame = true;
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(client.followPlayerCamera, false, "disabling close view restores the camera mode");
    assert.equal(client.renderSelf, true, "disabling close view restores local body visibility");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(gameMessages.length, 2, "a new login session should show the controls hint again");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    client.renderSelf = false;
    client.firstPersonArmsVisible = true;
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(client.renderSelf, true);
    assert.equal(client.firstPersonArmsVisible, false);
    input.keys.set("KeyW", true);
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(client.renderSelf, false, "exit restores the prior local-render preference");
    assert.equal(client.firstPersonArmsVisible, true, "exit restores the prior arms-render preference");
    assert.equal(input.isKeyDown("KeyW"), false, "exit clears movement keys before ordinary camera/chat input resumes");
    assert.equal(facingRotation, undefined, "leaving first-person restores normal movement facing");

    // Controller: its first input switches Backquote on; the sticks move and look, and the
    // buttons map onto the keyboard actions (Dragonwilds-style layout).
    input.keys.clear();
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] } as any;
    const padFrame = (deltaTime = 16) => plugin.handleGamepad({ gamepad: pad, camera: client.camera, input, deltaTime });
    const padTap = (button: number) => {
        pad.buttons[button].pressed = true;
        padFrame();
        pad.buttons[button].pressed = false;
        padFrame();
    };
    assert.equal(padFrame(), false, "an idle controller leaves the normal camera alone");
    const messagesBeforePad = gameMessages.length;
    padTap(0);
    assert.equal(client.followPlayerCamera, true, "the first controller input switches Backquote on");
    assert.ok(gameMessages.slice(messagesBeforePad).some((message) => message.startsWith("Controller:")),
        "the controller layout is explained once");
    const walksBeforePad = movementCalls;
    pad.axes[1] = -1;
    padFrame();
    assert.ok(movementCalls > walksBeforePad, "the left stick walks");
    const stopsBeforePad = stoppedWalks;
    pad.axes[1] = 0;
    padFrame();
    assert.ok(stoppedWalks > stopsBeforePad, "letting go of the left stick stops");
    const yawBeforePad = client.camera.yaw;
    pad.axes[2] = 1;
    padFrame(100);
    pad.axes[2] = 0;
    assert.ok(Math.abs(client.camera.yaw - yawBeforePad - 64) < 1e-6, "the right stick turns at 640 units a second");
    input.flushInput();
    padTap(0);
    assert.equal(input.clickMode1, ClickMode.LEFT, "A interacts at the crosshair, like a Space tap");
    input.flushInput();
    inventoryTab = -1;
    padTap(3);
    assert.equal(inventoryTab, 3, "Y opens the inventory");
    padTap(1);
    assert.equal((plugin as any).inputMode, "movement", "B leaves the inventory");
    let closedInterfaces = 0;
    (client as any).closeModalInterface = () => { closedInterfaces++; return true; };
    padTap(1);
    assert.equal(closedInterfaces, 1, "B in the world closes the open interface");
    const special = { uid: 160 << 16 | 35, actions: ["Use <col=ff9040>Special Attack</col>"], children: [] };
    interfaceRoots.set(-1, [{ uid: 160 << 16, actions: [], children: [special] }]);
    const widgetActions: any[] = [];
    (client as any).handleWidgetAction = (event: any) => widgetActions.push(event);
    padTap(5);
    assert.deepEqual(widgetActions.map((event) => [event.widget.uid, event.option]),
        [[special.uid, special.actions[0]]], "RB uses the special attack orb's option");
    interfaceRoots.delete(-1);
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    console.log("controller ok");
    plugin.onKeyDown({ code: "Backquote", repeat: false } as KeyboardEvent);
    assert.equal(plugin.isActive(), true);
    plugin.exitCameraMode();
    assert.equal(plugin.isActive(), false, "visible exit button can leave close camera without a keyboard shortcut");
    const restoredFollow = client.followPlayerCamera;
    plugin.exitCameraMode();
    assert.equal(client.followPlayerCamera, restoredFollow, "repeated exit preserves the restored camera preference");
} finally {
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
    });
}

// Camera-facing movement uses the existing directional animations without the
// normal turn penalty slowing strafing/backpedalling to half speed.
for (const traversal of [1, 2]) for (const [dx, dy, walkSeq] of [
    [0, 1, 10], [1, 0, 13], [0, -1, 11], [-1, 0, 12],
]) {
    const ecs = new PlayerEcs();
    const index = ecs.allocatePlayer(1);
    const other = ecs.allocatePlayer(2);
    ecs.teleport(index, 100, 100);
    ecs.teleport(other, 100, 100);
    ecs.setAnimSet(index, { idle: 9, walk: 10, walkBack: 11, walkLeft: 12, walkRight: 13,
        run: 20, runBack: 21, runLeft: 22, runRight: 23 });
    ecs.setRotationOverride(index, 1024);
    ecs.setTargetRot(index, 0); // Simulate a conflicting server orientation update.
    ecs.setServerPos(index, (100 + dx) * 128 + 64, (100 + dy) * 128 + 64, traversal);
    ecs.updateClient();
    assert.equal(ecs.getRotation(index), 1024, "movement cannot turn the body away from the camera");
    assert.equal(ecs.getTargetRotation(index), 1024, "idle animation resolvers cannot mistake camera facing for a pending turn");
    assert.equal(ecs.getAnimMovementSeqId(index), walkSeq + (traversal === 2 ? 10 : 0));
    assert.deepEqual([ecs.getX(index), ecs.getY(index)],
        [100 * 128 + 64 + dx * 4 * traversal, 100 * 128 + 64 + dy * 4 * traversal]);
    assert.equal(ecs.getRotation(other), 0, "camera facing only affects the controlled player");
    ecs.setRotationOverride(index, undefined);
    ecs.updateClient();
    if (dy !== 1) assert.notEqual(ecs.getRotation(index), 1024, "normal movement-facing resumes on exit");
    ecs.setRotationOverride(index, 1536);
    ecs.startForcedMovement(index, ecs.getClientCycle(), ecs.getClientCycle() + 10,
        ecs.getX(index), ecs.getY(index), ecs.getX(index) + 128, ecs.getY(index), 512);
    ecs.updateClient();
    assert.equal(ecs.getRotation(index), 512, "forced movement keeps its scripted facing");
    ecs.deallocatePlayer(1);
    const replacement = ecs.allocatePlayer(3);
    assert.equal(replacement, index);
    ecs.updateClient();
    assert.equal(ecs.getRotation(replacement), 0, "reused player slots cannot retain camera facing");
}

// Holding a direction while turning must not flicker between animation clips at
// the diagonal boundaries because of input/yaw rounding.
for (const [forward, right] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]]) {
    const ecs = new PlayerEcs();
    const index = ecs.allocatePlayer(1);
    ecs.teleport(index, 100, 100);
    ecs.setAnimSet(index, { idle: 9, walk: 10, walkBack: 11, walkLeft: 12, walkRight: 13,
        run: 20, runBack: 21, runLeft: 22, runRight: 23 });
    let firstSequence: number | undefined;
    for (let yaw = 0; yaw < 2048; yaw++) {
        const angle = yaw * Math.PI / 1024;
        const length = Math.hypot(forward, right);
        // Match the direction's quantisation in ContinuousMovement.setInput.
        const dx = Math.round((Math.sin(angle) * forward + Math.cos(angle) * right) / length * 32767);
        const dy = Math.round((Math.cos(angle) * forward - Math.sin(angle) * right) / length * 32767);
        const rotation = (yaw + 1024) & 2047;
        ecs.setRotationOverride(index, rotation);
        ecs.setContinuousPosition(index, 12864, 12864, dx / 32767, dy / 32767, true, true, rotation);
        ecs.updateClient();
        firstSequence ??= ecs.getAnimMovementSeqId(index);
        assert.equal(ecs.getAnimMovementSeqId(index), firstSequence,
            `held direction ${forward},${right} keeps its run pose at camera yaw ${yaw}`);
    }
}

console.log("first-person reticle input ok");


{
    // Level camera looking north: a point 9 degrees above the view direction lands on the crosshair,
    // at any zoom (the running FOV changes the zoom scale).
    for (const zoomScale of [1, 0.82]) {
        const camera = new Camera(0, 0, 0, 0, 0);
        camera.setViewPitchOverride(0);
        camera.setViewZoomScale(zoomScale);
        camera.update(640, 480);
        const raise = crosshairRaisePixels(camera);
        assert.ok(raise > 10, "the crosshair sits clearly above the view centre");
        const clip = vec4.fromValues(0, -Math.tan(9 * Math.PI / 180) * 10, 10, 1);
        vec4.transformMat4(clip, clip, camera.viewProjMatrix);
        const screenY = (1 - (clip[1] / clip[3] + 1) / 2) * camera.screenHeight;
        assert.ok(Math.abs(screenY - (camera.viewportYOffset + camera.viewportHeight / 2 - raise)) < 0.5,
            `the raised crosshair aims 9 degrees up at zoom scale ${zoomScale}`);
    }
}
console.log("crosshair aim ok");

