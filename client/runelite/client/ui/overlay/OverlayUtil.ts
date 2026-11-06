import { Color } from "@runelite/awt/Color";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import type { Point, Shape } from "@runelite/awt/Shapes";
import type { NPC } from "@runelite/api/Client";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { Perspective, type PerspectiveClient } from "@runelite/api/Perspective";

const MINIMAP_DOT_RADIUS = 4;
const DEFAULT_FILL = new Color(0, 0, 0, 50);

/** RuneLite's OverlayUtil, over a Graphics2D in canvas pixels. */
export const OverlayUtil = {
    /** Outline (stroke 2 unless given) and fill (black at alpha 50 unless given) a shape. */
    renderPolygon(graphics: Graphics2D, poly: Shape, color: Color, fillColor: Color = DEFAULT_FILL, strokeWidth = 2): void {
        graphics.setColor(color);
        const originalStroke = graphics.getStroke();
        graphics.setStroke(strokeWidth);
        graphics.draw(poly);
        graphics.setColor(fillColor);
        graphics.fill(poly);
        graphics.setStroke(originalStroke);
    },

    /** A black-backed dot on the minimap. */
    renderMinimapLocation(graphics: Graphics2D, mini: Point, color: Color): void {
        graphics.setColor(Color.BLACK);
        graphics.fillOval(mini.x - MINIMAP_DOT_RADIUS / 2, mini.y - MINIMAP_DOT_RADIUS / 2 + 1, MINIMAP_DOT_RADIUS, MINIMAP_DOT_RADIUS);
        graphics.setColor(new Color(color.getRed(), color.getGreen(), color.getBlue(), 255));
        graphics.fillOval(mini.x - MINIMAP_DOT_RADIUS / 2, mini.y - MINIMAP_DOT_RADIUS / 2, MINIMAP_DOT_RADIUS, MINIMAP_DOT_RADIUS);
    },

    /** Shadowed text with its baseline at the point. */
    renderTextLocation(graphics: Graphics2D, textLocation: Point, text: string, color: Color): void {
        if (!text) return;
        graphics.setColor(Color.BLACK);
        graphics.drawString(text, textLocation.x + 1, textLocation.y + 1);
        graphics.setColor(new Color(color.getRed(), color.getGreen(), color.getBlue(), 255));
        graphics.drawString(text, textLocation.x, textLocation.y);
    },

    /** An image with its top left at the point (nothing while the image has not loaded). */
    renderImageLocation(graphics: Graphics2D, imageLocation: Point, image: HTMLCanvasElement | null): void {
        if (image) graphics.drawImage(image, imageLocation.x, imageLocation.y);
    },

    /** An image centred over a tile, `zOffset` local units (128 a tile) above the ground. */
    renderImageLocationAt(client: PerspectiveClient, graphics: Graphics2D, point: WorldPoint, image: HTMLCanvasElement | null, zOffset: number): void {
        if (!image) return;
        const imageLocation = Perspective.getCanvasImageLocation(client, point, image, zOffset);
        if (imageLocation) OverlayUtil.renderImageLocation(graphics, imageLocation, image);
    },

    /** An NPC's tile outlined in the colour, with an image above it. */
    renderActorOverlayImage(client: PerspectiveClient, graphics: Graphics2D, actor: NPC, image: HTMLCanvasElement | null, color: Color, zOffset: number): void {
        const poly = Perspective.getActorTilePoly(client, actor);
        if (poly) OverlayUtil.renderPolygon(graphics, poly, color);
        if (!image) return;
        const imageLocation = Perspective.getActorImageLocation(client, actor, image, zOffset);
        if (imageLocation) OverlayUtil.renderImageLocation(graphics, imageLocation, image);
    },

    /** A tile outlined in the colour, with an image centred on it. */
    renderTileOverlay(client: PerspectiveClient, graphics: Graphics2D, point: WorldPoint, image: HTMLCanvasElement | null, color: Color): void {
        const poly = Perspective.getCanvasTilePoly(client, point);
        if (poly) OverlayUtil.renderPolygon(graphics, poly, color);
        OverlayUtil.renderImageLocationAt(client, graphics, point, image, 0);
    },

    /** Outline and fill an area, with the hover border when the mouse is inside it. */
    renderHoverableArea(graphics: Graphics2D, area: Shape | null, mousePosition: Point, fillColor: Color, borderColor: Color, borderHoverColor: Color): void {
        if (!area) return;
        graphics.setColor(area.contains(mousePosition.x, mousePosition.y) ? borderHoverColor : borderColor);
        graphics.draw(area);
        graphics.setColor(fillColor);
        graphics.fill(area);
    },
};
