import { CombatFactory } from "../../../content/combat/CombatFactory";
import { PathFinder } from "../../../model/movement/path/PathFinder"
import { NPC } from "./NPC";
import { World } from "../../../World";

export class NPCMovementCoordinator {
    private static readonly RETREAT_REPATH_COOLDOWN_MS = 600;
    private npc: NPC;
    private coordinateState: CoordinateState;
    private radius: number;
    private nextRetreatRepathAt: number;


    constructor(npc: NPC) {
        this.npc = npc;
        this.coordinateState = CoordinateState.HOME;
        this.radius = 0;
        this.nextRetreatRepathAt = 0;
    }

    public process() {
        if (this.radius == 0) {
            if (this.coordinateState == CoordinateState.HOME) {
                return;
            }
        }

        if (!this.npc.getMovementQueue().getMobility().canMove()) {
            return;
        }

        this.updateCoordinator();

        switch (this.coordinateState) {
            case CoordinateState.HOME:
                if (CombatFactory.inCombat(this.npc)) {
                    return;
                }
                if (this.npc.getInteractingMobile() != null) {
                    return;
                }
                const queue = this.npc.getMovementQueue();
                // A blocked step keeps its checkpoint forever; drop it so the NPC can roll a new wander.
                if (queue.isStepBlocked()) {
                    queue.reset();
                }
                // Ref: https://osrs-docs.com/docs/mechanics/random-walk/ - HD clients roll 10/1000 per
                // client tick (30 per server tick), ~26% per server tick, and NPCs re-roll mid-walk.
                // Only in active regions, so NPCs nobody can see finish their walk and go back to sleep.
                if (World.isLocationActive(this.npc.getLocation()) && Math.random() < 0.26) {
                    this.wander();
                }
                break;
            case CoordinateState.RETREATING:
            case CoordinateState.AWAY:
                this.processRetreatingMovement();
                break;
        }
    }

    private processRetreatingMovement(): void {
        const spawn = this.npc.getSpawnPosition();
        const current = this.npc.getLocation();
        if (current.equals(spawn)) {
            this.coordinateState = CoordinateState.HOME;
            this.nextRetreatRepathAt = 0;
            return;
        }

        const movementQueue = this.npc.getMovementQueue();
        const retreatRouteActive =
            movementQueue.lastDestX === spawn.getX()
            && movementQueue.lastDestY === spawn.getY()
            && (movementQueue.size() > 0 || movementQueue.isMovings());
        if (retreatRouteActive) {
            return;
        }

        const nowMs = Date.now();
        if (nowMs < this.nextRetreatRepathAt) {
            return;
        }
        this.nextRetreatRepathAt = nowMs + NPCMovementCoordinator.RETREAT_REPATH_COOLDOWN_MS;
        PathFinder.calculateWalkRoute(this.npc, spawn.getX(), spawn.getY());
    }

    public updateCoordinator() {
        if (CombatFactory.inCombat(this.npc)) {
            if (this.coordinateState == CoordinateState.AWAY) {
                this.coordinateState = CoordinateState.RETREATING;
            }
            if (this.coordinateState == CoordinateState.RETREATING) {
                if (this.npc.getLocation().equals(this.npc.getSpawnPosition())) {
                    this.coordinateState = CoordinateState.HOME;
                }
                this.npc.getCombat().reset();
            }
            return;
        }

        let deltaX;
        let deltaY;

        if (this.npc.getSpawnPosition().getX() > this.npc.getLocation().getX()) {
            deltaX = this.npc.getSpawnPosition().getX() - this.npc.getLocation().getX();
        } else {
            deltaX = this.npc.getLocation().getX() - this.npc.getSpawnPosition().getX();
        }

        if (this.npc.getSpawnPosition().getY() > this.npc.getLocation().getY()) {
            deltaY = this.npc.getSpawnPosition().getY() - this.npc.getLocation().getY();
        } else {
            deltaY = this.npc.getLocation().getY() - this.npc.getSpawnPosition().getY();
        }

        if ((deltaX > this.radius) || (deltaY > this.radius)) {
            this.coordinateState = CoordinateState.AWAY;
        } else {
            this.coordinateState = CoordinateState.HOME;
            this.nextRetreatRepathAt = 0;
        }
    }

    private wander() {
        const spawn = this.npc.getSpawnPosition();
        const dx = Math.round(Math.random() * this.radius * 2 - this.radius);
        const dy = Math.round(Math.random() * this.radius * 2 - this.radius);
        const dest = spawn.clone().add(dx, dy);
        if (!dest.equals(this.npc.getLocation())) {
            this.npc.getMovementQueue().reset();
            this.npc.getMovementQueue().addSteps(dest);
        }
    }

    public getCoordinateState(): CoordinateState {
        return this.coordinateState;
    }

    public setCoordinateState(coordinateState: CoordinateState) {
        this.coordinateState = coordinateState;
    }

    public getRadius(): number {
        return this.radius;
    }

    public setRadius(radius: number) {
        this.radius = radius;
    }
}
export enum CoordinateState {
    HOME,
    AWAY,
    RETREATING
}
