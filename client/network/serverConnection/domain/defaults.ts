import type { ShopWindowState, SmithingWindowState, TradePartyViewState, TradeWindowState } from "../types";

export function createDefaultShopState(): ShopWindowState {
    return {
        open: false,
        shopId: undefined,
        name: undefined,
        currencyItemId: undefined,
        generalStore: false,
        buyMode: 0,
        sellMode: 0,
        stock: [],
    };
}

export function cloneShopState(shopState: ShopWindowState): ShopWindowState {
    return {
        open: !!shopState.open,
        shopId: shopState.shopId,
        name: shopState.name,
        currencyItemId:
            typeof shopState.currencyItemId === "number"
                ? (shopState.currencyItemId as number) | 0
                : undefined,
        generalStore: !!shopState.generalStore,
        buyMode: shopState.buyMode | 0,
        sellMode: shopState.sellMode | 0,
        stock: shopState.stock.map((entry) => ({ ...entry })),
        inventoryId: typeof shopState.inventoryId === "number" ? shopState.inventoryId | 0 : undefined,
    };
}

export function createDefaultTradeState(): TradeWindowState {
    return {
        open: false,
        stage: "offer",
        self: undefined,
        other: undefined,
        infoMessage: undefined,
        requestFrom: undefined,
        sessionId: undefined,
    };
}

export function cloneTradeState(tradeState: TradeWindowState): TradeWindowState {
    const cloneParty = (party?: TradePartyViewState): TradePartyViewState | undefined => {
        if (!party) return undefined;
        return {
            playerId: party.playerId,
            name: party.name,
            accepted: party.accepted,
            confirmAccepted: party.confirmAccepted,
            offers: party.offers.map((offer) => ({ ...offer })),
        };
    };
    return {
        open: !!tradeState.open,
        sessionId: tradeState.sessionId,
        stage: tradeState.stage,
        self: cloneParty(tradeState.self),
        other: cloneParty(tradeState.other),
        infoMessage: tradeState.infoMessage,
        requestFrom: tradeState.requestFrom ? { ...tradeState.requestFrom } : undefined,
    };
}

export function createDefaultSmithingState(): SmithingWindowState {
    return {
        open: false,
        mode: "smelt",
        title: "Smelting",
        options: [],
        quantityMode: 0,
        customQuantity: 0,
    };
}

export function cloneSmithingState(smithingState: SmithingWindowState): SmithingWindowState {
    return {
        open: smithingState.open,
        mode: smithingState.mode,
        title: smithingState.title,
        quantityMode: smithingState.quantityMode,
        customQuantity: smithingState.customQuantity,
        options: smithingState.options.map((opt) => ({ ...opt })),
    };
}
