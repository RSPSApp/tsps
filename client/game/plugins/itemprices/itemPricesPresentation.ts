export type ItemPriceRow = [label: string, value: string];

export type ItemPriceSettings = {
    showGEPrice: boolean;
    showHAValue: boolean;
    showEA: boolean;
    showAlchProfit: boolean;
};

export function buildItemPriceRows(input: {
    itemId: number;
    quantity: number;
    storePrice: number | bigint;
    guideQuote?: number | bigint;
    natureRuneQuote?: number | bigint;
    settings: ItemPriceSettings;
}): ItemPriceRow[] {
    const { itemId, quantity: rawQuantity, storePrice, guideQuote, natureRuneQuote, settings } = input;
    if (!settings.showGEPrice && !settings.showHAValue) return [];
    const quantity = Math.max(1, Math.floor(Number(rawQuantity) || 1));
    if (itemId === 995) return [["Value", `${format(BigInt(quantity))} gp`]];
    if (itemId === 13204) return [["Value", `${format(BigInt(quantity) * 1000n)} gp`]];
    const store = toNonNegativeBigInt(storePrice);
    const ha = store * 3n / 5n;
    const ge = toNonNegativeBigInt(guideQuote);
    const nature = toNonNegativeBigInt(natureRuneQuote);
    const hasGe = settings.showGEPrice && ge > 0n;
    const hasHa = settings.showHAValue && ha > 0n;
    const rows: ItemPriceRow[] = [];
    if (hasGe) rows.push(["GE", stackText(ge, quantity, settings.showEA)]);
    if (hasHa) rows.push(["HA", stackText(ha, quantity, settings.showEA)]);

    if (settings.showAlchProfit && settings.showGEPrice && hasGe && ha > 0n && nature > 0n) {
        const profit = ha - ge - nature;
        if (profit !== 0n) rows.push(["HA profit", stackText(profit, quantity, settings.showEA)]);
    }
    return rows;
}

function stackText(each: bigint, quantity: number, showEach: boolean): string {
    const total = each * BigInt(quantity);
    return `${formatPrice(total)} gp${showEach && quantity > 1 ? ` (${formatPrice(each)} ea)` : ""}`;
}

export function formatPrice(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const sign = negative ? "-" : "";
    if (absolute < 10_000n) return `${sign}${format(absolute)}`;
    // Beyond RuneLite's supported B suffix, retain the exact grouped integer rather than
    // truncating away magnitude (e.g. 1e12 must never render as 1,00B).
    if (absolute >= 1_000_000_000_000n) return `${sign}${format(absolute)}`;
    const suffixes = ["", "K", "M", "B"];
    let tier = 0;
    let divisor = 1n;
    for (let candidate = 3; candidate >= 1; candidate--) {
        const candidateDivisor = 10n ** BigInt(candidate * 3);
        if (absolute >= candidateDivisor) {
            tier = candidate;
            divisor = candidateDivisor;
            break;
        }
    }
    let roundedThousandths = (absolute * 1000n + divisor / 2n) / divisor;
    // Rounding may carry the mantissa into the next suffix tier (e.g. 999.9995K -> 1M).
    if (roundedThousandths >= 1_000_000n) {
        if (tier === 3) return `${sign}${format(absolute)}`;
        tier++;
        divisor *= 1000n;
        roundedThousandths = (absolute * 1000n + divisor / 2n) / divisor;
    }
    const whole = roundedThousandths / 1000n;
    const fraction = (roundedThousandths % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
    let displayed = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (fraction) displayed += `.${fraction}`;
    // Match the compact K/M/B display used for ordinary OSRS stack totals.
    displayed = displayed.slice(0, 4).replace(/\.$/, "");
    return `${sign}${displayed}${suffixes[tier]}`;
}

function toNonNegativeBigInt(value: number | bigint | undefined): bigint {
    if (typeof value === "bigint") return value > 0n ? value : 0n;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return 0n;
    return BigInt(value);
}

function format(value: bigint): string {
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
