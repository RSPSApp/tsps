import { Sound } from "../../../Sound";
import { Sounds } from "../../../Sounds";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { ShopCurrency, ShopDefinition } from "../../../definition/ShopDefinition";
import { Item } from "../../Item";
import { PlayerStatus } from "../../PlayerStatus";
import { Task } from "../../../task/Task";
import { TaskManager } from "../../../task/TaskManager";
import { PluginManager } from "../../../../plugins/PluginManager";
import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";
import { Misc } from "../../../../util/Misc";
import { ShopIdentifiers } from "../../../../util/ShopIdentifiers";
import { encodeShopClose, encodeShopOpen } from "../../../../net/protocol/ClientProtocol";
import { PlayerSave } from "../../../entity/impl/player/persistence/PlayerSave";

export interface ShopItemContainerAction {
    kind: "value" | "buy_sell" | "x";
    containerId: number;
    slot: number;
    itemId: number;
    amount: number;
}

export interface ShopCurrencyHandler {
    amount(player: any): number;
    add(player: any, amount: number): void;
    remove(player: any, amount: number): void;
    name: string;
    /** The inventory item the currency is paid in, if it is one. */
    itemId?: number;
}

interface RuntimeShop {
    definition: ShopDefinition;
    originalAmounts: Map<number, number>;
    itemRestockTicks: Map<number, number>;
    itemPrices: Map<number, number>;
    stock: Map<number, number>;
    order: number[];
    originalSlotCount: number;
    changeTimers: Map<number, number>;
}

interface DisplayEntry {
    itemId: number;
    amount: number;
}

class ShopRestockTask extends Task {
    constructor() {
        super(1);
    }

    public execute(): void {
        if (!ShopManager.restockAll()) {
            this.stop();
        }
    }
}

export class ShopManager {
    public static readonly SHOP_INTERFACE_ID = 3824;
    public static readonly INVENTORY_INTERFACE_ID = 3823;
    public static readonly ITEMS_INTERFACE_ID = 3900;
    public static readonly MAIN_INTERFACE_ID = 300;
    public static readonly SIDE_INTERFACE_ID = 301;

    private static readonly NAME_INTERFACE_ID = 3901;
    private static readonly SCROLL_INTERFACE_ID = 29995;
    private static readonly MAX_SHOP_ITEMS = 1000;
    private static readonly MAX_ACTION_AMOUNT = 5000;
    private static readonly SALES_TAX = 0.85;
    private static readonly BLOOD_MONEY_SHOP_IDS = [13, 14, 27];
    /**
     * The quantity row (Value, Buy-1/5/10/50) sets varbit 6348, which the
     * cache scripts read to make an item's left-click "Value" or "Buy N".
     */
    private static readonly QUANTITY_VARBIT = 6348;
    private static readonly QUANTITY_MODE_BY_BUTTON = new Map([[5, 0], [8, 1], [10, 2], [12, 3], [14, 4]]);
    private static readonly QUANTITY_BY_MODE = [0, 1, 5, 10, 50];
    private static readonly QUANTITY_MODE_ATTRIBUTE = "shop:quantity-mode";
    private static readonly POINTS_ATTRIBUTE = "shop:points";
    private static readonly shopsById = new Map<number, RuntimeShop>();
    private static readonly activeShopByPlayer = new WeakMap<object, number>();
    private static readonly activeTargetByPlayer = new WeakMap<object, number>();
    private static readonly viewersByShopId = new Map<number, Set<any>>();
    private static restockTaskRunning = false;
    private static readonly currencyHandlers = new Map<string, ShopCurrencyHandler>();

    public static registerCurrency(name: string, handler: ShopCurrencyHandler): void {
        if (!name || !handler || typeof handler.amount !== "function" || typeof handler.add !== "function" || typeof handler.remove !== "function") {
            throw new Error(`Invalid shop currency registration: ${name}`);
        }
        this.currencyHandlers.set(name, handler);
    }

