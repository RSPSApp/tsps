/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/** Any one of several requirements (RuneLite's AnyRequirementCollection), shown under one name. */
export class AnyRequirementCollection implements ItemRequirement {
    private readonly requirements: ItemRequirement[];

    constructor(
        private readonly name: string,
        ...requirements: ItemRequirement[]
    ) {
        this.requirements = requirements;
    }

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        return this.requirements.some((requirement) =>
            typeof itemOrItems === "number" ? requirement.fulfilledBy(itemOrItems) : requirement.fulfilledBy(itemOrItems),
        );
    }

    getCollectiveName(_client: ItemNameSource): string {
        return this.name;
    }
}
