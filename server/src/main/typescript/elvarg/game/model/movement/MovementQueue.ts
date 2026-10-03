import { RegionManager } from "../../collision/RegionManager";
import type { Mobile } from "../../entity/impl/Mobile";
import { World } from "../../World";
import { Dueling, DuelRule } from "../../content/Duelling";
import { ObjectDefinition } from "../../definition/ObjectDefinition";
import type { NPC } from "../../entity/impl/npc/NPC";
import { GameObject } from "../../entity/impl/object/GameObject";
import type { Player } from "../../entity/impl/player/Player";
import { Direction, Directions } from "../Direction";
import { Location } from "../Location";
import { Skill } from "../Skill";
import { PathFinder } from "./path/PathFinder";
import { Task } from "../../task/Task";
import { TaskManager } from "../../task/TaskManager";
import { TaskType } from "../../task/TaskType";
import { Misc } from "../../../util/Misc";
import { RandomGen } from "../../../util/RandomGen";
import { TimerKey } from "../../../util/timers/TimerKey";
import { Action } from "../Action";
import { GameConstants } from "../../GameConstants";
import { FastDeque } from "../../../util/FastDeque";
import { ServerPerf } from "../../../util/ServerPerf";
import { Wilderness } from "../../content/wilderness/Wilderness";
import * as fs from "fs";
import * as path from "path";
export class MovementQueue {
    private static readonly BOT_FOLLOW_REPATH_COOLDOWN_MS = 500;

    private static RANDOM: RandomGen = new RandomGen();
    private static LOG_DIR = path.join(process.cwd(), "logs");
    private static LOG_FILE = path.join(MovementQueue.LOG_DIR, "movement.log");
    private static LOG_READY = true;
    private static LOG_ENABLED = false;

    private static log(line: string) {
        if (!MovementQueue.LOG_ENABLED) {
            return;
        }

        const msg = `${new Date().toISOString()} ${line}`;
        console.log(msg);
        try {
            if (!MovementQueue.LOG_READY) {
                fs.mkdirSync(MovementQueue.LOG_DIR, { recursive: true });
                MovementQueue.LOG_READY = true;
            }
            fs.appendFileSync(MovementQueue.LOG_FILE, msg + "\n", { encoding: "utf8" });
        } catch (e) {
            // Ignore file logging errors to avoid cascading issues.
        }
    }

    /**
     * NPC interactions can begin when the player is within this radius of the NPC.
     */
    public static NPC_INTERACT_RADIUS: number = 2;

    /**
     * An enum to represent a Player's Mobility
     */

    /**
         * The maximum size of the queue. If any additional steps are added, they are
         * discarded.
         */
    private static MAXIMUM_SIZE = 100;
    /** An entity flag: steps go straight on, whatever the map's clipping. */
    public static readonly IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";

    /**
     * The character whose walking queue this is.
     */
    private character: Mobile;

    /**
     * The player who owns this MovementQueue (if if applicable)
     */
    private player: Player;

    /**
     * The queue of directions.
     */
    private points: FastDeque<Point> = new FastDeque<Point>();

    /**
     * Whether movement is currently blocked for this Mobile.
     */
    private blockMovement = false;

    /**
     * Are we currently moving?
     */
    private isMoving = false;
    private movedThisCycle = false;
    private lastMoveCycle = -2;
    private blockedByDynamicOccupancy = false;
    private routeEvaluated = false;
    private alternativeRoute = false;
    /**
     * Set when a step toward the head checkpoint was rejected, plus whether an
     * entity was the reason. Both survive beginCycle() so the next cycle's
     * pursuit can decide whether rebuilding the route would achieve anything.
     */
    private stepBlocked = false;
    private stepBlockedByEntity = false;
    private lastSentDestX = Number.MIN_SAFE_INTEGER;
    private lastSentDestY = Number.MIN_SAFE_INTEGER;

    /**
     * Creates a walking queue for the specified character.
     *
     * @param character The character.
     */
    constructor(character: Mobile) {
        this.character = character;

        if (this.character.isPlayer()) {
            this.player = this.character.getAsPlayer();
        }
    }

    /**
         * Checks if we can walk from one position to another.
         *
         * @param deltaX
         * @param deltaY
         * @return
         */
    public canWalk(deltaX: number, deltaY: number): boolean {
        if (!this.getMobility().canMove()) {
            return false;
        }
        if (this.character.getLocation().getZ() == -1) {
            return true;
        }
        return RegionManager.canMovestart(this.character.getLocation(), this.character.getLocation().transform(deltaX, deltaY), this.character.getSize(), this.character.getSize(), this.character.getPrivateArea());
    }

    /**
         * Steps away from a Gamecharacter
         *
         * @param character The gamecharacter to step away from
         */
    public static clippedStep(character: Mobile) {
        let size = character.getSize();
        if (character.getMovementQueue().canWalk(-size, 0))
            character.getMovementQueue().walkStep(-size, 0);
        else if (character.getMovementQueue().canWalk(size, 0))
            character.getMovementQueue().walkStep(size, 0);
        else if (character.getMovementQueue().canWalk(0, -size))
            character.getMovementQueue().walkStep(0, -size);
        else if (character.getMovementQueue().canWalk(0, size))
            character.getMovementQueue().walkStep(0, size);
    }

    public static randomClippedStep(character: Mobile, size: number) {
        let rng = this.RANDOM.getInclusive(1, 4);
        if (rng == 1 && character.getMovementQueue().canWalk(-size, 0))
            character.getMovementQueue().walkStep(-size, 0);
        else if (rng == 2 && character.getMovementQueue().canWalk(size, 0))
            character.getMovementQueue().walkStep(size, 0);
        else if (rng == 3 && character.getMovementQueue().canWalk(0, -size))
            character.getMovementQueue().walkStep(0, -size);
        else if (rng == 4 && character.getMovementQueue().canWalk(0, size))
            character.getMovementQueue().walkStep(0, size);
    }

