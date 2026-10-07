import { Player } from "../../entity/impl/player/Player";
import { TeleportType } from "./TeleportType";
import { Task } from "../../task/Task";
import { TaskManager } from "../../task/TaskManager";
import { EffectTimer } from "../EffectTimer";
import { Sound } from "../../Sound";
import { Sounds } from "../../Sounds";
import { Location } from "../Location";
import { PluginManager } from "../../../plugins/PluginManager";
import { Wilderness } from "../../content/wilderness/Wilderness";
import { PlayerRights } from "../rights/PlayerRights";
import { hasGlobalWorldTag } from "../../definition/WorldDefinition";

/** Varbit busy: set while a teleport tablet works (OSRS capture). */
const BUSY_VARBIT = 12393;

class TeleportTask extends Task {
    private teleportTick = 0;
    private released = false;

    constructor(
        private readonly player: Player,
        private readonly targetLocation: Location,
        private readonly teleportType: TeleportType,
        private readonly onArrival?: () => void,
        private readonly onMiddle?: () => void
    ) {
        super(1, player, true);
    }

    execute(): void {
        if (this.teleportTick === this.teleportType.getStartTick() - 2) {
            if (this.teleportType.getMiddleAnim()) {
                this.player.performAnimation(this.teleportType.getMiddleAnim());
            }
            if (this.teleportType.getMiddleGraphic()) {
                this.player.performGraphic(this.teleportType.getMiddleGraphic());
            }
            this.onMiddle?.();
        } else if (this.teleportTick === this.teleportType.getStartTick()) {
            TeleportHandler.onTeleporting(this.player);
            this.player.performAnimation(this.teleportType.getEndAnimation());
            this.player.performGraphic(this.teleportType.getEndGraphic());
            if (this.teleportType.getOptions().busy) {
                this.player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
            }
            this.player.moveTo(this.targetLocation);
            // The player is free on landing (OSRS clears varbit busy that tick): walking, being
            // attacked and clicking work again at once.
            this.release();
            this.onArrival?.();
            if (!this.teleportType.getOptions().repeatEndAnimation) {
                this.stop();
                return;
            }
        } else if (this.teleportTick === this.teleportType.getStartTick() + 1) {
            // Only reached with repeatEndAnimation: the reset is sent again the tick after.
            this.player.performAnimation(this.teleportType.getEndAnimation());
            this.stop();
            return;
        }

        this.teleportTick++;
    }

    stop(): void {
        super.stop();
        this.release();
    }

    /** Ends the teleport's hold on the player; also runs if the task is stopped early. */
    private release(): void {
        if (this.released) return;
        this.released = true;
        this.player.getMovementQueue().setBlockMovement(false).reset();
        this.player.getClickDelay().reset(0);
        this.player.setUntargetable(false);
        this.player.setTeleporting(false);
    }
}

export class TeleportHandler {

    /**
     * Teleports a player to the target location.
     *
     * @param player
     *            The player teleporting.
     * @param targetLocation
     *            The location to teleport to.
     * @param teleportType
     *            The type of teleport.
     */
    public static teleport(player: Player, targetLocation: Location, teleportType: TeleportType, wildernessWarning: boolean, onArrival?: () => void, onMiddle?: () => void): void {
        if (wildernessWarning) {
            let warning = "";
            const wilderness = Wilderness.isInLocation(targetLocation);
            const wildernessLevel = Wilderness.levelAt(targetLocation.getX(), targetLocation.getY());
            if (wilderness) {
                warning += "Are you sure you want to teleport there? ";
                if (wildernessLevel > 0) {
                    warning += "It's in level @red@" + wildernessLevel + "@bla@ wilderness! ";
                    if (Wilderness.isMulti(targetLocation.getX(), targetLocation.getY(), targetLocation.getZ())) {
                        warning += "Additionally, @red@it's a multi zone@bla@. Other players may attack you simultaneously.";
                    } else {
                        warning += "Other players will be able to attack you.";
                    }
                } else {
                    warning += "Other players will be able to attack you.";
                }
                return;
            }
        }

        player.getMovementQueue().setBlockMovement(true).reset();
        this.onTeleporting(player);
        player.performAnimation(teleportType.getStartAnimation());
        player.performGraphic(teleportType.getStartGraphic());
        player.setUntargetable(true);
        player.setTeleporting(true);
        const options = teleportType.getOptions();
        Sounds.sendSound(player, options.sound ?? Sound.TELEPORT);
        if (options.busy) player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
        TaskManager.submit(new TeleportTask(player, targetLocation, teleportType, onArrival, onMiddle));
        player.getClickDelay().reset();
    }

    public static onTeleporting(player: Player, closeInterfaces: boolean = true): void {
        player.getSkillManager().stopSkillable();
        if (closeInterfaces) player.getPacketSender().sendInterfaceRemoval();
        player.getCombat().reset();
    }

    public static checkReqs(player: Player, targetLocation: Location, wildernessLevelLimit: number = 20): boolean {
        if (player.busy()) {
            player.sendMessage("You cannot do that right now.");
            return false;
        }

        if (Wilderness.isIn(player) && player.getWildernessLevel() > wildernessLevelLimit && player.getRights() !== PlayerRights.DEVELOPER &&
            !(player.isPlayerBot() && hasGlobalWorldTag("pvp"))) {
            player.sendMessage(`You must be below level ${wildernessLevelLimit} of Wilderness to use teleportation.`);
            return false;
        }

        if (!player.getCombat().getTeleblockTimer().finished()) {
            if (Wilderness.isIn(player)) {
                player.sendMessage("A magical spell is blocking you from teleporting.");
                return false;
            } else {
                player.getCombat().getTeleblockTimer().stop();
                player.getPacketSender().sendEffectTimer(0, EffectTimer.TELE_BLOCK);
            }
        }

        if (player.getMovementQueue().isMovementBlocked()) {
            return false;
        }

        const area = player.getArea();
        const canTeleport = (area ? PluginManager.callArea(area, "canTeleport", player, wildernessLevelLimit, targetLocation) : null)
            ?? PluginManager.emitCanTeleport(player, wildernessLevelLimit, targetLocation);
        if (canTeleport === false) {
            return false;
        }

        return true;
    }
}
