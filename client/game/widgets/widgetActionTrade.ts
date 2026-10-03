import type { TradeWindowState } from "../../network/ServerConnection";
import {
    sendTradeAccept,
    sendTradeConfirmAccept,
    sendTradeConfirmDecline,
    sendTradeDecline,
    sendTradeOffer,
    sendTradeRemove,
} from "../../network/ServerConnection";
import { Inventory } from "../../rs/inventory/Inventory";
import { resolveTradeActionQuantity } from "../trade/TradeActionQuantity";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import type { Cs2Vm } from "../../rs/cs2/Cs2Vm";

export type WidgetActionTradeDeps = {
    getTradeState: () => TradeWindowState | undefined;
    getInventory: () => Inventory;
    getTradeOfferInventory: () => Inventory;
    getCs2Vm: () => Cs2Vm | undefined;
    getVarManager: () => VarManager | undefined;
    examineWidgetItem: (widget: { itemId?: number } | null | undefined) => boolean;
    setPendingTradeQuantityAction: (
        action: {
            action: "offer" | "remove";
            slot: number;
            itemId: number;
            maximum: number;
        } | null,
    ) => void;
};

/** Route the native trade widget's actions into the dedicated trade protocol. */
export function handleTradeWidgetAction(
    deps: WidgetActionTradeDeps,
    widget: any,
    event: {
        option?: string;
        slot?: number;
        itemId?: number;
    },
    groupId: number,
    childId: number,
): boolean {
    const tradeState = deps.getTradeState();
    if (![334, 335, 336].includes(groupId) || !tradeState?.open) return false;

    const option = String(event.option ?? "").trim();
    const optionKey = option.toLowerCase().replace(/[ _-]+/g, "");
    if (optionKey === "accept") {
        if (tradeState.stage === "confirm") sendTradeConfirmAccept();
        else sendTradeAccept();
        return true;
    }
    if (optionKey === "decline") {
        if (tradeState.stage === "confirm") sendTradeConfirmDecline();
        else sendTradeDecline();
        return true;
    }
    if (optionKey === "close") {
        if (tradeState.stage === "confirm") sendTradeConfirmDecline();
        else sendTradeDecline();
        return true;
    }
    if (optionKey === "examine") {
        deps.examineWidgetItem({
            itemId: event.itemId ?? widget?.itemId,
        });
        return true;
    }

    const isOffer = optionKey.startsWith("offer");
    const isRemove = optionKey.startsWith("remove");
    if (!isOffer && !isRemove) return false;
    if ((isOffer && groupId !== 336) || (isRemove && groupId !== 335)) return false;

    const slot = event.slot ?? widget?.childIndex ?? childId;
    if (!Number.isInteger(slot) || slot < 0 || slot >= Inventory.SLOT_COUNT) return true;

    const inventory = deps.getInventory();
    const tradeOfferInventory = deps.getTradeOfferInventory();
    const source = isOffer ? inventory : tradeOfferInventory;
    const entry = source.getSlot(slot);
    const itemId =
        entry && entry.itemId > 0 ? entry.itemId : (event.itemId ?? widget?.itemId ?? -1);
    // Unstackable items take one slot each, so count every slot holding the item.
    const available = source.count(itemId);
    if (optionKey.endsWith("x")) {
        if (!(itemId > 0) || available <= 0) return true;
        deps.setPendingTradeQuantityAction({
            action: isOffer ? "offer" : "remove",
            slot,
            itemId,
            maximum: Math.max(1, Math.min(2_147_483_647, Math.floor(available))),
        });
        const cs2Vm = deps.getCs2Vm();
        cs2Vm!.inputDialogType = 1;
        cs2Vm!.inputDialogWidgetId = -1;
        cs2Vm!.inputDialogString = "";
        deps.getVarManager()?.setVarcString(335, "");
        return true;
    }
    const quantity = resolveTradeActionQuantity(optionKey, available);
    if (!quantity || quantity <= 0) return true;

    if (!(itemId > 0)) return true;
    if (isOffer) {
        sendTradeOffer(slot, itemId, quantity);
    } else {
        sendTradeRemove(slot, itemId, quantity);
    }
    return true;
}
