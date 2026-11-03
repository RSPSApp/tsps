import { ConfigChanged } from "../../../runelite/api/events";
import { GameState } from "../../../runelite/api/GameState";
import {
    BANKMAIN, BANKSIDE, INVENTORY, LUMBRIDGE_ALCHEMY, POH_COSTUMES_SIDE,
    SEED_VAULT, SEED_VAULT_DEPOSIT,
} from "../../../runelite/api/gameval/InterfaceID";
import { COINS, NATURERUNE, PLATINUM } from "../../../runelite/api/gameval/ItemID";
import { overlayFont } from "@runelite/client/ui/overlay/OverlayFonts";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import { ConfigManager } from "../../../runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "../../../runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "../../../runelite/client/plugins/PluginInjector";
import { guidePrice, getItemPricesRevision } from "../../../network/serverConnection/domain/itemPrices";
import type { OsrsClient } from "../../OsrsClient";
import type { ClientPlugin, WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { canonicalItemId } from "../inventorytags/inventoryTags";
import { collectWidgetsAtPointAcrossRoots } from "../../../widgets/menu/utils";
import { ItemPricesConfig } from "./ItemPricesConfig";
import { buildItemPriceRows } from "./itemPricesPresentation";
import { itemPriceMarketId } from "./itemPricesMapping";
import {
    fallbackInteractionBounds,
    currentInteractionActionText,
    findInteractionTextBounds,
    findMouseoverTimerBounds,
    getItemStatsTooltipBounds,
    isHighAlchemySpellSelected,
    scaleTooltipRect,
} from "../itemstats/tooltipPosition";

type HoveredItem = { itemId: number; quantity: number; group: number; x: number; y: number; w: number; h: number };
const GROUPS = [INVENTORY, BANKMAIN, BANKSIDE, LUMBRIDGE_ALCHEMY, POH_COSTUMES_SIDE, SEED_VAULT, SEED_VAULT_DEPOSIT] as const;
const INVENTORY_GROUPS = [INVENTORY, POH_COSTUMES_SIDE] as const;
const TOOLTIP_BACKGROUND: [number, number, number, number] = [70 / 255, 61 / 255, 50 / 255, 156 / 255];
const TOOLTIP_OUTLINE: [number, number, number, number] = [55 / 255, 51 / 255, 47 / 255, 1];
const WHITE = 0xffffff;

/** Shows connected-world guide quotes and cache-derived alchemy values on item hover. */
export class ItemPricesPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Item Prices",
        description: "Show guide and alchemy values when you hover an item",
        tags: ["items", "prices", "alchemy"],
        enabledByDefault: false,
        configKey: "itempricesplugin",
    };
    static config = ItemPricesConfig;

    private readonly config = inject(ConfigManager).getConfig(ItemPricesConfig);
    private readonly client: OsrsClient;
    private hovered?: HoveredItem;
    private interactionBounds?: { x: number; y: number; w: number; h: number };
    private isAlching = false;
    private signatureValue = "";

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => this.snapshot(),
        draw: (context) => this.draw(context),
    };

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === ItemPricesConfig.group) this.signatureValue = "";
    }

    protected async shutDown(): Promise<void> {
        this.hovered = undefined;
        this.interactionBounds = undefined;
        this.isAlching = false;
        this.signatureValue = "";
    }

    private snapshot(): string {
        const client: any = this.client;
        const manager = client.widgetManager;
        if (!this.isStarted() || client.gameState !== GameState.LOGGED_IN || !manager || client.menuOpen) {
            this.hovered = undefined;
            this.interactionBounds = undefined;
            this.isAlching = false;
            return this.signatureValue = "";
        }
        const mx = Number(client.inputManager?.mouseX), my = Number(client.inputManager?.mouseY);
        if (!Number.isFinite(mx) || !Number.isFinite(my) || mx < 0 || my < 0) {
            this.hovered = undefined;
            this.interactionBounds = undefined;
            this.isAlching = false;
            return this.signatureValue = "";
        }
        this.isAlching = this.activeMenuActionIsHighAlch(client);
        let found: HoveredItem | undefined;
        const roots = typeof manager.getInputRoots === "function" ? manager.getInputRoots() : [];
        const hits = collectWidgetsAtPointAcrossRoots(
            roots,
            mx,
            my,
            new Map<number, boolean>(),
            (uid) => manager.getStaticChildrenByParentUid?.(uid) ?? [],
            (containerUid) => {
                const group = manager.interfaceParents?.get(containerUid)?.group;
                return typeof group === "number" ? manager.getAllGroupRoots?.(group) ?? [] : [];
            },
        );
        for (const widget of hits) {
            const group = Number(widget.groupId ?? (Number(widget.uid) >>> 16));
            if (!GROUPS.includes(group as typeof GROUPS[number])) continue;
            if (INVENTORY_GROUPS.includes(group as typeof INVENTORY_GROUPS[number]) &&
                this.config.hideInventory() && !(this.isAlching && this.config.showWhileAlching())) continue;
            if (group === LUMBRIDGE_ALCHEMY && !(this.isAlching && this.config.showWhileAlching())) continue;
            const id = Number(widget.itemId), x = Number(widget._absX), y = Number(widget._absY), w = Number(widget._absWidth), h = Number(widget._absHeight);
            if (Number.isInteger(id) && id >= 0 && w > 0 && h > 0) {
                found = { itemId: id, quantity: Math.max(1, Number(widget.itemQuantity) | 0), group, x, y, w, h };
            }
        }
        this.hovered = found;
        this.interactionBounds = found ? this.nativeInteractionBounds(client) : undefined;
        const statsBounds = getItemStatsTooltipBounds(this.client);
        return this.signatureValue = found
            ? `${found.itemId}:${found.quantity}:${found.group}:${found.x}:${found.y}:${mx}:${my}:${getItemPricesRevision()}:${this.isAlching}:${JSON.stringify(this.interactionBounds)}:${JSON.stringify(statsBounds)}:${this.config.showGEPrice()}:${this.config.showHAValue()}:${this.config.showEA()}:${this.config.hideInventory()}:${this.config.showAlchProfit()}:${this.config.showWhileAlching()}`
            : "";
    }

    private activeMenuActionIsHighAlch(client: any): boolean {
        return isHighAlchemySpellSelected();
    }

    private nativeInteractionBounds(client: any): { x: number; y: number; w: number; h: number } | undefined {
        const manager = client.widgetManager;
        const timerBounds = findMouseoverTimerBounds(
            manager?.getActiveTimerWidgets?.() ?? [],
            (uid) => manager?.getStaticChildrenByParentUid?.(uid) ?? [],
        );
        if (timerBounds) return timerBounds;
        const actionText = currentInteractionActionText(client);
        const groups = new Set<number>(GROUPS);
        const rootGroup = Number(manager?.rootInterface);
        if (Number.isInteger(rootGroup) && rootGroup >= 0) groups.add(rootGroup);
        const widgets = [...groups].flatMap((group) => manager?.getWidgetsForGroup?.(group) ?? []);
        const actualBounds = findInteractionTextBounds(widgets, actionText);
        if (actualBounds) return actualBounds;
        return undefined;
    }

    private draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        this.snapshot();
        const hover = this.hovered;
        if (!hover) return [];
        const loader: any = this.client.objTypeLoader;
        const id = canonicalItemId(hover.itemId, (itemId) => loader?.load(itemId));
        const marketId = itemPriceMarketId(id);
        const item = loader?.load(id);
        if (!item) return [];
        const settings = {
            showGEPrice: this.config.showGEPrice(),
            showHAValue: this.config.showHAValue(),
            showEA: this.config.showEA(),
            showAlchProfit: this.config.showAlchProfit(),
        };
        const isCoin = id === COINS || id === PLATINUM;
        const quote = settings.showGEPrice && !isCoin ? guidePrice(marketId) : undefined;
        const natureRuneQuote = settings.showAlchProfit && settings.showGEPrice
            ? guidePrice(NATURERUNE) : undefined;
        const rows = buildItemPriceRows({
            itemId: id,
            quantity: hover.quantity,
            storePrice: Number(item.price) || 0,
            guideQuote: quote,
            natureRuneQuote,
            settings,
        });
        if (!rows.length) return [];
        const { renderer, fontLoader } = context;
        // TooltipManager's tooltip: the tooltip font, the rows growing with it.
        const tooltipFont = overlayFont("tooltip");
        const font = fontLoader(tooltipFont.id);
        const overlayScale = context.overlayTextScale?.() ?? { x: 1, y: 1 };
        const scaleX = finiteScale(overlayScale.x), scaleY = finiteScale(overlayScale.y);
        const inputScale = context.inputScale?.() ?? { x: 1, y: 1 };
        const inputScaleX = finiteScale(inputScale.x), inputScaleY = finiteScale(inputScale.y);
        const textScaleX = scaleX * tooltipFont.scale, textScaleY = scaleY * tooltipFont.scale;
        const measure = (s: string) => (font?.measure(s) ?? s.length * 7) * textScaleX;
        const canvasW = renderer.canvas.width, canvasH = renderer.canvas.height;
        const rowHeight = 14 * textScaleY;
        const maxRows = Math.floor((canvasH - 32 * scaleY) / rowHeight);
        if (canvasW <= 4 || maxRows <= 0) return [];
        const visibleRows = rows.slice(0, maxRows);
        const lines = visibleRows.map(([label, value]) => `${label === "GE" ? "EX" : label}: ${value}`);
        const paddingX = 3 * scaleX;
        const width = Math.min(canvasW - 4, Math.max(1, ...lines.map((line) => measure(line))) + paddingX * 2);
        const height = 2 * scaleY + visibleRows.length * rowHeight;
        // The pointer and the hit rects are input-buffer pixels; the panel draws and clamps
        // in the overlay canvas, as do the already-rendered interaction bounds and the Item
        // Stats tooltip. They only differ when the overlay is larger than the input buffer
        // (a touch backing store capped below its DPR), so convert just the hit-test side.
        const rawPointer = this.pointer();
        const pointer = { x: rawPointer.x * inputScaleX, y: rawPointer.y * inputScaleY };
        const placementHover = { ...hover, ...scaleTooltipRect(hover, { x: inputScaleX, y: inputScaleY }) };
        const nativeBounds = this.interactionBounds ?? fallbackInteractionBounds(
            pointer.x, pointer.y, canvasW, canvasH, { x: scaleX, y: scaleY },
        );
        const obstacles = [nativeBounds, getItemStatsTooltipBounds(this.client)].filter(isRect);
        const { x, y } = placePanel(placementHover, pointer, width, height, canvasW, canvasH, obstacles, scaleX, scaleY);
        renderer.drawRect(x, y, width, height, TOOLTIP_BACKGROUND);
        const borderX = Math.min(scaleX, width);
        const borderY = Math.min(scaleY, height);
        renderer.drawRect(x, y, width, borderY, TOOLTIP_OUTLINE);
        renderer.drawRect(x, y + height - borderY, width, borderY, TOOLTIP_OUTLINE);
        renderer.drawRect(x, y + borderY, borderX, Math.max(0, height - borderY * 2), TOOLTIP_OUTLINE);
        renderer.drawRect(x + width - borderX, y + borderY, borderX, Math.max(0, height - borderY * 2), TOOLTIP_OUTLINE);
        lines.forEach((line, index) => {
            const rowY = y + scaleY + index * rowHeight;
            drawTextGL(renderer, fontLoader, line, x + paddingX, rowY,
                width - paddingX * 2, 12 * textScaleY, tooltipFont.id, WHITE, 0, 0, true, 1, undefined, textScaleX, textScaleY);
        });
        return [{ x, y, w: width, h: height }];
    }

    private pointer(): { x: number; y: number } {
        return { x: Number((this.client as any).inputManager?.mouseX) || 0, y: Number((this.client as any).inputManager?.mouseY) || 0 };
    }
}

function isRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
    const rect = value as any;
    return rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0;
}

function placePanel(
    item: HoveredItem,
    pointer: { x: number; y: number },
    width: number,
    height: number,
    canvasW: number,
    canvasH: number,
    obstacles: { x: number; y: number; w: number; h: number }[],
    scaleX: number,
    scaleY: number,
): { x: number; y: number } {
    const edgeX = 2 * scaleX, edgeY = 2 * scaleY, gapX = 8 * scaleX, gapY = 8 * scaleY;
    const clampX = (x: number) => Math.max(edgeX, Math.min(canvasW - width - edgeX, x));
    const clampY = (y: number) => Math.max(edgeY, Math.min(canvasH - height - edgeY, y));
    const xs = [pointer.x - width / 2, item.x + item.w + gapX, item.x - width - gapX, edgeX, canvasW - width - edgeX];
    const ys = [pointer.y + gapY, pointer.y - height - gapY, item.y, item.y - height - gapY,
        item.y + item.h + gapY, pointer.y - height / 2, edgeY, canvasH - height - edgeY];
    for (const rect of obstacles) {
        xs.push(rect.x + rect.w + gapX, rect.x - width - gapX);
        ys.push(rect.y - height - gapY, rect.y + rect.h + gapY);
    }
    const candidates = new Map<string, { x: number; y: number }>();
    for (const rawX of xs) for (const rawY of ys) {
        const x = clampX(rawX), y = clampY(rawY);
        candidates.set(`${x}:${y}`, { x, y });
    }
    const overlapArea = (a: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) =>
        Math.max(0, Math.min(a.x + width, b.x + b.w) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + height, b.y + b.h) - Math.max(a.y, b.y));
    const targetX = item.x + item.w / 2, targetY = item.y + item.h / 2;
    return [...candidates.values()].sort((a, b) => {
        const overlapA = obstacles.reduce((sum, obstacle) => sum + overlapArea(a, obstacle), 0);
        const overlapB = obstacles.reduce((sum, obstacle) => sum + overlapArea(b, obstacle), 0);
        if (overlapA !== overlapB) return overlapA - overlapB;
        const cursorClear = (candidate: { x: number; y: number }) =>
            candidate.y >= pointer.y + gapY || candidate.y + height <= pointer.y - gapY;
        const clearA = cursorClear(a), clearB = cursorClear(b);
        if (clearA !== clearB) return clearA ? -1 : 1;
        const cursorDistanceA = Math.hypot(a.x + width / 2 - pointer.x, a.y + height / 2 - pointer.y);
        const cursorDistanceB = Math.hypot(b.x + width / 2 - pointer.x, b.y + height / 2 - pointer.y);
        if (cursorDistanceA !== cursorDistanceB) return cursorDistanceA - cursorDistanceB;
        // Prefer below the cursor when both sides have equal clearance and distance.
        if (a.y !== b.y && (a.y >= pointer.y + gapY) !== (b.y >= pointer.y + gapY)) {
            return a.y >= pointer.y + gapY ? -1 : 1;
        }
        return Math.hypot(a.x + width / 2 - targetX, a.y + height / 2 - targetY) -
            Math.hypot(b.x + width / 2 - targetX, b.y + height / 2 - targetY);
    })[0];
}

function finiteScale(value: unknown): number {
    const scale = Number(value);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
