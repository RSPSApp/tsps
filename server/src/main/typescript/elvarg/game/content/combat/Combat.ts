import { BoatManager } from "../sailing/BoatManager";
import { ChatType } from "../../../net/protocol/ClientProtocol";
import { CombatPosition } from "./CombatPosition";
import { PluginManager } from "../../../plugins/PluginManager";
import { HitDamageCache } from "../../content/combat/hit/HitDamageCache";
import { HitQueue } from "../../content/combat/hit/HitQueue";
import type { Mobile } from "../../entity/impl/Mobile";
import type { Player } from "../../entity/impl/player/Player";
import { CoordinateState } from "../../entity/impl/npc/NPCMovementCoordinator";
import { SecondsTimer } from "../../model/SecondsTimer";
import { PoisonClock } from "./PoisonClock";
import { NpcCombatSounds } from "../../definition/NpcCombatSounds";
import { StatementDialogue } from "../../model/dialogues/entries/impl/StatementDialogue";
import { TickStopwatch } from "../../../util/TickStopwatch";
import { ServerPerf } from "../../../util/ServerPerf";
import { World } from "../../World";
import { CombatConstants } from "./CombatConstants";
import { CombatFactory, CanAttackResponse } from "./CombatFactory";
import { CombatRange } from "./CombatRange";
import { CrossFloor } from "../../CrossFloor";
import { CombatSpecial } from "./CombatSpecial";
import { SpecialAttackTargetingResolver } from "./SpecialAttackTargeting";
import { AccuracyFormulasDpsCalc } from "./formula/AccuracyFormulasDpsCalc";
import { CombatType } from "./CombatType";
import type { CombatSpell } from "./magic/CombatSpell";
import type { CombatMethod } from "./method/CombatMethod";
import { Ammunition, RangedData, RangedWeapon } from "./ranged/RangedData";
import { Animation } from "../../model/Animation";
import type { AnimationStallKind } from "../../model/Animation";
import type { PluginAnimationStallEvent } from "../../../plugins/PluginTypes";
import { getSequenceStall } from "../../cache/NpcAnimationScanner";
import { PathFinder } from "../../model/movement/path/PathFinder";
import type { MovementQueue } from "../../model/movement/MovementQueue";
import type { Location } from "../../model/Location";
import { Misc } from "../../../util/Misc";
import { TaskManager } from "../../task/TaskManager";
import { TimerKey } from "../../../util/timers/TimerKey";

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

/** No attack animation may hold a player longer than this; guards a bad seq decode. */
const MAX_ANIMATION_STALL_TICKS = 5;
const MAX_CONTENT_ANIMATION_STALL_TICKS = 100;

/** Owns one character's target, attack deadline, approach route, and delayed hits. */
export class Combat {
    private readonly hitQueue = new HitQueue(this.character);
    private damageMap: Map<Player, HitDamageCache> | null = null;
    /** The player whose damage `addDamage` recorded last. */
    private lastDamager: Player | null = null;
    private readonly lastAttack = new TickStopwatch();
    // Most NPCs never use these; each SecondsTimer also holds a Stopwatch, so allocate on first use.
    private poisonImmunityTimer: SecondsTimer | null = null;
    private poisonClock: PoisonClock | null = null;
    private fireImmunityTimer: SecondsTimer | null = null;
    private teleblockTimer: SecondsTimer | null = null;
    private prayerBlockTimer: SecondsTimer | null = null;
    private nextAttackCycle = 0;
    private target: Mobile | null = null;
    private autoRetaliating = false;
    private attacker: Mobile | null = null;
    /** Cycle of the last hit an attacker landed on this character, -1 when combat was cleared. */
    private lastAttackedCycle = -1;
    /** Cycle of the last hit a player landed on this character (any damage, splashes included), -1 when never. */
    private lastAttackedByPlayerCycle = -1;
    private specialAttackQueued = false;
    private method: CombatMethod | null = null;
    private castSpell: CombatSpell | null = null;
    private autoCastSpell: CombatSpell | null = null;
    private previousCast: CombatSpell | null = null;
    private generation = 0;
    private deniedNoticeGeneration = -1;
    private foughtNpcNoticeGeneration = -1;
    private foughtNpcNoticeCycle = -1;
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
    private manualMovementUntilCycle = -1;
    /** Cycles spent out of reach with no distance closed and no step taken. */
    private unreachableCycles = 0;
    /** The gap last cycle, or -1 before the first cycle measured against a new target. */
    private unreachableDistance = -1;
    /** 20 cycles (10 s) of no progress: an actor is not held in combat with a target it can never hit. */
    private static readonly UNREACHABLE_GIVE_UP_CYCLES = 20;
    /**
     * OSRS PJ timer: 8 ticks (4.8 s) of single-way protection while a monster is attacking
     * the player, refreshed by each attack and ended early when the monster dies
     * (https://oldschool.runescape.wiki/w/PJ_timer).
     */
    private static readonly PJ_TIMER_MS = 8 * 600;
    /**
     * Player-versus-player keeps the existing 10-tick hold here. Live uses a longer PvP PJ
     * timer (20 ticks in Wilderness singles, 16 on PvP worlds), which is a separate change;
     * the PvM fix must not shorten PvP protection.
     */
    private static readonly PVP_TIMER_MS = 10 * 600;

    public preserveMovementForTicks(ticks = 1): void {
        this.manualMovementUntilCycle = World.getProcessCycle() + Math.max(0, ticks) - 1;
    }

