import { BANKMAIN, INVENTORY } from "@runelite/api/gameval/InterfaceID";
import { runeliteImage } from "@runelite/client/ui/runeliteImages";
import { boldFont, overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import type { LocOutline, NpcOutline, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { tagSpriteRgba } from "../inventorytags/inventoryTags";
import { convexHull } from "../npcindicators/npcMatching";
import type { SceneGeometry, SceneLoc } from "../../scene/SceneGeometry";
import type { ChoiceRule, HelperNpc, HelperStep, HelperTarget, OverlayLine, ReadonlyClientSnapshot, WorldTile } from "./QuestHelperProtocol";

type Rgba = [number, number, number, number];
type Point = [number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** The parts of Quest Helper's settings the overlays read (QuestHelperConfig). */
export type OverlaySettings = {
    highlightStyleNpcs: string;
    highlightStyleObjects: string;
    highlightStyleGroundItems: string;
    highlightStyleInventoryItems: string;
    showSymbolOverlay: boolean;
    outlineThickness: number;
    targetOverlayColor: number;
    textHighlightColor: number;
    showTextHighlight: boolean;
    showOverlay: boolean;
};

/** What the overlays draw from: the active step, the latest snapshot and the live client. */
export type OverlaySource = {
    active(): boolean;
    step(): HelperStep | null | undefined;
    snapshot(): ReadonlyClientSnapshot | undefined;
    settings(): OverlaySettings;
    client(): any;
    overlayPanel(): readonly OverlayLine[] | undefined;
};

export const argbToRgba = (argb: number, alpha?: number): Rgba => [
    ((argb >>> 16) & 0xff) / 255,
    ((argb >>> 8) & 0xff) / 255,
    (argb & 0xff) / 255,
    alpha !== undefined ? alpha / 255 : (argb >>> 24 || 255) / 255,
];

const matches = (target: HelperTarget, id: number) => target.id === id || !!target.ids?.includes(id);

/** NPCs of the snapshot an npc target names (NpcStep.npcs). */
export function targetNpcs(step: HelperStep, snapshot: ReadonlyClientSnapshot): HelperNpc[] {
    const targets = step.targets.filter((t) => t.kind === "npc");
    return snapshot.npcs.filter((npc) => npc.plane === snapshot.plane && targets.some((t) => matches(t, npc.transformedId ?? npc.id)));
}

/** Scene locs an object target names (ObjectStep.objects). */
export function targetLocs(step: HelperStep, snapshot: ReadonlyClientSnapshot, geom: SceneGeometry | undefined): SceneLoc[] {
    if (!geom) return [];
    const out: SceneLoc[] = [];
    const targets = step.targets.filter((t) => t.kind === "object");
    for (const object of snapshot.objects) {
        if (object.plane !== snapshot.plane) continue;
        if (!targets.some((t) => matches(t, object.id) && (t.x === undefined || t.x === object.x) && (t.y === undefined || t.y === object.y))) continue;
        for (const loc of geom.locsAtTile(object.x, object.y, object.plane)) if (loc.id === object.id) out.push(loc);
    }
    return out;
}

/** Ground items an item target names (ItemStep / DetailedQuestStep.tileHighlights). */
export function targetGroundItems(step: HelperStep, snapshot: ReadonlyClientSnapshot): WorldTile[] {
    const targets = step.targets.filter((t) => t.kind === "item");
    return snapshot.groundItems.filter((item) => item.plane === snapshot.plane && targets.some((t) => matches(t, item.id)));
}

/** Plain tile targets: the defined point of a DetailedQuestStep and its marked tiles. */
export function targetTiles(step: HelperStep, snapshot: ReadonlyClientSnapshot): WorldTile[] {
    return step.targets.filter((t): t is HelperTarget & WorldTile => t.kind === "tile" && t.x !== undefined && t.y !== undefined && t.plane === snapshot.plane);
}

const outlineColour = (argb: number) => ({ color: argb & 0xffffff, alpha: (argb >>> 24 || 255) / 255 });

/** NpcStep.highlightNpc OUTLINE: the model outline pass. */
export function questNpcOutlines(source: OverlaySource): NpcOutline[] {
    const step = source.step(), snapshot = source.snapshot(), s = source.settings();
    if (!source.active() || !step || !snapshot || s.highlightStyleNpcs !== "OUTLINE") return [];
    return targetNpcs(step, snapshot).map((npc) => ({ ecsId: npc.ecsIndex, serverId: npc.index, width: Math.max(1, s.outlineThickness), ...outlineColour(s.targetOverlayColor) }));
}

/** ObjectStep OUTLINE: the model outline pass. */
export function questLocOutlines(source: OverlaySource): LocOutline[] {
    const step = source.step(), snapshot = source.snapshot(), s = source.settings();
    if (!source.active() || !step || !snapshot || s.highlightStyleObjects !== "OUTLINE") return [];
    return targetLocs(step, snapshot, source.client()?.sceneGeometry).map((loc) => ({ loc, width: Math.max(1, s.outlineThickness), ...outlineColour(s.targetOverlayColor) }));
}

type Shape = { points: Point[]; stroke: Rgba; fill: Rgba; width: number };
type Icon = { x: number; y: number };

const ICON_KEY = "questhelper:quest_icon";
const ICON_SIZE = 16;
let iconCanvas: HTMLCanvasElement | undefined;
let iconRequested = false;

/** The quest icon upstream draws on targets (QuestStep.getQuestImage), as a canvas once loaded. */
function questIcon(): HTMLCanvasElement | undefined {
    if (iconCanvas || iconRequested || typeof Image === "undefined" || typeof document === "undefined") return iconCanvas;
    iconRequested = true;
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        iconCanvas = canvas;
    };
    image.src = runeliteImage("quest_icon.png");
    return undefined;
}

export function iconTexture(renderer: any): any {
    const cached = renderer.getTexture?.(ICON_KEY);
    if (cached) return cached;
    const canvas = questIcon();
    return canvas ? renderer.createTextureFromCanvas(ICON_KEY, canvas) : undefined;
}

/**
 * QuestHelperWorldOverlay: hull, tile and clickbox highlights of the step's targets and the
 * quest icon over them (outlines go through the model outline pass). Drawn under widgets.
 */
export class QuestHelperSceneOverlay implements WidgetOverlay {
    readonly drawBelowWidgets = true;
    private frame?: { shapes: Shape[]; icons: Icon[] };

    constructor(private readonly source: OverlaySource) {}

    signature(): string {
        this.frame = this.build();
        if (!this.frame.shapes.length && !this.frame.icons.length) return "";
        return JSON.stringify([
            this.frame.shapes.map((s) => [s.points.map(([x, y]) => [Math.round(x), Math.round(y)]), s.stroke]),
            this.frame.icons.map((i) => [Math.round(i.x), Math.round(i.y), !!iconCanvas]),
        ]);
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const frame = this.frame ?? this.build();
        this.frame = undefined;
        const glr: any = context.renderer;
        const rects: Rect[] = [];
        for (const s of frame.shapes) {
            glr.drawPolygon?.(s.points, s.fill);
            glr.drawPolyline?.(s.points, s.width, s.stroke, true);
            const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
            rects.push({ x: Math.min(...xs) - s.width, y: Math.min(...ys) - s.width, w: Math.max(...xs) - Math.min(...xs) + 2 * s.width, h: Math.max(...ys) - Math.min(...ys) + 2 * s.width });
        }
        const icon = frame.icons.length ? iconTexture(glr) : undefined;
        if (icon) for (const i of frame.icons) {
            glr.drawTexture(icon, i.x - ICON_SIZE / 2, i.y - ICON_SIZE, ICON_SIZE, ICON_SIZE);
            rects.push({ x: i.x - ICON_SIZE / 2, y: i.y - ICON_SIZE, w: ICON_SIZE, h: ICON_SIZE });
        }
        return rects;
    }

    private build(): { shapes: Shape[]; icons: Icon[] } {
        const frame = { shapes: [] as Shape[], icons: [] as Icon[] };
        const step = this.source.step(), snapshot = this.source.snapshot();
        const client = this.source.client();
        const geom: SceneGeometry | undefined = client?.sceneGeometry;
        if (!this.source.active() || !step || !snapshot || !geom) return frame;
        const s = this.source.settings();
        const stroke = argbToRgba(s.targetOverlayColor);
        const fill = argbToRgba(s.targetOverlayColor, 20);
        const none: Rgba = [0, 0, 0, 0];
        const plane = snapshot.plane;
        const tile = (x: number, y: number, size = 1): Point[] | undefined => {
            const out: Point[] = [];
            for (const [cx, cy] of [[x, y], [x + size, y], [x + size, y + size], [x, y + size]]) {
                const p = geom.worldToScreen(cx, geom.tileHeight(cx, cy, plane), cy);
                if (!p) return undefined;
                out.push([p[0], p[1]]);
            }
            return out;
        };
        const push = (points: Point[] | undefined, shapeFill: Rgba, width = 2) => {
            if (points && points.length >= 3) frame.shapes.push({ points, stroke, fill: shapeFill, width });
        };
        const icon = (x: number, height: number, y: number) => {
            if (!s.showSymbolOverlay) return;
            const p = geom.worldToScreen(x, height, y);
            if (p) frame.icons.push({ x: p[0], y: p[1] });
        };
        const npcs = client.npcEcs;
        for (const npc of targetNpcs(step, snapshot)) {
            const live = npcs && typeof npcs.getWorldX === "function";
            const cx = live ? npcs.getWorldX(npc.ecsIndex) / 128 : npc.x + 0.5;
            const cy = live ? npcs.getWorldY(npc.ecsIndex) / 128 : npc.y + 0.5;
            const size = Math.max(1, (live ? npcs.getSize?.(npc.ecsIndex) : 1) | 0);
            if (s.highlightStyleNpcs === "CONVEX_HULL") {
                const points = geom.npcModelPoints(npc.ecsIndex, npc.index);
                const projected = (points ?? []).map(([x, h, y]) => geom.worldToScreen(x, h, y)).filter((p): p is readonly [number, number] => !!p).map((p) => [p[0], p[1]] as Point);
                if (projected.length >= 3) push(convexHull(projected), fill);
            } else if (s.highlightStyleNpcs === "TILE") push(tile(cx - size / 2, cy - size / 2, size), none);
            // NpcStep: the icon sits at half the NPC's height, or just above its tile.
            const ground = geom.tileHeight(cx, cy, plane);
            icon(cx, s.highlightStyleNpcs === "TILE" ? ground - 30 / 128 : ground - geom.npcHeight(npc.transformedId ?? npc.id) / 256, cy);
        }
        for (const loc of targetLocs(step, snapshot, geom)) {
            const parts = geom.locModelPoints(loc);
            const all = (parts ?? []).flat();
            if (s.highlightStyleObjects === "CLICK_BOX" && all.length) push(clickbox(geom, all), fill);
            const top = all.length ? Math.min(...all.map((p) => p[1])) : geom.tileHeight(loc.tileX + 0.5, loc.tileY + 0.5, plane);
            icon(loc.tileX + 0.5, top, loc.tileY + 0.5);
        }
        for (const item of targetGroundItems(step, snapshot)) {
            if (s.highlightStyleGroundItems !== "NONE") push(tile(item.x, item.y), fill);
            icon(item.x + 0.5, geom.tileHeight(item.x + 0.5, item.y + 0.5, plane), item.y + 0.5);
        }
        for (const point of targetTiles(step, snapshot)) icon(point.x + 0.5, geom.tileHeight(point.x + 0.5, point.y + 0.5, plane), point.y + 0.5);
        return frame;
    }
}

/** The hull of a model's bounding box, as RuneLite builds most clickboxes. */
function clickbox(geom: SceneGeometry, points: ReadonlyArray<readonly [number, number, number]>): Point[] | undefined {
    let x0 = Infinity, x1 = -Infinity, h0 = Infinity, h1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, h, y] of points) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        h0 = Math.min(h0, h); h1 = Math.max(h1, h);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const corners: Point[] = [];
    for (const x of [x0, x1]) for (const h of [h0, h1]) for (const y of [y0, y1]) {
        const p = geom.worldToScreen(x, h, y);
        if (p) corners.push([p[0], p[1]]);
    }
    if (corners.length < 3) return undefined;
    const hull = convexHull(corners);
    return hull.length >= 3 ? hull : undefined;
}