    public static registerItemCurrency(
        itemId: number,
        options?: { name?: string; aliases?: string[] }
    ): void {
        if (!Number.isInteger(itemId) || itemId <= 0) {
            throw new Error(`Invalid item shop currency: ${itemId}`);
        }
        const name =
            options?.name ??
            ItemDefinition.forId(itemId)?.getName?.() ??
            `Item ${itemId}`;
        const handler: ShopCurrencyHandler = {
            name,
            itemId,
            amount: (player) =>
                Number(player?.getInventory?.()?.getAmount?.(itemId) ?? 0),
            add: (player, amount) => player?.getInventory?.()?.adds?.(itemId, amount),
            remove: (player, amount) =>
                player?.getInventory?.()?.deleteNumber?.(itemId, amount),
        };
        for (const key of [name, ...(options?.aliases ?? [])]) {
            if (typeof key === "string" && key.trim()) {
                this.registerCurrency(key.trim().toUpperCase(), handler);
            }
        }
    }

    public static initialize(): void {
        PlayerSave.persistAttribute(this.QUANTITY_MODE_ATTRIBUTE);
        this.reload();
    }

    public static reload(): number {
        this.shopsById.clear();
        for (const definition of ShopDefinition.all()) {
            this.shopsById.set(definition.getId(), this.createRuntimeShop(definition));
        }

        for (const shopId of Array.from(this.viewersByShopId.keys())) {
            if (!this.shopsById.has(shopId)) {
                for (const player of Array.from(this.viewersByShopId.get(shopId) ?? [])) {
                    this.close(player);
                }
                continue;
            }
            this.refresh(shopId);
        }
        return this.shopsById.size;
    }

    public static open(
        player: any,
        shopId: number,
        resetScroll = true,
        targetUid = (161 << 16) | 16
    ): boolean {
        const shop = this.shopsById.get(shopId);
        if (!player || !shop) {
            return false;
        }
        if (PluginManager.emitCanShop(player, shopId) === false) {
            return true;
        }

        this.setActiveShop(player, shopId, targetUid);
        return this.openInterface(player, shop, resetScroll, targetUid);
    }

    public static close(player: any): void {
        if (!player) {
            return;
        }
        const shopId = this.activeShopByPlayer.get(player);
        if (!Number.isInteger(shopId)) {
            return;
        }
        const viewers = this.viewersByShopId.get(shopId!);
        viewers?.delete(player);
        if (viewers?.size === 0) {
            this.viewersByShopId.delete(shopId!);
        }
        this.activeShopByPlayer.delete(player);
        this.activeTargetByPlayer.delete(player);
        player.getSession?.().sendClientPacket?.(encodeShopClose());
    }

    public static processPlayer(player: any): void {
        if (
            player?.isPlayerBot?.() ||
            !this.activeShopByPlayer.has(player)
        ) {
            return;
        }
        if (
            !this.isOpen(player)
        ) {
            this.close(player);
        }
    }

    public static handleItemContainerAction(
        player: any,
        action: ShopItemContainerAction
    ): boolean {
        const shop = this.currentShop(player);
        if (!shop) {
            return false;
        }

        const fromShop = action.containerId === this.ITEMS_INTERFACE_ID;
        const fromInventory = action.containerId === this.INVENTORY_INTERFACE_ID;
        if (!fromShop && !fromInventory) {
            return false;
        }

        if (fromShop) {
            const entry = this.itemAtDisplaySlot(shop, action.slot);
            if (!entry) {
                return true;
            }
            const packetItemId = this.toUnsignedShort(action.itemId);
            const itemId = packetItemId > 0 && packetItemId === entry.itemId
                ? packetItemId
                : entry.itemId;
            if (action.kind === "value") {
                this.priceCheck(player, shop, itemId, true);
            } else if (action.kind === "x") {
                player.setEnteredAmountAction({
                    execute: (amount: number) => this.buyItem(player, shop, itemId, amount),
                });
                player.getPacketSender().sendEnterAmountPrompt(
                    "How many would you like to buy?"
                );
            } else {
                this.buyItem(player, shop, itemId, action.amount);
            }
            return true;
        }

        const inventory = player.getInventory();
        if (
            !Number.isInteger(action.slot) ||
            action.slot < 0 ||
            action.slot >= inventory.capacity()
        ) {
            return true;
        }
        const inventoryItem = inventory.getItems()?.[action.slot];
        if (!inventoryItem || inventoryItem.getId() <= 0) {
            return true;
        }
        const itemId = inventoryItem.getId();
        if (action.kind === "value") {
            this.priceCheck(player, shop, itemId, false, inventoryItem);
        } else if (action.kind === "x") {
            player.setEnteredAmountAction({
                execute: (amount: number) => this.sellItem(player, shop, inventoryItem, amount),
            });
            player.getPacketSender().sendEnterAmountPrompt(
                "How many would you like to sell?"
            );
        } else {
            this.sellItem(player, shop, inventoryItem, action.amount);
        }
        return true;
    }

