import { RegionManager } from "../../collision/RegionManager";
import type { Mobile } from "../../entity/impl/Mobile";
import { Location } from "../../model/Location";
import type { PrivateArea } from "../../model/areas/impl/PrivateArea";
import { Boat } from "./Boat";
import { BoatDeckArea } from "./BoatDeckArea";
import { tickBoat } from "./BoatMovement";
import type { BoatDeckLoc, BoatPlacement, BoatSpec } from "./BoatSpec";
import { packedHeadingToAngle } from "./HeadingUtils";

const FIRST_ENTITY_INDEX = 3000;
const LAST_ENTITY_INDEX = 3999;
/** Deck scenes live far outside the real map (tile 9600+), 16 chunks apart. */
const DECK_REGION_BASE = 1200;
const DECK_REGION_SPACING = 16;
const DECK_REGION_COLUMNS = 32;
/** A solid object in the main world (loc shapes 9-11). */
const SOLID_OBJECT = 0x100;

export type HeadingListener = (player: Mobile, boat: Boat) => void;

interface ActiveBoat {
    boat: Boat;
    spec: BoatSpec;
    deck: BoatDeckArea;
    /** Deck locs changed since the boat spawned, in order; viewers catch up by index. */
    locChanges: BoatDeckLoc[];
}

/**
 * Runs boats at sea: allocates their deck scenes, moves them each tick and answers which boat
 * an actor is on. Sync and the boarding rules live elsewhere; this only runs the boats.
 */
export class BoatManager {
    private static readonly boats = new Map<number, ActiveBoat>();
    private static readonly headingListeners: HeadingListener[] = [];
    private static readonly afterTickListeners: Array<() => void> = [];

    /** Whether a tile is in the coordinate space reserved for boat decks. */
    public static isDeckTile(x: number, y: number): boolean {
        return x >= DECK_REGION_BASE * 8 && y >= DECK_REGION_BASE * 8;
    }

    public static spawn(ownerIndex: number, spec: BoatSpec, placement: BoatPlacement): Boat | undefined {
        const entityIndex = BoatManager.allocateEntityIndex();
        if (entityIndex === undefined) return undefined;
        const slot = entityIndex - FIRST_ENTITY_INDEX;
        const boat = new Boat({
            entityIndex,
            configId: spec.configId,
            ownerPlayerId: ownerIndex,
            deckRegionX: DECK_REGION_BASE + (slot % DECK_REGION_COLUMNS) * DECK_REGION_SPACING,
            deckRegionY: DECK_REGION_BASE + Math.floor(slot / DECK_REGION_COLUMNS) * DECK_REGION_SPACING,
            sizeX: spec.sizeX,
            sizeZ: spec.sizeZ,
            hull: spec.hull,
            deckCentreX: spec.deckCentreX,
            deckCentreY: spec.deckCentreY,
            baseSpeed: spec.stats?.baseSpeed,
            ...placement,
        });
        BoatManager.boats.set(entityIndex, { boat, spec, deck: new BoatDeckArea(boat, spec), locChanges: [] });
        return boat;
    }

    public static dispose(boat: Boat): void {
        const active = BoatManager.boats.get(boat.entityIndex);
        if (!active || active.boat !== boat) return;
        BoatManager.boats.delete(boat.entityIndex);
        active.deck.destroy();
    }

    /**
     * Swaps a deck loc (whatever of the same shape is on its tile and level) for another, such
     * as a facility built or removed. Viewers get it from WorldEntitySync.
     */
    public static setDeckLoc(boat: Boat, loc: BoatDeckLoc): void {
        const active = BoatManager.boats.get(boat.entityIndex);
        if (!active || active.boat !== boat) return;
        const replaced = (other: BoatDeckLoc) =>
            other.x === loc.x && other.y === loc.y && other.level === loc.level && other.shape === loc.shape;
        active.spec = { ...active.spec, locs: [...active.spec.locs.filter((other) => !replaced(other)), loc] };
        active.deck.setLoc(loc);
        active.locChanges.push(loc);
    }

    /** How many deck loc changes a boat has had, and those from `since` on. */
    public static deckLocChanges(boat: Boat, since = 0): { count: number; changes: BoatDeckLoc[] } {
        const changes = BoatManager.boats.get(boat.entityIndex)?.locChanges ?? [];
        return { count: changes.length, changes: changes.slice(since) };
    }

    public static getBoat(entityIndex: number): Boat | undefined {
        return BoatManager.boats.get(entityIndex)?.boat;
    }

