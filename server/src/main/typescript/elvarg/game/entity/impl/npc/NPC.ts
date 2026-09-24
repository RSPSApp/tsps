import { CacheDefinitions } from "../../../cache/CacheDefinitions";
import { Mobile } from "../Mobile";
import { Sound } from "../../../Sound";
import { World } from "../../../World";
import { CombatFactory } from "../../../content/combat/CombatFactory";
import { CombatType } from "../../../content/combat/CombatType";
import { PendingHit } from "../../../content/combat/hit/PendingHit";
import { CombatMethod } from "../../../content/combat/method/CombatMethod";
import { NpcDefinition } from "../../../definition/NpcDefinition";
import { CoordinateState, NPCMovementCoordinator } from "./NPCMovementCoordinator";
import type { Player } from "../player/Player";
import { FacingDirection } from "../../../model/FacingDirection";
import { Direction } from "../../../model/Direction";
import { Ids } from "../../../model/Ids";
import { Location } from "../../../model/Location";
import { AreaManager } from "../../../model/areas/AreaManager";
import { TaskManager } from "../../../task/TaskManager";
import { NPCDeathTask } from "../../../task/impl/NPCDeathTask"
import { Wilderness } from "../../../content/wilderness/Wilderness";
import { MovementQueue } from "../../../model/movement/MovementQueue";
import { GameConstants } from "../../../GameConstants";
import { Animation } from "../../../model/Animation";
import { PluginManager } from "../../../../plugins/PluginManager";

export class NPC extends Mobile {
    private static sameLocation(a: Location | null | undefined, b: Location | null | undefined): boolean {
        if (a == null && b == null) {
            return true;
        }
        if (a == null || b == null) {
            return false;
        }
        return a.equals(b);
    }

    private static formatLocation(location: Location | null | undefined): string {
        if (location == null) {
            return "null";
        }
        return `${location.getX()},${location.getY()},${location.getZ()}`;
    }

    private interactingMobileForLog(): string {
        const interactingMobile = this.getInteractingMobile();
        if (interactingMobile == null) {
            return "none";
        }
        if (typeof interactingMobile.isPlayer === "function" && interactingMobile.isPlayer()) {
            const username = interactingMobile.getAsPlayer?.()?.getUsername?.() ?? "unknown";
            return `player:${username}#${interactingMobile.getIndex?.() ?? "?"}`;
        }
        if (typeof interactingMobile.isNpc === "function" && interactingMobile.isNpc()) {
            const npcId = interactingMobile.getAsNpc?.()?.getId?.() ?? "?";
            return `npc:${npcId}#${interactingMobile.getIndex?.() ?? "?"}`;
        }
        return "unknown";
    }

    private resolveFaceChangeReason(reason?: string): string {
        if (reason) {
            return reason;
        }
        const stack = new Error().stack;
        if (!stack) {
            return "unspecified";
        }
        const frames = stack
            .split("\n")
            .slice(1)
            .map((line) => line.trim())
            .filter((line) => !line.includes(".setPositionToFace") && !line.includes("resolveFaceChangeReason"));
        return frames[0] ?? "unspecified";
    }

    public setPositionToFace(positionToFace: Location, reason?: string): NPC {
        const previousFaceTarget = this.getPositionToFace?.() ?? null;
        super.setPositionToFace(positionToFace);
        if (!GameConstants.DEBUG_NPC_FACE_POSITION_CHANGES) {
            return this;
        }
        if (NPC.sameLocation(previousFaceTarget, positionToFace)) {
            return this;
        }
        const npcName = this.getCurrentDefinition()?.getName?.() ?? "unknown";
        const activeTarget = this.interactingMobileForLog();
        console.info(
            `[npc.face] idx=${this.getIndex()} id=${this.getId()} name=${npcName} npcLoc=${NPC.formatLocation(this.getLocation())} old=${NPC.formatLocation(previousFaceTarget)} new=${NPC.formatLocation(positionToFace)} target=${activeTarget} reason=${this.resolveFaceChangeReason(reason)}`
        );
        return this;
    }

