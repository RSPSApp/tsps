import { ConfigChanged } from "@runelite/api/events";
import { BANK } from "@runelite/api/gameval/InventoryID";
import type { ConfigOf } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { getItemPricesRevision, guidePrice } from "../../../network/serverConnection/domain/itemPrices";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, ScriptCallbackEvent } from "../ClientPluginManager";
import { type BankTagsClient, osrsBankTagsClient } from "../banktags/bankClient";
import { Bankmain, ScriptID } from "../banktags/bankmain";
import { BankSearch } from "../banktags/BankSearch";
import { BankConfig } from "./BankConfig";
import { createValueText, type ItemPrices, itemPrices, valueSearch } from "./bankValue";

/** Where Bank reads guide prices; tests give their own. */
export type BankPrices = {
    guidePrice(itemId: number): number | undefined;
    revision(): number;
};

const SERVER_PRICES: BankPrices = { guidePrice, revision: getItemPricesRevision };

/**
 * RuneLite 1.13.3's Bank plugin, its value parts: the bank title shows the value of the items in
 * view, at Grand Exchange and high alchemy prices, and the bank search takes value searches
 * ("ge>1m", "ha<50k", "qty>=100", "100k-1m").
 *
 * The title is appended after [clientscript,bankmain_build] runs; RuneLite's patched copy of
 * [clientscript,bankmain_filteritem] supplies the search callback.
 */
export class BankPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Bank",
        description: "Show the value of your bank and search it by value",
        tags: ["grand", "exchange", "high", "alchemy", "prices", "value", "search"],
        configKey: "bankplugin",
    };

    static config = BankConfig;

    private readonly config: ConfigOf<typeof BankConfig>;
    private readonly client: BankTagsClient;
    private readonly prices: BankPrices;
    private readonly bankSearch: BankSearch;
    /** Bank item quantities by id, for one build's value searches. */
    private itemQuantities?: Map<number, number>;
    /** The price table's revision when the title was built without some prices; it relays out when they arrive. */
    private pricesPendingAt?: number;

    constructor(osrsClient?: OsrsClient, deps?: { client?: BankTagsClient; configManager?: ConfigManager; prices?: BankPrices }) {
        super();
        this.config = (deps?.configManager ?? inject(ConfigManager)).getConfig(BankConfig);
        this.client = deps?.client ?? osrsBankTagsClient(osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN));
        this.prices = deps?.prices ?? SERVER_PRICES;
        this.bankSearch = new BankSearch(this.client);
    }

    protected override async startUp(): Promise<void> {
        this.bankSearch.layoutBank();
    }

    protected override async shutDown(): Promise<void> {
        this.itemQuantities = undefined;
        this.pricesPendingAt = undefined;
        // Builds the title again, without the value.
        this.bankSearch.layoutBank();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (this.isStarted() && event.getGroup() === BankConfig.group) this.bankSearch.layoutBank();
    }

    onClientTick(): void {
        if (!this.isStarted() || this.pricesPendingAt === undefined) return;
        if (this.prices.revision() === this.pricesPendingAt) return;
        this.pricesPendingAt = undefined;
        if (this.client.getItemContainer(BANK)) this.bankSearch.layoutBank();
    }

    onScriptFinished(scriptId: number): void {
        if (!this.isStarted() || scriptId !== ScriptID.BANKMAIN_BUILD) return;
        this.itemQuantities = undefined;
        this.guard("bank title", () => this.appendBankValue());
    }

    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (!this.isStarted() || eventName !== "bankSearchFilter") return;
        this.guard(eventName, () => {
            const itemId = vm.intStack[vm.intStackSize - 1];
            const search = String(vm.stringStack[vm.stringStackSize - 1] ?? "");
            if (itemId > -1 && valueSearch(() => this.searchItem(itemId), search)) vm.intStack[vm.intStackSize - 2] = 1;
        });
    }

    /** BankPlugin.onScriptPostFired(BANKMAIN_BUILD). */
    private appendBankValue(): void {
        const prices = this.containerPrices();
        if (!prices) return;
        const title = this.client.getWidget(Bankmain.TITLE);
        if (!title) return;
        const text = createValueText(prices.ge, prices.ha, {
            showGE: this.config.showGE() === true,
            showHA: this.config.showHA() === true,
            showExact: this.config.showExact() === true,
        });
        if (text) {
            title.text = String(title.text ?? "") + text;
            this.client.widgets?.invalidateWidgetRender?.(title);
        }
    }

    /** BankPlugin.getWidgetContainerPrices: the items the bank shows, at their quantities. */
    private containerPrices(): { ge: number; ha: number } | undefined {
        const bank = this.client.getItemContainer(BANK);
        const children = this.client.getWidget(Bankmain.ITEMS)?.children;
        if (!bank || !children) return undefined;
        // The bank items come first, then the tab separators and the like.
        const size = Math.min(children.length, bankSize(bank.getSlots()));
        let ge = 0;
        let ha = 0;
        let pending = false;
        for (let i = 0; i < size; i++) {
            const child = children[i];
            const itemId = child?.itemId ?? -1;
            if (!child || child.hidden === true || (child as any).isHidden === true || itemId < 0) continue;
            const quantity = child.itemQuantity ?? 0;
            if (quantity <= 0) continue;
            const price = this.itemPrices(itemId);
            if (price.ge === undefined) pending = true;
            ge += (price.ge ?? 0) * quantity;
            ha += price.ha * quantity;
        }
        this.pricesPendingAt = pending ? this.prices.revision() : undefined;
        return { ge, ha };
    }

    private searchItem(itemId: number): { quantity: number; ge: number; ha: number } {
        if (!this.itemQuantities) {
            this.itemQuantities = new Map();
            for (const slot of this.client.getItemContainer(BANK)?.getSlots() ?? []) {
                if (slot.itemId < 0) continue;
                this.itemQuantities.set(slot.itemId, (this.itemQuantities.get(slot.itemId) ?? 0) + slot.quantity);
            }
        }
        const price = this.itemPrices(itemId);
        return { quantity: this.itemQuantities.get(itemId) ?? 0, ge: price.ge ?? 0, ha: price.ha };
    }

    private itemPrices(itemId: number): ItemPrices {
        return itemPrices(
            itemId,
            (id) => this.client.canonicalize(id),
            (id) => Math.max(0, Number(this.client.getItemDefinition(id)?.price ?? 0) | 0),
            (id) => this.prices.guidePrice(id),
        );
    }

    /** Runs a hook; a failure is logged and never reaches the bank's scripts. */
    private guard(what: string, fn: () => void): void {
        try {
            fn();
        } catch (error) {
            console.warn(`[bank] ${what} failed`, error);
        }
    }
}

/** ItemContainer.size for the bank: up to its last item. */
function bankSize(slots: { itemId: number }[]): number {
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].itemId >= 0) return i + 1;
    return 0;
}