type ItemSlot = { itemId: number; quantity: number; x: number; y: number; w: number; h: number };

/** Visible item slots of one interface group, in device pixels. */
export function itemSlots(manager: WidgetManager | undefined, group: number): ItemSlot[] {
    if (!manager) return [];
    const out: ItemSlot[] = [];
    const seen = new Set<WidgetNode>();
    const visit = (widget: any, hidden: boolean) => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        if (hidden || widget.hidden === true || widget.isHidden === true) return;
        const { _absX: x, _absY: y, _absWidth: w, _absHeight: h } = widget;
        if (typeof widget.itemId === "number" && widget.itemId >= 0 && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0)
            out.push({ itemId: widget.itemId, quantity: (widget.itemQuantity ?? 1) | 0, x, y, w, h });
        for (const child of widget.children ?? []) visit(child, false);
    };
    for (const widget of manager.getWidgetsForGroup?.(group) ?? []) {
        if (typeof widget?.uid === "number" && manager.isEffectivelyHidden?.(widget.uid)) continue;
        visit(widget, false);
    }
    return out;
}

/** Item ids DetailedQuestStep.makeWidgetOverlayHint highlights in the inventory and in the bank. */
export function highlightedItems(step: HelperStep, snapshot: ReadonlyClientSnapshot | undefined): { inventory: Set<number>; bank: Set<number> } {
    const inventory = new Set(step.inventoryHighlights ?? []);
    // renderInventory(teleports, distanceLimit): teleports show only 100+ tiles from the step.
    const point = step.targets.find((t) => t.x !== undefined && t.y !== undefined);
    const player = snapshot?.localPlayer;
    const far = !point || !player || point.plane !== player.plane || Math.max(Math.abs(point.x! - player.x), Math.abs(point.y! - player.y)) > 100;
    if (point && far) for (const r of step.teleports ?? []) for (const id of r.ids ?? []) inventory.add(id);
    const bank = new Set<number>();
    for (const r of step.requirements) for (const id of r.ids ?? []) if (id > 0) bank.add(id);
    return { inventory, bank };
}

