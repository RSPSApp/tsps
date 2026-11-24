import { packWorldPoint, unpackWorldX, unpackWorldY, unpackWorldPlane } from "../shortestpath/WorldPointUtil";
import type { PathSearchBackend } from "../shortestpath/pathfinder/PathSearch";
import type { PathStep } from "../shortestpath/pathfinder/NodeGraph";
import { distanceTo, type DistantSpawn, type Tile } from "./DistantWorldState";

export interface ApproachIntent { spawn: DistantSpawn; action?: string; actionIndex?: number; examine?: boolean }

/** Sends ordinary, short walking requests. Only server-confirmed positions advance the route. */
export class DistantApproach {
    intent?: ApproachIntent;
    private generation = 0;
    private cancelSearch?: () => void;
    private path: PathStep[] = [];
    private cursor = 0;
    private waypoint?: Tile;
    private last?: Tile;
    private started = 0;
    private progress = 0;
    private lastResolve = -Infinity;
    private resolving = false;

    constructor(private readonly deps: {
        enabled(): boolean;
        backend(): PathSearchBackend;
        position(): Tile | undefined;
        walk(x: number, y: number): void;
        stop(): void;
        resolve(intent: ApproachIntent): void;
        status(text: string): void;
        now(): number;
    }) {}

    cancel(message?: string, stop = false): void {
        const active = !!this.intent;
        this.generation++;
        this.cancelSearch?.(); this.cancelSearch = undefined;
        this.intent = undefined; this.path = []; this.waypoint = undefined; this.resolving = false;
        if (active && stop) this.deps.stop();
        if (message) this.deps.status(message);
    }

    async begin(intent: ApproachIntent): Promise<void> {
        if (!this.deps.enabled()) {
            this.cancel(undefined, true); return;
        }
        this.cancel();
        const player = this.deps.position();
        if (!player || player.plane !== intent.spawn.plane) return;
        this.intent = intent; this.started = this.progress = this.deps.now(); this.last = player; this.cursor = 0;
        const generation = this.generation;
        this.lastResolve = -Infinity;
        this.deps.status(`Finding a route to ${intent.spawn.name}…`);
        try {
            const backend = this.deps.backend();
            await backend.ready;
            if (generation !== this.generation) return;
            this.cancelSearch = backend.search({
                start: packWorldPoint(player.x, player.y, player.plane),
                targets: [packWorldPoint(intent.spawn.x, intent.spawn.y, intent.spawn.plane)],
                transports: [], transportDestinations: [], avoidWilderness: true,
                unreachableTargetDistance: 1, collisionAwareBlockedTargets: true, calculationCutoffMillis: 2000,
            }, { progress() {}, done: result => {
                if (generation !== this.generation) return;
                this.cancelSearch = undefined;
                if (!result.reached || result.path.some(s => s.transport >= 0)) {
                    this.cancel("No walking route. Doors and transports may need manual travel."); return;
                }
                this.path = result.path;
                this.progress = this.deps.now();
                this.deps.status(`Approaching ${intent.spawn.name}`);
            } });
        } catch { if (generation === this.generation) this.cancel("The walking map could not be loaded."); }
    }

    tick(viewDistance: number): void {
        const intent = this.intent;
        if (!intent) return;
        if (!this.deps.enabled()) {
            this.cancel("Approach and interact disabled.", true); return;
        }
        const player = this.deps.position(), now = this.deps.now();
        if (!player || player.plane !== intent.spawn.plane || (this.last && distanceTo(player, this.last) > 12)) {
            this.cancel("Approach cancelled after a map change.", true); return;
        }
        if (this.last && distanceTo(player, this.last) > 0) { this.progress = now; this.last = player; }
        if (now - this.started > 900000 || now - this.progress > 12000) {
            this.cancel("Approach stopped because no progress was made.", true); return;
        }
        if (distanceTo(player, intent.spawn) <= Math.max(2, viewDistance - 3) && now - this.lastResolve >= 1500) {
            this.lastResolve = now; this.resolving = true;
            this.deps.resolve(intent);
        }
        if (!this.path.length || this.waypoint && distanceTo(player, this.waypoint) > 1) return;
        // Find progress along the path, then send at most 24 steps to the server pathfinder.
        let best = this.cursor, distance = Infinity;
        for (let i = this.cursor; i < Math.min(this.path.length, this.cursor + 64); i++) {
            const step = tile(this.path[i]); const d = distanceTo(player, step);
            if (d < distance) { best = i; distance = d; }
        }
        if (distance > 4) { this.cancel("Approach stopped after leaving the route.", true); return; }
        this.cursor = best;
        const next = Math.min(this.path.length - 1, best + 24);
        if (next === best) {
            if (!this.resolving && !intent.action && !intent.examine) this.cancel("Arrived at the known spawn location.");
            // Give NPC replication a few ticks to arrive, then stop without guessing an index.
            if (now - this.progress > 3500) this.cancel("No unique real NPC is available at this spawn.", true);
            return;
        }
        this.waypoint = tile(this.path[next]);
        this.deps.walk(this.waypoint.x, this.waypoint.y);
    }
}

function tile(step: PathStep): Tile {
    return { x: unpackWorldX(step.packed), y: unpackWorldY(step.packed), plane: unpackWorldPlane(step.packed) };
}