    /**
     * Wiki: Animation stall. The cycle this character's swing animation releases them. A
     * `partial` stall only keeps a click from cutting the animation away - the server still
     * processes movement, and the client withholds the actor's steps until the animation ends,
     * then catches up (the rubber band). A `full` stall also holds their clicks, their movement
     * and, when requested by content, incoming hits until the animation finishes.
     * Only content declares one; seq config cannot.
     */
    private animationStall: {
        untilCycle: number;
        kind: AnimationStallKind;
        holdsHits: boolean;
    } | null = null;
    /**
     * The cycle a swing was armed on, or -1. Armed so only the animations of an actual attack are
     * measured; bounded by cycle so a throw between arming and disarming cannot leak the arm into
     * some later animation.
     */
    private measureAnimationCycle = -1;

    public expectAttackAnimation(): void {
        this.measureAnimationCycle = World.getProcessCycle();
    }

    /**
     * Measures the animation a character just started, from Player.performAnimation — the one
     * place every source of one (styles, specials, spells) arrives. Only an animation an armed
     * swing performed is measured, so a block flinch or a hit effect never stalls anybody, and only
     * one that actually took the place of the previous seq: Player.performAnimation asks here, and
     * not at all for a seq the cache's interrupt priority turned away.
     */
    public onAnimationStarted(animationId: number): void {
        if (animationId === Animation.DEFAULT_RESET_ANIMATION.getId()) {
            // Content cut the animation, so the stall measured from it goes with it.
            this.animationStall = null;
            return;
        }
        if (this.measureAnimationCycle !== World.getProcessCycle()) return;
        // The arm is deliberately not spent here. A special plays its swing through super.start()
        // and then replaces it (Dragon2hSword.SpecialAttack.start), so measuring the first seq held
        // the player for an animation the client had already covered, and the next click cut the
        // special off mid-play. Every seq accepted inside the armed window re-measures, the last
        // one wins, and the caller that armed it disarms as soon as start() returns.
        if (!this.character.isPlayer()) return;

        const sequence = getSequenceStall(animationId);
        const event: PluginAnimationStallEvent = {
            player: this.character.getAsPlayer(),
            animationId,
            ticks: Math.min(Math.max(0, sequence.ticks), MAX_ANIMATION_STALL_TICKS),
            // Every swing animation the client starts is a partial stall: it plays out even when
            // a click drops the target. The seq's step withholding only decides what the client
            // does visually; the server keeps walking the true tile underneath it. A full stall
            // is content, and AnimationStalls.plugin.js rows declare it.
            kind: "partial",
            holdsHits: true,
        };
        PluginManager.emitAnimationStall(event);
        this.animationStall = event.kind === "none" || event.ticks <= 0 ? null : {
            untilCycle: World.getProcessCycle() + event.ticks,
            kind: event.kind,
            holdsHits: event.kind === "full" && event.holdsHits,
        };
    }

    /** Content can hold actions and movement without delaying incoming damage. */
    public setAnimationStall(ticks: number): void {
        if (!Number.isFinite(ticks) || ticks <= 0) return;
        const now = World.getProcessCycle();
        const existing = this.animationStall;
        const activeFull = existing?.kind === "full" && existing.untilCycle > now;
        this.animationStall = {
            untilCycle: Math.max(now + Math.min(MAX_CONTENT_ANIMATION_STALL_TICKS, Math.trunc(ticks)), activeFull ? existing.untilCycle : now),
            kind: "full",
            holdsHits: activeFull && existing.holdsHits,
        };
    }

    /** Ticks before this character may act again; only a full stall holds them at all. */
    public getAnimationStallTicks(): number {
        const stall = this.animationStall;
        if (stall == null || stall.kind !== "full" || stall.untilCycle <= World.getProcessCycle()) return 0;
        return stall.untilCycle - World.getProcessCycle();
    }

    public isAnimationStalled(): boolean {
        return this.getAnimationStallTicks() > 0;
    }

    /**
     * The last cycle a hit on this character is held to, or -1 when nothing holds it. HitQueue
     * consults it as each hit comes due rather than when the hit is queued, so a shot already in
     * the air when the swing starts waits with the ones loosed after it - and a stall stopped short
     * stops holding anything from that tick.
     */
    public getIncomingHitCycle(): number {
        const stall = this.animationStall;
        if (stall == null || !stall.holdsHits || stall.untilCycle <= World.getProcessCycle()) return -1;
        return stall.untilCycle;
    }

