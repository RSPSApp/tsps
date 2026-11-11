import { fetchContent } from "../contentApi";

/** stockmarket_value statuses, as the rev 241 GE scripts read them: they retry until ready. */
export const PRICE_LOADING = 1;
export const PRICE_READY = 2;

let prices: Map<number, number> | undefined;
let loading: Promise<void> | undefined;
let revision = 0;
let alchemy: Map<number, [number, number]> | undefined;
let alchemyLoading: Promise<void> | undefined;

/** Loads the connected world's guide prices (/api/item-prices) and alchemy values; a new login loads them again. */
export function loadItemPrices(): Promise<void> {
    prices = undefined;
    revision++;
    loadItemAlchemy();
    const request = fetchContent("/api/item-prices")
        .then((table: Record<string, number>) => {
            if (loading !== request) return;
            prices = new Map(Object.entries(table ?? {}).map(([id, price]) => [Number(id), Number(price)]));
            revision++;
        })
        .catch((error) => {
            if (loading !== request) return;
            console.warn("[item-prices] guide prices unavailable; store values are shown", error);
            prices = new Map();
            revision++;
        });
    loading = request;
    return request;
}

/** Changes when a login invalidates prices and when its request finishes. */
export function getItemPricesRevision(): number {
    return revision;
}

/** The guide price of an (unnoted) item: 0 when it has no quote, undefined while the table loads. */
export function guidePrice(itemId: number): number | undefined {
    if (!prices) {
        if (!loading) loadItemPrices();
        return undefined;
    }
    return prices.get(itemId) ?? 0;
}

/** What High and Low Alchemy pay for an (unnoted) item, as the world's spells do: 0 for an item they
 * refuse, such as a bond. Undefined while the table (/api/item-alchemy) loads. */
export function alchemyValues(itemId: number): { ha: number; la: number } | undefined {
    if (!alchemy) {
        if (!alchemyLoading) loadItemAlchemy();
        return undefined;
    }
    const [ha, la] = alchemy.get(itemId) ?? [0, 0];
    return { ha, la };
}

function loadItemAlchemy(): Promise<void> {
    alchemy = undefined;
    const request = fetchContent("/api/item-alchemy")
        .then((table: Record<string, [number, number]>) => {
            if (alchemyLoading !== request) return;
            alchemy = new Map(Object.entries(table ?? {}).map(([id, [ha, la]]) => [Number(id), [Number(ha), Number(la)]]));
        })
        .catch((error) => {
            if (alchemyLoading !== request) return;
            console.warn("[item-alchemy] alchemy values unavailable", error);
            alchemy = new Map();
        });
    alchemyLoading = request;
    return request;
}

/** Null once both the guide prices and the alchemy values are loaded; else a promise that settles when
 * the loads under way finish (starting any not yet asked for). */
export function itemPricesPending(): Promise<void> | null {
    if (prices && alchemy) return null;
    if (!prices && !loading) loadItemPrices();
    if (!alchemy && !alchemyLoading) loadItemAlchemy();
    return Promise.all([prices ? undefined : loading, alchemy ? undefined : alchemyLoading]).then(() => undefined);
}
