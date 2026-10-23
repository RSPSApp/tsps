import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { ConfigChanged } from "@runelite/api/events";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay } from "../ClientPluginManager";
import { createInventoryTagsNavigationButton } from "./InventoryTagsPanel";

export type InventoryTagGroup = { name: string; color: string; itemIds: number[] };
export const InventoryTagsConfig = ConfigGroup("inventorytags", {
    groups: ConfigItem({ name: "Item groups (JSON)", description: 'Example: [{"name":"Combat","color":"#ff0000","itemIds":[4151,11840]}]. Exact item IDs; first matching group wins. Invalid edits hide tags until corrected.', textArea: true, default: "[]" }),
});

export function parseInventoryTagGroups(raw: string): InventoryTagGroup[] {
    const groups: unknown = JSON.parse(raw);
    if (!Array.isArray(groups) || groups.length > 64) throw new Error("Enter an array of at most 64 item groups.");
    return groups.map((group) => {
        if (!group || typeof group.name !== "string" || !group.name.trim() || !/^#[0-9a-f]{6}$/i.test(group.color) || !Array.isArray(group.itemIds) || group.itemIds.length > 4096 || group.itemIds.some((id: unknown) => !Number.isInteger(id) || Number(id) <= 0)) {
            throw new Error("Each group needs a name, #RRGGBB colour and positive integer itemIds.");
        }
        return { name: group.name.trim(), color: group.color.toLowerCase(), itemIds: [...new Set<number>(group.itemIds)] };
    });
}

export type TagRect = { x: number; y: number; w: number; h: number; color: number };
/** Read current IF3 item widgets, including dynamic slots, without changing their sprites or settings. */
export function inventoryTagBounds(widgets: readonly any[], manager: { isEffectivelyHidden(uid: number): boolean }, colorForItem: (id: number) => number | undefined): TagRect[] {
    const result: TagRect[] = [];
    const seen = new Set<object>();
    const visit = (widget: any) => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        if (widget.isHidden || widget.hidden || manager.isEffectivelyHidden(widget.uid)) return;
        const color = colorForItem(widget.itemId ?? -1);
        const { _absX: x, _absY: y, _absWidth: w, _absHeight: h } = widget;
        if (color !== undefined && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) result.push({ x, y, w, h, color });
        for (const child of widget.children ?? []) visit(child);
    };
    for (const widget of widgets) visit(widget);
    return result;
}

export class InventoryTagsPlugin extends Plugin {
    static descriptor = { name: "Inventory Tags", description: "Colour the inventory items in your saved item groups.", tags: ["inventory", "items", "tags"], configKey: "inventorytagsplugin", enabledByDefault: false };
    static config = InventoryTagsConfig;
    private readonly manager = inject(ConfigManager);
    private readonly config = this.manager.getConfig(InventoryTagsConfig);
    private readonly toolbar = inject(ClientToolbar);
    private readonly listeners = new Set<() => void>();
    private nav?: NavigationButton;
    private state: { groups: InventoryTagGroup[]; error?: string };
    private readonly client: OsrsClient;
    private cachedRaw?: string;
    private colors = new Map<number, number>();
    constructor(client?: OsrsClient) { super(); this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN); this.state = this.readState(); }
    private readState(): { groups: InventoryTagGroup[]; error?: string } {
        try { return { groups: parseInventoryTagGroups(String(this.config.groups())) }; }
        catch (error) { return { groups: [], error: error instanceof Error ? error.message : "Invalid groups" }; }
    }
    getState() { return this.state; }
    subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    private commit(): void { this.state = this.readState(); for (const listener of this.listeners) listener(); }
    onConfigChanged(event: ConfigChanged): void { if (event.getGroup() === InventoryTagsConfig.group) this.commit(); }
    protected override async startUp(): Promise<void> { this.nav = createInventoryTagsNavigationButton(this); this.toolbar.addNavigation(this.nav); this.commit(); }
    protected override async shutDown(): Promise<void> { if (this.nav) this.toolbar.removeNavigation(this.nav); this.nav = undefined; }
    getGroups(): InventoryTagGroup[] { try { return parseInventoryTagGroups(String(this.config.groups())); } catch { return []; } }
    setGroups(groups: InventoryTagGroup[]): void {
        const normalized = parseInventoryTagGroups(JSON.stringify(groups));
        this.manager.setConfigValue(InventoryTagsConfig, "groups", JSON.stringify(normalized));
        this.commit();
    }
    colorForItem(id: number): number | undefined {
        const raw = String(this.config.groups());
        if (raw !== this.cachedRaw) {
            this.cachedRaw = raw; this.colors.clear();
            for (const group of this.getGroups()) for (const item of group.itemIds) if (!this.colors.has(item)) this.colors.set(item, parseInt(group.color.slice(1), 16));
        }
        return this.colors.get(id);
    }
    private bounds(): TagRect[] {
        if (!this.isStarted() || this.client.gameState !== 30 || !this.client.widgetManager) return [];
        const manager = this.client.widgetManager;
        if (manager.rootInterface !== 149 && manager.getInterfaceParentContainerUid(149) === undefined) return [];
        return inventoryTagBounds(manager.getWidgetsForGroup(149), manager, (id) => this.colorForItem(id));
    }
    readonly widgetOverlay: WidgetOverlay = {
        signature: () => { const bounds = this.bounds(); return bounds.length ? JSON.stringify(bounds) : ""; },
        draw: ({ renderer }) => this.bounds().map((rect) => {
            const { x, y, w, h, color } = rect;
            const rgba: [number, number, number, number] = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, 0.9];
            const border = Math.min(2, w / 2, h / 2);
            renderer.drawRect(x, y, w, border, rgba); renderer.drawRect(x, y + h - border, w, border, rgba);
            renderer.drawRect(x, y, border, h, rgba); renderer.drawRect(x + w - border, y, border, h, rgba);
            return { x, y, w, h };
        }),
    };
}
