import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, GameFrameDrawContext, GameFrameProvider } from "../ClientPluginManager";
import type { GLRenderer } from "../../../widgets/gl/renderer";
import { GAMEFRAME_LAYOUT_DROPDOWN, GAMEFRAME_317_OPTION, VARP_GAMEFRAME_317 } from "../../../common/ui/gameframeLayout";

/**
 * Classic 317 chrome, drawn behind live OSRS widgets in fixed or resizable mode.
 */

// Hand-cut resizable sidebar sprite (public/gameframe317/sidebar_inv.png).
// panel* is where the fixed invback (553,205,190x261) sits inside the sprite, so
// that area can be mapped onto the OSRS sidebar content rect at draw time.
const SIDEBAR_SPRITE = { width: 237, height: 338, panelLeft: 22, panelTop: 39, panelW: 190, panelH: 261 };
// Chat section sprite (public/gameframe317/chat_section.png); back* is the
// parchment/text area inside it, anchored to the OSRS chat rect. This is a
// logical cutout grid - the sprite is stretched to the chat rect at draw time,
// so the PNG just needs enough resolution (currently a 2x/Retina export).
const CHAT_SPRITE = { width: 2169, height: 725, backLeft: 30, backTop: 28, backW: 2115, backH: 553 };
// Column boundaries fall in the gaps between the eight chat stones.
const CHAT_COLUMNS = [0, 64, 126, 188, 250, 312, 374, 435, 519];
// LostCity's 765x503 frame; the scene remains at (4,4), 512x334.
const FIXED_BACKGROUND: [string, number, number][] = [
    ["backtop1", 0, 0], ["backleft1", 0, 4], ["backleft2", 0, 357],
    ["backright1", 722, 4], ["backright2", 743, 205],
    ["backvmid1", 516, 4], ["backvmid2", 516, 205], ["backvmid3", 496, 357],
    ["backhmid2", 0, 338], ["backhmid1", 516, 160],
    ["backbase2", 496, 466], ["backbase1", 0, 453],
    ["invback", 553, 205], ["mapback", 550, 4],
];

const TOP_ICON_POS: [number, number][] = [
    [545, 173], [569, 171], [598, 171], [631, 172], [669, 173], [696, 171], [724, 173],
];
const BOTTOM_ICON_POS: [number, number][] = [
    [570, 468], [598, 469], [633, 470], [670, 468], [697, 468], [722, 468],
];
// [sprite, x, y, flipH, flipV]. Right of each row is h-flipped; bottom row is v-flipped.
const TOP_STONE: [string, number, number, boolean, boolean][] = [
    ["redstone1", 538, 170, false, false], ["redstone2", 570, 168, false, false], ["redstone2", 598, 168, false, false],
    ["redstone3", 626, 168, false, false], ["redstone2", 669, 168, true, false], ["redstone2", 697, 168, true, false],
    ["redstone1", 725, 169, true, false],
];
const BOTTOM_STONE: [string, number, number, boolean, boolean][] = [
    ["redstone1", 538, 466, false, true], ["redstone2", 570, 466, false, true], ["redstone2", 598, 466, false, true],
    ["redstone3", 626, 467, false, true], ["redstone2", 669, 466, true, true], ["redstone2", 697, 466, true, true],
    ["redstone1", 725, 466, true, true],
];

const ICON_SIZE = 30;
const CHAT_BACKING_COLOUR = 0xffffff;
/** The 317 parchment sits 4px higher than the stock chat display. */
const CHAT_CONTENT_Y = -4;
/** Fine-tuning for the OSRS icons (they don't quite match the 317 stone slots). */
/** The 317 bottom stones are ~34x36, so centre the OSRS icons in that box. */
const OSRS_SLOT_W = 34;
const OSRS_SLOT_H = 36;
const OSRS_ICON_TUNE: Record<string, { scale?: number; dx?: number; dy?: number }> = {
    osrs_clan: { scale: 0.85, dx: 3, dy: -4 },
    osrs_account: { scale: 0.75 },
    osrs_friends: { scale: 0.9, dx: -0.5, dy: -3 },
};
const ICON_COUNT = 13;
type Texture = ReturnType<GLRenderer["createTextureFromCanvas"]>;

