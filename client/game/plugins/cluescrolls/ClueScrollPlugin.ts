/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { ChatMessageType } from "@runelite/api/ChatMessageType";
import type { NPC } from "@runelite/api/Client";
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import * as EnumID from "@runelite/api/EnumID";
import type { ChatMessage, CommandExecuted, ConfigChanged, GameStateChanged, ItemContainerChanged, NpcDespawned, NpcSpawned, WidgetLoaded } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import * as ItemID from "@runelite/api/gameval/ItemID";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { Item } from "@runelite/api/Item";
import * as ParamID from "@runelite/api/ParamID";
import * as ScriptID from "@runelite/api/ScriptID";
import type { Widget } from "@runelite/api/widgets/Widget";
import type { Graphics2D } from "@runelite/awt/Graphics2D";
import { Rectangle } from "@runelite/awt/Shapes";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { TextComponent } from "@runelite/client/ui/overlay/components/TextComponent";
import { OverlayUtil } from "@runelite/client/ui/overlay/OverlayUtil";
import { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { Text } from "@runelite/client/util/Text";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import type { MenuActionData } from "../../../ui/menu/menuEvents";
import type { OsrsClient } from "../../OsrsClient";
import { ClientState } from "../../ClientState";
import type { WidgetOverlay } from "../ClientPluginManager";
import { CLICKBOX_BORDER_COLOR, CLICKBOX_FILL_COLOR, CLICKBOX_HOVER_BORDER_COLOR } from "./ClueScrollColors";
import { BankTagsPlugin } from "../banktags/BankTagsPlugin";
import type { TagManager } from "../banktags/TagManager";
import { registerClueTags, testClueTag, unregisterClueTags } from "./ClueScrollBankTags";
import { ClueScrollConfig, type IdentificationMode } from "./ClueScrollConfig";
import { ClueScrollEmoteOverlay } from "./ClueScrollEmoteOverlay";
import { ClueScrollImages } from "./ClueScrollImages";
import { ClueScrollMusicOverlay } from "./ClueScrollMusicOverlay";
import { ClueScrollOverlay } from "./ClueScrollOverlay";
import { ClueScrollWorldOverlay } from "./ClueScrollWorldOverlay";
import { OBJECTBOX_ITEM, TRAIL_CLUETEXT_TEXT, TRAIL_MAP_FIRST, TRAIL_MAP_LAST } from "./ClueScrollInterfaces";
import { findClueScrollForItem, findClueScrollForText, findNpcChatClueScroll } from "./ClueScrollLookup";
import { ClueScrollNotes } from "./ClueScrollNotes";
import { checkClueNamedObjects, checkClueNPCs, highlightObjectsForLocation } from "./ClueScrollScene";
import { ClueScrollWorldMapPoint } from "./ClueScrollWorldMapPoint";
import { BeginnerMapClue } from "./clues/BeginnerMapClue";
import type { ClueScroll } from "./clues/ClueScroll";
import { isLocationClueScroll, isLocationsClueScroll, isObjectClueScroll, locationClueLocations } from "./clues/ClueScrollTypes";
import { EmoteClue } from "./clues/EmoteClue";
import { HotColdClue } from "./clues/HotColdClue";
import { SkillChallengeClue } from "./clues/SkillChallengeClue";
import { ThreeStepCrypticClue } from "./clues/ThreeStepCrypticClue";
import type { TileObject } from "./clues/TileObject";

const RUNEPOUCH_AMOUNT_VARBITS = [VarbitID.RUNE_POUCH_QUANTITY_1, VarbitID.RUNE_POUCH_QUANTITY_2, VarbitID.RUNE_POUCH_QUANTITY_3, VarbitID.RUNE_POUCH_QUANTITY_4];
const RUNEPOUCH_RUNE_VARBITS = [VarbitID.RUNE_POUCH_TYPE_1, VarbitID.RUNE_POUCH_TYPE_2, VarbitID.RUNE_POUCH_TYPE_3, VarbitID.RUNE_POUCH_TYPE_4];
const RUNE_POUCHES = [ItemID.BH_RUNE_POUCH, ItemID.BH_RUNE_POUCH_TROUVER, ItemID.DIVINE_RUNE_POUCH, ItemID.DIVINE_RUNE_POUCH_TROUVER];

/** RuneLite's developerMode: the `::clue` command exists in development builds only. */
const DEVELOPER_MODE = typeof process !== "undefined" ? process.env?.NODE_ENV !== "production" : false;

/** What a test hands the plugin instead of the injector's singletons. */
export type ClueScrollPluginDeps = {
    client?: OsrsClient;
    configManager?: ConfigManager;
    chatboxPanelManager?: ChatboxPanelManager;
    tagManager?: TagManager;
    worldMapPointManager?: WorldMapPointManager;
};

/** A "Set note" entry the overlay offers while a clue is active. */
export type NoteMenuEntry = { option: string; onClick: () => void };

/**
 * RuneLite 1.13.6 Clue Scroll. Identifies the clue a player reads (or picks up, per config) and
 * shows its solution: an overlay panel, world highlights and hint arrows, emote and music tab
 * highlights, world map points, hot-cold narrowing, three-step tracking, notes and bank tags.
 */
export class ClueScrollPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Clue Scroll",
        description: "Show answers to clue scroll riddles, anagrams, ciphers, and cryptic clues",
        tags: ["arrow", "hints", "world", "map", "coordinates", "emotes"],
        enabledByDefault: false,
        configKey: "cluescrollplugin",
    };

    static config = ClueScrollConfig;

    readonly osrsClient: OsrsClient;
    /** RuneLite's `Client` facade over the engine. */
    readonly client: ClientImpl;
    readonly configManager: ConfigManager;
    readonly config: ReturnType<ConfigManager["getConfig"]>;
    readonly chatboxPanelManager: ChatboxPanelManager;
    readonly worldMapPointManager: WorldMapPointManager;
    readonly notes: ClueScrollNotes;
    private readonly tagManagerOverride?: TagManager;
    private registeredTags?: TagManager;
    private readonly images = new ClueScrollImages();
    private readonly textComponent = new TextComponent();
    private readonly clueScrollOverlay = new ClueScrollOverlay(this);
    private readonly clueScrollEmoteOverlay = new ClueScrollEmoteOverlay(this);
    private readonly clueScrollWorldOverlay = new ClueScrollWorldOverlay(this);
    private readonly clueScrollMusicOverlay = new ClueScrollMusicOverlay(this);

    private clue: ClueScroll | null = null;
    private readonly npcsToMark: NPC[] = [];
    private readonly objectsToMark: TileObject[] = [];
    private readonly namedObjectsToMark = new Set<TileObject>();
    private equippedItems: Item[] | null = null;
    private inventoryItems: Item[] | null = null;
    private clueItemId: number | null = null;
    private worldMapPointsSet = false;
    /** Objects on a new plane only show their active form a tick after the varbits land. */
    private currentPlane = -1;
    private currentBaseX = -1;
    private currentBaseY = -1;
    private namedObjectCheckThisTick = false;
    /** The clue text interface opened this tick; its text is read on the game tick. */
    private clueTextToRead = false;
    private activeSTASHClue: EmoteClue | null = null;
    private clickedSTASHClue: EmoteClue | null = null;
    private noteEntries: NoteMenuEntry[] = [];

    constructor(deps?: ClueScrollPluginDeps) {
        super();
        this.osrsClient = deps?.client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = new ClientImpl(this.osrsClient);
        this.configManager = deps?.configManager ?? inject(ConfigManager);
        this.config = this.configManager.getConfig(ClueScrollConfig);
        this.chatboxPanelManager = deps?.chatboxPanelManager ?? inject(ChatboxPanelManager);
        this.worldMapPointManager = deps?.worldMapPointManager ?? inject(WorldMapPointManager);
        this.notes = new ClueScrollNotes(this.configManager, this.chatboxPanelManager);
        this.tagManagerOverride = deps?.tagManager;
    }

    // ------------------------------------------------------------------ accessors

    getClient(): ClientImpl {
        return this.client;
    }

    getClue(): ClueScroll | null {
        return this.clue;
    }

    getNpcsToMark(): NPC[] {
        return this.npcsToMark;
    }

    getObjectsToMark(): TileObject[] {
        return this.objectsToMark;
    }

    getNamedObjectsToMark(): Set<TileObject> {
        return this.namedObjectsToMark;
    }

    getInventoryItems(): Item[] | null {
        return this.inventoryItems;
    }

    getEquippedItems(): Item[] | null {
        return this.equippedItems;
    }

    getActiveSTASHClue(): EmoteClue | null {
        return this.activeSTASHClue;
    }

    getWorldMapPointManager(): WorldMapPointManager {
        return this.worldMapPointManager;
    }

    getClueNote(key: number): string | null {
        return this.notes.getClueNote(key);
    }

    /** The overlay's "Set note" entries for the active clue (RuneLite's updateOverlayMenuEntries). */
    getNoteEntries(): NoteMenuEntry[] {
        return this.noteEntries;
    }

    displayHintArrows(): boolean {
        return this.config.displayHintArrows() === true;
    }

    identificationMode(): IdentificationMode {
        const value = String(this.config.identify());
        return value === "IF_INACTIVE" || value === "ON_PICKUP" ? value : "ON_READ";
    }

    getClueScrollImage(): HTMLCanvasElement | null {
        return this.images.clueScroll();
    }

    getSpadeImage(): HTMLCanvasElement | null {
        return this.images.spade();
    }

    getEmoteImage(): HTMLCanvasElement | null {
        return this.images.emote();
    }

    getMapArrow(): HTMLCanvasElement | null {
        return this.images.mapArrow();
    }

    /** The item image renderer, from the overlay draw context once it has drawn. */
    setItemImageSource(itemImage: ClueScrollImages["itemImage"]): void {
        this.images.itemImage = itemImage;
    }

    // ------------------------------------------------------------------ overlays

    /** RuneLite's overlayManager.add(...) for the four overlays, while the plugin runs. */
    widgetOverlays(): WidgetOverlay[] {
        if (!this.isStarted()) return [];
        return [this.clueScrollOverlay, this.clueScrollEmoteOverlay, this.clueScrollWorldOverlay, this.clueScrollMusicOverlay];
    }

    /**
     * Outlines the visible part of a widget inside its scrolling container, with an optional label
     * centred above it (RuneLite's highlightWidget).
     */
    highlightWidget(graphics: Graphics2D, toHighlight: Widget, container: Widget, padding: Rectangle | null, text: string | null): void {
        padding = padding ?? new Rectangle();
        const canvasLocation = toHighlight.getCanvasLocation();
        if (canvasLocation === null) return;
        const windowLocation = container.getCanvasLocation();
        if (windowLocation === null) return;
        if (windowLocation.y > canvasLocation.y + toHighlight.getHeight() || windowLocation.y + container.getHeight() < canvasLocation.y) return;

        // Visible area of widget
        const widgetArea = new Rectangle(
            canvasLocation.x - padding.x,
            Math.max(canvasLocation.y, windowLocation.y) - padding.y,
            toHighlight.getWidth() + padding.x + padding.width,
            Math.min(
                Math.min(windowLocation.y + container.getHeight() - canvasLocation.y, toHighlight.getHeight()),
                Math.min(canvasLocation.y + toHighlight.getHeight() - windowLocation.y, toHighlight.getHeight()),
            ) + padding.y + padding.height,
        );

        OverlayUtil.renderHoverableArea(graphics, widgetArea, this.client.getMouseCanvasPosition(),
            CLICKBOX_FILL_COLOR, CLICKBOX_BORDER_COLOR, CLICKBOX_HOVER_BORDER_COLOR);

        if (text === null) return;
        const fontMetrics = graphics.getFontMetrics();
        this.textComponent.setPosition(
            canvasLocation.x + Math.trunc(toHighlight.getWidth() / 2) - Math.trunc(fontMetrics.stringWidth(text) / 2),
            canvasLocation.y + fontMetrics.getHeight(),
        );
        this.textComponent.setText(text);
        this.textComponent.render(graphics);
    }

    /**
     * Scrolls a list so the given widgets' average centre is in view (RuneLite's scrollToWidget).
     * False when the scroll could not run (nothing to scroll to, or the client script VM is busy
     * this frame), so the caller can try again next frame.
     */
    scrollToWidget(list: number, scrollbar: number, ...toHighlight: Array<Widget | null>): boolean {
        const parent = this.client.getWidget(list);
        if (parent === null) return false;
        let averageCentralY = 0;
        let nonnullCount = 0;
        for (const widget of toHighlight) {
            if (widget !== null) {
                averageCentralY += widget.getRelativeY() + Math.trunc(widget.getHeight() / 2);
                nonnullCount += 1;
            }
        }
        if (nonnullCount === 0) return false;
        averageCentralY = Math.trunc(averageCentralY / nonnullCount);
        const newScroll = Math.max(0, Math.min(parent.getScrollHeight(), averageCentralY - Math.trunc(parent.getHeight() / 2)));
        try {
            this.client.runScript(ScriptID.UPDATE_SCROLLBAR, scrollbar, list, newScroll);
            return true;
        } catch {
            return false;
        }
    }

    /** Bank Tags' TagManager (RuneLite's PluginDependency(BankTagsPlugin)), when that plugin is loaded. */
    tagManager(): TagManager | undefined {
        if (this.tagManagerOverride) return this.tagManagerOverride;
        try {
            return inject(PluginManager).getPlugin(BankTagsPlugin)?.tagManager;
        } catch {
            return undefined;
        }
    }

    testClueTag(itemId: number): boolean {
        return testClueTag(this, itemId);
    }

    // ------------------------------------------------------------------ lifecycle

    protected async startUp(): Promise<void> {
        // RuneLite loads its images synchronously; here they load over the network, so start now.
        this.images.mapArrow();
        this.images.emote();
        const tags = this.tagManager();
        if (tags) {
            registerClueTags(this, tags);
            this.registeredTags = tags;
        }
    }

    protected async shutDown(): Promise<void> {
        if (this.registeredTags) unregisterClueTags(this.registeredTags);
        this.registeredTags = undefined;
        this.npcsToMark.length = 0;
        this.namedObjectsToMark.clear();
        this.inventoryItems = null;
        this.equippedItems = null;
        this.currentPlane = -1;
        this.currentBaseX = -1;
        this.currentBaseY = -1;
        this.namedObjectCheckThisTick = false;
        this.resetClue(true);
    }

    // ------------------------------------------------------------------ events

    onChatMessage(event: ChatMessage): void {
        const type = event.getType();
        if (type === ChatMessageType.GAMEMESSAGE || type === ChatMessageType.SPAM) {
            const message = event.getMessage();
            if (this.clue instanceof HotColdClue && this.clue.update(message, this)) this.worldMapPointsSet = false;
            if (this.clue instanceof SkillChallengeClue) {
                const text = Text.removeTags(message);
                if (
                    text === "Skill challenge completed." ||
                    text === "You have completed your master level challenge!" ||
                    text.startsWith("You have completed Charlie's task,") ||
                    text === "You have completed this challenge scroll."
                ) {
                    this.clue.setChallengeCompleted(true);
                }
            }
            if (message.endsWith(" the STASH unit.")) {
                if (this.clue instanceof EmoteClue && this.clickedSTASHClue && message === "You withdraw your items from the STASH unit.") this.activeSTASHClue = this.clickedSTASHClue;
                else if (message === "You deposit your items into the STASH unit.") this.activeSTASHClue = null;
                this.clickedSTASHClue = null;
            }
        } else if (type === ChatMessageType.DIALOG) {
            const [sender, text] = splitOnce(event.getMessage(), "|");
            const npcChatClue = findNpcChatClueScroll(sender, text);
            if (npcChatClue) this.updateClue(npcChatClue);
        }
    }

    /** The engine's menu click hook (RuneLite's MenuOptionClicked); never consumes the click. */
    onMenuOptionClicked(event: MenuActionData): boolean {
        if (!event.option) return false;
        const isXMarksTheSpotOrb = event.itemId === ItemID.CLUEQUEST_CLUE3;
        if (isXMarksTheSpotOrb || event.option === "Read") {
            const definition = this.client.getItemDefinition(event.itemId);
            const name = definition?.getName() ?? "";
            if (isXMarksTheSpotOrb || name.startsWith("Clue scroll") || name.startsWith("Challenge scroll") || name.startsWith("Treasure scroll")) {
                this.clueItemId = definition?.getId() ?? event.itemId;
                this.updateClue(findClueScrollForItem(this.clueItemId));
            }
        } else if (event.option === "Search" && this.clue instanceof EmoteClue) {
            const stash = this.clue.getStashUnit();
            if (stash && stash.getObjectId() === event.identifier) this.clickedSTASHClue = this.clue;
        }
        return false;
    }

    onItemContainerChanged(event: ItemContainerChanged): void {
        const itemContainer = event.getItemContainer();
        if (event.getContainerId() === InventoryID.WORN) {
            this.equippedItems = itemContainer.getItems();
            return;
        }
        if (event.getContainerId() !== InventoryID.INV) return;

        const previousInventory = this.inventoryItems;
        this.inventoryItems = itemContainer.getItems();

        // Count the runes in a rune pouch as inventory items.
        if (RUNE_POUCHES.some((pouch) => itemContainer.contains(pouch))) {
            const runePouchContents = this.getRunepouchContents();
            if (runePouchContents.length > 0) {
                this.inventoryItems = this.inventoryItems.map((invItem) => {
                    const index = runePouchContents.findIndex((rune) => rune.getId() === invItem.getId());
                    if (index < 0) return invItem;
                    const [rune] = runePouchContents.splice(index, 1);
                    return new Item(invItem.getId(), rune.getQuantity() + invItem.getQuantity());
                });
                this.inventoryItems.push(...runePouchContents);
            }
        }

        // The clue left the inventory.
        if (this.clue && this.clueItemId !== null && !itemContainer.contains(this.clueItemId)) this.resetClue(true);

        // A three-step clue: a torn part found ticks a step off.
        if (this.clue instanceof ThreeStepCrypticClue && this.clue.update(event.getContainerId(), itemContainer)) {
            this.worldMapPointsSet = false;
            this.npcsToMark.length = 0;
            if (this.displayHintArrows()) this.client.clearHintArrow();
            checkClueNPCs(this, this.clue, this.client.getNpcs());
        }

        // Identify new clues in the inventory, respecting an already set clue.
        const newInventoryClues = new Set(this.inventoryItems);
        if (previousInventory) {
            const previousIds = new Set(previousInventory.map((item) => item.getId()));
            for (const item of [...newInventoryClues]) if (previousIds.has(item.getId())) newInventoryClues.delete(item);
        }
        for (const item of [...newInventoryClues]) {
            // Param 623 names a clue-helper row: only then is the item a clue scroll.
            const definition = this.client.getItemDefinition(item.getId());
            if (!definition || definition.getIntValue(ParamID.CLUE_SCROLL) === -1) newInventoryClues.delete(item);
        }
        if (newInventoryClues.size > 0) {
            const newClueId = newInventoryClues.values().next().value!.getId();
            const mode = this.identificationMode();
            if (mode === "ON_PICKUP" || (mode === "IF_INACTIVE" && this.clue === null && this.clueItemId === null)) this.setActiveClue(newClueId);
        }
    }

    private setActiveClue(itemId: number): void {
        const clueScroll = findClueScrollForItem(itemId);
        if (clueScroll) {
            this.clueItemId = itemId;
            this.updateClue(clueScroll);
        } else if (itemId !== ItemID.TRAIL_CLUE_BEGINNER && itemId !== ItemID.TRAIL_CLUE_MASTER) {
            console.info(`[ClueScroll] Unknown clue scroll id: ${itemId}`);
        }
    }

    private getRunepouchContents(): Item[] {
        const runepouchEnum = this.client.getEnum(EnumID.RUNEPOUCH_RUNE);
        const items: Item[] = [];
        if (!runepouchEnum) return items;
        for (let i = 0; i < RUNEPOUCH_AMOUNT_VARBITS.length; i++) {
            const amount = this.client.getVarbitValue(RUNEPOUCH_AMOUNT_VARBITS[i]);
            if (amount <= 0) continue;
            const runeId = this.client.getVarbitValue(RUNEPOUCH_RUNE_VARBITS[i]);
            if (runeId === 0) continue;
            items.push(new Item(runepouchEnum.getIntValue(runeId), amount));
        }
        return items;
    }

    onNpcSpawned(event: NpcSpawned): void {
        const npc = this.client.getNpcByIndex(event.getNpc().index);
        if (npc) checkClueNPCs(this, this.clue, [npc]);
    }

    onNpcDespawned(event: NpcDespawned): void {
        const index = event.getNpc().index;
        const at = this.npcsToMark.findIndex((npc) => npc.getIndex() === index);
        if (at < 0) return;
        this.npcsToMark.splice(at, 1);
        if (this.npcsToMark.length === 0) this.client.clearHintArrow();
        else this.client.setHintArrow(this.npcsToMark[0]); // Always point at the first NPC seen.
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === ClueScrollConfig.group && !this.displayHintArrows()) this.client.clearHintArrow();
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if (state !== GameState.LOGGED_IN) this.namedObjectsToMark.clear();
        if (state === GameState.LOGIN_SCREEN) this.resetClue(true);
        else if (state === GameState.HOPPING) this.namedObjectCheckThisTick = true;
    }

    onGameTick(): void {
        if (this.clueTextToRead) {
            this.clueTextToRead = false;
            this.readClueText();
        }
        this.objectsToMark.length = 0;

        if (this.clue && isLocationsClueScroll(this.clue)) {
            const locations = this.clue.getLocations(this);
            if (locations.length > 0) this.addMapPoints(...locations);
            if (isObjectClueScroll(this.clue)) {
                const objectIds = this.clue.getObjectIds();
                if (objectIds.length > 0) for (const location of locations) if (location) highlightObjectsForLocation(this, location, objectIds);
            }
        }

        if (this.clue && isLocationClueScroll(this.clue)) {
            const locations = locationClueLocations(this.clue, this);
            const hintNpc = this.client.getHintArrowNpc();
            const npcHintArrowMarked = hintNpc !== null && this.npcsToMark.some((npc) => npc.getIndex() === hintNpc.getIndex());
            if (!npcHintArrowMarked) this.client.clearHintArrow();
            for (const location of locations) {
                // Only set the location hint arrow when no NPC gives a more exact one.
                if (location.isInScene(this.client) && this.displayHintArrows() && !npcHintArrowMarked) this.client.setHintArrow(location);
                this.addMapPoints(location);
                if (isObjectClueScroll(this.clue)) {
                    const objectIds = this.clue.getObjectIds();
                    if (objectIds.length > 0) highlightObjectsForLocation(this, location, objectIds);
                }
            }
        }

        // A plane change or a scene rebuild (region reload while walking, where RuneLite's
        // *ObjectSpawned re-add the objects): rescan for named objects one tick later, once their
        // forms have settled.
        const plane = this.client.getPlane();
        const baseX = ClientState.baseX, baseY = ClientState.baseY;
        if (this.currentPlane !== plane || this.currentBaseX !== baseX || this.currentBaseY !== baseY) {
            this.namedObjectsToMark.clear();
            this.currentPlane = plane;
            this.currentBaseX = baseX;
            this.currentBaseY = baseY;
            this.namedObjectCheckThisTick = true;
        } else if (this.namedObjectCheckThisTick) {
            this.namedObjectCheckThisTick = false;
            checkClueNamedObjects(this, this.clue);
        }

        // A new beginner or master clue arrives in the item dialogue; these share one item id, so reset here.
        const chatDialogClueItem = this.client.getWidget(OBJECTBOX_ITEM);
        if (chatDialogClueItem && (chatDialogClueItem.getItemId() === ItemID.TRAIL_CLUE_BEGINNER || chatDialogClueItem.getItemId() === ItemID.TRAIL_CLUE_MASTER)) this.resetClue(false);
    }

    onWidgetLoaded(event: WidgetLoaded): void {
        const groupId = event.getGroupId();
        if (groupId >= TRAIL_MAP_FIRST && groupId <= TRAIL_MAP_LAST) this.updateClue(BeginnerMapClue.forWidgetID(groupId));
        else if ((groupId << 16) === (TRAIL_CLUETEXT_TEXT & 0xffff0000)) this.clueTextToRead = true; // the text lands after the open; read it on the tick
    }

    private readClueText(): void {
        const widget = this.client.getWidget(TRAIL_CLUETEXT_TEXT);
        if (!widget) return;
        const clueScroll = findClueScrollForText(this, widget.getText(), this.clueItemId);
        if (clueScroll) this.updateClue(clueScroll);
        else {
            console.info(`[ClueScroll] Unknown clue scroll (id ${this.clueItemId}) for text '${widget.getText()}'`);
            this.resetClue(true);
        }
    }

    onCommandExecuted(event: CommandExecuted): void {
        if (!DEVELOPER_MODE || event.getCommand().toLowerCase() !== "clue") return;
        const text = event.getArguments().join(" ");
        if (!text) this.resetClue(true);
        else this.updateClue(findClueScrollForText(this, text, this.clueItemId));
    }

    // ------------------------------------------------------------------ state

    resetClue(withItemId: boolean): void {
        if (this.clue && isLocationsClueScroll(this.clue)) this.clue.reset();
        if (withItemId) this.clueItemId = null;
        this.clue = null;
        this.worldMapPointManager.removeIf((point) => point instanceof ClueScrollWorldMapPoint);
        this.worldMapPointsSet = false;
        this.npcsToMark.length = 0;
        this.namedObjectsToMark.clear();
        // RuneLite clears the arrow only with the setting on; the arrow is this plugin's, so it goes either way.
        this.client.clearHintArrow();
        this.updateOverlayMenuEntries();
    }

    updateClue(clue: ClueScroll | null): void {
        if (!clue || clue === this.clue) return;
        this.resetClue(false);
        checkClueNPCs(this, clue, this.client.getNpcs());
        checkClueNamedObjects(this, clue);
        // Keep the clue so the scroll window need not stay open.
        this.clue = clue;
        this.updateOverlayMenuEntries();
    }

    private addMapPoints(...points: WorldPoint[]): void {
        if (this.worldMapPointsSet) return;
        this.worldMapPointsSet = true;
        this.worldMapPointManager.removeIf((point) => point instanceof ClueScrollWorldMapPoint);
        for (const point of points) this.worldMapPointManager.add(new ClueScrollWorldMapPoint(point, this));
    }

    private updateOverlayMenuEntries(): void {
        const keys = this.clue?.getConfigKeys() ?? null;
        if (!keys) {
            this.noteEntries = [];
            return;
        }
        if (keys.length === 1) this.noteEntries = [{ option: "Set note", onClick: this.notes.setNoteConsumer(keys[0]) }];
        else this.noteEntries = keys.slice(0, 3).map((key, i) => ({ option: `Set note ${i + 1}`, onClick: this.notes.setNoteConsumer(key) }));
    }
}

/** "sender|text" into its two halves, splitting at the first separator only. */
function splitOnce(text: string, separator: string): [string, string] {
    const at = text.indexOf(separator);
    return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + separator.length)];
}
