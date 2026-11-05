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
import { ClueScrollConfig } from "./ClueScrollConfig";

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
