import { TeleBlock } from "../../content/combat/magic/TeleBlock";
import { Player } from "../../entity/impl/player/Player";
import { TeleportType } from "./TeleportType";
import { Task } from "../../task/Task";
import { TaskManager } from "../../task/TaskManager";
import { EffectTimer } from "../EffectTimer";
import { Sound } from "../../Sound";
import { Sounds } from "../../Sounds";
import { Location } from "../Location";
import { Item } from "../Item";
import { PluginManager } from "../../../plugins/PluginManager";
import { Wilderness } from "../../content/wilderness/Wilderness";
import { PlayerRights } from "../rights/PlayerRights";
import { hasGlobalWorldTag } from "../../definition/WorldDefinition";

/** Varbit busy: set while a teleport tablet works (OSRS capture). */
const BUSY_VARBIT = 12393;
/** Ours: a teleport asked about first whose item went before the yes. */
const ITEM_GONE = "You no longer have the item you were teleporting with.";

class TeleportTask extends Task {
    private teleportTick = 0;
    private released = false;

    /** Where the teleport began, and whether in an instance, for "teleport:landed". */
    private readonly from: Location | null;
    private readonly fromInstance: boolean;

    constructor(
        private readonly player: Player,
        private readonly targetLocation: Location,
        private readonly teleportType: TeleportType,
        private readonly onArrival?: () => void,
        private readonly onMiddle?: () => void
    ) {
        super(1, player, true);
        // A bare test entity may have no position; the event then says nothing of a start.
        this.from = player.getLocation?.()?.clone?.() ?? null;
        this.fromInstance = player.getPrivateArea?.() != null;
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
            // Content that remembers where a teleport began (a league's recall item).
            PluginManager.emitCustomEvent("teleport:landed", { player: this.player, from: this.from, fromInstance: this.fromInstance, to: this.targetLocation });
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

/**
 * Teleports, and the rules every teleport passes.
 *
 * A teleport the player chooses (a spell, a tablet or scroll, jewellery, a charged item, a cape, a quest item, a league
 * relic) goes in this order, so content can ask first and nothing is used up on a no:
 *
 *   1. `checkReqs(player, destination, wildernessLevel)`: refuse (with its message) and stop.
 *   2. `confirm(player, destination, go, wildernessLevel, { item, refused })`: content may ask first (the boat-at-sea
 *      warning, All Settings 471); `go` runs at once when nothing asks, else on the player's yes.
 *   3. Inside `go`: use the item up (a charge, the tablet, the runes), then `teleport` (or the teleport's own
 *      movement, such as the home-teleport cast or the ectophial's pour).
 *
 *   if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return;
 *   TeleportHandler.confirm(player, target, (carried) => {
 *       if (charges(carried) <= 0) return;
 *       setCharges(player, carried, charges(carried) - 1);
 *       TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
 *   }, WILDERNESS_LEVEL, { item });
 *
 * - Never spend before `confirm`, and give it the same Wilderness level as `checkReqs` (a yes runs it again).
 * - Pass `item` when the teleport spends one: its id, or the Item itself for one with charges. `go` then gets the Item
 *   the player carries at the yes (a copy if they wore or removed it meanwhile): charge that one.
 * - Pass `refused` to clear what the teleport set before asking (varbit busy) on a no or a failed recheck.
 * - A spell runs its own checks (level, runes) before `confirm`, so it never asks about a cast that can't happen.
 *   Spells cast through the spell engine ask the same way through "spell:teleport-confirm" (SpellTeleports).
 *
 * A move the player doesn't choose as a teleport (a ladder, a lever, an NPC's teleport, a quest's own move, the ring
 * of life's save) calls `teleport` directly. tests/teleport-confirm-coverage.test.cjs lists every file that starts a
 * teleport: a new one either asks, or is listed there with why it needn't; tests/boat-teleport-warning-items.test.cjs
 * holds a case for each that asks.
 */
export class TeleportHandler {

    /**
     * Teleports a player to the target location. A teleport the player chose has been through `checkReqs` and
     * `confirm` first (see the class comment); this only moves them.
     *
     * @param player
     *            The player teleporting.
     * @param targetLocation
     *            The location to teleport to.
     * @param teleportType
     *            The type of teleport.
     * @param _wildernessWarning
     *            Unused. A Wilderness teleport's warning is asked before the teleport starts, by the spell or
     *            tablet that has one (the SpellTeleports plugin), so nothing is used up if the player says no.
     */
    public static teleport(player: Player, targetLocation: Location, teleportType: TeleportType, _wildernessWarning: boolean, onArrival?: () => void, onMiddle?: () => void): void {
        player.getMovementQueue().setBlockMovement(true).reset();
        this.onTeleporting(player);
        player.performAnimation(teleportType.getStartAnimation());
        player.performGraphic(teleportType.getStartGraphic());
        player.setUntargetable(true);
        player.setTeleporting(true);
        const options = teleportType.getOptions();
        const sound = options.sound ?? Sound.TELEPORT;
        if (options.areaSoundRange) {
            // From the player, so only those who can see them (their private area too) hear it.
            Sounds.playAreaSoundAt(player, sound, options.areaSoundRange);
        } else {
            Sounds.sendSound(player, sound);
        }
        if (options.busy) player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
        TaskManager.submit(new TeleportTask(player, targetLocation, teleportType, onArrival, onMiddle));
        player.getClickDelay().reset();
    }

    /**
     * A teleport the player chose (an item's, or a spell's outside the spell engine), once `checkReqs` has passed and
     * before anything is used up: content may ask first ("teleport:confirm" { player, proceed, recheck, refused,
     * handled }: the boat-at-sea warning). `go` (use the item up, then `teleport`) runs at once when nothing asks; after
     * a question it runs on the player's yes, once `checkReqs` passes again.
     *
     * `item` is what the teleport spends: an item id the player must still carry, or the Item itself. For an Item, `go`
     * is given the one the player carries at the yes: the same object, or the copy wearing or removing it made (it
     * holds the charges now). `refused` runs instead of `go` on a no or a failed check (to clear what the item set, such
     * as varbit busy).
     */
    public static confirm(player: Player, destination: Location, go: (item?: Item) => void, wildernessLevelLimit: number = 20,
        { refused, item }: { refused?: () => void; item?: Item | number } = {}): void {
        let current = typeof item === "number" ? undefined : item;
        // The id as asked: a container empties a removed item in place.
        const itemId = typeof item === "number" ? item : item?.getId?.();
        const request = {
            player,
            handled: false,
            proceed: () => go(current),
            recheck: () => {
                if (item !== undefined) {
                    const found = TeleportHandler.carriedNow(player, item, itemId);
                    if (!found) {
                        player.sendMessage(ITEM_GONE);
                        return false;
                    }
                    if (found !== true) current = found;
                }
                return TeleportHandler.checkReqs(player, destination, wildernessLevelLimit);
            },
            refused: () => refused?.(),
        };
        PluginManager.emitCustomEvent("teleport:confirm", request);
        if (!request.handled) request.proceed();
    }

    /** For an id, whether the player carries one; for an Item, that object or else one with its id; false if neither. */
    private static carriedNow(player: Player, item: Item | number, itemId: number | undefined): Item | boolean {
        const items = [...(player.getInventory?.()?.getItems?.() ?? []), ...(player.getEquipment?.()?.getItems?.() ?? [])]
            .filter((carried): carried is Item => carried != null && carried.getId?.() > 0);
        if (typeof item === "number") return items.some((carried) => carried.getId() === item);
        return items.find((carried) => carried === item && carried.getId() === itemId)
            ?? items.find((carried) => carried.getId() === itemId) ?? false;
    }

    public static onTeleporting(player: Player, closeInterfaces: boolean = true): void {
        player.getSkillManager().stopSkillable();
        if (closeInterfaces) player.getPacketSender().sendInterfaceRemoval();
        player.getCombat().reset();
    }

    public static checkReqs(player: Player, targetLocation: Location, wildernessLevelLimit: number = 20, spellName?: string): boolean {
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
                player.sendMessage(TeleBlock.attemptMessage(player));
                return false;
            } else {
                player.getCombat().getTeleblockTimer().stop();
                player.getPacketSender().sendEffectTimer(0, EffectTimer.TELE_BLOCK);
            }
        }

        if (player.getMovementQueue().isMovementBlocked()) {
            return false;
        }

        return TeleportHandler.destinationAllowed(player, targetLocation, wildernessLevelLimit, spellName);
    }

    /**
     * Whether content lets the player go to `targetLocation` ("teleport:can-start", the area's canTeleport, the plugins'
     * onCanTeleport: a league area still locked, a minigame's own rules), with no side effects and none of checkReqs'
     * own checks (busy, Wilderness level, teleblock, blocked movement). For travel that isn't a teleport, such as a
     * charter ship or a ferry, which must not end a teleblock.
     */
    public static destinationAllowed(player: Player, targetLocation: Location, wildernessLevelLimit: number = 20, spellName?: string): boolean {
        // Content can refuse a teleport without changing the area's existing override policy.
        const restriction = { player, destination: targetLocation, wildernessLevelLimit, spellName, allow: null as boolean | null };
        PluginManager.emitCustomEvent("teleport:can-start", restriction);
        if (restriction.allow === false) return false;

        const area = player.getArea();
        const canTeleport = (area ? PluginManager.callArea(area, "canTeleport", player, wildernessLevelLimit, targetLocation) : null)
            ?? PluginManager.emitCanTeleport(player, wildernessLevelLimit, targetLocation, spellName);
        if (canTeleport === false) {
            return false;
        }

        return true;
    }
}
