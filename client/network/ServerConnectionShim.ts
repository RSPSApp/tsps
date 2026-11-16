// Shim for ServerConnection that can be safely imported in toolkit/browser contexts
// Provides no-op implementations when ServerConnection is not available

export type SkillEntryMessage = {
    id: number;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
    currentLevel: number;
};

export type SkillsUpdateEvent = {
    kind: "snapshot" | "delta";
    totalLevel: number;
    combatLevel: number;
    skills: SkillEntryMessage[];
};

export type ShopStockEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
    defaultQuantity?: number;
    priceEach?: number;
    sellPrice?: number;
};

export type ShopWindowState = {
    open: boolean;
    shopId?: string;
    name?: string;
    currencyItemId?: number;
    generalStore?: boolean;
    buyMode: number;
    sellMode: number;
    stock: ShopStockEntryMessage[];
    inventoryId?: number;
};

export type TradeOfferEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
};

export type TradePartyViewState = {
    playerId?: number;
    name?: string;
    offers: TradeOfferEntryMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeWindowState = {
    open: boolean;
    sessionId?: string;
    stage: "offer" | "confirm";
    self?: TradePartyViewState;
    other?: TradePartyViewState;
    infoMessage?: string;
    requestFrom?: { playerId: number; name?: string };
};

export type RunEnergyState = {
    percent: number;
    units: number;
    running: boolean;
    weight: number;
    stamina?: {
        ticks: number;
        msPerTick: number;
        multiplier: number;
        expiresAt: number;
    };
};

const noOpSendWidgetOpen = (groupId: number, opts?: any) => {
    console.log("[ServerConnectionShim] sendWidgetOpen (no-op)", groupId, opts);
};

const noOpSendWidgetClose = (groupId: number) => {
    console.log("[ServerConnectionShim] sendWidgetClose (no-op)", groupId);
};

const noOpSendWidgetAction = (payload: any) => {
    console.log("[ServerConnectionShim] sendWidgetAction (no-op)", payload);
};

const noOpSendBankDepositInventory = (tab?: number) => {
    console.log("[ServerConnectionShim] sendBankDepositInventory (no-op)", { tab });
};

const noOpSendBankDepositEquipment = (tab?: number) => {
    console.log("[ServerConnectionShim] sendBankDepositEquipment (no-op)", { tab });
};

const noOpSendBankDepositItem = (slot?: number, itemId?: number, qty?: number, tab?: number) => {
    console.log("[ServerConnectionShim] sendBankDepositItem (no-op)", { slot, itemId, qty, tab });
};

const noOpSubscribeSkills = (callback: (event: SkillsUpdateEvent) => void) => {
    console.log("[ServerConnectionShim] subscribeSkills (no-op)");
    return () => {}; // Return no-op unsubscribe
};

const noOpSubscribeRunEnergy = (callback: (state: RunEnergyState) => void) => {
    console.log("[ServerConnectionShim] subscribeRunEnergy (no-op)");
    return () => {};
};

const noOpSubscribeBank = (callback: any) => {
    console.log("[ServerConnectionShim] subscribeBank (no-op)");
    return () => {};
};

const noOpSubscribeShop = (callback: (state: ShopWindowState) => void) => {
    console.log("[ServerConnectionShim] subscribeShop (no-op)");
    return () => {};
};

const noOpSubscribeTrade = (callback: (state: TradeWindowState) => void) => {
    console.log("[ServerConnectionShim] subscribeTrade (no-op)");
    return () => {};
};

const noOpGetLatestShopState = (): ShopWindowState => ({
    open: false,
    buyMode: 0,
    sellMode: 0,
    stock: [],
});

const noOpGetLatestTradeState = (): TradeWindowState => ({
    open: false,
    stage: "offer",
    self: undefined,
    other: undefined,
    infoMessage: undefined,
    requestFrom: undefined,
});

const noOpSendTradeOffer = () => {
    console.log("[ServerConnectionShim] sendTradeOffer (no-op)");
};

const noOpSendTradeRemove = () => {
    console.log("[ServerConnectionShim] sendTradeRemove (no-op)");
};

const noOpSendTradeAccept = () => {
    console.log("[ServerConnectionShim] sendTradeAccept (no-op)");
};

const noOpSendTradeDecline = () => {
    console.log("[ServerConnectionShim] sendTradeDecline (no-op)");
};

const noOpSendTradeConfirmAccept = () => {
    console.log("[ServerConnectionShim] sendTradeConfirmAccept (no-op)");
};

const noOpSendTradeConfirmDecline = () => {
    console.log("[ServerConnectionShim] sendTradeConfirmDecline (no-op)");
};

// Export no-op implementations for toolkit contexts
export const sendWidgetOpen = noOpSendWidgetOpen;
export const sendWidgetClose = noOpSendWidgetClose;
export const sendWidgetAction = noOpSendWidgetAction;
export const sendBankDepositInventory = noOpSendBankDepositInventory;
export const sendBankDepositEquipment = noOpSendBankDepositEquipment;
export const sendBankDepositItem = noOpSendBankDepositItem;
export const subscribeSkills = noOpSubscribeSkills;
export const subscribeRunEnergy = noOpSubscribeRunEnergy;
export const subscribeBank = noOpSubscribeBank;
export const subscribeShop = noOpSubscribeShop;
export const getLatestShopState = noOpGetLatestShopState;
export const subscribeTrade = noOpSubscribeTrade;
export const getLatestTradeState = noOpGetLatestTradeState;
export const sendTradeOffer = noOpSendTradeOffer;
export const sendTradeRemove = noOpSendTradeRemove;
export const sendTradeAccept = noOpSendTradeAccept;
export const sendTradeDecline = noOpSendTradeDecline;
export const sendTradeConfirmAccept = noOpSendTradeConfirmAccept;
export const sendTradeConfirmDecline = noOpSendTradeConfirmDecline;
