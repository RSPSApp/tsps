/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { EquipmentInventorySlot } from "../EquipmentInventorySlot";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/** Worn-equipment slots that must be empty (RuneLite's SlotLimitationRequirement); never met by an item. */
export class SlotLimitationRequirement implements ItemRequirement {
    private readonly slots: EquipmentInventorySlot[];

    constructor(
        private readonly description: string,
        ...slots: EquipmentInventorySlot[]
    ) {
        this.slots = slots;
    }

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        if (typeof itemOrItems === "number") return false;
        for (const slot of this.slots) {
            // A slot past the array cannot be checked: the array has not been sized to it, so nothing is there.
            if (slot >= itemOrItems.length) continue;
            if (itemOrItems[slot].getId() !== -1) return false;
        }
        return true;
    }

    getCollectiveName(_client: ItemNameSource): string {
        return this.description;
    }
}
