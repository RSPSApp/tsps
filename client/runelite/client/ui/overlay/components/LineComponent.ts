import { Color } from "@runelite/awt/Color";
import type { FontHandle, FontMetrics, Graphics2D } from "@runelite/awt/Graphics2D";
import { type Dimension, type Point, Rectangle } from "@runelite/awt/Shapes";
import { Text } from "../../../util/Text";
import { ComponentConstants } from "./ComponentConstants";
import type { LayoutableRenderableEntity } from "./LayoutableRenderableEntity";
import { TextComponent } from "./TextComponent";

/**
 * RuneLite's LineComponent: a left text and a right-aligned text on one line. When they do not
 * fit the preferred width, the left gets two thirds and the right one third, each word-wrapped.
 */
export class LineComponent implements LayoutableRenderableEntity {
    private left: string | null = null;
    private right: string | null = null;
    private leftColor: Color = Color.WHITE;
    private rightColor: Color = Color.WHITE;
    private leftFont: FontHandle = null;
    private rightFont: FontHandle = null;
    private preferredLocation: Point = { x: 0, y: 0 };
    private preferredSize: Dimension = { width: ComponentConstants.STANDARD_WIDTH, height: 0 };
    private readonly bounds = new Rectangle();

    static builder(): LineComponentBuilder {
        return new LineComponentBuilder();
    }

    setLeft(left: string | null): void {
        this.left = left;
    }

    setRight(right: string | null): void {
        this.right = right;
    }

    setLeftColor(color: Color): void {
        this.leftColor = color;
    }

    setRightColor(color: Color): void {
        this.rightColor = color;
    }

    setLeftFont(font: FontHandle): void {
        this.leftFont = font;
    }

    setRightFont(font: FontHandle): void {
        this.rightFont = font;
    }

    setPreferredLocation(position: Point): void {
        this.preferredLocation = position;
    }

    setPreferredSize(dimension: Dimension): void {
        this.preferredSize = dimension;
    }

    getBounds(): Rectangle {
        return this.bounds;
    }

    render(graphics: Graphics2D): Dimension {
        const left = this.left ?? "";
        const right = this.right ?? "";
        const leftFont = this.leftFont ?? graphics.getFont();
        const rightFont = this.rightFont ?? graphics.getFont();
        const lfm = graphics.getFontMetrics(leftFont), rfm = graphics.getFontMetrics(rightFont);
        const fmHeight = Math.max(lfm.getHeight(), rfm.getHeight());
        const baseX = this.preferredLocation.x;
        const baseY = this.preferredLocation.y + fmHeight;
        const x = baseX;
        let y = baseY;
        const leftFullWidth = lineWidth(left, lfm);
        const rightFullWidth = lineWidth(right, rfm);
        const text = new TextComponent();
        const width = this.preferredSize.width;

        if (width < leftFullWidth + rightFullWidth) {
            let leftSmallWidth = width;
            let rightSmallWidth = 0;
            if (right) {
                rightSmallWidth = Math.trunc(width / 3);
                leftSmallWidth -= rightSmallWidth;
            }
            const leftLines = lineBreakText(left, leftSmallWidth, lfm);
            const rightLines = lineBreakText(right, rightSmallWidth, rfm);
            const lineCount = Math.max(leftLines.length, rightLines.length);
            for (let i = 0; i < lineCount; i++) {
                if (i < leftLines.length) {
                    text.setPosition(x, y);
                    text.setText(leftLines[i]);
                    text.setColor(this.leftColor);
                    text.setFont(leftFont);
                    text.render(graphics);
                }
                if (i < rightLines.length) {
                    text.setPosition(x + width - lineWidth(rightLines[i], rfm), y);
                    text.setText(rightLines[i]);
                    text.setColor(this.rightColor);
                    text.setFont(rightFont);
                    text.render(graphics);
                }
                y += fmHeight;
            }
            return this.finish(baseX, baseY, width, y - baseY, fmHeight);
        }

        if (left) {
            text.setPosition(x, y);
            text.setText(left);
            text.setColor(this.leftColor);
            text.setFont(leftFont);
            text.render(graphics);
        }
        if (right) {
            text.setPosition(x + width - rightFullWidth, y);
            text.setText(right);
            text.setColor(this.rightColor);
            text.setFont(rightFont);
            text.render(graphics);
        }
        y += fmHeight;
        return this.finish(baseX, baseY, width, y - baseY, fmHeight);
    }

    private finish(baseX: number, baseY: number, width: number, height: number, fmHeight: number): Dimension {
        this.bounds.setLocation(this.preferredLocation.x, this.preferredLocation.y);
        this.bounds.setSize(width, height);
        void baseX;
        void baseY;
        void fmHeight;
        return { width, height };
    }
}

function lineWidth(line: string, metrics: FontMetrics): number {
    return metrics.stringWidth(Text.removeTags(line));
}

/** RuneLite's lineBreakText: greedy word wrap on spaces; an empty text gives no lines. */
function lineBreakText(text: string, maxWidth: number, metrics: FontMetrics): string[] {
    const words = text.split(" ");
    if (words.length === 0 || text.length === 0) return text.length === 0 ? [] : [text];
    let wrapped = words[0];
    let spaceLeft = maxWidth - metrics.stringWidth(wrapped);
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const wordLen = metrics.stringWidth(word);
        const spaceWidth = metrics.stringWidth(" ");
        if (wordLen + spaceWidth > spaceLeft) {
            wrapped += `\n${word}`;
            spaceLeft = maxWidth - wordLen;
        } else {
            wrapped += ` ${word}`;
            spaceLeft -= spaceWidth + wordLen;
        }
    }
    return wrapped.split("\n");
}

export class LineComponentBuilder {
    private readonly component = new LineComponent();

    left(left: string): this {
        this.component.setLeft(left);
        return this;
    }

    right(right: string): this {
        this.component.setRight(right);
        return this;
    }

    leftColor(color: Color): this {
        this.component.setLeftColor(color);
        return this;
    }

    rightColor(color: Color): this {
        this.component.setRightColor(color);
        return this;
    }

    leftFont(font: FontHandle): this {
        this.component.setLeftFont(font);
        return this;
    }

    rightFont(font: FontHandle): this {
        this.component.setRightFont(font);
        return this;
    }

    build(): LineComponent {
        return this.component;
    }
}
