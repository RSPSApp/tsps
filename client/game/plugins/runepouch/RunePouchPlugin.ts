/*
 * Ported from RuneLite's Rune Pouch plugin (RunepouchPlugin, RunepouchOverlay).
 * Copyright (c) 2017, Tyler <http://github.com/tylerthardy>
 * Copyright (c) 2022, Adam <Adam@sigterm.info>
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import { GameState } from "@runelite/api/GameState";
import { ConfigChanged } from "@runelite/api/events";
import { BANKMAIN, EQUIPMENT_SIDE, WORNITEMS } from "@runelite/api/gameval/InterfaceID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { type Tooltip, TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { FONT_PLAIN_11 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { TAGGED_INTERFACES } from "../inventorytags/inventoryTags";
import { RunePouchConfig, RunePouchOverlayMode } from "./RunePouchConfig";
import {
    RUNEPOUCH_RUNE, RUNE_POUCH_ITEMS, layoutPouch, pouchContents, tooltipText, type Box, type PouchRune,
} from "./runePouch";

/**
 * A pouch on screen: its item rect and the area its interface shows (a scrolled bank's view, say).
 * RuneLite draws past the item's own rect (the list starts a pixel above and left of it, and the
 * counts run past its right edge), so only the interface's area limits what is drawn.
 */
type PouchItem = Box & { clip: Box };

/**
 * The inventory and the inventory-like side panels (bank side, deposit box, shop, trade and
 * so on, as RuneLite's showOnInventory), and the bank's own grid (showOnBank). Worn equipment
 * never holds a pouch.
 */
const GROUPS = [...TAGGED_INTERFACES].filter((group) => group !== WORNITEMS && group !== EQUIPMENT_SIDE).concat(BANKMAIN);
const RED: [number, number, number, number] = [1, 0, 0, 1];
const GREEN: [number, number, number, number] = [0, 1, 0, 1];
const ITEM_WIDTH = 36;
const TEXTURE_PREFIX = "runepouch:rune:";

