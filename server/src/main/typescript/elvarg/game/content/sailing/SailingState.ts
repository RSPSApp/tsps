/** A boat's place in fine units (1/128 tile) and its angle. */
export interface BoatAt {
    fineX: number;
    fineY: number;
    level: number;
    angle: number;
}

/** Where an owned boat is. */
export type BoatLocation =
    /**
     * Moored at a dock (a port or mooring point): where it was left when its owner disembarked
     * there, or the dock's mooring (a new or recovered boat).
     */
    | { kind: "docked"; dock: string; at?: BoatAt }
    /**
     * Out at sea with its owner, who logged out aboard; restored when they log in. `dock` is the
     * port it last docked at (its `port` varbit, and where it returns if abandoned).
     */
    | { kind: "at_sea"; fineX: number; fineY: number; level: number; angle: number; dock?: string }
    /** Lost after a teleport, Escape or death at sea; a shipwright must recover it. */
    | { kind: "sunk" };

/** One slot of a boat's cargo hold. */
export interface CargoSlot {
    id: number;
    amount: number;
}

/** A boat's name: three word numbers (1-based, 0 = none) into cache db rows 8545-8547. */
export type BoatName = [number, number, number];

/** A boat's core parts, as tiers (0 = the base tier) into its type's part lists in the cache. */
export interface BoatParts {
    hull: number;
    keel: number;
    sails: number;
    helm: number;
}

export function baseParts(): BoatParts {
    return { hull: 0, keel: 0, sails: 0, helm: 0 };
}

export interface OwnedBoat {
    slot: number;
    type: string;
    name: BoatName;
    hitpoints: number;
    facilities: number[];
    location: BoatLocation;
    /** The cargo hold, by slot; `null` is an empty slot. */
    cargo: (CargoSlot | null)[];
    /** The core parts built on this boat (upgraded or downgraded at a shipyard). */
    parts: BoatParts;
}

export interface SailingState {
    boats: OwnedBoat[];
    /** The boat the player is aboard, or last set sail in. */
    activeBoatSlot: number | null;
    /** Where Escape sends the player: the last gangplank, mooring point or buoy used. */
    returnPoint: { x: number; y: number; z: number } | null;
    /** Tools compartment slots holding their tool; shared by all of the player's boats. */
    tools: number[];
    /** The dock the player last docked at, and the last that was a port (not a mooring point). */
    lastDock: string | null;
    lastStandardDock: string | null;
}

export function emptySailingState(): SailingState {
    return { boats: [], activeBoatSlot: null, returnPoint: null, tools: [], lastDock: null, lastStandardDock: null };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function normalizeAt(raw: any): BoatAt | undefined {
    return finite(raw?.fineX) && finite(raw?.fineY) && finite(raw?.angle)
        ? { fineX: raw.fineX, fineY: raw.fineY, level: finite(raw.level) ? raw.level : 0, angle: raw.angle }
        : undefined;
}

function normalizeLocation(raw: any): BoatLocation {
    if (raw?.kind === "docked" && typeof raw.dock === "string") {
        const at = normalizeAt(raw.at);
        return at ? { kind: "docked", dock: raw.dock, at } : { kind: "docked", dock: raw.dock };
    }
    const atSea = raw?.kind === "at_sea" ? normalizeAt(raw) : undefined;
    if (atSea) {
        return typeof raw.dock === "string" ? { kind: "at_sea", ...atSea, dock: raw.dock } : { kind: "at_sea", ...atSea };
    }
    return { kind: "sunk" };
}

function normalizeName(raw: unknown): BoatName {
    const words = Array.isArray(raw) ? raw : [];
    const word = (index: number) => Number.isInteger(words[index]) && words[index] >= 0 && words[index] <= 255 ? words[index] : 0;
    return [word(0), word(1), word(2)];
}

function normalizeParts(raw: any): BoatParts {
    const tier = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6 ? value as number : 0;
    return { hull: tier(raw?.hull), keel: tier(raw?.keel), sails: tier(raw?.sails), helm: tier(raw?.helm) };
}

function normalizeCargo(raw: unknown): (CargoSlot | null)[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((slot) => Number.isInteger(slot?.id) && slot.id >= 0 && Number.isInteger(slot?.amount) && slot.amount > 0
        ? { id: slot.id, amount: slot.amount }
        : null);
}

/** Reads a saved sailing state, dropping anything malformed. Missing state is empty. */
export function normalizeSailingState(raw: any): SailingState {
    if (!raw || typeof raw !== "object") return emptySailingState();
    const boats: OwnedBoat[] = [];
    for (const boat of Array.isArray(raw.boats) ? raw.boats : []) {
        if (!Number.isInteger(boat?.slot) || typeof boat.type !== "string") continue;
        if (boats.some((existing) => existing.slot === boat.slot)) continue;
        boats.push({
            slot: boat.slot,
            type: boat.type,
            name: normalizeName(boat.name),
            hitpoints: finite(boat.hitpoints) ? boat.hitpoints : 0,
            facilities: Array.isArray(boat.facilities) ? boat.facilities.filter(Number.isInteger) : [],
            location: normalizeLocation(boat.location),
            cargo: normalizeCargo(boat.cargo),
            parts: normalizeParts(boat.parts),
        });
    }
    const active = boats.some((boat) => boat.slot === raw.activeBoatSlot) ? raw.activeBoatSlot : null;
    const point = raw.returnPoint;
    const returnPoint = finite(point?.x) && finite(point?.y) && finite(point?.z)
        ? { x: point.x, y: point.y, z: point.z }
        : null;
    const tools = Array.isArray(raw.tools) ? [...new Set<number>(raw.tools.filter(Number.isInteger))] : [];
    const dockId = (value: unknown) => (typeof value === "string" ? value : null);
    return {
        boats, activeBoatSlot: active, returnPoint, tools,
        lastDock: dockId(raw.lastDock), lastStandardDock: dockId(raw.lastStandardDock),
    };
}
