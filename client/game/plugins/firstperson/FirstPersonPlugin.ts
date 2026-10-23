import type { OsrsClient } from "../../OsrsClient";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Camera } from "../../Camera";
import type { InputKeyHandler, InputManager, InputMouseHandler } from "../../InputManager";
import type { CameraFollowContext, CameraInputContext, ClientPlugin, GamepadContext } from "../ClientPluginManager";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import type { PlayerEcs } from "../../ecs/PlayerEcs";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import { deriveMenuEntriesForWidget, getRootRenderTransform } from "../../../widgets/menu/utils";
import { CollisionFlag } from "../../../common/CollisionFlag";
import type { HitsplatEventPayload } from "../../GameRenderer";
import { NO_INTERACTION } from "../../../rs/interaction/InteractionIndex";

if (typeof document !== "undefined") require("./FirstPersonPlugin.css");

type FirstPersonClient = {
    camera: Camera;
    inputManager: InputManager;
    renderSelf: boolean;
    firstPersonArmsVisible?: boolean;
    followPlayerCamera: boolean;
    menuOpen: boolean;
    menuKeyboardIndex?: number;
    menuKeyboardSelect?: boolean;
    menuActiveSimpleEntries?: readonly unknown[];
    controlledPlayerServerId?: number;
    playerEcs?: Pick<PlayerEcs, "getIndexForServerId" | "getX" | "getY" | "getDefaultHeightTiles" | "setRotationOverride"> &
        Partial<Pick<PlayerEcs, "isMoving" | "isRunVisual" | "getInteractionIndex" | "getRotation">> &
        { getLevel?(index: number): number };
    runMode?: boolean;
    setKeyboardMovement?(dx: number, dy: number, running: boolean, rotation: number): void;
    stopKeyboardMovement?(deactivate?: boolean): void;
    setKeyboardRunMode?(running: boolean): void;
    switchToTab?(tab: number, forceOpen?: boolean): void;
    renderer?: { widgetsOverlay?: { getWidgetInputPoint(widget: WidgetNode): { x: number; y: number } | undefined } };
    cs2Vm?: { inputDialogType: number };
    isWidgetTextInputActive?(): boolean;
    widgetManager?: Pick<WidgetManager, "interfaceParents"> & Partial<Pick<WidgetManager,
        "rootInterface" | "findWidget" | "isEffectivelyHidden" | "invalidateWidgetRender" |
        "getAllGroupRoots" | "getStaticChildrenByParentUid" | "getWidgetFlags" | "getWidgetByUid" |
        "invalidateScroll" | "ensureLayout">>;
    isLoggedIn(): boolean;
    addGameMessage(message: string): void;
    closeModalInterface?(): boolean;
    handleWidgetAction?(event: { widget: WidgetNode; option: string; source: "primary" }): void;
    closeMenu(): void;
};

type CursorMode = "none" | "alt" | "menu";
type InputMode = "movement" | "chat" | "inventory" | "interface";
type KeyboardWidget = {
    widget: WidgetNode;
    root: WidgetNode;
    x: number;
    y: number;
    parent?: KeyboardWidget;
};
const MENU_ANCHOR_Y_OFFSET = 12;
const CONTROLS_HINT = "WASD to move. Tab cycles movement, chat and inventory. Arrows select items or interface options. Left/Right at an item row's edge switches panels; Tab also switches panels. Option/Alt toggles mouse look. Hold Shift to run. Tap Space to interact; hold Space for options, then Up/Down and Space to choose.";
const SPACE_MENU_HOLD_MS = 450;
// Controller (standard mapping) button indices.
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const PAD_ARROWS = new Map<number, string>([
    [PAD.UP, "ArrowUp"], [PAD.DOWN, "ArrowDown"], [PAD.LEFT, "ArrowLeft"], [PAD.RIGHT, "ArrowRight"],
]);
const STICK_DEADZONE = 0.18;
/** Right stick look at full tilt, RS units per second (about 110 degrees a second). */
const LOOK_STICK_SPEED = 640;
const DPAD_REPEAT_DELAY_MS = 380;
const DPAD_REPEAT_MS = 110;
const CONTROLLER_HINT = "Controller: left stick moves (click to run), right stick looks. A or X interacts, RT uses, hold LT for options. Y inventory, B back, RB special attack, D-pad selects, bumpers switch panels.";
const MOVEMENT_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD"];
const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
// Behind-the-character camera, in tiles and RS angle units (2048 per turn, positive looks down).
const FOLLOW_DISTANCE = 2.6;
const PIVOT_HEIGHT = 0.9; // of the player's model height
const DEFAULT_PITCH = 152; // about 27 degrees down: a little above and looking down on the player
// Mouse look turns the same angle per pixel both ways, as third-person shooters do
// (RS angle units: 2048 per turn, so 0.7 is about 0.12 degrees per pixel).
const LOOK_SENSITIVITY = 0.7;
// Arrow keys, RS units per second: turning 90 degrees a second, looking up/down a little slower.
const YAW_KEY_SPEED = 512;
const PITCH_KEY_SPEED = 384;
const MIN_PITCH = -192;
const MAX_PITCH = 400;
const WALL_MARGIN = 0.3;
const GROUND_CLEARANCE = 0.3;
// Running widens the view by shrinking the zoom scale: 0.82 is roughly +9 degrees.
const RUN_FOV_KICK = 0.18;
const HIT_SECONDS = 0.35;
const HIT_FULL_DAMAGE = 40;
/** Poison and venom hitsplats (yours, others', venom): a green pulse instead of the red jolt. */
const POISON_SPLATS = new Set([65, 66, 5]);
const POISON_SECONDS = 1.2;
const POISON_PULSES = 2;
// The camera orbits a point near the player's neck, so the view centre is on the player; aiming
// this far above it clears the head and lands on players and NPCs about 3-5 tiles ahead.
const CROSSHAIR_RAISE_DEGREES = 9;
// How quickly the camera swings round behind a player turning to face its target (per second).
const FACE_TARGET_RATE = 6;
// A wall on the side of the tile the ray enters through stops the camera (bits match CollisionFlag).
const ENTRY_WALLS = new Map([
    ["1,0", CollisionFlag.WALL_WEST_PROJECTILE_BLOCKER], ["-1,0", CollisionFlag.WALL_EAST_PROJECTILE_BLOCKER],
    ["0,1", CollisionFlag.WALL_SOUTH_PROJECTILE_BLOCKER], ["0,-1", CollisionFlag.WALL_NORTH_PROJECTILE_BLOCKER],
]);


export class FirstPersonPlugin extends Plugin implements ClientPlugin, InputKeyHandler, InputMouseHandler {
    static descriptor: PluginDescriptor = {
        name: "First Person",
        description: "First-person camera with mouse look.",
        tags: ["camera"],
        hidden: true,
        configKey: "firstpersonplugin",
    };

    private enabled = false;
    private inputMode: InputMode = "movement";
    private inventorySlot = 0;
    private inventoryWidget?: WidgetNode;
    private interfaceGroups: number[] = [];
    private interfaceGroup?: number;
    private interfaceWidgets = new Map<number, KeyboardWidget[]>();
    private interfacePanels = new Map<number, KeyboardWidget>();
    private interfaceWidget?: KeyboardWidget;
    private interfaceSelections = new Map<number, { uid: number; childIndex?: number }>();
    private restoreInputMode?: InputMode;
    private interfaceMounts = "";
    private interfaceScanAt = 0;
    private cursorMode: CursorMode = "none";
    private awaitingMenuOpen = false;
    private menuOpenChecked = false;
    private menuPointerX = 0;
    private menuPointerY = 0;
    private restoreRenderSelf?: boolean;
    private restoreArmsVisible?: boolean;
    private restoreFollowPlayerCamera?: boolean;
    private controlsHintShown = false;
    private restoreRunMode?: boolean;
    private spaceDown = false;
    private spaceStartedAt = 0;
    private spaceHandled = false;
    private facingPlayerIndex?: number;
    private zoomScale = 1;
    private runBlend = 0;
    private lastFollowAt = 0;
    private hitAt = -Infinity;
    private hitStrength = 0;
    private hitVignette = 0;
    private poisonAt = -Infinity;
    private poisonStrength = 0;
    private poisonVignette = 0;
    private padButtons: boolean[] = [];
    private padStick = { forward: 0, right: 0 };
    private padMoving = false;
    private padRepeatAt = 0;
    private controllerHintShown = false;
    /** The keyboard steered last (not the mouse): with a free cursor the crosshair aims. */
    private keyboardAiming = false;
    private dialogueOptions: WidgetNode[] = [];
    private dialogueOptionIndex = 0;
    private readonly client: FirstPersonClient;

