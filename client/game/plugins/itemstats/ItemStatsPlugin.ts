import { Plugin, type PluginDescriptor } from "../../../runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "../../../runelite/client/plugins/PluginInjector";
import { BANKMAIN, INVENTORY, WORNITEMS } from "../../../runelite/api/gameval/InterfaceID";
import { GameState } from "../../../runelite/api/GameState";
import { FONT_BOLD_12, FONT_PLAIN_12 } from "../../../ui/fonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { compareWornGear, readItemStats, type ItemStats, type WornItem } from "./itemStats";
import { buildCombatStatGroups, type ItemStatsGroup, type ItemStatsRow } from "./itemStatsPresentation";
import { canonicalItemId } from "../inventorytags/inventoryTags";
import { foodStatsForName, potionStatsForName, runeStatsForName } from "./consumableStats";
import {
    fallbackInteractionBounds,
    findInteractionTextBounds,
    findMouseoverTimerBounds,
    positionTooltip,
} from "./tooltipPosition";

const ITEM_GROUPS = [INVENTORY, WORNITEMS, BANKMAIN] as const;
const TOOLTIP_BACKGROUND: [number, number, number, number] = [0.12, 0.1, 0.07, 0.96];
const WHITE = 0xffffff;
const TOOLTIP_BORDER: [number, number, number, number] = [0.62, 0.52, 0.34, 0.95];

