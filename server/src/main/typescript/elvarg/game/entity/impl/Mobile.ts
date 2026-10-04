import { Entity } from "../Entity";
import { Sound } from "../../Sound";
import type { CombatType } from "../../content/combat/CombatType";
import { HitDamage } from "../../content/combat/hit/HitDamage";
import { HitMask } from "../../content/combat/hit/HitMask";
import type { PendingHit } from "../../content/combat/hit/PendingHit";
import type { NPC } from "./npc/NPC";
import type { Player } from "./player/Player";
import type { Combat } from "../../content/combat/Combat";
import type { Animation } from "../../model/Animation";
import { Direction } from "../../model/Direction";
import { Flag } from "../../model/Flag";
import type { Graphic } from "../../model/Graphic";
import { Location } from "../../model/Location";
import { UpdateFlag } from "../../model/UpdateFlag";
import type { MovementQueue } from "../../model/movement/MovementQueue";
import { Task } from "../../task/Task";
import { TaskManager } from "../../task/TaskManager";
import { Stopwatch } from "../../../util/Stopwatch";
import { TimerRepository } from "../../../util/timers/TimerRepository";
import { Misc } from "../../../util/Misc";
import type { Boundary } from "../../model/Boundary";

const getPlayerCtor = () =>
  require("./player/Player").Player as typeof import("./player/Player").Player;
const getNpcCtor = () =>
  require("./npc/NPC").NPC as typeof import("./npc/NPC").NPC;
const getCombatCtor = () =>
  require("../../content/combat/Combat").Combat as typeof import("../../content/combat/Combat").Combat;
const getMovementQueueCtor = () =>
  require("../../model/movement/MovementQueue").MovementQueue as typeof import("../../model/movement/MovementQueue").MovementQueue;
const getRegionManager = () =>
  require("../../collision/RegionManager").RegionManager as typeof import("../../collision/RegionManager").RegionManager;
const getWorld = () =>
  require("../../World").World as typeof import("../../World").World;
const getPlayerRights = () =>
  require("../../model/rights/PlayerRights").PlayerRights as typeof import("../../model/rights/PlayerRights").PlayerRights;

class MobileTask extends Task {
    constructor(ticks: number, private readonly execFunc: Function) {
        super(ticks, false);
    }
    execute(): void {
        this.execFunc();
        this.stop()
    }

}

export abstract class Mobile extends Entity {
    private index: number;
    public lastKnownRegion: Location;
    private timers = new TimerRepository();
    private combat: Combat;
    private movementQueue: MovementQueue;
    public forcedChat: string;
    public walkingDirection: Direction = Direction.NONE;
    public runningDirection: Direction = Direction.NONE;
    private lastCombat = new Stopwatch();
    public updateFlag = new UpdateFlag();
    public positionToFace: Location;
    public animation: Animation;
    public graphic: Graphic;
    private following: Mobile;

    private attributes = new Map<Object, Object>();

    public getAttribute(name: Object) {
        return this.attributes.get(name);
    }
    setAttribute(name: any, object: any) {
        this.attributes.set(name, object);
    }
    /*
     * Fields
     */
    interactingMobile: any;
    npcTransformationId = -1;
    poisonDamage: number;
    /**
     * True when the current affliction is venom rather than ordinary
     * poison. Venom uses a different damage curve (see CombatPoisonEffect):
     * it starts low and escalates over time instead of decaying, and
     * doesn't expire on its own.
     */
    private venomed = false;
    prayerActive = new Array<boolean>(30);
    curseActive = new Array<boolean>(20);
    resetMovementQueue = false;
    needsPlacement = false;
    untargetable = false;
    hasVengeance = false;
    specialPercentage = 100;
    specialActivated = false;
    recoveringSpecialAttack = false;
    isTeleporting = false;
    primaryHit: any;
    secondaryHit: any;

    private registred: boolean

    constructor(position: Location) {
        super(position);
        // Ensure we always have a baseline region; movement/updates rely on this.
        this.lastKnownRegion = position.clone();
        this.combat = new (getCombatCtor())(this);
        this.movementQueue = new (getMovementQueueCtor())(this);
    }

    public abstract onAdd(): void;

    public abstract onRemove(): void;

    public abstract manipulateHit(hit: PendingHit): PendingHit;

    public override setLocation(location: Location): Mobile {
        const previousLocation = this.getLocation();
        super.setLocation(location);
        if (this.isNpc() && this.isRegistered() && !previousLocation.equals(location)) {
            getWorld().onNpcMoved(this.getAsNpc(), previousLocation, location);
        } else if (this.isPlayer() && this.isRegistered() && !previousLocation.equals(location)) {
            getWorld().onPlayerMoved(this.getAsPlayer(), previousLocation, location);
        }
        return this;
    }

