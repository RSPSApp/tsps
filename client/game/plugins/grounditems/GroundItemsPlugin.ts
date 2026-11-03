import type { ClientGroundItemStack, GroundItemMutation } from "../../data/ground/GroundItemStore";
import type { OsrsClient } from "../../OsrsClient";
import { ClientState } from "../../ClientState";
import { getClientCycle, getServerTickPhaseNow } from "../../../network/serverConnection/timing";
import { getItemPricesRevision, guidePrice } from "../../../network/serverConnection/domain/itemPrices";
import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Notifier } from "@runelite/client/Notifier";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { MenuTargetType } from "../../../rs/MenuEntry";
import { ObjStackability } from "../../../rs/config/objtype/ObjStackability";
import type { SimpleMenuEntry } from "../../../ui/menu/MenuEngine";
import type { MenuTransformContext } from "../../../ui/menu/menuTransforms";
import type { WidgetOverlay } from "../ClientPluginManager";
import { prependColorTag, stripTags, tagColorChoices, toCSV } from "../npcindicators/npcMatching";
import { GroundItemsConfig } from "./GroundItemsConfig";
import { GroundItemsInput } from "./GroundItemsInput";
import { GroundItemsOverlay } from "./GroundItemsOverlay";
import {
    COINS,
    type GroundItem,
    HIDDEN,
    HIGHLIGHTED,
    ItemList,
    NONE,
    PLATINUM_TOKEN,
    type RuleSettings,
    getHighlighted,
    isHidden,
    isHiddenOrHighlighted,
    itemColorOf,
    quantityToStackSize,
    shouldDisplayItem,
    splitList,
    stackGePrice,
    stackHaPrice,
    tierValue,
    valueByMode,
} from "./groundItemRules";
import { type LootbeamHost, Lootbeams } from "./lootbeams";

const GROUP = GroundItemsConfig.group;
/** Per-item colours (Shift + Examine, Color), RuneLite's "highlight_<itemId>". */
const ITEM_COLOR_PREFIX = "highlight_";
const TELEGRAB_TEXT = "Telekinetic Grab -> ";

/** An item's price facts, from its (unnoted) definition and the guide price table. */
type ItemFacts = { itemId: number; gePrice: number; haPrice: number; tradeable: boolean; stackable: boolean };

/** How an item is drawn, from the lists, tiers and per-item colour. */
export type Evaluation = { listResult: number; highlighted?: number; hidden: boolean; color: number };

/** A screen rectangle of the last draw, with the item it belongs to (the Alt mode boxes). */
export type ItemBox = { x: number; y: number; w: number; h: number; item: GroundItem };

/**
 * RuneLite 1.13.3 Ground Items: labels with prices and despawn timers, highlight and hidden
 * lists, value tiers, recoloured and collapsible menus, per-item colours, the Alt hotkey mode
 * with its list toggles, drop notifications and loot beams.
 */
