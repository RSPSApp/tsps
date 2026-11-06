import type { Color } from "@runelite/awt/Color";
import { type Graphics2D, RecordingGraphics2D } from "@runelite/awt/Graphics2D";
import { type Dimension, type Point, Rectangle } from "@runelite/awt/Shapes";
import { BackgroundComponent } from "./BackgroundComponent";
import { ComponentConstants } from "./ComponentConstants";
import type { LayoutableRenderableEntity } from "./LayoutableRenderableEntity";

export const ComponentOrientation = { VERTICAL: "VERTICAL", HORIZONTAL: "HORIZONTAL" } as const;
export type ComponentOrientation = (typeof ComponentOrientation)[keyof typeof ComponentOrientation];

/**
 * RuneLite's PanelComponent: a bordered background with children laid out vertically (or
 * horizontally, optionally wrapping). RuneLite sizes the background from the previous frame's
 * children; here a measuring pass sizes it from this frame's, so a panel is right on its first draw.
 */
export class PanelComponent implements LayoutableRenderableEntity {
    private readonly bounds = new Rectangle();
    private preferredLocation: Point = { x: 0, y: 0 };
    private preferredSize: Dimension = { width: ComponentConstants.STANDARD_WIDTH, height: 0 };
    private backgroundColor: Color | null = ComponentConstants.STANDARD_BACKGROUND_COLOR;
    private readonly children: LayoutableRenderableEntity[] = [];
    private orientation: ComponentOrientation = ComponentOrientation.VERTICAL;
    private wrap = false;
    private border = new Rectangle(ComponentConstants.STANDARD_BORDER, ComponentConstants.STANDARD_BORDER, ComponentConstants.STANDARD_BORDER, ComponentConstants.STANDARD_BORDER);
    private gap: Point = { x: 0, y: 0 };
    private childDimensions: Dimension = { width: 0, height: 0 };

    getChildren(): LayoutableRenderableEntity[] {
        return this.children;
    }

    getBounds(): Rectangle {
        return this.bounds;
    }

    setPreferredLocation(position: Point): void {
        this.preferredLocation = position;
    }

    getPreferredSize(): Dimension {
        return this.preferredSize;
    }

    setPreferredSize(dimension: Dimension): void {
        this.preferredSize = dimension;
    }

    getBackgroundColor(): Color | null {
        return this.backgroundColor;
    }

    setBackgroundColor(color: Color | null): void {
        this.backgroundColor = color;
    }

    setOrientation(orientation: ComponentOrientation): void {
        this.orientation = orientation;
    }

    setWrap(wrap: boolean): void {
        this.wrap = wrap;
    }

    setBorder(border: Rectangle): void {
        this.border = border;
    }

    setGap(gap: Point): void {
        this.gap = gap;
    }

    render(graphics: Graphics2D): Dimension | null {
        if (this.children.length === 0) return null;
        // Measure this frame's children first (RuneLite uses last frame's size for the background).
        const measuring = new RecordingGraphics2D(graphics.getFontMetrics(), (font) => graphics.getFontMetrics(font));
        measuring.setFont(graphics.getFont());
        this.childDimensions = this.layoutChildren(measuring);

        const dimension: Dimension = {
            width: this.border.x + this.childDimensions.width + this.border.width,
            height: this.border.y + this.childDimensions.height + this.border.height,
        };
        if (this.backgroundColor) {
            const background = new BackgroundComponent();
            background.setRectangle(new Rectangle(this.preferredLocation.x, this.preferredLocation.y, dimension.width, dimension.height));
            background.setBackgroundColor(this.backgroundColor);
            background.render(graphics);
        }
        this.childDimensions = this.layoutChildren(graphics);
        this.bounds.setLocation(this.preferredLocation.x, this.preferredLocation.y);
        this.bounds.setSize(dimension.width, dimension.height);
        return dimension;
    }

    /** RuneLite's child placement loop; returns the children's total size. */
    private layoutChildren(graphics: Graphics2D): Dimension {
        const baseX = this.preferredLocation.x + this.border.x;
        const baseY = this.preferredLocation.y + this.border.y;
        let width = 0, height = 0, x = baseX, y = baseY;
        const childPreferredSize: Dimension = {
            width: this.preferredSize.width - this.border.x - this.border.width,
            height: this.preferredSize.height - this.border.y - this.border.height,
        };
        let totalHeight = 0, totalWidth = 0;
        const vertical = this.orientation === ComponentOrientation.VERTICAL;
        for (const child of this.children) {
            if (!this.wrap) {
                child.setPreferredSize(vertical ? { width: childPreferredSize.width, height: 0 } : { width: 0, height: childPreferredSize.height });
            }
            child.setPreferredLocation({ x, y });
            const childDimension = child.render(graphics) ?? { width: 0, height: 0 };
            if (vertical) {
                height += childDimension.height + this.gap.y;
                y = baseY + height;
                width = Math.max(width, childDimension.width);
            } else {
                width += childDimension.width + this.gap.x;
                x = baseX + width;
                height = Math.max(height, childDimension.height);
            }
            totalWidth = Math.max(totalWidth, width);
            totalHeight = Math.max(totalHeight, height);
            if (!this.wrap) continue;
            if (vertical) {
                if (childPreferredSize.height > 0 && height >= childPreferredSize.height) {
                    height = 0;
                    y = baseY;
                    const diff = childDimension.width + this.gap.x;
                    x += diff;
                    width += diff;
                }
            } else if (childPreferredSize.width > 0 && width >= childPreferredSize.width) {
                width = 0;
                x = baseX;
                const diff = childDimension.height + this.gap.y;
                y += diff;
                height += diff;
            }
        }
        if (vertical) totalHeight -= this.gap.y;
        else totalWidth -= this.gap.x;
        return { width: totalWidth, height: totalHeight };
    }
}
