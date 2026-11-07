/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { Client } from "@runelite/api/Client";
import type { Item } from "@runelite/api/Item";

/** What a requirement needs from the client: item names. */
export type ItemNameSource = Pick<Client, "getItemDefinition">;

/** Something a clue wants the player to carry or wear (RuneLite's ItemRequirement). */
export interface ItemRequirement {
    /** Whether this one item id satisfies the requirement. */
    fulfilledBy(itemId: number): boolean;
    /** Whether these items (a container's slots) satisfy the requirement. */
    fulfilledBy(items: Item[]): boolean;
    /** The name the panel shows for the requirement. */
    getCollectiveName(client: ItemNameSource): string;
}