export class GroundItemsPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Ground Items",
        description: "Highlight ground items and/or show price information",
        tags: ["grand", "exchange", "high", "alchemy", "prices", "highlight", "overlay"],
        enabledByDefault: false,
        configKey: "grounditemsplugin",
    };

    static config = GroundItemsConfig;

    private readonly configManager = inject(ConfigManager);
    readonly config = this.configManager.getConfig(GroundItemsConfig);
    private readonly osrsClient: OsrsClient;
    private readonly notifier: Notifier;
    readonly overlay: GroundItemsOverlay;
    readonly widgetOverlay: WidgetOverlay;
    readonly input: GroundItemsInput;
    readonly lootbeams = new Lootbeams();

    /** RuneLite's hotKeyPressed and hideAll (a double tap of the hotkey). */
    hotKeyPressed = false;
    hideAll = false;
    /** The Alt mode boxes under the mouse at the last draw. */
    textBox?: ItemBox;
    hiddenBox?: ItemBox;
    highlightBox?: ItemBox;

    private settings!: RuleSettings;
    private highlightedList = new ItemList("");
    private hiddenList = new ItemList("");
    private itemColors = new Map<number, number>();
    private settingsVersion = 0;

    /** collectedGroundItems: one item per tile and item id, in the order first seen. */
    private items = new Map<string, GroundItem>();
    private itemsBuiltFor = "";
    private readonly firstSeenTick = new Map<string, number>();
    private readonly facts = new Map<number, ItemFacts>();
    private factsPriceRevision = -1;
    private beamPriceRevision = -1;
    private pricesPending = false;
    private readonly evaluations = new Map<string, Evaluation>();
    /** The guide price of an unnoted item: 0 for no quote, undefined while the table loads. */
    guidePrice: (itemId: number) => number | undefined = guidePrice;

    private unsubscribeStore?: () => void;
    private readonly mutationListener = (event: GroundItemMutation) => this.onMutation(event);
    /** Stacks removed in the store update being applied (a snapshot re-adds them). */
    private readonly removedThisUpdate = new Set<number>();
    private readonly dirtyTiles = new Set<string>();

    constructor(osrsClient?: OsrsClient) {
        super();
        this.osrsClient = osrsClient ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.notifier = new Notifier(this.osrsClient);
        this.overlay = new GroundItemsOverlay(this);
        this.widgetOverlay = this.overlay;
        this.input = new GroundItemsInput(this);
        this.rebuildSettings();
    }

    getClient(): OsrsClient {
        return this.osrsClient;
    }

    protected async startUp(): Promise<void> {
        this.rebuildSettings();
        const store = this.osrsClient.groundItems;
        if (store) {
            store.mutationListeners.add(this.mutationListener);
            this.unsubscribeStore = store.subscribe(() => this.afterStoreUpdate());
        }
        this.input.start();
        this.itemsBuiltFor = "";
        this.handleLootbeams();
    }

    protected async shutDown(): Promise<void> {
        this.osrsClient.groundItems?.mutationListeners.delete(this.mutationListener);
        this.unsubscribeStore?.();
        this.unsubscribeStore = undefined;
        this.input.stop();
        this.lootbeams.clear();
        this.lootbeams.setHost(undefined);
        this.items.clear();
        this.itemsBuiltFor = "";
        this.firstSeenTick.clear();
        this.evaluations.clear();
        this.hotKeyPressed = false;
        this.hideAll = false;
        this.textBox = this.hiddenBox = this.highlightBox = undefined;
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== GROUP) return;
        this.rebuildSettings();
        this.handleLootbeams();
    }

    // ------------------------------------------------------------------ settings

    /** RuneLite's reset(): the lists, the value tiers and the per-item colours. */
    private rebuildSettings(): void {
        const c = this.config;
        this.highlightedList = new ItemList(String(c.highlightedItems() ?? ""));
        this.hiddenList = new ItemList(String(c.hiddenItems() ?? ""));
        const tiers = [
            { price: Number(c.insaneValuePrice()), color: Number(c.insaneValueColor()) >>> 0 },
            { price: Number(c.highValuePrice()), color: Number(c.highValueColor()) >>> 0 },
            { price: Number(c.mediumValuePrice()), color: Number(c.mediumValueColor()) >>> 0 },
            { price: Number(c.lowValuePrice()), color: Number(c.lowValueColor()) >>> 0 },
        ].filter((t) => t.price > 0).sort((a, b) => b.price - a.price);
        this.settings = {
            dontHideUntradeables: c.dontHideUntradeables() === true,
            hideUnderValue: Number(c.hideUnderValue()) || 0,
            valueCalculationMode: c.valueCalculationMode(),
            defaultColor: Number(c.defaultColor()) >>> 0,
            highlightedColor: Number(c.highlightedColor()) >>> 0,
            hiddenColor: Number(c.hiddenColor()) >>> 0,
            priceChecks: tiers,
        };
        this.itemColors.clear();
        for (const path of this.configManager.getConfigurationKeys(`${GROUP}.${ITEM_COLOR_PREFIX}`)) {
            const key = path.slice(GROUP.length + 1);
            const itemId = Number(key.slice(ITEM_COLOR_PREFIX.length));
            const color = parseArgb(this.configManager.getConfiguration(GROUP, key));
            if (Number.isInteger(itemId) && color !== undefined) this.itemColors.set(itemId, color);
        }
        this.settingsVersion++;
        this.evaluations.clear();
    }

    getSettings(): RuleSettings {
        return this.settings;
    }

    getSettingsVersion(): number {
        return this.settingsVersion;
    }

    itemColor(itemId: number): number | undefined {
        return this.itemColors.get(itemId);
    }

    // ------------------------------------------------------------------ items

    /** The item's prices and kind. GE is the guide price of the unnoted item (cache value until the table loads). */
    private itemFacts(id: number): ItemFacts {
        const revision = getItemPricesRevision();
        if (revision !== this.factsPriceRevision) {
            this.facts.clear();
            this.factsPriceRevision = revision;
        }
        const cached = this.facts.get(id);
        if (cached) return cached;
        let obj: any;
        try {
            obj = this.osrsClient.objTypeLoader?.load?.(id);
        } catch {}
        const noted = obj && obj.noteTemplate >= 0 && obj.note >= 0;
        const itemId = noted ? obj.note | 0 : id;
        let unnoted: any = obj;
        if (noted) {
            try {
                unnoted = this.osrsClient.objTypeLoader.load(itemId);
            } catch {}
        }
        const price = Math.max(0, Number(unnoted?.price ?? obj?.price ?? 0) | 0);
        let gePrice: number;
        let pending = false;
        if (itemId === COINS) gePrice = 1;
        else if (itemId === PLATINUM_TOKEN) gePrice = 1000;
        else {
            const guide = this.guidePrice(itemId);
            pending = guide === undefined;
            gePrice = guide ?? price;
        }
        const facts: ItemFacts = {
            itemId,
            gePrice,
            haPrice: itemId === COINS ? 1 : Math.floor(price * 0.6),
            tradeable: unnoted?.isTradable === true,
            stackable: obj?.stackability === ObjStackability.ALWAYS || noted === true,
        };
        if (pending) this.pricesPending = true;
        else this.facts.set(id, facts);
        return facts;
    }

    /** A ground item from one stack (as RuneLite's buildGroundItem). */
    private buildItem(stack: ClientGroundItemStack, key: string): GroundItem {
        const facts = this.itemFacts(stack.itemId);
        const tick = getServerTickPhaseNow().tick | 0;
        if (!this.firstSeenTick.has(key)) this.firstSeenTick.set(key, tick);
        return {
            key,
            id: stack.itemId | 0,
            itemId: facts.itemId,
            name: stack.name,
            quantity: Math.max(1, stack.quantity | 0),
            haPrice: facts.haPrice,
            gePrice: facts.gePrice,
            tradeable: facts.tradeable,
            stackable: facts.stackable,
            ownership: stack.ownership ?? 0,
            isPrivate: stack.isPrivate === true,
            tile: { x: stack.tile.x | 0, y: stack.tile.y | 0, level: stack.tile.level | 0 },
            despawnTick: stack.expiresTick,
            visibleTick: stack.privateUntilTick,
            spawnTick: stack.createdTick ?? this.firstSeenTick.get(key),
        };
    }

    /** The merged items, rebuilt when the store or the prices change. */
    groundItems(): Map<string, GroundItem> {
        const store = this.osrsClient.groundItems;
        if (!store) return this.items;
        const want = `${store.getVersion()}:${getItemPricesRevision()}`;
        if (want === this.itemsBuiltFor && !this.pricesPending) return this.items;
        this.pricesPending = false;
        const next = new Map<string, GroundItem>();
        for (const stack of store.getAllStacks()) {
            const key = itemKey(stack.tile.x, stack.tile.y, stack.tile.level, stack.itemId);
            const existing = next.get(key);
            if (existing) {
                // The quantities add up; the first stack's spawn stays, the earliest despawn wins.
                existing.quantity += Math.max(1, stack.quantity | 0);
                if (stack.expiresTick !== undefined && (existing.despawnTick === undefined || stack.expiresTick < existing.despawnTick)) {
                    existing.despawnTick = stack.expiresTick;
                }
            } else {
                next.set(key, this.buildItem(stack, key));
            }
        }
        for (const key of this.firstSeenTick.keys()) if (!next.has(key)) this.firstSeenTick.delete(key);
        this.items = next;
        this.itemsBuiltFor = want;
        this.evaluations.clear();
        return next;
    }

    groundItemAt(x: number, y: number, level: number, id: number): GroundItem | undefined {
        return this.groundItems().get(itemKey(x, y, level, id));
    }

    /** The highlight, hidden state and colour of an item (cached until the items or settings change). */
    evaluate(item: GroundItem): Evaluation {
        const cached = this.evaluations.get(item.key);
        if (cached) return cached;
        const listResult = isHiddenOrHighlighted(item, this.highlightedList, this.hiddenList);
        const highlighted = getHighlighted(item, listResult, this.settings, this.itemColors.get(item.itemId));
        const hidden = isHidden(item, listResult, this.settings);
        const evaluation: Evaluation = { listResult, highlighted, hidden, color: itemColorOf(highlighted, hidden, this.settings) };
        this.evaluations.set(item.key, evaluation);
        return evaluation;
    }

    playerTile(): { x: number; y: number; level: number; fineX: number; fineY: number } | undefined {
        const client: any = this.osrsClient;
        const players = client.playerEcs;
        const index = players?.getIndexForServerId?.(client.controlledPlayerServerId);
        if (index === undefined) return undefined;
        const fineX = players.getX(index);
        const fineY = players.getY(index);
        return { x: fineX >> 7, y: fineY >> 7, level: players.getLevel(index) | 0, fineX, fineY };
    }

    accountType(): number {
        try {
            return this.osrsClient.getLocalAccountType() | 0;
        } catch {
            return 0;
        }
    }

    displaysOwnership(item: GroundItem): boolean {
        return shouldDisplayItem(this.config.ownershipFilterMode(), item.ownership, this.accountType());
    }

    // ------------------------------------------------------------------ lists

    /** updateList: toggles a name in one list, taking it out of the other. */
    updateList(name: string, hiddenList: boolean): void {
        const hidden = splitList(String(this.config.hiddenItems() ?? ""));
        const highlighted = splitList(String(this.config.highlightedItems() ?? ""));
        const same = (s: string) => s.toLowerCase() === name.toLowerCase();
        const other = hiddenList ? highlighted : hidden;
        const list = hiddenList ? hidden : highlighted;
        removeIf(other, same);
        if (!removeIf(list, same)) list.push(name);
        this.configManager.setConfigValue(GroundItemsConfig, "hiddenItems", toCSV(hidden));
        this.configManager.setConfigValue(GroundItemsConfig, "highlightedItems", toCSV(highlighted));
    }

    setItemColor(itemId: number, argb?: number): void {
        const key = ITEM_COLOR_PREFIX + itemId;
        if (argb === undefined) this.configManager.unsetConfiguration(GROUP, key);
        else this.configManager.setConfiguration(GROUP, key, `#${(argb >>> 0).toString(16).padStart(8, "0")}`);
    }

    /** RuneLite opens a colour chooser; here it is the browser's, keeping the colour's alpha. */
    private pickItemColor(itemId: number): void {
        if (typeof document === "undefined") return;
        document.querySelectorAll("input[data-ground-item-picker]").forEach((old) => old.remove());
        const current = this.itemColors.get(itemId) ?? this.settings.highlightedColor;
        const input = document.createElement("input");
        input.type = "color";
        input.dataset.groundItemPicker = "";
        input.value = `#${(current & 0xffffff).toString(16).padStart(6, "0")}`;
        Object.assign(input.style, { position: "fixed", left: "-100px", top: "0", opacity: "0", pointerEvents: "none" });
        input.addEventListener("change", () => {
            const rgb = parseInt(input.value.slice(1), 16);
            if (Number.isInteger(rgb)) this.setItemColor(itemId, ((current & 0xff000000) | rgb) >>> 0);
            input.remove();
        }, { once: true });
        document.body.appendChild(input);
        input.click();
    }

    // ------------------------------------------------------------------ menus

    /** Hidden, unhighlighted items need a right-click to take (deprioritizeHiddenItems). */
    deprioritizeGroundItem(stack: ClientGroundItemStack): boolean {
        if (!this.isStarted() || !this.config.deprioritizeHiddenItems()) return false;
        const item = this.groundItemAt(stack.tile.x, stack.tile.y, stack.tile.level, stack.itemId);
        if (!item) return false;
        const e = this.evaluate(item);
        return e.hidden && e.highlighted === undefined;
    }

    transformMenuEntries(entries: SimpleMenuEntry[], context: MenuTransformContext): SimpleMenuEntry[] {
        if (!this.isStarted() || context.surface !== "world") return entries;
        const player = this.playerTile();
        const level = player?.level ?? 0;
        const mode = this.config.itemHighlightMode();
        const menuMode = this.config.menuHighlightMode();
        const showQuantities = this.config.showMenuItemQuantities() === true;
        const recolorHidden = this.config.recolorMenuHiddenItems() === true;
        let out: SimpleMenuEntry[] | undefined;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (entry.targetType !== MenuTargetType.OBJ || typeof entry.targetId !== "number") continue;
            const take = entry.actionIndex === 2 && entry.option !== "Use";
            const telegrab = entry.option === "Cast" && stripTags(String(entry.target ?? "")).startsWith(TELEGRAB_TEXT);
            if (!take && !telegrab) continue;
            const item = this.menuItem(entry, level);
            if (!item) continue;
            const e = this.evaluate(item);
            let option = entry.option;
            let target = String(entry.target ?? "");
            const canBeRecolored = e.highlighted !== undefined || (e.hidden && recolorHidden);
            if (mode !== "OVERLAY" && mode !== "NONE" && canBeRecolored && e.color !== this.settings.defaultColor) {
                if (menuMode === "BOTH" || menuMode === "OPTION") option = prependColorTag(telegrab ? "Cast" : "Take", e.color);
                if (menuMode === "BOTH" || menuMode === "NAME") {
                    const split = telegrab ? target.lastIndexOf("-> ") + 3 : 0;
                    const prefix = target.slice(0, split);
                    const rest = target.slice(split);
                    target = prefix + prependColorTag(rest.slice(rest.indexOf(">") + 1), e.color);
                }
            }
            if (showQuantities && item.stackable && item.quantity > 1) target += ` (${item.quantity})`;
            if (option !== entry.option || target !== entry.target) {
                out ??= entries.slice();
                out[i] = { ...entry, option, target };
            }
        }

        let list = out ?? entries;
        if (context.menu && this.config.collapseEntries()) list = collapse(list);
        if (context.menu && ClientState.isShiftPressed()) list = this.withColorMenus(list, level);
        return list;
    }

    private menuItem(entry: SimpleMenuEntry, level: number): GroundItem | undefined {
        const x = (ClientState.baseX | 0) + (entry.mapX ?? 0);
        const y = (ClientState.baseY | 0) + (entry.mapY ?? 0);
        const id = entry.targetId as number;
        return this.groundItemAt(x, y, level, id) ?? [0, 1, 2, 3].map((l) => this.groundItemAt(x, y, l, id)).find(Boolean);
    }

    /** Shift + right-click Examine on a ground item: the Color submenu. */
    private withColorMenus(entries: SimpleMenuEntry[], level: number): SimpleMenuEntry[] {
        let out: SimpleMenuEntry[] | undefined;
        for (let i = 0; i < (out ?? entries).length; i++) {
            const list = out ?? entries;
            const entry = list[i];
            if (entry.targetType !== MenuTargetType.OBJ || entry.option !== "Examine") continue;
            const item = this.menuItem(entry, level);
            if (!item) continue;
            const itemId = item.itemId;
            const current = this.itemColors.get(itemId);
            const inUse: number[] = [];
            for (const other of this.groundItems().values()) {
                const color = this.itemColors.get(other.itemId);
                if (color !== undefined) inUse.push(color);
            }
            const sub: SimpleMenuEntry[] = [];
            if (current !== undefined) sub.push({ option: "Reset", target: "", onClick: () => this.setItemColor(itemId) });
            sub.push({ option: "Pick", target: "", onClick: () => this.pickItemColor(itemId) });
            for (const rgb of tagColorChoices(inUse)) {
                sub.push({ option: prependColorTag("Color", rgb), target: "", onClick: () => this.setItemColor(itemId, (0xff000000 | rgb) >>> 0) });
            }
            out = list.slice();
            out.splice(i, 0, { option: "Color", target: entry.target, targetType: MenuTargetType.NONE, onClick: () => {}, subEntries: sub });
            i++;
        }
        return out ?? entries;
    }

    // ------------------------------------------------------------------ spawns, notifications, beams

    private onMutation(event: GroundItemMutation): void {
        const { stack } = event;
        this.dirtyTiles.add(tileKey(stack.tile.x, stack.tile.y, stack.tile.level));
        if (event.kind === "despawn") {
            this.removedThisUpdate.add(stack.id);
            return;
        }
        // A snapshot takes every stack away and puts it back: only a new stack is a drop.
        if (event.kind === "spawn" && !this.removedThisUpdate.has(stack.id)) this.notifyHighlightedItem(stack);
    }

    private afterStoreUpdate(): void {
        this.removedThisUpdate.clear();
        if (this.dirtyTiles.size === 0) return;
        const tiles = [...this.dirtyTiles];
        this.dirtyTiles.clear();
        this.groundItems();
        for (const key of tiles) this.handleLootbeam(key);
    }

    /** notifyHighlightedItem: a highlighted drop, or one over the notify tier that is not hidden. */
    private notifyHighlightedItem(stack: ClientGroundItemStack): void {
        const c = this.config;
        const notifyHighlighted = c.notifyHighlightedDrops() === true;
        const tier = c.notifyTier();
        if (!notifyHighlighted && tier === "OFF") return;
        const item = this.buildItem(stack, itemKey(stack.tile.x, stack.tile.y, stack.tile.level, stack.itemId));
        if (!this.displaysOwnership(item)) return;
        const isHighlighted = this.highlightedList.matches(item.name, item.quantity) !== NONE;
        const isHiddenListed = this.hiddenList.matches(item.name, item.quantity) !== NONE;
        const tierPrice = tierValue(tier, this.tierPrices());
        const value = valueByMode(this.settings.valueCalculationMode, stackGePrice(item), stackHaPrice(item));
        let dropType: string;
        if (notifyHighlighted && isHighlighted) dropType = "highlighted";
        else if (tierPrice !== undefined && value > tierPrice && !isHiddenListed) dropType = "valuable";
        else return;
        let message = `You received a ${dropType} drop: ${item.name}`;
        if (item.quantity > 1) message += ` (${quantityToStackSize(item.quantity)})`;
        this.notifier.notify(message);
    }

    private tierPrices() {
        const c = this.config;
        return {
            low: Number(c.lowValuePrice()),
            medium: Number(c.mediumValuePrice()),
            high: Number(c.highValuePrice()),
            insane: Number(c.insaneValuePrice()),
        };
    }

    private lootbeamHost(): LootbeamHost | undefined {
        const renderer: any = (this.osrsClient as any).renderer;
        if (!renderer?.registerWorldSpotAnimation) return undefined;
        return {
            spawn: (spotId, tile) => renderer.registerWorldSpotAnimation({ spotId, tile, startCycle: getClientCycle() | 0, loop: true }),
            kill: (id) => renderer.killWorldSpotAnimation?.(id),
        };
    }

    /** Beams draw through the current renderer (switching renderers puts them back). */
    refreshLootbeamHost(): void {
        const renderer = (this.osrsClient as any).renderer;
        if (renderer !== this.beamRenderer) {
            this.beamRenderer = renderer;
            this.lootbeams.setHost(this.lootbeamHost());
        }
    }
    private beamRenderer: unknown;

    private handleLootbeams(): void {
        if (!this.isStarted()) return;
        const tiles = new Set<string>(this.lootbeams.keys());
        for (const item of this.groundItems().values()) tiles.add(tileKey(item.tile.x, item.tile.y, item.tile.level));
        for (const key of tiles) this.handleLootbeam(key);
    }

    /** handleLootbeam: a highlighted item's beam first, else the tile's best value over the beam tier. */
    private handleLootbeam(key: string): void {
        if (!this.isStarted()) return;
        this.refreshLootbeamHost();
        const c = this.config;
        const forHighlighted = c.showLootbeamForHighlighted() === true;
        const tier = c.showLootbeamTier();
        if (!forHighlighted && tier === "OFF") {
            this.lootbeams.remove(key);
            return;
        }
        const [x, y, level] = key.split("|").map(Number);
        const tile = { x, y, level };
        const style = c.lootbeamStyle();
        let price = -1;
        for (const item of this.groundItems().values()) {
            if (item.tile.x !== x || item.tile.y !== y || item.tile.level !== level) continue;
            if (!this.displaysOwnership(item)) continue;
            const listResult = isHiddenOrHighlighted(item, this.highlightedList, this.hiddenList);
            if (forHighlighted && listResult === HIGHLIGHTED) {
                this.lootbeams.set(key, tile, this.itemColors.get(item.itemId) ?? this.settings.highlightedColor, style);
                return;
            }
            // An explicit hide wins over a value highlight.
            if (listResult === HIDDEN) continue;
            price = Math.max(price, valueByMode(this.settings.valueCalculationMode, stackGePrice(item), stackHaPrice(item)));
        }
        const tierPrice = tierValue(tier, this.tierPrices());
        if (tierPrice !== undefined) {
            for (const check of this.settings.priceChecks) {
                if (price > check.price && price > tierPrice) {
                    this.lootbeams.set(key, tile, check.color, style);
                    return;
                }
            }
        }
        this.lootbeams.remove(key);
    }

    onGameTick(): void {
        if (!this.isStarted()) return;
        // A renderer switch drops its graphics; the beams follow the new one.
        this.refreshLootbeamHost();
        const revision = getItemPricesRevision();
        if (revision !== this.beamPriceRevision) {
            this.beamPriceRevision = revision;
            this.handleLootbeams();
        }
    }
}

