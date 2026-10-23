import { Equipment } from "../../model/container/impl/Equipment";

const BASE_ITEMS = [
    4708, 4710, 4712, 4714, 4716, 4718, 4720, 4722,
    4724, 4726, 4728, 4730, 4732, 4734, 4736, 4738,
    4745, 4747, 4749, 4751, 4753, 4755, 4757, 4759,
];

interface VariantStages {
    /** The plain base item the cosmetic family degrades as. */
    base: number;
    /** The undegraded cosmetic id, when it differs from the 100% stage. */
    baseId?: number;
    /** 100%, 75%, 50%, 25% and broken ids, in that order. */
    stages: number[];
}

/** Cosmetic families registered by plugins (e.g. Echo Ahrim's). */
const VARIANTS: VariantStages[] = [];

const SETS = {
    ahrims: [4708, 4712, 4714, 4710],
    dharoks: [4716, 4720, 4722, 4718],
    guthans: [4724, 4728, 4730, 4726],
    karils: [4732, 4736, 4738, 4734],
    torags: [4745, 4749, 4751, 4747],
    veracs: [4753, 4757, 4759, 4755],
} as const;

export class Barrows {
    public static readonly AMULET_OF_THE_DAMNED_FULL = 12851;
    public static readonly AMULET_OF_THE_DAMNED = 12853;

    /** A cosmetic family that degrades as the plain base item (100/75/50/25/broken). */
    public static registerVariantStages(base: number, stages: number[], baseId?: number): void {
        if (!Number.isInteger(base) || stages.length !== 5 || !stages.every(Number.isInteger)
            || (baseId !== undefined && !Number.isInteger(baseId))) {
            throw new Error("Barrows.registerVariantStages needs a base and five stage ids");
        }
        const existing = VARIANTS.findIndex((variant) => variant.base === base);
        if (existing !== -1) VARIANTS.splice(existing, 1);
        VARIANTS.push({ base, baseId, stages });
    }

    private static variantFor(itemId: number): VariantStages | null {
        return VARIANTS.find((variant) =>
            variant.base === itemId || variant.baseId === itemId || variant.stages.includes(itemId)
        ) ?? null;
    }

    public static baseItemId(itemId: number): number | null {
        const variant = this.variantFor(itemId);
        if (variant) return variant.base;
        const index = BASE_ITEMS.indexOf(itemId);
        if (index !== -1) return itemId;
        if (itemId < 4856 || itemId >= 5000) return null;
        const stage = (itemId - 4856) % 6;
        if (stage === 5) return null; // noted broken item
        const itemIndex = Math.floor((itemId - 4856) / 6);
        return BASE_ITEMS[itemIndex] ?? null;
    }

    public static stageItemId(baseItemId: number, stage: number): number | null {
        const index = BASE_ITEMS.indexOf(baseItemId);
        return index === -1 ? null : 4856 + index * 6 + stage;
    }

    /** The stage id in the item's own family, so an Echo piece keeps its cosmetic id. */
    public static stageItemIdFor(itemId: number, stage: number): number | null {
        const base = this.baseItemId(itemId);
        if (base == null) return null;
        const variant = this.variantFor(itemId);
        if (variant) return variant.stages[stage] ?? null;
        return this.stageItemId(base, stage);
    }

    /** 0 (100%) through 4 (broken), or null when the item is not Barrows gear. */
    public static stageOf(itemId: number): number | null {
        const base = this.baseItemId(itemId);
        if (base == null) return null;
        const variant = this.variantFor(itemId);
        if (variant) {
            const stage = variant.stages.indexOf(itemId);
            return stage === -1 ? 0 : stage;
        }
        if (itemId >= 4856 && itemId < 5000) return (itemId - 4856) % 6;
        return 0;
    }

    public static isBarrowsItem(itemId: number): boolean {
        return this.baseItemId(itemId) != null;
    }

    public static isBroken(itemId: number): boolean {
        return this.stageOf(itemId) === 4;
    }

    public static hasFullSet(player: any, set: keyof typeof SETS): boolean {
        const items = player?.getEquipment?.()?.getItems?.() ?? [];
        return SETS[set].every((baseItemId) =>
            items.some((item: any) => this.baseItemId(item?.getId?.()) === baseItemId && !this.isBroken(item.getId()))
        );
    }

    public static hasDamnedAmulet(player: any): boolean {
        const id = player?.getEquipment?.()?.get?.(Equipment.AMULET_SLOT)?.getId?.();
        return id === this.AMULET_OF_THE_DAMNED_FULL || id === this.AMULET_OF_THE_DAMNED;
    }

    public static hasDamnedSet(player: any, set: keyof typeof SETS): boolean {
        return this.hasFullSet(player, set) && this.hasDamnedAmulet(player);
    }
}
