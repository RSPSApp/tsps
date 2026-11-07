/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Item } from "@runelite/api/Item";
import type { ItemNameSource, ItemRequirement } from "./ItemRequirement";

/**
 * Every one of several requirements (RuneLite's AllRequirementsCollection). A single item id
 * counts when any member accepts it; a container counts only when every member is met.
 */
export class AllRequirementsCollection implements ItemRequirement {
    private readonly requirements: ItemRequirement[];

    constructor(
        private readonly name: string,
        ...requirements: ItemRequirement[]
    ) {
        this.requirements = requirements;
    }

    /** RuneLite's unnamed constructor: the name is "N/A". */
    static of(...requirements: ItemRequirement[]): AllRequirementsCollection {
        return new AllRequirementsCollection("N/A", ...requirements);
    }

    fulfilledBy(itemOrItems: number | Item[]): boolean {
        if (typeof itemOrItems === "number") return this.requirements.some((requirement) => requirement.fulfilledBy(itemOrItems));
        return this.requirements.every((requirement) => requirement.fulfilledBy(itemOrItems));
    }

    getCollectiveName(_client: ItemNameSource): string {
        return this.name;
    }
}
