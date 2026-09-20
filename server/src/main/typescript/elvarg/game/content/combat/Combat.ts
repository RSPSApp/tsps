import { HitDamageCache } from "../../content/combat/hit/HitDamageCache";
import { HitQueue } from "../../content/combat/hit/HitQueue";
import type { Mobile } from "../../entity/impl/Mobile";
import type { Player } from "../../entity/impl/player/Player";
import { CoordinateState } from "../../entity/impl/npc/NPCMovementCoordinator";
import { SecondsTimer } from "../../model/SecondsTimer";
import { StatementDialogue } from "../../model/dialogues/entries/impl/StatementDialogue";
import { Stopwatch } from "../../../util/Stopwatch";
import { ServerPerf } from "../../../util/ServerPerf";
import { World } from "../../World";
import { CombatConstants } from "./CombatConstants";
import { CombatFactory, CanAttackResponse } from "./CombatFactory";
import { CombatRange } from "./CombatRange";
import { CombatSpecial } from "./CombatSpecial";
import { CombatType } from "./CombatType";
import type { CombatSpell } from "./magic/CombatSpell";
import type { CombatMethod } from "./method/CombatMethod";
import { GraniteMaulCombatMethod } from "./method/impl/specials/GraniteMaulCombatMethod";
import { Ammunition, RangedData, RangedWeapon } from "./ranged/RangedData";
import { Animation } from "../../model/Animation";
import { PathFinder } from "../../model/movement/path/PathFinder";
import type { MovementQueue } from "../../model/movement/MovementQueue";
import type { Location } from "../../model/Location";
import { Misc } from "../../../util/Misc";
import { TaskManager } from "../../task/TaskManager";

type CombatCycleState = {
    cycle: number;
    generation: number;
    target: Mobile;
    method: CombatMethod;
    targetX: number;
    targetY: number;
    targetZ: number;
    routeRequested: boolean;
    attackBlocked: boolean;
    mobilityBlocked: boolean;
    skipPost: boolean;
};

const COMBAT_TARGET_PLAYER_VARP = 1075;

/** Owns one character's target, attack deadline, approach route, and delayed hits. */
export class Combat {
    private readonly hitQueue = new HitQueue(this.character);
    private readonly damageMap = new Map<Player, HitDamageCache>();
    private readonly lastAttack = new Stopwatch();
    private readonly poisonImmunityTimer = new SecondsTimer();
    private readonly fireImmunityTimer = new SecondsTimer();
    private readonly teleblockTimer = new SecondsTimer();
    private readonly prayerBlockTimer = new SecondsTimer();
    private nextAttackCycle = 0;
    private target: Mobile | null = null;
    private autoRetaliating = false;
    private attacker: Mobile | null = null;
    private graniteMaulSpecialQueued = false;
    private method: CombatMethod | null = null;
    private castSpell: CombatSpell | null = null;
    private autoCastSpell: CombatSpell | null = null;
    private previousCast: CombatSpell | null = null;
    private generation = 0;
    private deniedNoticeGeneration = -1;
    private static combatDebugCache?: boolean;
    /** COMBAT_DEBUG=1. Read lazily so argv/env parsing order cannot defeat it. */
    private static get DEBUG(): boolean {
        return (Combat.combatDebugCache ??= process.env.COMBAT_DEBUG === "1");
    }

    public static debugLog(line: string): void {
        if (!Combat.DEBUG) return;
        Combat.writeTrace(line);
    }

    private static traceFile?: any;
    private static writeTrace(line: string): void {
        console.info(line);
        try {
            const fs = require("fs");
            const path = require("path");
            if (!Combat.traceFile) {
                const dir = path.join(process.cwd(), "logs");
                fs.mkdirSync(dir, { recursive: true });
                Combat.traceFile = path.join(dir, "combat-debug.log");
            }
            fs.appendFileSync(Combat.traceFile, line + "\n");
        } catch {
            // console output is enough if the file cannot be written
        }
    }