    public static handleWidgetAction(player: any, packet: {
        groupId: number;
        childId: number;
        buttonNum: number;
        option?: string;
        slot?: number;
        itemId?: number;
    }): boolean {
        if (!this.isOpen(player)) return false;
        const mode = this.QUANTITY_MODE_BY_BUTTON.get(packet.childId);
        if (packet.groupId === this.MAIN_INTERFACE_ID && mode !== undefined) {
            this.setQuantityMode(player, mode);
            return true;
        }
        if (packet.slot == null) return false;
        const option = packet.option?.trim().toLowerCase() ?? "";
        const selected = this.QUANTITY_BY_MODE[this.quantityMode(player)];
        const amount = this.actionAmount(packet.buttonNum, option) ??
            (packet.groupId === this.MAIN_INTERFACE_ID && packet.buttonNum === 1 && !option && selected > 0 ? selected : null);
        const examine = packet.buttonNum === 10 || option === "examine";

        if (packet.groupId === this.MAIN_INTERFACE_ID && packet.childId === 16) {
            const slot = packet.slot - 1;
            const shop = this.currentShop(player);
            const item = shop ? this.itemAtDisplaySlot(shop, slot) : null;
            // The stock can shift (sold-in items leave), so the clicked slot
            // must still hold the item the client showed there.
            if (!item || (packet.itemId != null && packet.itemId > 0 && packet.itemId !== item.itemId)) return true;
            if (examine) {
                const definition = ItemDefinition.forId(item.itemId);
                player.sendMessage(definition.getExamine() || definition.getName());
            } else {
                this.handleItemContainerAction(player, {
                    kind: amount != null ? "buy_sell" : "value",
                    containerId: this.ITEMS_INTERFACE_ID,
                    slot,
                    itemId: item.itemId,
                    amount: amount ?? 0,
                });
            }
            return true;
        }

        if (packet.groupId === this.SIDE_INTERFACE_ID && packet.childId === 0) {
            const item = player.getInventory().getItems()[packet.slot];
            if (!item || item.getId() < 0) return true;
            if (examine) {
                const definition = ItemDefinition.forId(item.getId());
                player.sendMessage(definition.getExamine() || definition.getName());
            } else {
                this.handleItemContainerAction(player, {
                    kind: amount != null ? "buy_sell" : "value",
                    containerId: this.INVENTORY_INTERFACE_ID,
                    slot: packet.slot,
                    itemId: item.getId(),
                    amount: amount ?? 0,
                });
            }
            return true;
        }
        return false;
    }

    /** The player's open shop; `stock` is in display order, so an entry's index is its display slot. */
    public static getOpenShop(player: any): {
        name: string; currency: string; stock: Array<{ itemId: number; amount: number; price: number }>;
    } | null {
        const shop = this.currentShop(player);
        if (!shop) return null;
        return {
            name: shop.definition.getName(),
            currency: this.currencyName(shop.definition.getCurrency()),
            stock: this.displayEntries(shop).map((entry) => ({
                ...entry, price: this.itemPrice(shop, ItemDefinition.forId(entry.itemId)),
            })),
        };
    }

    private static quantityMode(player: any): number {
        const mode = Number(player.getAttribute?.(this.QUANTITY_MODE_ATTRIBUTE) ?? 0);
        return Number.isInteger(mode) && mode >= 0 && mode < this.QUANTITY_BY_MODE.length ? mode : 0;
    }

