import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { getItemPricesRevision, guidePrice } from "../../../network/serverConnection/domain/itemPrices";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { GroundItemMutation } from "../../data/ground/GroundItemStore";
import type { OsrsClient } from "../../OsrsClient";
import { createLootTrackerNavigationButton } from "./LootTrackerPanel";

export const LootTrackerConfig = ConfigGroup("loottracker", {
    items: ConfigItem({ name: "Tracked loot", description: "Locally saved loot tracker data.", textArea: true, hidden: true, default: "[]" }),
});

export type LootTrackerItem = { itemId: number; name: string; quantity: number; unitPrice: number };
export type LootTrackerState = { items: readonly LootTrackerItem[]; version: number };

type ActiveStack = { itemId: number };
type Listener = () => void;

function parseItems(raw: string): LootTrackerItem[] {
    try {
        const value: unknown = JSON.parse(raw || "[]");
        if (!Array.isArray(value)) return [];
        return value.slice(0, 250).flatMap((row: any) => {
            const itemId = Number(row?.itemId);
            const quantity = Number(row?.quantity);
            const unitPrice = Number(row?.unitPrice);
            if (!Number.isInteger(itemId) || itemId < 0 || !Number.isFinite(quantity) || quantity <= 0) return [];
            return [{ itemId, name: String(row?.name || `Item ${itemId}`).slice(0, 100), quantity: Math.floor(quantity), unitPrice: Math.max(0, Math.floor(unitPrice || 0)) }];
        });
    } catch {
        return [];
    }
}

/** Tracks personal ground drops from the server's ground-item stream. */
export class LootTrackerPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Loot Tracker",
        description: "Track personal loot drops and their estimated value",
        tags: ["loot", "drops", "items", "value"],
        enabledByDefault: false,
        configKey: "loottrackerplugin",
    };

    static config = LootTrackerConfig;

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly configManager = inject(ConfigManager);
    private readonly clientToolbar = inject(ClientToolbar);
    private readonly listeners = new Set<Listener>();
    private readonly activeStacks = new Map<number, ActiveStack>();
    private readonly seenStacks = new Set<string>();
    private readonly mutationListener = (event: GroundItemMutation) => this.onGroundItemMutation(event);
    private items: LootTrackerItem[];
    private version = 0;
    private state: LootTrackerState;
    private navButton?: NavigationButton;
    private priceRevision = getItemPricesRevision();

    constructor() {
        super();
        const config = this.configManager.getConfig(LootTrackerConfig);
        this.items = parseItems(String(config.items() ?? "[]"));
        this.state = { items: this.items, version: this.version };
    }

    protected async startUp(): Promise<void> {
        this.client.groundItems.mutationListeners.add(this.mutationListener);
        this.navButton = createLootTrackerNavigationButton(this);
        this.clientToolbar.addNavigation(this.navButton);
        this.commit();
    }

    protected async shutDown(): Promise<void> {
        this.client.groundItems.mutationListeners.delete(this.mutationListener);
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
        this.activeStacks.clear();
        this.seenStacks.clear();
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): LootTrackerState {
        return this.state;
    }

    getClient(): OsrsClient {
        return this.client;
    }

    clear(): void {
        this.items = [];
        this.activeStacks.clear();
        this.seenStacks.clear();
        this.save();
        this.commit();
    }

    private onGroundItemMutation(event: GroundItemMutation): void {
        const stack = event.stack;
        const localId = this.client.controlledPlayerServerId | 0;
        if (event.kind === "despawn") {
            this.activeStacks.delete(stack.id | 0);
            return;
        }

        if (stack.ownerId !== undefined && localId >= 0 && (stack.ownerId | 0) !== localId) return;
        if (stack.ownership !== 1 && !(stack.ownerId !== undefined && localId >= 0 && (stack.ownerId | 0) === localId)) return;

        if (event.kind === "spawn") {
            const signature = this.stackSignature(stack);
            this.activeStacks.set(stack.id | 0, { itemId: stack.itemId | 0 });
            if (this.seenStacks.has(signature)) return;
            this.rememberStack(signature);
            this.add(stack.itemId, stack.name, stack.quantity, stack.gePrice);
            return;
        }

        const active = this.activeStacks.get(stack.id | 0);
        if (!active || active.itemId !== (stack.itemId | 0)) return;
        const increase = Math.max(0, (stack.quantity | 0) - (event.oldQuantity ?? stack.quantity));
        if (increase > 0) {
            // Merging keeps the stack ID but resets its age, changing createdTick. Remember
            // the updated signature so a later region snapshot does not count the full stack again.
            this.rememberStack(this.stackSignature(stack));
            this.add(stack.itemId, stack.name, increase, stack.gePrice);
        }
    }

    private stackSignature(stack: GroundItemMutation["stack"]): string {
        return `${stack.id}|${stack.itemId}|${stack.tile.x}|${stack.tile.y}|${stack.tile.level}|${stack.createdTick ?? "?"}`;
    }

    private rememberStack(signature: string): void {
        this.seenStacks.add(signature);
        if (this.seenStacks.size > 5000) this.seenStacks.clear();
    }

    private add(itemId: number, name: string, quantity: number, unitPrice: number): void {
        const id = itemId | 0;
        const amount = Math.max(1, quantity | 0);
        const price = this.priceFor(id, unitPrice);
        const existing = this.items.find((item) => item.itemId === id);
        if (existing) {
            this.items = this.items.map((item) => item.itemId === id
                ? { ...item, quantity: item.quantity + amount, unitPrice: price, name: name || item.name }
                : item);
        } else {
            this.items = [...this.items, { itemId: id, name: name || `Item ${id}`, quantity: amount, unitPrice: price }].slice(-250);
        }
        this.save();
        this.commit();
    }

    private save(): void {
        this.configManager.setConfigValue(LootTrackerConfig, "items", JSON.stringify(this.items));
    }

    onGameTick(): void {
        const revision = getItemPricesRevision();
        if (revision === this.priceRevision) return;
        this.priceRevision = revision;
        let changed = false;
        this.items = this.items.map((item) => {
            const price = this.priceFor(item.itemId, item.unitPrice);
            if (price === item.unitPrice) return item;
            changed = true;
            return { ...item, unitPrice: price };
        });
        if (!changed) return;
        this.save();
        this.commit();
    }

    private priceFor(itemId: number, fallback: number): number {
        if ((itemId | 0) === 995) return 1;
        let marketId = itemId | 0;
        let cachePrice = Math.max(0, fallback | 0);
        try {
            const definition = this.client.objTypeLoader?.load?.(marketId);
            if (definition && definition.noteTemplate >= 0 && definition.note >= 0) marketId = definition.note | 0;
            const marketDefinition = marketId === itemId ? definition : this.client.objTypeLoader?.load?.(marketId);
            cachePrice = Math.max(0, Number(marketDefinition?.price ?? cachePrice) | 0);
        } catch {}
        const quotedPrice = guidePrice(marketId);
        return Math.max(0, Number(quotedPrice && quotedPrice > 0 ? quotedPrice : cachePrice) | 0);
    }

    private commit(): void {
        this.version++;
        this.state = { items: this.items, version: this.version };
        for (const listener of [...this.listeners]) {
            try { listener(); } catch (error) { console.warn("[loot-tracker] listener failed", error); }
        }
    }
}
