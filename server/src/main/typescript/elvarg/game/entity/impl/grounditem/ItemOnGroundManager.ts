import { MAX_STACK_AMOUNT } from "../../../model/container/StackType";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { Sounds } from "../../../Sounds";
import { Sound } from "../../../Sound";
import { PluginManager } from "../../../../plugins/PluginManager";
import { World } from "../../../World"
import { Location } from "../../../model/Location"
import { TaskManager } from "../../../task/TaskManager"
import { Player } from "../player/Player"
import { ItemOnGround } from "./ItemOnGround"
import { State } from "./ItemOnGround"
import { GroundItemRespawnTask } from '../../../task/impl/GroundItemRespawnTask'
import { Item } from "../../../model/Item"
import { PrivateArea } from "../../../model/areas/impl/PrivateArea"
import { Misc } from "../../../../util/Misc"
import { PathFinder } from "../../../model/movement/path/PathFinder";

export class ItemOnGroundManager {
    private static readonly transfers = new WeakSet<ItemOnGround>();
    private static readonly transferPlayers = new WeakSet<Player>();
    // OSRS/Lost City floor-item behavior is owner-only for 100 ticks, then public,
    // with a 300-tick total lifetime for revealable items.
    public static readonly PUBLIC_REVEAL_DELAY: number = 100
    public static readonly DESPAWN_DELAY: number = 300
    // World cycle whose ground-item pass has finished. Until then, an item that has
    // not aged this cycle (e.g. an NPC drop made by a task) still ages once more.
    private static finishedCycle = -1;

    public static onRegionChange(player: Player): void {
        player.getPacketSender().sendGroundItems(
            World.getItems().filter((item) => this.canSee(player, item))
        );
    }

    public static process(): void {
        // Iterate a copy: removing from the live list mid-loop skips the next item's tick.
        for (let item of [...World.getItems()]) {
            item.process();
            if (item.isPendingRemoval()) {
                if (item.respawns()) {
                    TaskManager.submit(new GroundItemRespawnTask(item, item.getRespawnTimer()));
                }
                const index = World.getItems().indexOf(item);
                World.getItems().splice(index, 1);
            }
        }
        this.finishedCycle = World.getProcessCycle();
    }
    