    private static setQuantityMode(player: any, mode: number): void {
        player.setAttribute?.(this.QUANTITY_MODE_ATTRIBUTE, mode);
        const shop = this.currentShop(player);
        if (shop) {
            // Reopening rebuilds the stock, and with it each item's left-click op.
            this.openInterface(player, shop, false, this.activeTargetByPlayer.get(player) ?? ((161 << 16) | 16));
        }
    }

    public static actionAmount(button: number, option?: string): number | null {
        const named = /(?:buy|sell)[ -](1|5|10|50)$/i.exec(option?.trim() ?? "");
        if (named) return Number(named[1]);
        return ({ 2: 1, 3: 5, 4: 10, 5: 50 } as Record<number, number>)[button] ?? null;
    }

    public static restockAll(): boolean {
        let pending = false;
        for (const shop of this.shopsById.values()) {
            if (this.restockShop(shop)) {
                pending = true;
            }
        }
        if (!pending) {
            this.restockTaskRunning = false;
        }
        return pending;
    }

    private static createRuntimeShop(definition: ShopDefinition): RuntimeShop {
        const originalAmounts = new Map<number, number>();
        const itemRestockTicks = new Map<number, number>();
        const itemPrices = new Map<number, number>();
        const stock = new Map<number, number>();
        const order: number[] = [];
        const seen = new Set<number>();

        for (const entry of definition.getOriginalStock()) {
            originalAmounts.set(
                entry.id,
                (originalAmounts.get(entry.id) ?? 0) + entry.amount
            );
            stock.set(entry.id, (stock.get(entry.id) ?? 0) + entry.amount);
            if (entry.restockTicks != null) {
                itemRestockTicks.set(entry.id, entry.restockTicks);
            }
            if (entry.price != null) {
                itemPrices.set(entry.id, entry.price);
            }
            if (!seen.has(entry.id)) {
                seen.add(entry.id);
                order.push(entry.id);
            }
        }

        return {
            definition,
            originalAmounts,
            itemRestockTicks,
            itemPrices,
            stock,
            order,
            originalSlotCount: definition.getOriginalStock().length,
            changeTimers: new Map(),
        };
    }

    private static currentShop(player: any): RuntimeShop | null {
        if (!this.isOpen(player)) {
            this.close(player);
            return null;
        }
        const shopId = this.activeShopByPlayer.get(player);
        return Number.isInteger(shopId)
            ? this.shopsById.get(shopId!) ?? null
            : null;
    }

    private static isOpen(player: any): boolean {
        return player?.getStatus?.() === PlayerStatus.SHOPPING &&
            (player?.getInterfaceId?.() === this.SHOP_INTERFACE_ID ||
                player?.getInterfaceId?.() === this.MAIN_INTERFACE_ID);
    }

    private static setActiveShop(player: any, shopId: number, targetUid: number): void {
        this.close(player);
        this.activeShopByPlayer.set(player, shopId);
        this.activeTargetByPlayer.set(player, targetUid);
        const viewers = this.viewersByShopId.get(shopId) ?? new Set<any>();
        viewers.add(player);
        this.viewersByShopId.set(shopId, viewers);
    }