/**
 * QuestHelperWidgetOverlay's item part: QuestStep.highlightItem in the inventory and the bank,
 * in the inventory highlight style (square, outline, or filled outline).
 */
export class QuestHelperItemOverlay implements WidgetOverlay {
    private readonly textures = new Set<string>();
    private renderer?: any;

    constructor(private readonly source: OverlaySource) {}

    private slots(): ItemSlot[] {
        const step = this.source.step();
        const s = this.source.settings();
        if (!this.source.active() || !step || s.highlightStyleInventoryItems === "NONE") return [];
        const manager = this.source.client()?.widgetManager;
        const { inventory, bank } = highlightedItems(step, this.source.snapshot());
        return [
            ...itemSlots(manager, INVENTORY).filter((slot) => inventory.has(slot.itemId)),
            ...itemSlots(manager, BANKMAIN).filter((slot) => bank.has(slot.itemId)),
        ];
    }

    signature(): string {
        const slots = this.slots();
        return slots.length ? JSON.stringify([this.source.settings().highlightStyleInventoryItems, this.source.settings().targetOverlayColor, slots]) : "";
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const slots = this.slots();
        const glr: any = context.renderer;
        if (this.renderer !== glr) { this.textures.clear(); this.renderer = glr; }
        const s = this.source.settings();
        const color = s.targetOverlayColor;
        for (const slot of slots) {
            if (s.highlightStyleInventoryItems === "SQUARE") {
                glr.drawRect(slot.x, slot.y, slot.w, slot.h, argbToRgba(color, 65));
                glr.drawPolyline?.([[slot.x, slot.y], [slot.x + slot.w, slot.y], [slot.x + slot.w, slot.y + slot.h], [slot.x, slot.y + slot.h]], 1, argbToRgba(color), true);
                continue;
            }
            const outline = this.texture(context, slot, "outline", 255, color);
            if (outline) glr.drawTexture(outline, slot.x, slot.y, slot.w, slot.h);
            if (s.highlightStyleInventoryItems === "FILLED_OUTLINE") {
                const filled = this.texture(context, slot, "fill", 65, color);
                if (filled) glr.drawTexture(filled, slot.x, slot.y, slot.w, slot.h);
            }
        }
        return slots.map((slot) => ({ x: slot.x, y: slot.y, w: slot.w, h: slot.h }));
    }

