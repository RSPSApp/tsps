import {
    GroundItemStackMessage,
    GroundItemsServerPayload,
} from "../../../network/ServerConnection";

/** Native OBJ operation index (zero-based), independent of labels and global hideobjops. */
export function isGroundItemOperationEnabled(stack: { enabledOps?: number }, index: number): boolean {
    return index >= 0 && index < 5 && (((stack.enabledOps ?? 0x1f) & (1 << index)) !== 0);
}

export type ClientGroundItemStack = GroundItemStackMessage & {
    name: string;
    gePrice: number;
    haPrice: number;
    tradeable: boolean;
};

export type GroundItemOverlayEntry = {
    tileX: number;
    tileY: number;
    level: number;
    label: string;
    color?: number;
    timerLabel?: string;
    timerColor?: number;
    line?: number;
    heightOffsetTiles?: number;
};

export type GroundItemMetadata = {
    name: string;
    gePrice: number;
    haPrice: number;
    tradeable: boolean;
    /** The item definition's cost and whether it stacks: what a pile is ordered by. */
    cost?: number;
    stackable?: boolean;
};

type ResolveMetadata = (itemId: number) => GroundItemMetadata;

const DEFAULT_METADATA_RESOLVER: ResolveMetadata = (itemId: number) => ({
    name: `Item ${itemId | 0}`,
    gePrice: 0,
    haPrice: 0,
    tradeable: false,
});

export type GroundItemMutation = {
    kind: "spawn" | "despawn" | "quantity";
    stack: ClientGroundItemStack;
    oldQuantity?: number;
};
export class GroundItemStore {
    readonly mutationListeners = new Set<(event: GroundItemMutation) => void>();
    private emitMutation(event: GroundItemMutation): void {
        for (const listener of this.mutationListeners) listener(event);
    }
    private clearEntries(): void {
        for (const stack of this.stacksById.values()) this.emitMutation({ kind: "despawn", stack });
        this.stacksByTile.clear();
        this.stacksById.clear();
        this.pilesByTile.clear();
    }

    private stacksByTile = new Map<string, ClientGroundItemStack[]>();
    private stacksById = new Map<number, ClientGroundItemStack>();
    /**
     * Each tile's pile as OSRS keeps it (stack ids, front first): a new item joins the back, and
     * after every change to the tile the most valuable item moves to the front.
     */
    private pilesByTile = new Map<string, number[]>();

    private pileValue(stack: ClientGroundItemStack): number {
        const metadata = this.resolveMetadata(stack.itemId | 0);
        const cost = metadata.cost ?? metadata.gePrice ?? 0;
        if (!metadata.stackable) return cost;
        return cost * (stack.quantity < 2147483647 ? stack.quantity + 1 : stack.quantity);
    }

    private promoteMostValuable(key: string): void {
        const pile = this.pilesByTile.get(key);
        if (!pile) return;
        let best = -1;
        let bestValue = -99999999;
        for (let i = 0; i < pile.length; i++) {
            const stack = this.stacksById.get(pile[i]);
            if (!stack) continue;
            const value = this.pileValue(stack);
            if (value > bestValue) {
                bestValue = value;
                best = i;
            }
        }
        if (best > 0) pile.unshift(pile.splice(best, 1)[0]);
    }

    private removeFromPile(key: string, stackId: number): void {
        const pile = this.pilesByTile.get(key);
        if (!pile) return;
        const index = pile.indexOf(stackId);
        if (index >= 0) pile.splice(index, 1);
        if (pile.length === 0) this.pilesByTile.delete(key);
    }
    private listeners = new Set<() => void>();
    private resolveMetadata: ResolveMetadata = DEFAULT_METADATA_RESOLVER;
    private version = 0;

    private normalizeStack(stack: GroundItemStackMessage): ClientGroundItemStack | undefined {
        if (!stack || !(stack.id > 0) || !(stack.itemId >= 0)) return undefined;
        const tile = stack.tile ? stack.tile : { x: 0, y: 0, level: 0 };
        const metadata = this.resolveMetadata(stack.itemId | 0);
        return {
            id: stack.id | 0,
            itemId: stack.itemId | 0,
            enabledOps: (stack.enabledOps ?? 0x1f) & 0x1f,
            quantity: Math.max(1, stack.quantity | 0),
            tile: { x: tile.x | 0, y: tile.y | 0, level: tile.level | 0 },
            createdTick:
                Number.isFinite(stack.createdTick) && (stack.createdTick as number) >= 0
                    ? (stack.createdTick as number) | 0
                    : undefined,
            privateUntilTick:
                Number.isFinite(stack.privateUntilTick) && (stack.privateUntilTick as number) > 0
                    ? (stack.privateUntilTick as number) | 0
                    : undefined,
            expiresTick:
                Number.isFinite(stack.expiresTick) && (stack.expiresTick as number) > 0
                    ? (stack.expiresTick as number) | 0
                    : undefined,
            ownerId:
                Number.isFinite(stack.ownerId) && (stack.ownerId as number) >= 0
                    ? (stack.ownerId as number) | 0
                    : undefined,
            isPrivate: stack.isPrivate === true,
            ownership:
                stack.ownership === 0 ||
                stack.ownership === 1 ||
                stack.ownership === 2 ||
                stack.ownership === 3
                    ? stack.ownership
                    : 0,
            name:
                typeof metadata.name === "string" && metadata.name.length > 0
                    ? metadata.name
                    : `Item ${stack.itemId | 0}`,
            gePrice: Math.max(0, metadata.gePrice | 0),
            haPrice: Math.max(0, metadata.haPrice | 0),
            tradeable: metadata.tradeable === true,
        };
    }

