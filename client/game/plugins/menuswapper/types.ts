export interface MenuSwapperPresets {
    /** Bankers and bank booths: "Bank" as the left-click. */
    bank: boolean;
    /** Shopkeepers: "Trade" as the left-click. */
    trade: boolean;
    /** Pickpocketable NPCs: "Pickpocket" as the left-click. */
    pickpocket: boolean;
    /** Every inventory item: "Drop" as the shift-click. */
    shiftDrop: boolean;
}

/** A saved swap: the option, and the target's name as it was when saved (for the panel). */
export interface MenuSwap {
    option: string;
    name: string;
}

export interface MenuSwapperPluginConfig {
    enabled: boolean;
    presets: MenuSwapperPresets;
    /** Left-click swaps by target key ("npc:3010", "loc:10355", "obj:995", "item:4151"). */
    swaps: Record<string, MenuSwap>;
    /** Shift-click swaps (inventory items), by target key. */
    shiftSwaps: Record<string, MenuSwap>;
}

export interface MenuSwapperPluginState {
    config: MenuSwapperPluginConfig;
    version: number;
}

export interface MenuSwapperPluginPersistence {
    load(): Partial<MenuSwapperPluginConfig> | undefined;
    save(config: MenuSwapperPluginConfig): void;
}

export type MenuSwapKind = "left" | "shift";