export class GameFrame317Plugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Gameframe 317",
        description: "Classic 317 gameframe chrome.",
        tags: ["gameframe"],
        hidden: true,
        configKey: "gameframe317plugin",
    };

    public readonly gameFrame: GameFrameProvider;
    private get fixed(): boolean {
        return this.osrsClient.widgetManager?.rootInterface === 548;
    }
    private get enabled(): boolean {
        return (this.fixed || this.osrsClient.widgetManager?.rootInterface === 161) &&
            this.osrsClient.varManager?.getVarp(VARP_GAMEFRAME_317) === 1;
    }
    private ready = false;
    private renderScale = 0;
    private renderOffsetX = 0;
    private renderOffsetY = 0;
    private readonly canvases = new Map<string, HTMLCanvasElement>();
    private readonly textures = new Map<string, Texture>();
    private readonly iconTextures: Texture[] = [];
    private readonly osrsClient: OsrsClient;

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.gameFrame = {
            isGameFrameActive: () => this.enabled,
            hideStockChrome: () => true,
            widgetRules: () => [
                // Hide the OSRS chatbox background + tab stones (type 5); the
                // chat text/messages are type 4 and still render over our section.
                // Item icons are type 5 too (the chatbox item search), so keep those.
                // Only the white transparent-chat backing rects go (clientscript 923); the
                // input separator line and the dialog scroll-area frame are other colours.
                { group: 162, type: 3, colour: CHAT_BACKING_COLOUR, hide: true },
                { group: 162, type: 5, item: false, hide: true },
                { contentType: 1339, hide: this.fixed },
            ],
            // Resizable keeps the OSRS minimap frame; fixed draws the 317 mapback.
            keepChrome: () => [(161 << 16) | 32],
            drawGameFrame: (context) => this.fixed ? this.drawFixed(context) : this.drawResizable(context),
        };
        void this.loadAssets();
    }

    handleClientCommand(command: string): boolean {
        const name = command.trim().toLowerCase();
        if (name !== "317" && name !== "osrs") return false;
        this.osrsClient.handleWidgetAction({
            widget: this.osrsClient.widgetManager.getWidgetByUid(GAMEFRAME_LAYOUT_DROPDOWN),
            option: "Select",
            source: "primary",
            slot: name === "317" ? GAMEFRAME_317_OPTION + 1 : 3,
        });
        return true;
    }

    /** Align mounted widgets before layout; restore stock coordinates when disabled. */
    updateWidgetLayout(): void {
        const manager = this.osrsClient.widgetManager;
        // The chat display (messages + input + separator line) rides with 162:57 (chatbox:chatdisplay)
        // in both layouts; the 317 sprite anchors to the container, not this child.
        const display = manager.getWidgetByUid((162 << 16) | 57);
        const displayY = this.enabled ? CHAT_CONTENT_Y : 0;
        if (display && display.rawY !== displayY) {
            display.rawY = displayY;
            manager.invalidateWidget(display);
        }
        if (!this.fixed) return;
        for (const [child, property, stock, fixed] of [
            [17, "rawX", 547, 553],
            [9, "rawX", 516, 521],
        ] as const) {
            const widget = manager.getWidgetByUid((548 << 16) | child);
            const value = this.enabled ? fixed : stock;
            if (widget && widget[property] !== value) {
                widget[property] = value;
                manager.invalidateWidget(widget);
            }
        }
    }

    private async loadAssets(): Promise<void> {
        const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
        const names = [
            "sideicons", "redstone1", "redstone2", "redstone3",
            // OSRS bottom-row icons for the two slots the 317 set gets wrong
            // (account = tab 8, friends/ignore = tab 9).
            "osrs_account", "osrs_friends", "osrs_clan", "sidebar_inv", "chat_section",
            ...FIXED_BACKGROUND.map(([name]) => name), "compass",
        ];
        await Promise.all(names.map(async (name) => {
            try {
                this.canvases.set(name, await loadSprite(`${base}/gameframe317/${name}.png`));
            } catch (error) {
                console.warn(`[gameframe317] missing ${name}.png:`, (error as Error).message);
            }
        }));
        const mapback = this.canvases.get("mapback");
        if (mapback) {
            const mask = document.createElement("canvas");
            mask.width = mask.height = 33;
            mask.getContext("2d")!.drawImage(mapback, 0, 0);
            this.canvases.set("compass_mask", mask);
        }
        const chat = this.canvases.get("chat_section");
        if (chat) {
            const source = chat.getContext("2d")!.getImageData(0, 0, chat.width, chat.height).data;
            for (const state of ["selected", "hover", "selected_hover"] as const) {
                const canvas = document.createElement("canvas");
                canvas.width = chat.width;
                canvas.height = chat.height;
                const ctx = canvas.getContext("2d")!;
                const variant = ctx.createImageData(chat.width, chat.height);
                variant.data.set(createChatStoneVariant(source, chat.width, state));
                ctx.putImageData(variant, 0, 0);
                this.canvases.set(`chat_${state}`, canvas);
            }
        }
        this.ready = true;
        console.info(`[gameframe317] assets loaded (${this.canvases.size})`);
    }

    private drawFixed(context: GameFrameDrawContext): void {
        if (!this.prepare(context)) return;
        const renderer = context.renderer;
        const scale = this.renderScale;
        for (const [name, x, y] of FIXED_BACKGROUND) {
            this.drawNamed(renderer, name, x, y, scale, false, false);
        }
        // The chat sprite is translucent; hide the old parchment baked into the borders.
        renderer.drawRect(this.renderOffsetX, this.renderOffsetY + 338 * scale, 519 * scale, 165 * scale, [0, 0, 0, 1]);
        this.drawChat(renderer, 0, 338, 519, 165, scale);
        const compass = this.textures.get("compass");
        const mask = this.textures.get("compass_mask");
        if (compass && mask) {
            renderer.drawTextureRotatedMasked(
                compass, mask, this.renderOffsetX + 550 * scale, this.renderOffsetY + 4 * scale,
                33 * scale, 33 * scale, -this.osrsClient.camera.yaw, 2048,
                9 / 51, 9 / 51, 42 / 51, 42 / 51,
            );
        }
        this.drawTabs(context, renderer, scale, (x) => x, (y) => y);
    }

    /**
     * OSRS root 161 lays out at the window size, and the 317 chrome hugs the
     * live anchor rects (sidebar / chat) instead of the fixed 765x503 table.
     */
    private drawResizable(context: GameFrameDrawContext): void {
        if (!this.prepare(context)) return;
        const renderer = context.renderer;
        const scale = this.renderScale;

        // Resizable draws the 317 sidebar block (which covers the OSRS sidebar
        // edges) and the chatbox. The 317 mapback is deliberately not drawn.
        this.drawSidebarBlock(context, renderer, scale);

        this.drawChatSection(renderer, context.anchors.chat, scale);
    }

    /** Draws the chat section sprite anchored so its parchment fills the chat rect. */
    private drawChatSection(renderer: GLRenderer, chat: { x: number; y: number; width: number; height: number } | undefined, scale: number): void {
        if (!chat) return;
        const s = chat.width / CHAT_SPRITE.backW;
        this.drawChat(
            renderer,
            chat.x - CHAT_SPRITE.backLeft * s,
            chat.y - CHAT_SPRITE.backTop * s,
            CHAT_SPRITE.width * s,
            CHAT_SPRITE.height * s,
            scale,
        );
    }

    private drawChat(renderer: GLRenderer, x: number, y: number, width: number, height: number, scale: number): void {
        const chat = this.textures.get("chat_section");
        if (!chat?.tex) return;
        const x0 = this.renderOffsetX + x * scale;
        const x1 = x0 + width * scale;
        const y0 = this.renderOffsetY + y * scale;
        const split = 600 / CHAT_SPRITE.height;
        // Fixed reserves 28px for the stones and omits unused bottom padding.
        const y1 = y0 + (this.fixed ? height - 28 : height * split) * scale;
        const y2 = y0 + height * scale;
        const bottom = this.fixed ? 705 / CHAT_SPRITE.height : 1;
        renderer.drawTextureQuads(chat, new Float32Array([
            x0, y0, 0, 0, x1, y0, 1, 0, x1, y1, 1, split, x0, y1, 0, split,
        ]), 1);
        // Cache scripts 175/4482 own selection and hover; keep their clicks and menus.
        const selected = this.osrsClient.varManager.getVarcInt(41);
        const hovered = this.osrsClient.varManager.getVarcInt(42);
        for (let i = 0; i < 8; i++) {
            const isSelected = i < 7 && selected === i;
            const isHovered = i < 7 ? hovered === i
                : this.osrsClient.widgetManager.getWidgetByUid((162 << 16) | 32)?.spriteId === 3058;
            const state = isSelected ? (isHovered ? "selected_hover" : "selected") : isHovered ? "hover" : "section";
            const texture = this.textures.get(`chat_${state}`) ?? chat;
            const u0 = CHAT_COLUMNS[i] / 519;
            const u1 = CHAT_COLUMNS[i + 1] / 519;
            const left = x0 + width * scale * u0;
            const right = x0 + width * scale * u1;
            renderer.drawTextureQuads(texture, new Float32Array([
                left, y1, u0, split, right, y1, u1, split,
                right, y2, u1, bottom, left, y2, u0, bottom,
            ]), 1);
        }
    }

    /**
     * Resizable sidebar: a single pre-cut sprite (`sidebar_inv`) holding the
     * whole 317 inv frame (panel + rounded stones + shadows). Its panel area
     * (fixed 553,205,190x261) is mapped onto the OSRS sidebar content rect, then
     * the tab icons and the selected-tab redstone are drawn over it.
     */
    private drawSidebarBlock(context: GameFrameDrawContext, renderer: GLRenderer, scale: number): void {
        const tb = context.anchors.tabContent;
        if (!tb) return;
        // Map the sprite's panel area onto the OSRS sidebar content rect.
        const sx = tb.width / SIDEBAR_SPRITE.panelW;
        const sy = tb.height / SIDEBAR_SPRITE.panelH;
        const X = (fx: number) => tb.x + (fx - 553) * sx;
        const Y = (fy: number) => tb.y + (fy - 205) * sy;
        this.drawStretched(
            renderer,
            "sidebar_inv",
            tb.x - SIDEBAR_SPRITE.panelLeft * sx,
            tb.y - SIDEBAR_SPRITE.panelTop * sy,
            SIDEBAR_SPRITE.width * sx,
            SIDEBAR_SPRITE.height * sy,
            scale,
        );

        this.drawTabs(context, renderer, scale, X, Y);
    }

    private drawTabs(context: GameFrameDrawContext, renderer: GLRenderer, scale: number, X: (x: number) => number, Y: (y: number) => number): void {
        // The 317 redstone marks the selected tab only.
        const activeTab = this.osrsClient?.varManager?.getVarcInt?.(171) ?? 0;
        if (activeTab >= 0 && activeTab < 7) {
            const [name, x, y, fh, fv] = TOP_STONE[activeTab];
            this.drawNamed(renderer, name, X(x), Y(y), scale, fh, fv);
        } else if (activeTab >= 7 && activeTab <= 13) {
            const [name, x, y, fh, fv] = BOTTOM_STONE[activeTab - 7];
            const bx = activeTab === 7 ? BOTTOM_ICON_POS[0][0] - 29 : x;
            this.drawNamed(renderer, name, X(bx), Y(y), scale, fh, fv);
        }

        // Tab icons the server has not revealed yet have no mounted content
        // (the gameframe's toplevel_sidebuttons_enable uses the same signal).
        const flashTab = ((this.osrsClient?.varManager?.getVarbit?.(3756) ?? 0) | 0) - 1;
        const flashAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(Date.now() / 180));
        const alphaFor = (tab: number) => (tab === flashTab ? flashAlpha : 1);

        for (let i = 0; i < TOP_ICON_POS.length; i++) {
            if (!this.tabVisible(i)) continue;
            const [x, y] = TOP_ICON_POS[i];
            this.drawIcon(renderer, i, X(x), Y(y), scale, alphaFor(i));
            this.registerTab(context, i, X(x), Y(y), scale);
        }
        const clanX = BOTTOM_ICON_POS[0][0] - 29;
        const clanY = BOTTOM_ICON_POS[0][1];
        if (this.tabVisible(7)) {
            this.drawOsrsIcon(renderer, "osrs_clan", X(clanX), Y(clanY), scale, alphaFor(7));
            this.registerTab(context, 7, X(clanX), Y(clanY), scale);
        }
        for (let i = 0; i < BOTTOM_ICON_POS.length; i++) {
            const tab = i + 8;
            if (!this.tabVisible(tab)) continue;
            const [x, y] = BOTTOM_ICON_POS[i];
            if (i === 0) this.drawOsrsIcon(renderer, "osrs_account", X(x), Y(y), scale, alphaFor(tab));
            else if (i === 1) this.drawOsrsIcon(renderer, "osrs_friends", X(x), Y(y), scale, alphaFor(tab));
            else this.drawIcon(renderer, i + 7, X(x), Y(y), scale, alphaFor(tab));
            this.registerTab(context, tab, X(x), Y(y), scale);
        }
    }

    /** True when the server has mounted this tab's content (icon revealed), in any layout. */
    private tabVisible(tab: number): boolean {
        return this.osrsClient?.hasServerSubInterface?.((161 << 16) | (76 + tab)) ?? true;
    }

    /** Stretch a sprite to fill a logical rect (no tiling). */
    private drawStretched(renderer: GLRenderer, name: string, x: number, y: number, width: number, height: number, scale: number): void {
        const texture = this.textures.get(name);
        if (!texture?.tex) return;
        renderer.drawTexture(
            texture,
            this.renderOffsetX + x * scale,
            this.renderOffsetY + y * scale,
            width * scale,
            height * scale,
            1, 1, 0, [0, 0, 0], false, false, 1,
        );
    }

    private buildTextures(renderer: GLRenderer): void {
        for (const [name, canvas] of this.canvases) {
            this.textures.set(name, renderer.createTextureFromCanvas(`gameframe317:${name}`, canvas));
        }
        const strip = this.canvases.get("sideicons");
        if (strip) {
            for (let i = 0; i < ICON_COUNT; i++) {
                const canvas = document.createElement("canvas");
                canvas.width = ICON_SIZE;
                canvas.height = strip.height;
                canvas.getContext("2d")!.drawImage(strip, i * ICON_SIZE, 0, ICON_SIZE, strip.height, 0, 0, ICON_SIZE, strip.height);
                this.iconTextures.push(renderer.createTextureFromCanvas(`gameframe317:icon:${i}`, canvas));
            }
        }
    }

    /** Sets the per-frame transform and lazily uploads textures. */
    private prepare(context: GameFrameDrawContext): boolean {
        if (!this.enabled || !this.ready) return false;
        this.renderScale = context.renderScaleX || window.devicePixelRatio || 1;
        this.renderOffsetX = context.renderOffsetX || 0;
        this.renderOffsetY = context.renderOffsetY || 0;
        if (this.textures.size === 0) this.buildTextures(context.renderer);
        return this.textures.size > 0;
    }

    private drawNamed(renderer: GLRenderer, name: string, x: number, y: number, scale: number, flipH: boolean, flipV: boolean): void {
        const texture = this.textures.get(name);
        if (!texture?.tex) return;
        renderer.drawTexture(
            texture,
            this.renderOffsetX + x * scale,
            this.renderOffsetY + y * scale,
            texture.w * scale,
            texture.h * scale,
            1, 1, 0, [0, 0, 0], flipH, flipV, 1,
        );
    }

    /** OSRS side icons are smaller than the 317 slots, so centre them; tune per icon. */
    private drawOsrsIcon(renderer: GLRenderer, name: string, x: number, y: number, scale: number, alpha = 1): void {
        const texture = this.textures.get(name);
        if (!texture?.tex) return;
        const tune = OSRS_ICON_TUNE[name] ?? {};
        const k = tune.scale ?? 1;
        const w = texture.w * k;
        const h = texture.h * k;
        const dx = x + (OSRS_SLOT_W - w) / 2 + (tune.dx ?? 0);
        const dy = y + (OSRS_SLOT_H - h) / 2 + (tune.dy ?? 0);
        renderer.drawTexture(
            texture,
            this.renderOffsetX + dx * scale,
            this.renderOffsetY + dy * scale,
            w * scale,
            h * scale,
            1, 1, 0, [0, 0, 0], false, false, alpha,
        );
    }

    private drawIcon(renderer: GLRenderer, index: number, x: number, y: number, scale: number, alpha = 1): void {
        const texture = this.iconTextures[index];
        if (!texture?.tex) return;
        renderer.drawTexture(
            texture,
            this.renderOffsetX + x * scale,
            this.renderOffsetY + y * scale,
            texture.w * scale,
            texture.h * scale,
            1, 1, 0, [0, 0, 0], false, false, alpha,
        );
    }

    private registerTab(context: GameFrameDrawContext, tab: number, x: number, y: number, scale: number): void {
        context.clicks?.register({
            id: `gameframe317:tab:${tab}`,
            rect: {
                x: this.renderOffsetX + (x - 2) * scale,
                y: this.renderOffsetY + (y - 2) * scale,
                w: (ICON_SIZE + 4) * scale,
                h: (ICON_SIZE + 4) * scale,
            },
            priority: 200,
            onClick: () => context.switchTab(tab),
        });
    }
}

