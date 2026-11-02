import { Plugin, type PluginDescriptor } from "../../../runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "../../../runelite/client/plugins/PluginInjector";
import { BANKMAIN, INVENTORY, WORNITEMS } from "../../../runelite/api/gameval/InterfaceID";
import { GameState } from "../../../runelite/api/GameState";
import { ConfigChanged } from "../../../runelite/api/events";
import { ConfigManager } from "../../../runelite/client/config/ConfigManager";
import { FONT_BOLD_12, FONT_PLAIN_12 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { compareAttackSpeed, compareItemWeight, compareWornGear, itemAttackSpeed, readItemStats, type ItemStats, type WornItem } from "./itemStats";
import { ItemStatsConfig } from "./ItemStatsConfig";
import { buildCombatStatGroups, formatItemStatsRow, shouldShowSpeedRow, shouldShowWeightRow, type ItemStatsGroup, type ItemStatsRow } from "./itemStatsPresentation";
import { canonicalItemId } from "../inventorytags/inventoryTags";
import { collectWidgetsAtPointAcrossRoots } from "../../../widgets/menu/utils";
import { foodStatsForName, potionStatsForName, runeStatsForName } from "./consumableStats";
import { formatPoisonImmunity, formatRestore } from "./foodStats";
import {
    fallbackInteractionBounds,
    currentInteractionActionText,
    findInteractionTextBounds,
    findMouseoverTimerBounds,
    positionTooltip,
    setItemStatsTooltipBounds,
} from "./tooltipPosition";

const ITEM_GROUPS = [INVENTORY, WORNITEMS, BANKMAIN] as const;
const TOOLTIP_BACKGROUND: [number, number, number, number] = [70 / 255, 61 / 255, 50 / 255, 156 / 255];
const TOOLTIP_OUTLINE: [number, number, number, number] = [55 / 255, 51 / 255, 47 / 255, 1];
const WHITE = 0xffffff;

/** Item stats from cache-backed item params and a worn-gear comparison. */
export class ItemStatsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Item Stats",
        description: "Show equipment bonuses and compare gear with worn equipment",
        tags: ["combat", "equipment", "items", "stats"],
        enabledByDefault: false,
        configKey: "itemstatsplugin",
    };
    static config = ItemStatsConfig;

    private readonly client: OsrsClient;
    private readonly config = inject(ConfigManager).getConfig(ItemStatsConfig);
    private hovered?: { itemId: number; x: number; y: number; w: number; h: number };
    private interactionBounds?: { x: number; y: number; w: number; h: number };
    private signatureValue = "";
    private lastTextScale = { x: 1, y: 1 };

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => this.snapshot(this.lastTextScale),
        draw: (context) => this.draw(context),
    };

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    protected async shutDown(): Promise<void> {
        setItemStatsTooltipBounds(this.client, undefined);
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === ItemStatsConfig.group) this.signatureValue = "";
    }

    getItemStats(itemId: number): ItemStats {
        return readItemStats(this.loadBaseItem(itemId));
    }

    private snapshot(textScale = { x: 1, y: 1 }): string {
        this.lastTextScale = textScale;
        const client: any = this.client;
        const manager = client.widgetManager;
        if (!this.isStarted() || !manager || client.gameState !== GameState.LOGGED_IN) {
            this.hovered = undefined;
            setItemStatsTooltipBounds(this.client, undefined);
            return this.signatureValue = "";
        }
        // Widget bounds and InputManager coordinates have historically shared this
        // coordinate space. Keep hit testing in that space; only drawing/clamping
        // below needs the renderer's canvas dimensions.
        const x = Number(client.inputManager?.mouseX);
        const y = Number(client.inputManager?.mouseY);
        // OsrsClient owns menu lifecycle. The canvas mirror can remain stale after closeMenu().
        const menuOpen = client.menuOpen === true;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || menuOpen) {
            this.hovered = undefined;
            setItemStatsTooltipBounds(this.client, undefined);
            return this.signatureValue = "";
        }
        let hovered: typeof this.hovered;
        // Use the same live tree walk as widget input. It computes positions from
        // current parent offsets and applies scroll/mount scissors, so culled widgets
        // cannot leave stale _abs* bounds eligible for this overlay.
        const roots = typeof manager.getInputRoots === "function" ? manager.getInputRoots() : [];
        const hits = collectWidgetsAtPointAcrossRoots(
            roots,
            x,
            y,
            new Map<number, boolean>(),
            (uid) => manager.getStaticChildrenByParentUid?.(uid) ?? [],
            (containerUid) => {
                const group = manager.interfaceParents?.get(containerUid)?.group;
                return typeof group === "number" ? manager.getAllGroupRoots?.(group) ?? [] : [];
            },
        );
        for (const widget of hits) {
            const groupId = Number(widget.groupId ?? (Number(widget.uid) >>> 16));
            if (!ITEM_GROUPS.includes(groupId as (typeof ITEM_GROUPS)[number])) continue;
            const id = Number(widget.itemId);
            if (!Number.isInteger(id) || id < 0) continue;
            const wx = Number(widget._absX), wy = Number(widget._absY);
            const ww = Number(widget._absWidth), wh = Number(widget._absHeight);
            if (ww > 0 && wh > 0) hovered = { itemId: id, x: wx, y: wy, w: ww, h: wh };
        }
        this.hovered = hovered;
        if (!hovered) setItemStatsTooltipBounds(this.client, undefined);
        this.interactionBounds = hovered ? this.interactionTextBounds(textScale) : undefined;
        const wornSignature = this.currentWornSignature();
        return this.signatureValue = hovered
            ? `${hovered.itemId}:${hovered.x}:${hovered.y}:${x}:${y}:${textScale.x}:${textScale.y}:${this.config.equipmentStats()}:${this.config.showWeight()}:${this.config.alwaysShowBaseStats()}:${JSON.stringify(this.interactionBounds ?? null)}:${wornSignature}`
            : "";
    }

    private draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const { x: scaleX, y: scaleY } = context.overlayTextScale?.() ?? { x: 1, y: 1 };
        const { x: inputScaleX, y: inputScaleY } = context.inputScale?.() ?? { x: 1, y: 1 };
        this.snapshot({ x: scaleX, y: scaleY });
        const hovered = this.hovered;
        if (!hovered) {
            setItemStatsTooltipBounds(this.client, undefined);
            return [];
        }
        const canonicalId = this.canonicalItemId(hovered.itemId);
        const item: any = this.client.objTypeLoader?.load(canonicalId);
        if (!item) {
            setItemStatsTooltipBounds(this.client, undefined);
            return [];
        }
        const stats = this.getItemStats(canonicalId);
        const comparison = this.compareItem(canonicalId);
        const title = String(item.name ?? `Item ${canonicalId}`);
        const groups: ItemStatsGroup[] = this.config.equipmentStats()
            ? buildCombatStatGroups(stats, comparison?.delta, this.config.alwaysShowBaseStats())
            : [];
        const worn: WornItem[] = this.client.equipment.getSlots()
            .filter(({ itemId }) => itemId >= 0)
            .map(({ slot, itemId }) => ({ slot, itemId }));
        if (this.config.equipmentStats() && this.config.showWeight() && Number.isFinite(Number(item.weight))) {
            const weight = Number(item.weight) / 1000;
            const delta = compareItemWeight(item, worn, (id) => this.loadBaseItem(id));
            const showBase = this.config.alwaysShowBaseStats();
            if (shouldShowWeightRow(weight, delta, showBase)) {
                const value = delta === undefined ? `${weight} kg` : this.config.alwaysShowBaseStats()
                    ? `${weight} kg (${signedDecimal(delta)} kg)` : `${signedDecimal(weight)} kg`;
                groups.unshift({ title: "", rows: [{ label: "Weight", value, delta: this.config.alwaysShowBaseStats() ? delta ?? weight : weight, inverse: true,
                    ...(this.config.alwaysShowBaseStats() && delta !== undefined ? { baseValue: `${weight} kg`, ...(delta !== 0 ? { changeValue: `${signedDecimal(delta)} kg` } : {}) } : {}) }] });
            }
        }
        if (this.config.equipmentStats()) {
            const speed = itemAttackSpeed(item);
            const delta = compareAttackSpeed(item, worn, (id) => this.loadBaseItem(id));
            const baseSpeed = speed ?? 0;
            if (shouldShowSpeedRow(speed, delta, this.config.alwaysShowBaseStats())) {
                const value = delta === undefined ? `${baseSpeed}` : this.config.alwaysShowBaseStats()
                    ? `${baseSpeed} (${signed(delta)})` : signed(delta);
                const other = groups.find(({ rows }) => rows.some(({ label }) => label === "Melee Str" || label === "Prayer"));
                const row: ItemStatsRow = { label: "Speed", value, delta: delta ?? speed, inverse: true,
                    ...(delta !== undefined && this.config.alwaysShowBaseStats() ? { baseValue: `${baseSpeed}`, ...(delta !== 0 ? { changeValue: signed(delta) } : {}) } : {}) };
                if (other) other.rows.unshift(row);
                else groups.unshift({ title: "", rows: [row] });
            }
        }

        const food = foodStatsForName(title);
        if (food) {
            const rows: ItemStatsRow[] = [];
            if (food.heal !== undefined) rows.push({ label: "Healing", value: typeof food.heal === "number" ? `${food.heal} HP` : `${food.heal.min}-${food.heal.max} HP` });
            for (const [skill, value] of Object.entries(food.boost ?? {})) rows.push({ label: `${capitalize(skill)} boost`, value: signed(value) });
            for (const [skill, value] of Object.entries(food.restore ?? {})) rows.push({ label: `${capitalize(skill)} restored`, value: formatRestore(value) });
            if (food.runEnergy !== undefined) rows.push({ label: "Run energy", value: `${food.runEnergy}%` });
            if (food.stamina) rows.push({ label: "Stamina", value: "Effect" });
            if (food.poisonImmunity !== undefined) rows.push({ label: "Poison immunity", value: formatPoisonImmunity(food.poisonImmunity) });
            if (food.curePoison) rows.push({ label: "Poison", value: "Cured" });
            if (food.cureVenom) rows.push({ label: "Venom", value: "Cured" });
            if (food.special) rows.push({ label: "Special effect", value: food.special });
            if (food.area) rows.push({ label: "Area restriction", value: food.area });
            if (food.wildernessOnly) rows.push({ label: "Availability", value: "Wilderness only" });
            if (rows.length) groups.push({ title: "Food effects", rows });
            if (food.requiresContext) groups.push({ title: "Limits", rows: [{ label: "Some effects depend on player state", value: "See item use" }] });
        }

        const potion = potionStatsForName(title);
        if (potion?.skillBoosts) {
            const rows = Object.entries(potion.skillBoosts).map(([skill, boost]) => ({
                label: capitalize(skill), value: `+${boost.flat} + ${Math.round(boost.percent * 100)}%`,
            }));
            if (rows.length) groups.push({ title: "Potion boosts", rows });
        }
        if (potion && (potion.runEnergy !== undefined || potion.stamina)) {
            const rows: ItemStatsRow[] = [];
            if (potion.runEnergy !== undefined) {
                rows.push({ label: "Run energy", value: `+${potion.runEnergy}%` });
            }
            if (potion.stamina) {
                rows.push({
                    label: "Stamina",
                    value: `${formatDuration(potion.stamina.durationMs)}, ${potion.stamina.energyPerMovementTick} energy points per running tick`,
                });
            }
            groups.push({ title: "Potion effects", rows });
        } else if (potion?.unsupportedReason) {
            groups.push({ title: "Potion effects", rows: [{ label: "Not shown", value: "Effects unsupported" }] });
        }

        const rune = runeStatsForName(title);
        if (rune) groups.push({ title: "Rune", rows: [
            { label: "Type", value: rune.runeType === "elemental" ? "Elemental" : "Catalytic" },
            ...(rune.providesElement ? [{ label: "Provides element", value: capitalize(rune.rune) }] : []),
            { label: "Spell charge capacity", value: "Not recorded" },
        ] });
        if (groups.length === 0) {
            setItemStatsTooltipBounds(this.client, undefined);
            return [];
        }
        const font = context.fontLoader(FONT_PLAIN_12);
        const headingFont = context.fontLoader(FONT_BOLD_12) ?? font;
        const measure = (text: string) => {
            const plain = text.replace(/<[^>]*>/g, "");
            return font?.measure(plain) ?? plain.length * 7;
        };
        const measureHeading = (text: string) => headingFont?.measure(text.replace(/<[^>]*>/g, "")) ?? measure(text);
        const fit = (text: string, width: number, measureText = measure) => fitText(text, width, (value) => measureText(value) * scaleX);
        // Mouse coordinates and GL draw calls use the renderer canvas pixel space.
        // The widget manager's 765x503 layout is not the screen-space clamp here.
        const canvasW = context.renderer.canvas.width;
        const canvasH = context.renderer.canvas.height;
        const horizontalPadding = 4 * scaleX;
        const minimumWidth = Math.min(64 * scaleX, Math.max(1, canvasW - 4));
        const rowText = (row: ItemStatsRow) => `${row.label}: ${row.baseValue !== undefined
            ? row.changeValue !== undefined ? `${row.baseValue} (${row.changeValue})` : row.baseValue
            : row.value}`;
        const desiredWidth = Math.max(minimumWidth, ...groups.map(({ title: heading }) => measureHeading(heading) * scaleX),
            ...groups.flatMap((group) => group.rows.map((row) => measure(rowText(row)) * scaleX))) + horizontalPadding * 2;
        const width = Math.max(1, Math.min(desiredWidth, canvasW - 4));
        const lineHeight = 14 * scaleY;
        const sectionGap = 2 * scaleY;
        const height = Math.max(1, (6 + groups.reduce((sum, group, index) => sum + (group.title ? 14 : 0) + group.rows.length * 14 + (index > 0 && group.title ? 2 : 0), 0)) * scaleY);
        // Keep the panel under the hovered item, centered on its interaction point.
        const pointerX = Number((this.client as any).inputManager?.mouseX);
        const pointerY = Number((this.client as any).inputManager?.mouseY);
        const anchorX = Number.isFinite(pointerX) ? pointerX * inputScaleX : hovered.x + hovered.w / 2;
        const anchorY = Number.isFinite(pointerY) ? pointerY * inputScaleY : hovered.y + hovered.h;
        const interactionBounds = this.interactionBounds ?? fallbackInteractionBounds(
            anchorX,
            anchorY,
            canvasW,
            canvasH,
            { x: scaleX, y: scaleY },
        );
        const position = positionTooltip(anchorX, anchorY, canvasW, canvasH, width, height, interactionBounds, { x: scaleX, y: scaleY });
        const { x, y } = position;
        context.renderer.drawRect(x, y, width, height, TOOLTIP_BACKGROUND);
        const borderX = Math.min(scaleX, width);
        const borderY = Math.min(scaleY, height);
        context.renderer.drawRect(x, y, width, borderY, TOOLTIP_OUTLINE);
        context.renderer.drawRect(x, y + height - borderY, width, borderY, TOOLTIP_OUTLINE);
        context.renderer.drawRect(x, y + borderY, borderX, Math.max(0, height - borderY * 2), TOOLTIP_OUTLINE);
        context.renderer.drawRect(x + width - borderX, y + borderY, borderX, Math.max(0, height - borderY * 2), TOOLTIP_OUTLINE);
        let rowY = y + 3 * scaleY;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const group = groups[groupIndex];
            if (group.title) {
                if (groupIndex > 0) rowY += sectionGap;
                drawTextGL(context.renderer, context.fontLoader, fit(group.title, width - 8 * scaleX, measureHeading), x + horizontalPadding, rowY, width - 8 * scaleX, lineHeight, FONT_BOLD_12, 0xff9040, 0, 0, true, 1, undefined, scaleX, scaleY);
                rowY += lineHeight;
            }
            for (const { label, value, delta, inverse, baseValue, changeValue } of group.rows) {
                const fitted = formatItemStatsRow({ label, value, delta, inverse, baseValue, changeValue },
                    (plain) => fit(plain, width - horizontalPadding * 2));
                drawTextGL(context.renderer, context.fontLoader, fitted, x + horizontalPadding, rowY, width - horizontalPadding * 2, lineHeight, FONT_PLAIN_12, WHITE, 0, 0, true, 1, undefined, scaleX, scaleY);
                rowY += lineHeight;
            }
        }
        const bounds = { x, y, w: width, h: height };
        setItemStatsTooltipBounds(this.client, bounds);
        return [bounds];
    }

    private interactionTextBounds(textScale: { x: number; y: number }): { x: number; y: number; w: number; h: number } | undefined {
        const client: any = this.client;
        const manager = client.widgetManager;
        const timerBounds = findMouseoverTimerBounds(
            manager?.getActiveTimerWidgets?.() ?? [],
            (uid) => manager?.getStaticChildrenByParentUid?.(uid) ?? [],
            textScale,
        );
        if (timerBounds) return timerBounds;

        const actionText = currentInteractionActionText(client);
        const groups = new Set<number>(ITEM_GROUPS);
        const rootGroup = Number(manager?.rootInterface);
        if (Number.isInteger(rootGroup) && rootGroup >= 0) groups.add(rootGroup);
        const widgets = [...groups].flatMap((group) => manager?.getWidgetsForGroup?.(group) ?? []);
        const actualBounds = findInteractionTextBounds(widgets, actionText, textScale);
        return actualBounds;
    }

    compareItem(itemId: number) {
        const candidate = this.loadBaseItem(itemId);
        if (!candidate) return undefined;

        const worn: WornItem[] = this.client.equipment.getSlots()
            .filter(({ itemId: wornId }) => wornId >= 0)
            .map(({ slot, itemId: wornId }) => ({ slot, itemId: wornId }));
        return compareWornGear(candidate, worn, (id) => this.loadBaseItem(id));
    }

    private currentWornSignature(): string {
        return this.client.equipment.getSlots()
            .map(({ slot, itemId }) => `${slot}:${itemId}`)
            .join(",");
    }

    private loadBaseItem(itemId: number): any {
        const loader = this.client.objTypeLoader;
        let item = loader?.load(itemId | 0);
        if (item && item.noteTemplate >= 0 && item.note >= 0) item = loader?.load(item.note) ?? item;
        return item;
    }

    private canonicalItemId(itemId: number): number {
        return canonicalItemId(itemId, (id) => this.client.objTypeLoader?.load(id));
    }
}

function capitalize(value: string): string {
    return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function signed(value: number): string {
    return `${value > 0 ? "+" : ""}${value}`;
}

function signedDecimal(value: number): string {
    const rounded = Math.round(value * 1000) / 1000;
    return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatDuration(durationMs: number): string {
    if (durationMs > 0 && durationMs % 60_000 === 0) return `${durationMs / 60_000} min`;
    if (durationMs > 0 && durationMs % 1_000 === 0) return `${durationMs / 1_000} sec`;
    return `${durationMs} ms`;
}

function fitText(text: string, maxWidth: number, measure: (value: string) => number): string {
    if (measure(text) <= maxWidth) return text;
    const ellipsis = "…";
    let fitted = text;
    while (fitted.length > 0 && measure(fitted + ellipsis) > maxWidth) fitted = fitted.slice(0, -1);
    return fitted ? fitted + ellipsis : "";
}