    private static openInterface(
        player: any,
        shop: RuntimeShop,
        _resetScroll: boolean,
        targetUid = (161 << 16) | 16
    ): boolean {
        const sender = player.getPacketSender();
        const opening =
            !this.isOpen(player);

        const stock = this.displayEntries(shop).map((entry, slot) => {
            const definition = ItemDefinition.forId(entry.itemId);
            const price = definition ? this.itemPrice(shop, definition) : 0;
            return {
                slot, itemId: entry.itemId, quantity: entry.amount,
                defaultQuantity: shop.originalAmounts.get(entry.itemId) ?? 0,
                priceEach: price, sellPrice: Math.max(1, Math.floor(price * this.SALES_TAX)),
            };
        });
        player.setInterfaceId(this.MAIN_INTERFACE_ID);
        player.setStatus(PlayerStatus.SHOPPING);
        sender.sendVarbit(this.QUANTITY_VARBIT, this.quantityMode(player));
        sender.sendSubInterface(targetUid, this.MAIN_INTERFACE_ID, 0)
            .sendSubInterface((161 << 16) | 79, this.SIDE_INTERFACE_ID, 1)
            .sendInterfaceScript(1074, [516, shop.definition.getName(), this.currencyItemId(shop.definition.getCurrency()), 0, 1])
            .sendInterfaceFlagsRange((this.MAIN_INTERFACE_ID << 16) | 16, 0, 299, 1662)
            .sendInterfaceScript(149, [this.SIDE_INTERFACE_ID << 16, 93, 4, 7, 0, -1, "Value", "Sell 1", "Sell 5", "Sell 10", "Sell 50"])
            .sendInterfaceFlagsRange(this.SIDE_INTERFACE_ID << 16, 0, 27, 1086)
            .sendItemContainer(player.getInventory(), this.INVENTORY_INTERFACE_ID);
        player.getSession().sendClientPacket(encodeShopOpen(
            String(shop.definition.getId()), shop.definition.getName(),
            this.currencyItemId(shop.definition.getCurrency()), this.isGeneralStore(shop), 1, 1, stock
        ));
        if (opening) Sounds.sendSound(player, Sound.CONTAINER_OPEN);
        return true;
    }

    private static refresh(shopId: number): void {
        const shop = this.shopsById.get(shopId);
        const viewers = this.viewersByShopId.get(shopId);
        if (!shop || !viewers) {
            return;
        }
        for (const player of Array.from(viewers)) {
            if (
                !this.isOpen(player) ||
                this.activeShopByPlayer.get(player) !== shopId
            ) {
                this.close(player);
                continue;
            }
            this.openInterface(
                player,
                shop,
                false,
                this.activeTargetByPlayer.get(player) ?? ((161 << 16) | 16)
            );
        }
    }

    /**
     * The stock in slot order. An item the shop stocks keeps its slot at 0
     * when sold out, as in OSRS; items players sold in leave when gone.
     */
    private static displayEntries(shop: RuntimeShop): DisplayEntry[] {
        const entries: DisplayEntry[] = [];
        for (const itemId of shop.order) {
            const amount = shop.stock.get(itemId) ?? 0;
            if (amount > 0 || shop.originalAmounts.has(itemId)) {
                entries.push({ itemId, amount });
            }
        }
        return entries;
    }

    private static itemAtDisplaySlot(
        shop: RuntimeShop,
        slot: number
    ): DisplayEntry | null {
        return Number.isInteger(slot) && slot >= 0
            ? this.displayEntries(shop)[slot] ?? null
            : null;
    }

    private static priceCheck(
        player: any,
        shop: RuntimeShop,
        itemId: number,
        fromShop: boolean,
        item?: any
    ): void {
        if (!fromShop) {
            // A note sells as the item it stands for.
            itemId = ItemDefinition.forId(itemId).unNote();
        }
        if (!fromShop && shop.definition.getCurrency() === "COINS" && this.isBloodMoneyShopItem(itemId)) {
            player.sendMessage("PK shop items cannot be sold for coins.");
            return;
        }
        if (!fromShop && !this.buysItem(shop, itemId)) {
            player.sendMessage(
                "You cannot sell this item to this shop."
            );
            return;
        }
        const definition = ItemDefinition.forId(itemId);
        let price = this.itemPrice(shop, definition);
        if (!fromShop) {
            if (!item?.isSellable?.()) {
                player.sendMessage(
                    "This item cannot be sold to a shop."
                );
                return;
            }
            if (price > 1) {
                price = Math.floor(price * this.SALES_TAX);
            }
        }
        if (price <= 0) {
            player.sendMessage("This item has no value.");
            return;
        }
        player.sendMessage(
            `${definition.getName()}${fromShop ? " currently costs " : ": shop will buy for "}` +
            `${Misc.insertCommasToNumber(String(price))} x ` +
            `${this.currencyName(shop.definition.getCurrency())}.`
        );
    }

