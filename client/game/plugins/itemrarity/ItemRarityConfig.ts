import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

const opaque = (color: number) => (0xff000000 | color) >>> 0;

export const ItemRarityConfig = ConfigGroup(
    "itemrarity",
    {
        showInventory: ConfigItem({ name: "Inventory", description: "Outline priced items in your inventory.", section: "interfaces", position: 0, default: true }),
        showEquipment: ConfigItem({ name: "Equipment", description: "Outline priced items in worn equipment.", section: "interfaces", position: 1, default: true }),
        showBank: ConfigItem({ name: "Bank", description: "Outline priced items in your bank.", section: "interfaces", position: 2, default: true }),
        minimumPrice: ConfigItem({ name: "Minimum price", description: "Hide outlines for items below this TSPS guide price.", section: "rarity", position: 0, default: 1 }),
        commonPrice: ConfigItem({ name: "Common price", description: "The minimum guide price for the common tier.", section: "rarity", position: 1, default: 10_000 }),
        uncommonPrice: ConfigItem({ name: "Uncommon price", description: "The minimum guide price for the uncommon tier.", section: "rarity", position: 2, default: 100_000 }),
        rarePrice: ConfigItem({ name: "Rare price", description: "The minimum guide price for the rare tier.", section: "rarity", position: 3, default: 1_000_000 }),
        veryRarePrice: ConfigItem({ name: "Very rare price", description: "The minimum guide price for the very rare tier.", section: "rarity", position: 4, default: 10_000_000 }),
        commonColor: ConfigItem({ name: "Common", description: "Outline color for common items.", section: "colors", position: 0, color: true, alpha: true, default: opaque(0xffffff) }),
        uncommonColor: ConfigItem({ name: "Uncommon", description: "Outline color for uncommon items.", section: "colors", position: 1, color: true, alpha: true, default: opaque(0x66cc66) }),
        rareColor: ConfigItem({ name: "Rare", description: "Outline color for rare items.", section: "colors", position: 2, color: true, alpha: true, default: opaque(0x3399ff) }),
        veryRareColor: ConfigItem({ name: "Very rare", description: "Outline color for very rare items.", section: "colors", position: 3, color: true, alpha: true, default: opaque(0xaa55ff) }),
        legendaryColor: ConfigItem({ name: "Legendary", description: "Outline color for legendary items.", section: "colors", position: 4, color: true, alpha: true, default: opaque(0xffaa00) }),
    },
    { sections: { interfaces: { name: "Interfaces", position: 0 }, rarity: { name: "Price tiers", position: 1 }, colors: { name: "Tier colors", position: 2 } } },
);

export type RarityTier = "COMMON" | "UNCOMMON" | "RARE" | "VERY_RARE" | "LEGENDARY";
export type RarityThresholds = { minimum: number; common: number; uncommon: number; rare: number; veryRare: number };

/** Returns the highest tier reached by a nonnegative guide price. */
export function itemRarity(price: number, thresholds: RarityThresholds): RarityTier | undefined {
    if (!Number.isFinite(price) || price < Math.max(0, thresholds.minimum)) return undefined;
    if (price >= thresholds.veryRare) return "LEGENDARY";
    if (price >= thresholds.rare) return "VERY_RARE";
    if (price >= thresholds.uncommon) return "RARE";
    if (price >= thresholds.common) return "UNCOMMON";
    return "COMMON";
}

export function normalizeThreshold(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}