/** RuneLite's Rune Pouch: the pouch's runes and their counts on the pouch, and in a tooltip on hover. */
export class RunePouchPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Rune Pouch",
        description: "Show the contents of your rune pouch",
        tags: ["combat", "magic", "overlay"],
        enabledByDefault: true,
        configKey: "runepouchplugin",
    };

    static config = RunePouchConfig;

    private readonly config = inject(ConfigManager).getConfig(RunePouchConfig);
    private readonly tooltips: TooltipManager;
    private readonly client: OsrsClient;
    private readonly textureKeys = new Set<string>();
    private textureRenderer?: WidgetOverlayDrawContext["renderer"];
    /** The overlay's pixels per input pixel, from the last draw (the pointer is in input pixels). */
    private inputScale = { x: 1, y: 1 };

    readonly widgetOverlay: WidgetOverlay = {
        drawBeforeMenu: true,
        signature: () => {
            if (this.mode() === RunePouchOverlayMode.MOUSE_HOVER) return "";
            // An empty pouch draws nothing, so its position (which a scrolled bank changes) mustn't redraw.
            const runes = this.runes();
            if (runes.length === 0) return "";
            const pouches = this.pouches();
            if (pouches.length === 0) return "";
            return JSON.stringify([runes, pouches, this.fontColor()]);
        },
        draw: (context) => this.draw(context),
    };

    private readonly tooltip = (): Tooltip | undefined => this.hoverTooltip();

    constructor(client?: OsrsClient, tooltips?: TooltipManager) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.tooltips = tooltips ?? inject(TooltipManager);
    }

    protected async startUp(): Promise<void> {
        this.tooltips.add(this.tooltip);
    }

    protected async shutDown(): Promise<void> {
        this.tooltips.remove(this.tooltip);
        this.releaseTextures();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === RunePouchConfig.group) this.releaseTextures();
    }

    // ------------------------------------------------------------------ state

    private mode(): RunePouchOverlayMode {
        const mode = this.config.runePouchOverlayMode();
        return Object.values(RunePouchOverlayMode).includes(mode) ? mode : RunePouchOverlayMode.BOTH;
    }

    private fontColor(): number {
        return (Number(this.config.fontColor()) >>> 0) & 0xffffff;
    }

    runes(): PouchRune[] {
        const vars: any = (this.client as any).varManager;
        return pouchContents((id) => Number(vars?.getVarbit?.(id) ?? 0));
    }

    /** The rune item a pouch rune type stands for (enum RUNEPOUCH_RUNE). */
    private runeItem(type: number): number | undefined {
        const client: any = this.client;
        const runes = client.loaderFactory?.getEnumTypeLoader?.()?.load?.(RUNEPOUCH_RUNE);
        const index = runes?.keys?.indexOf(type) ?? -1;
        const item = index >= 0 ? Number(runes.intValues[index]) : NaN;
        return Number.isInteger(item) && item >= 0 ? item : undefined;
    }

    private runeName(type: number): string | undefined {
        const item = this.runeItem(type);
        const name = item === undefined ? undefined : (this.client as any).objTypeLoader?.load?.(item)?.name;
        return typeof name === "string" && name ? name : undefined;
    }

    /** Every pouch shown in the inventory or bank, in device pixels. */
    pouches(): PouchItem[] {
        const client: any = this.client;
        const manager = client?.widgetManager;
        if (!this.isStarted() || !manager || client.gameState !== GameState.LOGGED_IN) return [];
        const pouches: PouchItem[] = [];
        const seen = new Set<any>();
        const visit = (widget: any, hidden: boolean, group: number): void => {
            if (!widget || seen.has(widget)) return;
            seen.add(widget);
            if (hidden || widget.hidden === true || widget.isHidden === true) return;
            const itemId = Number.isInteger(widget.itemId) ? widget.itemId : -1;
            if (RUNE_POUCH_ITEMS.has(itemId)) {
                const { _absX: x, _absY: y, _absWidth: w, _absHeight: h } = widget;
                if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
                    const clip = clipOf(manager, widget, group);
                    if (area(intersect({ x, y, w, h }, clip)) > 0) pouches.push({ x, y, w, h, clip });
                }
            }
            for (const child of widget.children ?? []) visit(child, false, group);
        };
        for (const group of GROUPS) {
            for (const widget of manager.getWidgetsForGroup?.(group) ?? []) {
                if (typeof widget?.uid === "number" && manager.isEffectivelyHidden?.(widget.uid)) continue;
                visit(widget, false, group);
            }
        }
        return pouches;
    }

    // ------------------------------------------------------------------ tooltip

    /** RuneLite adds the tooltip while the mouse is over a pouch, in Mouse hover and Both modes. */
    hoverTooltip(): Tooltip | undefined {
        if (this.mode() === RunePouchOverlayMode.INVENTORY) return undefined;
        const client: any = this.client;
        if (client.menuOpen) return undefined;
        const mx = Number(client.inputManager?.mouseX) * this.inputScale.x;
        const my = Number(client.inputManager?.mouseY) * this.inputScale.y;
        if (!Number.isFinite(mx) || !Number.isFinite(my)) return undefined;
        const hovered = this.pouches().some((pouch) => {
            const shown = intersect(pouch, pouch.clip);
            return mx >= shown.x && mx < shown.x + shown.w && my >= shown.y && my < shown.y + shown.h;
        });
        if (!hovered) return undefined;
        const runes = this.runes();
        return runes.length > 0 ? { text: tooltipText(runes, (type) => this.runeName(type)) } : undefined;
    }

    // ------------------------------------------------------------------ overlay

    private draw(context: WidgetOverlayDrawContext): Box[] {
        const scale = context.inputScale?.();
        if (scale && Number.isFinite(scale.x) && Number.isFinite(scale.y)) this.inputScale = { x: scale.x, y: scale.y };
        if (this.mode() === RunePouchOverlayMode.MOUSE_HOVER) return [];
        const runes = this.runes();
        const pouches = this.pouches();
        if (runes.length === 0 || pouches.length === 0) return [];
        const { renderer, fontLoader } = context;
        if (this.textureRenderer !== renderer) {
            this.textureKeys.clear();
            this.textureRenderer = renderer;
        }
        const layout = layoutPouch(runes);
        const font: any = fontLoader(FONT_PLAIN_11);
        const ascent = Number(font?.maxAscent || font?.ascent || 9);
        const color = this.fontColor();
        const rects: Box[] = [];
        for (const pouch of pouches) {
            const s = pouch.w / ITEM_WIDTH;
            // The GL renderer has no clip: icons and bars draw only their part inside the interface's
            // area (Item Rarity's texture-coordinate cut); a count a scrolled bank cuts shows only whole.
            const shown = (box: Box) => inside(box, pouch.clip);
            for (const icon of layout.icons) {
                const box = { x: pouch.x + icon.x * s, y: pouch.y + icon.y * s, w: icon.w * s, h: icon.h * s };
                if (area(intersect(box, pouch.clip)) <= 0) continue;
                const texture = this.runeTexture(context, icon.type);
                if (!texture) continue;
                const fit = Math.min(box.w / texture.w, box.h / texture.h);
                const image = { x: box.x + (box.w - texture.w * fit) / 2, y: box.y + (box.h - texture.h * fit) / 2, w: texture.w * fit, h: texture.h * fit };
                const visible = intersect(image, pouch.clip);
                if (area(visible) <= 0) continue;
                renderer.drawTexture(texture.tex, visible.x, visible.y, visible.w, visible.h,
                    visible.w / image.w, visible.h / image.h, 0, undefined, false, false, 1,
                    (visible.x - image.x) / image.w, (visible.y - image.y) / image.h);
            }
            for (const text of layout.texts) {
                const box = { x: pouch.x + text.x * s, y: pouch.y + (text.baseline - ascent) * s, w: (ITEM_WIDTH - text.x + 2) * s, h: (ascent + 4) * s };
                if (!shown(box)) continue;
                drawTextGL(renderer, fontLoader, text.text, box.x, box.y, box.w, box.h, FONT_PLAIN_11, color, 0, 0, true, 1, undefined, s, s);
            }
            for (const bar of layout.bars) {
                const box = { x: pouch.x + bar.x * s, y: pouch.y + bar.y * s, w: bar.w * s, h: bar.h * s };
                const visible = intersect(box, pouch.clip);
                if (area(visible) > 0) renderer.drawRect(visible.x, visible.y, visible.w, visible.h, bar.color === "red" ? RED : GREEN);
            }
            // What the pieces cover: the item and a couple of pixels around it, within its interface.
            const covered = intersect({ x: pouch.x - 2 * s, y: pouch.y - 2 * s, w: pouch.w + 4 * s, h: pouch.h + 4 * s }, pouch.clip);
            if (area(covered) > 0) rects.push(covered);
        }
        return rects;
    }

    /** A rune's inventory image, trimmed to its drawn pixels, as a texture. */
    private runeTexture(context: WidgetOverlayDrawContext, type: number): { tex: any; w: number; h: number } | undefined {
        const item = this.runeItem(type);
        if (item === undefined) return undefined;
        const { renderer } = context;
        const key = `${TEXTURE_PREFIX}${item}`;
        const cached: any = renderer.getTexture(key);
        const size = this.textureSizes.get(key);
        if (cached && size) return { tex: cached, ...size };
        const source = context.itemImage?.(item, 1, 1);
        if (!source || typeof document === "undefined") return undefined;
        const trimmed = trim(source);
        if (!trimmed) return undefined;
        this.textureKeys.add(key);
        this.textureSizes.set(key, { w: trimmed.width, h: trimmed.height });
        return { tex: renderer.createTextureFromCanvas(key, trimmed), w: trimmed.width, h: trimmed.height };
    }

    private readonly textureSizes = new Map<string, { w: number; h: number }>();

    private releaseTextures(): void {
        for (const key of this.textureKeys) this.textureRenderer?.deleteTexture(key);
        this.textureKeys.clear();
        this.textureSizes.clear();
    }
}

