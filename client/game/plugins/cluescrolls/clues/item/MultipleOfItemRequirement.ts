/*
 * Copyright (c) 2019 Hydrox6 <ikada@protonmail.ch>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/** At least a quantity of one item across the slots (RuneLite's MultipleOfItemRequirement). */
export class MultipleOfItemRequirement implements ItemRequirement {
    constructor(
        private readonly itemId: number,
        private readonly quantity: number,
    ) {}

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        if (typeof itemOrItems === "number") return itemOrItems === this.itemId;
        let found = 0;
        for (const item of itemOrItems) {
            if (item.getId() !== this.itemId) continue;
            found += item.getQuantity();
            if (found >= this.quantity) return true;
        }
        return false;
    }

    getCollectiveName(client: ItemNameSource): string {
        const definition = client.getItemDefinition(this.itemId);
        return definition ? `${definition.getName()} x${this.quantity}` : "N/A";
    }
}
