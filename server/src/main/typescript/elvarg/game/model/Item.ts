import { lazyRequire } from "../../util/LazyRequire";
import { MAX_STACK_AMOUNT } from "./container/StackType";

// Lazy load to avoid circular container/definition bootstrap.
const getItemDefinition = lazyRequire(() => require('../definition/ItemDefinition').ItemDefinition as typeof import('../definition/ItemDefinition').ItemDefinition);

export class Item {

    public static readonly UNTRADEABLE_META = "untradeable";
    public static readonly UNBANKABLE_META = "unbankable";
    public static readonly PRESET_META = "preset";

    public id: number;
    public amount: number;
    public meta: Record<string, unknown> | null;

    /**
 * An Item object constructor.
 *
 * @param id     Item id.
 * @param amount Item amount.
 * 
 */

    constructor(id: number, amount?: number, meta?: Record<string, unknown> | null) {
        this.id = id;
        this.amount = amount != null ? amount : 1;
        this.meta = Item.cloneMeta(meta);
    }

    private static cloneMetaValue(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((entry) => Item.cloneMetaValue(entry));
        }
        if (value && typeof value === "object") {
            const clone: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
                clone[key] = Item.cloneMetaValue(entry);
            }
            return clone;
        }
        return value;
    }

    public static cloneMeta(meta?: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
            return null;
        }
        return Item.cloneMetaValue(meta) as Record<string, unknown>;
    }

    /**
     * The item meta keys #226 renamed from camelCase to kebab-case. Only these are migrated: other
     * camelCase keys are still live (the looting bag keeps its contents under "lootingBag").
     */
    private static readonly RENAMED_META_KEYS: ReadonlyMap<string, string> = new Map([
        ["toxicBlowpipe", "toxic-blowpipe"],
        ["tridentCharges", "trident-charges"],
        ["bloodFury", "blood-fury"],
        ["tumekensShadowCharges", "tumekens-shadow-charges"],
        ["barrows:lockpickCharges", "barrows:lockpick-charges"],
        ["farming:saplingAt", "farming:sapling-at"],
    ]);

    /**
     * Save migration, as PlayerSave's for attributes: a top-level meta key #226 renamed loads
     * under its new name; the new key wins if both are saved. Meta nested in other meta or in
     * player attributes is not migrated.
     */
    public static migrateSavedMeta(meta: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!meta) return meta;
        let migrated: Record<string, unknown> | null = null;
        for (const [old, renamed] of Item.RENAMED_META_KEYS) {
            if (!(old in meta)) continue;
            migrated ??= { ...meta };
            if (!(renamed in migrated)) migrated[renamed] = migrated[old];
            delete migrated[old];
        }
        return migrated ?? meta;
    }

    /**
     * Gets the item's id.
     */
    public getId(): number {
        return this.id;
    }

    /**
     * Sets the item's id.
     *
     * @param id New item id.
     */
    public setId(id: number): Item {
        this.id = id;
        return this;
    }

    public getAmount(): number {
        return this.amount;
    }

    public getMeta(): Record<string, unknown> | null {
        return this.meta;
    }

    public setMeta(meta?: Record<string, unknown> | null): Item {
        this.meta = Item.cloneMeta(meta);
        return this;
    }

    public getMetaValue<T = unknown>(key: string): T | undefined {
        if (!this.meta || typeof key !== "string" || key.length === 0) {
            return undefined;
        }
        return this.meta[key] as T | undefined;
    }

    public setMetaValue(key: string, value: unknown): Item {
        if (typeof key !== "string" || key.length === 0) {
            return this;
        }
        if (value === undefined) {
            if (this.meta) {
                delete this.meta[key];
                if (Object.keys(this.meta).length === 0) {
                    this.meta = null;
                }
            }
            return this;
        }
        if (!this.meta) {
            this.meta = {};
        }
        this.meta[key] = Item.cloneMetaValue(value);
        return this;
    }
    /**
* Sets the amount of the item.
*/
    public setAmount(amount: number): Item {
        this.amount = amount;
        return this;
    }

    /**
     * Checks if this item is valid or not.
     *
     * @return
     */
    public isValid(): boolean {
        return this.id >= 0 && this.amount > 0;
    }

    /**
     * Increment the amount by 1.
     */
    public incrementAmount(): void {
        if (this.amount >= MAX_STACK_AMOUNT) {
            return;
        }
        this.amount++;
    }

    /**
     * Decrement the amount by 1.
     */
    public decrementAmount(): void {
        if ((this.amount - 1) < 0) {
            return;
        }
        this.amount--;
    }

    public incrementAmountBy(amount: number): void {
        if (this.amount + amount >= MAX_STACK_AMOUNT) {
            this.amount = MAX_STACK_AMOUNT;
        } else {
            this.amount += amount;
        }
    }

    /**
* Decrement the amount by the specified amount.
*/
    public decrementAmountBy(amount: number): void {
        if ((this.amount - amount) < 1) {
            this.amount = 0;
        } else {
            this.amount -= amount;
        }
    }

    public getDefinition(): any {
        return getItemDefinition().forId(this.id);
    }

    public isTradeable(): boolean {
        return !this.isUntradeable() && this.getDefinition().isTradeable();
    }

    public isSellable(): boolean {
        return !this.isUntradeable() && this.getDefinition().isSellable();
    }

    public isDropable(): boolean {
        return !this.isUntradeable() && this.getDefinition().isDropable();
    }

    public isUntradeable(): boolean {
        return this.getMetaValue(Item.UNTRADEABLE_META) === true;
    }

    public isUnbankable(): boolean {
        return this.getMetaValue(Item.UNBANKABLE_META) === true;
    }

    /**
     * An item spawned by a preset. Distinct from untradeable/unbankable: only these
     * auto-destroy on drop and are spared when a new preset banks carried items.
     */
    public isPresetItem(): boolean {
        return this.getMetaValue(Item.PRESET_META) === true;
    }

    public isLostOnDeath(): boolean {
        return this.isUntradeable();
    }

    public clone(): Item {
        return new Item(this.id, this.amount, this.meta);
    }

    public equals(o: any): boolean {
        if (!(o instanceof Item))
            return false;
        let item = o as Item;
        return item.getId() == this.getId() &&
            item.getAmount() == this.getAmount() &&
            JSON.stringify(item.getMeta() ?? null) === JSON.stringify(this.getMeta() ?? null);
    }


}