    private removeEntry(entry: ClientGroundItemStack): void {
        const key = this.tileKey(entry.tile.x | 0, entry.tile.y | 0, entry.tile.level | 0);
        const list = this.stacksByTile.get(key);
        if (!list) return;
        const next = list.filter((stack) => (stack.id | 0) !== (entry.id | 0));
        if (next.length > 0) this.stacksByTile.set(key, next);
        else this.stacksByTile.delete(key);
    }

    private upsertEntry(entry: ClientGroundItemStack): void {
        const existing = this.stacksById.get(entry.id | 0);
        if (existing) {
            this.removeEntry(existing);
        }
        const key = this.tileKey(entry.tile.x | 0, entry.tile.y | 0, entry.tile.level | 0);
        const list = this.stacksByTile.get(key);
        if (list) list.push(entry);
        else this.stacksByTile.set(key, [entry]);
        this.stacksById.set(entry.id | 0, entry);
        const oldKey = existing
            ? this.tileKey(existing.tile.x | 0, existing.tile.y | 0, existing.tile.level | 0)
            : undefined;
        if (oldKey !== key) {
            if (oldKey !== undefined) {
                this.removeFromPile(oldKey, entry.id | 0);
                this.promoteMostValuable(oldKey);
            }
            const pile = this.pilesByTile.get(key);
            if (pile) pile.push(entry.id | 0);
            else this.pilesByTile.set(key, [entry.id | 0]);
        }
        this.promoteMostValuable(key);
        if (!existing) this.emitMutation({ kind: "spawn", stack: entry });
        else if (existing.itemId !== entry.itemId || existing.tile.x !== entry.tile.x || existing.tile.y !== entry.tile.y || existing.tile.level !== entry.tile.level) {
            this.emitMutation({ kind: "despawn", stack: existing });
            this.emitMutation({ kind: "spawn", stack: entry });
        } else if (existing.quantity !== entry.quantity) {
            this.emitMutation({ kind: "quantity", stack: entry, oldQuantity: existing.quantity });
        }
    }

    update(payload: GroundItemsServerPayload | undefined): void {
        if (!payload) {
            this.clearEntries();
            this.notify();
            return;
        }
        if (payload.kind === "snapshot") {
            this.clearEntries();
            for (const stack of payload.stacks) {
                const entry = this.normalizeStack(stack);
                if (!entry) continue;
                this.upsertEntry(entry);
            }
            this.notify();
            return;
        }

        const removes = Array.isArray(payload.removes) ? payload.removes : [];
        for (const stackId of removes) {
            const existing = this.stacksById.get(stackId | 0);
            if (!existing) continue;
            this.removeEntry(existing);
            this.stacksById.delete(stackId | 0);
            const pileKey = this.tileKey(existing.tile.x | 0, existing.tile.y | 0, existing.tile.level | 0);
            this.removeFromPile(pileKey, stackId | 0);
            this.promoteMostValuable(pileKey);
            this.emitMutation({ kind: "despawn", stack: existing });
        }
        const upserts = Array.isArray(payload.upserts) ? payload.upserts : [];
        for (const stack of upserts) {
            const entry = this.normalizeStack(stack);
            if (!entry) continue;
            this.upsertEntry(entry);
        }
        this.notify();
    }

    setMetadataResolver(fn?: ResolveMetadata): void {
        this.resolveMetadata = fn ? fn : DEFAULT_METADATA_RESOLVER;
    }

    setNameResolver(fn?: (itemId: number) => string): void {
        if (!fn) {
            this.resolveMetadata = DEFAULT_METADATA_RESOLVER;
            return;
        }
        this.resolveMetadata = (itemId: number) => ({
            ...DEFAULT_METADATA_RESOLVER(itemId),
            name: fn(itemId),
        });
    }

