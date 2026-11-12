import type { Player } from "../../../entity/impl/player/Player";
import { EffectTimer } from "../../../model/EffectTimer";
import { PrayerHandler } from "../../PrayerHandler";

/**
 * The Tele Block effect on a player, shared by the spell and the monsters that cast it.
 *
 * Wiki (Teleport Block): 5 minutes, halved when Protect from Magic is up as the spell lands.
 * rsprox captures (Elder Chaos druid, recordings 435, 437, 438): the target is told at the cast
 * "A Tele Block spell has been cast on you by <caster>. It will expire in <time>." in purple,
 * warned "Your Tele Block will expire in 30 seconds.", and a teleport attempt while blocked says
 * "A teleport block has been cast on you. It should wear off in <time>."
 */
export class TeleBlock {
    public static readonly DURATION_SECONDS = 300;
    public static readonly PROTECTED_DURATION_SECONDS = 150;
    public static readonly WARNING_SECONDS = 30;
    /** Set once the 30 second warning was sent for the running block. */
    public static readonly WARNED_ATTRIBUTE = "tele-block:warned";

    private static readonly COLOUR = "<col=c356ef>";

    public static isBlocked(player: Player): boolean {
        return !player.getCombat().getTeleblockTimer().finished();
    }

    /** "5 minutes", "2 minutes, 30 seconds", "1 minute, 27 seconds" - the captured wording. */
    public static describe(totalSeconds: number): string {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const minutes = Math.floor(seconds / 60);
        const rest = seconds % 60;
        const parts: string[] = [];
        if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
        if (rest > 0 || parts.length === 0) parts.push(`${rest} ${rest === 1 ? "second" : "seconds"}`);
        return parts.join(", ");
    }

    /**
     * Starts (or restarts) the block and tells the victim. Callers decide whether an active block may be recast.
     * `duration` replaces the spell's own (a monster's block that lasts less).
     */
    public static apply(victim: Player, casterName: string, duration?: number): number {
        const seconds = duration ?? (victim.getPrayerActive()[PrayerHandler.PROTECT_FROM_MAGIC]
            ? TeleBlock.PROTECTED_DURATION_SECONDS
            : TeleBlock.DURATION_SECONDS);
        victim.getCombat().getTeleblockTimer().start(seconds);
        victim.setAttribute(TeleBlock.WARNED_ATTRIBUTE, false);
        victim.getPacketSender().sendEffectTimer(seconds, EffectTimer.TELE_BLOCK);
        victim.sendMessage(
            `${TeleBlock.COLOUR}A Tele Block spell has been cast on you by ${casterName}. It will expire in ${TeleBlock.describe(seconds)}.</col>`
        );
        return seconds;
    }

    public static remove(player: Player): void {
        player.getCombat().getTeleblockTimer().stop();
        player.getPacketSender().sendEffectTimer(0, EffectTimer.TELE_BLOCK);
    }

    /** What a teleport attempt says while blocked. */
    public static attemptMessage(player: Player): string {
        const remaining = player.getCombat().getTeleblockTimer().secondsRemaining();
        return `A teleport block has been cast on you. It should wear off in ${TeleBlock.describe(remaining)}.`;
    }

    public static warn(player: Player): void {
        player.setAttribute(TeleBlock.WARNED_ATTRIBUTE, true);
        player.sendMessage(`${TeleBlock.COLOUR}Your Tele Block will expire in ${TeleBlock.WARNING_SECONDS} seconds.`);
    }
}
