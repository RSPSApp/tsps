// Lazy load to avoid circular container/definition bootstrap.
const getItemDefinition = () => require('../definition/ItemDefinition').ItemDefinition as typeof import('../definition/ItemDefinition').ItemDefinition;

export class Item {

    public static readonly UNTRADEABLE_META = "untradeable";

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
        return this.id > 0 && this.amount > 0;
    }

    /**
     * Increment the amount by 1.
     */
    public incrementAmount(): void {
        if ((this.amount + 1) > Number.MAX_SAFE_INTEGER) {
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
        if ((this.amount + amount) > Number.MAX_SAFE_INTEGER) {
            this.amount = Number.MAX_SAFE_INTEGER;
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