    /** ItemManager.getItemOutline / ImageUtil.fillImage, as Inventory Tags builds them. */
    private texture(context: WidgetOverlayDrawContext, slot: ItemSlot, kind: "outline" | "fill", alpha: number, color: number): any {
        const glr: any = context.renderer;
        const key = `questhelper:${kind}:${slot.itemId}:${slot.quantity}:${color >>> 0}:${alpha}`;
        const cached = glr.getTexture(key);
        if (cached) return cached;
        const source = context.itemImage?.(slot.itemId, slot.quantity, kind === "outline" ? 1 : 0);
        const data = source?.getContext("2d")?.getImageData(0, 0, source.width, source.height).data;
        if (!source || !data || typeof document === "undefined") return undefined;
        const pixels = new Int32Array(source.width * source.height);
        for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4 + 3] !== 0 ? 1 : 0;
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return undefined;
        const image = ctx.createImageData(source.width, source.height);
        image.data.set(tagSpriteRgba(pixels, source.width, source.height, kind, color & 0xffffff, alpha));
        ctx.putImageData(image, 0, 0);
        if (this.textures.size > 256) { for (const k of this.textures) glr.deleteTexture(k); this.textures.clear(); }
        this.textures.add(key);
        return glr.createTextureFromCanvas(key, canvas);
    }
}