    public static randomClippedStepNotSouth(character: Mobile, size: number) {
        let rng = this.RANDOM.getInclusive(1, 3);
        if (rng == 1 && character.getMovementQueue().canWalk(-size, 0))
            character.getMovementQueue().walkStep(-size, 0);
        else if (rng == 2 && character.getMovementQueue().canWalk(size, 0))
            character.getMovementQueue().walkStep(size, 0);
        else if (rng == 3 && character.getMovementQueue().canWalk(0, size))
            character.getMovementQueue().walkStep(0, size);
    }

    /**
         * Adds the first step to the queue, attempting to connect the server and client
         * position by looking at the previous queue.
         *
         * @param clientConnectionPosition The first step.
         * @return {@code true} if the queues could be connected correctly,
         * {@code false} if not.
         */
    public addFirstStep(clientConnectionPosition: Location): boolean {
        this.reset();
        this.addSteps(clientConnectionPosition);
        return true;
    }

    /**
         * Adds a step to walk to the queue.
         *
         * @param x       X to walk to
         * @param y       Y to walk to
         */
    public walkStep(x: number, y: number) {
        let position = this.character.getLocation().clone();
        position.setX(position.getX() + x);
        position.setY(position.getY() + y);
        this.addSteps(position);
    }

    /**
         * Adds a step to this MovementQueue.
         *
         * @param x           The x coordinate of this step.
         * @param y           The y coordinate of this step.
         * @param heightLevel
         */
    private addStep(x: number, y: number, heightLevel: number) {
        if (!this.getMobility().canMove()) {
            return;
        }

        if (this.points.length >= MovementQueue.MAXIMUM_SIZE)
            return;

        const last = this.getLast();
        const deltaX = x - last.position.getX();
        const deltaY = y - last.position.getY();
        const direction = Direction.fromDeltas(deltaX, deltaY);
        if (direction != Direction.NONE) {
            const z = heightLevel ?? this.character.getLocation().getZ() ?? 0;
            this.points.push(new Point(new Location(x, y, z), direction));
        }
        MovementQueue.log(`[movement.addStep] ${this.ownerLabel()} step=${x},${y},${heightLevel} dir=${direction} queueSize=${this.points.length}`);
    }

    /**
         * Adds a step to the queue.
         *
         * @param step The step to add.
         */
    public addSteps(step: Location) {
        if (!this.getMobility().canMove()) {
            return;
        }

        const last = this.getLast();
        const x = step.getX();
        const y = step.getY();
        const z = step.getZ() ?? this.character.getLocation().getZ() ?? 0;
        let deltaX = x - last.position.getX();
        let deltaY = y - last.position.getY();
        const max = Math.max(Math.abs(deltaX), Math.abs(deltaY));
        for (let i = 0; i < max; i++) {
            if (deltaX < 0)
                deltaX++;
            else if (deltaX > 0)
                deltaX--;
            if (deltaY < 0)
                deltaY++;
            else if (deltaY > 0)
                deltaY--;
            this.addStep(x - deltaX, y - deltaY, z);
        }
    }

    /** Stores a routefinder turning point without expanding the segment into tiles. */
    public addCheckpoint(position: Location): void {
        if (!this.getMobility().canMove() || this.points.length >= MovementQueue.MAXIMUM_SIZE) {
            return;
        }
        this.points.push(new Point(position.clone(), Direction.NONE));
        if (this.character.isNpc()) World.markNpcCombatActive(this.character.getAsNpc(), true);
    }

    /** Replaces ordinary NPC combat pursuit with one live footprint destination. */
    public setPursuitCheckpoint(position: Location): void {
        this.reset(false);
        this.lastDestX = position.getX();
        this.lastDestY = position.getY();
        this.setRoute(true, false);
        if (!position.equals(this.character.getLocation())) {
            this.addCheckpoint(position);
        }
        this.syncDestinationFlagToRoute();
    }

    /**
         * Determines the Player's Mobility status
         *
         * @return {Mobility} mobility
         */
    public getMobility(): Mobility {
        if (this.character.getTimers().has(TimerKey.FREEZE)) {
            return Mobility.FROZEN_SPELL;
        }

        if (this.character.getTimers().has(TimerKey.STUN)) {
            return Mobility.STUNNED;
        }

        if (this.character.isNeedsPlacement() || this.isMovementBlocked() || this.player?.getForceMovement() != null) {
            return Mobility.INVALID;
        }

        if (this.player != null) {
            // Player related checks

            let playerDueling = this.player.getDueling();
            if (!this.player.getTrading().getButtonDelay().finished() || !playerDueling.getButtonDelay().finished()) {
                return Mobility.BUSY;
            }

            if (playerDueling.inDuel() && playerDueling.getRules()[DuelRule.NO_MOVEMENT.getButtonId()]) {
                return Mobility.DUEL_MOVEMENT_DISABLED;
            }
        }

        return Mobility.MOBILE;
    }

    /**
         * Validates a destination for a given player movement.
         *
         * @param destination The intended/potential destination.
         * @return {boolean} destinationValid
         */
    public checkDestination(destination: Location): boolean {
        if (destination.getZ() < 0) {
            return false;
        }

        if (this.character.getLocation().getZ() !== destination.getZ()) {
            return false;
        }

        if (destination.getX() > 32767 || destination.getX() < 0 || destination.getY() > 32767 || destination.getY() < 0) {
            return false;
        }

        return true;
    }

    public requestWalk(destination: Location): void {
        if (!this.player || this.player.getHitpoints() <= 0) {
            return;
        }
        const mobility = this.getMobility();
        if (!mobility.canMove()) {
            mobility.sendMessage(this.player);
            return;
        }
        if (!this.checkDestination(destination)) {
            return;
        }
        this.reset();
        this.walkToReset();
        PathFinder.calculateWalkRoute(this.player, destination.getX(), destination.getY());
    }