    private trace(reason: string, target: Mobile): void {
        if (!Combat.DEBUG || !this.character.isPlayer()) return;
        // Bots generate thousands of PvP lines a second and drown out the real player.
        if (this.character.getAsPlayer().isPlayerBot?.() === true) return;
        const me = this.character.getLocation();
        const it = target?.getLocation?.();
        const attacker = this.attacker;
        Combat.writeTrace(
            `[combat] ${this.character.getAsPlayer().getUsername?.()} cycle=${World.getProcessCycle()} ${reason}` +
            ` me=${me?.getX()},${me?.getY()} target=${it?.getX()},${it?.getY()}` +
            ` targetHp=${target?.getHitpoints?.()}` +
            ` myAttacker=${attacker ? (attacker.isNpc?.() ? "npc:" + attacker.getAsNpc?.().getId?.() : "player") : "none"}` +
            ` attackerHp=${attacker?.getHitpoints?.() ?? "-"}` +
            ` attackerReg=${attacker?.isRegistered?.() ?? "-"}` +
            ` pendingIn=${this.hitQueue.hasPendingWork()}` +
            ` queue=${this.character.getMovementQueue().size()}`
        );
    }
    /** Target tile the live route was built for; see shouldRouteToward(). */
    private routedTargetX = Number.MIN_SAFE_INTEGER;
    private routedTargetY = Number.MIN_SAFE_INTEGER;
    private routedTargetZ = Number.MIN_SAFE_INTEGER;
    private lastPreMovementCycle = -1;
    private lastPostMovementCycle = -1;
    private manualMovementCycle = -1;

    public preserveMovementThisCycle(): void {
        this.manualMovementCycle = World.getProcessCycle();
    }
    private cycleState: CombatCycleState | null = null;
    public rangedWeapon: RangedWeapon | null = null;
    public ammunition: Ammunition | null = null;

    constructor(private readonly character: Mobile) {}

    public attack(target: Mobile, autoRetaliation = false): void {
        if (!target || (this.character.isNpc() && !this.character.getAsNpc().getDefinition().doesFightBack())) {
            return;
        }
        const previousTarget = this.target;
        if (previousTarget && previousTarget !== target && this.method) {
            this.method.onCombatEnded(this.character, previousTarget);
        }
        this.generation++;
        this.target = target;
        this.autoRetaliating = autoRetaliation;
        this.method = null;
        this.cycleState = null;
        if (this.character.isPlayer()) TaskManager.cancelTasks(this.character.getIndex());
        this.character.getMovementQueue().reset();
        this.character.setFollowing(null);
        this.character.setPositionToFace(null);
        this.character.setMobileInteraction(target);
        if (this.character.isPlayer()) {
            this.character.getAsPlayer().getPacketSender().sendConfig(COMBAT_TARGET_PLAYER_VARP, target.isPlayer() ? target.getIndex() : -1);
        }
        this.trace("attack() target set", target);
        if (this.character.isNpc()) World.markNpcCombatActive(this.character.getAsNpc(), true);
    }

    public castSpellOn(target: Mobile, spell: CombatSpell): void {
        if (!target || !spell) return;
        this.setCastSpell(spell);
        this.attack(target);
    }

    public preMovementProcess(): void {
        const cycle = World.getProcessCycle();
        if (this.lastPreMovementCycle === cycle) return;
        this.lastPreMovementCycle = cycle;

        if (this.attacker && this.lastAttack.elapsedTime(6000)) {
            this.setUnderAttack(null);
        }

        const target = this.target;
        if (!target) {
            this.cycleState = null;
            return;
        }
        const generation = this.generation;
        const location = target.getLocation();
        const method = this.resolveMethodForCurrentCycle();
        const state: CombatCycleState = {
            cycle,
            generation,
            target,
            method,
            targetX: location.getX(),
            targetY: location.getY(),
            targetZ: location.getZ(),
            routeRequested: false,
            attackBlocked: false,
            mobilityBlocked: false,
            skipPost: false,
        };
        this.cycleState = state;
        this.method = method;

        if (!CombatFactory.validTarget(this.character, target)) {
            this.trace("bail=invalidTarget", target);
            this.cancelIfCurrent(target, generation);
            return;
        }
        if (this.shouldRetreat()) {
            this.cancelIfCurrent(target, generation);
            return;
        }

        const permission = CombatFactory.canAttackPermission(this.character, target, true, method);
        if (permission !== CanAttackResponse.CAN_ATTACK) {
            this.trace(`bail=permission:${CanAttackResponse[permission]}`, target);
            this.handleAttackDenied(permission, target, generation);
            if (!Combat.isTransientDenial(permission) ||
                this.target !== target || this.generation !== generation) {
                return;
            }
            // Keep walking in; postMovementProcess re-checks before landing a hit.
            state.attackBlocked = true;
        }

        this.character.setMobileInteraction(target);

        if (this.manualMovementCycle === cycle && this.character.getMovementQueue().size() > 0) {
            return;
        }

        if (this.character.isNpc() && CombatRange.overlapsEntities(this.character, target)) {
            this.processNpcUnderTarget(state);
            return;
        }

        if (CombatRange.canReach(this.character, method, target)) {
            this.trace("inRange", target);
            this.character.getMovementQueue().reset();
            return;
        }

        const movement = this.character.getMovementQueue();
        if (!movement.getMobility().canMove()) {
            this.trace(`bail=immobile:${movement.getMobility().constructor.name}`, target);
            state.mobilityBlocked = true;
            return;
        }

        if (this.character.isNpc()) {
            movement.setPursuitCheckpoint(PathFinder.naiveEntityDestination(this.character, target));
            state.routeRequested = true;
        } else if (this.shouldRouteToward(movement, location)) {
            this.trace("route", target);
            state.routeRequested = true;
            this.routedTargetX = location.getX();
            this.routedTargetY = location.getY();
            this.routedTargetZ = location.getZ();
            ServerPerf.measurePhase("combat.route", () => CombatRange.route(this.character, method, target));
        }
    }

