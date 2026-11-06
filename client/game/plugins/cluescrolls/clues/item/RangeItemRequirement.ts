/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/** Any item id in an inclusive range (RuneLite's RangeItemRequirement), shown under one name. */
export class RangeItemRequirement implements ItemRequirement {
    constructor(
        private readonly name: string | null,
        private readonly startItemId: number,
        private readonly endItemId: number,
    ) {}

    private inRange(itemId: number): boolean {
        return itemId >= this.startItemId && itemId <= this.endItemId;
    }

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        if (typeof itemOrItems === "number") return this.inRange(itemOrItems);
        return itemOrItems.some((item) => this.inRange(item.getId()));
    }

    getCollectiveName(_client: ItemNameSource): string {
        return this.name ?? "N/A";
    }
}