    constructor(client?: FirstPersonClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client.inputManager.addKeyHandler(this);
        this.client.inputManager.addMouseHandler(this);
    }

    onKeyDown(event: KeyboardEvent): boolean {
        if (event.code === "Backquote" && !event.repeat) {
            this.setEnabled(!this.enabled);
            return true;
        }
        if (MOVEMENT_KEYS.includes(event.code) || ARROW_KEYS.includes(event.code) || event.code === "Space") {
            this.keyboardAiming = true;
        }
        this.syncInterfaceSelection(true);
        this.syncDialogueOptions();
        if (this.dialogueOptions.length > 0 &&
            (event.code === "Space" || event.code === "ArrowUp" || event.code === "ArrowDown")) {
            this.clearMovement();
            this.spaceHandled = true;
            this.client.inputManager.keys.delete(event.code);
            if (event.code === "Space") {
                if (!event.repeat) {
                    // Use the cache dialogue's existing number-key selection handler.
                    const option = this.dialogueOptions[this.dialogueOptionIndex].childIndex!;
                    this.client.inputManager.enqueueTypedChar(48 + option, `Digit${option}`);
                }
            } else {
                this.dialogueOptionIndex = Math.max(0, Math.min(this.dialogueOptions.length - 1,
                    this.dialogueOptionIndex + (event.code === "ArrowUp" ? -1 : 1)));
                const choice = this.dialogueOptions[this.dialogueOptionIndex];
                this.selectInterfaceWidget(this.interfaceWidgets.get(219)?.find((target) => target.widget === choice));
                this.syncDialogueOptions();
            }
            return true;
        }
        if (event.code === "Tab" && this.canUseKeyboard() && (this.canControlPlayer() || this.interfaceGroups.length > 0)) {
            if (!event.repeat) {
                if (this.interfaceGroups.length > 0) {
                    const index = this.interfaceGroups.indexOf(this.interfaceGroup ?? -1);
                    this.interfaceGroup = this.interfaceGroups[(index + (event.shiftKey ? -1 : 1) + this.interfaceGroups.length) % this.interfaceGroups.length];
                    this.inputMode = this.interfaceGroup === 149 ? "inventory" : "interface";
                } else {
                    this.inputMode = this.inputMode === "movement" ? "chat" : this.inputMode === "chat" ? "inventory" : "movement";
                }
                this.applyInputFocus();
            }
            return true;
        }
        if (this.cursorMode === "menu" && this.canInteract()) {
            if (event.code === "Escape") {
                this.spaceHandled = true;
                this.client.inputManager.clickMode1 = 0;
                this.client.inputManager.clickMode2 = 0;
                this.client.inputManager.clickMode3 = 0;
                this.closeWorldMenu();
                this.resumeMouseLook();
                return true;
            }
            if (event.code === "ArrowUp" || event.code === "ArrowDown") {
                this.client.inputManager.keys.delete(event.code);
                const count = this.getWidgetMenu()?.entries?.length ?? this.client.menuActiveSimpleEntries?.length ?? 0;
                this.client.menuKeyboardIndex = Math.max(0, Math.min(Math.max(0, count - 1),
                    (this.client.menuKeyboardIndex ?? 0) + (event.code === "ArrowUp" ? -1 : 1)));
                return true;
            }
        }
        if ((this.inputMode === "inventory" || this.inputMode === "interface") && this.canInteract() && ARROW_KEYS.includes(event.code)) {
            this.client.inputManager.keys.delete(event.code);
            if (this.isMenuOpen() || this.cursorMode === "menu") return true;
            if (this.inputMode === "interface") this.moveInterfaceSelection(event.code);
            else {
                const column = this.inventorySlot % 4;
                const row = Math.floor(this.inventorySlot / 4);
                const horizontal = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
                const vertical = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
                const distance = (widget: WidgetNode) =>
                    Math.abs(Math.floor(widget.childIndex! / 4) - row) * 4 + Math.abs(widget.childIndex! % 4 - column);
                const next = this.getInventorySlots().filter((widget) => horizontal
                    ? Math.floor(widget.childIndex! / 4) === row && (widget.childIndex! % 4 - column) * horizontal > 0
                    : (Math.floor(widget.childIndex! / 4) - row) * vertical > 0,
                ).sort((a, b) => distance(a) - distance(b))[0];
                if (next) this.inventorySlot = next.childIndex!;
                else if (horizontal) this.switchInterfacePanel(horizontal);
                this.syncInventorySelection();
            }
            return true;
        }
        if (event.code === "Space") {
            if (this.spaceDown) return true;
            if (!this.canInteract()) return false;
            if (event.repeat) return true;
            this.spaceDown = true;
            this.spaceStartedAt = Date.now();
            this.spaceHandled = this.cursorMode === "menu" || this.isMenuOpen();
            if (this.isMenuOpen() && this.cursorMode !== "menu") this.enterMenuMode();
            if (this.spaceHandled && this.isMenuOpen()) {
                this.client.menuKeyboardIndex ??= 0;
                this.client.menuKeyboardSelect = true;
            }
            return true;
        }
        if (MOVEMENT_KEYS.includes(event.code) && this.canMove()) {
            // Consume movement before the normal chat character queue.
            this.client.inputManager.keys.set(event.code, true);
            this.handleMovement(this.client.camera, this.client.inputManager);
            return true;
        }
        if (
            (event.code === "AltLeft" || event.code === "AltRight") &&
            this.enabled &&
            !event.repeat
        ) {
            if (this.cursorMode === "alt") {
                this.client.inputManager.enablePointerLock = true;
                this.resumeMouseLook();
            }
            else this.unlockCursor();
            return true;
        }
        if (this.canInteract() &&
            (event.key?.length === 1 || event.code === "Enter" || event.code === "Backspace") &&
            !event.ctrlKey && !event.metaKey && !event.altKey) return true;
        return false;
    }

    onKeyUp(event: KeyboardEvent): boolean {
        if (event.code === "Space" && this.spaceDown) {
            if (!this.spaceHandled && this.canInteract() && !this.isMenuOpen()) {
                if (Date.now() - this.spaceStartedAt >= SPACE_MENU_HOLD_MS) this.openSpaceMenu();
                else {
                    this.clearMovement();
                    const point = this.getActionPoint();
                    if (point) {
                        if (this.inputMode === "inventory" || this.inputMode === "interface") {
                            this.client.inputManager.setInteractionPointerOverride(point.x, point.y, true);
                        }
                        this.client.inputManager.applyTouchTap(point.x, point.y);
                    }
                }
            }
            this.spaceDown = false;
            return true;
        }
        if (ARROW_KEYS.includes(event.code) && (this.cursorMode === "menu" || this.inputMode === "inventory" || this.inputMode === "interface")) {
            this.client.inputManager.keys.delete(event.code);
            return true;
        }
        if (MOVEMENT_KEYS.includes(event.code)) {
            this.client.inputManager.keys.delete(event.code);
            if (!MOVEMENT_KEYS.some((key) => this.client.inputManager.isKeyDown(key))) this.stopWalking();
        }
        return this.enabled && (event.code === "AltLeft" || event.code === "AltRight");
    }

