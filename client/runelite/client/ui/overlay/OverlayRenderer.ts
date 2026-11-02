import { TOPLEVEL, TOPLEVEL_OSM, TOPLEVEL_OSRS_STRETCH, TOPLEVEL_PRE_EOC } from "@runelite/api/gameval/InterfaceID";
import type { OsrsClient } from "../../../../game/OsrsClient";
import { getMousePos } from "../../../../game/InputManager";
import type {
    ClientPlugin,
    OverlayPlacement,
    WidgetOverlay,
    WidgetOverlayDrawContext,
} from "../../../../game/plugins/ClientPluginManager";
import type { ConfigManager } from "../../config/ConfigManager";
import { MenuTargetType } from "../../../../rs/MenuEntry";
import type { SimpleMenuEntry } from "../../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../../ui/menu/menuTransforms";
import { OverlayPosition } from "./OverlayPosition";
import {
    type HudFrame,
    type OriginX,
    type OriginY,
    type Rect,
    PADDING,
    clampToCanvas,
    computeOrigins,
    contains,
    correctedPosition,
    createSnapCorners,
    fromOrigin,
    toOrigin,
} from "./SnapCorners";

/**
 * Port of RuneLite's OverlayRenderer overlay management: hold Alt and drag a movable overlay to
 * move it, drop it on a snap corner to lock it there, and Alt + right-click it to reset it.
 * Positions are saved like RuneLite's, under `<overlay>_preferredLocation` /
 * `_preferredPosition` in the `runelite` config group.
 *
 * Not ported: resizing, drag targets (dropping one overlay onto another) and a configurable
 * drag hotkey.
 */

type Rgba = [number, number, number, number];
const rgba = (r: number, g: number, b: number, a = 255): Rgba => [r / 255, g / 255, b / 255, a / 255];

const MOVING_OVERLAY_COLOR = rgba(255, 255, 0, 100);
const MOVING_OVERLAY_ACTIVE_COLOR = rgba(255, 255, 0, 200);
const SNAP_CORNER_COLOR = rgba(0, 255, 255, 50);
const SNAP_CORNER_ACTIVE_COLOR = rgba(0, 255, 0, 100);

const RUNELITE_CONFIG_GROUP = "runelite";
const PREFERRED_LOCATION = "_preferredLocation";
const PREFERRED_POSITION = "_preferredPosition";
const ORIGIN_X = "_originX";
const ORIGIN_Y = "_originY";

const uid = (group: number, child: number) => (group << 16) | child;

/** Per top level: the game view, RuneLite's HUD container and chat container. */
const LAYOUTS: Record<number, { viewport: number; hud: number; chat: number }> = {
    [TOPLEVEL]: { viewport: uid(TOPLEVEL, 26), hud: uid(TOPLEVEL, 33), chat: uid(TOPLEVEL, 11) },
    [TOPLEVEL_OSRS_STRETCH]: {
        viewport: uid(TOPLEVEL_OSRS_STRETCH, 91),
        hud: uid(TOPLEVEL_OSRS_STRETCH, 15),
        chat: uid(TOPLEVEL_OSRS_STRETCH, 96),
    },
    [TOPLEVEL_PRE_EOC]: {
        viewport: uid(TOPLEVEL_PRE_EOC, 88),
        hud: uid(TOPLEVEL_PRE_EOC, 15),
        chat: uid(TOPLEVEL_PRE_EOC, 93),
    },
    [TOPLEVEL_OSM]: {
        viewport: uid(TOPLEVEL_OSM, 1),
        hud: uid(TOPLEVEL_OSM, 26),
        chat: uid(TOPLEVEL_OSM, 49),
    },
};
/** chatbox:chatarea, hidden when the chat is collapsed. */
const CHATAREA = uid(162, 34);

type Saved = {
    position?: OverlayPosition;
    location?: { x: number; y: number };
    originX?: OriginX;
    originY?: OriginY;
};

type Placed = { overlay: WidgetOverlay; bounds: Rect };

type Drag = { overlay: WidgetOverlay; offsetX: number; offsetY: number; x: number; y: number; w: number; h: number };