    /**
     * A path is only recalculated on its final checkpoint, and only when the target
     * has actually moved - turning points earlier in the corridor are preserved, and
     * a stationary target does not need the same route rebuilt every cycle.
     *
     * Two cases sit outside that rule. An empty queue has no path to preserve, so it
     * always routes. A step the clipping map rejected (a door shut across the
     * corridor) invalidates the cached route wherever the actor is standing; a step
     * an entity rejected does not, since the pathfinder cannot see entities and would
     * hand back the identical corridor.
     */
    private shouldRouteToward(movement: MovementQueue, targetLocation: Location): boolean {
        if (movement.size() === 0 || movement.wasRouteInvalidated()) {
            return true;
        }
        if (movement.size() > 1) {
            return false;
        }
        return this.routedTargetX !== targetLocation.getX() ||
            this.routedTargetY !== targetLocation.getY() ||
            this.routedTargetZ !== targetLocation.getZ();
    }

    public postMovementProcess(): void {
        const cycle = World.getProcessCycle();
        if (this.lastPostMovementCycle === cycle) return;
        this.lastPostMovementCycle = cycle;

        const state = this.cycleState;
        if (!state || state.cycle !== cycle || state.skipPost ||
            this.target !== state.target || this.generation !== state.generation) {
            return;
        }

        const { target, method, generation } = state;
        if (!CombatFactory.validTarget(this.character, target)) {
            this.cancelIfCurrent(target, generation);
            return;
        }

        const permission = CombatFactory.canAttackPermission(this.character, target, true, method);
        if (permission !== CanAttackResponse.CAN_ATTACK) {
            this.handleAttackDenied(permission, target, generation);
            return;
        }
        if (state.attackBlocked && CombatRange.canReach(this.character, method, target)) {
            // Denied before movement but in range now; the next cycle re-evaluates.
            return;
        }

        if (!CombatRange.canReach(this.character, method, target)) {
            const location = target.getLocation();
            const targetMoved =
                state.targetX !== location.getX() ||
                state.targetY !== location.getY() ||
                state.targetZ !== location.getZ();
            const movement = this.character.getMovementQueue();
            if (targetMoved || state.mobilityBlocked || movement.didMoveThisCycle()) {
                return;
            }
            if (this.character.isNpc() && state.routeRequested &&
                !movement.wasBlockedByDynamicOccupancy()) {
                this.cancelIfCurrent(target, generation);
                return;
            }
            if (movement.size() > 0) return;
            if (this.character.isPlayer() && (state.routeRequested || movement.wasRouteEvaluated())) {
                if (this.character.getAsPlayer().isPlayerBot?.() !== true) {
                    this.character.getAsPlayer().sendMessage("I can't reach that!");
                }
                this.cancelIfCurrent(target, generation);
            }
            return;
        }

        this.character.getMovementQueue().reset();
        if (cycle < this.nextAttackCycle) {
            this.trace(`cooldown next=${this.nextAttackCycle} in=${this.nextAttackCycle - cycle}`, target);
            this.renewInteraction(target, generation);
            return;
        }
        this.trace(`attacking speed=${method.attackSpeed(this.character)}`, target);
        this.executeAttack(method, target, false, generation, true);
    }

    public hasPendingWork(): boolean {
        return this.target != null || this.attacker != null || this.hitQueue.hasPendingWork();
    }