    onMouseDown(event: MouseEvent): void {
        if (!this.enabled || (event.button !== 0 && event.button !== 2)) return;
        this.spaceHandled = true;
        if (event.button === 0 && this.cursorMode === "none") {
            this.clearMovement();
            this.client.stopKeyboardMovement?.(true);
        }
        this.useMouseMenuPointer();
        if (event.button === 2 && this.cursorMode === "none") {
            this.beginWorldMenu();
            return;
        }
        if (this.cursorMode !== "menu" || !this.isMenuOpen()) return;
        if (event.button === 0) {
            // Leave the menu state intact until its existing click handler invokes or cancels it.
            this.setMenuClickPosition();
            this.resumeMouseLook();
        } else if (event.button === 2) {
            this.closeWorldMenu();
            this.client.inputManager.clickMode1 = 0;
            this.client.inputManager.clickMode2 = 0;
            if (this.cursorMode === "menu") this.resumeMouseLook();
        }
    }

    onMouseMove(event: MouseEvent): void {
        // Real mouse movement takes aiming back from the keyboard (see updateInteractionPointer).
        if (event.movementX || event.movementY) this.keyboardAiming = false;
        if (!this.enabled || this.cursorMode !== "menu") return;
        this.useMouseMenuPointer();
        const canvas = this.client.inputManager.element as HTMLCanvasElement | undefined;
        const width = canvas?.width ?? 0;
        const height = canvas?.height ?? 0;
        const captured = this.client.inputManager.isPointerLock();
        this.menuPointerX = Math.max(0, Math.min(width, captured ? this.menuPointerX + event.movementX : this.client.inputManager.mouseX));
        this.menuPointerY = Math.max(0, Math.min(height, captured ? this.menuPointerY + event.movementY : this.client.inputManager.mouseY));
        this.client.inputManager.mouseX = this.menuPointerX;
        this.client.inputManager.mouseY = this.menuPointerY;
    }