    /**
     * Clear all ground items - used on disconnect/logout.
     */
    clear(): void {
        this.clearEntries();
        this.notify();
    }

    subscribe(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    getVersion(): number {
        return this.version | 0;
    }

    getStacksAt(tileX: number, tileY: number, level: number): ClientGroundItemStack[] {
        const key = this.tileKey(tileX | 0, tileY | 0, level | 0);
        const list = this.stacksByTile.get(key);
        if (!list || list.length === 0) return [];
        return list.map((entry) => ({ ...entry, tile: { ...entry.tile } }));
    }

    /**
     * The tile's stacks in the order the right-click menu lists them, top first: the most
     * valuable, then the rest from oldest to newest.
     */
    getPileAt(tileX: number, tileY: number, level: number): ClientGroundItemStack[] {
        const pile = this.pilesByTile.get(this.tileKey(tileX | 0, tileY | 0, level | 0));
        if (!pile) return [];
        const result: ClientGroundItemStack[] = [];
        for (const id of pile) {
            const entry = this.stacksById.get(id);
            if (entry) result.push({ ...entry, tile: { ...entry.tile } });
        }
        return result;
    }

    getStackById(stackId: number): ClientGroundItemStack | undefined {
        const entry = this.stacksById.get(stackId | 0);
        if (!entry) return undefined;
        return { ...entry, tile: { ...entry.tile } };
    }

    getAllStacks(): ClientGroundItemStack[] {
        const result: ClientGroundItemStack[] = [];
        for (const list of this.stacksByTile.values()) {
            for (const stack of list) {
                result.push({ ...stack, tile: { ...stack.tile } });
            }
        }
        return result;
    }

    getStacksInRadius(
        centerX: number,
        centerY: number,
        level: number,
        opts: { radius?: number; maxEntries?: number } = {},
    ): ClientGroundItemStack[] {
        const radius = Math.max(1, typeof opts.radius === "number" ? opts.radius : 12);
        const maxEntries = Math.max(1, typeof opts.maxEntries === "number" ? opts.maxEntries : 512);
        const result: ClientGroundItemStack[] = [];

        for (const [key, stacks] of this.stacksByTile.entries()) {
            if (!stacks || stacks.length === 0) continue;
            const [lvlStr, xStr, yStr] = key.split("|");
            const lvl = Number(lvlStr) | 0;
            if (lvl !== (level | 0)) continue;

            const tileX = Number(xStr) | 0;
            const tileY = Number(yStr) | 0;
            const dx = Math.abs(tileX - (centerX | 0));
            const dy = Math.abs(tileY - (centerY | 0));
            if (Math.max(dx, dy) > radius) continue;

            for (const stack of stacks) {
                result.push({ ...stack, tile: { ...stack.tile } });
                if (result.length >= maxEntries) {
                    return result;
                }
            }
        }

        return result;
    }

    getOverlayEntries(
        centerX: number,
        centerY: number,
        level: number,
        opts: { radius?: number; maxEntries?: number } = {},
    ): GroundItemOverlayEntry[] {
        const radius = Math.max(1, typeof opts.radius === "number" ? opts.radius : 12);
        const maxEntries = Math.max(1, typeof opts.maxEntries === "number" ? opts.maxEntries : 40);
        const entries: GroundItemOverlayEntry[] = [];
        const visited = new Set<string>();
        for (const [key, stacks] of this.stacksByTile.entries()) {
            if (!stacks || stacks.length === 0) continue;
            const [lvlStr, xStr, yStr] = key.split("|");
            const lvl = Number(lvlStr) | 0;
            if (lvl !== (level | 0)) continue;
            const tileX = Number(xStr) | 0;
            const tileY = Number(yStr) | 0;
            const dx = Math.abs(tileX - (centerX | 0));
            const dy = Math.abs(tileY - (centerY | 0));
            if (Math.max(dx, dy) > radius) continue;
            for (const stack of stacks) {
                const label = stack.quantity > 1 ? `${stack.name} (${stack.quantity})` : stack.name;
                const entryKey = `${stack.id}`;
                if (visited.has(entryKey)) continue;
                visited.add(entryKey);
                entries.push({
                    tileX,
                    tileY,
                    level: lvl,
                    label,
                });
                if (entries.length >= maxEntries) return entries;
            }
        }
        return entries;
    }

    private tileKey(x: number, y: number, level: number): string {
        return `${level}|${x}|${y}`;
    }

    private notify(): void {
        this.version = (this.version + 1) | 0;
        for (const cb of this.listeners) {
            try {
                cb();
            } catch (err) {
                console.log("ground item listener error", err);
            }
        }
    }
}