    getSize(): number {
        return this.size();
    }
    private id: number;
    private movementCoordinator: NPCMovementCoordinator = new NPCMovementCoordinator(this);
    private hitpoints: number;
    private spawnPosition: Location;
    private headIcon = -1;
    private isDying: boolean;
    private owner: Player;
    private visible: boolean = true;
    private face: FacingDirection = FacingDirection.SOUTH;
    private pet: boolean;
    private movementSteps = 1;

    constructor(id: number, position: Location) {
        super(position)
        this.id = id;
        this.spawnPosition = position.clone();

        if (this.getDefinition() == null) {
            this.setHitpoints(this.hitpoints = 10);
        } else {
            this.setHitpoints(this.getDefinition().getHitpoints());
        }
    }
    private static NPC_IMPLEMENTATION_MAP: Map<number, any>;

    /**
     * Creates a new {@link NPC}.
     * @param id
     * @param location
     * @return
     */
    public static create(id: number, location: Location) {
        let implementationClass = NPC.NPC_IMPLEMENTATION_MAP.get(id);
        if (implementationClass != null) {
            // If this NPC has been implemented by its own class, instantiate that first
            try {
                return new implementationClass(id, location);
            } catch (e) {
                console.log(e);
            }
        }

        return new NPC(id, location);
    }

    /**
     * Can this npc walk through other NPCs?
     * @return
     */
    public canWalkThroughNPCs(): boolean {
        if (this.pet) {
            return true;
        }
        return false;
    }

    public NPC(id: number, position: Location) {
        this.id = id;
        this.spawnPosition = position.clone();

        if (this.getDefinition() == null) {
            this.setHitpoints(10);
        } else {
            this.setHitpoints(this.getDefinition().getHitpoints());
        }
    }

    public onAdd() {
        const spawnAnim = this.getCurrentDefinition().getSpawnAnim();
        if (Number.isInteger(spawnAnim) && spawnAnim >= 0) {
            this.performAnimation(new Animation(spawnAnim));
        }
    }

    public onRemove() {

    }

    public isAggressiveTo(player: Player): boolean {
        return player.getSkillManager().getCombatLevel() <= (this.getCurrentDefinition().getCombatLevel() * 2)
            || Wilderness.isIn(player);
    }

    public aggressionDistance(): number {
        let attackDistance = CombatFactory.getMethod(this).attackDistance(this);

        return Math.max(attackDistance, 3);
    }

    public process() {
        if (this.getDefinition() != null) {
            // Queued impacts land before this NPC acts - see HitQueue.process.
            this.getCombat().getHitQueue().process(World.getProcessCycle());
            this.getTimers().process();
            const movement = this.getMovementQueue();
            const combat = this.getCombat();
            movement.beginCycle();
            this.movementCoordinator.process();
            const processCombat = combat.hasPendingWork();
            if (processCombat) {
                combat.preMovementProcess();
            }
            if (movement.hasPendingWork()) {
                movement.process();
            }
            if (processCombat) {
                combat.postMovementProcess();
            }

            const interactingMobile = this.getInteractingMobile();
            if (interactingMobile != null) {
                const interactionLocation = interactingMobile.getLocation?.();
                const outOfRange =
                    interactionLocation != null
                    && this.getLocation().getDistance(interactionLocation) > MovementQueue.NPC_INTERACT_RADIUS;
                // Keep interaction/facing active when this NPC is intentionally tracking
                // the same target via follow/combat. Without this guard, pets can oscillate:
                // follow sets face-to-player, then NPC.process clears interaction for range
                // and resets face back to spawn direction in the same cycle.
                const trackingInteractionTarget =
                    this.getFollowing() === interactingMobile
                    || this.getCombatFollowing() === interactingMobile
                    || this.getCombat().getTarget() === interactingMobile;
                const targetUnregistered =
                    typeof interactingMobile.isRegistered === "function"
                    && !interactingMobile.isRegistered();
                const clearInteraction =
                    targetUnregistered
                    || interactionLocation == null
                    || (outOfRange && !trackingInteractionTarget);

                if (clearInteraction) {
                    const clearReason =
                        targetUnregistered
                            ? "target_unregistered"
                            : interactionLocation == null
                                ? "missing_target_location"
                                : "out_of_range";
                    this.setMobileInteraction(null);
                    if (this.movementCoordinator.getRadius() === 0) {
                        // OSRS-like behavior for stationary NPCs: after an interaction ends,
                        // they return to their spawn-facing idle direction instead of
                        // keeping the last player-facing orientation.
                        // Ref: https://oldschool.runescape.wiki/w/Wander_radius
                        const facingDirection = this.getFace().getDirection();
                        this.setPositionToFace(
                            this.getLocation().clone().add(facingDirection.getX(), facingDirection.getY()),
                            `clear_interaction_stationary_reset_to_spawn_facing:${clearReason}`
                        );
                    } else {
                        this.setPositionToFace(null, `clear_interaction_mobile_clear_face_target:${clearReason}`);
                    }
                }
            }

            AreaManager.process(this);
            if (this.getCombat().getLastAttack().hasElapsed(20000)
                || this.movementCoordinator.getCoordinateState() == CoordinateState.RETREATING) {
                if (this.getDefinition().getHitpoints() > this.hitpoints) {
                    this.setHitpoints(this.hitpoints + (this.getDefinition().getHitpoints() * 0.1));
                    if (this.hitpoints > this.getDefinition().getHitpoints()) {
                        this.setHitpoints(this.getDefinition().getHitpoints());
                    }
                }
            }
        }
    }

