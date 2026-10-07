import { PACKED_HEADING_SCALE, angleFromCoordDelta, normalizeAngle } from "./HeadingUtils";

/** A wooden hull's base speed (the raft's), 1.5 tiles a tick: the default full sail speed. */
const WOODEN_HULL_SPEED = 192;

/** Fine units per tile: world entity positions use 1/128-tile precision. */
export const FINE_UNITS_PER_TILE = 128;

export enum BoatMoveMode {
    Stopped = 0,
    Half = 1,
    Full = 2,
    Reverse = 3,
}

/** Hull rectangle in fine units, centred on the boat's position (worldentity type bounds). */
export interface BoatHull {
    offsetX: number;
    offsetY: number;
    width: number;
    length: number;
}

export interface BoatInit {
    entityIndex: number;
    configId: number;
    ownerPlayerId: number;
    /** Chunk coords of the deck scene's centre chunk, where the boat template is copied to. */
    deckRegionX: number;
    deckRegionY: number;
    /** Deck footprint in tiles (the template zone), sent as the world entity size. */
    sizeX: number;
    sizeZ: number;
    hull: BoatHull;
    /**
     * Fine offset from the template zone's south-west corner to the point that sits at the
     * boat's position: size * 64 plus the worldentity type's base offset (the client uses the
     * same formula).
     */
    deckCentreX: number;
    deckCentreY: number;
    /** Full sail speed in fine units a tick. */
    baseSpeed?: number;
    /** World position of the boat's centre in fine units. */
    fineX: number;
    fineY: number;
    level: number;
    angle: number;
}

/**
 * A player-owned boat: a world entity whose deck is its own scene (the deck frame), drawn at a
 * moving position in the main world. Players aboard stand in deck coordinates.
 */
export class Boat {
    readonly entityIndex: number;
    readonly configId: number;
    readonly ownerPlayerId: number;
    /** Shown only to its owner (a boat in the shipyard), with anyone aboard it. */
    ownerOnly = false;
    readonly deckRegionX: number;
    readonly deckRegionY: number;
    readonly sizeX: number;
    readonly sizeZ: number;
    readonly hull: BoatHull;
    readonly deckCentreX: number;
    readonly deckCentreY: number;
    /** Full sail speed in fine units a tick (the hull's base speed); half sail is half. */
    readonly baseSpeed: number;

    fineX: number;
    fineY: number;
    level: number;
    /** Facing, 0-2047 (0 = south, 512 = west, 1024 = north, 1536 = east). */
    angle: number;
    /** Heading the helm is steering toward. */
    heading: number;
    moveMode: BoatMoveMode = BoatMoveMode.Stopped;
    /** Player steering from the helm; their world clicks set the heading. */
    helmPlayerId: number | undefined;
    speedMultiplier = 1;

    constructor(init: BoatInit) {
        this.entityIndex = init.entityIndex;
        this.configId = init.configId;
        this.ownerPlayerId = init.ownerPlayerId;
        this.deckRegionX = init.deckRegionX;
        this.deckRegionY = init.deckRegionY;
        this.sizeX = init.sizeX;
        this.sizeZ = init.sizeZ;
        this.hull = init.hull;
        this.deckCentreX = init.deckCentreX;
        this.deckCentreY = init.deckCentreY;
        this.baseSpeed = init.baseSpeed ?? WOODEN_HULL_SPEED;
        this.fineX = init.fineX;
        this.fineY = init.fineY;
        this.level = init.level;
        this.angle = init.angle;
        this.heading = init.angle;
    }

    get tileX(): number {
        return Math.floor(this.fineX / FINE_UNITS_PER_TILE);
    }

    get tileY(): number {
        return Math.floor(this.fineY / FINE_UNITS_PER_TILE);
    }

    /** South-west tile of the deck scene (13x13 chunks centred on the deck region). */
    get sceneBaseX(): number {
        return (this.deckRegionX - 6) * 8;
    }

    get sceneBaseY(): number {
        return (this.deckRegionY - 6) * 8;
    }

    /** South-west tile of the boat template zone inside the deck scene. */
    get deckBaseX(): number {
        return this.deckRegionX * 8;
    }

    get deckBaseY(): number {
        return this.deckRegionY * 8;
    }

    /** The boat's own main-world tile: where its world entity is, the tile its fine position lies in. */
    worldTile(): { x: number; y: number; level: number } {
        return {
            x: Math.floor(this.fineX / FINE_UNITS_PER_TILE),
            y: Math.floor(this.fineY / FINE_UNITS_PER_TILE),
            level: this.level,
        };
    }

    /** Main-world tile under the centre of a deck tile, given the boat's position and angle. */
    deckTileToWorld(x: number, y: number): { x: number; y: number } {
        const localX = (x - this.deckBaseX) * FINE_UNITS_PER_TILE + 64 - this.deckCentreX;
        const localY = (y - this.deckBaseY) * FINE_UNITS_PER_TILE + 64 - this.deckCentreY;
        const radians = (this.angle * Math.PI) / 1024;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const wx = this.fineX + localX * cos + localY * sin;
        const wy = this.fineY + localY * cos - localX * sin;
        return {
            x: Math.floor(wx / FINE_UNITS_PER_TILE),
            y: Math.floor(wy / FINE_UNITS_PER_TILE),
        };
    }

    /**
     * Helm heading from the boat's exact position to the centre of a main-world tile, snapped
     * to the 16 helm directions. Undefined when the tile is under the boat's centre.
     */
    helmHeadingToward(tileX: number, tileY: number): number | undefined {
        const dx = tileX * FINE_UNITS_PER_TILE + FINE_UNITS_PER_TILE / 2 - this.fineX;
        const dy = tileY * FINE_UNITS_PER_TILE + FINE_UNITS_PER_TILE / 2 - this.fineY;
        if (Math.abs(dx) < FINE_UNITS_PER_TILE / 2 && Math.abs(dy) < FINE_UNITS_PER_TILE / 2) {
            return undefined;
        }
        const angle = angleFromCoordDelta(dx, dy);
        return normalizeAngle(Math.round(angle / PACKED_HEADING_SCALE) * PACKED_HEADING_SCALE);
    }

    containsDeckTile(x: number, y: number): boolean {
        const lx = x - this.sceneBaseX;
        const ly = y - this.sceneBaseY;
        return lx >= 0 && lx < 104 && ly >= 0 && ly < 104;
    }
}
