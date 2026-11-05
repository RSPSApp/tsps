import { OverlayPosition } from "./OverlayPosition";

/**
 * The geometry of RuneLite's SnapCorners, SnapCorner and OverlayManager origins. Everything here
 * is in device pixels on the UI canvas; saved offsets are in layout units, so they survive
 * resizing and stretched mode.
 *
 * Not ported: dragging the snap corners themselves, and widget origins (anchoring an overlay
 * to an interface).
 */

export type Rect = { x: number; y: number; w: number; h: number };

/** Where the HUD sits this frame. */
export type HudFrame = {
    canvas: { w: number; h: number };
    /** The HUD container (the game view). */
    hud: Rect;
    /** The chat container; its top drops to the chat bar when the chat area is hidden. */
    chat: Rect;
    /** Device pixels per layout unit. */
    scaleX: number;
    scaleY: number;
    /** Not the fixed-size layout. */
    resized: boolean;
    combatStatus?: { right: number; top: number; rowHeight: number; mobile: boolean; scaleX: number; scaleY: number };
};

export const OriginX = { LEFT: "LEFT", CENTER: "CENTER", RIGHT: "RIGHT" } as const;
export type OriginX = (typeof OriginX)[keyof typeof OriginX];
export const OriginY = { TOP: "TOP", CENTER: "CENTER", BOTTOM: "BOTTOM" } as const;
export type OriginY = (typeof OriginY)[keyof typeof OriginY];

const BORDER = 5;
const MOUSEOVERTEXT_OFFSET = 15;
/** Space between overlays stacked in one corner. */
export const PADDING = 2;
const SNAP_CORNER_SIZE = 80;
const SNAP_CORNER_PADDING = 10;

const ALIGNMENT_RIGHT = 0x1;
const ALIGNMENT_BOTTOM = 0x2;
const ALIGNMENT_CENTER_HORIZONTAL = 0x4;
const EXPAND_LEFT = 0x10;
const EXPAND_RIGHT = 0x20;
const EXPAND_UP = 0x40;
const EXPAND_DOWN = 0x80;

type CornerDef = {
    position: OverlayPosition;
    mode: number;
    /** The corner point, before stacking. */
    point(frame: HudFrame): [number, number];
};

const CORNERS: CornerDef[] = [
    {
        position: OverlayPosition.TOP_LEFT,
        mode: EXPAND_DOWN,
        point: ({ hud, scaleX, scaleY }) => [hud.x + BORDER * scaleX, hud.y + (BORDER + MOUSEOVERTEXT_OFFSET) * scaleY],
    },
    {
        position: OverlayPosition.TOP_CENTER,
        mode: ALIGNMENT_CENTER_HORIZONTAL | EXPAND_DOWN,
        point: ({ hud, scaleY }) => [hud.x + hud.w / 2, BORDER * scaleY],
    },
    {
        position: OverlayPosition.TOP_RIGHT,
        mode: ALIGNMENT_RIGHT | EXPAND_DOWN,
        point: ({ hud, scaleX, scaleY }) => [hud.x + hud.w - BORDER * scaleX, BORDER * scaleY],
    },
    {
        position: OverlayPosition.BOTTOM_LEFT,
        mode: ALIGNMENT_BOTTOM | EXPAND_RIGHT,
        point: ({ chat, scaleX, scaleY }) => [chat.x + BORDER * scaleX, chat.y - BORDER * scaleY],
    },
    {
        position: OverlayPosition.BOTTOM_RIGHT,
        mode: ALIGNMENT_RIGHT | ALIGNMENT_BOTTOM | EXPAND_LEFT,
        point: ({ hud, scaleX, scaleY }) => [hud.x + hud.w - BORDER * scaleX, hud.y + hud.h - BORDER * scaleY],
    },
    {
        position: OverlayPosition.ABOVE_CHATBOX_RIGHT,
        mode: ALIGNMENT_RIGHT | ALIGNMENT_BOTTOM | EXPAND_UP,
        point: ({ chat, scaleX, scaleY }) => [chat.x + chat.w - BORDER * scaleX, chat.y - BORDER * scaleY],
    },
    {
        position: OverlayPosition.CANVAS_TOP_RIGHT,
        mode: ALIGNMENT_RIGHT | EXPAND_DOWN,
        point: ({ canvas }) => [canvas.w, 0],
    },
    {
        position: OverlayPosition.BELOW_MINIMAP,
        mode: ALIGNMENT_RIGHT | EXPAND_DOWN,
        point: ({ combatStatus, hud, scaleX, scaleY }) =>
            [combatStatus?.right ?? hud.x + hud.w - BORDER * scaleX, combatStatus?.top ?? (BORDER + MOUSEOVERTEXT_OFFSET) * scaleY],
    },
];

/** One snap corner: where the next overlay in it draws, and the drop target it shows while dragging. */
export class SnapCorner {
    private px = 0;
    private py = 0;
    private sx = 0;
    private sy = 0;
    private lastsx = 0;
    private lastsy = 0;
    private cx = 0;
    private cy = 0;
    private minSize = { w: SNAP_CORNER_SIZE, h: SNAP_CORNER_SIZE, pw: SNAP_CORNER_PADDING, ph: SNAP_CORNER_PADDING };

    constructor(private readonly def: CornerDef) {}

    get position(): OverlayPosition {
        return this.def.position;
    }

