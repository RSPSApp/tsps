import { Task } from "../Task";
import { Mobile } from "../../entity/impl/Mobile";
import { CombatSpecial } from "../../content/combat/CombatSpecial";
import { GameConstants } from "../../GameConstants";

const DEFAULT_RESTORE_DELAY_TICKS = 50;
const TICK_RATE_MS = Number(GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE ?? 600);

function resolveRestoreDelayTicks(character: Mobile): number {
    // Loaded lazily so this module does not join the Player/QuickPrayers/PrayerHandler/
    // PluginManager require cycle through EquipmentEffects.
    const { applySpecialEnergyRestoreModifiers } =
        require("../../content/combat/EquipmentEffects") as typeof import("../../content/combat/EquipmentEffects");
    return Math.max(1, Math.round(
        applySpecialEnergyRestoreModifiers(character, DEFAULT_RESTORE_DELAY_TICKS)
    ));
}

function ticksToSeconds(delayTicks: number): number {
    return Math.max(1, Math.ceil((Math.max(1, delayTicks) * TICK_RATE_MS) / 1000));
}

function secondsToTicks(seconds: number, character: Mobile): number {
    const normalizedSeconds = Math.max(0, Number(seconds ?? 0));
    if (normalizedSeconds <= 0) {
        return resolveRestoreDelayTicks(character);
    }
    return Math.max(1, Math.ceil((normalizedSeconds * 1000) / TICK_RATE_MS));
}

/**
 * `spec_regen_timer` (script 4721) [period ticks, start tick]: the ring the special attack orb draws
 * while energy is below full. The start tick is the map_clock value (World's process cycle) the
 * current period began on; the client redraws the ring from it when energy changes (script 6060).
 * rsprox captures send it each time a period begins: docs/special-attack-energy.md.
 */
export const SPEC_REGEN_TIMER_SCRIPT = 4721;

function sendRegenTimer(character: Mobile, periodTicks: number, ticksLeft: number): void {
    if (!character?.isPlayer?.()) return;
    const player = character.getAsPlayer();
    // A Player without a session (a save/load in tests, tooling) has no client to draw the ring.
    if (!player.getSession?.()) return;
    const sender = player.getPacketSender?.();
    if (!sender) return;
    // Lazily, so this module does not join World's require cycle.
    const { World } = require("../../World") as typeof import("../../World");
    // A first period shorter than the full one (a timer carried over) began that many ticks ago.
    const elapsed = Math.max(0, periodTicks - ticksLeft);
    sender.sendClientScript(SPEC_REGEN_TIMER_SCRIPT, periodTicks, Math.max(0, World.getProcessCycle() - elapsed));
}

/** The restore task running for each character, so its timer can be read or restarted. */
const runningTasks = new WeakMap<Mobile, RestoreSpecialAttackTask>();

export class RestoreSpecialAttackTask extends Task {
    constructor(private character: Mobile, initialDelayTicks?: number) {
    const restoreDelayTicks = resolveRestoreDelayTicks(character);
    const firstDelayTicks = Math.max(1, Number(initialDelayTicks ?? restoreDelayTicks));
    super(firstDelayTicks);
    this.setDelay(restoreDelayTicks);
    this.character = character;
    runningTasks.set(character, this);
    character.setRecoveringSpecialAttack(true);
    if (character.isPlayer()) {
        character.getAsPlayer().getSpecialAttackRestore().start(ticksToSeconds(firstDelayTicks));
    }
    sendRegenTimer(character, restoreDelayTicks, firstDelayTicks);
    }

    public stop() {
        super.stop();
        if (runningTasks.get(this.character) === this) {
            runningTasks.delete(this.character);
        }
    }

    public execute() {
        if (this.character == null || !this.character.isRegistered() || this.character.getSpecialPercentage() >= 100 || !this.character.isRecoveringSpecialAttack()) {
            this.character.setRecoveringSpecialAttack(false);
            if (this.character?.isPlayer?.()) {
                this.character.getAsPlayer().getSpecialAttackRestore().stop();
            }
            this.stop();
            return;
        }
        // Content may change how much a cycle restores (a league relic); the cycle's length is the modifiers'.
        const regen = { player: this.character, amount: 10 };
        const { PluginManager } = require("../../../plugins/PluginManager");
        PluginManager.emitCustomEvent("combat-special:regenerate", regen);
        let amount = this.character.getSpecialPercentage() + Math.max(0, regen.amount | 0);
        if (amount >= 100) {
            amount = 100;
            this.character.setRecoveringSpecialAttack(false);
            if (this.character.isPlayer()) {
                this.character.getAsPlayer().getSpecialAttackRestore().stop();
            }
            this.stop();
        }
        this.character.setSpecialPercentage(amount);
        const nextDelayTicks = resolveRestoreDelayTicks(this.character);
        this.setDelay(nextDelayTicks);
        if (this.character.isPlayer() && this.character.getSpecialPercentage() < 100) {
            this.character.getAsPlayer().getSpecialAttackRestore().start(ticksToSeconds(nextDelayTicks));
        }
    
        if (this.character.isPlayer()) {
            let player = this.character.getAsPlayer();
            CombatSpecial.updateBar(player);
        }
        // Live starts the orb's next period with each restore, the one that fills the bar included.
        sendRegenTimer(this.character, nextDelayTicks, nextDelayTicks);
    }

    public static initialDelayTicksFromSeconds(seconds: number, character: Mobile): number {
        return secondsToTicks(seconds, character);
    }

    /** Ticks one 10% restore takes for this character now, with modifiers (the Lightbearer) applied. */
    public static restoreDelayTicks(character: Mobile): number {
        return resolveRestoreDelayTicks(character);
    }

    /** The restore task running for this character, or null when its energy isn't restoring. */
    public static running(character: Mobile): RestoreSpecialAttackTask | null {
        const task = runningTasks.get(character);
        return task?.isRunning() ? task : null;
    }
}
