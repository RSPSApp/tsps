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

class TeleportTask extends Task {
    private teleportTick = 0;

    constructor(
        private readonly player: Player,
        private readonly targetLocation: Location,
        private readonly teleportType: TeleportType,
        private readonly onArrival?: () => void
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
        } else if (this.teleportTick === this.teleportType.getStartTick()) {
            TeleportHandler.onTeleporting(this.player);
            this.player.performAnimation(this.teleportType.getEndAnimation());
            this.player.performGraphic(this.teleportType.getEndGraphic());
            this.player.moveTo(this.targetLocation);
            this.onArrival?.();
        } else if (this.teleportTick === this.teleportType.getStartTick() + 2) {
            this.player.getMovementQueue().setBlockMovement(false).reset();
            this.stop();
            return;
        }

        this.teleportTick++;
    }

    stop(): void {
        super.stop();
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
    public static teleport(player: Player, targetLocation: Location, teleportType: TeleportType, wildernessWarning: boolean, onArrival?: () => void): void {
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
        Sounds.sendSound(player, Sound.TELEPORT);
        TaskManager.submit(new TeleportTask(player, targetLocation, teleportType, onArrival));
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

        if (PluginManager.emitCanTeleport(player, wildernessLevelLimit, targetLocation) === false) {
            return false;
        }

        return true;
    }
}