    private getLast(): Point {
        let last = this.points.peekLast();
        if (!last)
            return new Point(this.character.getLocation(), Direction.NONE);
        return last;
    }

    public syncDestinationFlagToRoute(): void {
        if (!this.player || this.player.isPlayerBot?.() === true) {
            return;
        }
        const destination = this.points.peekLast()?.position;
        const x = destination?.getX() ?? 0;
        const y = destination?.getY() ?? 0;
        // Combat re-affirms the route every cycle; only tell the client when the
        // flag actually moves, otherwise this is two packets per fighter per tick.
        if (this.lastSentDestX === x && this.lastSentDestY === y) {
            return;
        }
        this.lastSentDestX = x;
        this.lastSentDestY = y;
        this.player.getPacketSender().sendDestination(x, y);
    }

    public followX = -1;
    public followY = -1;

    /**
     * @return true if the character is moving.
     */
    public isMovings(): boolean {
        return this.isMoving;
    }

    public beginCycle(): void {
        this.movedThisCycle = false;
        this.blockedByDynamicOccupancy = false;
    }

    public didMoveThisCycle(): boolean {
        return this.movedThisCycle;
    }

    public didMovePreviousCycle(): boolean {
        return this.lastMoveCycle === World.getProcessCycle() - 1;
    }

    public wasBlockedByDynamicOccupancy(): boolean {
        return this.blockedByDynamicOccupancy;
    }

    /**
     * True when the last processed cycle could not advance for a reason the route
     * finder can actually see - a shut door, a new wall.
     *
     * Deliberately false when an entity was in the way. Entity-occupancy flags are
     * invisible to both pathfinders and are only tested when the actor is about to
     * step, so rerouting around a blocker would return the identical route and burn
     * a search every cycle. The queue is kept instead, and the actor resumes its
     * original path once the blocker moves.
     */
    public isStepBlocked(): boolean {
        return this.stepBlocked;
    }

    public wasRouteInvalidated(): boolean {
        return this.stepBlocked && !this.stepBlockedByEntity;
    }

    public invalidateDestinationFlagCache(): void {
        this.lastSentDestX = Number.MIN_SAFE_INTEGER;
        this.lastSentDestY = Number.MIN_SAFE_INTEGER;
    }

    public hasPendingWork(): boolean {
        if (this.points.length > 0 || this.isMoving) {
            return true;
        }
        if (this.character.getFollowing() != null) {
            return true;
        }
        return false;
    }

    public process() {
        this.movedThisCycle = false;
        const ownerLabel = this.ownerLabel();
        if (
            this.points.length === 0 &&
            !this.isMoving &&
            this.character.getFollowing() == null
        ) {
            return;
        }

        if (!this.getMobility().canMove()) {
            this.isMoving = false;
            return;
        }

        if (this.character.getFollowing() != null) {
            ServerPerf.measurePhase(
                "movement.process.follow",
                () => this.processFollowing()
            );
        }

        if (this.points.length > 0) {
            MovementQueue.log(`[movement.process] ${ownerLabel} processing ${this.points.length} steps; run=${this.isRunToggled()}`);
        }

        const start = this.character.getLocation();
        let current = start;
        let previous = start;
        let steps = this.isRunToggled() ? 2 : 1;
        let moved = false;
        this.stepBlocked = false;
        this.stepBlockedByEntity = false;

        while (steps-- > 0) {
            while (this.points.peekFirst()?.position.equals(current)) {
                this.points.shift();
            }
            const checkpoint = this.points.peekFirst();
            if (!checkpoint) {
                break;
            }
            const next = ServerPerf.measurePhase(
                "movement.process.step_check",
                () => this.validatedStep(current, checkpoint.position)
            );
            if (!next) {
                MovementQueue.log(`[movement.process] ${ownerLabel} blocked toward ${checkpoint.position.toString()} (checkpoint retained)`);
                this.stepBlocked = true;
                this.stepBlockedByEntity = this.blockedByDynamicOccupancy;
                break;
            }

            const direction = Direction.fromDeltas(
                next.getX() - current.getX(),
                next.getY() - current.getY()
            );
            this.followX = current.getX();
            this.followY = current.getY();
            previous = current;
            current = next;
            this.character.setLocation(next);
            if (!moved) {
                this.character.setWalkingDirection(direction);
            } else {
                this.character.setRunningDirection(direction);
            }
            moved = true;

            if (checkpoint.position.equals(current)) {
                this.points.shift();
            }
        }

        if (this.character.isPlayer()) {
            if (moved) {
                this.handleRegionChange();
                this.syncWildernessStateForMovedPlayer();
                this.drainRunEnergy();
            }
        }

        this.isMoving = moved;
        this.movedThisCycle = moved;
        if (moved) this.lastMoveCycle = World.getProcessCycle();

        if (this.points.length === 0) {
            this.syncDestinationFlagToRoute();
        }

        if (!moved && this.points.length > 0) {
            MovementQueue.log(`[movement.process] ${ownerLabel} did not move; remaining checkpoints ${this.points.length}`);
        }
    }

    private ownerLabel(): string {
        return this.character.isPlayer()
            ? `player:${this.character.getAsPlayer().getUsername()}`
            : `npc:${(this.character as any).getId ? (this.character as any).getId() : "unknown"}`;
    }

    public canWalkTo(next: Location, source: Location = this.character.getLocation()) {
        if (
            next.getZ() !== source.getZ() ||
            !RegionManager.canMovestart(
                source,
                next,
                this.character.getSize(),
                this.character.getSize(),
                this.character.getPrivateArea()
            )
        ) {
            return false;
        }
        if (this.isDynamicallyOccupied(next)) {
            return false;
        }
        return true;
    }

