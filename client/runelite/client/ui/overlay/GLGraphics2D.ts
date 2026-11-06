import { Color } from "@runelite/awt/Color";
import type { FontHandle, FontMetrics, Graphics2D } from "@runelite/awt/Graphics2D";
import { Rectangle, type Shape, shapePoints } from "@runelite/awt/Shapes";
import { drawTextGL } from "../../../../widgets/components/TextRenderer";
import type { WidgetOverlayDrawContext } from "../../../../game/plugins/ClientPluginManager";
import { CanvasTextureCache } from "./CanvasTextureCache";
import { boldFont, overlayFont, type OverlayFont, type OverlayFontSlot } from "./OverlayFonts";

/** The line height of the client's overlay fonts at 16pt, as QuestHelper's panel uses it. */
const LINE_HEIGHT = 16;
/** Pixels above the baseline the glyph box starts, so `drawString` places text like Java does. */
const ASCENT = 13;

/** The device rect an overlay drew into, for the WidgetOverlay contract. */
export type DrawnRect = { x: number; y: number; w: number; h: number };

/**
 * Where a Graphics2D draws: an origin in device pixels and the device pixels per canvas unit
 * (1 for world overlays, which get device pixels from the renderer already).
 */
export type GraphicsFrame = { x: number; y: number; scaleX: number; scaleY: number };

/** Textures for the canvases overlays draw, bounded and shared by every GLGraphics2D. */
const textures = new CanvasTextureCache(256);

/**
 * java.awt.Graphics2D over the client's GL overlay context. Fonts are the overlay font slots
 * (`"interface"`, `"dynamic"`, a bold variant); `drawString` puts the baseline at y.
 */
export class GLGraphics2D implements Graphics2D {
    private color: Color = Color.WHITE;
    private stroke = 1;
    private font: FontHandle;
    readonly drawn: DrawnRect[] = [];

    constructor(
        private readonly context: WidgetOverlayDrawContext,
        private readonly frame: GraphicsFrame = { x: 0, y: 0, scaleX: 1, scaleY: 1 },
        font: OverlayFont | OverlayFontSlot = "interface",
    ) {
        this.font = typeof font === "string" ? overlayFont(font) : font;
    }

    private resolveFont(handle: FontHandle): OverlayFont {
        if (typeof handle === "string") return overlayFont(handle as OverlayFontSlot);
        if (handle && typeof handle === "object" && "id" in (handle as object)) return handle as OverlayFont;
        return overlayFont("interface");
    }

    getFontMetrics(font?: FontHandle): FontMetrics {
        const resolved = this.resolveFont(font ?? this.font);
        const bitmap = this.context.fontLoader(resolved.id);
        return {
            stringWidth: (text) => Math.round((bitmap ? bitmap.measure(text) : text.length * 6) * resolved.scale),
            getHeight: () => Math.round(LINE_HEIGHT * resolved.scale),
        };
    }

    /** The bold form of a font handle (RuneLite's FontManager.getRunescapeBoldFont for this slot). */
    static bold(font: FontHandle): OverlayFont {
        const resolved = typeof font === "string" ? overlayFont(font as OverlayFontSlot) : (font as OverlayFont);
        return boldFont(resolved);
    }

    getFont(): FontHandle {
        return this.font;
    }

    setFont(font: FontHandle): void {
        this.font = font;
    }

    getColor(): Color {
        return this.color;
    }

    setColor(color: Color): void {
        this.color = color;
    }

    getStroke(): number {
        return this.stroke;
    }

    setStroke(width: number): void {
        this.stroke = width;
    }

    private dx(x: number): number {
        return this.frame.x + x * this.frame.scaleX;
    }

    private dy(y: number): number {
        return this.frame.y + y * this.frame.scaleY;
    }

    private covered(x: number, y: number, w: number, h: number): void {
        this.drawn.push({ x, y, w, h });
    }

    private renderer(): any {
        return this.context.renderer;
    }

    drawString(text: string, x: number, y: number): void {
        if (!text) return;
        const resolved = this.resolveFont(this.font);
        const metrics = this.getFontMetrics();
        const w = metrics.stringWidth(text), h = metrics.getHeight();
        const left = this.dx(x), top = this.dy(y - ASCENT * resolved.scale);
        const width = w * this.frame.scaleX, height = h * this.frame.scaleY;
        drawTextGL(
            this.renderer(), this.context.fontLoader, text, left, top, width + 4 * this.frame.scaleX, height,
            resolved.id, this.color.getRGB() & 0xffffff, 0, 0, false, this.color.getAlpha() / 255, undefined,
            this.frame.scaleX * resolved.scale, this.frame.scaleY * resolved.scale,
        );
        this.covered(left, top, width + 4 * this.frame.scaleX, height);
    }

    fillRect(x: number, y: number, width: number, height: number): void {
        const l = this.dx(x), t = this.dy(y), w = width * this.frame.scaleX, h = height * this.frame.scaleY;
        this.renderer().drawRect(l, t, w, h, this.color.toRgba());
        this.covered(l, t, w, h);
    }

    drawRect(x: number, y: number, width: number, height: number): void {
        this.draw(new Rectangle(x, y, width, height));
    }

    fillOval(x: number, y: number, width: number, height: number): void {
        const cx = x + width / 2, cy = y + height / 2, rx = width / 2, ry = height / 2;
        const points: Array<[number, number]> = [];
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            points.push([this.dx(cx + Math.cos(a) * rx), this.dy(cy + Math.sin(a) * ry)]);
        }
        this.renderer().drawPolygon?.(points, this.color.toRgba());
        this.covered(this.dx(x), this.dy(y), width * this.frame.scaleX, height * this.frame.scaleY);
    }

    private devicePoints(shape: Shape): Array<[number, number]> {
        return shapePoints(shape).map(([px, py]) => [this.dx(px), this.dy(py)] as [number, number]);
    }

    draw(shape: Shape): void {
        const points = this.devicePoints(shape);
        if (points.length < 2) return;
        this.renderer().drawPolyline?.(points, Math.max(1, this.stroke * this.frame.scaleX), this.color.toRgba(), true);
        const b = shape.getBounds();
        this.covered(this.dx(b.x) - this.stroke, this.dy(b.y) - this.stroke, b.width * this.frame.scaleX + 2 * this.stroke, b.height * this.frame.scaleY + 2 * this.stroke);
    }

    fill(shape: Shape): void {
        const points = this.devicePoints(shape);
        if (points.length < 3) return;
        this.renderer().drawPolygon?.(points, this.color.toRgba());
        const b = shape.getBounds();
        this.covered(this.dx(b.x), this.dy(b.y), b.width * this.frame.scaleX, b.height * this.frame.scaleY);
    }

    drawImage(image: HTMLCanvasElement, x: number, y: number): void {
        const glr = this.renderer();
        if (!glr.createTextureFromCanvas) return;
        const texture = textures.texture(glr, image);
        if (!texture) return;
        const w = image.width * this.frame.scaleX, h = image.height * this.frame.scaleY;
        glr.drawTexture(texture, this.dx(x), this.dy(y), w, h);
        this.covered(this.dx(x), this.dy(y), w, h);
    }
}