    /**
     * True while the swing's animation is still meant to be on screen, whatever has been played
     * over it since: OSRS answers a click that drops the target with no animation at all.
     */
    private animationStillPlaying(): boolean {
        const stall = this.animationStall;
        return stall != null && World.getProcessCycle() < stall.untilCycle;
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
        if (previousTarget !== target) {
            this.manualMovementUntilCycle = -1;
            this.resetUnreachableTracking();
        }
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
        // A retaliation chase isn't the player's click: it follows the run setting.
        if (autoRetaliation) this.character.getMovementQueue().endClickRunOverride();
        this.character.setFollowing(null);
        this.faceTarget(target, true);
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

        if (this.attacker) {
            // Wiki (PJ timer): 8 ticks of protection while a monster is attacking; a kill ends
            // it early (NPC.appendDeath). PvP keeps its longer window for now. Only the attacker
            // expires here: the logout timer runs on to its own 16 ticks. Before the
            // scripted-walk return, so a long plugin walk still lets it expire.
            const timerMs = this.attacker.isNpc() || this.character.isNpc()
                ? Combat.PJ_TIMER_MS
                : Combat.PVP_TIMER_MS;
            if (this.lastAttack.elapsedTime(timerMs)) this.clearAttacker();
        }

        // A plugin scripted this NPC's walk; it owns the movement queue and the
        // attack pauses until the walk finishes (scriptedMovement cleared).
        if (this.character.isNpc() && this.character.getAsNpc().isScriptedMovement()) {
            this.cycleState = null;
            return;
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
        if (this.shouldRetreat(method)) {
            this.cancelIfCurrent(target, generation);
            return;
        }

        const permission = CombatFactory.canAttackPermission(this.character, target, true, method);
        if (permission !== CanAttackResponse.CAN_ATTACK && this.walksInOnFoughtNpc(permission, target, method)) {
            this.trace(`approach=permission:${CanAttackResponse[permission]}`, target);
            state.attackBlocked = true;
        } else if (permission !== CanAttackResponse.CAN_ATTACK) {
            this.trace(`bail=permission:${CanAttackResponse[permission]}`, target);
            this.handleAttackDenied(permission, target, generation);
            if (!this.isTransientDenial(permission) ||
                this.target !== target || this.generation !== generation) {
                return;
            }
            // Keep walking in; postMovementProcess re-checks before landing a hit.
            state.attackBlocked = true;
        }

        if (this.manualMovementUntilCycle >= cycle) {
            // Walking where content sent them (a step between hits): they face where they walk,
            // as a player who clicks a tile does, and turn back to the target once it ends.
            if (this.character.hasFlag?.("combat:keep-facing") !== true) this.character.setMobileInteraction(null);
            return;
        }

        this.faceTarget(target);

        const reachable = CombatRange.canReach(this.character, method, target);
        if (!reachable && CombatPosition.acrossDeck(this.character, target)) {
            // Across a boat's deck the attacker can only close in along the deck: they walk to
            // the deck tile nearest the target, and attack once it's in reach. When the deck
            // takes them no nearer, the attack ends there (rsprox: Attack on a sea creature
            // beyond range from a deck: "I can't reach that!").
            const movement = this.character.getMovementQueue();
            const tile = BoatManager.deckTileToward(this.character, target);
            if (tile && movement.getMobility().canMove()) {
                if (!movement.hasRoute() || this.routedTargetX !== tile.getX() || this.routedTargetY !== tile.getY()) {
                    this.routedTargetX = tile.getX();
                    this.routedTargetY = tile.getY();
                    this.routedTargetZ = tile.getZ();
                    PathFinder.calculateWalkRoute(this.character, tile.getX(), tile.getY());
                }
                state.routeRequested = true;
                return;
            }
            if (movement.size() > 0) return;
            if (this.character.isPlayer() && this.character.getAsPlayer().isPlayerBot?.() !== true) {
                this.character.getAsPlayer().sendMessage("I can't reach that!");
            }
            this.cancelIfCurrent(target, generation);
            return;
        }
        if (reachable) {
            this.resetUnreachableTracking();
        } else if (this.giveUpUnreachableTarget(target, generation)) {
            return;
        }

        // An NPC over its target can't reach it (CombatRange.canReach): it steps off below.
        if (this.character.isNpc() && CombatRange.overlapsEntities(this.character, target)
            && !reachable) {
            this.processNpcUnderTarget(state);
            return;
        }

        if (reachable) {
            this.trace("inRange", target);
            // An NPC flagged combat:close-in (ToA's Akkha) keeps walking in while it attacks
            // from range, until it stands beside its target.
            const closesIn = this.character.isNpc() && this.character.hasFlag?.("combat:close-in") === true
                && !CombatRange.beside(this.character, target);
            if (!closesIn) {
                this.character.getMovementQueue().reset();
                return;
            }
        }

        const movement = this.character.getMovementQueue();
        if (!movement.getMobility().canMove()) {
            this.trace(`bail=immobile:${movement.getMobility().constructor.name}`, target);
            state.mobilityBlocked = true;
            // A frozen player's attack on a target out of reach ends there, as live answers it,
            // still turned to the target for that tick (rsprox 2238 OpPlayer, 3391 OpNpc).
            if (this.character.isPlayer() && this.character.getTimers().has(TimerKey.FREEZE)) {
                if (this.character.getAsPlayer().isPlayerBot?.() !== true) {
                    this.character.getAsPlayer().sendMessage("I can't reach that!");
                }
                const current = this.target === target && this.generation === state.generation;
                this.cancelIfCurrent(target, state.generation);
                if (current) this.character.faceMobileBriefly(target);
            }
            return;
        }

        if (this.character.isNpc()) {
            movement.setPursuitCheckpoint(PathFinder.naiveEntityDestination(this.character, target));
            state.routeRequested = true;
        } else if (this.shouldRouteToward(movement, location, target)) {
            this.trace("route", target);
            state.routeRequested = true;
            this.routedTargetX = location.getX();
            this.routedTargetY = location.getY();
            this.routedTargetZ = location.getZ();
            ServerPerf.measurePhase("combat.route", () => CombatRange.route(this.character, method, target));
        }
    }

    /**
     * A path is only recalculated near its final checkpoint. Same-floor targets may
     * trigger a refresh when they move; cross-floor targets keep the chosen clear-shot
     * route until it finishes, so a wandering target cannot make the player reverse course.
     *
     * Two cases sit outside that rule. An empty queue has no path to preserve, so it
     * always routes. A step the clipping map rejected (a door shut across the
     * corridor) invalidates the cached route wherever the actor is standing; a step
     * an entity rejected does not, since the pathfinder cannot see entities and would
     * hand back the identical corridor.
     */
    private shouldRouteToward(movement: MovementQueue, targetLocation: Location, target: Mobile): boolean {
        if (movement.size() === 0 || movement.wasRouteInvalidated()) {
            return true;
        }
        const attackerLocation = CombatPosition.location(this.character, target);
        const routedTargetLocation = CombatPosition.location(target, this.character);
        const crossFloorTarget = CrossFloor.canCross(attackerLocation, routedTargetLocation) &&
            attackerLocation.getZ() !== routedTargetLocation.getZ();
        // Cross-floor routes end at a carefully selected clear-shot tile. Replacing the final
        // checkpoint whenever a wandering target moves can make the player turn back and forth
        // forever. Finish this route, then select a fresh firing tile when the queue empties.
        if (crossFloorTarget) return false;
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
            // Walking in on an NPC someone else is fighting: out of reach, it is an approach like
            // any other, so a route that runs out still ends in "I can't reach that!" below. A step
            // that arrived this cycle is answered on the next (live: the third line comes the
            // tick after arrival, rsprox 83 t18213, 1098 t4926).
            const stepped = this.character.getMovementQueue().didMoveThisCycle();
            if (!this.walksInOnFoughtNpc(permission, target, method, stepped)) {
                this.handleAttackDenied(permission, target, generation);
                return;
            }
            if (CombatRange.canReach(this.character, method, target)) return;
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
                if (!this.isSafespotted(target)) this.cancelIfCurrent(target, generation);
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
        // A bypassing special must reach executeAttack while the old cooldown is still active.
        // Check the selected method too: an explicit spell can override an armed special.
        const special = this.character.isPlayer() ? this.character.getAsPlayer().getCombatSpecial() : null;
        const bypass = special?.getCombatMethod() === method &&
            CombatSpecial.activeTraitsFor(this.character)?.bypassAttackDelay === true;
        if (cycle < this.nextAttackCycle && !bypass && !this.attackTiming(method, target).ignoreDelay) {
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

    /** What plugins say about the attack timer for an attack on `target` (PluginAttackTimingEvent). */
    /** Who the last attack went at (PluginAttackTimingEvent.newTarget). */
    private lastAttackTarget: Mobile | null = null;

    private attackTiming(method: CombatMethod, target: Mobile): { ignoreDelay: boolean; keepDelay: boolean; minimumDelay: number } {
        const event = {
            attacker: this.character, target, method, ignoreDelay: false, keepDelay: false, minimumDelay: 0,
            newTarget: target !== this.lastAttackTarget,
        };
        PluginManager.emitAttackTiming(event);
        return event;
    }

    public setAttackDelay(ticks: number): void {
        this.nextAttackCycle = World.getProcessCycle() + Math.max(0, ticks | 0);
        this.sendAttackTimer();
    }

    public extendAttackDelay(ticks: number): void {
        this.nextAttackCycle = Math.max(this.nextAttackCycle, World.getProcessCycle() + Math.max(0, ticks | 0));
        this.sendAttackTimer();
    }

    /** The next-attack tick last sent to the player's client (its attack timer). */
    private sentAttackCycle = 0;

    /**
     * Tells the player's client how many ticks remain until their next attack, whenever that
     * changes and lies ahead (an attack, eating, a special). The client counts it down.
     */
    private sendAttackTimer(): void {
        if (!this.character.isPlayer() || this.nextAttackCycle === this.sentAttackCycle) return;
        const remaining = this.getAttackDelay();
        if (remaining <= 0 && this.sentAttackCycle <= World.getProcessCycle()) return;
        this.sentAttackCycle = this.nextAttackCycle;
        this.character.getAsPlayer?.()?.getPacketSender?.()?.sendAttackTimer?.(remaining);
    }

    /**
     * Adds ticks to the attack timer as OSRS does when eating. The timer keeps
     * counting down past zero while idle, so a delay only blocks an attack when
     * it outlasts the time already waited (Wiki: Food).
     */
    public delayAttack(ticks: number): void {
        this.nextAttackCycle += Math.max(0, ticks | 0);
        this.sendAttackTimer();
    }

    public getAttackDelay(): number {
        return Math.max(0, this.nextAttackCycle - World.getProcessCycle());
    }

    public willAttackBeReadyIn(ticks: number): boolean {
        return this.getAttackDelay() <= Math.max(0, ticks | 0);
    }

    /** `resetAnimation` false keeps this tick's animation (a manual spell's cast after it resolves). */
    public reset(resetAnimation = true): void {
        this.clearInteraction(resetAnimation);
        this.character.getMovementQueue().reset();
    }

    /**
     * Clears the current interaction but leaves the walk queue intact, matching the
     * OSRS rule that an inventory item action is a hard interruption which does not
     * stop queued movement (osrs-docs: Entity Interactions).
     */
    public clearInteraction(resetAnimation = true): void {
        this.manualMovementUntilCycle = -1;
        this.resetUnreachableTracking();
        const previousTarget = this.target;
        this.generation++;
        this.target = null;
        this.autoRetaliating = false;
        this.cycleState = null;
        if (previousTarget && this.method) this.method.onCombatEnded(this.character, previousTarget);
        this.method = null;
        this.character.setMobileInteraction(null);
        this.character.setPositionToFace(null);
        if (this.character.isPlayer()) {
            // OSRS never answers a click that drops the target by cutting the attack
            // animation: the client plays it out, which is what an animation stall is.
            if (previousTarget && resetAnimation && !this.animationStillPlaying()) {
                this.character.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
            }
            this.character.getAsPlayer().getPacketSender().sendConfig(COMBAT_TARGET_PLAYER_VARP, -1);
        }
        this.specialAttackQueued = false;
        if (this.character.isNpc()) World.markNpcCombatActive(this.character.getAsNpc(), this.attacker != null);
    }

    public isSpecialAttackQueued(): boolean { return this.specialAttackQueued; }
    public setSpecialAttackQueued(queued: boolean): void { this.specialAttackQueued = queued; }

    public addDamage(entity: Mobile, amount: number): void {
        if (amount <= 0 || entity.isNpc()) return;
        const player = entity as Player;
        this.lastDamager = player;
        const cached = this.damageMap?.get(player);
        if (cached) cached.incrementDamage(amount);
        else (this.damageMap ??= new Map()).set(player, new HitDamageCache(amount));
    }

    /** The player who damaged this character most recently, while that damage still counts. */
    public getLastDamager(): Player | null {
        const player = this.lastDamager;
        return player && player.isRegistered() && this.damageMapContains(player) ? player : null;
    }

    public getKiller(clearMap: boolean): Player | null {
        let damage = 0;
        let killer: Player | null = null;
        for (const [player, cached] of this.damageMap ?? []) {
            if (!player.isRegistered() || cached.getStopwatch() > CombatConstants.DAMAGE_CACHE_TIMEOUT) continue;
            if (cached.getDamage() > damage) {
                damage = cached.getDamage();
                killer = player;
            }
        }
        if (clearMap) this.damageMap = null;
        return killer;
    }

    /** Forgets recorded player damage; a fight that disengaged must not win a later kill. */
    public clearDamageMap(): void {
        this.damageMap = null;
    }

    /** Forgets one player's damage, so the dead do not win a later kill. */
    public removeDamager(player: Player): void {
        this.damageMap?.delete(player);
    }

    public damageMapContains(player: Player): boolean {
        const cached = this.damageMap?.get(player);
        return cached != null && cached.getStopwatch() < CombatConstants.DAMAGE_CACHE_TIMEOUT;
    }

    public getRecentDamagers(): Player[] {
        return [...(this.damageMap ?? [])].flatMap(([player, cached]) =>
            player.isRegistered() && cached.getDamage() > 0 && cached.getStopwatch() < CombatConstants.DAMAGE_CACHE_TIMEOUT
                ? [player] : []
        );
    }

    public getRecentDamagerEntries(): Array<{ player: Player; damage: number }> {
        return [...(this.damageMap ?? [])].flatMap(([player, cached]) =>
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
    /** Whether the current fight began as a reply to an attack (auto-retaliate), not a click. */
    public isAutoRetaliating(): boolean { return this.autoRetaliating; }
    public stopAutoRetaliation(): void {
        // A target equal to the current attacker is retaliation, including
        // combat that began before the server started tagging its source.
        if (this.autoRetaliating || this.target === this.attacker) this.reset();
    }
    public getHitQueue(): HitQueue { return this.hitQueue; }
    public getAttacker(): Mobile | null { return this.attacker; }
    public setUnderAttack(attacker: Mobile | null): void {
        this.lastAttackedCycle = attacker ? World.getProcessCycle() : -1;
        if (attacker?.isPlayer()) this.lastAttackedByPlayerCycle = World.getProcessCycle();
        this.applyAttacker(attacker);
    }
    /** Ticks since a player last hit this character, or Infinity when none has. */
    public ticksSinceAttackedByPlayer(): number {
        return this.lastAttackedByPlayerCycle < 0 ? Infinity : World.getProcessCycle() - this.lastAttackedByPlayerCycle;
    }
    /** Ticks since an attacker last hit this character, or Infinity when it was never hit or combat was cleared. */
    public ticksSinceAttacked(): number {
        return this.lastAttackedCycle < 0 ? Infinity : World.getProcessCycle() - this.lastAttackedCycle;
    }
    private clearAttacker(): void {
        this.applyAttacker(null);
    }

    /**
     * A monster's death ends the PJ timer it held on this character, so the next aggressive
     * monster can engage on the kill tick. The 16-tick logout timer is separate and keeps
     * running from `lastAttackedCycle`.
     */
    public clearAttackerIf(attacker: Mobile): void {
        if (this.attacker === attacker) this.applyAttacker(null);
    }
    private applyAttacker(attacker: Mobile | null): void {
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
    public getPoisonImmunityTimer(): SecondsTimer {
        return this.character.isPlayer() ? this.getPoisonClock() : (this.poisonImmunityTimer ??= new SecondsTimer());
    }
    public getPoisonClock(): PoisonClock {
        return this.poisonClock ??= new PoisonClock(() => {
            const { CombatPoisonEffect } = require("../../task/impl/CombatPoisonEffect") as typeof import("../../task/impl/CombatPoisonEffect");
            CombatPoisonEffect.resume(this.character);
        });
    }
    public getFireImmunityTimer(): SecondsTimer { return this.fireImmunityTimer ??= new SecondsTimer(); }
    public getTeleblockTimer(): SecondsTimer { return this.teleblockTimer ??= new SecondsTimer(); }
    public getPrayerBlockTimer(): SecondsTimer { return this.prayerBlockTimer ??= new SecondsTimer(); }
    public getLastAttack(): TickStopwatch { return this.lastAttack; }

    private shouldRetreat(method: CombatMethod): boolean {
        if (!this.character.isNpc()) return false;
        const npc = this.character.getAsNpc();
        if (Number(npc.getAttribute("arceuus:dark-lure-until") ?? 0) > World.getProcessCycle()) return false;
        // "combat:no-retreat": an NPC content moves about its arena (a raid boss teleported by its own
        // specials) never gives up on its target for being far from where it spawned.
        if (npc.hasFlag("combat:no-retreat")) return false;
        const coordinator = npc.getMovementCoordinator();
        if (coordinator.getCoordinateState() === CoordinateState.RETREATING) return true;

        const definition = npc.getCurrentDefinition();
        const spawn = npc.getSpawnPosition();
        const spawnDistance = npc.getLocation().getDistance(spawn);
        // A low-health retreat (chickens, unicorns) is confined to the max range.
        if (definition.doesRetreat() && spawnDistance >= definition.getCombatFollowDistance()) {
            coordinator.setCoordinateState(CoordinateState.RETREATING);
            return true;
        }

        const target = this.target;
        if (target == null || this.isSafespotted(target)) return false;
        // Instanced content owns its arena and its reset rules (Zulrah's phase moves, the raid
        // rooms): the open-world aggression range must not cut a scripted fight short.
        if (npc.getPrivateArea() != null) return false;

        // Outside its aggression range an NPC cannot attack the target at all, so it loses
        // interest and walks home: the Wiki draws the aggression range from the static spawn
        // (max range + attack range, measured from the spawn footprint), and osrs-docs has an
        // NPC dragged outside its max range lose its target. A target still fighting it (a
        // safespot or a normal engagement) keeps it, so this bounds hunting, not the fight the
        // player started. The footprint already extends `size - 1` north and east.
        const aggressionRange = definition.getAggressionRange(method.attackDistance(npc));
        const crossFloorRangedFight = method.type() !== CombatType.MELEE &&
            CrossFloor.canCross(npc.getLocation(), target.getLocation());
        const targetDistance = CombatRange.footprintDistance(
            spawn,
            definition.getSize(),
            target.getLocation(),
            crossFloorRangedFight,
        );
        if (spawnDistance > definition.getCombatFollowDistance()
            || targetDistance > aggressionRange) {
            coordinator.setCoordinateState(CoordinateState.RETREATING);
            return true;
        }
        return false;
    }

    private processNpcUnderTarget(state: CombatCycleState): void {
        state.skipPost = true;
        const movement = this.character.getMovementQueue();
        movement.reset();
        // Busy means actually moving away (following or walking): merely having a combat
        // target must not count, or a stationary stacked fighter freezes the NPC forever -
        // canReach fails while overlapped, so neither side could ever attack again.
        const targetBusy = state.target.isPlayer() &&
            (state.target.getFollowing?.() != null ||
                TaskManager.hasActiveTask(state.target.getIndex?.(), "MovementTask") ||
                TaskManager.wasTaskActiveThisCycle(state.target.getIndex?.(), "MovementTask"));
        if (targetBusy) return;

        const size = Math.max(1, this.character.getSize() | 0);
        if (size <= 1) {
            const [offsetX, offsetY] = [[-1, 0], [1, 0], [0, -1], [0, 1]][Misc.getRandom(3)];
            movement.setPursuitCheckpoint(this.character.getLocation().transform(offsetX, offsetY));
            return;
        }
        // A large NPC can't clear its target in one step: it walks off the shortest way, a tile a
        // tick, recomputed each tick, until the target stands beside it (rsprox: a gargoyle,
        // 237/01143.txt:85622; a moss giant, 227/00569.txt:3987; the Kalphite Queen, 227/00095.txt).
        // Its own footprint still covers the target mid-step, so the target alone doesn't block it.
        // One that can't move (blocked, scripted, built into scenery) stays put and can't attack.
        if (!movement.getMobility().canMove() || movement.isMovementBlocked()) return;
        if (this.character.getAsNpc().isScriptedMovement() === true) return;
        if (this.character.hasFlag?.(CombatRange.BUILT_INTO_SCENERY_FLAG)) return;
        const step = this.stepOffTarget(state.target, size);
        if (!step) return;
        movement.ignoreOccupantThisCycle(state.target);
        movement.setPursuitCheckpoint(step);
    }

    /**
     * The first tile of the shortest cardinal way out from over `target`: each direction costs the
     * tiles it takes to leave the target outside the footprint; directions the NPC can't step are
     * dropped. Null when it's boxed in.
     */
    private stepOffTarget(target: Mobile, size: number): Location | null {
        const at = this.character.getLocation();
        const them = target.getLocation();
        const movement = this.character.getMovementQueue();
        const options: Array<[number, number, number]> = [
            [-1, 0, at.getX() + size - them.getX()],
            [1, 0, them.getX() - at.getX() + 1],
            [0, -1, at.getY() + size - them.getY()],
            [0, 1, them.getY() - at.getY() + 1],
        ];
        movement.ignoreOccupantThisCycle(target);
        const open = options
            .filter(([dx, dy]) => movement.canWalkTo(at.transform(dx, dy)))
            .sort((a, b) => a[2] - b[2]);
        movement.ignoreOccupantThisCycle(null);
        return open.length ? at.transform(open[0][0], open[0][1]) : null;
    }

    /**
     * Ends combat with a target the actor has stopped trying to get to. Both give-up paths in
     * postMovementProcess are skipped by an actor that cannot move (a stun, a placement, a
     * teleport in transit - `setBlockMovement`) and by a route whose step the mover rejects,
     * which keeps its checkpoint (`MovementQueue.process`), so the queue never empties; without
     * this deadline either side stays in combat with an unreachable target indefinitely.
     *
     * Progress is the gap closing - whoever is closing it - or a step the mover actually accepted
     * last cycle, which out of reach is the pursuit itself. A step counts because the mover is the
     * only one that knows whether the pursuit is still going: a target walked away at the same
     * speed holds the gap open forever on an open route, and live keeps chasing. What spends the
     * budget is the actor getting nowhere - frozen in place, or its step refused - which is how an
     * engagement stuck behind a wall or a crowd finally ends.
     *
     * @return true when the interaction was dropped, so this cycle does nothing else.
     */
    private giveUpUnreachableTarget(target: Mobile, generation: number): boolean {
        if (this.isSafespotted(target)) {
            this.resetUnreachableTracking();
            return false;
        }
        const distance = this.character.getLocation().getDistance(target.getLocation());
        // The first cycle measured only records the starting gap; it is not progress.
        const closing = this.unreachableDistance >= 0 && distance < this.unreachableDistance;
        // Read before this cycle's movement: preMovementProcess runs after beginCycle() has
        // cleared didMoveThisCycle(), so the last cycle's step is the one in question.
        const stepping = this.character.getMovementQueue().didMovePreviousCycle();
        this.unreachableDistance = distance;
        this.unreachableCycles = closing || stepping ? 0 : this.unreachableCycles + 1;
        if (this.unreachableCycles < Combat.UNREACHABLE_GIVE_UP_CYCLES) {
            return false;
        }
        this.trace("bail=unreachableDeadline", target);
        if (this.character.isPlayer() && this.character.getAsPlayer().isPlayerBot?.() !== true) {
            this.character.getAsPlayer().sendMessage("I can't reach that!");
        }
        this.resetUnreachableTracking();
        this.cancelIfCurrent(target, generation);
        return true;
    }

    /**
     * An NPC whose target is fighting it from where it cannot be reached (a safespot) keeps it,
     * facing it and trying its step every cycle, as live does; it does not reset and walk home
     * between the target's hits. Fighting it means attacking it, or having hit it within the
     * attacker window. A target that stops fighting is let go by the usual releases, unless content
     * says it never lets go ("combat:keep-target", the Fight Cave's monsters).
     */
    private isSafespotted(target: Mobile): boolean {
        return this.character.isNpc() &&
            (this.character.hasFlag("combat:keep-target")
                || target.getCombat().getTarget() === this.character || this.attacker === target);
    }

    /** Every new engagement, and every actor with no engagement, starts with full patience. */
    private resetUnreachableTracking(): void {
        this.unreachableCycles = 0;
        this.unreachableDistance = -1;
    }

    private executeAttack(
        method: CombatMethod,
        target: Mobile,
        bypassDelay: boolean,
        generation: number,
        renew: boolean
    ): boolean {
        const cycle = World.getProcessCycle();
        const specialTraits = this.character && this.character.isPlayer()
            ? CombatSpecial.activeTraitsFor(this.character)
            : null;
        const specialMethod = this.character.isPlayer()
            ? this.character.getAsPlayer().getCombatSpecial()?.getCombatMethod()
            : null;
        const bypass = bypassDelay || (specialMethod === method && specialTraits?.bypassAttackDelay === true);
        const timing = this.attackTiming(method, target);
        if (!bypass && !timing.ignoreDelay && cycle < this.nextAttackCycle) {
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
        if (!bypass && !timing.keepDelay) {
            const speed = PluginManager.emitAttackSpeed(this.character, target, method.type(),
                specialTraits?.attackSpeedTicks ?? method.attackSpeed(this.character));
            this.nextAttackCycle = cycle + Math.max(1, speed | 0);
            this.sendAttackTimer();
        } else if (!bypass && timing.minimumDelay > 0) {
            this.nextAttackCycle = Math.max(this.nextAttackCycle, cycle + (timing.minimumDelay | 0));
            this.sendAttackTimer();
        } else if (specialMethod === method && specialTraits?.bypassAttackDelay === true) {
            if (specialTraits.attackSpeedTicks != null) {
                // Quick Smash keeps a cooldown already running and leaves its own minimum delay.
                this.extendAttackDelay(PluginManager.emitAttackSpeed(this.character, target, method.type(),
                    specialTraits.attackSpeedTicks));
            } else {
                // Momentum Throw bypasses the old deadline but starts a full weapon cooldown.
                const speed = PluginManager.emitAttackSpeed(this.character, target, method.type(),
                    method.attackSpeed(this.character));
                this.nextAttackCycle = cycle + Math.max(1, speed | 0);
                this.sendAttackTimer();
            }
        }
        this.lastAttackTarget = target;

        // The swing's own animation is what may stall the character; specials override start() and
        // perform it themselves - many through super.start() first - so the arm stays open across
        // the whole call, and the seq left standing when it returns is the one that is measured.
        this.expectAttackAnimation();
        PluginManager.emitCustomEvent("combat:attack-started", { attacker: this.character, target, method });
        method.start(this.character, target);
        if (this.character.isNpc() && target.isPlayer()) NpcCombatSounds.attack(this.character.getAsNpc(), target.getAsPlayer());
        this.measureAnimationCycle = -1;
        const hits = method.hits(this.character, target);
        if (hits == null) {
            this.trace("hits=null", target);
            PluginManager.emitCustomEvent("combat:attack-finished", { attacker: this.character, target, method });
            return false;
        }
        this.trace(`hits=${hits.length} dmg=[${hits.map((h: any) => h?.getTotalDamage?.()).join(",")}]`, target);
        // A block animation of -1 means the target doesn't block (e.g. the Gemstone Crab).
        if (hits.length > 0 && method.type() === CombatType.MELEE && target.getBlockAnim() >= 0 && method.playsBlockAnimation?.() !== false) {
            target.performAnimation(new Animation(target.getBlockAnim()));
        }
        for (const hit of hits) CombatFactory.addPendingHit(hit);

        // Area/footprint specials strike additional targets with the same method.
        const targeting = CombatSpecial.activeTargetingFor(this.character);
        if (targeting) {
            const resolved = SpecialAttackTargetingResolver.resolve(this.character, target, targeting);
            if (resolved.largeTargetExtraHit) {
                // Wiki: the large-target second hit has 25% reduced accuracy.
                const scale = targeting.largeTargetExtraHit?.accuracyMultiplier ?? 1;
                const extra = AccuracyFormulasDpsCalc.withAccuracyScale(scale, () => method.hits(this.character, target));
                if (extra) for (const hit of extra) CombatFactory.addPendingHit(hit);
            } else {
                for (const secondary of resolved.secondaryTargets) {
                    const secondaryHits = method.hits(this.character, secondary);
                    if (secondaryHits) for (const hit of secondaryHits) CombatFactory.addPendingHit(hit);
                }
            }
        }

        method.finished(this.character, target);
        // The swing has used the weapon, style and special it started with (animation, rolls,
        // xp): what it spent may now change the equipment (a weapon degrading on its last charge).
        PluginManager.emitCustomEvent("combat:attack-finished", { attacker: this.character, target, method });

        this.specialAttackQueued = false;
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
        this.faceTarget(target);
    }

    /**
     * Turns the fighter to its target, unless content holds its facing elsewhere with the
     * "combat:keep-facing" flag (Scurrius keeps facing the food pile he eats from).
     */
    private faceTarget(target: Mobile, clearFacePosition = false): void {
        if (this.character.hasFlag?.("combat:keep-facing") === true) return;
        if (clearFacePosition) this.character.setPositionToFace(null);
        this.character.setMobileInteraction(target);
    }

    /**
     * Denials that clear on their own: the single-combat gate stays closed only while
     * a delayed hit from the previous fight is still in flight. Pursuit continues and
     * the attack resumes once it lands - cancelling here throws the click away, which
     * is what made attacking a new npc feel unresponsive after a kill.
     */
    private isTransientDenial(response: CanAttackResponse): boolean {
        return response === CanAttackResponse.ALREADY_UNDER_ATTACK ||
            response === CanAttackResponse.COMBAT_METHOD_NOT_ALLOWED ||
            // An npc waits its turn; a player is turned away on the spot.
            (response === CanAttackResponse.TARGET_IN_COMBAT && !this.character.isPlayer());
    }

    /**
     * Single combat for a player attacking in melee an NPC someone else is fighting (live, and
     * LostCity player_combat.rs2): the player still walks in. The refusal is said by both
     * checks of the click tick (before and after its step), and again the tick after arrival, where the
     * attack ends. Ranged and magic are refused on the spot, as before (rsprox 2745 t4982).
     * True while the player keeps walking in.
     */
    private walksInOnFoughtNpc(
        permission: CanAttackResponse,
        target: Mobile,
        method: CombatMethod,
        steppedThisCycle = false
    ): boolean {
        if (permission !== CanAttackResponse.TARGET_IN_COMBAT || !this.character.isPlayer() || !target.isNpc()
            || method.type() !== CombatType.MELEE) {
            return false;
        }
        // In reach without having stepped there this cycle: the refusal ends it here.
        if (!steppedThisCycle && CombatRange.canReach(this.character, method, target)) return false;
        const cycle = World.getProcessCycle();
        if (this.foughtNpcNoticeGeneration !== this.generation || this.foughtNpcNoticeCycle === cycle) {
            this.foughtNpcNoticeGeneration = this.generation;
            this.foughtNpcNoticeCycle = cycle;
            this.character.getAsPlayer().sendMessage("Someone else is fighting that.");
        }
        return true;
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
                    // Spam in 1,108 of 1,115 recordings (e.g. 224/01445.txt:12961).
                    player?.getPacketSender().sendTypedMessage(ChatType.SPAM, "I'm already under attack.");
                }
                return;
            case CanAttackResponse.TARGET_IN_COMBAT:
                if (!player) return;
                player.sendMessage(target.isPlayer()
                    ? `Someone else is already fighting ${target.getAsPlayer().getDisplayName()}.`
                    : "Someone else is fighting that.");
                break;
            case CanAttackResponse.LEVEL_DIFFERENCE_TOO_GREAT:
                // One game message on live (rsprox_transcripts/229/02787.txt).
                player?.sendMessage("Your level difference is too great!<br>You need to move deeper into the Wilderness.");
                break;
            case CanAttackResponse.NOT_ENOUGH_SPECIAL_ENERGY:
                if (player) {
                    player.sendMessage("You don't have enough power left.");
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
