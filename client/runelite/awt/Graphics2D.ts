import { Color } from "./Color";
import type { Shape } from "./Shapes";

/** The measurements ported components ask a font for (java.awt.FontMetrics). */
export interface FontMetrics {
    stringWidth(text: string): number;
    /** Ascent + descent + leading: the distance between baselines of consecutive lines. */
    getHeight(): number;
}

/** A font handle an overlay can set; what it is depends on the Graphics2D (an overlay font slot here). */
export type FontHandle = unknown;

/**
 * java.awt.Graphics2D as ported overlays draw with it. Coordinates are the pixels of whatever the
 * implementation draws into; `drawString` places the text's baseline at y, as Java does.
 */
export interface Graphics2D {
    getFontMetrics(font?: FontHandle): FontMetrics;
    getFont(): FontHandle;
    setFont(font: FontHandle): void;
    getColor(): Color;
    setColor(color: Color): void;
    /** The stroke width for `draw` (java.awt.BasicStroke). */
    getStroke(): number;
    setStroke(width: number): void;
    drawString(text: string, x: number, y: number): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawRect(x: number, y: number, width: number, height: number): void;
    fillOval(x: number, y: number, width: number, height: number): void;
    draw(shape: Shape): void;
    fill(shape: Shape): void;
    drawImage(image: HTMLCanvasElement, x: number, y: number): void;
}

export type RecordedRect = { x: number; y: number; width: number; height: number; color: number };
export type RecordedString = { text: string; x: number; y: number; color: number; font: FontHandle };
export type RecordedShape = { kind: "draw" | "fill"; shape: Shape; color: number; strokeWidth: number };
export type RecordedImage = { image: HTMLCanvasElement; x: number; y: number };

/**
 * A Graphics2D that records what was drawn instead of drawing it: the measuring pass before a
 * panel is placed, overlay signatures, and tests. Colours are recorded as 0xAARRGGBB (unsigned).
 */
export class RecordingGraphics2D implements Graphics2D {
    readonly rects: RecordedRect[] = [];
    readonly strings: RecordedString[] = [];
    readonly shapes: RecordedShape[] = [];
    readonly ovals: RecordedRect[] = [];
    readonly images: RecordedImage[] = [];
    private color: Color = Color.WHITE;
    private stroke = 1;
    private font: FontHandle = null;

    constructor(private readonly metrics: FontMetrics, private readonly metricsFor?: (font: FontHandle) => FontMetrics) {}

    getFontMetrics(font?: FontHandle): FontMetrics {
        const handle = font ?? this.font;
        return handle !== null && handle !== undefined && this.metricsFor ? this.metricsFor(handle) : this.metrics;
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

    private argb(): number {
        return this.color.getRGB() >>> 0;
    }

    /** Everything drawn, in order, so a frame can be replayed onto another Graphics2D. */
    private readonly commands: Array<(target: Graphics2D) => void> = [];

    drawString(text: string, x: number, y: number): void {
        this.strings.push({ text, x, y, color: this.argb(), font: this.font });
        const { color, font } = this;
        this.commands.push((target) => {
            target.setFont(font);
            target.setColor(color);
            target.drawString(text, x, y);
        });
    }

    fillRect(x: number, y: number, width: number, height: number): void {
        this.rects.push({ x, y, width, height, color: this.argb() });
        const { color } = this;
        this.commands.push((target) => {
            target.setColor(color);
            target.fillRect(x, y, width, height);
        });
    }

    drawRect(x: number, y: number, width: number, height: number): void {
        this.rects.push({ x, y, width, height, color: this.argb() });
        const { color, stroke } = this;
        this.commands.push((target) => {
            target.setColor(color);
            target.setStroke(stroke);
            target.drawRect(x, y, width, height);
        });
    }

    fillOval(x: number, y: number, width: number, height: number): void {
        this.ovals.push({ x, y, width, height, color: this.argb() });
        const { color } = this;
        this.commands.push((target) => {
            target.setColor(color);
            target.fillOval(x, y, width, height);
        });
    }

    draw(shape: Shape): void {
        this.shapes.push({ kind: "draw", shape, color: this.argb(), strokeWidth: this.stroke });
        const { color, stroke } = this;
        this.commands.push((target) => {
            target.setColor(color);
            target.setStroke(stroke);
            target.draw(shape);
        });
    }

    fill(shape: Shape): void {
        this.shapes.push({ kind: "fill", shape, color: this.argb(), strokeWidth: this.stroke });
        const { color } = this;
        this.commands.push((target) => {
            target.setColor(color);
            target.fill(shape);
        });
    }

    drawImage(image: HTMLCanvasElement, x: number, y: number): void {
        this.images.push({ image, x, y });
        this.commands.push((target) => target.drawImage(image, x, y));
    }

    /** Draws everything recorded onto another Graphics2D, in order. */
    replay(target: Graphics2D): void {
        for (const command of this.commands) command(target);
    }

    /** A stable description of everything recorded, for overlay signatures. */
    signature(): string {
        const image = (i: RecordedImage) => `${i.image.width}x${i.image.height}@${i.x},${i.y}`;
        return JSON.stringify([this.rects, this.strings, this.shapes.map((s) => [s.kind, s.color, s.strokeWidth, s.shape.getBounds()]), this.ovals, this.images.map(image)]);
    }
}