export function itemKey(x: number, y: number, level: number, id: number): string {
    return `${x | 0}|${y | 0}|${level | 0}|${id | 0}`;
}

export function tileKey(x: number, y: number, level: number): string {
    return `${x | 0}|${y | 0}|${level | 0}`;
}

/** A saved colour: "#AARRGGBB", or "#RRGGBB" as opaque. */
function parseArgb(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const hex = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/^[0-9a-f]{6}$/i.test(hex)) return (0xff000000 | parseInt(hex, 16)) >>> 0;
    if (/^[0-9a-f]{8}$/i.test(hex)) return parseInt(hex, 16) >>> 0;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric >>> 0 : undefined;
}

function removeIf(list: string[], test: (s: string) => boolean): boolean {
    let removed = false;
    for (let i = list.length - 1; i >= 0; i--) {
        if (test(list[i])) {
            list.splice(i, 1);
            removed = true;
        }
    }
    return removed;
}

/** collapseMenu: identical ground item entries become one, with " x N" on the target. */
export function collapse(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
    const kept: { entry: SimpleMenuEntry; count: number }[] = [];
    for (const entry of entries) {
        const collapsible = entry.targetType === MenuTargetType.OBJ && entry.option !== "Use" && entry.option !== "Cast";
        const same = collapsible
            ? kept.find((k) => k.entry.targetType === MenuTargetType.OBJ && k.entry.option === entry.option
                && k.entry.target === entry.target && k.entry.targetId === entry.targetId
                && k.entry.mapX === entry.mapX && k.entry.mapY === entry.mapY)
            : undefined;
        if (same) same.count++;
        else kept.push({ entry, count: 1 });
    }
    if (kept.length === entries.length) return entries;
    return kept.map(({ entry, count }) => (count > 1 ? { ...entry, target: `${entry.target ?? ""} x ${count}` } : entry));
}
