import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import type { ConfigManager } from "@runelite/client/config/ConfigManager";

export const GroundItemsConfig = ConfigGroup("grounditems", {
    highlightedItems: ConfigItem({
        name: "Highlighted items",
        description: "CSV of item names, supports * wildcards and >/< quantities.",
        textArea: true,
        position: 1,
        default: "",
    }),
    hiddenItems: ConfigItem({
        name: "Hidden items",
        description: "CSV of item names, supports * wildcards and >/< quantities.",
        textArea: true,
        position: 2,
        default: "Vial, Ashes, Coins, Bones, Bucket, Jug, Seaweed",
    }),
    showHighlightedOnly: ConfigItem({
        name: "Show highlighted only",
        position: 3,
        default: false,
    }),
    rightClickHidden: ConfigItem({
        name: "Right-click hidden items",
        position: 4,
        default: false,
    }),
    recolorMenuHiddenItems: ConfigItem({
        name: "Recolor hidden menu entries",
        position: 5,
        default: false,
    }),
    showMenuItemQuantities: ConfigItem({
        name: "Show menu item quantities",
        position: 6,
        default: true,
    }),
    dontHideUntradeables: ConfigItem({
        name: "Do not hide untradeables",
        position: 7,
        default: true,
    }),
    hideUnderValue: ConfigItem({
        name: "Hide under value",
        description: "Hide items worth less than this.",
        position: 8,
        range: { min: 0 },
        default: 0,
    }),
    priceDisplayMode: ConfigItem({
        name: "Price display mode",
        position: 9,
        enum: { Both: "both", "Grand Exchange": "ge", "High Alchemy": "ha", Off: "off" },
        default: "both",
    }),
    valueCalculationMode: ConfigItem({
        name: "Value calculation mode",
        position: 10,
        enum: { Highest: "highest", "Grand Exchange": "ge", "High Alchemy": "ha" },
        default: "highest",
    }),
    defaultColor: ConfigItem({
        name: "Default color",
        color: true,
        position: 11,
        default: 0xffffff,
    }),
    highlightedColor: ConfigItem({
        name: "Highlighted color",
        color: true,
        position: 12,
        default: 0xaa00ff,
    }),
    hiddenColor: ConfigItem({
        name: "Hidden color",
        color: true,
        position: 13,
        default: 0x808080,
    }),
    lowValueColor: ConfigItem({
        name: "Low value color",
        color: true,
        position: 14,
        default: 0x66b2ff,
    }),
    lowValuePrice: ConfigItem({
        name: "Low value price",
        position: 15,
        range: { min: 0 },
        default: 20_000,
    }),
    mediumValueColor: ConfigItem({
        name: "Medium value color",
        color: true,
        position: 16,
        default: 0x99ff99,
    }),
    mediumValuePrice: ConfigItem({
        name: "Medium value price",
        position: 17,
        range: { min: 0 },
        default: 100_000,
    }),
    highValueColor: ConfigItem({
        name: "High value color",
        color: true,
        position: 18,
        default: 0xff9600,
    }),
    highValuePrice: ConfigItem({
        name: "High value price",
        position: 19,
        range: { min: 0 },
        default: 1_000_000,
    }),
    insaneValueColor: ConfigItem({
        name: "Insane value color",
        color: true,
        position: 20,
        default: 0xff66b2,
    }),
    insaneValuePrice: ConfigItem({
        name: "Insane value price",
        position: 21,
        range: { min: 0 },
        default: 10_000_000,
    }),
    ownershipFilterMode: ConfigItem({
        name: "Ownership filter",
        position: 22,
        enum: { All: "all", Takeable: "takeable", Drops: "drops" },
        default: "all",
    }),
    despawnTimerMode: ConfigItem({
        name: "Despawn timer",
        position: 23,
        enum: { Off: "off", Ticks: "ticks", Seconds: "seconds" },
        default: "off",
    }),
});

export type GroundItemsPriceDisplayMode = "ha" | "ge" | "both" | "off";
export type GroundItemsValueCalculationMode = "ha" | "ge" | "highest";
export type GroundItemsOwnershipFilterMode = "all" | "takeable" | "drops";
export type GroundItemsDespawnTimerMode = "off" | "ticks" | "seconds";

export interface GroundItemsPluginConfig {
    enabled: boolean;
    highlightedItems: string;
    hiddenItems: string;
    showHighlightedOnly: boolean;
    rightClickHidden: boolean;
    recolorMenuHiddenItems: boolean;
    showMenuItemQuantities: boolean;
    dontHideUntradeables: boolean;
    hideUnderValue: number;
    priceDisplayMode: GroundItemsPriceDisplayMode;
    valueCalculationMode: GroundItemsValueCalculationMode;
    defaultColor: number;
    highlightedColor: number;
    hiddenColor: number;
    lowValueColor: number;
    lowValuePrice: number;
    mediumValueColor: number;
    mediumValuePrice: number;
    highValueColor: number;
    highValuePrice: number;
    insaneValueColor: number;
    insaneValuePrice: number;
    ownershipFilterMode: GroundItemsOwnershipFilterMode;
    despawnTimerMode: GroundItemsDespawnTimerMode;
}

export interface GroundItemsPluginState {
    config: GroundItemsPluginConfig;
    version: number;
}

export interface GroundItemsTimingContext {
    currentTick: number;
    tickPhase?: number;
    tickMs?: number;
}

export interface GroundItemEvaluation {
    stack: import("../../data/ground/GroundItemStore").ClientGroundItemStack;
    label: string;
    baseLabel: string;
    timerLabel?: string;
    timerColor?: number;
    color: number;
    hidden: boolean;
    highlighted: boolean;
}

export function readGroundItemsConfig(
    configManager: ConfigManager,
    enabled: boolean,
): GroundItemsPluginConfig {
    const config = configManager.getConfig(GroundItemsConfig);
    return {
        enabled,
        highlightedItems: config.highlightedItems(),
        hiddenItems: config.hiddenItems(),
        showHighlightedOnly: config.showHighlightedOnly(),
        rightClickHidden: config.rightClickHidden(),
        recolorMenuHiddenItems: config.recolorMenuHiddenItems(),
        showMenuItemQuantities: config.showMenuItemQuantities(),
        dontHideUntradeables: config.dontHideUntradeables(),
        hideUnderValue: config.hideUnderValue(),
        priceDisplayMode: config.priceDisplayMode(),
        valueCalculationMode: config.valueCalculationMode(),
        defaultColor: config.defaultColor(),
        highlightedColor: config.highlightedColor(),
        hiddenColor: config.hiddenColor(),
        lowValueColor: config.lowValueColor(),
        lowValuePrice: config.lowValuePrice(),
        mediumValueColor: config.mediumValueColor(),
        mediumValuePrice: config.mediumValuePrice(),
        highValueColor: config.highValueColor(),
        highValuePrice: config.highValuePrice(),
        insaneValueColor: config.insaneValueColor(),
        insaneValuePrice: config.insaneValuePrice(),
        ownershipFilterMode: config.ownershipFilterMode(),
        despawnTimerMode: config.despawnTimerMode(),
    };
}
