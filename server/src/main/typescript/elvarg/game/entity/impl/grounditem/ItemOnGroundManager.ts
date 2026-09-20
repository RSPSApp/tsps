import { World } from "../../../World"
import { Location } from "../../../model/Location"
import { TaskManager } from "../../../task/TaskManager"
import { Player } from "../player/Player"
import { ItemOnGround } from "./ItemOnGround"
import { State } from "./ItemOnGround"
import { GroundItemRespawnTask } from '../../../task/impl/GroundItemRespawnTask'
import { Item } from "../../../model/Item"
//import { Optional } from "java.util"

export class ItemOnGroundManager {
    // OSRS/Lost City floor-item behavior is owner-only for 100 ticks, then public,
    // with a 300-tick total lifetime for revealable items.
    public static readonly PUBLIC_REVEAL_DELAY: number = 100
    public static readonly DESPAWN_DELAY: number = 300

    public static onRegionChange(player: Player): void {
        player.getPacketSender().sendGroundItems(
            World.getItems().filter((item) => this.canSee(player, item))
        );
    }

    public static process(): void {
        for (let item of World.getItems()) {
            item.process();
            if (item.isPendingRemoval()) {
                if (item.respawns()) {
                    TaskManager.submit(new GroundItemRespawnTask(item, item.getRespawnTimer()));
                }
                const index = World.getItems().indexOf(item);
                World.getItems().splice(index, 1);
            }
        }
    }
    

    public static perform(item: ItemOnGround, type: OperationType): void {
        switch (item.getState()) {
            case State.SEEN_BY_PLAYER:
                let owner = World.getPlayerByName(item.getOwner())
                if (owner != null) {
                    ItemOnGroundManager.performPlayer(owner, item, type)
                }
                break;
            case State.SEEN_BY_EVERYONE:
                World.forEachNetworkPlayer((player) => {
                    ItemOnGroundManager.performPlayer(player, item, type);
                });
                break;
            default:
                break;
        }
    }
    public static performPlayer(player: Player, item: ItemOnGround, type?: OperationType): void {
        if (item.isPendingRemoval()) {
            type = OperationType.DELETE;
        }
        if (player?.isPlayerBot?.() === true) {
            return;
        }
        // Skip stale/disconnected sessions to avoid write-time crashes while broadcasting ground-item updates.
        if (!World.isPlayerSessionConnected(player)) {
            return;
        }
        if (!this.canSee(player, item, type === OperationType.DELETE))
            return;
        switch (type) {
            case OperationType.ALTER:
                player.getPacketSender().alterGroundItem(item);
                break;
            case OperationType.DELETE:
                player.getPacketSender().deleteGroundItem(item);
                break;
            case OperationType.CREATE:
                player.getPacketSender().createGroundItem(item);
                break;
            default:
                // Never crash the game loop on a malformed ground-item operation.
                console.warn(
                    "[ItemOnGroundManager] Unsupported operation (" + String(type) + ") on: " + item.toString()
                );
                return;
        }
    }
    public static register(item: ItemOnGround) {
        // Check for merge with existing stackables..
        if (item.getItem().getDefinition().isStackable()) {
            if (this.merge(item)) {
                return;
            }
        }

        // We didn't need to modify a previous item.
        // Simply register the given item to the world..
        World.getItems().push(item);
        ItemOnGroundManager.perform(item, OperationType.CREATE);
    }

    public static merge(item: ItemOnGround): boolean {
        let iterator = World.getItems().values();
        for (let item_ of iterator) {
            if (item_ == null || item_.isPendingRemoval() || item_ === item) {
                continue;
            }
            if (!item_.getPosition().equals(item.getPosition())) {
                continue;
            }

            // Check if the ground item is private...
            // If we aren't the owner, we shouldn't modify it.
            if (item_.getState() === State.SEEN_BY_PLAYER) {
                let flag = true;
                if (item_.getOwner() && item.getOwner()) {
                    if (item_.getOwner() === item.getOwner()) {
                        flag = false;
                    }
                }
                if (flag) {
                    continue;
                }
            }

            // Modify the existing item.
            if (item_.getItem().getId() === item.getItem().getId()) {
                let oldAmount = item_.getItem().getAmount();
                item_.getItem().incrementAmountBy(item.getItem().getAmount());
                item_.setOldAmount(oldAmount);
                item_.setTick(0);
                ItemOnGroundManager.perform(item_, OperationType.ALTER);
                return true;
            }
        }
        return false;
    }
    public static deregister(item: ItemOnGround) {
        item.setPendingRemoval(true);
        ItemOnGroundManager.perform(item, OperationType.DELETE);
    }

    public static registers(player: Player, item: Item): ItemOnGround {
        return this.registerLocation(player, item, player.getLocation().clone());
    }

    public static registerLocation(player: Player, item: Item, position: Location): ItemOnGround {
        let i = new ItemOnGround(State.SEEN_BY_PLAYER, player.getUsername(), position, item, true,
            -1, player.getPrivateArea());
        this.register(i);
        return i;
    }

    public static registerNonGlobal(player: Player, item: Item) {
        this.registerNonGlobals(player, item, player.getLocation().clone());
    }

    public static registerNonGlobals(player: Player, item: Item, position: Location) {
        this.register(new ItemOnGround(State.SEEN_BY_PLAYER, player.getUsername(), position, item, false, -1, player.getPrivateArea()));
    }

    public static registerGlobal(player: Player, item: Item) {
        this.register(new ItemOnGround(State.SEEN_BY_EVERYONE, player.getUsername(), player.getLocation().clone(), item, false, -1, player.getPrivateArea()));
    }

    public static getGroundItem(owner: string | null, id: number, position: Location): ItemOnGround | null {
        let iterator = World.getItems().values();
        for (let item of iterator) {
            if (item == null || item.isPendingRemoval()) {
                continue;
            }
            if (item.getState() === State.SEEN_BY_PLAYER) {
                if (!owner || !this.isOwner(owner, item)) {
                    continue;
                }
            }
            if (id !== item.getItem().getId()) {
                continue;
            }
            if (!item.getPosition().equals(position)) {
                continue;
            }
            return item;
        }
        return null;
    }

    public static exists(item: ItemOnGround): boolean {
        return this.getGroundItem(item.getOwner(), item.getItem().getId(), item.getPosition()) !== null;
    }

    private static isOwner(username: string, item: ItemOnGround): boolean {
        return item.getOwner() === username;
    }

    private static canSee(player: Player, item: ItemOnGround, includePendingRemoval = false): boolean {
        if (!item || (!includePendingRemoval && item.isPendingRemoval()) || item.getPosition().getZ() !== player.getLocation().getZ()) return false;
        if (player.getPrivateArea() !== item.getPrivateArea() || item.getPosition().getDistance(player.getLocation()) > 64) return false;
        if (item.getState() === State.SEEN_BY_PLAYER) return this.isOwner(player.getUsername(), item);
        return this.isOwner(player.getUsername(), item)
            || (item.getItem().isTradeable() && item.getItem().isDropable());
    }


}

export class OperationType {
    public static readonly CREATE = new OperationType();
    public static readonly DELETE = new OperationType();
    public static readonly ALTER = new OperationType();
}
