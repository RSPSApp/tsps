import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import {
    InteractHighlightConfig,
    readInteractHighlightConfig,
    type InteractHighlightPluginConfig,
    type InteractHighlightPluginState,
} from "./InteractHighlightConfig";

type InteractHighlightPluginListener = () => void;

export class InteractHighlightPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Interact Highlight",
        description: "Highlights hovered and interacted world objects.",
        tags: ["overlay"],
        configKey: "interacthighlightplugin",
    };

    static config = InteractHighlightConfig;

    private readonly listeners: Set<InteractHighlightPluginListener> = new Set();
    private readonly configManager = inject(ConfigManager);

    private config: InteractHighlightPluginConfig;
    private state: InteractHighlightPluginState;
    private version = 0;

    constructor() {
        super();
        this.config = readInteractHighlightConfig(this.configManager, this.isEnabled());
        this.state = { config: this.config, version: this.version };
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === InteractHighlightConfig.group) this.refresh();
    }

    subscribe(listener: InteractHighlightPluginListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): InteractHighlightPluginState {
        return this.state;
    }

    getConfig(): InteractHighlightPluginConfig {
        return { ...this.state.config, enabled: this.isEnabled() };
    }

    setConfig(nextConfig: Partial<InteractHighlightPluginConfig>): void {
        for (const [property, value] of Object.entries(nextConfig)) {
            if (value === undefined || property === "enabled") continue;
            this.configManager.setConfigValue(InteractHighlightConfig, property, value);
        }
        this.refresh();
    }

    private refresh(): void {
        this.config = readInteractHighlightConfig(this.configManager, this.isEnabled());
        this.version++;
        this.state = { config: this.config, version: this.version };
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[interact-highlight-plugin] listener failed", err);
            }
        }
    }
}