    public performNewAttack(instant: boolean): boolean {
        const target = this.target;
        if (!target) return false;
        const generation = this.generation;
        const method = this.resolveMethodForCurrentCycle();
        if (!CombatFactory.validTarget(this.character, target)) {
            this.cancelIfCurrent(target, generation);
            return false;
        }
        const permission = CombatFactory.canAttackPermission(this.character, target, true, method);
        if (permission !== CanAttackResponse.CAN_ATTACK) {
            this.handleAttackDenied(permission, target, generation);
            return false;
        }
        if (!CombatRange.canReach(this.character, method, target)) return false;
        this.method = method;
        return this.executeAttack(method, target, instant, generation, false);
    }

    public resolveMethodForCurrentCycle(): CombatMethod {
        return CombatFactory.getMethod(this.character);
    }

    public resolveValidTargetForCurrentCycle(target: Mobile): boolean {
        return CombatFactory.validTarget(this.character, target);
    }

    public resolveCanReachForCurrentCycle(method: CombatMethod, target: Mobile, _skipTargetValidation = false): boolean {
        return CombatRange.canReach(this.character, method, target);
    }

    public setAttackDelay(ticks: number): void {
        this.nextAttackCycle = World.getProcessCycle() + Math.max(0, ticks | 0);
    }

    public extendAttackDelay(ticks: number): void {
        this.nextAttackCycle = Math.max(this.nextAttackCycle, World.getProcessCycle() + Math.max(0, ticks | 0));
    }

    public getAttackDelay(): number {
        return Math.max(0, this.nextAttackCycle - World.getProcessCycle());
    }

    public willAttackBeReadyIn(ticks: number): boolean {
        return this.getAttackDelay() <= Math.max(0, ticks | 0);
    }

    public reset(): void {
        const previousTarget = this.target;
        this.generation++;
        this.target = null;
        this.autoRetaliating = false;
        this.cycleState = null;
        if (previousTarget && this.method) this.method.onCombatEnded(this.character, previousTarget);
        this.method = null;
        this.character.getMovementQueue().reset();
        this.character.setMobileInteraction(null);
        this.character.setPositionToFace(null);
        if (this.character.isPlayer()) this.character.getAsPlayer().getPacketSender().sendConfig(COMBAT_TARGET_PLAYER_VARP, -1);
        this.graniteMaulSpecialQueued = false;
        if (this.character.isNpc()) World.markNpcCombatActive(this.character.getAsNpc(), this.attacker != null);
    }

    public isGraniteMaulSpecialQueued(): boolean { return this.graniteMaulSpecialQueued; }
    public setGraniteMaulSpecialQueued(queued: boolean): void { this.graniteMaulSpecialQueued = queued; }

    public addDamage(entity: Mobile, amount: number): void {
        if (amount <= 0 || entity.isNpc()) return;
        const player = entity as Player;
        const cached = this.damageMap.get(player);
        if (cached) cached.incrementDamage(amount);
        else this.damageMap.set(player, new HitDamageCache(amount));
    }

    public getKiller(clearMap: boolean): Player | null {
        let damage = 0;
        let killer: Player | null = null;
        for (const [player, cached] of this.damageMap) {
            if (!player.isRegistered() || cached.getStopwatch() > CombatConstants.DAMAGE_CACHE_TIMEOUT) continue;
            if (cached.getDamage() > damage) {
                damage = cached.getDamage();
                killer = player;
            }
        }
        if (clearMap) this.damageMap.clear();
        return killer;
    }

    public damageMapContains(player: Player): boolean {
        const cached = this.damageMap.get(player);
        return cached != null && cached.getStopwatch() < CombatConstants.DAMAGE_CACHE_TIMEOUT;
    }

    public getRecentDamagers(): Player[] {
        return [...this.damageMap].flatMap(([player, cached]) =>
            player.isRegistered() && cached.getDamage() > 0 && cached.getStopwatch() < CombatConstants.DAMAGE_CACHE_TIMEOUT
                ? [player] : []
        );
    }

    public getRecentDamagerEntries(): Array<{ player: Player; damage: number }> {
        return [...this.damageMap].flatMap(([player, cached]) =>
            player.isRegistered() && cached.getDamage() > 0 && cached.getStopwatch() < CombatConstants.DAMAGE_CACHE_TIMEOUT
                ? [{ player, damage: cached.getDamage() }] : []
        );
    }