    /**
     * Called before any teleport (moveTo, smartMove, smartMoves) moves an actor, so systems
     * such as sailing can react to every teleport source in one place.
     */
    private static readonly teleportListeners: Array<(mobile: Mobile, target: Location) => void> = [];

    public static onBeforeTeleport(listener: (mobile: Mobile, target: Location) => void): void {
        Mobile.teleportListeners.push(listener);
    }

    private notifyTeleport(target: Location): void {
        for (const listener of Mobile.teleportListeners) listener(this, target);
    }

    /**
     * Teleports the character to a target location
     *
     * @param teleportTarget
     * @return
     */
    public moveTo(teleportTarget: Location): Mobile {
        this.notifyTeleport(teleportTarget);
        this.getMovementQueue().reset();
        this.setLocation(teleportTarget.clone());
        this.setNeedsPlacement(true);
        this.setResetMovementQueue(true);
        this.setMobileInteraction(null);
        if (this.isPlayer()) {
            this.getMovementQueue().handleRegionChange();
        }
        return this;
    }

    smartMove(location: Location, radius: number): Mobile {
        let chosen: Location | null = null;
        let requestedX: number = location.x;
        let requestedY: number = location.y;
        let height: number = location.z;

        while (true) {
            let randomX: number = Misc.random(requestedX - radius, requestedX + radius);
            let randomY: number = Misc.random(requestedY - radius, requestedY + radius);
            let randomLocation: Location = new Location(randomX, randomY, height);

            if (!getRegionManager().blocked(randomLocation, null)) {
                chosen = randomLocation;
                break;
            }
        }

        this.notifyTeleport(chosen);
        this.getMovementQueue().reset();
        this.setLocation(chosen.clone());
        this.setNeedsPlacement(true);
        this.setResetMovementQueue(true);
        this.setMobileInteraction(null);
        if (this.isPlayer()) {
            this.movementQueue.handleRegionChange();
        }

        return this;
    }

    public smartMoves(bounds: Boundary): Mobile {
        let chosen: Location | null = null;
        const height = bounds.height;
        while (true) {
            const randomX = Misc.random(bounds.getX(), bounds.getX2());
            const randomY = Misc.random(bounds.getY(), bounds.getY2());
            const randomLocation = new Location(randomX, randomY, height);
            if (!getRegionManager().blocked(randomLocation, null)) {
                chosen = randomLocation;
                break;
            }
        }
        this.notifyTeleport(chosen);
        this.getMovementQueue().reset();
        this.setLocation(chosen.clone());
        this.setNeedsPlacement(true);
        this.setResetMovementQueue(true);
        this.setMobileInteraction(null);
        if (this.isPlayer()) {
            this.getMovementQueue().handleRegionChange();
        }
        return this;
    }

    /**
     * Resets all flags related to updating.
     */
    resetUpdating() {
        this.getUpdateFlag().reset();
        this.walkingDirection = Direction.NONE;
        this.runningDirection = Direction.NONE;
        this.needsPlacement = false;
        this.resetMovementQueue = false;
        this.forcedChat = null;
        this.animation = null;
        this.graphic = null;
        this.slotGraphics.clear();
        this.displayedHealth = null;
    }

    /** What the health bar shows with this tick's hits, when it is not the actor's hitpoints. */
    private displayedHealth: { current: number; max: number; bar?: { id: number; width: number } } | null = null;

    /**
     * Shows a hitsplat that changes nothing - a meter other than hitpoints, such as the
     * Wintertodt's cold on the warmth meter. `splat` is the cache hitsplat for the target and
     * for everyone else; `health`, when given, is what the health bar shows with it.
     */
    showHitsplat(
        damage: number,
        splat: { mine: number; others: number },
        health?: { current: number; max: number; bar?: { id: number; width: number } },
    ): void {
        const hit = new HitDamage(Math.max(0, Math.trunc(damage)), HitMask.RED).setSplatTypes(splat.mine, splat.others);
        const flags = this.getUpdateFlag();
        if (!flags.flagged(Flag.SINGLE_HIT)) {
            this.setPrimaryHit(hit);
            flags.flag(Flag.SINGLE_HIT);
        } else if (!flags.flagged(Flag.DOUBLE_HIT)) {
            this.setSecondaryHit(hit);
            flags.flag(Flag.DOUBLE_HIT);
        } else {
            return;
        }
        if (health) this.displayedHealth = health;
    }