    public getPlayersWithinDistance(distance: number): Player[] {
        let list: Player[] = [];
        for (let player of World.getPlayers()) {
            if (player == null) {
                continue;
            }
            if (player.getPrivateArea() != this.getPrivateArea()) {
                continue;
            }
            if (player.getLocation().getDistance(this.getLocation()) <= distance) {
                list.push(player);
            }
        }
        return list;
    }

    public appendDeath() {
        if (!this.isDying) {
            if (PluginManager.emitNpcBeforeDeath({ npc: this, preventDeath: false })) {
                return;
            }
            TaskManager.submit(new NPCDeathTask(this));
            this.isDying = true;
        }
    }

    public getHitpoints(): number {
        return this.hitpoints;
    }

    public setHitpoints(hitpoints: number): NPC {
        this.hitpoints = hitpoints;
        if (this.hitpoints <= 0)
            this.appendDeath();
        return this;
    }

    public heal(heal: number) {
        if ((this.hitpoints + heal) > this.getDefinition().getHitpoints()) {
            this.setHitpoints(this.getDefinition().getHitpoints());
            return;
        }
        this.setHitpoints(this.hitpoints + heal);
    }

    public isNpc(): boolean {
        return true;
    }

    public equals(other: Object): boolean {
        return other instanceof NPC && (other as NPC).getIndex() == this.getIndex() && (other as NPC).getId() == this.getId();
    }

    public size(): number {
        return this.getCurrentDefinition() == null ? 1 : this.getCurrentDefinition().getSize();
    }

    public getBaseAttack(type: CombatType): number {
        if (type === CombatType.RANGED) {
            return this.getCurrentDefinition().getStats()[3];
        } else if (type === CombatType.MAGIC) {
            return this.getCurrentDefinition().getStats()[4];
        }

        return this.getCurrentDefinition().getStats()[1];
        // 0 = attack
        // 1 = strength
        // 2 = defence
        // 3 = range
        // 4 = magic
    }

    public getBaseDefence(type: CombatType): number {
        let base = 0;
        switch (type) {
            case CombatType.MAGIC:
                base = this.getCurrentDefinition().getStats()[13];
                break;
            case CombatType.MELEE:
                base = this.getCurrentDefinition().getStats()[10];
                break;
            case CombatType.RANGED:
                base = this.getCurrentDefinition().getStats()[14];
                break;
        }
        // 10,11,12 = melee
        // 13 = magic
        // 14 = range
        return base;
    }

    public getBaseAttackSpeed(): number {
        return this.getCurrentDefinition().getAttackSpeed();
    }

    public getMovementSteps(): number {
        return this.movementSteps;
    }

    public setMovementSteps(steps: number): NPC {
        this.movementSteps = Math.max(1, Math.min(2, steps | 0));
        return this;
    }

    public getAttackAnim(): number {
        return this.getCurrentDefinition().getAttackAnim();
    }

    public getAttackSound(): Sound {
        return Sound.NPC_ATTACKING;
    }

    public getBlockAnim(): number {
        return this.getCurrentDefinition().getDefenceAnim();
    }

    /*
     * Getters and setters
     */

