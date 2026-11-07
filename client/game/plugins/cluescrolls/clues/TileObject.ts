import type { Shape } from "@runelite/awt/Shapes";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";

/**
 * A loc the plugin marks (RuneLite's TileObject, as far as the clues read it): its id, its tile,
 * and its clickbox on the canvas this frame (null when off-screen).
 */
export interface TileObject {
    getId(): number;
    getWorldLocation(): WorldPoint;
    getPlane(): number;
    getClickbox(): Shape | null;
}