    /** Starts a frame: back to the corner point, remembering how much was stacked last frame. */
    begin(frame: HudFrame): void {
        const [x, y] = this.def.point(frame);
        this.cx = this.px = x;
        this.cy = this.py = y;
        this.lastsx = this.sx;
        this.lastsy = this.sy;
        this.sx = this.sy = 0;
        this.minSize = {
            w: SNAP_CORNER_SIZE * frame.scaleX,
            h: SNAP_CORNER_SIZE * frame.scaleY,
            pw: SNAP_CORNER_PADDING * frame.scaleX,
            ph: SNAP_CORNER_PADDING * frame.scaleY,
        };
    }

    /** Where an overlay of this size draws next in this corner. */
    nextDrawPosition(w: number, h: number): [number, number] {
        const mode = this.def.mode;
        let x = this.px;
        let y = this.py;
        if (mode & ALIGNMENT_CENTER_HORIZONTAL) x -= w / 2;
        else if (mode & ALIGNMENT_RIGHT) x -= w;
        if (mode & ALIGNMENT_BOTTOM) y -= h;
        return [x, y];
    }

    /** Moves past an overlay drawn in this corner. */
    shift(bounds: Rect, padding: number): void {
        const expand = this.def.mode & 0xf0;
        if (expand === EXPAND_LEFT) this.px = Math.min(this.px, bounds.x - padding);
        else if (expand === EXPAND_RIGHT) this.px = Math.max(this.px, bounds.x + bounds.w + padding);
        else if (expand === EXPAND_UP) this.py = Math.min(this.py, bounds.y - padding);
        else if (expand === EXPAND_DOWN) this.py = Math.max(this.py, bounds.y + bounds.h + padding);

        if (expand === EXPAND_UP || expand === EXPAND_DOWN) {
            this.sx = Math.max(this.sx, bounds.w);
            this.sy += bounds.h + padding;
        } else {
            this.sx += bounds.w + padding;
            this.sy = Math.max(this.sy, bounds.h);
        }
    }

    /** The drop target: at least 80 square, grown to what was stacked in it last frame. */
    corner(): Rect {
        const mode = this.def.mode;
        const w = Math.max(this.lastsx, this.minSize.w) + this.minSize.pw;
        const h = Math.max(this.lastsy, this.minSize.h) + this.minSize.ph;
        let x = this.cx;
        let y = this.cy;
        if (mode & ALIGNMENT_CENTER_HORIZONTAL) x -= w / 2;
        else if (mode & ALIGNMENT_RIGHT) x -= w;
        if (mode & ALIGNMENT_BOTTOM) y -= h;
        return { x, y, w, h };
    }
}

export function createSnapCorners(): SnapCorner[] {
    return CORNERS.map((def) => new SnapCorner(def));
}

/** On the fixed layout the canvas and chat corners are the view's own. */
export function correctedPosition(position: OverlayPosition, resized: boolean): OverlayPosition {
    if (resized) return position;
    if (position === OverlayPosition.CANVAS_TOP_RIGHT) return OverlayPosition.TOP_RIGHT;
    if (position === OverlayPosition.ABOVE_CHATBOX_RIGHT) return OverlayPosition.BOTTOM_RIGHT;
    return position;
}

/** RuneLite's rough heuristic: the side of the canvas the overlay is nearest keeps its distance. */
export function computeOrigins(bounds: Rect, canvas: { w: number; h: number }): { originX: OriginX; originY: OriginY } {
    const midX = bounds.x + bounds.w / 2;
    const midY = bounds.y + bounds.h / 2;
    const originX = midX > canvas.w * 0.55 ? OriginX.RIGHT : midX >= canvas.w * 0.45 ? OriginX.CENTER : OriginX.LEFT;
    const originY = midY > canvas.h * 0.55 ? OriginY.BOTTOM : midY > canvas.h * 0.45 ? OriginY.CENTER : OriginY.TOP;
    return { originX, originY };
}

function originPoint(originX: OriginX, originY: OriginY, canvas: { w: number; h: number }): [number, number] {
    const ox = originX === OriginX.RIGHT ? canvas.w : originX === OriginX.CENTER ? canvas.w / 2 : 0;
    const oy = originY === OriginY.BOTTOM ? canvas.h : originY === OriginY.CENTER ? canvas.h / 2 : 0;
    return [ox, oy];
}

/** A device position as layout units from its origin. */
export function toOrigin(
    x: number, y: number, originX: OriginX, originY: OriginY, frame: HudFrame,
): { x: number; y: number } {
    const [ox, oy] = originPoint(originX, originY, frame.canvas);
    return { x: Math.round((x - ox) / frame.scaleX), y: Math.round((y - oy) / frame.scaleY) };
}

/** Layout units from an origin as a device position. */
export function fromOrigin(
    location: { x: number; y: number }, originX: OriginX, originY: OriginY, frame: HudFrame,
): [number, number] {
    const [ox, oy] = originPoint(originX, originY, frame.canvas);
    return [ox + location.x * frame.scaleX, oy + location.y * frame.scaleY];
}

/** Keeps an overlay on the canvas. */
export function clampToCanvas(x: number, y: number, w: number, h: number, canvas: { w: number; h: number }): [number, number] {
    return [
        Math.min(Math.max(x, 0), Math.max(0, canvas.w - w)),
        Math.min(Math.max(y, 0), Math.max(0, canvas.h - h)),
    ];
}

export function contains(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}
