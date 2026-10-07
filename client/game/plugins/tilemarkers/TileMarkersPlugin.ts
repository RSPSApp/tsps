import { ConfigChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { inject } from "@runelite/client/plugins/PluginInjector";
import {
    TileMarkersConfig,
    readTileMarkersConfig,
    type TileMarkersPluginConfig,
    type TileMarkersPluginState,
} from "./TileMarkersConfig";

type TileMarkersPluginListener = () => void;

export class TileMarkersPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Tile Markers",
        description: "Highlights destination and true tile positions.",
        tags: ["overlay"],
        configKey: "tilemarkersplugin",
    };

    static config = TileMarkersConfig;

    private readonly listeners: Set<TileMarkersPluginListener> = new Set();
    private readonly configManager = inject(ConfigManager);

    private config: TileMarkersPluginConfig;
    private state: TileMarkersPluginState;
    private version = 0;

    constructor() {
        super();
        this.config = readTileMarkersConfig(this.configManager, this.isEnabled());
        this.state = { config: this.config, version: this.version };
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === TileMarkersConfig.group) this.refresh();
    }

    subscribe(listener: TileMarkersPluginListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): TileMarkersPluginState {
        return this.state;
    }

    getConfig(): TileMarkersPluginConfig {
        return { ...this.state.config, enabled: this.isEnabled() };
    }

    setConfig(nextConfig: Partial<TileMarkersPluginConfig>): void {
        for (const [property, value] of Object.entries(nextConfig)) {
            if (value === undefined || property === "enabled") continue;
            this.configManager.setConfigValue(TileMarkersConfig, property, value);
        }
        this.refresh();
    }

    private refresh(): void {
        this.config = readTileMarkersConfig(this.configManager, this.isEnabled());
        this.version++;
        this.state = { config: this.config, version: this.version };
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[tile-markers-plugin] listener failed", err);
            }
        }
    }
}