/** Item stats from cache-backed item params and a worn-gear comparison. */
export class ItemStatsPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Item Stats",
        description: "Show equipment bonuses and compare gear with worn equipment",
        tags: ["combat", "equipment", "items", "stats"],
        configKey: "itemstatsplugin",
    };

    private readonly client: OsrsClient;
    private hovered?: { itemId: number; x: number; y: number; w: number; h: number };
    private interactionBounds?: { x: number; y: number; w: number; h: number };
    private signatureValue = "";

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => this.snapshot(),
        draw: (context) => this.draw(context),
    };

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    getItemStats(itemId: number): ItemStats {
        return readItemStats(this.loadBaseItem(itemId));
    }

    private snapshot(): string {
        const client: any = this.client;
        const manager = client.widgetManager;
        if (!this.isStarted() || !manager || client.gameState !== GameState.LOGGED_IN) {
            this.hovered = undefined;
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
            return this.signatureValue = "";
        }
        let hovered: typeof this.hovered;
        const seen = new Set<any>();
        const visit = (widget: any, inheritedHidden = false): void => {
            if (!widget || seen.has(widget)) return;
            seen.add(widget);
            const hidden = inheritedHidden || widget.hidden === true || widget.isHidden === true;
            if (hidden) return;
            const id = Number(widget.itemId);
            const wx = Number(widget._absX), wy = Number(widget._absY);
            const ww = Number(widget._absWidth), wh = Number(widget._absHeight);
            if (Number.isInteger(id) && id >= 0 && ww > 0 && wh > 0 && x >= wx && y >= wy && x < wx + ww && y < wy + wh) {
                // Later children are drawn above their parents, so retain the deepest hit.
                hovered = { itemId: id, x: wx, y: wy, w: ww, h: wh };
            }
            for (const child of widget.children ?? []) visit(child, hidden);
        };
        for (const group of ITEM_GROUPS) {
            for (const widget of manager.getWidgetsForGroup?.(group) ?? []) {
                if (typeof widget?.uid === "number" && manager.isEffectivelyHidden?.(widget.uid)) continue;
                visit(widget);
            }
        }
        this.hovered = hovered;
        this.interactionBounds = hovered ? this.interactionTextBounds() : undefined;
        return this.signatureValue = hovered
            ? `${hovered.itemId}:${hovered.x}:${hovered.y}:${x}:${y}:${JSON.stringify(this.interactionBounds ?? null)}`
            : "";
    }

    private draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        this.snapshot();
        const hovered = this.hovered;
        if (!hovered) return [];
        const canonicalId = this.canonicalItemId(hovered.itemId);
        const item: any = this.client.objTypeLoader?.load(canonicalId);
        if (!item) return [];
        const stats = this.getItemStats(canonicalId);
        const comparison = this.compareItem(canonicalId);
        const title = String(item.name ?? `Item ${canonicalId}`);
        const groups: ItemStatsGroup[] = buildCombatStatGroups(stats, comparison?.delta);

        const food = foodStatsForName(title);
        if (food) {
            const rows: ItemStatsRow[] = [];
            if (food.heal !== undefined) rows.push({ label: "Healing", value: typeof food.heal === "number" ? `${food.heal} HP` : `${food.heal.min}-${food.heal.max} HP` });
            for (const [skill, value] of Object.entries(food.boost ?? {})) rows.push({ label: `${capitalize(skill)} boost`, value: signed(value) });
            for (const [skill, value] of Object.entries(food.restore ?? {})) rows.push({ label: `${capitalize(skill)} restored`, value: `${value}` });
            if (food.runEnergy !== undefined) rows.push({ label: "Run energy", value: `${food.runEnergy}%` });
            if (food.stamina) rows.push({ label: "Stamina", value: "Effect" });
            if (food.poisonImmunity !== undefined) rows.push({ label: "Poison immunity", value: `${food.poisonImmunity} min` });
            if (food.curePoison) rows.push({ label: "Poison", value: "Cured" });
            if (food.cureVenom) rows.push({ label: "Venom", value: "Cured" });
            if (food.special) rows.push({ label: "Special effect", value: food.special });
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
                const energyPercent = Math.round(potion.stamina.energyPerMovementTick * 100);
                rows.push({
                    label: "Stamina",
                    value: `${formatDuration(potion.stamina.durationMs)}, ${energyPercent}% energy per movement tick`,
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
        if (groups.length === 0) return [];
        const font = context.fontLoader(FONT_PLAIN_12);
        const headingFont = context.fontLoader(FONT_BOLD_12) ?? font;
        const measure = (text: string) => font?.measure(text) ?? text.length * 7;
        const measureHeading = (text: string) => headingFont?.measure(text) ?? measure(text);
        // Mouse coordinates and GL draw calls use the renderer canvas pixel space.
        // The widget manager's 765x503 layout is not the screen-space clamp here.
        const canvasW = context.renderer.canvas.width;
        const canvasH = context.renderer.canvas.height;
        const horizontalPadding = 8;
        const minimumWidth = Math.min(176, Math.max(1, canvasW - 4));
        const valueWidth = Math.max(30, ...groups.flatMap((group) => group.rows.map(({ value }) => measure(value))));
        const desiredWidth = Math.max(minimumWidth, measure(title), ...groups.map(({ title: heading }) => measureHeading(heading)), ...groups.flatMap((group) => group.rows.map(({ label }) => measure(label) + valueWidth + 22))) + horizontalPadding * 2;
        const width = Math.max(1, Math.min(desiredWidth, canvasW - 4));
        const height = Math.max(1, 28 + groups.reduce((sum, group) => sum + 17 + group.rows.length * 15, 0));
        const clippedValueWidth = Math.min(valueWidth, Math.max(1, width - horizontalPadding * 2 - 36));
        const clippedLabelWidth = Math.max(1, width - clippedValueWidth - 30);
        // Keep the panel under the hovered item, centered on its interaction point.
        const pointerX = Number((this.client as any).inputManager?.mouseX);
        const pointerY = Number((this.client as any).inputManager?.mouseY);
        const anchorX = Number.isFinite(pointerX) ? pointerX : hovered.x + hovered.w / 2;
        const anchorY = Number.isFinite(pointerY) ? pointerY : hovered.y + hovered.h;
        const interactionBounds = this.interactionBounds ?? fallbackInteractionBounds(
            anchorX,
            anchorY,
            canvasW,
            canvasH,
        );
        const position = positionTooltip(anchorX, anchorY, canvasW, canvasH, width, height, interactionBounds);
        const { x, y } = position;
        context.renderer.drawRect(x, y, width, height, TOOLTIP_BACKGROUND);
        context.renderer.drawRect(x, y, width, 1, TOOLTIP_BORDER);
        context.renderer.drawRect(x, y + height - 1, width, 1, TOOLTIP_BORDER);
        drawTextGL(context.renderer, context.fontLoader, fitText(title, width - 16, measure), x + 8, y + 4, width - 16, 16, FONT_PLAIN_12, 0xffd36a, 0, 0, true);
        context.renderer.drawRect(x + 8, y + 22, width - 16, 1, TOOLTIP_BORDER);
        let rowY = y + 26;
        for (const group of groups) {
            drawTextGL(context.renderer, context.fontLoader, fitText(group.title, width - 16, measureHeading), x + 8, rowY, width - 16, 15, FONT_BOLD_12, 0xffd36a, 0, 0, true);
            rowY += 16;
            for (const { label, value, delta } of group.rows) {
                const color = delta === undefined ? WHITE : delta > 0 ? 0x77ff77 : delta < 0 ? 0xff7777 : WHITE;
                drawTextGL(context.renderer, context.fontLoader, fitText(label, clippedLabelWidth, measure), x + horizontalPadding, rowY, clippedLabelWidth, 15, FONT_PLAIN_12, WHITE, 0, 0, true);
                drawTextGL(context.renderer, context.fontLoader, fitText(value, clippedValueWidth, measure), x + width - clippedValueWidth - horizontalPadding, rowY, clippedValueWidth, 15, FONT_PLAIN_12, color, 2, 0, true);
                rowY += 15;
            }
        }
        return [{ x, y, w: width, h: height }];
    }

    private interactionTextBounds(): { x: number; y: number; w: number; h: number } | undefined {
        const client: any = this.client;
        const manager = client.widgetManager;
        const timerBounds = findMouseoverTimerBounds(
            manager?.getActiveTimerWidgets?.() ?? [],
            (uid) => manager?.getStaticChildrenByParentUid?.(uid) ?? [],
        );
        if (timerBounds) return timerBounds;

        const entries: any[] = Array.isArray(client.menuActiveSimpleEntries) ? client.menuActiveSimpleEntries : [];
        const topEntry = entries.find((entry) => String(entry?.option ?? "").trim() &&
            String(entry.option).trim().toLowerCase() !== "cancel");
        const actionText = topEntry
            ? `${String(topEntry.option).trim()} ${String(topEntry.target ?? "").trim()}`.trim()
            : "";
        const groups = new Set<number>(ITEM_GROUPS);
        const rootGroup = Number(manager?.rootInterface);
        if (Number.isInteger(rootGroup) && rootGroup >= 0) groups.add(rootGroup);
        const widgets = [...groups].flatMap((group) => manager?.getWidgetsForGroup?.(group) ?? []);
        const actualBounds = findInteractionTextBounds(widgets, actionText);
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
