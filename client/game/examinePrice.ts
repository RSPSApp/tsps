/** Settings > Chat: "Examine price info - Grand Exchange" (row 234). */
export const EXAMINE_PRICE_GE_VARBIT = 13826; // examine_price_ge_enabled
/** Settings > Chat: "Examine price info - Alchemy" (row 235). */
export const EXAMINE_PRICE_ALCH_VARBIT = 13827; // examine_price_alch_enabled

/** The item definition fields the price line reads. */
export type ExaminePriceDefinition = {
    name?: string;
    isTradable?: boolean;
    noteTemplate?: number;
    note?: number;
};

export type ExaminePriceDeps = {
    definition: (itemId: number) => ExaminePriceDefinition | undefined;
    /** The connected world's guide price: 0 without a quote, undefined while prices load. */
    guidePrice: (itemId: number) => number | undefined;
    /** What the world's alchemy spells pay: 0 for an item they refuse, undefined while values load. */
    alchemy: (itemId: number) => { ha: number; la: number } | undefined;
    varbit: (id: number) => number;
};

const number = (value: number): string => value.toLocaleString("en-US");
const red = (value: number): string => `<col=ff0000>${number(value)}</col>`;

/**
 * The line shown after an item's examine text, as the server sends it for inventory and ground
 * items: "Price of Steel scimitar: GE 67  HA 240  LA 160", or for a stack "Price of 100 x Feather:
 * GE 300 (3ea)  HA 100 (1ea)". A note is priced and named as the item it notes. Each value is left
 * out while its setting is off or it is 0, and there is no line for an item that can't be traded.
 */
export function examinePriceLine(itemId: number, amount: number, deps: ExaminePriceDeps): string | null {
    const showGe = deps.varbit(EXAMINE_PRICE_GE_VARBIT) === 1;
    const showAlch = deps.varbit(EXAMINE_PRICE_ALCH_VARBIT) === 1;
    if (!showGe && !showAlch) return null;
    const own = deps.definition(itemId);
    const pricedId = own && (own.noteTemplate ?? -1) !== -1 && (own.note ?? -1) >= 0 ? own.note! : itemId;
    const def = pricedId === itemId ? own : deps.definition(pricedId);
    if (!def?.isTradable || !def.name || def.name === "null") return null;
    const count = Math.max(1, Math.floor(amount) || 1);
    const parts: string[] = [];
    const add = (label: string, each: number) => {
        if (!(each > 0)) return;
        parts.push(count > 1 ? `${label} ${red(each * count)} (${red(each)}ea)` : `${label} ${red(each)}`);
    };
    if (showGe) add("GE", Math.floor(deps.guidePrice(pricedId) ?? 0));
    if (showAlch) {
        const alchemy = deps.alchemy(pricedId);
        add("HA", Math.floor(alchemy?.ha ?? 0));
        add("LA", Math.floor(alchemy?.la ?? 0));
    }
    if (!parts.length) return null;
    return `Price of ${count > 1 ? `${number(count)} x ` : ""}${def.name}: ${parts.join("  ")}`;
}
