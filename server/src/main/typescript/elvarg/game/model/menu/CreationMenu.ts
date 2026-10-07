/**
 * How the skillmulti menu shows: per-item labels (default: the item names), the most that can be
 * chosen and the amount it opens on (default: the menu maximum), and clientscript 2046's first
 * argument (default 13; the sawmill sends 0).
 */
export interface CreationMenuOptions {
    labels?: string[];
    maxAmount?: number;
    lastAmount?: number;
    mode?: number;
}

export class CreationMenu {
    /**
    * The title of this {@link CreationMenu}.
    */
    private title: string;

    /**
     * The items which can be created through this
     * {@link CreationMenu}.
     */
    private items: number[];

    /**
     * The {@link CreationMenuAction} which will be executed when the player has
     * selected an item and the amount to create.
     */
    private action: CreationMenuAction;

    /**
     * Creates a new {@link CreationMenu}.
     *
     * @param player The owner.
     * @param title  The title.
     * @param action The action to execute upon selecting amount.
     */
    constructor(title: string, items: number[], action: CreationMenuAction, private readonly options: CreationMenuOptions = {}) {
        this.title = title;
        this.items = items;
        this.action = action;
    }

    public getOptions(): CreationMenuOptions {
        return this.options;
    }

    /**
     * Executes the action.
     * @param itemId
     * @param amount
     */
    public execute(itemId: number, amount: number) {
        if (!this.items.includes(itemId)) {
            return;
        }
        this.action.execute(itemId, amount);
    }

    /**
     * Gets the title.
     *
     * @return
     */
    public getTitle(): string {
        return this.title;
    }

    /**
     * Gets the items.
     * @return
     */
    public getItems(): number[] {
        return this.items;
    }

    /**
     * Gets the action.
     *
     * @return
     */
    public getAction(): CreationMenuAction {
        return this.action;
    }
}

export interface CreationMenuAction {
    /**
    * This method will execute when a player clicks
    * on an item in the creation menu chatbox
    * interface.
    *
    * @param item The item clicked on.
    * @param amount The amount selected.
    */
    execute(item: number, amount: number): void;
}
