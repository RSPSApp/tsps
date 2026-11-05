import type { OsrsClient } from "../../OsrsClient";
import { ConfigChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Camera } from "../../Camera";
import { ClientState } from "../../ClientState";
import { GameState } from "../../login/GameState";
import type { ContinuousMovementRefusal } from "../../movement/ContinuousMovement";
import type { SceneGeometry } from "../../scene/SceneGeometry";
import type { ClientPlugin, LocOutline, NpcOutline } from "../ClientPluginManager";
import type { InteractHighlightPluginConfig } from "../interacthighlight/InteractHighlightConfig";
import type { LocType } from "../../../rs/config/loctype/LocType";
import type { NpcType } from "../../../rs/config/npctype/NpcType";
import { baseNpcTypeId } from "../../../custom/npcs/NpcModelOverrideRegistry";
import { getNpcMenuOptions } from "../../menu/WorldMenuBuilder";
import { stripTags } from "../npcindicators/npcMatching";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { MOBILE_ROOT_INTERFACE } from "../../../rs/cs2/ClientType";
import { mobileHudScale } from "../../widgets/MobileHudLayout";
import { isMobilePortraitLayoutActive, PORTRAIT_COMPONENTS } from "../portraitmode/PortraitLayout";
import { menuAction } from "../../../ui/menu/MenuAction";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import { applyMenuTransform } from "../../../ui/menu/menuTransforms";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { createElement, lazy, type ReactNode } from "react";
import { PadMode, type PadModeValue, TouchControlsConfig } from "./TouchControlsConfig";
import { findBlockingTarget, isStillInReach, targetFor, type ObjOption, type TouchTarget, type TouchTargetWorld } from "./TouchTargets";
import type { ClientGroundItemStack } from "../../data/ground/GroundItemStore";

const TouchJoystick = lazy(() =>
    import("./TouchJoystick").then((m) => ({ default: m.TouchJoystick })),
);

/** The menu opcodes for a loc's or NPC's five cache options, as a click on them sends. */
const LOC_OPCODES = [MenuOpcode.GameObjectFirstOption, MenuOpcode.GameObjectSecondOption,
    MenuOpcode.GameObjectThirdOption, MenuOpcode.GameObjectFourthOption, MenuOpcode.GameObjectFifthOption];
const NPC_OPCODES = [MenuOpcode.NpcFirstOption, MenuOpcode.NpcSecondOption,
    MenuOpcode.NpcThirdOption, MenuOpcode.NpcFourthOption, MenuOpcode.NpcFifthOption];
/** 601:50, the mobile layout's tab stones, which the action button keeps clear of. */
const MOBILE_STONES = (MOBILE_ROOT_INTERFACE << 16) | 50;
/** A collision counts while it is this fresh, in ms. */
const REFUSAL_MS = 300;
/** How square-on the walk must hit the edge (cosine), so sliding along a fence targets nothing. */
const HEAD_ON = 0.8;
/** An NPC that wanders off the player's tile keeps the button this long, in ms. */
const NPC_LINGER_MS = 1500;

export type TouchAction = {
    kind: TouchTarget["kind"];
    /** In the world menu's order, the first being the tap; `id` is what interact() takes. */
    options: ReadonlyArray<{ option: string; target: string; id: number }>;
};

export type TouchControlsUiState = {
    scale: number;
    visible: boolean;
    /** The object the player walked into; its first option is the button. */
    action?: TouchAction;
    /** CSS px from the game's right edge to the tab stones' left edge (0 without them). */
    stonesInset: number;
    /** Portrait Mode layout: the stick is drawn smaller, above the minimap. */
    portrait: boolean;
    /** Portrait Mode layout: CSS px from the game's bottom edge to the top of the minimap. */
    hudInset: number;
};

/**
 * The slice of OsrsClient the touch controls need. Kept structural so the plugin stays
 * testable without a full client (same shape as FirstPersonPlugin's client type).
 */