    /** World cycles (the client's tick numbers) at which this stack was created,
     * goes public (0 if never) and despawns (0 if never), per {@link ItemOnGround.process}. */
    public static getTiming(item: ItemOnGround): { createdTick: number; privateUntilTick: number; expiresTick: number } {
        const cycle = World.getProcessCycle();
        const agesThisCycle = item.getAgedCycle() !== cycle && this.finishedCycle !== cycle;
        const createdTick = cycle - item.getTick() - (agesThisCycle ? 1 : 0);
        // The protocol carries int32s; 0 means unknown, so drop a tick past the wrap.
        const tick = (value: number) => value <= 0x7fffffff ? value : 0;
        return {
            createdTick,
            privateUntilTick: item.getState() === State.SEEN_BY_PLAYER && item.getgoesGlobal()
                ? tick(createdTick + this.PUBLIC_REVEAL_DELAY) : 0,
            expiresTick: item.respawns() || item.isStaticSpawn() ? 0 : tick(createdTick + item.getDespawnDelay()),
        };
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
            if (!Location.isSameTile(item_.getPosition(), item.getPosition())) {
                continue;
            }
            if (item_.getPrivateArea() !== item.getPrivateArea()) {
                continue;
            }
            // A stack with its own lifetime keeps it rather than joining a shorter-lived one.
            if (item_.getDespawnDelay() !== item.getDespawnDelay()) {
                continue;
            }

            // Stacks from different owners never merge, private or public: ownership decides
            // who may take the item (an Ironman may only take its own), so one player's drop
            // must not join another player's stack.
            if (item_.getOwner() !== item.getOwner()) {
                continue;
            }

            // Modify the existing item.
            if (item_.getItem().getId() === item.getItem().getId()) {
                if (JSON.stringify(item_.getItem().getMeta() ?? null) !== JSON.stringify(item.getItem().getMeta() ?? null)) {
                    continue;
                }
                let oldAmount = item_.getItem().getAmount();
                if (oldAmount + item.getItem().getAmount() > MAX_STACK_AMOUNT) {
                    continue;
                }
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

    public static pickup(player: Player, groundItem: ItemOnGround): void {
        if (!World.getItems().includes(groundItem) || groundItem.isPendingRemoval() || groundItem.getPrivateArea() !== player.getPrivateArea()) {
            return;
        }
        const itemId = groundItem.getItem().getId();
        const position = groundItem.getPosition();
        const x = position.getX();
        const y = position.getY();

        if (player.getLocation().getZ() !== position.getZ() || !PathFinder.reachedObj(player, position)) {
            player.getMovementQueue().reset();
            return;
        }

        if (!this.canSee(player, groundItem)) return;
        if (PluginManager.emitGroundItemPickup({
            player,
            groundItem,
            groundItemId: itemId,
            clickType: 1,
            location: { x, y, z: position.getZ() },
            handled: false,
        })) return;

        if (this.transferToInventory(player, groundItem) <= 0) return;
        Sounds.sendSound(player, Sound.PICK_UP_ITEM);
        player.getLastItemPickup().reset();
    }

    /** Quantity this inventory can accept, using the same stack identity as addItem. */
    public static inventoryCapacity(player: Player, item: Item): number {
        const inventory = player.getInventory();
        const definition = ItemDefinition.forId(item.getId());
        if (item.getId() < 0 || definition === ItemDefinition.DEFAULT || definition.getId() !== item.getId()) return 0;
        const stackable = definition.isStackable();
        const metadata = JSON.stringify(item.getMeta() ?? null);
        const matchingStack = stackable ? inventory.getItems().find(item =>
            item.getId() === definition.getId() && JSON.stringify(item.getMeta() ?? null) === metadata
        ) : undefined;
        // Use the same stack identity and limit as inventory addition. Stacks
        // with different metadata need a separate slot, even for the same id.
        return stackable
            ? matchingStack ? MAX_STACK_AMOUNT - matchingStack.getAmount()
                : inventory.getFreeSlots() > 0 ? MAX_STACK_AMOUNT : 0
            : inventory.getFreeSlots();
    }

    /** Generic credit/removal bookkeeping; callers retain their own reach and timing rules. */
    public static transferToInventory(player: Player, groundItem: ItemOnGround, source: "pickup" | "telegrab" = "pickup"): number {
        if (this.transfers.has(groundItem) || this.transferPlayers.has(player)
            || !World.getItems().includes(groundItem) || !this.canSee(player, groundItem)) return 0;
        this.transfers.add(groundItem);
        this.transferPlayers.add(player);
        try {
            return this.transferPrepared(player, groundItem, source);
        } finally {
            this.transfers.delete(groundItem);
            this.transferPlayers.delete(player);
        }
    }

    private static transferPrepared(player: Player, groundItem: ItemOnGround, source: "pickup" | "telegrab"): number {
        const inventory = player.getInventory(), item = groundItem.getItem();
        const groundAmount = item.getAmount();
        if (!Number.isSafeInteger(groundAmount) || groundAmount <= 0) return 0;
        const pickedUpAmount = Math.min(groundAmount, this.inventoryCapacity(player, item));
        if (pickedUpAmount <= 0) {
            inventory.full();
            return 0;
        }
        const itemId = item.getId(), metadata = JSON.stringify(item.getMeta() ?? null);
        const position = groundItem.getPosition().clone(), owner = groundItem.getOwner();
        const privateArea = groundItem.getPrivateArea(), state = groundItem.getState();
        const request = {player, groundItem, source, itemId, amount: pickedUpAmount, discard: 0, allow: true, error: null};
        PluginManager.emitCustomEvent("ground-items:take", request);
        // Policies may reduce credit or explicitly discard a bounded remainder.
        // Never apply a decision to a source changed by a callback.
        if (request.allow !== true || request.error != null || !Number.isSafeInteger(request.amount)
            || request.amount <= 0 || request.amount > pickedUpAmount || !Number.isSafeInteger(request.discard)
            || request.discard < 0 || request.amount + request.discard > groundAmount) return 0;
        if (!World.getItems().includes(groundItem) || !this.canSee(player, groundItem)
            || groundItem.getItem() !== item || item.getId() !== itemId || item.getAmount() !== groundAmount
            || JSON.stringify(item.getMeta() ?? null) !== metadata || !groundItem.getPosition().equals(position)
            || groundItem.getPrivateArea() !== privateArea || groundItem.getOwner() !== owner || groundItem.getState() !== state) return 0;
        const amount = Math.min(request.amount, this.inventoryCapacity(player, item));
        if (amount <= 0) {
            inventory.full();
            return 0;
        }
        const matchingAmount = () => inventory.getItems().reduce((total, entry) => total +
            (entry.getId() === itemId && JSON.stringify(entry.getMeta() ?? null) === metadata ? entry.getAmount() : 0), 0);
        const before = matchingAmount();
        const pickedUpItem = item.clone().setAmount(amount);
        inventory.addItem(pickedUpItem);
        const credited = Math.min(amount, Math.max(0, matchingAmount() - before));
        if (credited <= 0) return 0;
        const removed = credited + request.discard;
        if (removed === groundAmount) {
            ItemOnGroundManager.deregister(groundItem);
        } else {
            groundItem.setOldAmount(groundAmount);
            item.decrementAmountBy(removed);
            ItemOnGroundManager.perform(groundItem, OperationType.ALTER);
        }
        PluginManager.emitCustomEvent("ground-items:taken", {player, groundItem, source, itemId, amount: credited, discarded: request.discard});
        return credited;
    }

    public static registers(player: Player, item: Item): ItemOnGround {
        return this.registerLocation(player, item, player.getLocation().clone());
    }

    /** `goesGlobal: false` keeps the stack owner-only; `despawnDelay` replaces {@link DESPAWN_DELAY}. */
    public static registerLocation(player: Player, item: Item, position: Location, privateArea = player.getPrivateArea(),
        options: { goesGlobal?: boolean; despawnDelay?: number; public?: boolean } = {}): ItemOnGround {
        let i = new ItemOnGround(options.public ? State.SEEN_BY_EVERYONE : State.SEEN_BY_PLAYER, player.getUsername(), position, item, options.goesGlobal ?? true,
            -1, privateArea);
        if (options.despawnDelay != null) i.setDespawnDelay(options.despawnDelay);
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

    public static getGroundItem(owner: string | null, id: number, position: Location, privateArea: PrivateArea | null): ItemOnGround | null {
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
            if (!Location.isSameTile(item.getPosition(), position)) {
                continue;
            }
            if (item.getPrivateArea() !== privateArea) {
                continue;
            }
            return item;
        }
        return null;
    }

    public static exists(item: ItemOnGround): boolean {
        return this.getGroundItem(item.getOwner(), item.getItem().getId(), item.getPosition(), item.getPrivateArea()) !== null;
    }

    public static getGroundItemById(id: number, player: Player): ItemOnGround | null {
        const item = World.getItems().find((candidate) => candidate.getId() === id && !candidate.isPendingRemoval());
        if (!item || item.getPrivateArea() !== player.getPrivateArea()) return null;
        if (item.getState() === State.SEEN_BY_PLAYER && !this.isOwner(player.getUsername(), item)) return null;
        return item;
    }

    public static getPrivateAreaGroundItem(id: number, position: Location, privateArea: PrivateArea): ItemOnGround | null {
        return World.getItems().find((item) =>
            !item.isPendingRemoval() &&
            item.getItem().getId() === id &&
            Location.isSameTile(item.getPosition(), position) &&
            item.getPrivateArea() === privateArea,
        ) ?? null;
    }

    /** The stacks on the floor that belong to `username`, private or not. */
    public static ownedBy(username: string): ItemOnGround[] {
        return World.getItems().filter((item) => item != null && !item.isPendingRemoval() && this.isOwner(username, item));
    }

    private static isOwner(username: string, item: ItemOnGround): boolean {
        const owner = item.getOwner();
        return !!owner && Misc.formatNameForProtocol(owner) === Misc.formatNameForProtocol(username);
    }

    public static canSee(player: Player, item: ItemOnGround, includePendingRemoval = false): boolean {
        if (!item || (!includePendingRemoval && item.isPendingRemoval()) || item.getPosition().getZ() !== player.getLocation().getZ()) return false;
        if (player.getPrivateArea() !== item.getPrivateArea() || item.getPosition().getDistance(player.getLocation()) > 64) return false;
        if (item.getState() === State.SEEN_BY_PLAYER) return this.isOwner(player.getUsername(), item);
        return this.isOwner(player.getUsername(), item)
            || item.isStaticSpawn()
            || (item.getItem().isTradeable() && item.getItem().isDropable());
    }


}

export class OperationType {
    public static readonly CREATE = new OperationType();
    public static readonly DELETE = new OperationType();
    public static readonly ALTER = new OperationType();
}
