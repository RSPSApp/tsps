import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { Dimension, Point, Rectangle } from "@runelite/awt/Shapes";

/** Something an overlay draws (RuneLite's RenderableEntity): returns the size it took, or null. */
export interface RenderableEntity {
    render(graphics: Graphics2D): Dimension | null;
}

/** A component a PanelComponent lays out (RuneLite's LayoutableRenderableEntity). */
export interface LayoutableRenderableEntity extends RenderableEntity {
    getBounds(): Rectangle;
    setPreferredLocation(position: Point): void;
    setPreferredSize(dimension: Dimension): void;
}