const PANEL_WIDTH = 129;
const PANEL_BORDER = 4;
const LINE_HEIGHT = 16;
const PANEL_BACKGROUND: Rgba = [70 / 255, 61 / 255, 50 / 255, 156 / 255];
const PANEL_OUTLINE: Rgba = [56 / 255, 48 / 255, 35 / 255, 1];
const clean = (text: string) => text.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "");
const hex = (value: string | undefined, fallback = 0xffffff) => (value ? parseInt(value.slice(1, 7), 16) : fallback);

/** Word-wraps text to a pixel width, as LineComponent does. */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of clean(text).split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next) > width) { lines.push(line); line = word; } else line = next;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
}

/**
 * QuestHelperOverlay: the current step's PanelComponent (quest name, step text, requirements,
 * recommended items and teleports with their pass/fail colours), as a movable overlay.
 */
export class QuestHelperPanelOverlay implements WidgetOverlay {
    readonly movable = { name: "QuestHelperOverlay", position: "TOP_LEFT" as any };

    constructor(private readonly source: OverlaySource) {}

    private lines(): readonly OverlayLine[] {
        if (!this.source.active() || !this.source.settings().showOverlay) return [];
        return this.source.overlayPanel() ?? [];
    }

    signature(): string {
        const lines = this.lines();
        return lines.length ? JSON.stringify(lines) : "";
    }

    draw(context: WidgetOverlayDrawContext): Rect[] {
        const lines = this.lines();
        if (!lines.length) return [];
        // A TOP_LEFT panel: the interface font, its titles bold. The panel keeps its width.
        const font = overlayFont("interface");
        const title = boldFont(font);
        const scale = font.scale;
        const plain = context.fontLoader(font.id);
        const measure = (s: string) => (plain ? plain.measure(s) : s.length * 6) * scale;
        const inner = PANEL_WIDTH - 2 * PANEL_BORDER;
        const rows: { text: string; color: number; align: number; font: number; right?: string; rightColor?: number }[] = [];
        for (const line of lines) {
            if (line.kind === "title") {
                for (const text of wrapText(line.text ?? "", inner, measure)) rows.push({ text, color: hex(line.color), align: 1, font: title.id });
                continue;
            }
            const right = line.right ? clean(line.right) : undefined;
            const room = right ? inner - measure(right) - 4 : inner;
            const wrapped = wrapText(line.left ?? "", Math.max(20, room), measure);
            wrapped.forEach((text, i) => rows.push({ text, color: hex(line.leftColor), align: 0, font: font.id, right: i === 0 ? right : undefined, rightColor: hex(line.rightColor) }));
        }
        const lineHeight = Math.max(1, Math.round(LINE_HEIGHT * scale));
        const height = 2 * PANEL_BORDER + rows.length * lineHeight;
        const at = context.place(this, PANEL_WIDTH, height);
        if (!at) return [];
        const { scaleX: sx, scaleY: sy } = at;
        const glr: any = context.renderer;
        const r = { x: at.x, y: at.y, w: PANEL_WIDTH * sx, h: height * sy };
        glr.drawRect(r.x, r.y, r.w, r.h, PANEL_BACKGROUND);
        glr.drawRect(r.x, r.y, r.w, sy, PANEL_OUTLINE);
        glr.drawRect(r.x, r.y + r.h - sy, r.w, sy, PANEL_OUTLINE);
        glr.drawRect(r.x, r.y + sy, sx, r.h - 2 * sy, PANEL_OUTLINE);
        glr.drawRect(r.x + r.w - sx, r.y + sy, sx, r.h - 2 * sy, PANEL_OUTLINE);
        let y = r.y + PANEL_BORDER * sy;
        const x = r.x + PANEL_BORDER * sx, w = inner * sx, h = lineHeight * sy;
        for (const row of rows) {
            drawTextGL(glr, context.fontLoader, row.text, x, y, w, h, row.font, row.color, row.align, 1, true, 1, undefined, sx * scale, sy * scale);
            if (row.right) drawTextGL(glr, context.fontLoader, row.right, x, y, w, h, font.id, row.rightColor ?? 0xffffff, 2, 1, true, 1, undefined, sx * scale, sy * scale);
            y += h;
        }
        return [r];
    }
}

