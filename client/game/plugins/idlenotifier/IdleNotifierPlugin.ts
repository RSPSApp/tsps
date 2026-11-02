import type { Actor, Client, NPC, Player, WorldPoint } from "@runelite/api/Client";
import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged, NpcChanged, GameTick } from "@runelite/api/events";
import * as AnimationID from "@runelite/api/gameval/AnimationID";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier } from "@runelite/client/Notifier";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { SkillId } from "../../../rs/skill/skills";
import type { HitsplatEventPayload } from "../../GameRenderer";
import type { OsrsClient } from "../../OsrsClient";
import { IdleNotifierConfig } from "./IdleNotifierConfig";
import { IDLE_NOTIFIER_ANIMATIONS } from "./idleAnimations";

/** Except Scarab Mage, but they are with other monsters. */
const HIGHEST_MONSTER_ATTACK_SPEED = 8;
const FISHING_SPOT = "Fishing spot";

type NotifyClient = { notify(message: string): void };

/**
 * RuneLite 1.13.5 Idle Notifier: a notification when you stop skilling, leave combat or stop
 * moving, and when hitpoints, prayer, run energy, oxygen or special attack cross a threshold.
 *
 * RuneLite reacts to AnimationChanged and InteractingChanged; this client has neither event, so
 * the local player's animation and interaction target are read every game tick and the same
 * handlers run when they change.
 */