    public getCharacter(): Mobile { return this.character; }
    public getTarget(): Mobile | null { return this.target; }
    public setTarget(target: Mobile | null): void {
        if (target == null) this.reset();
        else this.attack(target);
    }
    public stopAutoRetaliation(): void {
        // A target equal to the current attacker is retaliation, including
        // combat that began before the server started tagging its source.
        if (this.autoRetaliating || this.target === this.attacker) this.reset();
    }
    public getHitQueue(): HitQueue { return this.hitQueue; }
    public getAttacker(): Mobile | null { return this.attacker; }
    public setUnderAttack(attacker: Mobile | null): void {
        this.attacker = attacker;
        this.lastAttack.reset();
        if (this.character.isNpc()) {
            World.markNpcCombatActive(this.character.getAsNpc(), attacker != null || this.target != null);
        }
    }
    public getCastSpell(): CombatSpell | null { return this.castSpell; }
    public setCastSpell(spell: CombatSpell | null): void { this.castSpell = spell; }
    public getAutocastSpell(): CombatSpell | null { return this.autoCastSpell; }
    public setAutocastSpell(spell: CombatSpell | null): void { this.autoCastSpell = spell; }
    public getSelectedSpell(): CombatSpell | null { return this.castSpell ?? this.autoCastSpell; }
    public getPreviousCast(): CombatSpell | null { return this.previousCast; }
    public setPreviousCast(spell: CombatSpell | null): void { this.previousCast = spell; }
    public getRangedWeapon(): RangedWeapon | null { return this.rangedWeapon; }
    public setRangedWeapon(weapon: RangedWeapon | null): void { this.rangedWeapon = weapon; }
    public getAmmunition(): Ammunition | null { return this.ammunition; }
    public setAmmunition(ammunition: Ammunition | null): void { this.ammunition = ammunition; }
    public getRangeAmmoData(): RangedData { return this.ammunition as unknown as RangedData; }
    public setRangeAmmoData(data: RangedData): void { this.ammunition = data as unknown as Ammunition; }
    public getPoisonImmunityTimer(): SecondsTimer { return this.poisonImmunityTimer; }
    public getFireImmunityTimer(): SecondsTimer { return this.fireImmunityTimer; }
    public getTeleblockTimer(): SecondsTimer { return this.teleblockTimer; }
    public getPrayerBlockTimer(): SecondsTimer { return this.prayerBlockTimer; }
    public getLastAttack(): Stopwatch { return this.lastAttack; }

    private shouldRetreat(): boolean {
        if (!this.character.isNpc()) return false;
        const npc = this.character.getAsNpc();
        if (Number(npc.getAttribute("arceuus:darkLureUntil") ?? 0) > Date.now()) return false;
        if (!npc.getCurrentDefinition().doesRetreat()) return false;
        const coordinator = npc.getMovementCoordinator();
        if (coordinator.getCoordinateState() === CoordinateState.RETREATING ||
            npc.getLocation().getDistance(npc.getSpawnPosition()) >=
                npc.getCurrentDefinition().getCombatFollowDistance()) {
            coordinator.setCoordinateState(CoordinateState.RETREATING);
            return true;
        }
        return false;
    }

    private processNpcUnderTarget(state: CombatCycleState): void {
        state.skipPost = true;
        const movement = this.character.getMovementQueue();
        movement.reset();
        const targetBusy = state.target.isPlayer() &&
            (state.target.getCombat().getTarget() != null ||
                state.target.getFollowing?.() != null ||
                TaskManager.hasActiveTask(state.target.getIndex?.(), "MovementTask") ||
                TaskManager.wasTaskActiveThisCycle(state.target.getIndex?.(), "MovementTask"));
        if (targetBusy) return;

        const [offsetX, offsetY] = [[-1, 0], [1, 0], [0, -1], [0, 1]][Misc.getRandom(3)];
        movement.setPursuitCheckpoint(this.character.getLocation().transform(offsetX, offsetY));
    }