/** A widget's runtime children (Widget.getChildren), by child index. */
function childrenOf(manager: WidgetManager, widget: WidgetNode): WidgetNode[] {
    const dynamic = manager.getDynamicChildrenByParent(widget);
    return dynamic.length ? dynamic : manager.getStaticChildrenByParentUid(widget.uid);
}

type Highlighted = { widget: WidgetNode; color: number };

/**
 * WidgetChoiceStep.highlightChoice and the *Change steps on the live widgets: the matching
 * option is numbered "[n] " and recoloured, and kept so when the mouse leaves it. Returns the
 * widgets now highlighted; text is only rewritten once per widget.
 */
export function applyChoiceRules(manager: WidgetManager | undefined, rules: readonly ChoiceRule[], color: number, mouse?: { x: number; y: number }): Highlighted[] {
    if (!manager || !rules.length) return [];
    const out: Highlighted[] = [];
    const rgb = color & 0xffffff;
    const highlight = (widget: WidgetNode, option: number, rule: ChoiceRule) => {
        const w: any = widget;
        const prefix = `[${option}] `;
        if (rule.replace !== undefined) {
            const text = rule.number && option >= 0 ? prefix + rule.replace : rule.replace;
            if (w.text !== text) { w.text = text; manager.invalidateWidgetRender(widget); }
            if (rule.whole) return;
        } else if (rule.number && option >= 0 && typeof w.text === "string" && !w.text.startsWith(prefix)) {
            w.text = prefix + w.text;
            manager.invalidateWidgetRender(widget);
        }
        const hovered = mouse && Number.isFinite(w._absX) && mouse.x >= w._absX && mouse.y >= w._absY && mouse.x < w._absX + w._absWidth && mouse.y < w._absY + w._absHeight;
        if (!hovered && w.color !== rgb) {
            w.textColor = rgb;
            w.color = rgb;
            manager.invalidateWidgetRender(widget);
        }
        out.push({ widget, color: rgb });
    };
    const unnumbered = (text: string | undefined) => (text ?? "").replace(/^\[\d+\] /, "");
    for (const rule of rules) {
        if (rule.excludes?.length && rule.excludeGroupId !== undefined && rule.excludeChildId !== undefined) {
            const exclusion = manager.findLoadedWidget(rule.excludeGroupId, rule.excludeChildId);
            if (exclusion && childrenOf(manager, exclusion).some((c) => rule.excludes!.some((e) => (c.text ?? "").includes(e)))) continue;
        }
        const parent = manager.findLoadedWidget(rule.groupId, rule.childId);
        if (!parent || manager.isEffectivelyHidden(parent.uid)) continue;
        if (rule.whole) { highlight(parent, -1, rule); continue; }
        const choices = childrenOf(manager, parent);
        const index = (c: WidgetNode, i: number) => ((c as any).childIndex ?? i) as number;
        const pattern = rule.pattern ? safeRegExp(rule.pattern) : undefined;
        const fits = (c: WidgetNode) => {
            const text = unnumbered(c.text);
            return (rule.text !== undefined && rule.text === text) || (!!pattern && pattern.test(text)) || (rule.text === undefined && !pattern);
        };
        if (rule.id !== undefined) {
            const choice = choices.find((c, i) => index(c, i) === rule.id);
            if (choice && fits(choice)) highlight(choice, rule.id, rule);
            continue;
        }
        const i = choices.findIndex((c) => (rule.text !== undefined && unnumbered(c.text) === rule.text) || (!!pattern && pattern.test(unnumbered(c.text))));
        if (i >= 0) highlight(choices[i], index(choices[i], i), rule);
    }
    return out;
}

function safeRegExp(source: string): RegExp | undefined {
    try {
        return new RegExp(source);
    } catch {
        return undefined;
    }
}
