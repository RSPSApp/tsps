/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/** One exact item (RuneLite's SingleItemRequirement). */
export class SingleItemRequirement implements ItemRequirement {
    constructor(private readonly itemId: number) {}

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        if (typeof itemOrItems === "number") return itemOrItems === this.itemId;
        return itemOrItems.some((item) => item.getId() === this.itemId);
    }

    getCollectiveName(client: ItemNameSource): string {
        return client.getItemDefinition(this.itemId)?.getName() ?? "N/A";
    }
}
