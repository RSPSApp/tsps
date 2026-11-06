export type ShopCurrency = "COINS" | "BLOOD_MONEY" | "POINTS" | string;

export interface ShopStockDefinition {
    id: number;
    amount: number;
    restockTicks: number | null;
    price: number | null;
}

export class ShopDefinition {
    private static definitions = new Map<number, ShopDefinition>();

    constructor(
        private readonly id: number,
        private readonly name: string,
        private readonly currency: ShopCurrency,
        private readonly originalStock: ShopStockDefinition[],
        private readonly defaultRestockTicks: number,
        private readonly defaultDestockTicks: number,
        private readonly soldItemDestockTicks: number,
        private readonly source: string
    ) {}

    public static replace(definitions: ShopDefinition[]): void {
        this.definitions.clear();
        for (const definition of definitions) {
            this.definitions.set(definition.getId(), definition);
        }
    }

    /** Adds one definition without replacing the rest (a plugin's shop for one player, see ShopManager.registerShop). */
    public static register(definition: ShopDefinition): void {
        this.definitions.set(definition.getId(), definition);
    }

    public static unregister(id: number): void {
        this.definitions.delete(id);
    }

    public static forId(id: number): ShopDefinition | undefined {
        return this.definitions.get(id);
    }

    public static all(): readonly ShopDefinition[] {
        return Array.from(this.definitions.values());
    }

    public getId(): number {
        return this.id;
    }

    public getName(): string {
        return this.name;
    }

    public getCurrency(): ShopCurrency {
        return this.currency;
    }

    public getOriginalStock(): readonly ShopStockDefinition[] {
        return this.originalStock;
    }

    public getDefaultRestockTicks(): number {
        return this.defaultRestockTicks;
    }

    public getDefaultDestockTicks(): number {
        return this.defaultDestockTicks;
    }

    public getSoldItemDestockTicks(): number {
        return this.soldItemDestockTicks;
    }

    public getSource(): string {
        return this.source;
    }
}
