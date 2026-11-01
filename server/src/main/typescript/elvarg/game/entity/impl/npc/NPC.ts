import { Skill } from "../../../model/Skill";
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
import type { NpcSpawnLineage } from "./NpcSpawnLineage";

/**
 * A headbar besides the hitpoints one, for this tick's update: `fill` to `endFill` (in the
 * bar definition's width) over `duration` client cycles from `delay` cycles on, or `remove`.
 */
export type NpcHeadbar = { id: number; fill?: number; endFill?: number; duration?: number; delay?: number; remove?: boolean };

/**
 * A glide the client plays between two tiles (OSRS npc exact_move): from the tile the NPC left
 * to where it now stands, from `startCycles` to `endCycles` client cycles into the tick, facing
 * `angle` (0 south, 512 west, 1024 north, 1536 east).
 */
export type NpcExactMove = {
    fromX: number;
    fromY: number;
    startCycles: number;
    endCycles: number;
    angle: number;
};


/**
 * A fade (OSRS npc transparency): the NPC's model goes from `from` to `to` (0 opaque, 255
 * invisible) between `startCycles` and `endCycles` client cycles into the tick, and stays at `to`.
 */
export type NpcTransparency = { startCycles: number; endCycles: number; from: number; to: number };

/** The base animation slots the npc update block carries (the client maps them to its movement set). */
export const BASE_ANIMATION_SLOT = { IDLE: 0, WALK: 1, TURN_LEFT: 2, TURN_RIGHT: 3 } as const;

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
    private maxHitpointsOverride = -1;
    private combatOverride: { stats?: number[]; maxHit?: number } | null = null;
    private combatOverrideViews: Map<NpcDefinition, NpcDefinition> | null = null;
    /** Multiplies this NPC's attack and defence rolls (raid scaling); 1 leaves them alone. */
    private rollFactor = 1;
    private spawnPosition: Location;
    private headIcon = -1;
    private defenceBonusOverrides: Array<number | null> | null = null;
    /** This tick's glide, sent with the NPC's update and cleared after it. */
    private exactMoveState: NpcExactMove | null = null;
    /** This tick's headbars besides the hitpoints one, sent with the NPC's update and cleared after it. */
    private headbars: NpcHeadbar[] = [];
    /** This tick's fade, sent with the NPC's update and cleared after it. */
    private transparencyState: NpcTransparency | null = null;
    /** Its steps are sent as crawls (half walking speed on the client) rather than walks. */
    private crawling = false;
    /** A tile to turn to this tick (OSRS npc face coord), sent with the NPC's update and cleared after it. */
    private faceTileState: { x: number; y: number } | null = null;
    /**
     * Body-model overrides (OSRS npc model customisation): slot -> replacement model id. Sent
     * with every update while set, so late viewers see it too; an empty list is a reset and
     * keeps being sent for a few ticks before the field clears.
     */
    private modelCustomisation: { slot: number; modelId: number }[] | undefined = undefined;
    private baseAnimations: { slot: number; seqId: number }[] | undefined = undefined;
    private baseAnimationsResetUntil = 0;
    private modelCustomisationResetUntil = 0;
    private isDying: boolean;
    private owner: Player;
    private ownerOnly: boolean = false;
    /** What spawned this NPC; its respawn clones keep it. */
    private spawnLineage: NpcSpawnLineage | null = null;
    /** Held while this NPC is live, so no second one with the key can spawn. */
    private uniqueKey: string | null = null;
    private multiCombat: boolean = false;
    private visible: boolean = true;
    private face: FacingDirection = FacingDirection.SOUTH;
    private pet: boolean;
    private movementSteps = 1;
    private scriptedMovement: boolean = false;
    /** Hits show their damage but never lower this NPC's hitpoints (a boss whose HP is a timer). */
    private hitpointsLocked: boolean = false;
    /** The headbar (healthbar config id and its width) shown over this NPC, when not the default. */
    private healthBarOverride: { id: number; width: number } | null = null;
    /** Scales the combat XP players get for damaging this NPC (OSRS gives some bosses less). */
    private combatXpMultiplier: number = 1;
    private readonly drainedLevels = new Map<Skill, { level: number; cycle: number }>();
    private statDrainImmune = false;
    private static readonly STAT_RESTORE_TICKS = 100;
    /** Ticks per level a drained stat comes back; a boss can restore faster (the Corporeal Beast). */
    private statRestoreTicks = NPC.STAT_RESTORE_TICKS;

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
        let implementationClass = NPC.NPC_IMPLEMENTATION_MAP?.get(id);
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
    /** Flag for an NPC that, like a pet, is not stopped by other NPCs or players. */
    public static readonly WALK_THROUGH_ENTITIES_FLAG = "movement:walk-through-entities";
    /** OSRS's "full" entity collision: players wait instead of stepping onto this NPC (the Agility Pyramid's moving blocks). */
    public static readonly BLOCKS_PLAYERS_FLAG = "movement:blocks-players";

    public canWalkThroughNPCs(): boolean {
        if (this.pet || this.hasFlag(NPC.WALK_THROUGH_ENTITIES_FLAG)) {
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
            // A plugin driving this NPC's walk owns its movement: no wandering or walking home.
            if (!this.scriptedMovement) this.movementCoordinator.process();
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
                // "interaction:keep": a scripted NPC (a boss whose attacks a plugin drives) keeps
                // facing its target at any range.
                const trackingInteractionTarget =
                    this.getFollowing() === interactingMobile
                    || this.getCombatFollowing() === interactingMobile
                    || this.getCombat().getTarget() === interactingMobile
                    || this.hasFlag("interaction:keep");
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
            // "combat:no-regen": a boss whose fight has phases it can't be hit in (Vet'ion's hounds)
            // keeps its damage.
            if (this.hitpoints > 0 && !this.hitpointsLocked && !this.hasFlag("combat:no-regen") && (this.getCombat().getLastAttack().hasElapsed(20000)
                || this.movementCoordinator.getCoordinateState() == CoordinateState.RETREATING)) {
                const max = this.getMaxHitpoints();
                if (max > this.hitpoints) {
                    // OSRS hitpoints are integers. Floor the 10% step and the stored value so
                    // regeneration can never leave a fractional HP (the old code produced
                    // 1.5 from max 5 and a fractional target could no longer be finished).
                    const regen = Math.max(1, Math.floor(max * 0.1));
                    this.setHitpoints(Math.min(max, Math.floor(this.hitpoints + regen)));
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
            // A transformed or respawned NPC must not reuse rolls cached for its old state.
            CombatFactory.clearHitRollCache(this);
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

    /** Full health of the current form (transforms resolve first): the definition's
     * hitpoints unless this NPC was scaled (raids). */
    public getMaxHitpoints(): number {
        if (this.maxHitpointsOverride >= 0) return this.maxHitpointsOverride;
        return this.getCurrentDefinition()?.getHitpoints() ?? this.getDefinition().getHitpoints();
    }

    /** Scales this one NPC's full health, e.g. by raid level or party size; -1 restores the definition's. */
    public getRollFactor(): number {
        return this.rollFactor;
    }

    public setRollFactor(factor: number): NPC {
        this.rollFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
        return this;
    }

    public setMaxHitpoints(maxHitpoints: number): NPC {
        this.maxHitpointsOverride = Math.trunc(maxHitpoints);
        return this;
    }

    /**
     * Gives this one NPC its own combat stats (NpcDefinition.getStats layout) and/or max hit,
     * e.g. a raid scaling its monsters by party; null restores the definition's.
     */
    public setCombatOverride(override: { stats?: number[]; maxHit?: number } | null): NPC {
        this.combatOverride = override ? { stats: override.stats ? [...override.stats] : undefined, maxHit: override.maxHit } : null;
        this.combatOverrideViews = null;
        return this;
    }

    /** The definition as this NPC sees it: a view with its combat override, if it has one. */
    private withCombatOverride(definition: NpcDefinition): NpcDefinition {
        if (!this.combatOverride || !definition) return definition;
        let view = this.combatOverrideViews?.get(definition);
        if (!view) {
            const { stats, maxHit } = this.combatOverride;
            view = Object.create(definition) as NpcDefinition;
            if (stats) view.getStats = () => stats;
            if (maxHit != null) view.getMaxHit = () => maxHit;
            (this.combatOverrideViews ??= new Map()).set(definition, view);
        }
        return view;
    }

    public heal(heal: number) {
        if ((this.hitpoints + heal) > this.getMaxHitpoints()) {
            this.setHitpoints(this.getMaxHitpoints());
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

    /**
     * A defence bonus (BonusManager.DEFENCE_STAB..DEFENCE_RANGE) as this NPC has it now: the
     * definition's, unless a fight has changed it for this NPC (setDefenceBonusOverrides).
     */
    public getDefenceBonus(index: number, rangedType: "light" | "standard" | "heavy" = "standard"): number {
        const override = this.defenceBonusOverrides?.[index];
        if (typeof override === "number") return override;
        if (index === 4) return this.getCurrentDefinition().getRangedDefenceBonus(rangedType);
        return this.getCurrentDefinition().getStats()[10 + index] ?? 0;
    }

    /** Per-NPC defence bonuses by index (null entries keep the definition's); null clears them. */
    public setDefenceBonusOverrides(bonuses: Array<number | null> | null): void {
        this.defenceBonusOverrides = bonuses ? [...bonuses] : null;
    }

    public getBaseDefence(type: CombatType): number {
        let base = 0;
        switch (type) {
            case CombatType.MAGIC:
                base = this.getDefenceBonus(3);
                break;
            case CombatType.MELEE:
                base = this.getDefenceBonus(0);
                break;
            case CombatType.RANGED:
                base = this.getDefenceBonus(4);
                break;
        }
        // 10,11,12 = melee
        // 13 = magic
        // 14 = range
        return base;
    }

    /** Temporary combat stats belong to this NPC, never its shared definition. */
    public getMaxLevel(skill: Skill): number {
        const slot = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC].indexOf(skill);
        if (slot < 0) throw new RangeError("Unsupported NPC combat skill");
        return this.getCurrentDefinition().getStats()[slot];
    }

    public getCurrentLevel(skill: Skill): number {
        const base = this.getMaxLevel(skill);
        const drained = this.drainedLevels.get(skill);
        if (!drained) return base;
        const restored = Math.max(0, Math.floor((World.getProcessCycle() - drained.cycle) / this.statRestoreTicks));
        drained.level = Math.min(base, drained.level + restored);
        drained.cycle += restored * this.statRestoreTicks;
        if (drained.level === base) this.drainedLevels.delete(skill);
        return drained.level;
    }

    public setCurrentLevels(skill: Skill, level: number): void {
        if (!Number.isFinite(level)) throw new RangeError("Invalid NPC combat level");
        const base = this.getMaxLevel(skill);
        if (this.statDrainImmune && level < base) return;
        this.getCurrentLevel(skill);
        const cycle = this.drainedLevels.get(skill)?.cycle ?? World.getProcessCycle();
        level = Math.max(0, Math.min(base, Math.floor(level)));
        if (level === base) this.drainedLevels.delete(skill);
        else this.drainedLevels.set(skill, { level, cycle });
    }

    /** Encounter-owned immunity; never changes another NPC or its shared definition. */
    public setStatDrainImmune(immune: boolean): void {
        this.statDrainImmune = immune;
        if (immune) this.drainedLevels.clear();
    }

    public getDefenceLevel(): number {
        return this.getCurrentLevel(Skill.DEFENCE);
    }

    public setDefenceLevel(level: number): void {
        this.setCurrentLevels(Skill.DEFENCE, level);
    }

    public setStatRestoreTicks(ticks: number): void {
        this.statRestoreTicks = Math.max(1, Math.trunc(ticks));
    }

    /** Wiki NPC damage formula; configured caps still bound scripted attacks. */
    public getCurrentMaxHit(type: CombatType): number {
        const definition = this.getCurrentDefinition();
        const maximum = definition.getMaxHit();
        if (type === CombatType.MAGIC) return maximum;
        const skill = type === CombatType.MELEE ? Skill.STRENGTH : Skill.RANGED;
        const current = this.getCurrentLevel(skill);
        if (current === this.getMaxLevel(skill)) return maximum;
        const bonus = definition.getStats()[type === CombatType.MELEE ? 6 : 8] ?? 0;
        return Math.min(maximum, Math.floor(0.5 + (current + 9) * (bonus + 64) / 640));
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

    public getSpawnLineage(): NpcSpawnLineage | null {
        return this.spawnLineage;
    }

    public setSpawnLineage(lineage: NpcSpawnLineage | null): NPC {
        this.spawnLineage = lineage;
        return this;
    }

    public getUniqueKey(): string | null {
        return this.uniqueKey;
    }

    public setUniqueKey(key: string | null): NPC {
        this.uniqueKey = key;
        return this;
    }

    /** Owner-scoped spawns (quest instances) are only visible to their owner. */
    public isOwnerOnly(): boolean {
        return this.ownerOnly;
    }

    public setOwnerOnly(ownerOnly: boolean): NPC {
        this.ownerOnly = ownerOnly;
        return this;
    }

    /**
     * Fights with this NPC follow multi-combat rules wherever it stands: any number of players
     * may attack it, and it may attack them all (the Revenant maledictus in the singles-plus
     * Revenant Caves).
     */
    public isMultiCombat(): boolean {
        return this.multiCombat;
    }

    public setMultiCombat(multiCombat: boolean): NPC {
        this.multiCombat = multiCombat;
        return this;
    }

    /**
     * Replaces body-model slots on every viewer's client (OSRS npc model customisation), e.g.
     * Araxxor's venom-coated legs on enrage. Null resets to the cache's models.
     */
    public setModelCustomisation(models: { slot: number; modelId: number }[] | null): NPC {
        if (models && models.length > 0) {
            this.modelCustomisation = models.map((entry) => ({ slot: entry.slot | 0, modelId: entry.modelId | 0 }));
            this.modelCustomisationResetUntil = 0;
        } else {
            this.modelCustomisation = [];
            this.modelCustomisationResetUntil = World.getProcessCycle() + 5;
        }
        return this;
    }

    /**
     * Overrides the stand / walk sequences every viewer's client uses for this NPC (OSRS npc base
     * animation set change), e.g. the Archive Guardian's ground idle once it lands: without it the
     * client goes back to the cache's stand pose whenever an animation ends. Null resets them.
     */
    public setBaseAnimations(sequences: { idle?: number; walk?: number; turnLeft?: number; turnRight?: number } | null): NPC {
        const entries: { slot: number; seqId: number }[] = [];
        if (sequences?.idle !== undefined) entries.push({ slot: BASE_ANIMATION_SLOT.IDLE, seqId: sequences.idle | 0 });
        if (sequences?.walk !== undefined) entries.push({ slot: BASE_ANIMATION_SLOT.WALK, seqId: sequences.walk | 0 });
        if (sequences?.turnLeft !== undefined) entries.push({ slot: BASE_ANIMATION_SLOT.TURN_LEFT, seqId: sequences.turnLeft | 0 });
        if (sequences?.turnRight !== undefined) entries.push({ slot: BASE_ANIMATION_SLOT.TURN_RIGHT, seqId: sequences.turnRight | 0 });
        this.baseAnimations = entries;
        this.baseAnimationsResetUntil = entries.length > 0 ? 0 : World.getProcessCycle() + 5;
        return this;
    }

    /** The base animations to send this update, or undefined when there are none (or a reset expired). */
    public getBaseAnimationsForUpdate(): { slot: number; seqId: number }[] | undefined {
        if (this.baseAnimations === undefined) return undefined;
        if (this.baseAnimations.length === 0 && World.getProcessCycle() > this.baseAnimationsResetUntil) {
            this.baseAnimations = undefined;
            return undefined;
        }
        return this.baseAnimations;
    }

    /** The customisation to send this update, or undefined when there is none (or a reset expired). */
    public getModelCustomisationForUpdate(): { slot: number; modelId: number }[] | undefined {
        if (this.modelCustomisation === undefined) {
            return undefined;
        }
        if (this.modelCustomisation.length === 0 && World.getProcessCycle() > this.modelCustomisationResetUntil) {
            this.modelCustomisation = undefined;
            return undefined;
        }
        return this.modelCustomisation;
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
        if (!player) return this.withCombatOverride(NpcDefinition.forId(id));
        const resolved = CacheDefinitions.resolveNpc(id, player.getPacketSender());
        return resolved ? this.withCombatOverride(NpcDefinition.forId(resolved.id)) : undefined;
    }

    /**
     * The id content keys on: the cache variant this NPC's transform resolves to for
     * `player`. Revision 241 moved many display names into NPC transforms, leaving the
     * spawned id as a nameless parent, while quest plugins and npc-dialogue-index.json
     * list the resolved variant ids. Interaction events pass this id so both sides meet.
     */
    public getContentId(player?: Player): number {
        return this.getCurrentDefinition(player)?.getId?.() ?? this.getId();
    }

    /**
     * Gets the base definition for this NPC, regardless of NPC transformation etc.
     *
     * @return
     */
    public getDefinition(): NpcDefinition {
        return this.withCombatOverride(NpcDefinition.forId(this.id));
    }

    public getSpawnPosition(): Location {
        return this.spawnPosition;
    }

    /**
     * Moves the NPC's home: where its movement coordinator keeps it (wander radius) and walks it
     * back to. Content that walks an NPC around (a crewmate on a boat deck) sets it to where it
     * sends the NPC, or the coordinator walks it straight back.
     */
    public setSpawnPosition(position: Location): NPC {
        this.spawnPosition = position.clone();
        return this;
    }

    public getHeadIcon(): number {
        return this.headIcon;
    }

    public setHeadIcon(headIcon: number): void {
        this.headIcon = headIcon;
        // getUpdateFlag().flag(Flag.NPC_APPEARANCE);
    }

    /**
     * Moves the NPC to `destination` at once and has clients glide it there from where it
     * stood, as OSRS does with a teleport and an exact_move in the same tick. By default the
     * glide takes the whole tick (cycles 0 to 30) and faces the way it travels.
     */
    public exactMove(
        destination: Location,
        options: { startCycles?: number; endCycles?: number; angle?: number } = {}
    ): NPC {
        const from = this.getLocation();
        const dx = destination.getX() - from.getX();
        const dy = destination.getY() - from.getY();
        this.moveTo(destination);
        this.exactMoveState = {
            fromX: from.getX(),
            fromY: from.getY(),
            startCycles: Math.max(0, Math.trunc(options.startCycles ?? 0)),
            endCycles: Math.max(0, Math.trunc(options.endCycles ?? 30)),
            angle: (options.angle ?? NPC.travelAngle(dx, dy)) & 2047,
        };
        return this;
    }

    public getExactMove(): NpcExactMove | null {
        return this.exactMoveState;
    }

    /** The orientation facing along (dx, dy): 0 south, 512 west, 1024 north, 1536 east. */
    public static travelAngle(dx: number, dy: number): number {
        if (dx === 0 && dy === 0) return 0;
        return Math.round((Math.atan2(-dx, -dy) * 1024) / Math.PI) & 2047;
    }

    /**
     * Shows a headbar over the NPC besides its hitpoints bar (a charge bar, a shield): at `fill`,
     * moving to `endFill` over `duration` client cycles (20ms each) from `delay` cycles on. Fills
     * are in the bar definition's width (headbar 20 is 120 wide, 81 is 100).
     */
    public showHeadbar(
        id: number,
        options: { fill: number; endFill?: number; duration?: number; delay?: number }
    ): NPC {
        this.headbars = this.headbars.filter((bar) => bar.id !== id);
        this.headbars.push({
            id,
            fill: Math.max(0, Math.trunc(options.fill)),
            endFill: Math.max(0, Math.trunc(options.endFill ?? options.fill)),
            duration: Math.max(0, Math.trunc(options.duration ?? 0)),
            delay: Math.max(0, Math.trunc(options.delay ?? 0)),
        });
        return this;
    }

    /**
     * Fades the NPC's model to `to` (0 opaque, 255 invisible) over client cycles `startCycles` to
     * `endCycles` of this tick, from `from` (its current look when left out), as OSRS's npc
     * transparency: a boss teleporting out (`fade(255, { from: 0, startCycles: 30, endCycles: 45 })`),
     * a spawn fading in (`fade(0, { from: 255, endCycles: 30 })`).
     */
    public fade(to: number, options: { from?: number; startCycles?: number; endCycles?: number } = {}): NPC {
        const clamp = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)));
        this.transparencyState = {
            startCycles: Math.max(0, Math.trunc(options.startCycles ?? 0)),
            endCycles: Math.max(0, Math.trunc(options.endCycles ?? 30)),
            from: options.from === undefined ? -1 : clamp(options.from),
            to: clamp(to),
        };
        return this;
    }

    public getTransparency(): NpcTransparency | null {
        return this.transparencyState;
    }

    /** Takes a headbar shown with showHeadbar away. */
    public removeHeadbar(id: number): NPC {
        this.headbars = this.headbars.filter((bar) => bar.id !== id);
        this.headbars.push({ id, remove: true });
        return this;
    }

    public getHeadbars(): NpcHeadbar[] {
        return this.headbars;
    }

    /**
     * Sends this NPC's steps as crawls: clients move it at half walking speed, so a step every
     * two ticks looks continuous (a boss's larvae).
     */
    public setCrawling(crawling: boolean): NPC {
        this.crawling = crawling;
        return this;
    }

    public isCrawling(): boolean {
        return this.crawling;
    }

    /**
     * Turns the NPC to face a tile once (OSRS npc face coord), as opposed to following an entity
     * with setMobileInteraction. Clients turn it at its turn speed and it keeps that facing.
     */
    public faceTile(location: Location): NPC {
        this.faceTileState = { x: location.getX(), y: location.getY() };
        return this;
    }

    public getFaceTile(): { x: number; y: number } | null {
        return this.faceTileState;
    }

    public resetUpdating() {
        super.resetUpdating();
        this.exactMoveState = null;
        this.headbars = [];
        this.faceTileState = null;
        this.transparencyState = null;
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
        // A respawn clone must keep its scope, or it leaks to every player.
        if (this.getOwner?.()) npc.setOwner(this.getOwner());
        if (this.isOwnerOnly?.()) npc.setOwnerOnly(true);
        npc.setSpawnLineage(this.spawnLineage);
        npc.setUniqueKey(this.uniqueKey);
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
        return PluginManager.emitNpcHitModify(this, hit);
    }

    /**
     * While true, Combat leaves this NPC's movement queue alone (no pursuit route,
     * no in-range reset) and does not attack, and it neither wanders nor walks home. Plugins driving a scripted walk set
     * this, path the NPC themselves, then clear it on arrival to resume combat.
     */
    public setScriptedMovement(scripted: boolean): void {
        this.scriptedMovement = scripted;
    }

    public isScriptedMovement(): boolean {
        return this.scriptedMovement;
    }

    public setHitpointsLocked(locked: boolean): void {
        this.hitpointsLocked = locked;
    }

    public isHitpointsLocked(): boolean {
        return this.hitpointsLocked;
    }

    public setHealthBar(bar: { id: number; width: number } | null): void {
        this.healthBarOverride = bar;
    }

    public getHealthBar(): { id: number; width: number } | null {
        return this.healthBarOverride;
    }

    public setCombatXpMultiplier(multiplier: number): void {
        this.combatXpMultiplier = multiplier;
    }

    public getCombatXpMultiplier(): number {
        return this.combatXpMultiplier;
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