function intersect(a: Box, b: Box): Box {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

const area = (box: Box) => box.w * box.h;

function inside(box: Box, clip: Box): boolean {
    return box.x >= clip.x - 0.5 && box.y >= clip.y - 0.5 &&
        box.x + box.w <= clip.x + clip.w + 0.5 && box.y + box.h <= clip.y + clip.h + 0.5;
}

/** The image cropped to its non-transparent pixels. */
function trim(source: HTMLCanvasElement): HTMLCanvasElement | undefined {
    const { width, height } = source;
    const data = source.getContext("2d")?.getImageData(0, 0, width, height).data;
    if (!data) return undefined;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    }
    if (maxX < 0) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = maxX - minX + 1;
    canvas.height = maxY - minY + 1;
    canvas.getContext("2d")?.drawImage(source, minX, minY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/**
 * The area an item's interface shows it in: each ancestor's rect cut by the next, up through the
 * container its interface is mounted in (Item Rarity's clipping; a scrolled bank tab cuts items).
 * Unbounded when nothing clips it.
 */
export function clipOf(manager: any, widget: any, group: number): Box {
    const FAR = 1e9;
    let clip: Box = { x: -FAR, y: -FAR, w: 2 * FAR, h: 2 * FAR };
    const cut = (parent: any): boolean => {
        if (typeof parent.uid === "number" && manager.isEffectivelyHidden?.(parent.uid)) {
            clip = { x: 0, y: 0, w: 0, h: 0 };
            return false;
        }
        const { _absX: px, _absY: py, _absWidth: pw, _absHeight: ph } = parent;
        if ([px, py, pw, ph].every(Number.isFinite)) {
            const x0 = Math.max(clip.x, px), y0 = Math.max(clip.y, py);
            const right = Math.min(clip.x + clip.w, px + pw), bottom = Math.min(clip.y + clip.h, py + ph);
            clip = { x: x0, y: y0, w: Math.max(0, right - x0), h: Math.max(0, bottom - y0) };
        }
        return true;
    };
    if (widget._isDragActive) return clip;
    const ancestors = new Set<number>();
    for (let uid = widget.parentUid; typeof uid === "number" && uid !== -1 && !ancestors.has(uid);) {
        ancestors.add(uid);
        const parent = manager.getWidgetByUid?.(uid);
        if (!parent || !cut(parent)) break;
        uid = parent.parentUid;
    }
    for (let uid = manager.getInterfaceParentContainerUid?.(group); typeof uid === "number" && uid !== -1 && !ancestors.has(uid);) {
        ancestors.add(uid);
        const parent = manager.getWidgetByUid?.(uid);
        if (!parent || !cut(parent)) break;
        uid = parent.parentUid;
    }
    return clip;
}