export type TouchControlsClient = {
    camera: Camera;
    /** LOGGED_IN once the scene is up; isLoggedIn() is already true while it loads. */
    gameState: GameState;
    /** The run orb; the joystick walks or runs as it says. */
    runMode?: boolean;
    isLoggedIn(): boolean;
    isWidgetTextInputActive?(): boolean;
    cs2Vm?: { inputDialogType?: number };
    widgetManager?: {
        rootInterface?: number;
        canvasWidth?: number;
        interfaceParents: Map<number, { type: number }>;
        isEffectivelyHidden?(uid: number): boolean;
        getWidgetByUid?(uid: number): { x?: number; y?: number; parentUid?: number } | undefined;
    };
    renderer?: { canvas?: { width: number; height: number; clientWidth: number; clientHeight: number } };
    playerEcs?: { getIndexForServerId(serverId: number): number | undefined; getX(i: number): number; getY(i: number): number; getLevel(i: number): number };
    controlledPlayerServerId?: number;
    sceneGeometry?: Pick<SceneGeometry, "locsAtTile">;
    npcEcs?: {
        forEachActive(fn: (id: number) => void): void;
        getServerId(id: number): number; getNpcTypeId(id: number): number; getSize(id: number): number;
        getWorldX(id: number): number; getWorldY(id: number): number; getLevel(id: number): number;
    };
    npcTypeLoader?: { load(id: number): NpcType | undefined };
    locTypeLoader?: { load(id: number): LocType | undefined };
    varManager?: unknown;
    locOpFlagsAt?(x: number, y: number, locId: number): number | undefined;
    groundItems?: { getStacksAt(x: number, y: number, level: number): ClientGroundItemStack[]; getVersion(): number };
    objTypeLoader?: { load(id: number): { name: string; groundActions?: ReadonlyArray<string | null | undefined> } | undefined };
    takeGroundItem?(stack: ClientGroundItemStack): void;
    groundItemOption?(stack: ClientGroundItemStack, option: string, opNum: number): void;
    clientPlugins?: {
        interactHighlightConfig(): InteractHighlightPluginConfig | undefined;
        groundItemMenuName?(stack: ClientGroundItemStack, name: string): string;
        deprioritizeGroundItem?(stack: ClientGroundItemStack): boolean;
    };
    setKeyboardMovement?(dx: number, dy: number, running: boolean, rotation: number): void;
    stopKeyboardMovement?(deactivate?: boolean): void;
    getKeyboardMovementRefusal?(): ContinuousMovementRefusal | undefined;
    /** Sends a menu option as a click on it would; defaults to the client's menuAction. */
    menuAction?(arg0: number, arg1: number, opcode: number, identifier: number, option: string, target: string): void;
};

