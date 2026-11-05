/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { ChatboxPanelManager } from "@runelite/client/game/chatbox/ChatboxPanelManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { WorldMapPointManager } from "@runelite/client/ui/overlay/worldmap/WorldMapPointManager";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import type { OsrsClient } from "../../OsrsClient";
import { BankTagsPlugin } from "../banktags/BankTagsPlugin";
import type { TagManager } from "../banktags/TagManager";
import type { NPC } from "@runelite/api/Client";
import type { Item } from "@runelite/api/Item";
import { ClueScrollConfig } from "./ClueScrollConfig";
import { ClueScrollImages } from "./ClueScrollImages";
import type { TileObject } from "./clues/TileObject";

/** RuneLite's CLUE_NOTE_KEY_PREFIX: notes live at `cluescroll.note_<key>`. */
export const CLUE_NOTE_KEY_PREFIX = "note_";

/** What a test hands the plugin instead of the injector's singletons. */
export type ClueScrollPluginDeps = {
    client?: OsrsClient;
    configManager?: ConfigManager;
    chatboxPanelManager?: ChatboxPanelManager;
    tagManager?: TagManager;
    worldMapPointManager?: WorldMapPointManager;
};

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
    private readonly tagManagerOverride?: TagManager;
    private readonly images = new ClueScrollImages();

    constructor(deps?: ClueScrollPluginDeps) {
        super();
        this.osrsClient = deps?.client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client = new ClientImpl(this.osrsClient);
        this.configManager = deps?.configManager ?? inject(ConfigManager);
        this.config = this.configManager.getConfig(ClueScrollConfig);
        this.chatboxPanelManager = deps?.chatboxPanelManager ?? inject(ChatboxPanelManager);
        this.worldMapPointManager = deps?.worldMapPointManager ?? inject(WorldMapPointManager);
        this.tagManagerOverride = deps?.tagManager;
    }

    getClient(): ClientImpl {
        return this.client;
    }

    // The state the clue classes read while drawing; filled in by the plugin's event handlers.
    protected npcsToMark: NPC[] = [];
    protected objectsToMark: TileObject[] = [];
    protected namedObjectsToMark = new Set<TileObject>();
    protected inventoryItems: Item[] | null = null;
    protected equippedItems: Item[] | null = null;

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

    /** The player's saved note for a clue key (RuneLite's getClueNote), or null. */
    getClueNote(key: number): string | null {
        const note = this.configManager.getConfiguration(ClueScrollConfig.group, CLUE_NOTE_KEY_PREFIX + key);
        return typeof note === "string" && note.length > 0 ? note : null;
    }

    /** The clue scroll (master) item image RuneLite draws over NPCs and objects; null until loaded. */
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

    /** Bank Tags' TagManager (RuneLite's PluginDependency(BankTagsPlugin)), when that plugin is loaded. */
    tagManager(): TagManager | undefined {
        if (this.tagManagerOverride) return this.tagManagerOverride;
        try {
            return inject(PluginManager).getPlugin(BankTagsPlugin)?.tagManager;
        } catch {
            return undefined;
        }
    }

    protected async startUp(): Promise<void> {}

    protected async shutDown(): Promise<void> {}
}
