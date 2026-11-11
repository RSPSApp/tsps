/*
 * Ported from RuneLite's Rune Pouch plugin (RunepouchOverlay).
 * Copyright (c) 2017, Tyler <http://github.com/tylerthardy>
 * Copyright (c) 2022, Adam <Adam@sigterm.info>
 * SPDX-License-Identifier: BSD-2-Clause
 * See LICENSE in this directory.
 */
import { RUNEPOUCH_RUNE } from "@runelite/api/EnumID";
import { BH_RUNE_POUCH, BH_RUNE_POUCH_TROUVER, DIVINE_RUNE_POUCH, DIVINE_RUNE_POUCH_TROUVER } from "@runelite/api/gameval/ItemID";
import {
    RUNE_POUCH_QUANTITY_1, RUNE_POUCH_QUANTITY_2, RUNE_POUCH_QUANTITY_3,
    RUNE_POUCH_QUANTITY_4, RUNE_POUCH_QUANTITY_5, RUNE_POUCH_QUANTITY_6,
    RUNE_POUCH_TYPE_1, RUNE_POUCH_TYPE_2, RUNE_POUCH_TYPE_3,
    RUNE_POUCH_TYPE_4, RUNE_POUCH_TYPE_5, RUNE_POUCH_TYPE_6,
} from "@runelite/api/gameval/VarbitID";

/** The rune pouch and divine rune pouch, and their Trouver-locked versions (RuneLite checks these four). */
export const RUNE_POUCH_ITEMS: ReadonlySet<number> = new Set([
    BH_RUNE_POUCH, BH_RUNE_POUCH_TROUVER, DIVINE_RUNE_POUCH, DIVINE_RUNE_POUCH_TROUVER,
]);

/** Each slot's rune type (a key of enum RUNEPOUCH_RUNE, 0 when empty) and amount. */
export const RUNE_TYPE_VARBITS = [
    RUNE_POUCH_TYPE_1, RUNE_POUCH_TYPE_2, RUNE_POUCH_TYPE_3, RUNE_POUCH_TYPE_4, RUNE_POUCH_TYPE_5, RUNE_POUCH_TYPE_6,
] as const;
export const RUNE_AMOUNT_VARBITS = [
    RUNE_POUCH_QUANTITY_1, RUNE_POUCH_QUANTITY_2, RUNE_POUCH_QUANTITY_3,
    RUNE_POUCH_QUANTITY_4, RUNE_POUCH_QUANTITY_5, RUNE_POUCH_QUANTITY_6,
] as const;
export { RUNEPOUCH_RUNE };

/** A filled slot: its rune type (enum key) and how many. */
export type PouchRune = { type: number; amount: number };

/** The pouch's filled slots, in slot order. */
export function pouchContents(getVarbit: (id: number) => number): PouchRune[] {
    const runes: PouchRune[] = [];
    for (let i = 0; i < RUNE_TYPE_VARBITS.length; i++) {
        const type = getVarbit(RUNE_TYPE_VARBITS[i]) | 0;
        const amount = getVarbit(RUNE_AMOUNT_VARBITS[i]) | 0;
        if (type !== 0 && amount > 0) runes.push({ type, amount });
    }
    return runes;
}

/** RuneLite's count: under 1000 as it is, else whole thousands with a K. */
export function formatAmount(amount: number): string {
    return amount < 1000 ? String(amount) : `${Math.floor(amount / 1000)}K`;
}

/**
 * The divine pouch's bar beside a rune (4 or more runes): red in hundreds under 1000, else green
 * in thousands, full (10) from 10,000.
 */
export function barFor(amount: number): { height: number; color: "red" | "green" } {
    return amount < 1000
        ? { height: Math.floor(amount / 100), color: "red" }
        : { height: Math.min(10, Math.floor(amount / 1000)), color: "green" };
}

/** RuneLite's rune icons are 11 pixels. */
export const IMAGE_SIZE = 11;
/** RuneScape Small's line height, which spaces the list's rows. */
export const LIST_LINE_HEIGHT = 12;

export type Box = { x: number; y: number; w: number; h: number };
export type PouchLayout = {
    icons: (Box & { type: number })[];
    texts: { text: string; x: number; baseline: number }[];
    bars: (Box & { color: "red" | "green" })[];
};

/**
 * Where RuneLite draws each piece, relative to the item's top-left, in item pixels (36x32):
 * under four runes a list (icon, then the count beside it); from four, a grid of icons with a
 * bar each, two to a row (three rows for more than four runes).
 */
export function layoutPouch(runes: PouchRune[]): PouchLayout {
    const layout: PouchLayout = { icons: [], texts: [], bars: [] };
    if (runes.length < 4) {
        runes.forEach((rune, row) => {
            layout.texts.push({ text: formatAmount(rune.amount), x: 11, baseline: 12 + (LIST_LINE_HEIGHT - 1) * row });
            layout.icons.push({ type: rune.type, x: -1, y: LIST_LINE_HEIGHT * row - 1, w: IMAGE_SIZE, h: IMAGE_SIZE });
        });
        return layout;
    }
    runes.forEach((rune, c) => {
        const x = 2 + (c % 2 === 1 ? IMAGE_SIZE + 2 + 2 : 0);
        const y = runes.length > 4 ? -1 + Math.floor(c / 2) * IMAGE_SIZE : 5 + (c >= 2 ? IMAGE_SIZE + 2 : 0);
        layout.icons.push({ type: rune.type, x, y, w: IMAGE_SIZE, h: IMAGE_SIZE });
        const bar = barFor(rune.amount);
        layout.bars.push({ x: x + IMAGE_SIZE, y: y + 1 + (10 - bar.height), w: 2, h: bar.height, color: bar.color });
    });
    return layout;
}

/** RuneLite's tooltip: "<amount> <yellow rune name>" a line. */
export function tooltipText(runes: PouchRune[], runeName: (type: number) => string | undefined): string {
    return runes.map((rune) => `${rune.amount} <col=ffff00>${runeName(rune.type) ?? "Unknown"}</col></br>`).join("");
}
