import { Player } from "../../../entity/impl/player/Player";
import { Item } from "../../Item";
import { ItemContainer } from "../ItemContainer";
import { PlayerStatus } from "../../PlayerStatus";
import { ItemDefinition } from "../../../definition/ItemDefinition";
import { StackType, MAX_STACK_AMOUNT } from "../StackType";
import { Equipment } from "./Equipment";
import { GameConstants } from "../../../GameConstants";
import { WeaponInterfaceManager } from "../../../content/combat/WeaponInterfaceManager";
import { Inventory } from "./Inventory";
import { Flag } from "../../Flag";
import { BonusManager } from "../../equipment/BonusManager";
import { EnteredSyntaxAction } from "../../EnteredSyntaxAction";
import { Sound } from "../../../Sound";
import { Sounds } from "../../../Sounds";
const getPluginManager = () =>
    require("../../../../plugins/PluginManager").PluginManager as typeof import("../../../../plugins/PluginManager").PluginManager;

/** Live OSRS's wording (rsprox recordings 454, 3066, 4151, 3467, 1059). */
const INVENTORY_FULL_MESSAGE = "You don't have enough inventory space.";
const WITHDRAW_PARTIAL_MESSAGE = "You don't have enough inventory space to withdraw that many.";
const NEW_TAB_MESSAGE = "To create a new tab, drag items from your bank onto this tab.";

export class Bank extends ItemContainer {
    full(): ItemContainer {
        const event = { player: this.getPlayer(), message: "Not enough space in bank." };
        getPluginManager().emitCustomEvent(Bank.FULL_EVENT, event);
        this.getPlayer().sendMessage(event.message);
        return this;
    }
    /** The client's bank holds 1410 items (bankmain:items slots 0-1409), the most any account can unlock. */
    public static readonly MAX_SLOTS = 1410;
    /** Slots a tab starts with; it grows, up to MAX_SLOTS, as items are added. */
    private static readonly INITIAL_TAB_SLOTS = 352;
    /** bank_locked_slots: the client's slots past the player's capacity. */
    private static readonly LOCKED_SLOTS_VARP = 4611;
    /**
     * `{ player, capacity }`, asked whenever the bank checks its room: a plugin sets `capacity`
     * to the player's bank space. Left alone, every slot is open (MAX_SLOTS).
     */
    public static readonly CAPACITY_EVENT = "bank:capacity";
    /** `{ player, message }` when an item doesn't fit; a plugin can change the `message` sent. */
    public static readonly FULL_EVENT = "bank:full";
    /** `{ player }` once the bank interface has opened (not on a tab change). */
    public static readonly OPENED_EVENT = "bank:opened";
    /** Players whose items move between tabs, or load, without the capacity applying. */
    private static readonly unlimited = new Set<Player>();
    public static readonly TOTAL_BANK_TABS = 11;
    public static readonly CONTAINER_START = 50300;
    public static readonly BANK_SEARCH_TAB_INDEX = Bank.TOTAL_BANK_TABS - 1;
    public static readonly INVENTORY_INTERFACE_ID = 5064;
    public static readonly MAIN_INTERFACE_ID = 12;
    public static readonly SIDE_INTERFACE_ID = 15;
    /** The tab buttons: slot 10 is "all items", slots 11-19 are tabs 1-9. */
    public static readonly TABS_CHILD = 10;
    public static readonly TAB_BUTTON_SLOT_OFFSET = 10;
    /** bankmain:search, which starts the client's own bank search in the chatbox. */
    public static readonly SEARCH_CHILD = 42;
    /** bankmain:items slots 1419-1427: the tab headings shown in the all-items view (tabs 1-9). */
    public static readonly TAB_HEADING_FIRST_SLOT = 1419;
    public static readonly TAB_HEADING_LAST_SLOT = 1427;
    /** varc 5's mode while the bank search is typed in the chatbox. */
    public static readonly SEARCH_INPUT_MODE = 11;
    /** meslayer_close: closes the chatbox input, if it is in the given mode (or none is open). */
    private static readonly MESLAYER_CLOSE_SCRIPT = 101;
    /** bank_viewcontainer / bank_viewcontainer_obj: which item's contents the bank side shows (a rune pouch's, ...). */
    public static readonly VIEW_CONTAINER_VARBIT = 9727;
    public static readonly VIEW_CONTAINER_OBJ_VARP = 4385;
    /**
     * Custom event for an op on an inventory item in the bank side panel, before it deposits:
     * `{ player, item, slot, op, option, handled }`. A plugin sets `handled` for an item whose
     * own bank ops (a rune pouch's View or Empty) are not deposits.
     */
    public static readonly INVENTORY_OP_EVENT = "bank:inventory-op";
    /**
     * Custom event for an op on a banked item, before it withdraws:
     * `{ player, item, tab, slot, op, option, handled }`. A plugin sets `handled` for an op that
     * is not a withdrawal (op 9, Configure-Charges, on items with cache param 2257).
     */
    public static readonly ITEM_OP_EVENT = "bank:item-op";
    /** `{ player, items }`: new inventory item instances after a successful withdrawal, before refresh. */
    public static readonly WITHDRAWN_ITEMS_EVENT = "bank:withdrawn-items";
    /** `{ player }` after the open bank redraws its items and the side panel's inventory. */
    public static readonly REFRESHED_EVENT = "bank:refreshed";

    /** Ends the client's bank search, as OSRS does on closing the bank or picking a tab. */
    public static closeSearch(player: Player): void {
        player.getPacketSender().sendClientScript(Bank.MESLAYER_CLOSE_SCRIPT, Bank.SEARCH_INPUT_MODE);
    }
    public static readonly ITEMS_CHILD = 12;
    public static readonly SIDE_ITEMS_CHILD = 3;
    /** bankside:wornops, the worn items shown in place of the inventory; op 1 banks the item. */
    public static readonly SIDE_WORN_CHILD = 4;
    /** Its slots as live enables them (rsprox, rev 241): ops 1, 9 and 10, DEPTH1 and DRAGTARGET. */
    public static readonly SIDE_WORN_FLAGS = (1 << 1) | (1 << 9) | (1 << 10) | (1 << 17) | (1 << 20);
    /** bankmain buttons (rev 241 component ids, named by the cache's gamevals). */
    public static readonly FRAME_CHILD = 2; // bankmain:frame (its close button)
    public static readonly SWAP_INSERT_CHILD = 23; // bankmain:swap_insert
    public static readonly NOTE_CHILD = 25; // bankmain:note
    /** bankmain:quantity1, quantity5, quantity10, quantityx, quantityall. */
    public static readonly QUANTITY_CHILDREN = [29, 31, 33, 35, 37];
    /** bank_quantity_type (varbit 6590) for X, the index of bankmain:quantityx above. */
    public static readonly QUANTITY_X_MODE = 3;
    /** bank_requestedquantity: the remembered X amount. */
    public static readonly REQUESTED_QUANTITY_VARBIT = 3960;
    public static readonly PLACEHOLDER_CHILD = 40; // bankmain:placeholder
    public static readonly DEPOSIT_INVENTORY_CHILD = 47; // bankmain:depositinv
    public static readonly DEPOSIT_WORN_CHILD = 49; // bankmain:depositworn
    /** Drops on the empty space after tab N's items report item-grid slot 1428 + N. */
    public static readonly TAB_DROP_SLOT_OFFSET = 1410 + 9 * 2;
    /**
     * bankmain:items slots 0-1409, as captured (rsprox, rev 239): OP1-OP10 (bits 1-10), DEPTH2,
     * DRAGTARGET and TARGET. No pause button (bit 0): with it, an empty slot offered "Continue".
     */
    public static readonly ITEM_SLOT_FLAGS = 0x7fe | (2 << 17) | (1 << 20) | (1 << 21);
    /** The same slots' ops, as IF_SETEVENTS_V2 sends them: OP1-OP11, op 11 being Examine. */
    public static readonly ITEM_SLOT_OPS = 0x7ff;
    /** Ops 1-10, drag depth 1, drop target. */
    public static readonly TAB_BUTTON_FLAGS = 0x7fe | (1 << 17) | (1 << 20);
    public static readonly EXAMINE_OP = 11;
    /** Capture (bankside:items op9): Wear/Wield on a bank inventory item equips it, bank open. */
    public static readonly SIDE_EQUIP_OP = 9;