    handleCameraKeys({ camera, input, deltaTime }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        if (this.cursorMode === "menu" || !this.canUseWorldInput()) {
            this.syncPlayerFacing(camera);
            this.clearMovement();
            return true;
        }
        const deltaPitch = (PITCH_KEY_SPEED * deltaTime) / 1000;
        const deltaYaw = (YAW_KEY_SPEED * deltaTime) / 1000;
        // First-person arrows intentionally run opposite to the normal camera controls.
        if (input.isKeyDown("ArrowUp")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaPitch);
        if (input.isKeyDown("ArrowDown")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) + deltaPitch);
        if (input.isKeyDown("ArrowRight")) camera.updateYaw(camera.yaw, deltaYaw);
        if (input.isKeyDown("ArrowLeft")) camera.updateYaw(camera.yaw, -deltaYaw);
        this.syncPlayerFacing(camera);
        this.handleMovement(camera, input);
        return true;
    }

    handleCameraMouse({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        if (this.isMenuOpen()) {
            if (this.cursorMode === "none" || ((this.inputMode === "inventory" || this.inputMode === "interface") && this.cursorMode !== "menu")) this.enterMenuMode();
            if (this.awaitingMenuOpen && (this.inputMode === "inventory" || this.inputMode === "interface")) this.client.menuKeyboardIndex ??= 0;
            this.awaitingMenuOpen = false;
        } else if (
            this.cursorMode === "menu" &&
            (!this.awaitingMenuOpen || this.menuOpenChecked)
        ) {
            this.resumeMouseLook();
        }
        if (this.cursorMode !== "none" || !input.isPointerLock() || !this.canUseWorldInput()) return true;
        const deltaX = input.getDeltaMouseX();
        const deltaY = input.getDeltaMouseY();
        if (deltaX !== 0 || deltaY !== 0) {
            camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaY * LOOK_SENSITIVITY);
            camera.updateYaw(camera.yaw, -deltaX * LOOK_SENSITIVITY);
            this.syncPlayerFacing(camera);
            if (deltaX !== 0) this.handleMovement(camera, input);
        }
        return true;
    }

    handleCameraScroll({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled || input.wheelDeltaY === 0) return false;
        this.zoomScale = Math.max(0.5, Math.min(2, this.zoomScale - input.wheelDeltaY * 0.001));
        camera.setViewZoomScale(this.zoomScale * (1 - RUN_FOV_KICK * this.runBlend));
        return true;
    }

    updateInteractionPointer(camera: Camera): void {
        const input = this.client.inputManager;
        this.updateLoginSession();
        this.syncInterfaceSelection();
        this.syncDialogueOptions();
        this.syncInventorySelection();
        this.updateReticleVisibility();
        if (this.cursorMode === "menu" && this.client.menuKeyboardIndex !== undefined && !this.canInteract()) {
            this.unlockCursor();
        }
        if (this.spaceDown && !this.spaceHandled) {
            if (!this.canInteract()) this.spaceHandled = true;
            else if (Date.now() - this.spaceStartedAt >= SPACE_MENU_HOLD_MS) this.openSpaceMenu();
        }
        if (!this.client.isLoggedIn() || this.inputMode === "chat") {
            input.clearInteractionPointerOverride();
            return;
        }
        if (this.cursorMode === "menu" && this.isMenuOpen()) {
            input.clearInteractionPointerOverride();
            input.mouseX = this.menuPointerX;
            input.mouseY = this.menuPointerY;
            this.updateReticlePosition(input, this.menuPointerX, this.menuPointerY);
            return;
        }
        if (this.enabled && (this.inputMode === "inventory" || this.inputMode === "interface")) {
            const point = this.getActionPoint();
            if (point) {
                input.mouseX = point.x;
                input.mouseY = point.y;
                input.setInteractionPointerOverride(point.x, point.y, true);
            } else input.clearInteractionPointerOverride();
            if (this.cursorMode === "menu" && input.clickMode1 !== 2) this.menuOpenChecked = true;
            return;
        }
        const waitingForMenu = this.cursorMode === "menu" && !this.isMenuOpen();
        if (
            !this.enabled ||
            (!waitingForMenu && this.cursorMode !== "none") ||
            (this.cursorMode === "none" && !input.isPointerLock())
        ) {
            input.clearInteractionPointerOverride();
            if (this.enabled && this.cursorMode !== "menu" && !this.isMenuOpen()) {
                // The drawn crosshair always marks where it aims, free cursor or not.
                const { x, y } = crosshairPoint(camera);
                this.updateReticlePosition(input, x, y);
                // With a free cursor, steering with the keyboard aims with the crosshair: park the
                // mouse on it, so hover and the game's mouseover tooltip follow the crosshair (as
                // after a Space tap). No override: once the real mouse moves it takes over.
                if (this.keyboardAiming) {
                    input.mouseX = x;
                    input.mouseY = y;
                }
            }
            return;
        }
        const { x, y } = crosshairPoint(camera);
        input.mouseX = x;
        input.mouseY = y;
        input.setInteractionPointerOverride(x, y);
        if (waitingForMenu && input.clickMode1 !== 2) this.menuOpenChecked = true;
        this.updateReticlePosition(input, x, y);
    }

    handleCameraFollow({ camera, playerX, playerY, playerZ, plane = 0, groundHeightAt, collisionFlagAt }: CameraFollowContext): boolean {
        if (!this.enabled) return false;
        this.syncPlayerFacing(camera);
        const now = performance.now();
        const dt = Math.min(0.1, Math.max(0, (now - this.lastFollowAt) / 1000));
        this.lastFollowAt = now;
        const pe = this.client.playerEcs;
        const index = pe?.getIndexForServerId(this.client.controlledPlayerServerId ?? -1);
        const height = (index === undefined ? undefined : pe?.getDefaultHeightTiles(index)) ?? 200 / 128;
        // While the player faces something it interacts with (an opponent, an NPC it talks to), the
        // game turns the player rather than the camera; swing the camera round behind them.
        if (index !== undefined && pe?.getRotation && (pe.getInteractionIndex?.(index) ?? NO_INTERACTION) !== NO_INTERACTION) {
            const behind = (pe.getRotation(index) + 1024) & 2047;
            const delta = ((behind - camera.yaw + 3072) % 2048) - 1024;
            if (Math.abs(delta) > 0.5) camera.updateYaw(camera.yaw, delta * (1 - Math.exp(-dt * FACE_TARGET_RATE)));
        }
        // Orbit a pivot near the head: looking down raises the camera, looking up lowers it.
        const pitchUnits = Math.max(MIN_PITCH, Math.min(MAX_PITCH, camera.getViewPitchOverride() ?? DEFAULT_PITCH));
        if (pitchUnits !== camera.getViewPitchOverride()) camera.setViewPitchOverride(pitchUnits);
        const pitch = pitchUnits * RS_TO_RADIANS, yaw = camera.yaw * RS_TO_RADIANS;
        const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
        const reach = FOLLOW_DISTANCE * Math.cos(pitch);
        // Pull in in front of walls so the view never ends up inside them.
        const clear = collisionFlagAt ? this.clearReach(playerX, playerZ, -sinYaw, -cosYaw, reach, plane, collisionFlagAt) : reach;
        const distance = reach > 0.01 ? FOLLOW_DISTANCE * clear / reach : FOLLOW_DISTANCE;
        let x = playerX - sinYaw * distance * Math.cos(pitch);
        let z = playerZ - cosYaw * distance * Math.cos(pitch);
        let y = playerY === undefined ? undefined : playerY - height * PIVOT_HEIGHT - distance * Math.sin(pitch);
        const ground = y === undefined ? undefined : groundHeightAt?.(x, z);
        if (y !== undefined && ground !== undefined) y = Math.min(y, ground - GROUND_CLEARANCE);

        // Taking a hit jolts the view and flashes the screen edge; both settle within HIT_SECONDS.
        const hitAge = (now - this.hitAt) / 1000;
        const hit = this.hitAmount(now);
        if (hit > 0) {
            const jolt = Math.sin(hitAge * 55) * hit * 0.12;
            x += cosYaw * jolt;
            z -= sinYaw * jolt;
            if (y !== undefined) y += Math.sin(hitAge * 41 + 1) * hit * 0.08;
        }
        this.setHitVignette(hit);
        this.setPoisonVignette(this.poisonAmount(now));
        camera.snapToPosition(Math.round(x * 128) / 128, y, Math.round(z * 128) / 128);

        // Running widens the view; it eases out a little slower than it eases in.
        const running = index !== undefined && pe?.isMoving?.(index) === true && pe.isRunVisual?.(index) === true;
        this.runBlend += ((running ? 1 : 0) - this.runBlend) * (1 - Math.exp(-dt * (running ? 4 : 3)));
        const zoom = this.zoomScale * (1 - RUN_FOV_KICK * this.runBlend);
        if (Math.abs(zoom - camera.getViewZoomScale()) > 1e-4) camera.setViewZoomScale(zoom);
        return true;
    }

    /**
     * Controller play, on top of the keyboard controls (Dragonwilds-style layout): left stick moves
     * (click to run), right stick looks; A/X interact (Space), RT uses, hold LT for options; Y
     * inventory, B back, RB special attack, D-pad selects (arrows), bumpers switch panels.
     */
    handleGamepad({ gamepad, camera, input, deltaTime }: GamepadContext): boolean {
        const pressed = gamepad.buttons.map((button) => button.pressed);
        const previous = this.padButtons;
        this.padButtons = pressed;
        const tapped = (index: number) => pressed[index] === true && previous[index] !== true;
        const released = (index: number) => pressed[index] !== true && previous[index] === true;
        const [moveX, moveY, lookX, lookY] = [0, 1, 2, 3].map((index) => stickAxis(gamepad.axes[index] ?? 0));
        const active = pressed.some(Boolean) || moveX !== 0 || moveY !== 0 || lookX !== 0 || lookY !== 0;
        if (!this.enabled) {
            // A controller plays in Backquote's mode: its first input switches it on.
            if (!active || !this.client.isLoggedIn()) return false;
            this.setEnabled(true);
            if (!this.controllerHintShown) {
                this.client.addGameMessage(CONTROLLER_HINT);
                this.controllerHintShown = true;
            }
            return true;
        }
        if (active) this.keyboardAiming = true;

        // Squared response: fine aim near the centre, full speed at the edge.
        if (lookX || lookY) {
            const speed = (LOOK_STICK_SPEED * deltaTime) / 1000;
            camera.updateYaw(camera.yaw, lookX * Math.abs(lookX) * speed);
            camera.setViewPitchOverride((camera.getViewPitchOverride() ?? DEFAULT_PITCH) + lookY * Math.abs(lookY) * speed);
            this.syncPlayerFacing(camera);
        }
        const moving = moveX !== 0 || moveY !== 0;
        this.padStick = { forward: -moveY, right: moveX };
        if (moving || this.padMoving) this.handleMovement(camera, input);
        this.padMoving = moving;
        if (tapped(PAD.L3)) {
            const running = !this.client.runMode;
            this.restoreRunMode = running;
            this.client.setKeyboardRunMode?.(running);
        }

        if (tapped(PAD.A) || tapped(PAD.X) || tapped(PAD.RT)) this.pressKey("Space");
        if (tapped(PAD.LT)) {
            if (this.isMenuOpen() || this.cursorMode === "menu") this.controllerBack();
            else {
                // Holding LT is holding Space: the options menu opens without the hold delay.
                this.onKeyDown(keyEvent("Space"));
                if (this.spaceDown) this.spaceStartedAt = Date.now() - SPACE_MENU_HOLD_MS;
            }
        }
        if (released(PAD.LT) && this.spaceDown) this.onKeyUp(keyEvent("Space"));
        if (tapped(PAD.B)) this.controllerBack();
        if (tapped(PAD.Y) && this.canUseKeyboard()) {
            this.inputMode = this.inputMode === "inventory" ? "movement" : "inventory";
            this.applyInputFocus();
        }
        if (tapped(PAD.LB) || tapped(PAD.RB)) {
            const direction = tapped(PAD.RB) ? 1 : -1;
            if (this.inputMode === "inventory" || this.inputMode === "interface") this.switchInterfacePanel(direction);
            else if (direction > 0) this.useSpecialAttack();
        }
        const arrow = [...PAD_ARROWS.keys()].find((index) => pressed[index]);
        if (arrow !== undefined) {
            const now = performance.now();
            if (tapped(arrow) || now >= this.padRepeatAt) {
                this.pressKey(PAD_ARROWS.get(arrow)!);
                this.padRepeatAt = now + (tapped(arrow) ? DPAD_REPEAT_DELAY_MS : DPAD_REPEAT_MS);
            }
        }
        return true;
    }

    private pressKey(code: string): void {
        this.onKeyDown(keyEvent(code));
        this.onKeyUp(keyEvent(code));
    }

    /** B: close an open menu, else leave inventory/interface focus, else close the open interface. */
    private controllerBack(): void {
        if (this.cursorMode === "menu") {
            this.pressKey("Escape");
            return;
        }
        if (this.isMenuOpen()) {
            this.closeWorldMenu();
            return;
        }
        if (this.inputMode !== "movement") {
            this.inputMode = "movement";
            this.applyInputFocus();
            return;
        }
        this.client.closeModalInterface?.();
    }

    /** RB: the "Use Special Attack" option of the special attack orb (or combat tab bar), as a click sends. */
    private useSpecialAttack(): void {
        const manager = this.client.widgetManager;
        if (!manager?.getAllGroupRoots || !this.client.handleWidgetAction) return;
        const groups = new Set<number>([manager.rootInterface ?? -1]);
        for (const parent of manager.interfaceParents.values()) if (parent.group !== undefined) groups.add(parent.group);
        const stack: WidgetNode[] = [...groups].flatMap((group) => manager.getAllGroupRoots!(group) ?? []);
        const seen = new Set<number>();
        while (stack.length > 0) {
            const widget = stack.pop()!;
            if (!widget || seen.has(widget.uid)) continue;
            seen.add(widget.uid);
            const option = widget.actions?.find((action) => typeof action === "string" && /special attack/i.test(action));
            if (option) {
                this.client.handleWidgetAction({ widget, option, source: "primary" });
                return;
            }
            stack.push(...(widget.children ?? []).filter(Boolean) as WidgetNode[],
                ...(manager.getStaticChildrenByParentUid?.(widget.uid) ?? []));
        }
    }

    onHitsplat(event: HitsplatEventPayload): void {
        if (!this.enabled || event.targetType !== "player" || event.targetId !== this.client.controlledPlayerServerId) return;
        // Blocks and misses do nothing. Damage scales the jolt and redness (full at HIT_FULL_DAMAGE),
        // and a hit landing while the last one fades adds to what is left of it.
        if (!(event.damage > 0)) return;
        const now = performance.now();
        if (POISON_SPLATS.has(event.style ?? -1)) {
            this.poisonStrength = Math.min(1, 0.45 + 0.55 * Math.min(1, event.damage / 20));
            this.poisonAt = now;
            this.rumble(150, 0.15, 0.4);
            return;
        }
        this.hitStrength = Math.min(1, this.hitAmount(now) + 0.15 + 0.85 * Math.min(1, event.damage / HIT_FULL_DAMAGE));
        this.hitAt = now;
        // A controller rumbles with the same strength as the jolt and redness.
        this.rumble(120 + 200 * this.hitStrength, this.hitStrength, Math.min(1, this.hitStrength + 0.2));
    }

    private rumble(durationMs: number, strong: number, weak: number): void {
        const actuator = (this.client.inputManager.getGamepad?.() as { vibrationActuator?: any } | null)?.vibrationActuator;
        void actuator?.playEffect?.("dual-rumble", {
            duration: Math.round(durationMs),
            strongMagnitude: strong,
            weakMagnitude: weak,
        })?.catch?.(() => undefined);
    }

    /** The poison edge: POISON_PULSES pulses fading out over POISON_SECONDS, 0..1. */
    private poisonAmount(now: number): number {
        const age = (now - this.poisonAt) / 1000;
        if (!(age >= 0 && age < POISON_SECONDS)) return 0;
        const pulse = 0.5 + 0.5 * Math.cos(age / POISON_SECONDS * POISON_PULSES * 2 * Math.PI);
        return this.poisonStrength * (1 - age / POISON_SECONDS) * pulse;
    }

    /** What remains of the last hit's jolt and redness, 0..1. */
    private hitAmount(now: number): number {
        const age = (now - this.hitAt) / 1000;
        return age >= 0 && age < HIT_SECONDS ? this.hitStrength * (1 - age / HIT_SECONDS) ** 2 : 0;
    }

    /** How far (tiles) the camera can sit from the player along a direction before a wall or solid object. */
    private clearReach(x: number, z: number, dx: number, dz: number, reach: number, plane: number,
        flags: (plane: number, tileX: number, tileY: number) => number): number {
        let tileX = Math.floor(x), tileZ = Math.floor(z);
        const blocked = (fromX: number, fromZ: number, toX: number, toZ: number) =>
            (flags(plane, toX, toZ) & (ENTRY_WALLS.get(`${toX - fromX},${toZ - fromZ}`)! | CollisionFlag.OBJECT_PROJECTILE_BLOCKER)) !== 0;
        for (let travelled = 0.125; travelled <= reach + WALL_MARGIN; travelled += 0.125) {
            const nextX = Math.floor(x + dx * travelled), nextZ = Math.floor(z + dz * travelled);
            if (nextX === tileX && nextZ === tileZ) continue;
            // A diagonal step is blocked only when both ways round the corner are.
            const stop = nextX !== tileX && nextZ !== tileZ
                ? (blocked(tileX, tileZ, nextX, tileZ) || blocked(nextX, tileZ, nextX, nextZ)) &&
                    (blocked(tileX, tileZ, tileX, nextZ) || blocked(tileX, nextZ, nextX, nextZ))
                : blocked(tileX, tileZ, nextX, nextZ);
            if (stop) return Math.max(0, Math.min(reach, travelled - WALL_MARGIN));
            tileX = nextX;
            tileZ = nextZ;
        }
        return reach;
    }

    private setPoisonVignette(amount: number): void {
        const rounded = Math.round(amount * 100) / 100;
        if (rounded === this.poisonVignette) return;
        this.poisonVignette = rounded;
        (this.client.inputManager.element?.parentElement as HTMLElement | undefined)?.style
            .setProperty("--first-person-poison", String(rounded));
    }

    private setHitVignette(amount: number): void {
        const rounded = Math.round(amount * 100) / 100;
        if (rounded === this.hitVignette) return;
        this.hitVignette = rounded;
        (this.client.inputManager.element?.parentElement as HTMLElement | undefined)?.style
            .setProperty("--first-person-hit", String(rounded));
    }

    private canMove(): boolean {
        return this.canUseWorldInput() && this.cursorMode !== "menu" && !this.isMenuOpen();
    }

    private applyInputFocus(): void {
        this.spaceHandled = true;
        this.clearMovement();
        for (const key of ARROW_KEYS) this.client.inputManager.keys.delete(key);
        this.client.stopKeyboardMovement?.(true);
        this.closeWorldMenu();
        if (this.cursorMode === "menu") this.resumeMouseLook();
        if (this.inputMode === "inventory" && this.interfaceGroups.length === 0) this.client.switchToTab?.(3, true);
        this.syncInterfaceSelection(true);
        this.revealInterfaceSelection();
        this.syncDialogueOptions();
        this.syncInventorySelection();
        this.client.inputManager.clearInteractionPointerOverride();
        this.syncPlayerFacing(this.client.camera);
        this.updateReticleVisibility();
    }

    private switchInterfacePanel(direction: number): void {
        const panelX = (group: number): number => {
            const panel = this.interfacePanels.get(group);
            if (!panel) return NaN;
            const transform = getRootRenderTransform(panel.root);
            return (panel.x + panel.widget.width / 2) * transform.scaleX + transform.offsetX;
        };
        const currentX = panelX(this.interfaceGroup ?? -1);
        const next = this.interfaceGroups.filter((group) => (panelX(group) - currentX) * direction > 1)
            .sort((a, b) => Math.abs(panelX(a) - currentX) - Math.abs(panelX(b) - currentX))[0];
        if (next === undefined) return;
        this.interfaceGroup = next;
        this.inputMode = next === 149 ? "inventory" : "interface";
        this.applyInputFocus();
    }

    private syncInterfaceSelection(force = false): void {
        const manager = this.client.widgetManager;
        const previousGroups = this.interfaceGroups;
        const mounts = this.enabled && this.client.isLoggedIn()
            ? [...(manager?.interfaceParents.entries() ?? [])].filter(([uid, parent]) =>
                (parent.type === 0 || parent.type === 3) && parent.group !== undefined &&
                !manager?.isEffectivelyHidden?.(uid)) : [];
        const signature = mounts.map(([uid, parent]) => `${uid}:${parent.group}`).join(",");
        const changed = signature !== this.interfaceMounts;
        this.interfaceMounts = signature;
        if (mounts.length === 0) {
            this.interfaceGroups = [];
            this.interfaceWidgets.clear();
            this.interfacePanels.clear();
            this.selectInterfaceWidget(undefined);
            this.interfaceGroup = undefined;
            if (this.restoreInputMode !== undefined) {
                this.inputMode = this.restoreInputMode;
                this.restoreInputMode = undefined;
                this.spaceHandled = true;
                this.client.inputManager.clearInteractionPointerOverride();
            }
            return;
        }
        if (force || changed || Date.now() >= this.interfaceScanAt) {
            // ponytail: scan only open panels at 10 Hz; use widget change notifications if very large interfaces need more.
            this.interfaceScanAt = Date.now() + 100;
            const groups = mounts.map(([, parent]) => parent.group!);
            const inventoryMounted = [...(manager?.interfaceParents.entries() ?? [])].some(([uid, parent]) =>
                parent.group === 149 && !manager?.isEffectivelyHidden?.(uid));
            if (inventoryMounted && !groups.includes(149)) groups.push(149);
            const wanted = new Set(groups);
            // Chatbox modals are nested inside the chat overlay, rather than directly in the gameframe.
            const reachable = new Set(groups);
            for (let size = -1; size !== reachable.size;) {
                size = reachable.size;
                for (const [uid, mount] of manager?.interfaceParents ?? []) {
                    if (mount.group !== undefined && reachable.has(mount.group)) reachable.add(uid >>> 16);
                }
            }
            this.interfaceWidgets = new Map(groups.map((group) => [group, []]));
            this.interfacePanels.clear();
            const seen = new Set<WidgetNode>();
            const visit = (widget: WidgetNode, root: WidgetNode, ox: number, oy: number,
                parent?: KeyboardWidget, group?: number) => {
                if (seen.has(widget) || widget.hidden || widget.isHidden || manager?.isEffectivelyHidden?.(widget.uid)) return;
                seen.add(widget);
                manager?.ensureLayout?.(widget);
                const target: KeyboardWidget = { widget, root, x: ox + (widget.x ?? 0), y: oy + (widget.y ?? 0), parent };
                if (group !== undefined && !this.interfacePanels.has(group)) this.interfacePanels.set(group, target);
                if (group !== undefined && group !== 149 && widget.width > 0 && widget.height > 0) {
                    const handlers = widget.eventHandlers;
                    const click = handlers?.onClick || handlers?.onOp || handlers?.onHold || handlers?.onRelease ||
                        widget.onClick || widget.onOp || widget.onHold || widget.onRelease;
                    const entries = deriveMenuEntriesForWidget(widget, false,
                        (w) => manager?.getWidgetFlags?.(w) ?? w.flags ?? 0,
                        (uid) => manager?.getWidgetByUid?.(uid));
                    const choice = group === 219 && widget.type === 4 &&
                        (widget.childIndex ?? 0) > 0 && (widget.childIndex ?? 0) <= 5 && !!widget.text;
                    if (click || choice || entries.some((entry) => entry.option.toLowerCase() !== "cancel")) {
                        this.interfaceWidgets.get(group)?.push(target);
                    }
                }
                const container = widget.type === 0 || widget.type === 11;
                const cx = target.x - (container ? widget.scrollX ?? 0 : 0);
                const cy = target.y - (container ? widget.scrollY ?? 0 : 0);
                if (widget.type === 0 && (widget.childIndex ?? -1) < 0) {
                    for (const child of manager?.getStaticChildrenByParentUid?.(widget.uid) ?? []) visit(child, root, cx, cy, target, group);
                }
                for (const child of widget.children ?? []) if (child) visit(child, root, cx, cy, target, group);
                const mount = widget.type === 0 ? manager?.interfaceParents.get(widget.uid) : undefined;
                if (mount?.group !== undefined && (reachable.has(mount.group) || group !== undefined)) {
                    for (const child of manager?.getAllGroupRoots?.(mount.group) ?? []) {
                        visit(child, root, target.x, target.y, target, wanted.has(mount.group) ? mount.group : group);
                    }
                }
            };
            const roots = manager?.getAllGroupRoots?.(manager.rootInterface ?? -1) ?? [];
            for (const root of roots) visit(root, root, 0, 0);
            if (roots.length === 0) {
                for (const group of groups) for (const root of manager?.getAllGroupRoots?.(group) ?? []) visit(root, root, 0, 0, undefined, group);
            }
            this.interfaceGroups = groups.filter((group, index) => groups.indexOf(group) === index &&
                (group === 149 || (this.interfaceWidgets.get(group)?.length ?? 0) > 0 ||
                    (this.interfacePanels.has(group) && mounts.some(([, mount]) => mount.group === group && mount.type === 3))));
            // Leave native dialogue shortcuts in charge until the opening panel has its options.
            if (!this.interfaceGroups.some((group) => group !== 149)) this.interfaceGroups = [];
        }
        if (this.interfaceGroups.length > 0 && (changed || this.restoreInputMode === undefined)) {
            this.restoreInputMode ??= this.inputMode;
            this.interfaceGroup = this.interfaceGroups.find((group) => !previousGroups.includes(group)) ??
                (this.interfaceGroups.includes(this.interfaceGroup ?? -1) ? this.interfaceGroup : this.interfaceGroups[0]);
            this.inputMode = this.interfaceGroup === 149 ? "inventory" : "interface";
            this.spaceHandled = true;
            this.clearMovement();
        }
        if (!this.interfaceGroups.includes(this.interfaceGroup ?? -1)) {
            this.interfaceGroup = this.interfaceGroups[0];
            if (this.interfaceGroup !== undefined) this.inputMode = this.interfaceGroup === 149 ? "inventory" : "interface";
        }
        const targets = this.interfaceWidgets.get(this.interfaceGroup ?? -1) ?? [];
        const previous = this.interfaceSelections.get(this.interfaceGroup ?? -1);
        const selected = targets.find(({ widget }) => widget.uid === previous?.uid && widget.childIndex === previous.childIndex);
        const first = targets.find(({ widget }) => (widget.itemId ?? -1) >= 0) ?? targets.find(({ widget }) =>
            !deriveMenuEntriesForWidget(widget, false, (w) => manager?.getWidgetFlags?.(w) ?? w.flags ?? 0)
                .some((entry) => entry.option.toLowerCase() === "close")) ?? targets[0];
        const old = this.interfaceWidget?.widget;
        this.selectInterfaceWidget(this.canUseKeyboard() && this.inputMode === "interface" ? selected ?? first : undefined);
        if (this.interfaceWidget && old !== this.interfaceWidget.widget) this.revealInterfaceSelection();
    }

    private selectInterfaceWidget(target: KeyboardWidget | undefined): void {
        const old = this.interfaceWidget?.widget;
        this.interfaceWidget = target;
        if (old !== target?.widget) {
            if (old) {
                delete old.keyboardOutline;
                this.client.widgetManager?.invalidateWidgetRender?.(old, "interface-keyboard-selection");
            }
            if (target) {
                target.widget.keyboardOutline = true;
                this.client.widgetManager?.invalidateWidgetRender?.(target.widget, "interface-keyboard-selection");
            }
        }
        if (target && this.interfaceGroup !== undefined) {
            this.interfaceSelections.set(this.interfaceGroup, { uid: target.widget.uid, childIndex: target.widget.childIndex });
        }
    }

    private moveInterfaceSelection(code: string): void {
        const horizontal = code === "ArrowLeft" || code === "ArrowRight";
        const direction = code === "ArrowLeft" || code === "ArrowUp" ? -1 : 1;
        const current = this.interfaceWidget;
        if (!current) {
            if (horizontal) this.switchInterfacePanel(direction);
            return;
        }
        const centre = (target: KeyboardWidget) => ({ x: target.x + target.widget.width / 2, y: target.y + target.widget.height / 2 });
        const origin = centre(current);
        const distance = (target: KeyboardWidget) => {
            const point = centre(target);
            const dx = point.x - origin.x, dy = point.y - origin.y;
            const along = horizontal ? dx : dy, across = horizontal ? dy : dx;
            if (horizontal && (current.widget.itemId ?? -1) >= 0 &&
                ((target.widget.itemId ?? -1) < 0 || Math.abs(dy) >= (current.widget.height + target.widget.height) / 2)) return Infinity;
            return along * direction > 1 ? along * along + across * across * 4 : Infinity;
        };
        const next = (this.interfaceWidgets.get(this.interfaceGroup ?? -1) ?? [])
            .filter((target) => Number.isFinite(distance(target))).sort((a, b) => distance(a) - distance(b))[0];
        if (!next) {
            if (horizontal) this.switchInterfacePanel(direction);
            return;
        }
        this.selectInterfaceWidget(next);
        this.revealInterfaceSelection();
    }

    private revealInterfaceSelection(): void {
        const target = this.interfaceWidget;
        if (!target) return;
        let x = target.x, y = target.y;
        for (let parent = target.parent; parent; parent = parent.parent) {
            const widget = parent.widget;
            const dx = (widget.scrollWidth ?? 0) > widget.width
                ? Math.min(x - parent.x, Math.max(0, x + target.widget.width - parent.x - widget.width)) : 0;
            const dy = (widget.scrollHeight ?? 0) > widget.height
                ? Math.min(y - parent.y, Math.max(0, y + target.widget.height - parent.y - widget.height)) : 0;
            if (!dx && !dy) continue;
            const oldX = widget.scrollX ?? 0, oldY = widget.scrollY ?? 0;
            widget.scrollX = Math.max(0, Math.min(Math.max(0, (widget.scrollWidth ?? widget.width) - widget.width), oldX + dx));
            widget.scrollY = Math.max(0, Math.min(Math.max(0, (widget.scrollHeight ?? widget.height) - widget.height), oldY + dy));
            this.client.widgetManager?.invalidateScroll?.(widget);
            x -= widget.scrollX - oldX;
            y -= widget.scrollY - oldY;
        }
        this.syncInterfaceSelection(true);
    }

    private getInventorySlots(): WidgetNode[] {
        const manager = this.client.widgetManager;
        if (this.inputMode !== "inventory" || !this.canUseKeyboard()) return [];
        return (manager?.findWidget?.(149, 0)?.children ?? []).filter((child): child is WidgetNode =>
            !!child && child.type === 5 && (child.childIndex ?? -1) >= 0 && (child.childIndex ?? -1) < 28 &&
            (child.itemId ?? -1) >= 0 && !child.hidden && !child.isHidden && !manager?.isEffectivelyHidden?.(child.uid));
    }

    private syncInventorySelection(): void {
        const manager = this.client.widgetManager;
        const slots = this.getInventorySlots();
        const widget = slots.find((child) => child.childIndex === this.inventorySlot) ?? slots[0];
        if (widget) this.inventorySlot = widget.childIndex!;
        if (widget === this.inventoryWidget) return;
        if (this.inventoryWidget) {
            delete this.inventoryWidget.keyboardOutline;
            manager?.invalidateWidgetRender?.(this.inventoryWidget, "inventory-keyboard-selection");
        }
        this.inventoryWidget = widget;
        if (widget) {
            widget.keyboardOutline = true;
            manager?.invalidateWidgetRender?.(widget, "inventory-keyboard-selection");
        }
    }

    private getActionPoint(): { x: number; y: number } | undefined {
        if (this.inputMode === "interface") {
            this.syncInterfaceSelection();
            const target = this.interfaceWidget;
            if (!target || !this.canUseKeyboard()) return undefined;
            const transform = getRootRenderTransform(target.root);
            return { x: (target.x + target.widget.width / 2) * transform.scaleX + transform.offsetX,
                y: (target.y + target.widget.height / 2) * transform.scaleY + transform.offsetY };
        }
        if (this.inputMode === "inventory") {
            this.syncInventorySelection();
            const widget = this.inventoryWidget;
            return widget && (widget.itemId ?? -1) >= 0
                ? this.client.renderer?.widgetsOverlay?.getWidgetInputPoint(widget) : undefined;
        }
        return crosshairPoint(this.client.camera);
    }

    private getWidgetMenu() {
        const canvas = this.client.inputManager.element as
            | (HTMLCanvasElement & { __ui?: { menu?: { source?: string; open?: boolean; entries?: readonly unknown[] } } })
            | undefined;
        const menu = canvas?.__ui?.menu;
        return menu?.open && menu.source === "widgets" ? menu : undefined;
    }

    private isMenuOpen(): boolean {
        return this.client.menuOpen || !!this.getWidgetMenu();
    }

    private syncDialogueOptions(): void {
        const manager = this.client.widgetManager;
        const mounted = this.inputMode !== "inventory" &&
            (this.inputMode !== "interface" || this.interfaceGroup === 219) && this.canUseKeyboard() &&
            [...(manager?.interfaceParents.entries() ?? [])].some(([uid, parent]) =>
                parent.group === 219 && !manager?.isEffectivelyHidden?.(uid));
        // Cache script 58 creates the heading at child 0 and choices at children 1..5.
        const options = mounted ? (manager?.findWidget?.(219, 1)?.children ?? []).filter(
            (widget): widget is WidgetNode => !!widget && widget.type === 4 &&
                (widget.childIndex ?? -1) > 0 && (widget.childIndex ?? -1) <= 5 &&
                !widget.hidden && !widget.isHidden && !!widget.text,
        ) : [];
        if (options[0] !== this.dialogueOptions[0] || options.length !== this.dialogueOptions.length) {
            for (const widget of this.dialogueOptions) {
                delete widget.keyboardTextColor;
                manager?.invalidateWidgetRender?.(widget, "dialogue-keyboard-selection");
            }
            this.dialogueOptions = options;
            this.dialogueOptionIndex = 0;
            if (options[0]) this.selectInterfaceWidget(this.interfaceWidgets.get(219)?.find((target) => target.widget === options[0]));
        }
        for (let index = 0; index < this.dialogueOptions.length; index++) {
            const widget = this.dialogueOptions[index];
            const color = index === this.dialogueOptionIndex ? 0xffffff : 0;
            if (widget.keyboardTextColor === color) continue;
            widget.keyboardTextColor = color;
            manager?.invalidateWidgetRender?.(widget, "dialogue-keyboard-selection");
        }
    }

    private canUseWorldInput(): boolean {
        return this.canControlPlayer() && this.inputMode === "movement";
    }

    private canInteract(): boolean {
        return this.canUseKeyboard() && this.inputMode !== "chat" &&
            (this.canControlPlayer() || this.interfaceGroups.length > 0);
    }

    private canUseKeyboard(): boolean {
        const active = typeof document === "undefined" ? undefined : document.activeElement;
        return this.enabled && this.client.isLoggedIn() &&
            !active?.matches?.("input, textarea, select, [contenteditable='true']") &&
            !this.client.isWidgetTextInputActive?.() &&
            (this.client.cs2Vm?.inputDialogType ?? 0) <= 1;
    }

    private canControlPlayer(): boolean {
        return this.canUseKeyboard() &&
            ![...(this.client.widgetManager?.interfaceParents.entries() ?? [])]
                .some(([uid, parent]) => (parent.type === 0 || parent.type === 3) &&
                    !this.client.widgetManager?.isEffectivelyHidden?.(uid));
    }

    private syncPlayerFacing(camera: Camera): void {
        const pe = this.client.playerEcs;
        const index = this.canUseWorldInput() && this.cursorMode !== "menu" && !this.client.menuOpen
            ? pe?.getIndexForServerId(this.client.controlledPlayerServerId ?? -1) : undefined;
        if (this.facingPlayerIndex !== undefined && this.facingPlayerIndex !== index) {
            pe?.setRotationOverride(this.facingPlayerIndex, undefined);
        }
        this.facingPlayerIndex = index;
        // Actor yaw faces south at zero; camera yaw looks north at zero.
        if (index !== undefined) pe?.setRotationOverride(index, (camera.getYaw() + 1024) & 2047);
    }

    private clearMovement(): void {
        for (const key of MOVEMENT_KEYS) this.client.inputManager.keys.delete(key);
        this.stopWalking();
    }

    private stopWalking(): void {
        if (this.client.isLoggedIn()) {
            this.client.stopKeyboardMovement?.();
            if (this.restoreRunMode !== undefined) this.client.setKeyboardRunMode?.(this.restoreRunMode);
        }
        this.restoreRunMode = undefined;
    }

    onClientTick(): void {
        if (this.enabled) this.handleMovement(this.client.camera, this.client.inputManager);
    }

    private handleMovement(camera: Camera, input: InputManager): void {
        if (!this.canMove()) {
            this.clearMovement();
            return;
        }
        const forward = Number(input.isKeyDown("KeyW")) - Number(input.isKeyDown("KeyS")) + this.padStick.forward;
        const right = Number(input.isKeyDown("KeyD")) - Number(input.isKeyDown("KeyA")) + this.padStick.right;
        if (!forward && !right) {
            this.stopWalking();
            this.client.setKeyboardMovement?.(0, 0, false, (camera.getYaw() + 1024) & 2047);
            return;
        }
        const yaw = camera.yaw * RS_TO_RADIANS;
        const length = Math.hypot(forward, right);
        const dx = (Math.sin(yaw) * forward + Math.cos(yaw) * right) / length;
        const dy = (Math.cos(yaw) * forward - Math.sin(yaw) * right) / length;
        this.restoreRunMode ??= !!this.client.runMode;
        const running = this.restoreRunMode || input.isShiftDown();
        this.client.setKeyboardRunMode?.(running);
        this.client.setKeyboardMovement?.(dx, dy, running, (camera.getYaw() + 1024) & 2047);
    }

    shouldKeepWorldMenuOpen(): boolean {
        return this.enabled && this.client.menuOpen;
    }

    /** First person is on (Backquote), so it owns the camera. */
    isActive(): boolean {
        return this.enabled;
    }

    private setEnabled(enabled: boolean): void {
        this.spaceHandled = true;
        this.enabled = enabled;
        this.inputMode = "movement";
        this.restoreInputMode = undefined;
        this.interfaceMounts = "";
        this.syncInterfaceSelection(true);
        if (!enabled) this.client.stopKeyboardMovement?.(true);
        this.syncPlayerFacing(this.client.camera);
        this.cursorMode = enabled ? "alt" : "none";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        this.clearMovement();
        const { inputManager: input, camera } = this.client;
        input.enablePointerLock = false;
        input.releasePointerLock();
        input.clearInteractionPointerOverride();
        input.clearContextMenuAnchorOverride();
        this.closeWorldMenu();
        this.syncDialogueOptions();
        this.syncInventorySelection();
        this.updateReticleVisibility();
        this.keyboardAiming = false;
        this.zoomScale = 1;
        this.runBlend = 0;
        this.hitAt = -Infinity;
        this.setHitVignette(0);
        this.poisonAt = -Infinity;
        this.setPoisonVignette(0);
        if (enabled) {
            if (this.updateLoginSession() && !this.controlsHintShown) {
                this.client.addGameMessage(CONTROLS_HINT);
                this.controlsHintShown = true;
            }
            this.restoreRenderSelf = this.client.renderSelf;
            this.restoreArmsVisible = this.client.firstPersonArmsVisible;
            this.restoreFollowPlayerCamera = this.client.followPlayerCamera;
            this.client.renderSelf = true;
            this.client.firstPersonArmsVisible = false;
            this.client.followPlayerCamera = true;
            camera.setViewPitchOverride(DEFAULT_PITCH);
            return;
        }
        camera.setViewPitchOverride(undefined);
        camera.setViewZoomScale(1);
        if (this.restoreRenderSelf !== undefined) this.client.renderSelf = this.restoreRenderSelf;
        this.client.firstPersonArmsVisible = this.restoreArmsVisible;
        if (this.restoreFollowPlayerCamera !== undefined) this.client.followPlayerCamera = this.restoreFollowPlayerCamera;
        this.restoreRenderSelf = undefined;
        this.restoreArmsVisible = undefined;
        this.restoreFollowPlayerCamera = undefined;
    }

    private updateLoginSession(): boolean {
        const loggedIn = this.client.isLoggedIn();
        if (!loggedIn) {
            this.syncPlayerFacing(this.client.camera);
            this.controlsHintShown = false;
            this.clearMovement();
        }
        return loggedIn;
    }

    private unlockCursor(): void {
        this.spaceHandled = true;
        if (this.cursorMode === "menu") this.closeWorldMenu();
        this.cursorMode = "alt";
        this.client.inputManager.enablePointerLock = false;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.clearContextMenuAnchorOverride();
        this.client.inputManager.releasePointerLock();
    }

    private resumeMouseLook(): void {
        this.client.menuKeyboardIndex = undefined;
        this.client.menuKeyboardSelect = false;
        this.cursorMode = this.client.inputManager.enablePointerLock ? "none" : "alt";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.clearContextMenuAnchorOverride();
        if (this.client.inputManager.enablePointerLock) this.client.inputManager.requestPointerLock();
    }

    private closeWorldMenu(): void {
        if (this.client.menuKeyboardIndex !== undefined && this.client.inputManager.clickMode1 === 2) {
            this.client.inputManager.clickMode1 = 0;
            this.client.inputManager.clickMode2 = 0;
        }
        this.client.closeMenu();
        const canvas = this.client.inputManager.element as
            | (HTMLCanvasElement & { __ui?: { menu?: { source?: string; open?: boolean } } })
            | undefined;
        if (canvas?.__ui?.menu) {
            canvas.__ui.menu.open = false;
            canvas.__ui.menu = undefined;
        }
    }

    private enterMenuMode(): void {
        this.cursorMode = "menu";
        this.client.stopKeyboardMovement?.(true);
        this.syncPlayerFacing(this.client.camera);
        const point = this.getActionPoint();
        this.menuPointerX = point?.x ?? this.client.inputManager.mouseX;
        this.menuPointerY = point?.y ?? this.client.inputManager.mouseY;
    }

    private beginWorldMenu(): void {
        this.clearMovement();
        this.awaitingMenuOpen = true;
        this.menuOpenChecked = false;
        this.enterMenuMode();
        this.client.inputManager.setContextMenuAnchorOverride(this.menuPointerX,
            this.menuPointerY - MENU_ANCHOR_Y_OFFSET);
    }

    private openSpaceMenu(): void {
        this.spaceHandled = true;
        const point = this.getActionPoint();
        if (!point) return;
        this.beginWorldMenu();
        if (this.inputMode === "inventory" || this.inputMode === "interface") {
            this.client.inputManager.setInteractionPointerOverride(point.x, point.y, true);
        }
        this.client.menuKeyboardIndex = 0;
        this.client.inputManager.applyTouchLongPress(this.menuPointerX, this.menuPointerY);
        this.client.inputManager.clickMode2 = 0;
    }

    private useMouseMenuPointer(): void {
        if (this.client.menuKeyboardIndex === undefined) return;
        this.menuPointerX = this.client.inputManager.mouseX;
        this.menuPointerY = this.client.inputManager.mouseY;
        this.client.menuKeyboardIndex = undefined;
        this.client.menuKeyboardSelect = false;
    }

    private setMenuClickPosition(): void {
        const input = this.client.inputManager;
        input.mouseX = this.menuPointerX;
        input.mouseY = this.menuPointerY;
        input.clickX = this.menuPointerX;
        input.clickY = this.menuPointerY;
    }

    private updateReticlePosition(input: InputManager, x: number, y: number): void {
        const canvas = input.element as HTMLCanvasElement | undefined;
        const host = canvas?.parentElement;
        if (host && canvas?.width && canvas.height) {
            host.style.setProperty("--first-person-reticle-x", `${(x / canvas.width) * 100}%`);
            host.style.setProperty("--first-person-reticle-y", `${(y / canvas.height) * 100}%`);
        }
    }

    private updateReticleVisibility(): void {
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-reticle",
            this.enabled && this.client.isLoggedIn() && this.inputMode === "movement" && this.interfaceGroups.length === 0,
        );
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-chatting",
            this.enabled && this.client.isLoggedIn() && this.inputMode === "chat",
        );
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-interface",
            this.enabled && this.client.isLoggedIn() && this.inputMode === "interface",
        );
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-inventory",
            this.enabled && this.client.isLoggedIn() && this.inputMode === "inventory",
        );
    }
}

