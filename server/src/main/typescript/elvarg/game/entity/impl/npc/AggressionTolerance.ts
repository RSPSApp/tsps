/**
 * OSRS aggression tolerance (https://oldschool.runescape.wiki/w/Tolerance): each player has two
 * 21x21 tolerance regions (10 tiles each way from their centres). Ten minutes spent inside the
 * combined regions makes monsters tolerant of them. Moving outside both drops the older region,
 * keeps the newer one and centres a new region on the tile the player left them on, restarting
 * the ten minutes. Logging out is not leaving, so the state is a persisted player attribute.
 */
export interface ToleranceCentre {
    x: number;
    y: number;
    z: number;
}

export interface ToleranceState {
    older: ToleranceCentre;
    newer: ToleranceCentre;
    /** Ticks spent inside the current regions, up to TOLERANCE_TICKS. */
    ticks: number;
}

interface Tile {
    getX(): number;
    getY(): number;
    getZ(): number;
}

interface AttributeHolder {
    getAttribute(key: string): unknown;
    setAttribute(key: string, value: unknown): unknown;
}

export class AggressionTolerance {
    public static readonly ATTRIBUTE = "npc-aggression:tolerance";
    /** Ten minutes of game ticks. */
    public static readonly TOLERANCE_TICKS = 1000;
    /** A region reaches this many tiles each way from its centre. */
    public static readonly REGION_RADIUS = 10;

    constructor(private readonly holder: AttributeHolder) {}

    public state(): ToleranceState | null {
        const state = this.holder.getAttribute(AggressionTolerance.ATTRIBUTE) as ToleranceState | undefined;
        return state && state.older && state.newer && Number.isFinite(state.ticks) ? state : null;
    }

    /** Once a tick: seed, keep counting inside the regions, or move them and start again. */
    public update(tile: Tile): void {
        const here = { x: tile.getX(), y: tile.getY(), z: tile.getZ() };
        const state = this.state();
        if (!state) {
            this.holder.setAttribute(AggressionTolerance.ATTRIBUTE, { older: here, newer: { ...here }, ticks: 0 });
            return;
        }
        if (AggressionTolerance.within(state.older, here) || AggressionTolerance.within(state.newer, here)) {
            if (state.ticks < AggressionTolerance.TOLERANCE_TICKS) state.ticks++;
            return;
        }
        state.older = state.newer;
        state.newer = here;
        state.ticks = 0;
    }

    /** Monsters that build tolerance have stopped being aggressive towards this player. */
    public finished(): boolean {
        const state = this.state();
        return state != null && state.ticks >= AggressionTolerance.TOLERANCE_TICKS;
    }

    private static within(centre: ToleranceCentre, tile: ToleranceCentre): boolean {
        return centre.z === tile.z
            && Math.abs(centre.x - tile.x) <= AggressionTolerance.REGION_RADIUS
            && Math.abs(centre.y - tile.y) <= AggressionTolerance.REGION_RADIUS;
    }
}