    private executeAttack(
        method: CombatMethod,
        target: Mobile,
        bypassDelay: boolean,
        generation: number,
        renew: boolean
    ): boolean {
        const cycle = World.getProcessCycle();
        if (!bypassDelay && cycle < this.nextAttackCycle) {
            if (renew) this.renewInteraction(target, generation);
            return false;
        }

        const response = CombatFactory.canAttack(this.character, method, target, true, true);
        if (response !== CanAttackResponse.CAN_ATTACK) {
            this.trace(`attackDenied=${CanAttackResponse[response]}`, target);
            this.handleAttackDenied(response, target, generation);
            return false;
        }

        if (this.attacker == null) method.onCombatBegan(this.character, target);
        if (target.getCombat().getAttacker() == null) {
            CombatFactory.getMethod(target).onCombatBegan(target, this.character);
        }
        if (!bypassDelay) {
            this.nextAttackCycle = cycle + Math.max(1, method.attackSpeed(this.character) | 0);
        }

        method.start(this.character, target);
        const hits = method.hits(this.character, target);
        if (hits == null) {
            this.trace("hits=null", target);
            return false;
        }
        this.trace(`hits=${hits.length} dmg=[${hits.map((h: any) => h?.getTotalDamage?.()).join(",")}]`, target);
        if (hits.length > 0 && method.type() === CombatType.MELEE) {
            target.performAnimation(new Animation(target.getBlockAnim()));
        }
        for (const hit of hits) CombatFactory.addPendingHit(hit);
        method.finished(this.character, target);

        this.graniteMaulSpecialQueued = false;
        if (this.character.isSpecialActivated()) {
            this.character.setSpecialActivated(false);
            if (this.character.isPlayer()) CombatSpecial.updateBar(this.character.getAsPlayer());
        }
        if (renew && this.target === target && this.generation === generation) {
            if (method.shouldRenew(this.character)) this.renewInteraction(target, generation);
            else this.cancelIfCurrent(target, generation);
        }
        return true;
    }

    private renewInteraction(target: Mobile, generation: number): void {
        if (this.target !== target || this.generation !== generation) return;
        this.generation++;
        this.cycleState = null;
        this.character.setMobileInteraction(target);
    }

    /**
     * Denials that clear on their own: the single-combat gate stays closed only while
     * a delayed hit from the previous fight is still in flight. Pursuit continues and
     * the attack resumes once it lands - cancelling here throws the click away, which
     * is what made attacking a new npc feel unresponsive after a kill.
     */
    private static isTransientDenial(response: CanAttackResponse): boolean {
        return response === CanAttackResponse.ALREADY_UNDER_ATTACK ||
            response === CanAttackResponse.COMBAT_METHOD_NOT_ALLOWED;
    }

    private cancelIfCurrent(target: Mobile, generation: number): void {
        if (this.target === target && this.generation === generation) this.reset();
    }

    private handleAttackDenied(
        response: CanAttackResponse,
        target: Mobile,
        generation: number
    ): void {
        if (this.target !== target || this.generation !== generation) return;
        const player = this.character.isPlayer() ? this.character.getAsPlayer() : null;
        switch (response) {
            case CanAttackResponse.COMBAT_METHOD_NOT_ALLOWED:
                // The weapon/spell is momentarily unusable (no ammo loaded, blowpipe
                // empty, spell unselected). Keep the target so re-equipping resumes;
                // the method itself owns any message and any hard reset.
                return;
            case CanAttackResponse.ALREADY_UNDER_ATTACK:
                // Once per interaction: this is re-checked twice a cycle while pursuing.
                if (this.deniedNoticeGeneration !== generation) {
                    this.deniedNoticeGeneration = generation;
                    player?.sendMessage("You are already under attack!");
                }
                return;
            case CanAttackResponse.LEVEL_DIFFERENCE_TOO_GREAT:
                player?.sendMessage("Your level difference is too great.");
                player?.sendMessage("You need to move deeper into the Wilderness.");
                break;
            case CanAttackResponse.NOT_ENOUGH_SPECIAL_ENERGY:
                if (player) {
                    player.sendMessage("You do not have enough special attack energy left!");
                    player.setSpecialActivated(false);
                    CombatSpecial.updateBar(player);
                }
                break;
            case CanAttackResponse.STUNNED:
                player?.sendMessage("You're currently stunned and cannot attack.");
                break;
            case CanAttackResponse.DUEL_NOT_STARTED_YET:
                player?.sendMessage("The duel has not started yet!");
                break;
            case CanAttackResponse.DUEL_WRONG_OPPONENT:
                player?.sendMessage("This is not your opponent!");
                break;
            case CanAttackResponse.DUEL_MELEE_DISABLED:
                if (player) StatementDialogue.send(player, "Melee has been disabled in this duel!");
                break;
            case CanAttackResponse.DUEL_RANGED_DISABLED:
                if (player) StatementDialogue.send(player, "Ranged has been disabled in this duel!");
                break;
            case CanAttackResponse.DUEL_MAGIC_DISABLED:
                if (player) StatementDialogue.send(player, "Magic has been disabled in this duel!");
                break;
            case CanAttackResponse.TARGET_IS_IMMUNE:
                player?.sendMessage("This npc is currently immune to attacks.");
                break;
        }
        this.cancelIfCurrent(target, generation);
    }
}