    getDisplayedHealth(): { current: number; max: number; bar?: { id: number; width: number } } | null {
        return this.displayedHealth;
    }

    /**
     * What the health bar shows with this tick's hits instead of the actor's hitpoints (a
     * shield's points on the shield's bar).
     */
    setDisplayedHealth(health: { current: number; max: number; bar?: { id: number; width: number } } | null): Mobile {
        this.displayedHealth = health;
        return this;
    }

    forceChat(message: string): Mobile {
        this.setForcedChat(message);
        this.getUpdateFlag().flag(Flag.FORCED_CHAT);
        return this;
    }

    setMobileInteraction(mobile: Mobile | null): Mobile {
        this.interactingMobile = mobile;
        this.getUpdateFlag().flag(Flag.ENTITY_INTERACTION);
        return this;
    }

    performAnimation(animation: Animation) {
        if (animation == null) {
            return;
        }
        if (this.animation != null && animation != null) {
            if (this.animation.getPriority() > animation.getPriority()) {
                return;
            }
        }
        this.animation = animation;
        this.getUpdateFlag().flag(Flag.ANIMATION);
    }

    performGraphic(graphic: Graphic) {
        if (this.graphic != null && graphic != null) {
            if (this.graphic.getPriority() > graphic.getPriority()) {
                return;
            }
        }

        this.graphic = graphic;
        this.getUpdateFlag().flag(Flag.GRAPHIC);
    }

    /** This tick's graphics in spotanim slots other than 0; null clears a slot. */
    private readonly slotGraphics = new Map<number, Graphic | null>();

    /**
     * Plays a graphic in one of the actor's spotanim slots, which show at once - a Manticore's
     * three charged orbs, say. Slot 0 is performGraphic's; a null graphic clears the slot.
     */
    performGraphicInSlot(slot: number, graphic: Graphic | null): void {
        const index = Math.trunc(slot) & 0xff;
        if (index === 0) {
            if (graphic) this.performGraphic(graphic);
            return;
        }
        this.slotGraphics.set(index, graphic);
        this.getUpdateFlag().flag(Flag.GRAPHIC);
    }

    getSlotGraphics(): ReadonlyMap<number, Graphic | null> {
        return this.slotGraphics;
    }

    delayedAnimation(animation: Animation, ticks: number) {
        TaskManager.submit(new MobileTask(ticks, () => {
            this.performAnimation(animation);
        }));
    }

    delayedGraphic(graphic: Graphic, ticks: number) {
        TaskManager.submit(new MobileTask(ticks, () => { this.performGraphic(graphic) }));
    }

