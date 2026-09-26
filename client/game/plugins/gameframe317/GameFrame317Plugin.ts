import type { ClientPlugin, GameFrameDrawContext, GameFrameProvider } from "../ClientPluginManager";
import type { GLRenderer } from "../../../widgets/gl/renderer";
import { chatHistory } from "../../../rs/cs2/ChatHistory";

/**
 * Classic 317 gameframe sidebar + chatbox, drawn over the live OSRS UI.
 *
 * The frame chrome is drawn through the WebGL widget pass (not a DOM canvas) so
 * it shares the surface with the widget overlay, and hugs the live OSRS anchor
 * rects (sidebar content / chat) instead of a fixed layout table.
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

export class GameFrame317Plugin implements ClientPlugin {
    public readonly gameFrame: GameFrameProvider;
    private enabled = false;
    private ready = false;
    private renderScale = 0;
    private renderOffsetX = 0;
    private renderOffsetY = 0;
    private readonly canvases = new Map<string, HTMLCanvasElement>();
    private readonly textures = new Map<string, Texture>();
    private readonly iconTextures: Texture[] = [];

    constructor(private readonly osrsClient: any) {
        this.gameFrame = {
            isGameFrameActive: () => this.enabled,
            hideStockChrome: () => true,
            widgetRules: () => [
                // Hide the OSRS chatbox background + tab stones (type 5); the
                // chat text/messages are type 4 and still render over our section.
                { group: 162, type: 3, hide: true },
                { group: 162, type: 5, hide: true },
            ],
            // Keep the orb/XP container backgrounds (root-interface children 22 and 7).
            keepChrome: () => [(161 << 16) | 22, (161 << 16) | 7],
            drawGameFrame: (context) => this.drawResizable(context),
        };
        void this.loadAssets();
    }

    handleClientCommand(command: string): boolean {
        const name = command.trim().toLowerCase();
        if (name === "317") {
            this.activate();
            return true;
        }
        if (name === "osrs") {
            this.disable();
            return true;
        }
        return false;
    }

    private activate(): void {
        if (this.enabled) return;
        this.enabled = true;
        this.notify("317 gameframe on (resizable).");
    }

    private disable(): void {
        if (!this.enabled) return;
        this.enabled = false;
        this.notify("Switched back to the OSRS gameframe.");
    }

    private notify(message: string): void {
        try {
            chatHistory.addMessage("game", message);
        } catch {}
        console.info(`[gameframe317] ${this.enabled ? "enabled" : "disabled"} (ready=${this.ready})`);
    }

    private async loadAssets(): Promise<void> {
        const base = process.env.PUBLIC_URL || "/";
        const names = [
            "sideicons", "redstone1", "redstone2", "redstone3",
            // OSRS bottom-row icons for the two slots the 317 set gets wrong
            // (account = tab 8, friends/ignore = tab 9).
            "osrs_account", "osrs_friends", "osrs_clan", "sidebar_inv", "chat_section",
        ];
        await Promise.all(names.map(async (name) => {
            try {
                this.canvases.set(name, await loadSprite(`${base}gameframe317/${name}.png`));
            } catch (error) {
                console.warn(`[gameframe317] missing ${name}.png:`, (error as Error).message);
            }
        }));
        this.ready = true;
        console.info(`[gameframe317] assets loaded (${this.canvases.size})`);
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
        this.drawStretched(
            renderer,
            "chat_section",
            chat.x - CHAT_SPRITE.backLeft * s,
            chat.y - CHAT_SPRITE.backTop * s,
            CHAT_SPRITE.width * s,
            CHAT_SPRITE.height * s,
            scale,
        );
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

        // Icons.
        for (let i = 0; i < TOP_ICON_POS.length; i++) {
            const [x, y] = TOP_ICON_POS[i];
            this.drawIcon(renderer, i, X(x), Y(y), scale);
            this.registerTab(context, i, X(x), Y(y), scale);
        }
        const clanX = BOTTOM_ICON_POS[0][0] - 29;
        const clanY = BOTTOM_ICON_POS[0][1];
        this.drawOsrsIcon(renderer, "osrs_clan", X(clanX), Y(clanY), scale);
        this.registerTab(context, 7, X(clanX), Y(clanY), scale);
        for (let i = 0; i < BOTTOM_ICON_POS.length; i++) {
            const [x, y] = BOTTOM_ICON_POS[i];
            if (i === 0) this.drawOsrsIcon(renderer, "osrs_account", X(x), Y(y), scale);
            else if (i === 1) this.drawOsrsIcon(renderer, "osrs_friends", X(x), Y(y), scale);
            else this.drawIcon(renderer, i + 7, X(x), Y(y), scale);
            this.registerTab(context, i + 8, X(x), Y(y), scale);
        }
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
    private drawOsrsIcon(renderer: GLRenderer, name: string, x: number, y: number, scale: number): void {
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
            1, 1, 0, [0, 0, 0], false, false, 1,
        );
    }

    private drawIcon(renderer: GLRenderer, index: number, x: number, y: number, scale: number): void {
        const texture = this.iconTextures[index];
        if (!texture?.tex) return;
        renderer.drawTexture(
            texture,
            this.renderOffsetX + x * scale,
            this.renderOffsetY + y * scale,
            texture.w * scale,
            texture.h * scale,
            1, 1, 0, [0, 0, 0], false, false, 1,
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
