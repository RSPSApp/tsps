import type { GameFrameDrawContext } from "../ClientPluginManager";
import type { GLRenderer } from "../../../widgets/gl/renderer";
import { TextureCache, type SpriteMaskData } from "../../../widgets/gl/texture-cache";
import { VARP_GAMEFRAME_SKIN } from "../../../common/ui/gameframeLayout";
import { GameFrame317Plugin, loadSprite } from "../gameframe317/GameFrame317Plugin";

const CHAT_COLUMNS = [0, 283, 528, 770, 1017, 1266, 1514, 1753, 2170];
const TAB_CENTERS = [544, 578, 611, 644, 678, 712, 747];

/** Gilomaru artwork with native OSRS icons, widgets and minimap controls. */
export class GilomaruGameFramePlugin extends GameFrame317Plugin {
    protected override get enabled(): boolean {
        return (this.fixed || this.osrsClient.widgetManager?.rootInterface === 161) &&
            this.osrsClient.varManager?.getVarp(VARP_GAMEFRAME_SKIN) === 2;
    }
    protected override get texturePrefix(): string { return "gameframeGilomaru"; }
    protected override get chatColumns(): readonly number[] { return CHAT_COLUMNS; }
    private nativeSprites?: TextureCache;
    private mask?: SpriteMaskData;
    private maskRect = "";

    constructor(client: any) {
        super(client);
        this.gameFrame.widgetRules = () => [
            { group: 162, type: 3, hide: true },
            { group: 162, type: 5, hide: true },
        ];
        this.gameFrame.drawGameFrame = (context) => this.drawGilomaru(context);
        this.gameFrame.minimapMask = (renderer, x, y, width, height) => this.getMinimapMask(renderer, x, y, width, height);
    }

    protected override async loadAssets(): Promise<void> {
        const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
        try {
            const [frame, chat] = await Promise.all([
                loadSprite(`${base}/gameframe-gilomaru/frame.png`),
                loadSprite(`${base}/gameframe-gilomaru/chat.png`),
            ]);
            // Soften the marble behind chat text without tinting the bevel or stones.
            const chatCtx = chat.getContext("2d")!;
            chatCtx.fillStyle = "rgba(255, 248, 224, 0.5)";
            chatCtx.fill(new Path2D("M46 31H2124L2135 42V556L2124 567H46L35 556V42Z"));
            const ctx = frame.getContext("2d")!;
            // Replace the baked-in door with the adjacent empty stone.
            ctx.drawImage(frame, 595, 466, 33, 37, 628, 466, 33, 37);
            ctx.clearRect(0, 338, 519, 165); // Ignore the original chatbox.
            const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
            for (let i = 0; i < pixels.data.length; i += 4) {
                if (pixels.data[i] === 255 && pixels.data[i + 1] === 255 && pixels.data[i + 2] === 255) {
                    pixels.data[i + 3] = 0;
                }
            }
            ctx.putImageData(pixels, 0, 0);
            this.canvases.set("frame", frame);
            this.canvases.set("chat_section", chat);
            this.buildStoneVariants(frame, "frame");
            this.buildStoneVariants(chat, "chat");
            this.ready = true;
        } catch (error) {
            console.warn("[gameframeGilomaru] assets:", (error as Error).message);
        }
    }

