import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { type Dimension, Rectangle } from "@runelite/awt/Shapes";
import { ComponentConstants } from "./ComponentConstants";
import type { RenderableEntity } from "./LayoutableRenderableEntity";

const BORDER_OFFSET = 2;
const COLOR_OFFSET = 0.2;
const OUTER_COLOR_OFFSET = 1 - COLOR_OFFSET;
const INNER_COLOR_OFFSET = 1 + COLOR_OFFSET;
const ALPHA_COLOR_OFFSET = 1 + 2 * COLOR_OFFSET;

/** RuneLite's BackgroundComponent: a filled rectangle with a darker outer and lighter inner stroke. */
export class BackgroundComponent implements RenderableEntity {
    private backgroundColor: Color = ComponentConstants.STANDARD_BACKGROUND_COLOR;
    private rectangle = new Rectangle();
    private fill = true;

    setBackgroundColor(color: Color): void {
        this.backgroundColor = color;
    }

    setRectangle(rectangle: Rectangle): void {
        this.rectangle = rectangle;
    }

    setFill(fill: boolean): void {
        this.fill = fill;
    }

    render(graphics: Graphics2D): Dimension {
        const bg = this.backgroundColor;
        const alpha = Math.min(255, Math.trunc(bg.getAlpha() * ALPHA_COLOR_OFFSET));
        const outsideStrokeColor = new Color(
            Math.trunc(bg.getRed() * OUTER_COLOR_OFFSET),
            Math.trunc(bg.getGreen() * OUTER_COLOR_OFFSET),
            Math.trunc(bg.getBlue() * OUTER_COLOR_OFFSET),
            alpha,
        );
        const insideStrokeColor = new Color(
            Math.min(255, Math.trunc(bg.getRed() * INNER_COLOR_OFFSET)),
            Math.min(255, Math.trunc(bg.getGreen() * INNER_COLOR_OFFSET)),
            Math.min(255, Math.trunc(bg.getBlue() * INNER_COLOR_OFFSET)),
            alpha,
        );
        const r = this.rectangle;
        if (this.fill) {
            graphics.setColor(bg);
            graphics.fill(r);
        }
        const outside = new Rectangle(r.x, r.y, r.width - BORDER_OFFSET / 2, r.height - BORDER_OFFSET / 2);
        graphics.setColor(outsideStrokeColor);
        graphics.draw(outside);
        const inside = new Rectangle(r.x + BORDER_OFFSET / 2, r.y + BORDER_OFFSET / 2, r.width - BORDER_OFFSET - BORDER_OFFSET / 2, r.height - BORDER_OFFSET - BORDER_OFFSET / 2);
        graphics.setColor(insideStrokeColor);
        graphics.draw(inside);
        return { width: r.width, height: r.height };
    }
}
