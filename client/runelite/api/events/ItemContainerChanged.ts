import type { ItemContainer } from "../Item";

/**
 * An item container's contents changed (RuneLite's ItemContainerChanged): a slot or a whole
 * snapshot arrived for the backpack (93) or worn equipment (94). Selecting a slot is not a change.
 */
export class ItemContainerChanged {
    constructor(
        private readonly containerId: number,
        private readonly itemContainer: ItemContainer,
    ) {}

    getContainerId(): number {
        return this.containerId;
    }

    getItemContainer(): ItemContainer {
        return this.itemContainer;
    }
}