    private getMinimapMask(renderer: GLRenderer, x: number, y: number, width: number, height: number): SpriteMaskData | undefined {
        if (!this.fixed || !this.ready) return undefined;
        const key = [x, y, width, height].join(":");
        if (this.maskRect === key) return this.mask;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(this.canvases.get("frame")!, -x, -y);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        const xStarts = new Int32Array(height).fill(width);
        const xWidths = new Int32Array(height);
        for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
            if (pixels[(xx + yy * width) * 4 + 3] !== 0) continue;
            xStarts[yy] = Math.min(xStarts[yy], xx);
            xWidths[yy] = xx - xStarts[yy] + 1;
        }
        this.mask = {
            texture: renderer.createTextureFromCanvas(`gameframeGilomaru:map:${key}`, canvas),
            width, height, xStarts, xWidths,
            contains: (xx, yy) => xx >= 0 && yy >= 0 && xx < width && yy < height &&
                pixels[((xx | 0) + (yy | 0) * width) * 4 + 3] === 0,
        };
        this.maskRect = key;
        return this.mask;
    }

    private drawGilomaru(context: GameFrameDrawContext): void {
        if (!this.prepare(context)) return;
        const { renderer } = context;
        const scale = this.renderScale;
        const tb = context.anchors.tabContent;
        if (!this.fixed && !tb) return;
        const X = this.fixed ? (x: number) => x : (x: number) => tb!.x + (x - 553) * tb!.width / 190;
        const Y = this.fixed ? (y: number) => y : (y: number) => tb!.y + (y - 205) * tb!.height / 261;
        if (this.fixed) {
            this.drawNamed(renderer, "frame", 0, 0, scale, false, false);
            this.drawChat(renderer, 0, 338, 519, 165, scale);
        } else {
            this.drawGilomaruRegion(renderer, "frame", 519, 160, 246, 343, X, Y, scale);
            this.drawChatSection(renderer, context.anchors.chat, scale);
        }
        this.nativeSprites ??= new TextureCache(renderer, this.osrsClient.cacheSystem.getIndex(8));
        const root = this.osrsClient.widgetManager.rootInterface;
        const selected = this.osrsClient.varManager.getVarcInt(171);
        for (let tab = 0; tab < 14; tab++) {
            const cx = TAB_CENTERS[tab % 7];
            const cy = tab < 7 ? 188 : 485;
            const hovered = context.clicks?.isHover(`gameframeGilomaru:tab:${tab}`);
            const state = selected === tab ? (hovered ? "selected_hover" : "selected") : hovered ? "hover" : "frame";
            if (state !== "frame") {
                this.drawGilomaruRegion(renderer, `frame_${state}`, cx - 16, cy - 17, 33, 35, X, Y, scale);
            }
            // Cache enum 1139's icons, translated by pane enum 1129 in fixed mode.
            const child = (tab < 7 ? 66 + tab : 50 + tab - 7) + (this.fixed ? 5 : 0);
            const widget = this.osrsClient.widgetManager.getWidgetByUid((root << 16) | child);
            const icon = widget && this.nativeSprites.getSpriteById(widget.spriteId);
            if (icon) {
                const size = Math.min(1, 28 / Math.max(icon.w, icon.h));
                renderer.drawTexture(icon,
                    this.renderOffsetX + (X(cx) - icon.w * size / 2) * scale,
                    this.renderOffsetY + (Y(cy) - icon.h * size / 2) * scale,
                    icon.w * size * scale, icon.h * size * scale,
                    1, 1, 0, [0, 0, 0], false, false, 1);
            }
            this.registerTab(context, tab, X(cx) - 15, Y(cy) - 15, scale);
        }
    }

    private drawGilomaruRegion(renderer: GLRenderer, name: string, x: number, y: number, width: number, height: number,
        X: (x: number) => number, Y: (y: number) => number, scale: number): void {
        const texture = this.textures.get(name);
        if (!texture?.tex) return;
        const left = this.renderOffsetX + X(x) * scale;
        const right = this.renderOffsetX + X(x + width) * scale;
        const top = this.renderOffsetY + Y(y) * scale;
        const bottom = this.renderOffsetY + Y(y + height) * scale;
        renderer.drawTextureQuads(texture, new Float32Array([
            left, top, x / 765, y / 503, right, top, (x + width) / 765, y / 503,
            right, bottom, (x + width) / 765, (y + height) / 503, left, bottom, x / 765, (y + height) / 503,
        ]), 1);
    }

}
