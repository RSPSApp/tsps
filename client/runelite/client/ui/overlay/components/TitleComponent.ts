import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { type Dimension, type Point, Rectangle } from "@runelite/awt/Shapes";
import { ComponentConstants } from "./ComponentConstants";
import type { LayoutableRenderableEntity } from "./LayoutableRenderableEntity";
import { TextComponent } from "./TextComponent";

/** RuneLite's TitleComponent: a line of text centred in the preferred width. */
export class TitleComponent implements LayoutableRenderableEntity {
    private text = "";
    private color: Color = Color.WHITE;
    private preferredLocation: Point = { x: 0, y: 0 };
    private preferredSize: Dimension = { width: ComponentConstants.STANDARD_WIDTH, height: 0 };
    private readonly bounds = new Rectangle();

    static builder(): TitleComponentBuilder {
        return new TitleComponentBuilder();
    }

    setText(text: string): void {
        this.text = text ?? "";
    }

    setColor(color: Color): void {
        this.color = color;
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
        const baseX = this.preferredLocation.x;
        const baseY = this.preferredLocation.y;
        const metrics = graphics.getFontMetrics();
        const title = new TextComponent();
        title.setText(this.text);
        title.setColor(this.color);
        title.setPosition(baseX + Math.trunc((this.preferredSize.width - metrics.stringWidth(this.text)) / 2), baseY + metrics.getHeight());
        const rendered = title.render(graphics);
        const dimension = { width: this.preferredSize.width, height: rendered.height };
        this.bounds.setLocation(baseX, baseY);
        this.bounds.setSize(dimension.width, dimension.height);
        return dimension;
    }
}

export class TitleComponentBuilder {
    private readonly component = new TitleComponent();

    text(text: string): this {
        this.component.setText(text);
        return this;
    }

    color(color: Color): this {
        this.component.setColor(color);
        return this;
    }

    build(): TitleComponent {
        return this.component;
    }
}