    /**
     * Occupancy the static clipping map cannot know about. A player marks its tile
     * as blocking NPCs but never as blocking players, so NPCs are stopped by both
     * NPCs and players while players walk freely through each other.
     *
     * Upstream splits the two opt-outs (walk-through-NPCs and walk-through-players
     * are separate NPC properties). Pets are this server's only walk-through NPC
     * and need both, so one flag covers it; split canWalkThroughNPCs() if an NPC
     * ever needs to pass NPCs but not players.
     */
    private isDynamicallyOccupied(next: Location): boolean {
        if (this.character.isNpc() && !(this.character as NPC).canWalkThroughNPCs()) {
            const size = this.character.getSize();
            const privateArea = this.character.getPrivateArea();
            if (World.isNpcOccupyingTile(next, this.character as NPC, size, privateArea)) {
                return true;
            }
            if (World.isPlayerOccupyingTile(next, null, size, privateArea)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Diagonal first, then east/west, then north/south - except that only 1x1
     * actors ever take the diagonal. Anything larger squares the corner with a
     * cardinal step instead.
     */
    private validatedStep(source: Location, destination: Location): Location | null {
        const signX = Math.sign(destination.getX() - source.getX());
        const signY = Math.sign(destination.getY() - source.getY());
        // An NPC that moves over what the map blocks (the Inferno's Ancestral Glyph, over the
        // pit before TzKal-Zuk) steps straight on, as OSRS's walk steps without collision.
        if (this.character.hasFlag?.(MovementQueue.IGNORE_CLIPPING_FLAG)) {
            return source.transform(signX, signY);
        }
        const candidates: number[][] = [];
        if (this.character.getSize() === 1 && signX !== 0 && signY !== 0) {
            candidates.push([signX, signY]);
        }
        if (signX !== 0) candidates.push([signX, 0]);
        if (signY !== 0) candidates.push([0, signY]);
        for (const [offsetX, offsetY] of candidates) {
            const next = source.transform(offsetX, offsetY);
            if (this.canWalkTo(next, source)) {
                return next;
            }
            if (next.getZ() === source.getZ() && RegionManager.canMovestart(
                source,
                next,
                this.character.getSize(),
                this.character.getSize(),
                this.character.getPrivateArea()
            ) && this.isDynamicallyOccupied(next)) {
                this.blockedByDynamicOccupancy = true;
            }
        }
        return null;
    }


    public handleRegionChange() {
        const player = (this.character as Player);
        // Make sure lastKnownRegion is always populated to avoid null access during early ticks.
        if (!this.character.getLastKnownRegion()) {
            this.character.setLastKnownRegion(this.character.getLocation().clone());
        }
        const diffX = this.character.getLocation().getX() - this.character.getLastKnownRegion().getRegionX() * 8;
        const diffY = this.character.getLocation().getY() - this.character.getLastKnownRegion().getRegionY() * 8;
        // A plane change keeps the same x/y region, but it swaps the whole set of
        // NPCs/objects visible to the player, so it must refresh the active regions
        // too (otherwise the new floor's NPCs are never sent until a relog).
        let regionChanged = this.character.getLocation().getZ() !== this.character.getLastKnownRegion().getZ();
        if (diffX < 16)
            regionChanged = true;
        else if (diffX >= 88)
            regionChanged = true;
        if (diffY < 16)
            regionChanged = true;
        else if (diffY >= 88)
            regionChanged = true;
        if (regionChanged) {
            this.character.setLastKnownRegion(player.getLocation().clone());
            if (player.isPlayerBot?.() !== true) {
                World.markActiveRegionsDirty();
            }
        }
    }

    private drainRunEnergy() {
        const player = (this.character as Player);
        if (player.isPlayerBot?.() === true) {
            if (player.getRunEnergy() !== 100) {
                player.setRunEnergy(100);
            }
            return;
        }
        if (player.isRunningReturn()) {
            player.setRunEnergy(player.getRunEnergy() - 1);
            if (player.getRunEnergy() <= 0) {
                player.setRunEnergy(0);
                player.setRunning(false);
                player.getPacketSender().sendRunStatus();
            }
            player.getPacketSender().sendRunEnergy();
        }
    }

    private syncWildernessStateForMovedPlayer() {
        const player = this.character as Player;
        if (player.isPlayerBot?.() === true) {
            return;
        }

        const location = player.getLocation();
        const packetSender = player.getPacketSender();
        const inWilderness = Wilderness.isInLocation(location);

        if (inWilderness) {
            const wildernessLevel = Wilderness.levelAt(location.getX(), location.getY());
            const multiIcon = Wilderness.isMulti(location.getX(), location.getY(), location.getZ()) ? 1 : 0;
            player.setWildernessLevel(wildernessLevel);
            player.setMultiIcon(multiIcon);
            // The pvp_icons overlay (and its level text) is owned by the Wilderness plugin.
            packetSender.sendInteractionOption("Attack", 2, true);
            return;
        }

        player.setWildernessLevel(0);
        player.setMultiIcon(0);
        packetSender.sendInteractionOption("null", 2, true);
    }

    public static runEnergyRestoreDelay(p: Player) {
        return 1700 - (p.getSkillManager().getCurrentLevel(Skill.AGILITY) * 10);
    }

    public reset(clearDestination = true): MovementQueue {
        this.points.clear();
        this.followX = -1;
        this.followY = -1;
        this.isMoving = false;
        this.foundRoute = false;
        this.routeEvaluated = false;
        this.alternativeRoute = false;
        this.stepBlocked = false;
        this.stepBlockedByEntity = false;
        if (clearDestination) {
            this.syncDestinationFlagToRoute();
        }
        return this;
    }

    public resetFollow() {
        this.character.setCombatFollowing(null);
        this.character.setFollowing(null);
        this.character.setPositionToFace(null);
    }

    public processFollowing() {
        const following = this.character.getFollowing();
        if (!following) {
            return;
        }
        const nowMs = Date.now();

        // A pet waits out its owner's death and catches up once they respawn.
        const npcCharacter = this.character.isNpc() ? this.character.getAsNpc() : null;
        if (npcCharacter?.isPet() && npcCharacter.getOwner() === following && following.isRegistered()
            && (following.getHitpoints() <= 0 || following.getAsPlayer()?.isDyingReturn?.() === true)) {
            this.reset();
            return;
        }

        if (
            following === this.character ||
            !following.isRegistered() ||
            following.getHitpoints() <= 0 ||
            (following.isPlayer?.() && following.getAsPlayer()?.isDyingReturn?.() === true) ||
            (following.isNpc?.() && following.getAsNpc?.()?.isDyingFunction?.() === true)
        ) {
            this.character.setFollowing(null);
            this.character.setMobileInteraction(null);
            this.character.setPositionToFace(null);
            this.character.setCombatFollowing(null);
            this.reset();
            return;
        }

        if (following.getPrivateArea() != this.character.getPrivateArea()) {
            if (this.tryTeleportPetToFollower(following)) {
                return;
            }
            this.character.setFollowing(null);
            this.character.setMobileInteraction(null);
            this.character.setPositionToFace(null);
            this.reset();
            return;
        }

        // Keep parity with Java follow task behavior for generic following.
        // For pets, OSRS-like behavior is to snap back to the owner when they
        // get too far away.
        const tooFarAway = !following
            .getLocation()
            .isWithinDistance(this.character.getLocation(), GameConstants.PET_FOLLOW_AUTO_TELEPORT_DISTANCE);
        if (tooFarAway && this.tryTeleportPetToFollower(following)) {
            return;
        }

        // Keep parity with Java follow task behavior.
        if (
            following.isTeleportingReturn() ||
            tooFarAway
        ) {
            if (this.tryTeleportPetToFollower(following)) {
                return;
            }
            if (this.character.isPlayer() && following.isPlayer()) {
                this.character.sendMessage(`Unable to find ${following.getAsPlayer().getUsername()}.`);
            }
            this.character.setFollowing(null);
            this.character.setMobileInteraction(null);
            this.character.setPositionToFace(null);
            this.reset();
            return;
        }

        this.character.setMobileInteraction(following);
        this.character.setPositionToFace(following.getLocation());
        if (!this.getMobility().canMove()) {
            return;
        }

        const followerDistance = this.character.calculateDistance(following);
        const leaderQueue = following.getMovementQueue();
        const leaderMoving = leaderQueue.isMovings();
        const destX = leaderQueue.followX;
        const destY = leaderQueue.followY;

        // When not overlapping and already adjacent to a stationary leader,
        // do not re-route; this avoids jittering too close/too far while idle.
        if (followerDistance <= 1 && !leaderMoving && followerDistance !== 0) {
            return;
        }

        let destination: Location | null = null;
        if (destX !== -1 && destY !== -1) {
            destination = new Location(destX, destY, this.character.getLocation().getZ());
        }

        if (
            destination == null ||
            destination.equals(this.character.getLocation()) ||
            followerDistance > 1
        ) {
            destination = this.getClosestFollowTile(following) ?? destination;
        }

        if (
            destination == null ||
            destination.equals(this.character.getLocation())
        ) {
            return;
        }

        // Avoid resetting and rebuilding identical routes each tick for bots.
        if (this.shouldThrottleBotRepath(destination, nowMs)) {
            return;
        }

        this.reset();
        this.markBotRepathScheduled(destination, nowMs);
        PathFinder.calculateWalkRoute(this.character, destination.getX(), destination.getY());
    }

    private getClosestFollowTile(leader: Mobile): Location | null {
        const privateArea = this.character.getPrivateArea();
        const current = this.character.getLocation();
        let bestTile: Location | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const tile of leader.outterTiles()) {
            if (RegionManager.blocked(tile, privateArea)) {
                continue;
            }
            const distance = tile.getDistance(current);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestTile = tile;
            }
        }

        return bestTile;
    }

    private tryTeleportPetToFollower(following: Mobile): boolean {
        if (!this.character.isNpc()) {
            return false;
        }

        const npc = this.character.getAsNpc();
        if (!npc.isPet()) {
            return false;
        }

        const tiles: Location[] = [];
        for (const tile of following.outterTiles()) {
            if (RegionManager.blocked(tile, following.getPrivateArea())) {
                continue;
            }
            tiles.push(tile);
        }

        const destination =
            tiles.length > 0
                ? tiles[Misc.getRandom(tiles.length - 1)]
                : following.getLocation().clone();

        npc.setVisible(false);
        npc.moveTo(destination);
        npc.setVisible(true);
        npc.setArea(following.getArea());
        npc.setPositionToFace(following.getLocation());
        npc.setMobileInteraction(following);
        return true;
    }

    // Gets the size of the queue.
    public size(): number {
        return this.points.length;
    }

    public isRunToggled(): boolean {
        return this.character.isPlayer()
            ? (this.character as Player).isRunningReturn()
            : this.character.getAsNpc().getMovementSteps() > 1;
    }

    public setBlockMovement(blockMovement: boolean): MovementQueue {
        this.blockMovement = blockMovement;
        return this;
    }

    public isMovementBlocked(): boolean {
        return this.blockMovement;
    }

    public lastDestX: number;
    public lastDestY: number;
    public pathX: number;
    public pathY: number;
    private nextBotFollowRepathAt = 0;

    public setPathX(x: number): MovementQueue {
        this.pathX = (this.character.getLocation().getRegionX() * 8) + x;
        return this;
    }

    public setPathY(y: number): MovementQueue {
        this.pathY = (this.character.getLocation().getRegionY() * 8) + y;
        return this;
    }

    private foundRoute: boolean;

    public setRoute(route: boolean, alternative = false) {
        this.routeEvaluated = true;
        this.foundRoute = route;
        this.alternativeRoute = alternative;
    }

    public hasRoute(): boolean {
        return this.foundRoute;
    }

    public wasRouteEvaluated(): boolean {
        return this.routeEvaluated;
    }

    public usedAlternativeRoute(): boolean {
        return this.alternativeRoute;
    }

    public pointsReturn() {
        return this.points.toArray();
    }

    private isBotPlayer(): boolean {
        return this.character.isPlayer() && this.character.getAsPlayer().isPlayerBot();
    }

    private shouldThrottleBotRepath(destination: Location, nowMs: number): boolean {
        if (!this.isBotPlayer() || !destination) {
            return false;
        }
        if (this.lastDestX !== destination.getX() || this.lastDestY !== destination.getY()) {
            return false;
        }
        if (this.points.length > 0) {
            return true;
        }
        return nowMs < this.nextBotFollowRepathAt;
    }

    private markBotRepathScheduled(destination: Location, nowMs: number): void {
        if (!this.isBotPlayer() || !destination) {
            return;
        }
        this.lastDestX = destination.getX();
        this.lastDestY = destination.getY();
        this.nextBotFollowRepathAt =
            nowMs + MovementQueue.BOT_FOLLOW_REPATH_COOLDOWN_MS;
    }

    public walkToGroundItem(pos: Location, action: () => void) {
        this.walkToTile(pos, action, MovementQueue.reachedGroundItem);
    }

    /**
     * Operable distance for a ground item. Standing on the tile always counts.
     * An adjacent tile only counts when this cycle produced no step, which is
     * upstream's `stepsTaken === 0` gate: a click from one tile away still routes
     * onto the item and picks it up on arrival, but a player who cannot close the
     * last square (frozen, blocked) still gets to take it.
     */
    private static reachedGroundItem(entity: Mobile, destination: Location): boolean {
        if (PathFinder.reachedTile(entity, destination)) {
            return true;
        }
        return !entity.getMovementQueue().didMoveThisCycle() &&
            PathFinder.reachedObj(entity, destination);
    }

    /**
     * @param reached decides when the destination counts as arrived at. Defaults to
     *   standing exactly on the tile, which is what a plugin-supplied route
     *   destination wants.
     */
    public walkToTile(
        pos: Location,
        action: () => void,
        reached: (entity: Mobile, destination: Location) => boolean = PathFinder.reachedTile
    ) {
        // Call time, not tick time: only an exact tile match may skip the walk.
        // Anything looser would let an adjacent click resolve without stepping.
        if (PathFinder.reachedTile(this.player, pos)) {
            action();
            return;
        }

        let mobility = this.getMobility();
        if (!mobility.canMove()) {
            mobility.sendMessage(this.player);
            this.reset();
            return;
        }

        if (!this.checkDestination(pos)) {
            this.reset();
            return;
        }

        this.reset();

        this.walkToReset();

        PathFinder.calculateGroundItemRoute(this.player, pos);
        let lastRouteCycle = World.getProcessCycle();
        let reachedDestination = false;

        TaskManager.submit(new MovementTask(this.player.getIndex(), (task: MovementTask) => {
            if (reachedDestination) {
                action?.();
                this.player.getMovementQueue().reset();
                task.stop();
                return;
            }

            if (reached(this.player, pos)) {
                // The interaction resolves on the cycle after arrival.
                reachedDestination = true;
                return;
            }

            const cycle = World.getProcessCycle();
            const hasPath = this.player.getMovementQueue().points.length > 0;
            if ((hasPath && cycle - lastRouteCycle < 2) || (!hasPath && cycle === lastRouteCycle)) {
                return;
            }

            this.player.getMovementQueue().reset();
            lastRouteCycle = cycle;
            PathFinder.calculateGroundItemRoute(this.player, pos);
        }, false));
    }

    public walkToReset() {
        if (this.player == null) {
            return;
        }

        TaskManager.cancelTasks(this.player.getIndex());
        this.player.getCombat().setCastSpell(null);
        this.player.getCombat().reset();
        this.player.getSkillManager().stopSkillable();
        this.resetFollow();
    }

    private buildObjectRouteSpec(object: GameObject) {
        const objectX = object.getLocation().getX();
        const objectY = object.getLocation().getY();
        const type = object.getType();
        const id = object.getId();
        const direction = object.getFace();

        if (type === 10 || type === 11 || type === 22) {
            const def = ObjectDefinition.forId(id);
            const xLength = def.getSizeX();
            const yLength = def.getSizeY();
            const blockingMask = def.getBlockingMask();

            return {
                objectX,
                objectY,
                type,
                id,
                direction,
                routeSize: 0,
                routeXLength: xLength,
                routeYLength: yLength,
                routeDirection: direction,
                routeBlockingMask: blockingMask,
                reachWidth: xLength,
                reachLength: yLength,
                reachAngle: direction,
                reachShape: 10,
                reachBlockAccessFlags: blockingMask,
            };
        }

        return {
            objectX,
            objectY,
            type,
            id,
            direction,
            routeSize: type + 1,
            routeXLength: 0,
            routeYLength: 0,
            routeDirection: direction,
            routeBlockingMask: 0,
            reachWidth: 1,
            reachLength: 1,
            reachAngle: direction,
            reachShape: type,
            reachBlockAccessFlags: 0,
        };
    }

    public walkToEntity(entity: Mobile, runnable?: () => void, range = 1) {
        let mobility = this.getMobility();
        if (!mobility.canMove()) {
            mobility.sendMessage(this.player);
            this.reset();
            return;
        }

        if (!this.checkDestination(entity.getLocation())) {
            this.reset();
            return;
        }

        this.reset();

        this.walkToReset();

        const reached = () => range <= 1 ? PathFinder.reachedEntity(this.player, entity) :
            this.isInteractionTargetValid(entity) && this.player.getLocation().isWithinDistance(entity.getLocation(), range)
            && RegionManager.canProjectileAttack(this.player, this.player.getLocation(), entity.getLocation());
        if (reached()) {
            this.player.setMobileInteraction(entity);
            runnable?.();
            return;
        }

        PathFinder.calculateEntityRoute(this.player, entity);
        if (this.canInteractWithUnreachableNpc(entity)) {
            this.reset();
            this.player.setMobileInteraction(entity);
            runnable?.();
            return;
        }

        let routedX = entity.getLocation().getX();
        let routedY = entity.getLocation().getY();
        TaskManager.submit(new MovementTask(this.player.getIndex(), (task: MovementTask) => {
            if (!this.isInteractionTargetValid(entity)) {
                this.reset();
                task.stop();
                return;
            }
            this.player.setMobileInteraction(entity);

            if (reached()) {
                this.player.getMovementQueue().reset();
                runnable?.();
                task.stop();
                return;
            }

            const queue = this.player.getMovementQueue();
            const location = entity.getLocation();
            // Only the final stretch is rebuilt, and only when the target actually
            // moved - the turning points behind it are still good. A step the clipping
            // map rejected invalidates the corridor wherever we are standing.
            const targetMoved = routedX !== location.getX() || routedY !== location.getY();
            if (queue.size() === 0 || queue.wasRouteInvalidated() || (queue.size() === 1 && targetMoved)) {
                routedX = location.getX();
                routedY = location.getY();
                PathFinder.calculateEntityRoute(this.player, entity);
            }

            if (this.canInteractWithUnreachableNpc(entity)) {
                queue.reset();
                task.stop();
                runnable?.();
                return;
            }
            if (queue.points.length || queue.isMovings()) {
                return;
            }
            queue.reset();
            task.stop();
            this.player.sendMessage("I can't reach that!");
        }));
    }

    /**
     * Re-checks an interaction target mid-walk. A target can despawn, change plane,
     * leave the private area, or change type (an npc or loc transform) while the
     * player is still walking to it; resolving against the stale capture would fire
     * the interaction on something that is no longer there.
     */
    /**
     * Re-checks a loc mid-walk. A loc can be removed or transformed into a different
     * type while the player walks to it (a door opening, a stump replacing a tree),
     * and the captured reference would otherwise still resolve the original action.
     */
    private isInteractionObjectValid(object: GameObject, id: number, type: number): boolean {
        if (!object) return false;
        const location = object.getLocation();
        if (!location || location.getZ() !== this.player.getLocation().getZ()) return false;
        // A map loc (no private area of its own) is shared by the private areas laid over the
        // map, as the click lookup (MapObjects.getPrivateArea) treats it: the Inferno's exit.
        const area = object.getPrivateArea?.() ?? null;
        if (area !== null && area !== this.player.getPrivateArea()) return false;
        return object.getId() === id && object.getType() === type;
    }

    private isInteractionTargetValid(entity: Mobile): boolean {
        return !!entity &&
            entity.isRegistered() &&
            entity.getHitpoints() > 0 &&
            entity.getPrivateArea() === this.player.getPrivateArea() &&
            entity.getLocation().getZ() === this.player.getLocation().getZ();
    }

    public walkToObject(object: GameObject, action: Action) {
        let mobility = this.getMobility();
        if (!mobility.canMove()) {
            mobility.sendMessage(this.player);
            this.reset();
            return;
        }

        if (!this.checkDestination(object.getLocation())) {
            this.reset();
            return;
        }

        this.reset();

        this.walkToReset();

        const routeSpec = this.buildObjectRouteSpec(object);
        const objectX = routeSpec.objectX;
        const objectY = routeSpec.objectY;
        const type = routeSpec.type;
        const id = routeSpec.id;
        const direction = routeSpec.direction;

        const queueObjectRoute = () => PathFinder.calculateObjectRoute(
            this.player,
            routeSpec.routeSize,
            objectX,
            objectY,
            routeSpec.routeXLength,
            routeSpec.routeYLength,
            routeSpec.routeDirection,
            routeSpec.routeBlockingMask
        );

        queueObjectRoute();

        const finalDestinationX = this.player.getMovementQueue().pathX;
        const finalDestinationY = this.player.getMovementQueue().pathY;
        MovementQueue.log(
            `[walkToObject] ${this.ownerLabel()} obj=${id}@${objectX},${objectY},${this.player.getLocation().getZ()} type=${type} face=${direction} route=${this.player.getMovementQueue().hasRoute()} path=${finalDestinationX},${finalDestinationY} queuedSteps=${this.points.length}`
        );

        //System.err.println("RequestedX=" + objectX + " requestedY=" + objectY + " givenX=" + finalDestinationX + " givenY=" + finalDestinationY);

        this.player.setPositionToFace(new Location(objectX, objectY));
        const interactionArea = this.player.getPrivateArea();
        let repathAttempts = 0;
        TaskManager.submit(new MovementTask(this.player.getIndex(), (task) => {
            if (this.player.getPrivateArea() !== interactionArea || !this.isInteractionObjectValid(object, id, type)) {
                this.reset();
                task.stop();
                return;
            }
            // The reach check already respects shape, rotation and access flags.
            // Accept either reachable side, even if the original route ended elsewhere.
            if (this.points.length === 0 && PathFinder.reachedObject(
                this.player,
                objectX,
                objectY,
                routeSpec.reachWidth,
                routeSpec.reachLength,
                routeSpec.reachAngle,
                routeSpec.reachShape,
                routeSpec.reachBlockAccessFlags
            )) {
                // Arrival is not a failed route: operate on the following cycle.
                // No extra arriveDelay here: in OSRS that delay only applies to actions that
                // move you. Banks, tables, shops and NPCs fire the tick after you arrive, which
                // this already does. A global delay would make every one of those a tick slower
                // than OSRS and break tick-based skilling. Ops that move the player get it from
                // the shared climb (Ladders.plugin.js ladders:climbUp/climbDown) or ObstacleRunner.
                if (this.didMoveThisCycle()) return;
                if (objectX === this.player.getLocation().getX() && objectY === this.player.getLocation().getY()) {
                    this.player.setDirection([Direction.WEST, Direction.NORTH, Direction.EAST, Direction.SOUTH][direction]);
                }
                this.pathX = this.player.getLocation().getX();
                this.pathY = this.player.getLocation().getY();
                this.player.setPositionToFace(new Location(objectX, objectY, this.player.getLocation().getZ()));
                task.stop();
                TaskManager.cancelTasks(this.player.getIndex());
                action.execute();
                return;
            }
            if (this.points.length || this.player.getMovementQueue().isMovings()) {
                return;
            }

            if (repathAttempts < 2) {
                repathAttempts++;
                queueObjectRoute();
                if (this.points.length || this.player.getMovementQueue().hasRoute()) {
                    MovementQueue.log(
                        `[walkToObject] ${this.ownerLabel()} repath=${repathAttempts} obj=${id}@${objectX},${objectY} current=${this.player.getLocation().getX()},${this.player.getLocation().getY()}`
                    );
                    return;
                }
            }

            MovementQueue.log(
                `[walkToObject] ${this.ownerLabel()} failed route=${this.player.getMovementQueue().hasRoute()} current=${this.player.getLocation().getX()},${this.player.getLocation().getY()} expected=${finalDestinationX},${finalDestinationY}`
            );
            console.warn("[object-route] unreachable", {
                objectId: id,
                shape: type,
                rotation: direction,
                target: [objectX, objectY],
                player: [this.player.getLocation().getX(), this.player.getLocation().getY(), this.player.getLocation().getZ()],
                routeEnd: [this.pathX, this.pathY],
                accessMask: routeSpec.reachBlockAccessFlags,
                routeInvalidated: this.wasRouteInvalidated(),
                blockedByEntity: this.wasBlockedByDynamicOccupancy(),
            });
            this.player.sendMessage("You can't reach that!");
            task.stop();
            TaskManager.cancelTasks(this.player.getIndex());
        }, false));
    }

    private isAtPointOfFocus(destX: number, destY: number): boolean {
        return this.character.getLocation().getX() === destX && this.character.getLocation().getY() === destY;
    }

    public isAtDestination(): boolean {
        return this.points.length === 0;
    }

    public isWithinEntityInteractionDistance(entityLocation: Location): boolean {
        return this.points.length <= MovementQueue.NPC_INTERACT_RADIUS &&
            this.player.getLocation().getDistance(entityLocation) <= MovementQueue.NPC_INTERACT_RADIUS;
    }

    private canInteractWithUnreachableNpc(entity: Mobile): boolean {
        // Prefer adjacent reach. Counters may leave an NPC visible but no adjacent tile reachable.
        return entity.isNpc() && (this.alternativeRoute || this.points.length === 0) && !this.isMovings() &&
            this.isWithinEntityInteractionDistance(entity.getLocation()) &&
            RegionManager.canProjectileAttack(this.player, this.player.getLocation(), entity.getLocation());
    }

    canMove(): boolean {
        return this == Mobility.MOBILE;
    }

    /**
     * Sends the appropriate message to the player about their (lack of) mobility.
     *
     * @param player The player to send the message to.
     */
    sendMessage(player: Player) {
        if (player == null) {
            return;
        }

        let message: string;

        switch (this) {
            case Mobility.FROZEN_SPELL:
                message = "A magical spell has made you unable to move.";
                break;
            case Mobility.STUNNED:
                message = "You're stunned!";
                break;
            case Mobility.BUSY:
                message = "You cannot do that right now.";
                break;
            case Mobility.DUEL_MOVEMENT_DISABLED:
                message = "Movement has been disabled in this duel!";
                break;
            default:
                // No message associated with this Mobility
                return;
        }

        player.sendMessage(message);
    }
}

class Mobility {
    public static readonly INVALID = new Mobility();
    public static readonly BUSY = new Mobility();
    public static readonly FROZEN_SPELL = new Mobility();
    public static readonly STUNNED = new Mobility();
    public static readonly DUEL_MOVEMENT_DISABLED = new Mobility();
    public static readonly MOBILE = new Mobility();

