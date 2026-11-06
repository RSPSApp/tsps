import { Color } from "@runelite/awt/Color";
import type { FontHandle, Graphics2D } from "@runelite/awt/Graphics2D";
import type { Dimension, Point } from "@runelite/awt/Shapes";
import type { RenderableEntity } from "./LayoutableRenderableEntity";

const COL_TAG = /<col=([0-9a-fA-F]{2,6})>/g;

/**
 * RuneLite's TextComponent: one line of text at a baseline, with a black shadow (or outline) and
 * `<col=…>` colour changes inside it.
 */
export class TextComponent implements RenderableEntity {
    private text = "";
    private positionX = 0;
    private positionY = 0;
    private color: Color = Color.WHITE;
    private outline = false;
    private font: FontHandle = null;

    setText(text: string): void {
        this.text = text ?? "";
    }

    setPosition(position: Point): void;
    setPosition(x: number, y: number): void;
    setPosition(xOrPoint: number | Point, y?: number): void {
        if (typeof xOrPoint === "number") {
            this.positionX = xOrPoint;
            this.positionY = y ?? 0;
        } else {
            this.positionX = xOrPoint.x;
            this.positionY = xOrPoint.y;
        }
    }

    setColor(color: Color): void {
        this.color = color;
    }

    setOutline(outline: boolean): void {
        this.outline = outline;
    }

    setFont(font: FontHandle): void {
        this.font = font;
    }

    render(graphics: Graphics2D): Dimension {
        let originalFont: FontHandle = null;
        if (this.font !== null && this.font !== undefined) {
            originalFont = graphics.getFont();
            graphics.setFont(this.font);
        }
        const metrics = graphics.getFontMetrics();
        let textColor = this.color;
        let index = 0;
        let width = 0;
        for (const match of this.text.matchAll(COL_TAG)) {
            const segment = this.text.slice(index, match.index);
            index = (match.index ?? 0) + match[0].length;
            this.renderText(graphics, textColor, this.positionX + width, this.positionY, segment);
            width += metrics.stringWidth(segment);
            textColor = Color.decode(`#${match[1]}`);
        }
        const rest = this.text.slice(index);
        this.renderText(graphics, textColor, this.positionX + width, this.positionY, rest);
        width += metrics.stringWidth(rest);
        const height = metrics.getHeight();
        if (originalFont !== null) graphics.setFont(originalFont);
        return { width, height };
    }

    private renderText(graphics: Graphics2D, color: Color, x: number, y: number, text: string): void {
        if (!text) return;
        graphics.setColor(Color.BLACK);
        if (this.outline) {
            graphics.drawString(text, x, y + 1);
            graphics.drawString(text, x, y - 1);
            graphics.drawString(text, x + 1, y);
            graphics.drawString(text, x - 1, y);
        } else {
            graphics.drawString(text, x + 1, y + 1);
        }
        graphics.setColor(color);
        graphics.drawString(text, x, y);
    }
}
