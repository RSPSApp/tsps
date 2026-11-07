import type { Point } from "@runelite/awt/Shapes";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";

/**
 * A marker a plugin puts on the world map (RuneLite's WorldMapPoint): an image drawn with its
 * `imagePoint` anchor on the tile (centred when there is none), optionally snapped to the map's
 * edge while the tile is off-screen, with `onEdgeSnap`/`onEdgeUnsnap` to swap the image.
 */
export class WorldMapPoint {
    private name: string | null = null;
    private imagePoint: Point | null = null;
    private snapToEdge = false;
    private jumpOnClick = false;
    private currentlyEdgeSnapped = false;
    /** The tile the world map centres on when the point is clicked; the point's own tile when null. */
    private target: WorldPoint | null = null;

    constructor(
        private worldPoint: WorldPoint,
        private image: HTMLCanvasElement | null,
    ) {}

    getWorldPoint(): WorldPoint {
        return this.worldPoint;
    }

    setWorldPoint(worldPoint: WorldPoint): void {
        this.worldPoint = worldPoint;
    }

    getImage(): HTMLCanvasElement | null {
        return this.image;
    }

    setImage(image: HTMLCanvasElement | null): void {
        this.image = image;
    }

    getImagePoint(): Point | null {
        return this.imagePoint;
    }

    setImagePoint(point: Point | null): void {
        this.imagePoint = point;
    }

    getName(): string | null {
        return this.name;
    }

    setName(name: string | null): void {
        this.name = name;
    }

    isSnapToEdge(): boolean {
        return this.snapToEdge;
    }

    setSnapToEdge(snap: boolean): void {
        this.snapToEdge = snap;
    }

    isJumpOnClick(): boolean {
        return this.jumpOnClick;
    }

    setJumpOnClick(jump: boolean): void {
        this.jumpOnClick = jump;
    }

    getTarget(): WorldPoint | null {
        return this.target;
    }

    setTarget(target: WorldPoint | null): void {
        this.target = target;
    }

    isCurrentlyEdgeSnapped(): boolean {
        return this.currentlyEdgeSnapped;
    }

    setCurrentlyEdgeSnapped(snapped: boolean): void {
        this.currentlyEdgeSnapped = snapped;
    }

    /** Called when the point starts drawing at the map's edge. */
    onEdgeSnap(): void {}

    /** Called when the point returns to its tile on screen. */
    onEdgeUnsnap(): void {}
}