    /**
     * Determines whether the player is able to move.
     *
     * @return {boolean} canMove
     */

    constructor() { }
    public canMove(): boolean {
        return this === Mobility.MOBILE;
    }

    /**
     * Sends the appropriate message to the player about their (lack of) mobility.
     *
     * @param player The player to send the message to.
     */
    public sendMessage(player: Player): void {
        if (!player) {
            return;
        }

        let message: string;

        switch (this) {
            case Mobility.FROZEN_SPELL:
                message = "A magical spell has made you unable to move.";
                break;
            case Mobility.STUNNED:
                message = "You're stunned!";
                break;
            case Mobility.BUSY:
                message = "You cannot do that right now.";
                break;
            case Mobility.DUEL_MOVEMENT_DISABLED:
                message = "Movement has been disabled in this duel!";
                break;
            default:
                // No message associated with this Mobility
                return;
        }

        player.sendMessage(message);
    }
}


class Point {
    position: Location;
    direction: Direction;

    constructor(position: Location, direction: Direction) {
        this.position = position;
        this.direction = direction;
    }

    toString() {
        return `Point [direction=${this.direction}, position=${this.position}]`;
    }
}


class MovementTask extends Task {
    /**
     * @param immediate run the first reach check at submit time, before this cycle's
     *   movement. True for entity targets, which upstream lets you operate before
     *   moving; false for scenery and ground items, whose op is gated on having
     *   taken no step, so they must never resolve on the click cycle itself.
     */
    constructor(n1: number, private readonly execFunc: (task: MovementTask) => void, immediate = true) {
        super(0, n1, immediate);
        // Ticked from the owner's turn after movement, not from the global task pass.
        this.type = TaskType.WALK_TO;
    }
    execute(): void {
        this.execFunc(this);
    }

}