/** Where the crosshair aims, in canvas pixels: the view centre raised by crosshairRaisePixels. */
export function crosshairPoint(camera: Camera): { x: number; y: number } {
    return {
        x: camera.viewportXOffset + camera.viewportWidth / 2,
        y: camera.viewportYOffset + camera.viewportHeight / 2 - crosshairRaisePixels(camera),
    };
}

/**
 * Pixels the crosshair sits above the view centre: a fixed angle, so it keeps aiming at the same
 * place whatever the window size, zoom or running FOV (Camera's fovY uses viewportZoom * zoom scale).
 */
export function crosshairRaisePixels(camera: Pick<Camera, "viewportZoom" | "getViewZoomScale">): number {
    return Math.tan(CROSSHAIR_RAISE_DEGREES * Math.PI / 180) * camera.viewportZoom * camera.getViewZoomScale();
}

/** A stick axis with its dead zone removed, rescaled to -1..1. */
function stickAxis(value: number): number {
    const magnitude = Math.abs(value);
    return magnitude < STICK_DEADZONE ? 0 : Math.sign(value) * Math.min(1, (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

/** The key event a controller button stands in for. */
function keyEvent(code: string): KeyboardEvent {
    return { code, key: code === "Space" ? " " : code, repeat: false, shiftKey: false, preventDefault() {} } as KeyboardEvent;
}