export class OverlayRenderer implements ClientPlugin {
    private readonly corners = createSnapCorners();
    private readonly saved = new Map<string, Saved>();
    private frame?: HudFrame;
    /** This draw pass: placed overlays, in draw order. */
    private placed: Placed[] = [];
    private passStarted = false;
    /** The last finished pass, for hit tests. */
    private drawn: Placed[] = [];
    private managing = false;
    private drag?: Drag;
    private mouseX = -1;
    private mouseY = -1;
    private revision = 0;
    private removeInputFilter?: () => void;

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => {
            const drag = this.drag;
            const hover = drag ? this.cornerAt(this.mouseX, this.mouseY)?.position ?? "" : "";
            return `${this.managing ? 1 : 0},${this.revision},${drag ? `${drag.x},${drag.y},${hover}` : ""}`;
        },
        draw: (context) => this.draw(context),
    };

    constructor(
        private readonly client: OsrsClient,
        private readonly configManager: ConfigManager,
    ) {}

    start(): void {
        this.removeInputFilter = this.client.inputManager.addInputFilter(this.onInput);
        if (typeof window !== "undefined") window.addEventListener("blur", this.onBlur);
    }

    stop(): void {
        this.removeInputFilter?.();
        this.removeInputFilter = undefined;
        this.endDrag();
        if (typeof window !== "undefined") window.removeEventListener("blur", this.onBlur);
    }

    /** Where a movable overlay of this size (layout units) draws this frame. */
    placeOverlay(overlay: WidgetOverlay, width: number, height: number, canvas: { w: number; h: number }): OverlayPlacement | undefined {
        const movable = overlay.movable;
        if (!movable) return undefined;
        const frame = this.beginPass(canvas);
        if (!frame) return undefined;
        const w = width * frame.scaleX;
        const h = height * frame.scaleY;
        const saved = this.load(movable.name);

        let x: number;
        let y: number;
        let corner;
        if (this.drag?.overlay === overlay) {
            x = this.drag.x;
            y = this.drag.y;
        } else if (saved.location) {
            [x, y] = fromOrigin(saved.location, saved.originX ?? "LEFT", saved.originY ?? "TOP", frame);
        } else {
            const position = correctedPosition(saved.position ?? movable.position, frame.resized);
            corner = this.corners.find((c) => c.position === position);
            [x, y] = corner ? corner.nextDrawPosition(w, h) : [0, 0];
        }
        [x, y] = clampToCanvas(Math.round(x), Math.round(y), w, h, frame.canvas);

        const bounds = { x, y, w, h };
        corner?.shift(bounds, PADDING * frame.scaleY);
        this.placed.push({ overlay, bounds });
        return { x, y, scaleX: frame.scaleX, scaleY: frame.scaleY };
    }

    /** The first placement of a pass reads the HUD and restarts the snap corners. */
    private beginPass(canvas: { w: number; h: number }): HudFrame | undefined {
        if (!this.passStarted) {
            this.passStarted = true;
            this.placed = [];
            this.frame = this.readFrame(canvas);
            if (this.frame) for (const corner of this.corners) corner.begin(this.frame);
        }
        return this.frame;
    }

    private readFrame(canvas: { w: number; h: number }): HudFrame | undefined {
        const manager = this.client.widgetManager;
        if (!manager) return undefined;
        const layout = LAYOUTS[manager.rootInterface];
        if (!layout) return undefined;
        const viewport: any = manager.getWidgetByUid(layout.viewport);
        if (!viewport || manager.isEffectivelyHidden(layout.viewport) || !(viewport._absWidth > 0)) return undefined;
        const scaleX = viewport._absWidth / Math.max(1, viewport.width);
        const scaleY = viewport._absHeight / Math.max(1, viewport.height);
        const hud = rectOf(manager.getWidgetByUid(layout.hud)) ?? rectOf(viewport)!;
        const chat = rectOf(manager.getWidgetByUid(layout.chat)) ?? { x: hud.x, y: hud.y + hud.h, w: 0, h: 0 };
        const chatArea: any = manager.getWidgetByUid(CHATAREA);
        if (chatArea?.isHidden) chat.y += chatArea._absHeight ?? 0;
        return { canvas, hud, chat, scaleX, scaleY, resized: manager.rootInterface !== TOPLEVEL };
    }

    private draw(context: WidgetOverlayDrawContext): Rect[] {
        // Drawn after every other overlay: this pass is complete.
        this.drawn = this.passStarted ? this.placed : [];
        this.passStarted = false;
        if (!this.managing) return [];

        const glr = context.renderer;
        const covered: Rect[] = [];
        const frame = this.frame;
        if (this.drag && frame) {
            for (const corner of this.corners) {
                const r = corner.corner();
                glr.drawRect(r.x, r.y, r.w, r.h, contains(r, this.mouseX, this.mouseY) ? SNAP_CORNER_ACTIVE_COLOR : SNAP_CORNER_COLOR);
                covered.push(r);
            }
        }
        const sx = Math.max(1, Math.round(frame?.scaleX ?? 1));
        const sy = Math.max(1, Math.round(frame?.scaleY ?? 1));
        for (const { overlay, bounds: r } of this.drawn) {
            const color = this.drag?.overlay === overlay ? MOVING_OVERLAY_ACTIVE_COLOR : MOVING_OVERLAY_COLOR;
            glr.drawRect(r.x, r.y, r.w, sy, color);
            glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, color);
            glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, color);
            glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, color);
            covered.push(r);
        }
        return covered;
    }

    private readonly onInput = (type: string, event: MouseEvent | KeyboardEvent): boolean => {
        if (type === "keyPressed" || type === "keyReleased") {
            if ((event as KeyboardEvent).key === "Alt") this.setManaging(type === "keyPressed");
            return false;
        }
        if (type === "mouseWheelMoved") return false;
        const mouse = event as MouseEvent;
        this.trackMouse(mouse);
        // Alt can be let go outside the window; the mouse says whether it is still held.
        if (mouse.altKey !== this.managing) this.setManaging(mouse.altKey);

        if (this.drag) return true;
        if (type !== "mousePressed" || !this.managing) return false;
        const hit = this.overlayAt(this.mouseX, this.mouseY);
        if (!hit) return false;
        if (mouse.button === 2) {
            this.reset(hit.overlay);
            return true;
        }
        if (mouse.button !== 0) return false;
        this.startDrag(hit);
        return true;
    };

    private readonly onBlur = () => this.setManaging(false);

    private readonly onDragMove = (event: MouseEvent) => {
        const drag = this.drag;
        if (!drag) return;
        this.trackMouse(event);
        [drag.x, drag.y] = clampToCanvas(
            this.mouseX - drag.offsetX, this.mouseY - drag.offsetY, drag.w, drag.h,
            this.frame?.canvas ?? { w: Infinity, h: Infinity },
        );
    };

    private readonly onDragEnd = (event: MouseEvent) => {
        if (!this.drag) return;
        this.onDragMove(event);
        this.finishDrag();
    };

    private trackMouse(event: MouseEvent): void {
        const element = this.client.inputManager.element;
        if (!element) return;
        [this.mouseX, this.mouseY] = getMousePos(element, event);
    }

    private setManaging(managing: boolean): void {
        if (managing === this.managing) return;
        this.managing = managing;
        if (!managing && this.drag) this.finishDrag();
    }

    /**
     * RuneLite's overlay menu entries: right-clicking over a movable overlay that has some puts
     * them at the top of the menu (deprioritised, so a left click still reaches the scene).
     */
    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (context.surface !== "world" || !context.menu) return entries;
        const hit = this.overlayAt(this.mouseX, this.mouseY);
        const extra = hit?.overlay.menuEntries?.() ?? [];
        if (extra.length === 0) return entries;
        return [
            ...extra.map((e) => ({
                option: e.option,
                target: `<col=ff9040>${e.target}</col>`,
                targetType: MenuTargetType.NONE,
                deprioritized: true,
                onClick: () => e.onClick(),
            })),
            ...entries,
        ];
    }

    /** The smallest movable overlay under the mouse, as RuneLite picks it. */
    private overlayAt(x: number, y: number): Placed | undefined {
        let hit: Placed | undefined;
        for (const placed of this.drawn) {
            if (!contains(placed.bounds, x, y)) continue;
            if (!hit || placed.bounds.w * placed.bounds.h <= hit.bounds.w * hit.bounds.h) hit = placed;
        }
        return hit;
    }

    private cornerAt(x: number, y: number) {
        return this.corners.find((corner) => contains(corner.corner(), x, y));
    }

    private startDrag({ overlay, bounds }: Placed): void {
        this.drag = {
            overlay,
            offsetX: this.mouseX - bounds.x,
            offsetY: this.mouseY - bounds.y,
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
        };
        // Follow the mouse off the canvas too, as the game's own drags do.
        if (typeof window === "undefined") return;
        window.addEventListener("mousemove", this.onDragMove);
        window.addEventListener("mouseup", this.onDragEnd);
    }

    private endDrag(): Drag | undefined {
        const drag = this.drag;
        this.drag = undefined;
        if (typeof window !== "undefined") {
            window.removeEventListener("mousemove", this.onDragMove);
            window.removeEventListener("mouseup", this.onDragEnd);
        }
        return drag;
    }

    /** Dropped on a snap corner it locks there (its own default corner clears it); anywhere else it stays put. */
    private finishDrag(): void {
        const drag = this.endDrag();
        const frame = this.frame;
        const movable = drag?.overlay.movable;
        if (!drag || !frame || !movable) return;
        const corner = this.cornerAt(this.mouseX, this.mouseY);
        if (corner) {
            const isDefault = corner.position === correctedPosition(movable.position, frame.resized);
            this.save(movable.name, isDefault ? {} : { position: corner.position });
        } else {
            const bounds = { x: drag.x, y: drag.y, w: drag.w, h: drag.h };
            const { originX, originY } = computeOrigins(bounds, frame.canvas);
            this.save(movable.name, { location: toOrigin(drag.x, drag.y, originX, originY, frame), originX, originY });
        }
    }

    private reset(overlay: WidgetOverlay): void {
        if (overlay.movable) this.save(overlay.movable.name, {});
    }

    private load(name: string): Saved {
        let saved = this.saved.get(name);
        if (saved) return saved;
        const get = (key: string) => this.configManager.getConfiguration(RUNELITE_CONFIG_GROUP, name + key);
        saved = {};
        const position = get(PREFERRED_POSITION);
        if (position && position in OverlayPosition) saved.position = position as OverlayPosition;
        const location = get(PREFERRED_LOCATION)?.split(":").map(Number);
        if (location?.length === 2 && location.every(Number.isFinite)) {
            saved.location = { x: location[0], y: location[1] };
            saved.originX = (get(ORIGIN_X) as OriginX | undefined) ?? "LEFT";
            saved.originY = (get(ORIGIN_Y) as OriginY | undefined) ?? "TOP";
        }
        this.saved.set(name, saved);
        return saved;
    }

    private save(name: string, saved: Saved): void {
        this.saved.set(name, saved);
        const set = (key: string, value: string | undefined) => {
            if (value === undefined) this.configManager.unsetConfiguration(RUNELITE_CONFIG_GROUP, name + key);
            else this.configManager.setConfiguration(RUNELITE_CONFIG_GROUP, name + key, value);
        };
        set(PREFERRED_POSITION, saved.position);
        set(PREFERRED_LOCATION, saved.location && `${saved.location.x}:${saved.location.y}`);
        set(ORIGIN_X, saved.location && saved.originX);
        set(ORIGIN_Y, saved.location && saved.originY);
        this.revision++;
    }
}

function rectOf(widget: any): Rect | undefined {
    if (!widget || !(widget._absWidth > 0) || !(widget._absHeight > 0)) return undefined;
    return { x: widget._absX, y: widget._absY, w: widget._absWidth, h: widget._absHeight };
}