export class IdleNotifierPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Idle Notifier",
        description: "Send a notification when going idle, or when HP/Prayer reaches a threshold",
        tags: ["health", "hitpoints", "notifications", "prayer"],
        enabledByDefault: false,
        configKey: "idlenotifierplugin",
    };

    static config = IdleNotifierConfig;

    readonly config = inject(ConfigManager).getConfig(IdleNotifierConfig);
    private readonly client: Client;
    private readonly notifier: NotifyClient;
    private readonly osrsClient: OsrsClient | undefined;
    /** Overridable wall clock (RuneLite's Instant.now). */
    now: () => number = () => Date.now();

    private lastAnimating: number | null = null;
    private lastAnimation = -1;
    private lastInteracting: number | null = null;
    /** The interaction key of the NPC last interacted with (RuneLite keeps the Actor). */
    private lastInteract: number | null = null;
    private lastMoving = 0;
    private lastPosition: WorldPoint | null = null;
    private notifyPosition = false;
    private notifyHitpoints = true;
    private notifyPrayer = true;
    private shouldNotifyLowEnergy = false;
    private shouldNotifyHighEnergy = false;
    private notifyOxygen = true;
    private lastSpecEnergy = 1000;
    private lastCombatCountdown = 0;
    private lastInteractWasCombat = false;
    private ready = false;
    /** What the polled AnimationChanged / InteractingChanged last saw. */
    private seenAnimation: number | null = null;
    private seenInteracting: number | null = null;

    constructor(client?: Client, notifier?: NotifyClient) {
        super();
        if (client) {
            this.client = client;
        } else {
            this.osrsClient = inject<OsrsClient>(CLIENT_TOKEN);
            this.client = new ClientImpl(this.osrsClient);
        }
        this.notifier = notifier ?? new Notifier(this.osrsClient!);
    }

    protected async startUp(): Promise<void> {
        this.seenAnimation = null;
        this.seenInteracting = null;
    }

    /** RuneLite's onAnimationChanged for the local player. */
    onAnimationChanged(animation: number): void {
        if (this.client.getGameState() !== GameState.LOGGED_IN) return;
        if (IDLE_NOTIFIER_ANIMATIONS.has(animation)) {
            this.resetTimers();
            this.lastAnimation = animation;
            this.lastAnimating = this.now();
        } else if (animation === -1 || animation === AnimationID.LUNAR_HUMAN_MAGIC_SUMMON2) {
            // RuneLite counts Summon2 as busy only with the Bake Pie spotanim, which this client
            // can't read back; otherwise it falls through to -1.
            this.lastAnimating = this.now();
        } else {
            // On unknown animation simply assume the animation is invalid and dont throw notification
            this.lastAnimation = -1;
            this.lastAnimating = null;
        }
    }

    /** RuneLite's onInteractingChanged for the local player. */
    onInteractingChanged(target: Actor | null): void {
        if (target) {
            this.lastInteract = null;
        } else {
            this.lastInteracting = this.now();
        }
        if (target && isNpc(target)) this.checkNpcInteraction(target);
    }

    onNpcChanged(event: NpcChanged): void {
        const interacting = this.client.getLocalPlayer()?.getInteracting();
        if (interacting && isNpc(interacting) && interacting.getIndex() === event.getNpc().index) {
            this.checkNpcInteraction(interacting);
        }
    }

    onGameStateChanged(event: GameStateChanged): void {
        this.lastInteracting = null;
        switch (event.getGameState()) {
            case GameState.LOGIN_SCREEN:
                this.resetTimers();
                break;
            case GameState.LOGGING_IN:
            case GameState.HOPPING:
            case GameState.CONNECTION_LOST:
                this.ready = true;
                break;
            case GameState.LOGGED_IN:
                if (this.ready) {
                    this.ready = false;
                    this.resetTimers();
                }
                break;
        }
    }

    /** RuneLite's onHitsplatApplied: a hitsplat on the local player. */
    onHitsplat(event: HitsplatEventPayload): void {
        const local = this.osrsClient?.controlledPlayerServerId;
        if (event.targetType === "player" && local !== undefined && event.targetId === local) {
            this.lastCombatCountdown = HIGHEST_MONSTER_ATTACK_SPEED;
        }
    }

    onGameTick(_event?: GameTick): void {
        const local = this.client.getLocalPlayer();
        if (local) this.pollActorEvents(local);
        const waitDuration = Number(this.config.getIdleNotificationDelay()) || 0;
        this.lastCombatCountdown = Math.max(this.lastCombatCountdown - 1, 0);

        if (
            !local ||
            // If user has clicked in the last second then they're not idle so don't send idle notification
            this.now() - this.client.getMouseLastPressedMillis() < 1000 ||
            this.client.getKeyboardIdleTicks() < 10
        ) {
            this.resetTimers();
            return;
        }

        if (this.checkAnimationIdle(waitDuration, local)) {
            this.notify(this.config.animationIdle(), "You are now idle!");
        }
        if (this.checkMovementIdle(waitDuration, local)) {
            this.notify(this.config.movementIdle(), "You have stopped moving!");
        }
        if (this.checkInteractionIdle(waitDuration, local)) {
            this.notify(
                this.config.interactionIdle(),
                this.lastInteractWasCombat ? "You are now out of combat!" : "You are now idle!",
            );
        }
        if (this.checkLowHitpoints()) {
            this.notify(this.config.getHitpointsNotification(), "You have low hitpoints!");
        }
        if (this.checkLowPrayer()) {
            this.notify(this.config.getPrayerNotification(), "You have low prayer!");
        }
        if (this.checkLowEnergy()) {
            this.notify(this.config.getLowEnergyNotification(), "You have low run energy!");
        }
        if (this.checkHighEnergy()) {
            this.notify(this.config.getHighEnergyNotification(), "You have restored run energy!");
        }
        if (this.checkLowOxygen()) {
            this.notify(this.config.getOxygenNotification(), "You have low oxygen!");
        }
        if (this.checkFullSpecEnergy()) {
            this.notify(this.config.getSpecNotification(), "You have restored spec energy!");
        }
    }

    private pollActorEvents(local: Player): void {
        const animation = local.getAnimation();
        if (animation !== this.seenAnimation) {
            this.seenAnimation = animation;
            this.onAnimationChanged(animation);
        }
        const target = local.getInteracting();
        const key = target ? target.getInteractionKey() : -1;
        if (key !== this.seenInteracting) {
            this.seenInteracting = key;
            this.onInteractingChanged(target);
        }
    }

    private notify(enabled: unknown, message: string): void {
        if (enabled === true) this.notifier.notify(message);
    }

    private checkNpcInteraction(target: NPC): void {
        const actions = target.getComposition()?.getActions() ?? [];
        if (actions.includes("Attack")) {
            // Player is most likely in combat with attack-able NPC
            this.resetTimers();
            this.lastInteract = target.getInteractionKey();
            this.lastInteracting = this.now();
            this.lastInteractWasCombat = true;
        } else if (target.getName()?.includes(FISHING_SPOT)) {
            // Player is fishing
            this.resetTimers();
            this.lastInteract = target.getInteractionKey();
            this.lastInteracting = this.now();
            this.lastInteractWasCombat = false;
        }
    }

    private checkFullSpecEnergy(): boolean {
        const currentSpecEnergy = this.client.getVarpValue(VarPlayerID.SA_ENERGY);
        const threshold = (Number(this.config.getSpecEnergyThreshold()) || 0) * 10;
        if (threshold === 0) {
            this.lastSpecEnergy = currentSpecEnergy;
            return false;
        }
        // Check if we have regenerated over the threshold, and that the regen was small enough.
        const notify = this.lastSpecEnergy < threshold && currentSpecEnergy >= threshold
            && currentSpecEnergy - this.lastSpecEnergy <= 100;
        this.lastSpecEnergy = currentSpecEnergy;
        return notify;
    }

    private checkLowOxygen(): boolean {
        const threshold = Number(this.config.getOxygenThreshold()) || 0;
        if (threshold === 0) return false;
        if (threshold >= this.client.getVarbitValue(VarbitID.FOSSIL_UNDERWATER_OXYGEN) * 0.1) {
            if (!this.notifyOxygen) {
                this.notifyOxygen = true;
                return true;
            }
        } else {
            this.notifyOxygen = false;
        }
        return false;
    }

    private checkLowHitpoints(): boolean {
        const threshold = Number(this.config.getHitpointsThreshold()) || 0;
        if (threshold === 0) return false;
        if (this.client.getRealSkillLevel(SkillId.Hitpoints) > threshold) {
            const hitpoints = this.client.getBoostedSkillLevel(SkillId.Hitpoints)
                + this.client.getVarbitValue(VarbitID.NZONE_ABSORB_POTION_EFFECTS);
            if (hitpoints <= threshold) {
                if (!this.notifyHitpoints) {
                    this.notifyHitpoints = true;
                    return true;
                }
            } else {
                this.notifyHitpoints = false;
            }
        }
        return false;
    }

    private checkLowPrayer(): boolean {
        const threshold = Number(this.config.getPrayerThreshold()) || 0;
        if (threshold === 0) return false;
        if (this.client.getRealSkillLevel(SkillId.Prayer) > threshold) {
            if (this.client.getBoostedSkillLevel(SkillId.Prayer) <= threshold) {
                if (!this.notifyPrayer) {
                    this.notifyPrayer = true;
                    return true;
                }
            } else {
                this.notifyPrayer = false;
            }
        }
        return false;
    }

    private checkLowEnergy(): boolean {
        const threshold = Number(this.config.getLowEnergyThreshold()) || 0;
        if (threshold >= 100) return false;
        if (Math.trunc(this.client.getEnergy() / 100) <= threshold) {
            if (this.shouldNotifyLowEnergy) {
                this.shouldNotifyLowEnergy = false;
                return true;
            }
        } else {
            this.shouldNotifyLowEnergy = true;
        }
        return false;
    }

    private checkHighEnergy(): boolean {
        const threshold = Number(this.config.getHighEnergyThreshold()) || 0;
        if (threshold === 0) return false;
        if (Math.trunc(this.client.getEnergy() / 100) >= threshold) {
            if (this.shouldNotifyHighEnergy) {
                this.shouldNotifyHighEnergy = false;
                return true;
            }
        } else {
            this.shouldNotifyHighEnergy = true;
        }
        return false;
    }

    private checkInteractionIdle(waitDuration: number, local: Player): boolean {
        if (this.lastInteract === null) return false;
        const interact = local.getInteracting();
        if (!interact) {
            if (
                this.lastInteracting !== null &&
                this.now() >= this.lastInteracting + waitDuration &&
                this.lastCombatCountdown === 0
            ) {
                this.lastInteract = null;
                this.lastInteracting = null;
                // prevent animation notifications from firing too
                this.lastAnimation = -1;
                this.lastAnimating = null;
                return true;
            }
        } else {
            this.lastInteracting = this.now();
        }
        return false;
    }

    private checkAnimationIdle(waitDuration: number, local: Player): boolean {
        if (this.lastAnimation === -1) return false;
        if (local.getAnimation() === -1) {
            if (this.lastAnimating !== null && this.now() >= this.lastAnimating + waitDuration) {
                this.lastAnimation = -1;
                this.lastAnimating = null;
                // prevent interaction notifications from firing too
                this.lastInteract = null;
                this.lastInteracting = null;
                return true;
            }
        } else {
            this.lastAnimating = this.now();
        }
        return false;
    }

    private checkMovementIdle(waitDuration: number, local: Player): boolean {
        const position = local.getWorldLocation();
        if (!this.lastPosition) {
            this.lastPosition = position;
            return false;
        }
        if (samePoint(this.lastPosition, position)) {
            if (this.notifyPosition && local.getAnimation() === -1 && this.now() >= this.lastMoving + waitDuration) {
                this.notifyPosition = false;
                // Return true only if we weren't just breaking out of an animation
                return this.lastAnimation === -1;
            }
        } else {
            this.notifyPosition = true;
            this.lastPosition = position;
            this.lastMoving = this.now();
        }
        return false;
    }

    private resetTimers(): void {
        const local = this.client.getLocalPlayer();
        const gameState = this.client.getGameState();
        // Reset animation idle timer
        this.lastAnimating = null;
        if (gameState === GameState.LOGIN_SCREEN || !local || local.getAnimation() !== this.lastAnimation) {
            this.lastAnimation = -1;
        }
        // Reset interaction idle timer
        this.lastInteracting = null;
        const interacting = local?.getInteracting();
        if (gameState === GameState.LOGIN_SCREEN || !local || (interacting?.getInteractionKey() ?? null) !== this.lastInteract) {
            this.lastInteract = null;
        }
    }
}

function isNpc(actor: Actor): actor is NPC {
    return typeof (actor as NPC).getComposition === "function";
}

function samePoint(a: WorldPoint, b: WorldPoint): boolean {
    return a.x === b.x && a.y === b.y && a.plane === b.plane;
}
