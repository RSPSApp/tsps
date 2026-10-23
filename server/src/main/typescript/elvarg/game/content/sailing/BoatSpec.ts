import type { BoatHull } from "./Boat";

/** A loc placed on the deck, relative to the boat template zone's south-west tile. */
export interface BoatDeckLoc {
    id: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
    /** Blocks the tile on the deck (facilities); other locs are scenery or sound. */
    blocks?: boolean;
    /** Which ops the client shows (bit 0 is op1), as live's loc_add_change_v2; all when absent. */
    opFlags?: number;
}

/** Everything needed to build a boat of one type. Offsets are relative to the template zone. */
export interface BoatSpec {
    type: string;
    /** The worldentity type the client draws. */
    configId: number;
    /** Source chunk of the boat template in the cache: its south-west zone when it spans several. */
    templateChunkX: number;
    templateChunkY: number;
    /** Deck footprint in tiles (8 per template zone), sent as the world entity size. */
    sizeX: number;
    sizeZ: number;
    hull: BoatHull;
    /**
     * Fine offset of the boat's centre from the template zone's south-west corner:
     * size * 64 plus the worldentity type's base offset. The client uses the same formula.
     */
    deckCentreX: number;
    deckCentreY: number;
    /** Template plane that holds the deck; the deck scene's level 0 reads from it. */
    deckLevel: number;
    /** Walkable deck tiles; every other tile of the deck scene is blocked. */
    walkableDeck: ReadonlyArray<{ x: number; y: number }>;
    /** Where a player lands when boarding. */
    boardingTile: { x: number; y: number };
    locs: ReadonlyArray<BoatDeckLoc>;
    /** Loc adds a fixed ship must send on top of its cache template (dynamic overrides). */
    syncLocs?: ReadonlyArray<BoatDeckLoc>;
    /**
     * Full sail speed in fine units a tick (the hull's base speed; 192 when absent), the hull's
     * speed cap (the trimmed sails' speed) and how long a trim lasts in ticks (the sails').
     */
    stats?: { baseSpeed?: number; speedCap?: number; speedBoostDuration?: number };
}

/** A boat's position in the main world: fine units (1/128 tile) and an angle out of 2048. */
export interface BoatPlacement {
    fineX: number;
    fineY: number;
    level: number;
    angle: number;
}