    constructor(public player: Player) {
        super(player, Bank.INITIAL_TAB_SLOTS);
    }

    /** The player's bank space, in slots; placeholders take a slot as items do. */
    public static getCapacity(player: Player): number {
        const event = { player, capacity: Bank.MAX_SLOTS };
        getPluginManager().emitCustomEvent(Bank.CAPACITY_EVENT, event);
        const capacity = Math.floor(Number(event.capacity));
        return Number.isFinite(capacity) ? Math.max(0, Math.min(Bank.MAX_SLOTS, capacity)) : Bank.MAX_SLOTS;
    }

    /** Slots in use across the tabs, placeholders included (not the search results). */
    public static usedSlots(player: Player): number {
        let used = 0;
        for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
            if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
            for (const item of player.getBank(tab).getItems()) if (item != null && item.getId() >= 0) used++;
        }
        return used;
    }

    /** Slots the player's bank space has left. */
    public static freeSlots(player: Player): number {
        return Math.max(0, Bank.getCapacity(player) - Bank.usedSlots(player));
    }

    /**
     * Runs `action` with the capacity lifted: items that move between tabs already have a slot,
     * and a saved bank loads whole even if it holds more than the player's space.
     */
    public static withoutLimit<T>(player: Player, action: () => T): T {
        const nested = Bank.unlimited.has(player);
        Bank.unlimited.add(player);
        try {
            return action();
        } finally {
            if (!nested) Bank.unlimited.delete(player);
        }
    }

    /** Slots the player's space still allows, or Infinity where the capacity doesn't apply. */
    private roomLeft(): number {
        const player = this.getPlayer();
        if (player == null || Bank.unlimited.has(player) || player.getBank(Bank.BANK_SEARCH_TAB_INDEX) === this) {
            return Infinity;
        }
        return Bank.freeSlots(player);
    }

    /** An empty slot in this tab, growing it if every slot is taken; -1 once it is MAX_SLOTS long. */
    public freeSlot(): number {
        const slot = super.getEmptySlot();
        if (slot >= 0 || this.items.length >= Bank.MAX_SLOTS) return slot;
        this.items.push(new Item(-1, 0));
        return this.items.length - 1;
    }

    public getEmptySlot(): number {
        return this.roomLeft() > 0 ? this.freeSlot() : -1;
    }

    public getFreeSlots(): number {
        return Math.min(super.getFreeSlots() + Bank.MAX_SLOTS - this.items.length, this.roomLeft());
    }

    /** Banked items always stack: a full bank still takes more of an item it holds (same metadata). */
    public canTake(item: Item): boolean {
        if (this.getFreeSlots() > 0) return true;
        const id = ItemDefinition.forId(item.getId()).unNote();
        const meta = JSON.stringify(item.getMeta() ?? null);
        return this.items.some((held) => held != null && held.getId() === id
            && JSON.stringify(held.getMeta() ?? null) === meta);
    }

    public isEmpty(): boolean {
        return this.items.every((item) => item == null || item.getId() < 0);
    }

    /** Moves the empty slots to the end, keeping the items' order (placeholders stay). */
    public sortItems(): Bank {
        const filled = this.items.filter((item) => item != null && item.getId() >= 0);
        const empty = this.items.filter((item) => item != null && item.getId() < 0);
        const sorted = [...filled, ...empty];
        // In place, as callers may hold this tab's item array.
        for (let slot = 0; slot < this.items.length; slot++) this.items[slot] = sorted[slot] ?? new Item(-1, 0);
        return this;
    }

    public static isOpen(player: Player): boolean {
        return player.getStatus() === PlayerStatus.BANKING &&
            player.getInterfaceId() === Bank.MAIN_INTERFACE_ID;
    }

    public static withdraw(player: Player, item: number, slot: number, amount: number, fromBankTab: number) {
        if (Bank.isOpen(player)) {

            // The client names the exact tab and slot; a search result can come
            // from any tab.
            const itemTab = player.isSearchingBank() ? Bank.getTabForItem(player, item) : fromBankTab;

            // Make sure we're only withdrawing what we have.
            let maxAmount = player.getBank(itemTab).getAmount(item);
            if (amount === -1 || amount > maxAmount) {
                amount = maxAmount;
            }

            if (player.isSearchingBank()) {
                if (!player.getBank(itemTab).contains(item) || !player.getBank(Bank.BANK_SEARCH_TAB_INDEX).contains(item)
                        || amount <= 0) {
                    return;
                }
                if (fromBankTab !== Bank.BANK_SEARCH_TAB_INDEX) {
                    return;
                }

                slot = player.getBank(itemTab).getSlotForItemId(item);
                // The aggregate count can include other charge/metadata states.
                // Only clone the amount held by this exact source stack.
                amount = Math.min(amount, player.getBank(itemTab).getItems()[slot].getAmount());

                player.getBank(itemTab).switchsItem(
                    player.getInventory(),
                    player.getBank(itemTab).getItems()[slot].clone().setAmount(amount),
                    slot,
                    false,
                    false
                );

                if (slot === 0) {
                    Bank.reconfigureTabs(player);
                }

                player.getBank(Bank.BANK_SEARCH_TAB_INDEX).refreshItems();

            } else {

                // Make sure the item is in the slot we've found.
                const stack = player.getBank(itemTab).getItems()[slot];
                if (!stack || stack.getId() !== item) {
                    return;
                }

                // Another stack of the same item (different metadata) may share
                // the tab, so take no more than this one holds.
                amount = Math.min(amount, stack.getAmount());

                // Delete placeholder.
                if (amount <= 0) {
                    player.getBank(itemTab).getItems()[slot].setId(-1);
                    player.getBank(player.getCurrentBankTab()).sortItems().refreshItems();
                    return;
                }

                // Perform the switch.
                player.getBank(itemTab).switchsItem(
                    player.getInventory(),
                    player.getBank(itemTab).getItems()[slot].clone().setAmount(amount),
                    slot,
                    false,
                    false
                );

                // Update all tabs if we removed an item from the first item slot.
                if (slot === 0) {
                    Bank.reconfigureTabs(player);
                }

                // Refresh items in our current tab.
                player.getBank(player.getCurrentBankTab()).refreshItems();

            }

            Sounds.sendSound(player, Sound.PICK_UP_ITEM);

            // Refresh inventory.
            player.getInventory().refreshItems();
        }
    }

    public static deposits(player: Player, item: number, slot: number, amount: number) {
        this.deposit(player, item, slot, amount, false);
    }

    /**
     * Deposits an item to the bank.
     *
     * @param player
     * @param item
     * @param slot
     * @param amount
     */

    public static deposit(player: Player, item: number, slot: number, amount: number, ignore: boolean) {
        if (ignore || Bank.isOpen(player)) {
            const inventoryItem = player.getInventory().getItems()[slot];
            if (!inventoryItem || inventoryItem.getId() !== item) {
                return;
            }

            if (getPluginManager().emitCanBankItem(player, inventoryItem) === false) {
                return;
            }

            if (amount === -1 || amount > player.getInventory().getAmount(item)) {
                amount = player.getInventory().getAmount(item);
            }

            if (amount <= 0) {
                return;
            }

            const tab = Bank.getTabForItem(player, item);

            Bank.depositFromSlots(player, player.getBank(tab), slot, amount);
            if (!player.isSearchingBank()) {
                player.getBank(tab).refreshItems();
            }
            if (player.isSearchingBank()) {
                player.getBank(this.BANK_SEARCH_TAB_INDEX).refreshItems();
            }

            Sounds.sendSound(player, Sound.DROP_ITEM);

            // Refresh inventory
            player.getInventory().refreshItems();
        }
    }

    /**
     * Moves up to `amount` of the inventory item in `slot` into `bank`, each
     * item as itself so it keeps its metadata (charges, contents). A stack
     * moves from the clicked slot only; unstackable items start there and
     * continue through the other bankable slots holding the same item.
     */
    private static depositFromSlots(player: Player, bank: Bank, slot: number, amount: number) {
        const inventory = player.getInventory();
        const clicked = inventory.getItems()[slot];
        if (clicked.getDefinition().isStackable()) {
            inventory.switchItem(bank, clicked.clone().setAmount(Math.min(amount, clicked.getAmount())), false, slot, false);
            return;
        }
        const id = clicked.getId();
        const slots = [slot, ...inventory.getItems().map((_, index) => index).filter((index) => index !== slot)];
        let moved = 0;
        for (const index of slots) {
            if (moved >= amount) break;
            const item = inventory.getItems()[index];
            if (item.getId() !== id || getPluginManager().emitCanBankItem(player, item) === false) continue;
            inventory.switchItem(bank, item.clone(), false, index, false);
            moved++;
        }
    }

    public static search(player: Player, syntax: string) {
        if (Bank.isOpen(player)) {

            // Set search fields
            player.setSearchSyntax(syntax);
            player.setSearchingBank(true);

            // Clear search bank tab
            player.getBank(this.BANK_SEARCH_TAB_INDEX).resetItems();

            // Refill search bank tab
            for (let i = 0; i < this.TOTAL_BANK_TABS; i++) {
                if (i === this.BANK_SEARCH_TAB_INDEX) {
                    continue;
                }
                const b = player.getBank(i);
                if (b !== null) {
                    b.sortItems();
                    for (let item of b.getValidItems()) {
                        if (item.getAmount() > 0) {
                            this.addToBankSearch(player, item.clone(), false);
                        }
                    }
                }
            }

            player.setCurrentBankTab(0);

            // Open the search bank tab
            player.getBank(this.BANK_SEARCH_TAB_INDEX).open();
        }
    }

    public static exitSearch(player: Player, openBank: boolean) {
        if (Bank.isOpen(player)) {

            // Set search fields
            player.setSearchSyntax("");
            player.setSearchingBank(false);

            // Clear search bank tab
            player.getBank(this.BANK_SEARCH_TAB_INDEX).resetItems();

            // Open last tab we had
            if (player.getCurrentBankTab() === this.BANK_SEARCH_TAB_INDEX) {
                player.setCurrentBankTab(0);
            }

            if (openBank) {
                player.getBank(player.getCurrentBankTab()).open();
            }
        }
    }

    public static addToBankSearch(player: Player, item: Item, refresh: boolean) {

        if (player.getBank(this.BANK_SEARCH_TAB_INDEX).getFreeSlots() === 0) {
            return;
        }

        if (item.getDefinition().getName().toLowerCase().includes(player.getSearchSyntax())) {
            player.getBank(this.BANK_SEARCH_TAB_INDEX).add(item, refresh);
        }
    }

    /**
     * The bank in the order the client lays it out: tabs 1-9, then the main
     * tab. The cache scripts find each tab's range from the tab-size varbits
     * (4171-4179), so this order must match them. Placeholders are included.
     */
    public static layout(player: Player): Array<{ tab: number; slot: number; item: Item }> {
        const entries: Array<{ tab: number; slot: number; item: Item }> = [];
        for (const tab of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
            player.getBank(tab).getItems().forEach((item, slot) => {
                if (item != null && item.getId() >= 0 && item.getAmount() >= 0) {
                    entries.push({ tab, slot, item });
                }
            });
        }
        return entries;
    }

    /** The item the client shows: a placeholder shows its faded cache placeholder. */
    public static displayItemId(item: Item): number {
        if (item.getAmount() > 0) return item.getId();
        const placeholderId = item.getDefinition().getPlaceholderId();
        return placeholderId >= 0 ? placeholderId : item.getId();
    }

    /** Removes the placeholder in `slot` of `tab`. */
    public static releasePlaceholder(player: Player, tab: number, slot: number): void {
        const item = player.getBank(tab).getItems()[slot];
        if (!item || item.getId() < 0 || item.getAmount() !== 0) return;
        item.setId(-1);
        item.setMeta(null);
        player.getBank(tab).refreshItems();
    }

    public static viewTab(player: Player, tab: number): void {
        if (tab > Bank.getTabCount(player)) {
            player.sendMessage(NEW_TAB_MESSAGE);
            return;
        }
        player.setCurrentBankTab(tab);
        // The client tracks the tab it is viewing itself (its tab buttons set
        // BANK_CURRENTTAB locally); tell it only when we change the tab for it.
        player.getPacketSender().sendVarbit(4150, tab);
        player.getBank(tab).refreshItems();
    }

    /** Moves every item in `tab` (placeholders included) into the main tab. */
    public static collapseTab(player: Player, tab: number): void {
        if (tab <= 0 || tab > Bank.getTabCount(player)) return;
        const items = player.getBank(tab).getValidItems();
        if (Bank.withoutLimit(player, () => player.getBank(0).getFreeSlots()) < items.length) {
            player.sendMessage("You don't have enough free slots in your main tab to do that.");
            return;
        }
        Bank.withoutLimit(player, () => {
            for (const item of items) {
                player.getBank(0).add(item.clone(), false);
            }
        });
        player.getBank(tab).resetItems();
        if (player.getCurrentBankTab() === tab) {
            player.setCurrentBankTab(0);
            player.getPacketSender().sendVarbit(4150, 0);
        }
        player.getBank(0).refreshItems();
        GameConstants.PLAYER_PERSISTENCE.requestSave(player, "bank-tab-collapse");
    }

    /** Removes the placeholders in `tab`, or in every tab for "all items" (0). */
    public static releasePlaceholders(player: Player, tab: number): void {
        const tabs = tab === 0 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : [tab];
        for (const index of tabs) {
            for (const item of player.getBank(index).getItems()) {
                if (item != null && item.getId() >= 0 && item.getAmount() === 0) {
                    item.setId(-1);
                    item.setMeta(null);
                }
            }
        }
        player.getBank(0).refreshItems();
        GameConstants.PLAYER_PERSISTENCE.requestSave(player, "bank-placeholder-clear");
    }

    /**
     * Handles a drag (IF_BUTTOND) within the bank or its inventory panel.
     * Returns false for drags the bank doesn't own.
     */
    public static handleDrag(player: Player, drag: {
        sourceWidgetId: number; sourceSlot: number; sourceItemId: number;
        targetWidgetId: number; targetSlot: number;
    }): boolean {
        const sourceGroup = drag.sourceWidgetId >>> 16, sourceChild = drag.sourceWidgetId & 0xffff;
        const targetGroup = drag.targetWidgetId >>> 16, targetChild = drag.targetWidgetId & 0xffff;
        const fromBank = sourceGroup === Bank.MAIN_INTERFACE_ID && sourceChild === Bank.ITEMS_CHILD;
        const fromInventory = sourceGroup === Bank.SIDE_INTERFACE_ID && sourceChild === Bank.SIDE_ITEMS_CHILD;
        if (!(fromBank || fromInventory) || !Bank.isOpen(player)) return false;

        let tab: number | undefined;
        if (targetGroup === Bank.MAIN_INTERFACE_ID && targetChild === Bank.TABS_CHILD) {
            tab = drag.targetSlot - Bank.TAB_BUTTON_SLOT_OFFSET;
        } else if (targetGroup === Bank.MAIN_INTERFACE_ID && targetChild === Bank.ITEMS_CHILD
            && drag.targetSlot >= Bank.TAB_DROP_SLOT_OFFSET) {
            tab = drag.targetSlot - Bank.TAB_DROP_SLOT_OFFSET;
        }
        if (tab !== undefined && (tab < 0 || tab > 9)) return true;

        if (fromInventory && targetGroup === Bank.SIDE_INTERFACE_ID && targetChild === Bank.SIDE_ITEMS_CHILD) {
            player.getInventory().swap(drag.sourceSlot, drag.targetSlot).refreshItems();
        } else if (fromInventory && targetGroup === Bank.MAIN_INTERFACE_ID) {
            Bank.depositDragged(player, drag.sourceSlot, drag.sourceItemId, tab);
        } else if (fromBank && tab !== undefined) {
            Bank.moveToTab(player, drag.sourceSlot, drag.sourceItemId, tab);
        } else if (fromBank && targetGroup === Bank.MAIN_INTERFACE_ID && targetChild === Bank.ITEMS_CHILD) {
            Bank.moveItem(player, drag.sourceSlot, drag.sourceItemId, drag.targetSlot);
        }
        GameConstants.PLAYER_PERSISTENCE.requestSave(player, "container-reorder");
        return true;
    }

    /** The slot after `bank`'s last item, where a moved item joins the tab; -1 if full. */
    private static endSlot(bank: Bank): number {
        const items = bank.getItems();
        let last = -1;
        items.forEach((item, slot) => {
            if (item != null && item.getId() >= 0) last = slot;
        });
        return last + 1 < bank.capacity() ? last + 1 : bank.freeSlot();
    }

    /** The tab a drop onto `tab` goes to: an existing tab, or one new tab after the last. */
    private static dropTab(player: Player, tab: number): number {
        return Math.min(tab, Bank.getTabCount(player) + 1);
    }

    /**
     * Deposits an inventory stack dropped on the bank. An item already in
     * the bank joins its stack; otherwise it goes to the tab it was dropped
     * on, or where a click would deposit it.
     */
    private static depositDragged(player: Player, slot: number, itemId: number, tab: number | undefined) {
        const item = player.getInventory().getItems()[slot];
        if (!item || item.getId() < 0 || item.getId() !== itemId) return;
        if (getPluginManager().emitCanBankItem(player, item) === false) return;
        const unnoted = item.getDefinition().unNote();
        let target = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((index) => player.getBank(index).contains(unnoted));
        if (target === undefined) {
            target = tab === undefined ? Bank.getTabForItem(player, itemId) : Bank.dropTab(player, tab);
        }
        Bank.depositFromSlots(player, player.getBank(target), slot, item.getDefinition().isStackable() ? item.getAmount() : 1);
        player.getBank(target).refreshItems();
        player.getInventory().refreshItems();
    }

    /** Moves the bank item at `clientSlot` to the end of `tab`, creating the tab if it's new. */
    private static moveToTab(player: Player, clientSlot: number, itemId: number, tab: number) {
        const entry = Bank.resolveDisplaySlot(player, clientSlot);
        if (!entry || Bank.displayItemId(entry.item) !== itemId) return;
        tab = Bank.dropTab(player, tab);
        if (tab === entry.tab) return;
        const target = player.getBank(tab);
        const slot = Bank.endSlot(target);
        if (slot < 0) {
            target.full();
            return;
        }
        target.setItem(slot, entry.item.clone());
        entry.item.setId(-1);
        entry.item.setMeta(null);
        entry.item.setAmount(0);
        player.getBank(entry.tab).refreshItems();
    }

    /**
     * Moves the bank item at `fromClientSlot` onto the item at
     * `toClientSlot`, swapping or inserting by the player's setting. Across
     * tabs, a swap trades the two items' places (each takes the other's tab)
     * and an insert puts the dragged item into the other tab there.
     */
    private static moveItem(player: Player, fromClientSlot: number, itemId: number, toClientSlot: number) {
        const from = Bank.resolveDisplaySlot(player, fromClientSlot);
        const to = Bank.resolveDisplaySlot(player, toClientSlot);
        if (!from || !to || Bank.displayItemId(from.item) !== itemId || fromClientSlot === toClientSlot) return;
        const bank = player.getBank(to.tab);
        if (from.tab !== to.tab && !player.insertModeReturn()) {
            player.getBank(from.tab).setItem(from.slot, to.item);
            bank.setItem(to.slot, from.item);
            bank.refreshItems();
            return;
        }
        let fromSlot = from.slot;
        if (from.tab !== to.tab) {
            fromSlot = Bank.endSlot(bank);
            if (fromSlot < 0) {
                bank.full();
                return;
            }
            bank.setItem(fromSlot, from.item.clone());
            from.item.setId(-1);
            from.item.setMeta(null);
            from.item.setAmount(0);
        }
        Bank.rearrange(player, bank, fromSlot, to.slot);
        if (from.tab !== to.tab) {
            player.getBank(from.tab).refreshItems();
        }
    }

    public static resolveDisplaySlot(player: Player, clientSlot: number): { tab: number; slot: number; item: Item } | null {
        if (!Number.isInteger(clientSlot) || clientSlot < 0) return null;
        return Bank.layout(player)[clientSlot] ?? null;
    }

    public static actionAmount(
        kind: "withdraw" | "deposit",
        button: number,
        option: string | undefined,
        available: number,
        custom = 0,
        defaultMode = 0,
    ): number {
        const total = Math.max(0, Math.trunc(available));
        const named = option?.trim().toLowerCase();
        if (named) {
            if (named.endsWith("-all-but-1")) return Math.max(0, total - 1);
            if (named.endsWith("-1")) return Math.min(total, 1);
            if (named.endsWith("-5")) return Math.min(total, 5);
            if (named.endsWith("-10")) return Math.min(total, 10);
            if (named.endsWith("-all")) return total;
            if (named.endsWith("-x")) return Math.min(total, custom);
        }

        const defaultAmounts = [1, 5, 10, custom, total];
        if (kind === "withdraw") {
            if (button === 1) return Math.min(total, defaultAmounts[defaultMode] ?? 1);
            return Math.max(0, Math.min(total, ({ 2: 1, 3: 5, 4: 10, 5: custom, 6: custom, 7: total, 8: total - 1 } as Record<number, number>)[button] ?? 0));
        }
        if (button === 2) return Math.min(total, defaultAmounts[defaultMode] ?? 1);
        return Math.min(total, ({ 1: 1, 3: 1, 4: 5, 5: 10, 6: custom, 7: custom, 8: total } as Record<number, number>)[button] ?? 0);
    }

    /**
     * Whether an item op asks for the amount first: Withdraw-X (op 6) and Deposit-X (op 7), as
     * captured, or the default click in X mode before any amount was entered.
     */
    public static asksAmount(
        kind: "withdraw" | "deposit",
        button: number,
        option: string | undefined,
        custom = 0,
        defaultMode = 0,
    ): boolean {
        const named = option?.trim().toLowerCase();
        const xOp = named ? named.endsWith("-x") : button === (kind === "withdraw" ? 6 : 7);
        const defaultOp = button === (kind === "withdraw" ? 1 : 2);
        return xOp || (defaultOp && defaultMode === Bank.QUANTITY_X_MODE && custom <= 0);
    }

    /**
     * Capture: the "Enter amount:" chatbox prompt (meslayer_mode7). The answer becomes the
     * remembered X (bank_requestedquantity), then `then` runs with it in the same tick.
     */
    public static promptAmount(player: Player, then?: (amount: number) => void): void {
        player.setEnteredAmountAction({
            execute: (amount: number) => {
                if (!Bank.isOpen(player)) return;
                player.setBankCustomQuantity(amount);
                player.getPacketSender().sendVarbit(Bank.REQUESTED_QUANTITY_VARBIT, player.getBankCustomQuantity());
                then?.(player.getBankCustomQuantity());
            },
        });
        player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
    }

    /** Capture: the item moves to worn (synth_sound 2238) and the bank stays open. */
    private static equipFromSide(player: Player, itemId: number, slot: number): void {
        if (ItemDefinition.forId(itemId).getEquipmentType().getSlot() < 0) return;
        const { EquipPacketListener } = require("../../../../net/packet/impl/EquipPacketListener") as
            typeof import("../../../../net/packet/impl/EquipPacketListener");
        player.setAttribute(EquipPacketListener.PRESERVE_INTERFACE_ON_EQUIP_ATTRIBUTE, Bank.MAIN_INTERFACE_ID);
        EquipPacketListener.equip(player, itemId, slot, Inventory.INTERFACE_ID);
    }

    public static handleWidgetAction(player: Player, packet: {
        groupId: number;
        childId: number;
        buttonNum: number;
        option?: string;
        slot?: number;
        itemId?: number;
    }): boolean {
        if (!Bank.isOpen(player)) return false;

        // Capture (bank search): picking a tab heading switches to that tab and ends the search.
        if (packet.groupId === Bank.MAIN_INTERFACE_ID && packet.childId === Bank.ITEMS_CHILD && packet.slot != null &&
            packet.slot >= Bank.TAB_HEADING_FIRST_SLOT && packet.slot <= Bank.TAB_HEADING_LAST_SLOT) {
            Bank.viewTab(player, packet.slot - Bank.TAB_HEADING_FIRST_SLOT + 1);
            Bank.closeSearch(player);
            return true;
        }

        if (packet.groupId === Bank.MAIN_INTERFACE_ID && packet.childId === Bank.ITEMS_CHILD && packet.slot != null) {
            const entry = Bank.resolveDisplaySlot(player, packet.slot);
            if (!entry || (packet.itemId != null && packet.itemId !== Bank.displayItemId(entry.item))) return true;
            if (packet.buttonNum === Bank.EXAMINE_OP) {
                const definition = ItemDefinition.forId(entry.item.getId());
                player.sendMessage(definition.getExamine() || definition.getName());
                return true;
            }
            if (entry.item.getAmount() === 0) {
                if (packet.buttonNum === 8 || packet.option?.trim().toLowerCase() === "release") {
                    Bank.releasePlaceholder(player, entry.tab, entry.slot);
                }
                return true;
            }
            const event = { player, item: entry.item, tab: entry.tab, slot: entry.slot, op: packet.buttonNum, option: packet.option, handled: false };
            getPluginManager().emitCustomEvent(Bank.ITEM_OP_EVENT, event);
            if (event.handled) return true;
            if (Bank.asksAmount("withdraw", packet.buttonNum, packet.option, player.getBankCustomQuantity(), player.getBankQuantityMode())) {
                const itemId = entry.item.getId();
                Bank.promptAmount(player, (amount) => {
                    // The bank may have changed while the prompt was open.
                    const item = player.getBank(entry.tab).getItems()[entry.slot];
                    if (item?.getId() === itemId && item.getAmount() > 0) Bank.withdraw(player, itemId, entry.slot, amount, entry.tab);
                });
                return true;
            }
            const amount = Bank.actionAmount(
                "withdraw", packet.buttonNum, packet.option, entry.item.getAmount(),
                player.getBankCustomQuantity(), player.getBankQuantityMode(),
            );
            if (amount > 0) Bank.withdraw(player, entry.item.getId(), entry.slot, amount, entry.tab);
            return true;
        }

        // The worn items view: the slot is the item's place in the list, so the item names it.
        if (packet.groupId === Bank.SIDE_INTERFACE_ID && packet.childId === Bank.SIDE_WORN_CHILD
            && packet.buttonNum === 1 && packet.itemId != null) {
            const itemId = packet.itemId;
            Bank.depositItems(player, player.getEquipment(), false, (item) => item.getId() === itemId);
            return true;
        }

        if (packet.groupId === Bank.SIDE_INTERFACE_ID &&
            (packet.childId === 3 || packet.childId >= 0x8000) && packet.slot != null) {
            const item = player.getInventory().getItems()[packet.slot];
            if (!item || item.getId() < 0 || (packet.itemId != null && packet.itemId !== item.getId())) return true;
            const event = { player, item, slot: packet.slot, op: packet.buttonNum, option: packet.option, handled: false };
            getPluginManager().emitCustomEvent(Bank.INVENTORY_OP_EVENT, event);
            if (event.handled) return true;
            if (packet.buttonNum === Bank.SIDE_EQUIP_OP) {
                Bank.equipFromSide(player, item.getId(), packet.slot);
                return true;
            }
            if (Bank.asksAmount("deposit", packet.buttonNum, packet.option, player.getBankCustomQuantity(), player.getBankQuantityMode())) {
                const itemId = item.getId();
                const slot = packet.slot;
                Bank.promptAmount(player, (amount) => {
                    if (player.getInventory().getItems()[slot]?.getId() === itemId) Bank.deposits(player, itemId, slot, amount);
                });
                return true;
            }
            const amount = Bank.actionAmount(
                "deposit", packet.buttonNum, packet.option, player.getInventory().getAmount(item.getId()),
                player.getBankCustomQuantity(), player.getBankQuantityMode(),
            );
            if (amount > 0) Bank.deposits(player, item.getId(), packet.slot, amount);
            return true;
        }

        if (packet.groupId === Bank.MAIN_INTERFACE_ID && packet.childId === Bank.TABS_CHILD && packet.slot != null) {
            const tab = packet.slot - Bank.TAB_BUTTON_SLOT_OFFSET;
            if (tab < 0 || tab > 9) return true;
            const option = packet.option?.trim().toLowerCase() ?? "";
            if (packet.buttonNum === 6 || option.includes("collapse")) Bank.collapseTab(player, tab);
            else if (packet.buttonNum === 7 || option.includes("placeholder")) Bank.releasePlaceholders(player, tab);
            else {
                Bank.viewTab(player, tab);
                Bank.closeSearch(player);
            }
            return true;
        }

        // Capture: Search switches to the main tab (the client runs the search itself).
        if (packet.groupId === Bank.MAIN_INTERFACE_ID && packet.childId === Bank.SEARCH_CHILD) {
            if (player.getCurrentBankTab() !== 0) Bank.viewTab(player, 0);
            return true;
        }

        if (packet.groupId !== Bank.MAIN_INTERFACE_ID) return false;
        const sender = player.getPacketSender();
        if (packet.childId === Bank.FRAME_CHILD) sender.sendInterfaceRemoval();
        else if (packet.childId === Bank.SWAP_INSERT_CHILD) {
            player.setInsertMode(!player.insertModeReturn());
            sender.sendVarbit(3959, player.insertModeReturn() ? 1 : 0);
        } else if (packet.childId === Bank.NOTE_CHILD) {
            player.setNoteWithdrawal(!player.withdrawAsNote());
            sender.sendVarbit(3958, player.withdrawAsNote() ? 1 : 0);
        } else if (packet.childId === Bank.QUANTITY_CHILDREN[Bank.QUANTITY_X_MODE] && packet.buttonNum === 2) {
            // Capture: Set custom quantity only asks for the amount; nothing moves.
            Bank.promptAmount(player);
        } else if (Bank.QUANTITY_CHILDREN.includes(packet.childId)) {
            player.setBankQuantityMode(Bank.QUANTITY_CHILDREN.indexOf(packet.childId));
            sender.sendVarbit(6590, player.getBankQuantityMode());
        } else if (packet.childId === Bank.PLACEHOLDER_CHILD) {
            player.setPlaceholders(!player.isPlaceholders());
            sender.sendVarbit(3755, player.isPlaceholders() ? 1 : 0);
        } else if (packet.childId === Bank.DEPOSIT_INVENTORY_CHILD) Bank.depositItems(player, player.getInventory(), false);
        else if (packet.childId === Bank.DEPOSIT_WORN_CHILD) Bank.depositItems(player, player.getEquipment(), false);
        else return false;
        return true;
    }

    /**
     * Removes an item from the bank search tab
     *
     * @param player
     * @param item
     */
    public static removeFromBankSearch(player: Player, item: Item, refresh: boolean) {

        if (item.getDefinition().isNoted()) {
            item.setId(item.getDefinition().unNote());
        }

        player.getBank(this.BANK_SEARCH_TAB_INDEX).deleteBoolean(item, refresh);
    }

    /**
     * Moves an item from one slot to another using the insert method. It will shift
     * all other items to the right.
     *
     * @param player
     * @param fromSlot
     * @param toSlot
     */
    public static rearrange(player: Player, bank: Bank, fromSlot: number, toSlot: number) {
        if (player.insertModeReturn()) {

            let tempFrom = fromSlot;

            for (let tempTo = toSlot; tempFrom !== tempTo; ) {
                if (tempFrom > tempTo) {
                    bank.swap(tempFrom, tempFrom - 1);
                    tempFrom--;
                } else if (tempFrom < tempTo) {
                    bank.swap(tempFrom, tempFrom + 1);
                    tempFrom++;
                }
            }

        } else {
            bank.swap(fromSlot, toSlot);
        }

        if (player.getCurrentBankTab() === 0 && !player.isSearchingBank()) {
            player.getBank(0).refreshItems();
        } else {
            bank.refreshItems();
        }

        // Update all tabs if we moved an item from/to the first item slot
        if (fromSlot === 0 || toSlot === 0) {
            Bank.reconfigureTabs(player);
        }
    }

    public static handleButton(player: Player, button: number, action: number): boolean {
        if (player.getInterfaceId() == 32500) {
            // Handle bank settings
            switch (button) {
            case 32503:
                Sounds.sendSound(player, Sound.CONTAINER_CLOSE);
                player.getPacketSender().sendInterfaceRemoval();
                break;
            case 32512:
                player.getBank(player.getCurrentBankTab()).open();
                break;
            case 32513:
                player.setPlaceholders(!player.isPlaceholders());
                player.getPacketSender().sendConfig(118, player.isPlaceholders() ? 1 : 0);
                player.sendMessage(
                        "Placeholders are now " + (player.isPlaceholders() ? "enabled" : "disabled") + ".");
                break;
            }
            return true;
        } else if (Bank.isOpen(player)) {
            if (player.getStatus() == PlayerStatus.BANKING) {
                let tab_select_start = 50070;
                for (let bankId = 0; bankId < this.TOTAL_BANK_TABS; bankId++) {
                    if (button == tab_select_start + (bankId * 4)) {

                        const searching = player.isSearchingBank();
                        if (searching) {
                            this.exitSearch(player, false);
                        }

                        // First, check if empty
                        let empty = bankId > 0 ? Bank.isEmpty(player.getBank(bankId)) : false;

                        if (action === 1) {
                            // Collapse tab!!!
                            if (bankId === 0) {
                                return true;
                            }
                            if (empty) {
                                return true;
                            }
                            let items: Item[] = player.getBank(bankId).getValidItems();
                            if (player.getBank(0).getFreeSlots() < items.length) {
                                player.sendMessage("You don't have enough free slots in your Main tab to do that.");
                                return true;
                            }
                            let noteWithdrawal: boolean = player.withdrawAsNote();
                            player.setNoteWithdrawal(false);
                            for (let item of items) {
                                player.getBank(bankId).switchsItem(player.getInventory(), item.clone(), player.getBank(bankId).getSlotForItemId(item.getId()), false, false);
                            }
                            player.setNoteWithdrawal(noteWithdrawal);
                            this.reconfigureTabs(player);
                            player.getBank(player.getCurrentBankTab()).refreshItems();
                        } else {
                            if (!empty || bankId === 0) {
                                player.setCurrentBankTab(bankId);
                                player.getBank(bankId).open();
                            } else {
                                player.sendMessage(NEW_TAB_MESSAGE);
                                if (searching) {
                                    player.getBank(player.getCurrentBankTab()).open();
                                }
                            }
                        }
                        return true;
                    }
                }

                switch (button) {
                    case 50013:
                        // Show menu
                        player.getPacketSender().sendInterfaceRemoval();
                        player.getPacketSender().sendInterface(32500);
                        break;
                    case 5386:
                        player.setNoteWithdrawal(true);
                        break;
                    case 5387:
                        player.setNoteWithdrawal(false);
                        break;
                    case 8130:
                        player.setInsertMode(false);
                        break;
                    case 8131:
                        player.setInsertMode(true);
                        break;
                    case 50004:
                        this.depositItems(player, player.getInventory(), false);
                        break;
                    case 50007:
                        this.depositItems(player, player.getEquipment(), false);
                        break;
                    case 5384:
                    case 50001:
                        Sounds.sendSound(player, Sound.CONTAINER_CLOSE);
                        player.getPacketSender().sendInterfaceRemoval();
                        break;
                    case 50010:
                        if (player.isSearchingBank()) {
                            this.exitSearch(player, true);
                            return true;
                        }
                        player.setEnteredSyntaxAction(new bankEntered((input) => {Bank.search(player, input)}));
                        player.getPacketSender().sendEnterInputPrompt("What do you wish to search for?");
                        break;
                }
            }
            return true;
        }
        return false;
    }
    /** Banks [from]'s items, or only those [only] picks (one worn item). */
    public static depositItems(player: Player, from: ItemContainer, ignoreReqs: boolean, only?: (item: Item) => boolean) {
        if (!ignoreReqs) {
            if (!Bank.isOpen(player)) {
                return;
            }
        }
        let movedAny = false;
        for (let item of from.getValidItems()) {
            if (only && !only(item)) continue;
            if (getPluginManager().emitCanBankItem(player, item) === false) {
                continue;
            }
            from.switchItems(player.getBank(Bank.getTabForItem(player, item.getId())), item.clone(),false, false);
            movedAny = true;
        }
        from.refreshItems();
        if (player.isSearchingBank()) {
            player.getBank(this.BANK_SEARCH_TAB_INDEX).refreshItems();
        } else {
            player.getBank(player.getCurrentBankTab()).refreshItems();
        }
        if (movedAny) {
            Sounds.sendSound(player, from instanceof Equipment ? Sound.EQUIPMENT_OFF : Sound.DROP_ITEM);
        }
        if (from instanceof Equipment) {
            WeaponInterfaceManager.assign(player);
            BonusManager.update(player);
            player.getUpdateFlag().flag(Flag.APPEARANCE);
        }
    }

    /**
     * Is a bank empty?
     *
     * @param bank
     * @return
     */
    public static isEmpty(bank: Bank): boolean {
        return bank.sortItems().getValidItems().length <= 0;
    }

    /**
     * Reconfigures our bank tabs
     *
     * @param player
     */
    public static reconfigureTabs(player: Player): boolean {
        let updateRequired = false;
        for (let k = 1; k < this.BANK_SEARCH_TAB_INDEX - 1; k++) {
            if (this.isEmpty(player.getBank(k)) || updateRequired) {
                player.setBank(k, player.getBank(k + 1));
                player.setBank(k + 1, new Bank(player));
                updateRequired = true;
            }
        }

        // Check if we're in a tab that's empty
        // If so, open the next non-empty tab
        let total_tabs = this.getTabCount(player);
        if (!player.isSearchingBank()) {
            if (player.getCurrentBankTab() > total_tabs) {
                player.setCurrentBankTab(total_tabs);
                player.getBank(total_tabs).open();
                return true;
            }
        }
        return false;
    }

    public static getTabCount(player: Player): number {
        let tabs = 0;
        for (let i = 1; i < this.TOTAL_BANK_TABS; i++) {
            if (i === this.BANK_SEARCH_TAB_INDEX) {
                continue;
            }
            if (!this.isEmpty(player.getBank(i))) {
                tabs++;
            } else
                break;
        }
        return tabs;
    }

    /**
     * Gets the specific tab in which an item is.
     *
     * @param player
     * @param itemID
     * @return
     */
    public static getTabForItem(player: Player, itemID: number): number {
        if (ItemDefinition.forId(itemID).isNoted()) {
            itemID = ItemDefinition.forId(itemID).unNote();
        }
        for (let k = 0; k < this.TOTAL_BANK_TABS; k++) {
            if (k === this.BANK_SEARCH_TAB_INDEX) {
                continue;
            }
            if (player.getBank(k).contains(itemID)) {
                return k;
            }
        }

        // Find empty bank slot
        if (player.getBank(player.getCurrentBankTab()).getFreeSlots() > 0) {
            return player.getCurrentBankTab();
        }
        for (let k = 0; k < this.TOTAL_BANK_TABS; k++) {
            if (k === this.BANK_SEARCH_TAB_INDEX) {
                continue;
            }
            if (player.getBank(k).getFreeSlots() > 0) {
                return k;
            }
        }
        return 0;
    }

    public static contains(player: Player, item: Item): boolean {
        let tab = this.getTabForItem(player, item.getId());
        return player.getBank(tab).getAmount(item.getId()) >= item.getAmount();
    }

    /** This tab's slots so far (it grows); the player's space is getCapacity. */
    public capacity(): number {
        return this.items?.length ?? 0;
    }

    public stackType(): StackType {
        return StackType.STACKS;
    }

    public open(): Bank {
        const pluginCanBank = getPluginManager().emitCanBank(this.getPlayer(), "open");
        if (pluginCanBank === false) {
            return this;
        }
        const opening = !Bank.isOpen(this.getPlayer());

        // Update player status
        this.getPlayer().setStatus(PlayerStatus.BANKING);
        this.getPlayer().setEnteredSyntaxAction(null);

        this.sortItems();

        const player = this.getPlayer();
        const sender = player.getPacketSender();
        const varps = {
            548: 1,
            [Bank.LOCKED_SLOTS_VARP]: Bank.MAX_SLOTS - Bank.getCapacity(player),
        };
        const varbits: Record<number, number> = {
            3755: player.isPlaceholders() ? 1 : 0,
            3958: player.withdrawAsNote() ? 1 : 0,
            3959: player.insertModeReturn() ? 1 : 0,
            [Bank.REQUESTED_QUANTITY_VARBIT]: player.getBankCustomQuantity(),
            4150: player.getCurrentBankTab(),
            4170: 0,
            5450: 1,
            6590: player.getBankQuantityMode(),
        };
        for (let tab = 1; tab <= 9; tab++) {
            varbits[4170 + tab] = player.getBank(tab).getValidItems().length;
        }
        player.setInterfaceId(Bank.MAIN_INTERFACE_ID);
        sender.sendInterfaceScript(917, [-1, -2])
            .sendSubInterface((161 << 16) | 16, Bank.MAIN_INTERFACE_ID, 0, { varps, varbits })
            .sendSubInterface((161 << 16) | 74, Bank.SIDE_INTERFACE_ID, 3, { varps, varbits })
            .sendInterfaceFlagsRange((Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD, 0, 1409, Bank.ITEM_SLOT_FLAGS, Bank.ITEM_SLOT_OPS)
            // The empty space after each tab's items is a drop target (one per tab).
            .sendInterfaceFlagsRange((Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD,
                Bank.TAB_DROP_SLOT_OFFSET, Bank.TAB_DROP_SLOT_OFFSET + 9, 1 << 20)
            // The tab bar: click a tab, drop an item on one (or on the new-tab slot) to move it there,
            // drag a tab to reorder. The official client only allows what is enabled here.
            .sendInterfaceFlagsRange((Bank.MAIN_INTERFACE_ID << 16) | Bank.TABS_CHILD,
                Bank.TAB_BUTTON_SLOT_OFFSET, Bank.TAB_BUTTON_SLOT_OFFSET + 9, Bank.TAB_BUTTON_FLAGS)
            .sendInterfaceFlagsRange((Bank.SIDE_INTERFACE_ID << 16) | 3, 0, 27, 3278846)
            .sendInterfaceFlagsRange((Bank.SIDE_INTERFACE_ID << 16) | Bank.SIDE_WORN_CHILD, 0, 27, Bank.SIDE_WORN_FLAGS)
            .sendVarbit(12393, 1)
            .sendString(`Bank of ${GameConstants.NAME}`, (Bank.MAIN_INTERFACE_ID << 16) | 3);
        // Captured: the bank opens on the inventory, not a container left in view last time.
        if (opening && sender.getVarbit(Bank.VIEW_CONTAINER_VARBIT) !== 0) {
            sender.sendVarbit(Bank.VIEW_CONTAINER_VARBIT, 0).sendConfig(Bank.VIEW_CONTAINER_OBJ_VARP, -1);
        }
        this.refreshItems();
        if (opening) {
            Sounds.sendSound(this.getPlayer(), Sound.CONTAINER_OPEN);
            getPluginManager().emitCustomEvent(Bank.OPENED_EVENT, { player });
        }

        return this;
    }

    public refreshItems(): Bank {
        // Reconfigure bank tabs.
        if (Bank.reconfigureTabs(this.getPlayer())) {
            return this;
        }

        const sender = this.getPlayer().getPacketSender();
        // Not varbit 4150 (BANK_CURRENTTAB): the client picks its tab locally,
        // so re-sending our idea of it would yank the player back to that tab
        // on every item movement. It is sent where the tab actually changes.
        for (let tab = 1; tab <= 9; tab++) {
            sender.sendVarbit(4170 + tab, this.getPlayer().getBank(tab).getValidItems().length);
        }
        sender.sendBankSnapshot().sendItemContainer(this.getPlayer().getInventory(), Bank.INVENTORY_INTERFACE_ID);
        // Plugins that label the side panel's item ops (if1-if4 bits) recompute them here.
        getPluginManager().emitCustomEvent(Bank.REFRESHED_EVENT, { player: this.getPlayer() });

        return this;
    }


    public switchsItem(to: ItemContainer, item: Item, slot: number, sort: boolean, refresh: boolean): Bank {
    // Make sure we're actually banking!
    if (!Bank.isOpen(this.getPlayer())) {
    return this;
    }
        // Make sure we have the item!
        if (this.getItems()[slot].getId() != item.getId() || !this.contains(item.getId())) {
            return this;
        }

        const noteId = item.getDefinition().getNoteId();
        const noteDefinition = noteId >= 0 ? ItemDefinition.forId(noteId) : null;
        const canWithdrawAsNote = noteDefinition?.isNoted() === true &&
            noteDefinition.getName().toLowerCase() === item.getDefinition().getName().toLowerCase();

        // Make sure we have enough space in the other container
        if (to.getFreeSlots() <= 0 && (!(to.contains(item.getId()) && item.getDefinition().isStackable()))
                && !(this.getPlayer().withdrawAsNote() && canWithdrawAsNote && to.contains(noteId))) {
            if (to instanceof Inventory) this.getPlayer().sendMessage(INVENTORY_FULL_MESSAGE);
            else to.full();
            return this;
        }

        // If bank > inventory and item.amount > inventory.freeslots,
        // change the item amount to the free slots we have in inventory.
        let shortened = false;
        if (item.getAmount() > to.getFreeSlots() && !item.getDefinition().isStackable()) {
            if (to instanceof Inventory) {
                if (this.getPlayer().withdrawAsNote()) {
                    if (!canWithdrawAsNote) {
                        item.setAmount(to.getFreeSlots());
                        shortened = true;
                    }
                } else {
                    item.setAmount(to.getFreeSlots());
                    shortened = true;
                }
            }
        }
        if (shortened) this.getPlayer().sendMessage(WITHDRAW_PARTIAL_MESSAGE);

        // Make sure we aren't taking more than we have.
        if (item.getAmount() > this.getAmount(item.getId())) {
            item.setAmount(this.getAmount(item.getId()));
        }

        if (to instanceof Inventory) {
            const withdrawAsNote = this.getPlayer().withdrawAsNote() && canWithdrawAsNote;
            const checkId = withdrawAsNote ? noteId : item.getId();
            if (to.getAmount(checkId) + item.getAmount() > MAX_STACK_AMOUNT
                    || to.getAmount(checkId) + item.getAmount() <= 0) {
                item.setAmount(MAX_STACK_AMOUNT - (to.getAmount(item.getId())));
                if (item.getAmount() <= 0) {
                    this.getPlayer().sendMessage("You cannot withdraw that entire amount into your inventory.");
                        return this;
                }
            }
        }

        // Make sure the item is still valid
        if (item.getAmount() <= 0) {
            return this;
        }

        this.deleteItemContainer(item, slot, to instanceof Inventory ? false : refresh, to);


        // Check if we can actually withdraw the item as a note.
        if (this.getPlayer().withdrawAsNote()) {
            if (canWithdrawAsNote)
                item.setId(noteId);
            else
                this.getPlayer().sendMessage("This item cannot be withdrawn as a note.");
        }

        // Add the item to the other container
        const previousItems = to instanceof Inventory ? new Set(to.getValidItems()) : null;
        to.add(item, previousItems ? false : refresh);
        if (previousItems) {
            const items = to.getValidItems().filter(added => !previousItems.has(added));
            if (items.length > 0) {
                getPluginManager().emitCustomEvent(Bank.WITHDRAWN_ITEMS_EVENT, { player: this.getPlayer(), items });
            }
        }

        // Sort this container
        if (sort && this.getAmount(item.getId()) <= 0)
            this.sortItems();

        // Refresh containers
        if (refresh) {
            this.refreshItems();
            to.refreshItems();
        }

        if (this.getPlayer().isSearchingBank()) {
            Bank.removeFromBankSearch(this.getPlayer(), item.clone(), true);
        }

        return this;
    }

}

class bankEntered implements EnteredSyntaxAction{
    constructor(private readonly execFunc: Function){}

    execute(syntax: string): void {
        this.execFunc();
    }

}