/** Reverse the bevel lighting for pressed stones; retain the original silhouettes. */
export function createChatStoneVariant(source: Uint8ClampedArray, width: number, state: "selected" | "hover" | "selected_hover"): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(source);
    const face = new Float32Array(source.length / 4);
    for (let i = 0; i < face.length; i++) {
        const p = i * 4;
        face[i] = Math.max(0, Math.min(1, (Math.max(source[p], source[p + 1], source[p + 2]) - 56) / 40));
    }
    const pressed = state !== "hover";
    const gain = pressed ? (state === "selected_hover" ? 0.58 : 0.52) : 1.25;
    const edge = Math.max(1, Math.round(width / 519));
    const offset = edge * (width + 1);
    for (let i = 0; i < face.length; i++) {
        const x = i % width;
        // An inset catches light on its bottom/right lip, with shadow on top/left.
        const upper = x >= edge ? face[i - offset] ?? 0 : 0;
        const lower = x < width - edge ? face[i + offset] ?? 0 : 0;
        // Keep the lower lip narrow and subdued: the sprite already has a lit rim.
        const slope = upper - lower;
        const bevel = pressed ? slope * (slope > 0 ? 12 : 48) : 0;
        for (let channel = 0; channel < 3; channel++) {
            const p = i * 4 + channel;
            pixels[p] = source[p] + (source[p] * (gain - 1) + bevel) * face[i];
        }
    }
    return pixels;
}

/** Loads a PNG and strips the classic magenta (255,0,255) colour key. */
async function loadSprite(url: string): Promise<HTMLCanvasElement> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] >= 200 && pixels[i + 1] <= 40 && pixels[i + 2] >= 200) pixels[i + 3] = 0;
    }
    context.putImageData(image, 0, 0);
    return canvas;
}
