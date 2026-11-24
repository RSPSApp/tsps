/**
 * Items that stand in for another in the id-keyed weapon tables: special attacks, ranged weapons
 * and their ammunition, and weapon profiles (animations, speed, reach). A minigame's own copy of
 * an item (Last Man Standing's br_ items, with their own ids but the same name and model) behaves
 * as the item it copies wherever it has no entry of its own.
 */
export class ItemAliases {
    public static readonly SCOPED_VERSION = 1;
    private static readonly aliases = new Map<number, number>();
    private static readonly owners = new Map<number, symbol>();
    private static readonly leases = new Map<number, {owner:symbol;previous:number|undefined;previousOwner:symbol|undefined;previousLease:any;disposed:boolean}>();

    /** `aliasId` behaves as `baseId` wherever it has no entry of its own. */
    public static register(aliasId: number, baseId: number): void {
        if (!Number.isInteger(aliasId) || !Number.isInteger(baseId) || aliasId <= 0 || baseId <= 0 || aliasId === baseId) return;
        ItemAliases.aliases.set(aliasId, baseId);
        ItemAliases.owners.delete(aliasId);
        ItemAliases.leases.delete(aliasId);
    }

    /** Reversible ownership for plugin-defined weapon profiles and ammunition tables. */
    public static registerScoped(aliasId:number,baseId:number):{dispose:()=>void} {
        if(!Number.isInteger(aliasId)||!Number.isInteger(baseId)||aliasId<=0||baseId<=0||aliasId===baseId)throw new Error('Invalid item alias.');
        const previous=this.aliases.get(aliasId),previousOwner=this.owners.get(aliasId),owner=Symbol();
        const lease={owner,previous,previousOwner,previousLease:this.leases.get(aliasId),disposed:false};
        this.aliases.set(aliasId,baseId);this.owners.set(aliasId,owner);this.leases.set(aliasId,lease);
        return {dispose:()=>{
            if(lease.disposed)return;lease.disposed=true;if(this.owners.get(aliasId)!==owner)return;
            let value=previous,restoredOwner=previousOwner,restoredLease=lease.previousLease;
            while(restoredLease?.disposed){value=restoredLease.previous;restoredOwner=restoredLease.previousOwner;restoredLease=restoredLease.previousLease;}
            if(value===undefined)this.aliases.delete(aliasId);else this.aliases.set(aliasId,value);
            if(restoredOwner===undefined)this.owners.delete(aliasId);else this.owners.set(aliasId,restoredOwner);
            if(restoredLease===undefined)this.leases.delete(aliasId);else this.leases.set(aliasId,restoredLease);
        }};
    }

    /** The item an id stands in for, or null when it is nobody's copy. */
    public static baseOf(id: number): number | null {
        return ItemAliases.aliases.get(Number(id)) ?? null;
    }

    /** Looks an id up in a table, then the item it copies. */
    public static lookup<V>(table: Map<number, V>, id: number): V | undefined {
        const own = table.get(Number(id));
        if (own !== undefined) return own;
        const base = ItemAliases.aliases.get(Number(id));
        return base === undefined ? undefined : table.get(base);
    }

    /** Whether two ids are the same item or one copies the other. */
    public static same(a: number, b: number): boolean {
        return Number(a) === Number(b) || ItemAliases.aliases.get(Number(a)) === Number(b) || ItemAliases.aliases.get(Number(b)) === Number(a);
    }
}