function detectTouchDevice(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    // ?touch=1 forces the joystick on for desktop testing; ?touch=0 hides it on a phone.
    if (params.get("touch") === "0") return false;
    if (params.get("touch") === "1") return true;
    return (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
}

/**
 * On-screen movement joystick and action button for phones and tablets.
 *
 * Movement itself already exists end to end: `ContinuousMovement` sends
 * MOVEMENT_INPUT (opcode 215) and the server's FreeMovement plugin walks the
 * player, so this plugin is only the touch control that feeds it. Walking into an
 * object with options (a tree, bank booth, door or the Wilderness ditch), or onto an
 * NPC's tile or a pile of ground items, puts its first option on the action button and
 * outlines it (not ground items) in Interact Highlight's hover colour.
 */
export class TouchControlsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Touch Controls",
        description: "On-screen joystick and action button for touch screens.",
        tags: ["input", "mobile"],
        configKey: "touchcontrolsplugin",
    };

    /** The settings group the Config UI renders for this plugin. */
    static config = TouchControlsConfig;

    private readonly client: TouchControlsClient;
    /** Optional: unavailable in standalone builds (tests), where config stays Default. */
    private readonly configManager?: ConfigManager;
    private readonly touchDevice = detectTouchDevice();
    private readonly listeners = new Set<() => void>();
    /** The held stick, camera-relative: forward is away from the camera. Undefined when released. */
    private stick?: { forward: number; right: number };
    /** The walk direction last sent, in world tiles (x east, y north). */
    private heading?: { dx: number; dy: number };
    /** After an action the held stick stays inert until the thumb lifts, or it would cancel the action. */
    private suspended = false;
    private focus?: TouchTarget;
    /** Held by the action button while pressed or listing, so the target can't change under the finger. */
    private pinned = false;
    private seenRefusal?: ContinuousMovementRefusal;
    /** The NPC sharing the player's tile, rescanned when the player's tile or the game tick changes. */
    private npcUnder?: Extract<TouchTarget, { kind: "npc" }>;
    private npcScanKey = "";
    /** The ground items on the player's tile, rescanned with the NPCs, and which stacks they were. */
    private itemsUnder?: Extract<TouchTarget, { kind: "obj" }>;
    private itemsKey = "";
    /** When the focused NPC stopped sharing the player's tile. */
    private npcLeftAt?: number;
    private gameTicks = 0;
    private padMode: PadModeValue = PadMode.DEFAULT;
    private uiState: TouchControlsUiState = { scale: 1, visible: false, stonesInset: 0, portrait: false, hudInset: 0 };
    private uiKey = "";

    constructor(client?: TouchControlsClient) {
        super();
        this.client = client ?? inject<TouchControlsClient>(CLIENT_TOKEN);
        try {
            this.configManager = inject(ConfigManager);
        } catch {
            // Built standalone (tests): the joystick follows device detection only.
        }
        this.readConfig();
    }

    /** Runtime change from the settings panel flips joystick visibility live. */
    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== TouchControlsConfig.group) return;
        this.readConfig();
        this.publish();
    }

    private readConfig(): void {
        this.padMode =
            this.configManager?.getConfig(TouchControlsConfig).padMode() ?? PadMode.DEFAULT;
    }

    renderHud(_osrsClient: OsrsClient): ReactNode {
        return createElement(TouchJoystick, { plugin: this });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getUiState(): TouchControlsUiState {
        return this.uiState;
    }

    /** Hold the stick at (forward, right); (0, 0) is centred and stands still. */
    steer(forward: number, right: number): void {
        if (this.suspended || !this.canMove()) return;
        this.stick = { forward, right };
        this.drive();
    }

    release(): void {
        this.suspended = false;
        if (!this.stick) return;
        this.stick = undefined;
        this.heading = undefined;
        this.stopWalking();
    }

    /** Keep the current target while the action button is pressed or its options are open. */
    pin(pinned: boolean): void {
        this.pinned = pinned;
    }

    /** Use one of the focused target's options (a TouchAction option's id), as clicking it would. */
    interact(id: number): void {
        const focus = this.focus;
        const option = focus?.options[id];
        if (!focus || !option || !this.canMove()) return;
        if (this.stick) {
            this.suspended = true;
            this.heading = undefined;
            this.stopWalking();
        }
        if (focus.kind === "obj") {
            // As the world menu's ground item entries send them.
            const { stack, option: name, actionIndex } = focus.options[id];
            if (name.toLowerCase() === "take") this.client.takeGroundItem?.(stack);
            else this.client.groundItemOption?.(stack, name, actionIndex + 1);
            return;
        }
        const { actionIndex } = option;
        // The destination tile and identifier a click on it would send: a loc by id, an NPC by index.
        const args = focus.kind === "loc"
            ? [focus.loc.tileX - ClientState.baseX, focus.loc.tileY - ClientState.baseY, LOC_OPCODES[actionIndex],
                focus.loc.id, option.option, focus.name] as const
            : [(this.playerTile()?.x ?? 0) - ClientState.baseX, (this.playerTile()?.y ?? 0) - ClientState.baseY,
                NPC_OPCODES[actionIndex], focus.serverId, option.option, focus.name] as const;
        if (this.client.menuAction) this.client.menuAction(...args);
        else {
            menuAction(args[0], args[1], args[2], args[3], -1, args[4], args[5], 0, 0);
            // No click happened on screen, so no click cross either.
            ClientState.mouseCrossState = 100;
        }
    }

    /** RuneLite's ClientTick: keep the walk honest as the camera turns or a menu opens. */
    onClientTick(): void {
        if (this.stick && !this.suspended) {
            if (!this.canMove()) this.release();
            else this.drive();
        }
        this.updateFocus();
        this.publish();
    }

    onGameTick(): void {
        this.gameTicks++;
    }

    /** The focused object, outlined like Interact Highlight's hover. */
    locOutlines(): LocOutline[] {
        const lit = this.highlighted();
        return lit?.focus.kind === "loc" ? [{ loc: lit.focus.loc, ...lit.style }] : [];
    }

    /** The focused NPC, outlined the same way. */
    npcOutlines(): NpcOutline[] {
        const lit = this.highlighted();
        return lit?.focus.kind === "npc" ? [{ ecsId: lit.focus.ecsId, serverId: lit.focus.serverId, ...lit.style }] : [];
    }

    /** The focus and Interact Highlight's hover style, while its button shows and hovers are drawn. */
    private highlighted(): { focus: TouchTarget; style: { color: number; alpha: number; width: number } } | undefined {
        const config = this.client.clientPlugins?.interactHighlightConfig();
        if (!this.focus || !this.uiState.action || !config?.enabled || !config.showHover) return undefined;
        return { focus: this.focus, style: { color: config.hoverColor, alpha: 0.45, width: 2 } };
    }

    /**
     * Switched off in the hub. Ticks stop with it, but the HUD and outline hooks keep being
     * called, so publish the hidden state now.
     */
    protected override async shutDown(): Promise<void> {
        this.release();
        this.focus = undefined;
        this.publish();
    }

    private stopWalking(): void {
        this.client.stopKeyboardMovement?.();
    }

    private drive(): void {
        const { forward, right } = this.stick!;
        if (!forward && !right) {
            this.heading = undefined;
            this.stopWalking();
            return;
        }
        // Camera-relative, like FirstPersonPlugin: forward walks away from the camera.
        const camera = this.client.camera;
        const yaw = camera.yaw * RS_TO_RADIANS;
        const dx = Math.sin(yaw) * forward + Math.cos(yaw) * right;
        const dy = Math.cos(yaw) * forward - Math.sin(yaw) * right;
        this.heading = { dx, dy };
        // Face the way we walk: camera forward (yaw + 1024) turned by the stick's angle.
        const turn = Math.round(Math.atan2(right, forward) / RS_TO_RADIANS);
        this.client.setKeyboardMovement?.(dx, dy, !!this.client.runMode, (camera.getYaw() + 1024 + turn) & 2047);
    }

    /**
     * Walking head-on into an object, or onto an NPC's tile, focuses it (the latest wins);
     * walking away, or it going, drops it.
     */
    private updateFocus(): void {
        const world = this.world();
        const player = this.playerTile();
        // While the scene loads, actors have no real positions yet: nothing to be at.
        if (!world || !player || this.client.gameState !== GameState.LOGGED_IN) {
            this.focus = undefined;
            this.npcUnder = undefined;
            this.itemsUnder = undefined;
            this.itemsKey = "";
            return;
        }
        // An NPC walking off (or a new collision) must not swap the button under a held finger.
        if (this.pinned && this.focus) return;
        const scanKey = `${player.x},${player.y},${player.plane},${this.gameTicks},${this.client.groundItems?.getVersion()}`;
        if (scanKey !== this.npcScanKey) {
            this.npcScanKey = scanKey;
            const npc = this.npcAt(player.x, player.y, player.plane);
            if (npc && npc.serverId !== this.npcUnder?.serverId) {
                this.focus = npc;
                this.npcLeftAt = undefined;
            }
            this.npcUnder = npc;
            // Stepping onto a pile, or something landing on it, focuses the pile.
            const items = this.itemsAt(player.x, player.y, player.plane);
            const itemsKey = items?.options.map((o) => o.stack.id).join() ?? "";
            if (items && itemsKey !== this.itemsKey) this.focus = items;
            this.itemsUnder = items;
            this.itemsKey = itemsKey;
        }
        const refusal = this.client.getKeyboardMovementRefusal?.();
        if (refusal && refusal !== this.seenRefusal && this.heading &&
            performance.now() - refusal.at < REFUSAL_MS) {
            this.seenRefusal = refusal;
            const ex = refusal.toX - refusal.fromX, ey = refusal.toY - refusal.fromY;
            const dot = (ex * this.heading.dx + ey * this.heading.dy) /
                (Math.hypot(ex, ey) * Math.hypot(this.heading.dx, this.heading.dy) || 1);
            const target = dot >= HEAD_ON ? findBlockingTarget(refusal, world) : undefined;
            if (target) this.focus = target;
        }
        if (this.focus?.kind === "npc") {
            if (this.npcUnder?.serverId === this.focus.serverId) {
                this.focus = this.npcUnder;
                this.npcLeftAt = undefined;
            } else {
                this.npcLeftAt ??= performance.now();
                if (performance.now() - this.npcLeftAt > NPC_LINGER_MS) this.focus = undefined;
            }
        } else if (this.focus?.kind === "obj") {
            this.focus = this.itemsUnder;
        } else if (this.focus) {
            const { loc } = this.focus;
            // Options follow the object's current form (an opened gate, a chopped tree).
            this.focus = isStillInReach(loc, world, player.x, player.y, player.plane) ? targetFor(loc, world) : undefined;
        }
    }

    /** An NPC with options covering this tile: one pass over the local NPCs. */
    private npcAt(x: number, y: number, plane: number): Extract<TouchTarget, { kind: "npc" }> | undefined {
        const npcs = this.client.npcEcs;
        const loader = this.client.npcTypeLoader;
        if (!npcs || !loader) return undefined;
        let found: Extract<TouchTarget, { kind: "npc" }> | undefined;
        npcs.forEachActive((ecsId) => {
            const serverId = npcs.getServerId(ecsId);
            if (found || serverId <= 0 || npcs.getLevel(ecsId) !== plane) return;
            if (npcs.getWorldX(ecsId) <= 0 || npcs.getWorldY(ecsId) <= 0) return; // not placed yet
            // The south-west tile from the centre, as NPC Indicators' world location.
            const size = Math.max(1, npcs.getSize(ecsId));
            const sx = Math.floor((npcs.getWorldX(ecsId) - size * 64) / 128);
            const sy = Math.floor((npcs.getWorldY(ecsId) - size * 64) / 128);
            if (x < sx || y < sy || x >= sx + size || y >= sy + size) return;
            const type = this.npcType(baseNpcTypeId(npcs.getNpcTypeId(ecsId)), loader);
            if (!type?.name || type.name === "null") return;
            const options = getNpcMenuOptions(type).map(({ option, actionIndex }) => ({ option, actionIndex }));
            if (options.length) found = { kind: "npc", ecsId, serverId, typeId: type.id, name: stripTags(type.name), options };
        });
        return found;
    }

    /**
     * The ground items on this tile with their options, in the world menu's order: the last
     * stack to land first, each with its ground actions and Take in place of a missing third.
     */
    private itemsAt(x: number, y: number, plane: number): Extract<TouchTarget, { kind: "obj" }> | undefined {
        const { groundItems, objTypeLoader: loader, clientPlugins: plugins } = this.client;
        if (!groundItems || !loader) return undefined;
        const options: ObjOption[] = [];
        for (const stack of groundItems.getStacksAt(x, y, plane).reverse()) {
            let type;
            try {
                type = loader.load(stack.itemId);
            } catch {
                continue;
            }
            if (!type?.name || type.name === "null") continue;
            const name = stripTags(plugins?.groundItemMenuName?.(stack, type.name) ?? type.name);
            const hidden = plugins?.deprioritizeGroundItem?.(stack) ?? false;
            for (let actionIndex = 0; actionIndex < 5; actionIndex++) {
                const option = type.groundActions?.[actionIndex] ?? (actionIndex === 2 ? "Take" : undefined);
                if (option) options.push({ option, actionIndex, stack, name, deprioritized: hidden && actionIndex === 2 });
            }
        }
        return options.length ? { kind: "obj", name: options[0].name, options } : undefined;
    }

    /** The NPC's current form (RuneLite's getTransformedComposition). */
    private npcType(id: number, loader: { load(id: number): NpcType | undefined }): NpcType | undefined {
        try {
            const base = loader.load(id);
            if (!base?.transforms) return base;
            return base.transform(this.client.varManager as never, loader as never) ?? undefined;
        } catch {
            return undefined;
        }
    }

    private world(): TouchTargetWorld | undefined {
        const { sceneGeometry: geometry, locTypeLoader: loader } = this.client;
        if (!geometry || !loader) return undefined;
        const load = (id: number) => {
            try {
                return loader.load(id);
            } catch {
                return undefined;
            }
        };
        return {
            locsAtTile: (x, y, plane) => geometry.locsAtTile(x, y, plane),
            size: (id) => {
                const type = load(id);
                return { sizeX: type?.sizeX ?? 1, sizeY: type?.sizeY ?? 1 };
            },
            current: (id) => {
                const type = load(id);
                if (!type?.transforms) return type;
                return type.transform(this.client.varManager as never, loader as never) ?? undefined;
            },
            opFlags: (x, y, id) => this.client.locOpFlagsAt?.(x, y, id),
        };
    }

    private playerTile(): { x: number; y: number; plane: number } | undefined {
        const players = this.client.playerEcs;
        const index = players?.getIndexForServerId(this.client.controlledPlayerServerId ?? -1);
        if (!players || index === undefined || players.getX(index) <= 0 || players.getY(index) <= 0) return undefined;
        return { x: players.getX(index) >> 7, y: players.getY(index) >> 7, plane: players.getLevel(index) | 0 };
    }

    /** A mobile gameframe widget's top-left corner in CSS px on the canvas, if it is shown. */
    private mobileWidgetCssPos(uid: number): { x: number; y: number } | undefined {
        const widgets = this.client.widgetManager;
        const canvas = this.client.renderer?.canvas;
        if (widgets?.rootInterface !== MOBILE_ROOT_INTERFACE || !canvas?.width || !canvas.height ||
            !canvas.clientWidth || !canvas.clientHeight || widgets.isEffectivelyHidden?.(uid)) return undefined;
        let widget = widgets.getWidgetByUid?.(uid);
        if (!widget) return undefined;
        // Add up layout x/y to the root, whose render transform maps it onto the canvas.
        let x = 0;
        let y = 0;
        let root = widget;
        for (let hops = 0; widget && hops < 50; hops++) {
            x += widget.x ?? 0;
            y += widget.y ?? 0;
            root = widget;
            widget = widget.parentUid === undefined || widget.parentUid === -1 ? undefined : widgets.getWidgetByUid?.(widget.parentUid);
        }
        const transform = root as {
            __widgetRenderScaleX?: number; __widgetRenderOffsetX?: number;
            __widgetRenderScaleY?: number; __widgetRenderOffsetY?: number;
        };
        const canvasX = x * (transform.__widgetRenderScaleX ?? 1) + (transform.__widgetRenderOffsetX ?? 0);
        const canvasY = y * (transform.__widgetRenderScaleY ?? 1) + (transform.__widgetRenderOffsetY ?? 0);
        return {
            x: canvasX * canvas.clientWidth / canvas.width,
            y: canvasY * canvas.clientHeight / canvas.height,
        };
    }

    /** CSS px from the right edge of the game to the left edge of the mobile tab stones. */
    private stonesInset(): number {
        // Portrait Mode puts the stones along the bottom instead (see hudInset).
        if (isMobilePortraitLayoutActive()) return 0;
        const pos = this.mobileWidgetCssPos(MOBILE_STONES);
        const width = this.client.renderer?.canvas?.clientWidth ?? 0;
        return pos ? Math.max(0, Math.round(width - pos.x)) : 0;
    }

    /** Portrait Mode layout: CSS px from the bottom of the game up to the top of the minimap. */
    private hudInset(): number {
        if (!isMobilePortraitLayoutActive()) return 0;
        const pos = this.mobileWidgetCssPos(PORTRAIT_COMPONENTS.mapContainer);
        const height = this.client.renderer?.canvas?.clientHeight ?? 0;
        return pos ? Math.max(0, Math.round(height - pos.y)) : 0;
    }

    /**
     * Movement input starts by closing interruptible interfaces server-side, so the
     * joystick must stay inert while a bank or dialogue is open (FirstPersonPlugin's guard).
     */
    private canMove(): boolean {
        if (!this.client.isLoggedIn()) return false;
        const active = typeof document === "undefined" ? undefined : document.activeElement;
        if (active?.matches?.("input, textarea, select, [contenteditable='true']")) return false;
        if (this.client.isWidgetTextInputActive?.()) return false;
        if ((this.client.cs2Vm?.inputDialogType ?? 0) > 1) return false;
        const parents = this.client.widgetManager?.interfaceParents;
        if (parents) {
            for (const [uid, parent] of parents) {
                if ((parent.type === 0 || parent.type === 3) &&
                    !this.client.widgetManager?.isEffectivelyHidden?.(uid)) return false;
            }
        }
        return true;
    }

    /**
     * The options in the order the world menu shows them, after the client plugins' menu
     * transforms (Menu Entry Swapper's left-click swaps and presets): the first is the tap.
     */
    private menuOrder(target: TouchTarget): TouchAction["options"] {
        // `identifier` carries each entry's place in target.options through the transforms.
        const entries = target.options.map((o, identifier): SimpleMenuEntry => {
            const entry = { option: o.option, target: target.name, actionIndex: o.actionIndex, identifier, onClick: () => {} };
            if (target.kind === "loc") return { ...entry, targetType: MenuTargetType.LOC, targetId: target.loc.id };
            if (target.kind === "npc") {
                return { ...entry, targetType: MenuTargetType.NPC, targetId: target.typeId, npcServerId: target.serverId };
            }
            const { stack, name, deprioritized } = target.options[identifier];
            return { ...entry, target: name, targetType: MenuTargetType.OBJ, targetId: stack.itemId, deprioritized };
        });
        const ordered = applyMenuTransform(entries, { surface: "world", menu: true })
            .filter((e) => typeof e.identifier === "number" && e.identifier in target.options);
        // Deprioritized entries sit below the rest, as in the menu.
        const ids = new Set([...ordered.filter((e) => !e.deprioritized), ...ordered.filter((e) => e.deprioritized)]
            .map((e) => e.identifier!));
        return [...ids].map((id) => ({ option: target.options[id].option, target: entries[id].target!, id }));
    }

    private publish(): void {
        // On/Off beat detection and the ?touch= query override; Default keeps both.
        const padOn =
            this.padMode === PadMode.ON ? true : this.padMode === PadMode.OFF ? false : this.touchDevice;
        // Portrait Mode centres banks and shops right above the minimap, where the stick sits. It
        // can't move then anyway, so it steps aside instead of covering their buttons.
        const portrait = isMobilePortraitLayoutActive();
        const visible = this.isEnabled() && padOn && this.client.isLoggedIn() &&
            (!portrait || this.canMove());
        const action = visible && this.focus && this.canMove()
            ? { kind: this.focus.kind, options: this.menuOrder(this.focus) } : undefined;
        const stonesInset = visible ? this.stonesInset() : 0;
        const hudInset = visible ? this.hudInset() : 0;
        const scale = mobileHudScale(this.client.widgetManager?.rootInterface,
            this.client.renderer?.canvas?.clientWidth ?? 0, this.client.widgetManager?.canvasWidth);
        const key = JSON.stringify([visible, action, stonesInset, portrait, hudInset, scale]);
        if (key === this.uiKey) return;
        this.uiKey = key;
        this.uiState = { visible, action, stonesInset, portrait, hudInset, scale };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.warn("[touch-controls] listener failed", err);
            }
        }
    }
}