    public static getSpec(boat: Boat): BoatSpec | undefined {
        return BoatManager.boats.get(boat.entityIndex)?.spec;
    }

    public static getDeck(boat: Boat): BoatDeckArea | undefined {
        return BoatManager.boats.get(boat.entityIndex)?.deck;
    }

    public static all(): Boat[] {
        return Array.from(BoatManager.boats.values(), (active) => active.boat);
    }

    /** The boat whose deck an actor is on, if any. */
    public static getBoatAboard(mobile: Mobile): Boat | undefined {
        const area = mobile.getArea();
        return area instanceof BoatDeckArea && BoatManager.getBoat(area.boat.entityIndex) === area.boat
            ? area.boat
            : undefined;
    }

    /**
     * Where an actor is in the main world: the tile under their deck tile when aboard,
     * otherwise their own tile. Sync range and main-world locs are measured from here.
     */
    public static rootLocation(mobile: Mobile): Location {
        const location = mobile.getLocation();
        const boat = BoatManager.getBoatAboard(mobile);
        if (!boat) return location;
        const tile = boat.deckTileToWorld(location.getX(), location.getY());
        return new Location(tile.x, tile.y, boat.level);
    }

    /**
     * The private area an actor counts as being in for who-sees-whom: a deck counts as the
     * main world, so people aboard and people ashore see each other.
     */
    public static syncArea(mobile: Mobile): PrivateArea | null {
        const area = mobile.getPrivateArea();
        return area?.countsAsMainWorld() ? null : area;
    }

    /** Whether a viewer is shown a boat: any boat, except another player's owner-only one. */
    public static canSeeBoat(viewer: Mobile, boat: Boat): boolean {
        return !boat.ownerOnly || boat.ownerPlayerId === viewer.getIndex?.();
    }

    /** Whether a viewer is shown an actor: not while it stands on a boat the viewer can't see. */
    public static canSeeAboard(viewer: Mobile, actor: Mobile): boolean {
        const boat = BoatManager.getBoatAboard(actor);
        return !boat || BoatManager.canSeeBoat(viewer, boat);
    }

    /** Registers content that reacts to the helm setting a new heading (such as raising sail). */
    public static onHeadingSet(listener: HeadingListener): void {
        BoatManager.headingListeners.push(listener);
    }

    /**
     * Points the boat at a clicked tile if the player is at its helm. Deck clicks are mapped
     * to the world first. The heading snaps to the 16 helm directions.
     */
    public static steerToward(player: Mobile, x: number, y: number): boolean {
        const boat = BoatManager.getBoatAboard(player);
        if (!boat || boat.helmPlayerId !== player.getIndex()) return false;
        const target = boat.containsDeckTile(x, y) ? boat.deckTileToWorld(x, y) : { x, y };
        const heading = boat.helmHeadingToward(target.x, target.y);
        if (heading !== undefined) BoatManager.applyHelmHeading(player, boat, heading);
        return true;
    }

    /** OSRS SetHeading (0-15), sent by the client in place of a click while steering. */
    public static setHelmHeading(player: Mobile, packedHeading: number): void {
        const boat = BoatManager.getBoatAboard(player);
        if (!boat || boat.helmPlayerId !== player.getIndex()) return;
        if (!(packedHeading >= 0 && packedHeading <= 15)) return;
        BoatManager.applyHelmHeading(player, boat, packedHeadingToAngle(packedHeading));
    }

    /** A main-world tile a hull may cover: open water with no solid object on it. */
    public static isSailable(x: number, y: number, level: number): boolean {
        if (level !== 0) return false;
        if (!RegionManager.isWater(new Location(x, y, 0))) return false;
        return (RegionManager.getClipping(x, y, 0, null) & SOLID_OBJECT) === 0;
    }

    /** Runs after every boat has moved each tick. */
    public static onAfterTick(listener: () => void): void {
        BoatManager.afterTickListeners.push(listener);
    }

    public static tick(): void {
        for (const { boat } of BoatManager.boats.values()) {
            tickBoat(boat, BoatManager.isSailable);
        }
        for (const listener of BoatManager.afterTickListeners) listener();
    }

    private static applyHelmHeading(player: Mobile, boat: Boat, heading: number): void {
        boat.heading = heading;
        for (const listener of BoatManager.headingListeners) listener(player, boat);
    }

    private static allocateEntityIndex(): number | undefined {
        for (let index = FIRST_ENTITY_INDEX; index <= LAST_ENTITY_INDEX; index++) {
            if (!BoatManager.boats.has(index)) return index;
        }
        return undefined;
    }
}
