import { ItemDefinition } from "../definition/ItemDefinition";
import { Player } from "../entity/impl/player/Player";

/** Settings > Chat: "Examine price info - Grand Exchange" (row 234), on by default. */
export const EXAMINE_PRICE_GE_VARBIT = 13826; // examine_price_ge_enabled
/** Settings > Chat: "Examine price info - Alchemy" (row 235), on by default. */
export const EXAMINE_PRICE_ALCH_VARBIT = 13827; // examine_price_alch_enabled

/** The item's Grand Exchange guide price and alchemy values, per item. */
export type ExaminePrices = { ge: number; ha: number; la: number };

const number = (value: number): string => value.toLocaleString("en-US");
const red = (value: number): string => `<col=ff0000>${number(value)}</col>`;

/**
 * The line shown after an item's examine text: "Price of Steel scimitar: GE 67  HA 240  LA 160",
 * or for a stack "Price of 100 x Feather: GE 300 (3ea)  HA 100 (1ea)". A noted item is priced and
 * named as the item it notes. Each value is left out while its setting is off or it is 0, and the
 * whole line when nothing is left.
 */
export function formatExaminePrice(
    name: string, amount: number, prices: ExaminePrices, show: { ge: boolean; alch: boolean },
): string | null {
    const count = Math.max(1, Math.floor(amount) || 1);
    const parts: string[] = [];
    const add = (label: string, each: number) => {
        if (!(each > 0)) return;
        parts.push(count > 1 ? `${label} ${red(each * count)} (${red(each)}ea)` : `${label} ${red(each)}`);
    };
    if (show.ge) add("GE", prices.ge);
    if (show.alch) {
        add("HA", prices.ha);
        add("LA", prices.la);
    }
    if (!parts.length) return null;
    return `Price of ${count > 1 ? `${number(count)} x ` : ""}${name}: ${parts.join("  ")}`;
}

/** An item's examine prices, or null for an item that can't be traded (no line at all). */
export function examinePrices(itemId: number): { name: string; prices: ExaminePrices } | null {
    const definition = ItemDefinition.forId(ItemDefinition.forId(itemId).unNote());
    if (!definition.isTradeable()) return null;
    // The values the alchemy spells pay: 0 for an item they refuse, such as a bond.
    const value = definition.getValue();
    const alch = (own: number, share: number) => (Number.isFinite(own) ? own : Math.floor(value * share));
    return {
        name: definition.getName(),
        prices: {
            ge: definition.hasGrandExchangeValue() ? Math.floor(definition.getGrandExchangeValue()) : 0,
            ha: alch(definition.getHighAlchValue(), 0.6),
            la: alch(definition.getLowAlchValue(), 0.4),
        },
    };
}

/** Sends the price line after an item's examine text, as the player's settings ask. */
export function sendExaminePrice(player: Player, itemId: number, amount: number): void {
    const sender = player.getPacketSender();
    const show = {
        ge: sender.getVarbit(EXAMINE_PRICE_GE_VARBIT) === 1,
        alch: sender.getVarbit(EXAMINE_PRICE_ALCH_VARBIT) === 1,
    };
    if (!show.ge && !show.alch) return;
    const item = examinePrices(itemId);
    const line = item && formatExaminePrice(item.name, amount, item.prices, show);
    if (line) player.sendMessage(line);
}