    public getId(): number {
        if (this.getNpcTransformationId() !== -1) {
            return this.getNpcTransformationId();
        }
        return this.id;
    }

    public getRealId(): number {
        return this.id;
    }

    public isVisible(): boolean {
        return this.visible;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public isDyingFunction(): boolean {
        return this.isDying;
    }

    public setDying(isDying: boolean): void {
        this.isDying = isDying;
    }

    public getOwner(): Player {
        return this.owner;
    }

    public setOwner(owner: Player): NPC {
        this.owner = owner;
        return this;
    }

    public getMovementCoordinator(): NPCMovementCoordinator {
        return this.movementCoordinator;
    }

    /**
     * Gets the current Definition, subject to current NPC transformation.
     *
     * @return
     */
    public getCurrentDefinition(player?: Player): NpcDefinition {
        const id = this.getNpcTransformationId() !== -1 ? this.getNpcTransformationId() : this.id;
        if (!player) return NpcDefinition.forId(id);
        const resolved = CacheDefinitions.resolveNpc(id, player.getPacketSender());
        return resolved ? NpcDefinition.forId(resolved.id) : undefined;
    }

    /**
     * Gets the base definition for this NPC, regardless of NPC transformation etc.
     *
     * @return
     */
    public getDefinition(): NpcDefinition {
        return NpcDefinition.forId(this.id);
    }

    public getSpawnPosition(): Location {
        return this.spawnPosition;
    }

    public getHeadIcon(): number {
        return this.headIcon;
    }

    public setHeadIcon(headIcon: number): void {
        this.headIcon = headIcon;
        // getUpdateFlag().flag(Flag.NPC_APPEARANCE);
    }

    public getCombatMethod(): CombatMethod {
        // Style comes from the monster dump's attack_type. Per-NPC behaviour is still
        // overridable by a class in entity.impl.npc.impl or a plugin combat-method
        // provider - CombatFactory.getMethod() consults those first.
        switch (this.getCurrentDefinition().getAttackType()) {
            case CombatType.RANGED:
                return CombatFactory.RANGED_COMBAT;
            case CombatType.MAGIC:
                return CombatFactory.MAGIC_COMBAT;
            default:
                return CombatFactory.MELEE_COMBAT;
        }
    }

    public clone(): NPC {
        const npc = NPC.create(this.getId(), this.getSpawnPosition());
        npc.setFace(this.getFace());
        npc.getMovementCoordinator().setRadius(this.getMovementCoordinator().getRadius());
        return npc;
    }

    public getFace(): FacingDirection {
        return this.face;
    }

    private static toFacingDirection(face: FacingDirection | Direction | number): FacingDirection {
        if (face instanceof FacingDirection) {
            return face;
        }
        const direction =
            face instanceof Direction
                ? face
                : Direction.valueOf(Number.isInteger(face) ? face : Direction.SOUTH.getId());
        switch (direction.getId()) {
            case 0:
                return FacingDirection.NORTH_WEST;
            case 1:
                return FacingDirection.NORTH;
            case 2:
                return FacingDirection.NORTH_EAST;
            case 3:
                return FacingDirection.WEST;
            case 4:
                return FacingDirection.EAST;
            case 5:
                return FacingDirection.SOUTH_WEST;
            case 6:
                return FacingDirection.SOUTH;
            case 7:
                return FacingDirection.SOUTH_EAST;
            default:
                return FacingDirection.SOUTH;
        }
    }

    public setFace(face: FacingDirection | Direction | number): void {
        this.face = NPC.toFacingDirection(face);
    }

    public isPet(): boolean {
        return this.pet;
    }

    public setPet(pet: boolean): void {
        this.pet = pet;
    }

    public manipulateHit(hit: PendingHit): PendingHit {
        return hit;
    }

    /**
     * Initializes all the NPC implementation classes.
     *
     * @param implementationClasses
     */
    public static initImplementations(implementationClasses: any[]): void {
        // Add all the implemented NPCs to NPC_IMPLEMENTATION_MAP
        this.NPC_IMPLEMENTATION_MAP = new Map<number, any[]>();
        for (const clazz of implementationClasses) {
            for (const id of clazz.getAnnotation(Ids).value()) {
                this.NPC_IMPLEMENTATION_MAP.set(id, clazz);
            }
        }
    }

}
