import { quantityToStackSize } from "../grounditems/groundItemRules";

export const COINS = 995;
export const PLATINUM_TOKEN = 13204;
/** ItemID.BANK_FILLER: an empty bank slot's filler, which isn't an item the bank holds. */
export const BANK_FILLER = 20594;
/** ItemComposition.getHaPrice's multiplier. */
const HIGH_ALCHEMY_MULTIPLIER = 0.6;

/** QuantityFormatter.formatNumber: "1,234,567". */
export function formatNumber(value: number): string {
    return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** BankPlugin.createValueText: " (GE: 1.5M) (HA: 900K)", only the parts that are on and non-zero. */
export function createValueText(
    gePrice: number,
    haPrice: number,
    config: { showGE: boolean; showHA: boolean; showExact: boolean },
): string {
    const format = (value: number) => (config.showExact ? formatNumber(value) : quantityToStackSize(value));
    let text = "";
    if (config.showGE && gePrice !== 0) text += ` (${config.showHA ? "GE: " : ""}${format(gePrice)})`;
    if (config.showHA && haPrice !== 0) text += ` (${config.showGE ? "HA: " : ""}${format(haPrice)})`;
    return text;
}

/** The prices of one item, as BankPlugin reads them. */
export type ItemPrices = {
    /** ItemManager.getItemPrice: undefined while the guide prices load. */
    ge: number | undefined;
    /** BankPlugin.getHaPrice. */
    ha: number;
};

/** The item definition fields prices come from (RuneLite's ItemComposition). */
export type PricingDefinition = {
    /** getNote: the note template id, or -1. */
    noteTemplate?: number;
    /** getLinkedNoteId: the item a note's id points at. */
    note?: number;
    /** getPrice: the store price. */
    price?: number;
};

/**
 * ItemManager.getItemPrice and BankPlugin.getHaPrice for an item: coins and platinum tokens are
 * their face value, anything else its guide price and high alchemy value. ItemManager prices a
 * noted item as the item it notes, but a placeholder has no price of its own, and is not mapped.
 */
export function itemPrices(
    itemId: number,
    definition: (itemId: number) => PricingDefinition | undefined,
    guidePrice: (itemId: number) => number | undefined,
): ItemPrices {
    if (itemId === COINS) return { ge: 1, ha: 1 };
    if (itemId === PLATINUM_TOKEN) return { ge: 1000, ha: 1000 };
    const def = definition(itemId);
    const priced = def && (def.noteTemplate ?? -1) !== -1 && (def.note ?? -1) >= 0 ? def.note! : itemId;
    return { ge: guidePrice(priced), ha: Math.floor((def?.price ?? 0) * HIGH_ALCHEMY_MULTIPLIER) };
}

const NUMBER_REGEX = "[0-9]+(?:\\.[0-9]+)?[kmb]?";
/** BankPlugin.VALUE_SEARCH_PATTERN: "ge>1m", "ha <= 50k", "qty=1", "i 10k-20k", "1m-5m". */
const VALUE_SEARCH_PATTERN = new RegExp(
    "^(?<mode>qty|ge|ha|alch)?" +
        " *(?<individual>i|iv|individual|per)?" +
        ` *(?:(?:(?<op>[<>=]|>=|<=) *(?<num>${NUMBER_REGEX}))|` +
        `(?:(?<num1>${NUMBER_REGEX}) *- *(?<num2>${NUMBER_REGEX})))$`,
    "i",
);

/** QuantityFormatter.parseQuantity: "1.5m" -> 1500000. */
export function parseQuantity(text: string): number {
    const last = text.slice(-1).toLowerCase();
    const multiplier = last === "k" ? 1_000 : last === "m" ? 1_000_000 : last === "b" ? 1_000_000_000 : 1;
    return Math.trunc(Number.parseFloat(text) * multiplier);
}

/** A bank item, for a value search. */
export type ValueSearchItem = {
    quantity: number;
    ge: number;
    ha: number;
    /** ItemComposition.getPlaceholderTemplateId != -1: a placeholder's quantity is unknown. */
    placeholder: boolean;
};

/** BankPlugin.valueSearch: whether `search` is a value search the item matches. */
export function valueSearch(item: () => ValueSearchItem, search: string): boolean {
    const match = VALUE_SEARCH_PATTERN.exec(search);
    if (!match?.groups) return false;
    const { mode, individual, op, num, num1, num2 } = match.groups;
    const { quantity, ge, ha, placeholder } = item();

    // "i" compares one item, not the stack.
    const qty = individual !== undefined ? 1 : quantity;
    const gePrice = ge * qty;
    const haPrice = ha * qty;
    // No mode takes the better of the two prices.
    let value = Math.max(gePrice, haPrice);
    switch ((mode ?? "").toLowerCase()) {
        case "qty":
            value = placeholder ? 0 : qty;
            break;
        case "ha":
        case "alch":
            value = haPrice;
            break;
        case "ge":
            value = gePrice;
            break;
    }

    if (op !== undefined) {
        const compare = parseQuantity(num);
        switch (op) {
            case ">": return value > compare;
            case "<": return value < compare;
            case "=": return value === compare;
            case ">=": return value >= compare;
            case "<=": return value <= compare;
        }
    }
    if (num1 !== undefined && num2 !== undefined) return parseQuantity(num1) <= value && parseQuantity(num2) >= value;
    return false;
}
