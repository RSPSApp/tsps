/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { EquipmentInventorySlot } from "../EquipmentInventorySlot";
import { AllRequirementsCollection } from "./AllRequirementsCollection";
import { AnyRequirementCollection } from "./AnyRequirementCollection";
import type { ItemRequirement } from "./ItemRequirement";
import { MultipleOfItemRequirement } from "./MultipleOfItemRequirement";
import { RangeItemRequirement } from "./RangeItemRequirement";
import { SingleItemRequirement } from "./SingleItemRequirement";
import { SlotLimitationRequirement } from "./SlotLimitationRequirement";

/** RuneLite's ItemRequirements factories, as the clue tables spell them. */

export function item(itemId: number): SingleItemRequirement {
    return new SingleItemRequirement(itemId);
}

export function range(startItemId: number, endItemId: number): RangeItemRequirement;
export function range(name: string | null, startItemId: number, endItemId: number): RangeItemRequirement;
export function range(a: string | number | null, b: number, c?: number): RangeItemRequirement {
    if (typeof a === "number") return new RangeItemRequirement(null, a, b);
    return new RangeItemRequirement(a, b, c as number);
}

export function any(name: string, ...requirements: ItemRequirement[]): AnyRequirementCollection {
    return new AnyRequirementCollection(name, ...requirements);
}

export function all(...requirements: ItemRequirement[]): AllRequirementsCollection;
export function all(name: string, ...requirements: ItemRequirement[]): AllRequirementsCollection;
export function all(first: string | ItemRequirement, ...rest: ItemRequirement[]): AllRequirementsCollection {
    if (typeof first === "string") return new AllRequirementsCollection(first, ...rest);
    return AllRequirementsCollection.of(first, ...rest);
}

export function emptySlot(description: string, ...slots: EquipmentInventorySlot[]): SlotLimitationRequirement {
    return new SlotLimitationRequirement(description, ...slots);
}

export function xOfItem(itemId: number, quantity: number): MultipleOfItemRequirement {
    return new MultipleOfItemRequirement(itemId, quantity);
}
