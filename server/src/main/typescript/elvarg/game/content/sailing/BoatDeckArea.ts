import { Boundary } from "../../model/Boundary";
import { Location } from "../../model/Location";
import { PrivateArea } from "../../model/areas/impl/PrivateArea";
import { GameObject } from "../../entity/impl/object/GameObject";
import { RegionManager } from "../../collision/RegionManager";
import type { Mobile } from "../../entity/impl/Mobile";
import type { Boat } from "./Boat";
import type { BoatDeckLoc, BoatSpec } from "./BoatSpec";

/** A solid object on the deck (the flag loc shapes 9-11 set). */
const SOLID_OBJECT = 0x100;

/**
 * A boat's deck: its own scene far outside the real map, where everyone aboard stands.
 *
 * As a private area it gets tsps's per-area collision, pathfinding, object lookup and
 * visibility for free. Deck coordinates have no cache map region, so every tile would read as
 * walkable; the deck blocks its whole scene except the boat type's walkable tiles.
 */
export class BoatDeckArea extends PrivateArea {
    private readonly walkable = new Set<string>();
    private readonly solid = new Set<string>();

    constructor(readonly boat: Boat, spec: BoatSpec) {
        super([new Boundary(boat.sceneBaseX, boat.sceneBaseX + 103, boat.sceneBaseY, boat.sceneBaseY + 103, 0)]);
        for (const tile of spec.walkableDeck) {
            this.walkable.add(BoatDeckArea.key(boat.deckBaseX + tile.x, boat.deckBaseY + tile.y));
        }
        for (const loc of spec.locs) this.addLoc(loc);
    }

    /** Swaps whatever loc of the same shape is on a deck tile for another (a facility built). */
    public setLoc(loc: BoatDeckLoc): void {
        const location = this.locLocation(loc);
        for (const object of this.getObjects()) {
            if (object.getLocation().equals(location) && object.getType() === loc.shape) this.detach(object);
        }
        this.solid.delete(BoatDeckArea.key(location.getX(), location.getY()));
        this.addLoc(loc);
    }

    /** A deck lives as long as its boat (BoatManager.dispose destroys it), aboard or not. */
    postLeave(mobile: Mobile, _logout: boolean): void {
        this.remove(mobile);
    }

    private addLoc(loc: BoatDeckLoc): void {
        const location = this.locLocation(loc);
        if (loc.blocks) this.solid.add(BoatDeckArea.key(location.getX(), location.getY()));
        new GameObject(loc.id, location, loc.shape, loc.rotation, this);
    }

    /**
     * Clicks resolve against the level people aboard stand on (0); the client draws the loc on
     * the template's deck plane (loc.level).
     */
    private locLocation(loc: BoatDeckLoc): Location {
        return new Location(this.boat.deckBaseX + loc.x, this.boat.deckBaseY + loc.y, 0);
    }

    public countsAsMainWorld(): boolean {
        return true;
    }

    public hasClip(location: Location): boolean {
        return this.boat.containsDeckTile(location.getX(), location.getY()) || super.hasClip(location);
    }

    public getClip(location: Location): number {
        if (super.hasClip(location)) return super.getClip(location);
        if (!this.boat.containsDeckTile(location.getX(), location.getY())) return 0;
        // Everyone aboard stands on level 0 of the deck scene.
        if (location.getZ() !== 0) return RegionManager.BLOCKED_TILE;
        const key = BoatDeckArea.key(location.getX(), location.getY());
        if (!this.walkable.has(key)) return RegionManager.BLOCKED_TILE;
        return this.solid.has(key) ? SOLID_OBJECT : 0;
    }

    private static key(x: number, y: number): string {
        return `${x},${y}`;
    }
}
