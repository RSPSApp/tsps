import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { InventorySlot } from "../../../rs/inventory/Inventory";
import type { OsrsClient } from "../../OsrsClient";
import { Bankmain } from "../banktags/bankmain";
import { createInventorySetupsNavigationButton } from "./InventorySetupsPanel";

export const InventorySetupsConfig = ConfigGroup("inventorysetups", {
    setups: ConfigItem({ name: "Saved setups", description: "Locally saved inventory and equipment setups.", textArea: true, hidden: true, default: "[]" }),
    selectedSetup: ConfigItem({ name: "Selected setup", hidden: true, default: "" }),
});

export type SetupSlot = { slot: number; itemId: number; quantity: number };
export type InventorySetup = { id: string; name: string; inventory: SetupSlot[]; equipment: SetupSlot[]; updatedAt: number };
export type InventorySetupsState = { setups: readonly InventorySetup[]; selectedId: string; version: number };
type Listener = () => void;

function parseSetups(raw: string): InventorySetup[] {
    try {
        const value: unknown = JSON.parse(raw || "[]");
        if (!Array.isArray(value)) return [];
        return value.slice(0, 100).flatMap((entry: any) => {
            if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
            const readSlots = (slots: unknown, capacity: number): SetupSlot[] => {
                if (!Array.isArray(slots)) return [];
                return slots.flatMap((slot: any) => {
                    const index = Number(slot?.slot);
                    const itemId = Number(slot?.itemId);
                    const quantity = Number(slot?.quantity);
                    if (!Number.isInteger(index) || index < 0 || index >= capacity || !Number.isInteger(itemId) || itemId < 0) return [];
                    return [{ slot: index, itemId, quantity: Math.max(1, Math.floor(quantity || 1)) }];
                });
            };
            return [{ id: entry.id.slice(0, 80), name: entry.name.trim().slice(0, 50) || "Untitled setup", inventory: readSlots(entry.inventory, 28), equipment: readSlots(entry.equipment, 14), updatedAt: Number(entry.updatedAt) || 0 }];
        });
    } catch {
        return [];
    }
}

function snapshot(slots: InventorySlot[]): SetupSlot[] {
    return slots.filter((slot) => slot.itemId >= 0 && slot.quantity > 0).map(({ slot, itemId, quantity }) => ({ slot, itemId, quantity }));
}

/** Saves and compares the current inventory and worn equipment for activities. */
export class InventorySetupsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Inventory Setups",
        description: "Save and compare inventory and equipment setups",
        tags: ["inventory", "equipment", "bank", "setups", "gear"],
        enabledByDefault: false,
        configKey: "inventorysetupsplugin",
    };

    static config = InventorySetupsConfig;

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly configManager = inject(ConfigManager);
    private readonly clientToolbar = inject(ClientToolbar);
    private readonly listeners = new Set<Listener>();
    private readonly unsubscribers: Array<() => void> = [];
    private setups: InventorySetup[];
    private selectedId: string;
    private version = 0;
    private state: InventorySetupsState;
    private navButton?: NavigationButton;

    constructor() {
        super();
        const config = this.configManager.getConfig(InventorySetupsConfig);
        this.setups = parseSetups(String(config.setups() ?? "[]"));
        this.selectedId = String(config.selectedSetup() ?? "");
        if (!this.setups.some((setup) => setup.id === this.selectedId)) this.selectedId = this.setups[0]?.id ?? "";
        this.state = { setups: this.setups, selectedId: this.selectedId, version: this.version };
    }

    protected async startUp(): Promise<void> {
        this.unsubscribers.push(this.client.inventory.subscribe(() => this.commit()));
        this.unsubscribers.push(this.client.equipment.subscribe(() => this.commit()));
        this.unsubscribers.push(this.client.bankInventory.subscribe(() => this.commit()));
        const bankGroupId = Bankmain.ITEMS >>> 16;
        const onGroupLoaded = (groupId: number) => { if (groupId === bankGroupId) this.commit(); };
        const onInterfaceClosed = (groupId: number) => { if (groupId === bankGroupId) this.commit(); };
        this.client.widgetManager?.groupLoadedListeners?.add(onGroupLoaded);
        this.client.widgetManager?.interfaceClosedListeners?.add(onInterfaceClosed);
        this.unsubscribers.push(() => this.client.widgetManager?.groupLoadedListeners?.delete(onGroupLoaded));
        this.unsubscribers.push(() => this.client.widgetManager?.interfaceClosedListeners?.delete(onInterfaceClosed));
        this.navButton = createInventorySetupsNavigationButton(this);
        this.clientToolbar.addNavigation(this.navButton);
        this.commit();
    }

    protected async shutDown(): Promise<void> {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): InventorySetupsState {
        return this.state;
    }

    getClient(): OsrsClient {
        return this.client;
    }

    getCurrentInventory(): InventorySlot[] {
        return this.client.inventory.getSlots();
    }

    getCurrentEquipment(): InventorySlot[] {
        return this.client.equipment.getSlots();
    }

    getBankCounts(): Map<number, number> {
        const counts = new Map<number, number>();
        for (const slot of this.client.bankInventory.getSlots()) {
            if (slot.itemId < 0 || slot.quantity <= 0) continue;
            counts.set(slot.itemId, (counts.get(slot.itemId) ?? 0) + slot.quantity);
        }
        return counts;
    }

    isBankOpen(): boolean {
        try {
            return this.client.widgetManager?.getWidgetByUid?.(Bankmain.ITEMS) !== undefined;
        } catch {
            return false;
        }
    }

    saveCurrent(name: string): void {
        const normalizedName = name.trim().slice(0, 50);
        if (!normalizedName) return;
        const existing = this.setups.find((setup) => setup.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
        const id = existing?.id ?? `setup-${Date.now().toString(36)}-${this.setups.length.toString(36)}`;
        const setup: InventorySetup = {
            id,
            name: normalizedName,
            inventory: snapshot(this.client.inventory.getSlots()),
            equipment: snapshot(this.client.equipment.getSlots()),
            updatedAt: Date.now(),
        };
        this.setups = existing ? this.setups.map((current) => current.id === id ? setup : current) : [...this.setups, setup].slice(-100);
        this.selectedId = id;
        this.persist();
        this.commit();
    }

    selectSetup(id: string): void {
        if (id && !this.setups.some((setup) => setup.id === id)) return;
        this.selectedId = id;
        this.configManager.setConfigValue(InventorySetupsConfig, "selectedSetup", id);
        this.commit();
    }

    deleteSetup(id: string): void {
        this.setups = this.setups.filter((setup) => setup.id !== id);
        if (this.selectedId === id) this.selectedId = this.setups[0]?.id ?? "";
        this.persist();
        this.configManager.setConfigValue(InventorySetupsConfig, "selectedSetup", this.selectedId);
        this.commit();
    }

    private persist(): void {
        this.configManager.setConfigValue(InventorySetupsConfig, "setups", JSON.stringify(this.setups));
    }

    private commit(): void {
        this.version++;
        this.state = { setups: this.setups, selectedId: this.selectedId, version: this.version };
        for (const listener of [...this.listeners]) {
            try { listener(); } catch (error) { console.warn("[inventory-setups] listener failed", error); }
        }
    }
}