    boundaryTiles(): Location[] {
        const size: number = this.getSize();
        const tiles: Location[] = new Array(size * size);
        let index = 0;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                tiles[index++] = this.getLocation().transform(x, y);
            }
        }
        return tiles;
    }

    outterTiles(): Location[] {
        const size = this.getSize();
        const tiles: Location[] = new Array(size * 4);
        let index = 0;
        for (let x = 0; x < size; x++) {
            tiles[index++] = this.getLocation().transform(x, -1);
            tiles[index++] = this.getLocation().transform(x, size);
        }
        for (let y = 0; y < size; y++) {
            tiles[index++] = this.getLocation().transform(-1, y);
            tiles[index++] = this.getLocation().transform(size, y);
        }
        return tiles;
    }

    tiles(): Location[] {
        const size = this.getSize();
        const tiles: Location[] = new Array(size * size);
        let index = 0;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                tiles[index++] = this.getLocation().transform(x, y);
            }
        }
        return tiles;
    }

    calculateDistance(to: Mobile): number {
        const tiles = this.tiles();
        const otherTiles = to.tiles();
        return Location.calculateDistance(tiles, otherTiles);
    }

    useProjectileClipping(): boolean {
        return true;
    }

    public abstract appendDeath(): void;

    public heal(damage: number): void { };

    public getHitpointsAfterPendingDamage(): number {
        return this.getHitpoints() - this.getCombat().getHitQueue().getAccumulatedDamage();
    }

    public abstract getHitpoints(): number;

    public abstract setHitpoints(hitpoints: number): Mobile;

    public abstract getBaseAttack(type: CombatType): number;

    public abstract getBaseDefence(type: CombatType): number;

    public abstract getBaseAttackSpeed(): number;

    public abstract getAttackAnim(): number;

    public abstract getAttackSound(): Sound;

    public abstract getBlockAnim(): number;

    /*
     * Getters and setters Also contains methods.
     */

    isTeleportingReturn(): boolean {
        return this.isTeleporting;
    }

    setTeleporting(isTeleporting: boolean) {
        this.isTeleporting = isTeleporting;
    }

    getGraphic(): Graphic {
        return this.graphic;
    }

    getAnimation(): Animation {
        return this.animation;
    }

    /**
     * @return the lastCombat
     */
    getLastCombat(): Stopwatch {
        return this.lastCombat;
    }

    getPoisonDamage(): number {
        return this.poisonDamage;
    }

    setPoisonDamage(poisonDamage: number) {
        this.poisonDamage = poisonDamage;
    }
    isPoisoned(): boolean {
        return this.poisonDamage > 0;
    }

    isVenomed(): boolean {
        return this.venomed && this.poisonDamage > 0;
    }

    setVenomed(venomed: boolean) {
        this.venomed = venomed;
    }

    getPositionToFace(): Location {
        return this.positionToFace;
    }

    setPositionToFace(positionToFace: Location): Mobile {
        const current = this.positionToFace;
        if (current === positionToFace) {
            return this;
        }
        if (
            current != null &&
            positionToFace != null &&
            current.getX() === positionToFace.getX() &&
            current.getY() === positionToFace.getY() &&
            current.getZ() === positionToFace.getZ()
        ) {
            return this;
        }
        if (current == null && positionToFace == null) {
            return this;
        }
        this.positionToFace = positionToFace;
        this.getUpdateFlag().flag(Flag.FACE_POSITION);
        return this;
    }

    setPositionToFaceCoordinates(x: number, y: number, z: number): Mobile {
        const current = this.positionToFace;
        if (
            current != null &&
            current.getX() === x &&
            current.getY() === y &&
            current.getZ() === z
        ) {
            return this;
        }
        this.positionToFace = new Location(x, y, z);
        this.getUpdateFlag().flag(Flag.FACE_POSITION);
        return this;
    }

    getUpdateFlag(): UpdateFlag {
        return this.updateFlag;
    }

    getMovementQueue(): MovementQueue {
        return this.movementQueue;
    }

    getCombat(): Combat {
        return this.combat;
    }

    getInteractingMobile(): Mobile {
        return this.interactingMobile;
    }

    setDirection(direction: Direction) {
        this.setPositionToFace(this.getLocation().clone().add(direction.getX(), direction.getY()));
    }

    getForcedChat(): string {
        return this.forcedChat;
    }

    setForcedChat(forcedChat: string): Mobile {
        this.forcedChat = forcedChat;
        return this;
    }

    getPrayerActive(): boolean[] {
        return this.prayerActive;
    }
    setPrayerActives(prayerActive: boolean[]): Mobile {
        this.prayerActive = prayerActive;
        return this;
    }

    getCurseActive(): boolean[] {
        return this.curseActive;
    }

    setCurseActive(curseActive: boolean[]): Mobile {
        this.curseActive = curseActive;
        return this;
    }

    setPrayerActive(id: number, prayerActive: boolean): Mobile {
        this.prayerActive[id] = prayerActive;
        return this;
    }

    setCurseActives(id: number, curseActive: boolean): Mobile {
        this.curseActive[id] = curseActive;
        return this;
    }

    getNpcTransformationId(): number {
        return this.npcTransformationId;
    }

    setNpcTransformationId(npcTransformationId: number): Mobile {
        this.npcTransformationId = npcTransformationId;
        this.getUpdateFlag().flag(Flag.APPEARANCE);
        return this;
    }

    decrementHealth(hit: HitDamage): HitDamage {
        if (this.getHitpoints() <= 0) {
            hit.setDamage(0);
            return hit;
        }
        // A boss whose HP is a timer shows every hit but keeps its HP.
        if (this.isNpc() && this.getAsNpc().isHitpointsLocked?.()) {
            if (hit.getDamage() < 0) hit.setDamage(0);
            return hit;
        }
        const PlayerRights = getPlayerRights();
        const protectedDeveloper =
          this.isPlayer() &&
          this.getAsPlayer()?.getRights?.() === PlayerRights.DEVELOPER;
        if (hit.getDamage() > this.getHitpoints())
            hit.setDamage(this.getHitpoints());
        if (hit.getDamage() < 0)
            hit.setDamage(0);
        if (protectedDeveloper) {
            return hit;
        }
        let outcome = this.getHitpoints() - hit.getDamage();
        if (outcome < 0)
            outcome = 0;
        this.setHitpoints(outcome);
        return hit;
    }
    getPrimaryHit(): HitDamage {
        return this.primaryHit;
    }

    setPrimaryHit(hit: HitDamage): void {
        this.primaryHit = hit;
    }

    getSecondaryHit(): HitDamage {
        return this.secondaryHit;
    }

    setSecondaryHit(hit: HitDamage): void {
        this.secondaryHit = hit;
    }

    getWalkingDirection(): Direction {
        return this.walkingDirection;
    }

    setWalkingDirection(walkDirection: Direction): void {
        this.walkingDirection = walkDirection;
    }

    getRunningDirection(): Direction {
        return this.runningDirection;
    }

    setRunningDirection(runDirection: Direction): void {
        this.runningDirection = runDirection;
    }
    isResetMovementQueue(): boolean {
        return this.resetMovementQueue;
    }

    setResetMovementQueue(resetMovementQueue: boolean): void {
        this.resetMovementQueue = resetMovementQueue;
    }

    isRegistered(): boolean {
        return this.registred;
    }

    setRegistered(registered: boolean): void {
        this.registred = registered;
    }

    isNeedsPlacement(): boolean {
        return this.needsPlacement;
    }

    setNeedsPlacement(needsPlacement: boolean): void {
        this.needsPlacement = needsPlacement;
        if (needsPlacement) {
            // The client drops its own destination flag when the local player is
            // placed, so the cached "already sent" value must not suppress a resend.
            this.getMovementQueue().invalidateDestinationFlagCache();
        }
    }

    public hasVengeanceReturn(): boolean {
        return this.hasVengeance;
    }
    setHasVengeance(hasVengeance: boolean): void {
        this.hasVengeance = hasVengeance;
    }

    isSpecialActivated(): boolean {
        return this.specialActivated;
    }

    setSpecialActivated(specialActivated: boolean): void {
        this.specialActivated = specialActivated;
    }

    getSpecialPercentage(): number {
        return this.specialPercentage;
    }

    setSpecialPercentage(specialPercentage: number): void {
        this.specialPercentage = specialPercentage;
    }

    decrementSpecialPercentage(drainAmount: number): void {
        this.specialPercentage -= drainAmount;

        if (this.specialPercentage < 0) {
            this.specialPercentage = 0;
        }
    }

    incrementSpecialPercentage(gainAmount: number): void {
        this.specialPercentage += gainAmount;

        if (this.specialPercentage > 100) {
            this.specialPercentage = 100;
        }
    }

    isRecoveringSpecialAttack(): boolean {
        return this.recoveringSpecialAttack;
    }

    setRecoveringSpecialAttack(recoveringSpecialAttack: boolean): void {
        this.recoveringSpecialAttack = recoveringSpecialAttack;
    }

    isUntargetable(): boolean {
        return this.untargetable;
    }

    setUntargetable(untargetable: boolean): void {
        this.untargetable = untargetable;
    }

    inDungeon(): boolean {
        return false;
    }

    getFollowing(): Mobile | null {
        return this.following;
    }

    setFollowing(following: Mobile | null): void {
        if (this.following === following) {
            return;
        }
        this.following = following;
    }

    getCombatFollowing(): Mobile | null {
        return this.getCombat().getTarget();
    }

    setCombatFollowing(target: Mobile | null): void {
        const combat = this.getCombat();
        if (target == null) {
            if (combat.getTarget() != null) combat.reset();
        } else if (combat.getTarget() !== target) {
            combat.attack(target);
        }
    }

    getIndex(): number {
        return this.index;
    }

    setIndex(index: number): Mobile {
        this.index = index;
        return this;
    }

    getLastKnownRegion(): Location {
        return this.lastKnownRegion;
    }

    setLastKnownRegion(lastKnownRegion: Location): Mobile {
        this.lastKnownRegion = lastKnownRegion;
        return this;
    }

    getTimers(): TimerRepository {
        return this.timers;
    }

    isPlayer(): boolean {
        const PlayerCtor = getPlayerCtor();
        return typeof PlayerCtor === "function" && this instanceof PlayerCtor;
    }

    isPlayerBot(): boolean {
        return false;
    }

    isNpc(): boolean {
        const NpcCtor = getNpcCtor();
        return typeof NpcCtor === "function" && this instanceof NpcCtor;
    }

    getAsPlayer(): Player | null {
        if (!this.isPlayer()) {
            return null;
        }
        return (this as unknown as Player);
    }

    getAsPlayerBot(): any | null {
        return null;
    }

    getAsNpc(): NPC | null {
        if (!this.isNpc()) {
            return null;
        }
        return (this as unknown as NPC);
    }

    sendMessage(message: string): void {
        if (!this.isPlayer() || this.isPlayerBot()) {
            return;
        }

        this.getAsPlayer()?.getPacketSender()?.sendMessage(message);
    }
}