    private static buyItem(
        player: any,
        shop: RuntimeShop,
        itemId: number,
        amount: number
    ): void {
        const definition = ItemDefinition.forId(itemId);
        const price = this.itemPrice(shop, definition);
        if (price <= 0) {
            return;
        }

        let quantity = Math.min(this.normalizeAmount(amount), this.MAX_ACTION_AMOUNT);
        if (quantity <= 0) {
            return;
        }
        const available = shop.stock.get(itemId) ?? 0;
        if (available <= 0) {
            player.sendMessage(
                "This item is currently out of stock. Come back later."
            );
            return;
        }
        quantity = Math.min(
            quantity,
            Math.floor(
                this.currencyAmount(player, shop.definition.getCurrency()) / price
            ),
            available
        );
        if (quantity <= 0) {
            player.sendMessage("You can't afford that.");
            return;
        }

        const inventory = player.getInventory();
        if (definition.isStackable?.()) {
            if (!inventory.containsNumber(itemId) && inventory.getFreeSlots() <= 0) {
                inventory.full();
                return;
            }
        } else {
            quantity = Math.min(quantity, inventory.getFreeSlots());
            if (quantity <= 0) {
                inventory.full();
                return;
            }
        }

        const removed = this.removeStock(shop, itemId, quantity);
        if (removed <= 0) {
            return;
        }
        this.removeCurrency(
            player,
            shop.definition.getCurrency(),
            removed * price
        );
        inventory.adds(itemId, removed);
        Sounds.sendSound(player, Sound.PICK_UP_ITEM);
        this.refresh(shop.definition.getId());
        this.ensureRestockTask();
    }

    private static sellItem(
        player: any,
        shop: RuntimeShop,
        item: any,
        amount: number
    ): void {
        const itemId = item?.getId?.();
        if (!Number.isInteger(itemId)) {
            return;
        }
        // A note sells as the item it stands for.
        const stockId = ItemDefinition.forId(itemId).unNote();
        if (shop.definition.getCurrency() === "COINS" && this.isBloodMoneyShopItem(stockId)) {
            player.sendMessage("PK shop items cannot be sold for coins.");
            return;
        }
        if (!this.buysItem(shop, stockId)) {
            player.sendMessage(
                "You cannot sell this item to this shop."
            );
            return;
        }
        const definition = ItemDefinition.forId(stockId);
        if (!item.isSellable()) {
            player.sendMessage("This item cannot be sold.");
            return;
        }

        const inventory = player.getInventory();
        const slot = inventory.getItems().indexOf(item);
        if (slot < 0) {
            return;
        }
        // A stack sells from its own slot; unstackable items (one per slot)
        // start at the clicked slot and continue through the others.
        const slots = item.getDefinition().isStackable()
            ? [slot]
            : [slot, ...inventory.getItems().map((_, index) => index).filter((index) => index !== slot)];
        const sellable = slots.filter((index) => {
            const held = inventory.getItems()[index];
            return held?.getId() === itemId && held.isSellable();
        });
        const held = sellable.reduce((total, index) => total + inventory.getItems()[index].getAmount(), 0);
        let quantity = Math.min(this.normalizeAmount(amount), this.MAX_ACTION_AMOUNT, held);
        if (quantity <= 0) {
            return;
        }
        let price = this.itemPrice(shop, definition);
        if (price > 1) {
            price = Math.floor(price * this.SALES_TAX);
        }
        if (price <= 0) {
            player.sendMessage("This item has no value.");
            return;
        }
        if ((shop.stock.get(stockId) ?? 0) <= 0 && shop.order.length >= this.MAX_SHOP_ITEMS) {
            player.sendMessage("The shop is currently full.");
            return;
        }

        if (!this.canReceivePayment(player, shop.definition.getCurrency(), sellable, quantity)) {
            player.sendMessage("You don't have enough inventory space.");
            return;
        }

        let remaining = quantity;
        for (const index of sellable) {
            if (remaining <= 0) break;
            const taken = Math.min(remaining, inventory.getItems()[index].getAmount());
            inventory.deleteAtSlot(index, taken, false);
            remaining -= taken;
        }
        inventory.refreshItems();
        this.addCurrency(
            player,
            shop.definition.getCurrency(),
            quantity * price
        );
        this.addStock(shop, stockId, quantity);
        Sounds.sendSound(player, Sound.DROP_ITEM);
        this.refresh(shop.definition.getId());
        this.ensureRestockTask();
    }

