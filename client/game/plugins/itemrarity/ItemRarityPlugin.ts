import { GameState } from "@runelite/api/GameState";
import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { BANKMAIN, INVENTORY, WORNITEMS } from "../../../runelite/api/gameval/InterfaceID";
import { getItemPricesRevision, guidePrice } from "../../../network/serverConnection/domain/itemPrices";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { canonicalItemId, colorHex, tagSpriteRgba } from "../inventorytags/inventoryTags";
import { ItemRarityConfig, itemRarity, normalizeThreshold, type RarityTier, type RarityThresholds } from "./ItemRarityConfig";

type RarityItem = { itemId: number; quantity: number; color: number; x: number; y: number; w: number; h: number };
const GROUPS = [INVENTORY, WORNITEMS, BANKMAIN] as const;
const MAX_TEXTURES = 512;
const PREFIX = "itemrarity:";

/** Outlines inventory, equipment and bank items by their current TSPS guide-price tier. */
export class ItemRarityPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Item Rarity",
        description: "Outline inventory, equipment and bank items by guide price",
        tags: ["items", "price", "rarity", "outline"],
        enabledByDefault: false,
        configKey: "itemrarityplugin",
    };
    static config = ItemRarityConfig;

    private readonly configManager = inject(ConfigManager);
    private readonly config = this.configManager.getConfig(ItemRarityConfig);
    private readonly client: OsrsClient;
    private readonly textureKeys = new Set<string>();
    private textureRenderer?: WidgetOverlayDrawContext["renderer"];
    private items: RarityItem[] = [];
    private signatureValue = "";

    readonly widgetOverlay: WidgetOverlay = {
        signature: () => this.snapshot(),
        draw: (context) => this.draw(context),
    };

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
    }

    protected async startUp(): Promise<void> {
        this.snapshot();
    }

    protected async shutDown(): Promise<void> {
        this.releaseTextures();
        this.items = [];
        this.signatureValue = "";
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== ItemRarityConfig.group) return;
        this.signatureValue = "";
    }

    getThresholds(): RarityThresholds {
        const c = this.config;
        return {
            minimum: normalizeThreshold(c.minimumPrice(), 1),
            common: normalizeThreshold(c.commonPrice(), 10_000),
            uncommon: normalizeThreshold(c.uncommonPrice(), 100_000),
            rare: normalizeThreshold(c.rarePrice(), 1_000_000),
            veryRare: normalizeThreshold(c.veryRarePrice(), 10_000_000),
        };
    }

    private colors(): Record<RarityTier, number> {
        const c = this.config;
        return {
            COMMON: Number(c.commonColor()) >>> 0,
            UNCOMMON: Number(c.uncommonColor()) >>> 0,
            RARE: Number(c.rareColor()) >>> 0,
            VERY_RARE: Number(c.veryRareColor()) >>> 0,
            LEGENDARY: Number(c.legendaryColor()) >>> 0,
        };
    }

    private price(itemId: number): number {
        const loader: any = (this.client as any).objTypeLoader;
        try { itemId = canonicalItemId(itemId, (id) => loader?.load?.(id)); } catch {}
        const quoted = guidePrice(itemId);
        return quoted === undefined || quoted <= 0 ? Number.NaN : Math.max(0, Math.floor(Number(quoted)));
    }

    private snapshot(): string {
        const client: any = this.client;
        const manager = client?.widgetManager;
        const menuOpen = client.menuOpen;
        if (!this.isStarted() || !manager || client.gameState !== GameState.LOGGED_IN || menuOpen) {
            this.items = [];
            return this.signatureValue = "";
        }
        const enabled = [this.config.showInventory(), this.config.showEquipment(), this.config.showBank()];
        const groups = GROUPS.filter((_, i) => enabled[i] === true);
        const items: RarityItem[] = [];
        const seen = new Set<any>();
        const visit = (widget: any, hidden: boolean): void => {
            if (!widget || seen.has(widget)) return;
            seen.add(widget);
            const isHidden = hidden || widget.hidden === true || widget.isHidden === true;
            if (isHidden) return;
            const itemId = Number.isInteger(widget.itemId) ? widget.itemId : -1;
            if (itemId >= 0) {
                const tier = itemRarity(this.price(itemId), this.getThresholds());
                const { _absX: x, _absY: y, _absWidth: w, _absHeight: h } = widget;
                if (tier && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
                    items.push({ itemId, quantity: Math.max(1, widget.itemQuantity | 0), color: this.colors()[tier], x, y, w, h });
                }
            }
            for (const child of widget.children ?? []) visit(child, isHidden);
        };
        for (const group of groups) {
            for (const widget of manager.getWidgetsForGroup?.(group) ?? []) {
                if (typeof widget?.uid === "number" && manager.isEffectivelyHidden?.(widget.uid)) continue;
                visit(widget, false);
            }
        }
        this.items = items;
        return this.signatureValue = JSON.stringify([getItemPricesRevision(), this.getThresholds(), this.colors(), items]);
    }

    private draw(context: WidgetOverlayDrawContext): { x: number; y: number; w: number; h: number }[] {
        const signature = this.snapshot();
        if (!signature) return [];
        const { renderer } = context;
        if (this.textureRenderer !== renderer) {
            this.textureKeys.clear();
            this.textureRenderer = renderer;
        }
        const rects = [];
        for (const item of this.items) {
            const alpha = item.color >>> 24;
            const key = `${PREFIX}${item.itemId}:${item.quantity}:${colorHex(item.color)}:${alpha}`;
            let texture = renderer.getTexture(key);
            if (!texture) {
                const source = context.itemImage?.(item.itemId, item.quantity, 1);
                const pixels = source && alphaPixels(source);
                if (source && pixels && typeof document !== "undefined") {
                    const canvas = document.createElement("canvas");
                    canvas.width = source.width;
                    canvas.height = source.height;
                    const ctx = canvas.getContext("2d");
                    if (ctx) {
                        const image = ctx.createImageData(source.width, source.height);
                        image.data.set(tagSpriteRgba(pixels, source.width, source.height, "outline", item.color, alpha));
                        ctx.putImageData(image, 0, 0);
                        if (this.textureKeys.size >= MAX_TEXTURES) this.releaseTextures();
                        this.textureKeys.add(key);
                        texture = renderer.createTextureFromCanvas(key, canvas);
                    }
                }
            }
            if (texture) renderer.drawTexture(texture, item.x, item.y, item.w, item.h);
            rects.push({ x: item.x, y: item.y, w: item.w, h: item.h });
        }
        return rects;
    }

    private releaseTextures(): void {
        for (const key of this.textureKeys) this.textureRenderer?.deleteTexture(key);
        this.textureKeys.clear();
    }
}

function alphaPixels(source: HTMLCanvasElement): Int32Array | undefined {
    const data = source.getContext("2d")?.getImageData(0, 0, source.width, source.height).data;
    if (!data) return undefined;
    const pixels = new Int32Array(source.width * source.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4 + 3] === 0 ? 0 : 1;
    return pixels;
}
