import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import { ConfigChanged } from "@runelite/api/events";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { createNotesNavigationButton } from "./NotesPanel";

export const NotesConfig = ConfigGroup("notes", {
    notes: ConfigItem({ name: "Notes", description: "Notes persisted locally.", textArea: true, default: "" }),
});

export type NotesPluginConfig = {
    enabled: boolean;
    notes: string;
};

export type NotesPluginState = {
    config: NotesPluginConfig;
    version: number;
};

export type NotesPluginPersistence = {
    load(): Partial<NotesPluginConfig> | undefined;
    save(config: NotesPluginConfig): void;
};

type NotesPluginListener = () => void;

export class NotesPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Notes",
        description: "Persistent local notes for client/plugin tasks.",
        tags: ["notes"],
        enabledByDefault: false,
        configKey: "notesplugin",
    };

    static config = NotesConfig;

    private readonly listeners: Set<NotesPluginListener> = new Set();
    private readonly configManager = inject(ConfigManager);
    private readonly clientToolbar = inject(ClientToolbar);
    private navButton?: NavigationButton;
    private state: NotesPluginState;
    private version = 0;

    constructor() {
        super();
        this.configManager.getConfig(NotesConfig);
        this.state = { config: this.getConfig(), version: 0 };
    }

    protected async startUp(): Promise<void> {
        this.navButton = createNotesNavigationButton(this);
        this.clientToolbar.addNavigation(this.navButton);
    }

    protected async shutDown(): Promise<void> {
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
    }

    subscribe(listener: NotesPluginListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getState(): NotesPluginState {
        return this.state;
    }

    getConfig(): NotesPluginConfig {
        const config = this.configManager.getConfig(NotesConfig);
        return { enabled: this.isEnabled(), notes: config.notes() };
    }

    setConfig(nextConfig: Partial<NotesPluginConfig>): void {
        if (nextConfig.notes !== undefined) {
            this.configManager.setConfiguration(NotesConfig.group, "notes", nextConfig.notes);
        }
        this.commit();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() === NotesConfig.group) {
            this.commit();
        }
    }

    private commit(): void {
        this.version++;
        this.state = { config: this.getConfig(), version: this.version };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (err) {
                console.log("[notes-plugin] listener failed", err);
            }
        }
    }
}