    private static restockShop(shop: RuntimeShop): boolean {
        const itemIds = new Set([...shop.order, ...shop.originalAmounts.keys()]);
        let changed = false;
        let pending = false;
        for (const itemId of itemIds) {
            const original = shop.originalAmounts.get(itemId) ?? 0;
            const current = shop.stock.get(itemId) ?? 0;
            const decrease = current > original;
            const increase = current < original;
            if (!decrease && !increase) {
                shop.changeTimers.delete(itemId);
                continue;
            }

            pending = true;
            const interval = this.stockChangeIntervalTicks(shop, itemId, decrease);
            let timer = Number(shop.changeTimers.get(itemId) ?? interval);
            if (!Number.isFinite(timer) || timer <= 0) {
                timer = interval;
            }
            timer--;
            if (timer <= 0) {
                changed = decrease
                    ? this.removeStock(shop, itemId, 1) > 0 || changed
                    : this.addStock(shop, itemId, 1) || changed;
                timer = interval;
            }

            const next = shop.stock.get(itemId) ?? 0;
            if ((decrease && next > original) || (increase && next < original)) {
                shop.changeTimers.set(itemId, timer);
            } else {
                shop.changeTimers.delete(itemId);
            }
        }
        if (changed) {
            this.refresh(shop.definition.getId());
        }
        return pending;
    }

    private static stockChangeIntervalTicks(
        shop: RuntimeShop,
        itemId: number,
        decrease: boolean
    ): number {
        if (
            decrease &&
            this.deletesItems(shop) &&
            !shop.originalAmounts.has(itemId)
        ) {
            return Math.max(1, shop.definition.getSoldItemDestockTicks());
        }
        const configured = decrease
            ? shop.itemRestockTicks.get(itemId) ??
              shop.definition.getDefaultDestockTicks()
            : shop.itemRestockTicks.get(itemId) ??
              shop.definition.getDefaultRestockTicks();
        return Math.max(1, Number(configured));
    }

    private static addStock(shop: RuntimeShop, itemId: number, amount: number): boolean {
        const quantity = this.normalizeAmount(amount);
        if (quantity <= 0) {
            return false;
        }
        const current = shop.stock.get(itemId) ?? 0;
        if (current <= 0 && shop.order.length >= this.MAX_SHOP_ITEMS) {
            return false;
        }
        if (!shop.order.includes(itemId)) {
            shop.order.push(itemId);
        }
        shop.stock.set(
            itemId,
            Math.min(Number.MAX_SAFE_INTEGER, current + quantity)
        );
        return true;
    }

    private static removeStock(shop: RuntimeShop, itemId: number, amount: number): number {
        const quantity = this.normalizeAmount(amount);
        const current = shop.stock.get(itemId) ?? 0;
        const removed = Math.min(current, quantity);
        if (removed <= 0) {
            return 0;
        }
        const remaining = current - removed;
        if (remaining <= 0) {
            shop.stock.delete(itemId);
            if (!shop.originalAmounts.has(itemId)) {
                shop.order = shop.order.filter((id) => id !== itemId);
            }
        } else {
            shop.stock.set(itemId, remaining);
        }
        return removed;
    }

    private static buysItem(shop: RuntimeShop, itemId: number): boolean {
        return this.isGeneralStore(shop) || (shop.originalAmounts.get(itemId) ?? 0) > 0;
    }

    private static isBloodMoneyShopItem(itemId: number): boolean {
        return this.BLOOD_MONEY_SHOP_IDS.some((shopId) =>
            ShopDefinition.forId(shopId)?.getCurrency() === "BLOOD_MONEY" &&
            ShopDefinition.forId(shopId)?.getOriginalStock().some((stock) => stock.id === itemId)
        );
    }

    private static deletesItems(shop: RuntimeShop): boolean {
        return this.isGeneralStore(shop);
    }

