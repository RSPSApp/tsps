import { quantityToStackSize } from "../grounditems/groundItemRules";

export const COINS = 995;
export const PLATINUM_TOKEN = 13204;
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

/**
 * ItemManager.getItemPrice and BankPlugin.getHaPrice for an item: coins and platinum tokens are
 * their face value, anything else its unnoted item's guide price and high alchemy value.
 */
export function itemPrices(
    itemId: number,
    canonicalize: (itemId: number) => number,
    storePrice: (itemId: number) => number,
    guidePrice: (itemId: number) => number | undefined,
): ItemPrices {
    if (itemId === COINS) return { ge: 1, ha: 1 };
    if (itemId === PLATINUM_TOKEN) return { ge: 1000, ha: 1000 };
    const unnoted = canonicalize(itemId);
    if (unnoted === COINS) return { ge: 1, ha: 1 };
    if (unnoted === PLATINUM_TOKEN) return { ge: 1000, ha: 1000 };
    return { ge: guidePrice(unnoted), ha: Math.floor(storePrice(unnoted) * HIGH_ALCHEMY_MULTIPLIER) };
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
export type ValueSearchItem = { quantity: number; ge: number; ha: number };

/** BankPlugin.valueSearch: whether `search` is a value search the item matches. */
export function valueSearch(item: () => ValueSearchItem, search: string): boolean {
    const match = VALUE_SEARCH_PATTERN.exec(search);
    if (!match?.groups) return false;
    const { mode, individual, op, num, num1, num2 } = match.groups;
    const { quantity, ge, ha } = item();

    let value: number;
    switch ((mode ?? "").toLowerCase()) {
        case "qty":
            value = quantity;
            break;
        case "ha":
        case "alch":
            value = individual !== undefined ? ha : quantity * ha;
            break;
        default:
            value = individual !== undefined ? ge : quantity * ge;
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