    /** General stores buy any item; the shop data only marks them by name. */
    private static isGeneralStore(shop: RuntimeShop): boolean {
        return shop.definition.getId() === ShopIdentifiers.GENERAL_STORE ||
            /general store/i.test(shop.definition.getName());
    }

    private static itemPrice(shop: RuntimeShop, definition: ItemDefinition): number {
        const override = shop.itemPrices.get(definition.getId());
        if (override != null && override > 0) {
            return override;
        }
        return shop.definition.getCurrency() === "BLOOD_MONEY"
            ? Number(definition.getBloodMoneyValue?.() ?? 0)
            : Number(definition.getValue?.() ?? 0);
    }

    private static currencyAmount(player: any, currency: ShopCurrency): number {
        const handler = this.currencyHandlers.get(currency);
        if (handler) return Math.max(0, handler.amount(player) | 0);
        if (currency === "POINTS") {
            return Number(player.getAttribute(this.POINTS_ATTRIBUTE) ?? 0);
        }
        const itemId = this.currencyItemId(currency);
        return itemId > 0
            ? Number(player.getInventory()?.getAmount?.(itemId) ?? 0)
            : 0;
    }

    private static addCurrency(
        player: any,
        currency: ShopCurrency,
        amount: number
    ): void {
        const quantity = this.normalizeAmount(amount);
        if (quantity <= 0) {
            return;
        }
        const handler = this.currencyHandlers.get(currency);
        if (handler) {
            handler.add(player, quantity);
            return;
        }
        if (currency === "POINTS") {
            player.setAttribute(this.POINTS_ATTRIBUTE, this.currencyAmount(player, currency) + quantity);
            return;
        }
        const itemId = this.currencyItemId(currency);
        if (itemId > 0) {
            player.getInventory().adds(itemId, quantity);
        }
    }

    private static removeCurrency(
        player: any,
        currency: ShopCurrency,
        amount: number
    ): void {
        const quantity = this.normalizeAmount(amount);
        if (quantity <= 0) {
            return;
        }
        const handler = this.currencyHandlers.get(currency);
        if (handler) {
            handler.remove(player, quantity);
            return;
        }
        if (currency === "POINTS") {
            player.setAttribute(this.POINTS_ATTRIBUTE, Math.max(0, this.currencyAmount(player, currency) - quantity));
            return;
        }
        const itemId = this.currencyItemId(currency);
        if (itemId > 0) {
            player.getInventory().deleteNumber(itemId, quantity);
        }
    }

    /**
     * Whether a sale's payment fits: the currency is not an inventory item,
     * the player already holds some, a slot is free, or selling `quantity`
     * from `slots` (in order) empties one.
     */
    private static canReceivePayment(player: any, currency: ShopCurrency, slots: number[], quantity: number): boolean {
        const itemId = this.currencyHandlers.get(currency)?.itemId ?? this.currencyItemId(currency);
        if (!(itemId > 0)) return true;
        const inventory = player.getInventory();
        if (inventory.containsNumber(itemId) || inventory.getFreeSlots() > 0) return true;
        return slots.length > 0 && inventory.getItems()[slots[0]].getAmount() <= quantity;
    }

    private static currencyItemId(currency: ShopCurrency): number {
        if (currency === "COINS") {
            return ItemIdentifiers.COINS;
        }
        if (currency === "BLOOD_MONEY") {
            return ItemIdentifiers.BLOOD_MONEY;
        }
        return -1;
    }

    private static currencyName(currency: ShopCurrency): string {
        const handler = this.currencyHandlers.get(currency);
        if (handler) return handler.name;
        if (currency === "COINS") {
            return "Coins";
        }
        if (currency === "BLOOD_MONEY") {
            return "Blood money";
        }
        if (currency === "POINTS") {
            return "Points";
        }
        return "Currency";
    }

    private static ensureRestockTask(): void {
        if (this.restockTaskRunning) {
            return;
        }
        this.restockTaskRunning = true;
        TaskManager.submit(new ShopRestockTask());
    }

    private static normalizeAmount(value: number): number {
        return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    }

    private static toUnsignedShort(value: number): number {
        return Number.isInteger(value) ? value & 0xffff : -1;
    }
}
