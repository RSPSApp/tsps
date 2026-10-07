import { PluginChanged } from "../../api/events";
import type { ConfigGroupDescriptor } from "../config/ConfigItem";
import { ConfigManager } from "../config/ConfigManager";
import { EventBus } from "../eventbus/EventBus";
import { ClientToolbar } from "../ui/ClientToolbar";
import { type Plugin, type PluginClass, type PluginDescriptor } from "./Plugin";
import { PluginInjector } from "./PluginInjector";

export type PluginState = "enabled" | "disabled" | "failed";

const ENABLED_GROUP = "runelite";

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * RuneLite-shaped plugin manager. Enabled state lives in config group
 * `runelite` under the plugin's class-lowercase key, exactly as RuneLite
 * stores it. Start means startUp() then event registration; stop reverses it.
 */
export class PluginManager {
    private readonly plugins = new Map<PluginClass, Plugin>();
    private readonly pluginClasses = new Map<Plugin, PluginClass>();
    private readonly enabled = new Map<PluginClass, boolean>();
    private readonly failures = new Map<PluginClass, string>();
    private readonly listeners = new Set<() => void>();
    private readonly injector: PluginInjector;

    constructor(
        private readonly eventBus: EventBus,
        private readonly configManager: ConfigManager,
    ) {
        this.injector = new PluginInjector(configManager);
        this.injector
            .provide(PluginManager, this)
            .provide(ConfigManager, configManager)
            .provide(EventBus, eventBus)
            .provide(ClientToolbar, new ClientToolbar());
    }

    getInjector(): PluginInjector {
        return this.injector;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Constructs every core plugin; enabled ones are started. */
    loadCorePlugins(classes: ReadonlyArray<PluginClass>): void {
        for (const pluginClass of classes) {
            if (this.plugins.has(pluginClass)) continue;
            const plugin = this.injector.runWith(() => new pluginClass());
            this.plugins.set(pluginClass, plugin);
            this.pluginClasses.set(plugin, pluginClass);
            const enabled = this.readEnabled(pluginClass);
            this.enabled.set(pluginClass, enabled);
            plugin.setEnabledState(enabled);
        }
        for (const pluginClass of classes) {
            if (this.enabled.get(pluginClass)) {
                void this.startPlugin(pluginClass);
            }
        }
    }

    async setPluginEnabled(pluginOrClass: Plugin | PluginClass, enabled: boolean): Promise<void> {
        const pluginClass = this.toClass(pluginOrClass);
        if (!pluginClass) return;
        const current = this.enabled.get(pluginClass) ?? false;
        if (current === enabled) return;
        this.enabled.set(pluginClass, enabled);
        this.configManager.setConfiguration(ENABLED_GROUP, this.keyOf(pluginClass), String(enabled));
        const plugin = this.plugins.get(pluginClass);
        if (plugin) plugin.setEnabledState(enabled);
        if (enabled) await this.startPlugin(pluginClass);
        else await this.stopPlugin(pluginClass);
        this.eventBus.post(new PluginChanged(plugin as Plugin, enabled));
        this.notify();
    }

    isEnabled(pluginOrClass: Plugin | PluginClass): boolean {
        const pluginClass = this.toClass(pluginOrClass);
        return pluginClass ? (this.enabled.get(pluginClass) ?? false) : false;
    }

    getState(pluginOrClass: Plugin | PluginClass): PluginState {
        const pluginClass = this.toClass(pluginOrClass);
        if (!pluginClass) return "disabled";
        if (this.failures.has(pluginClass)) return "failed";
        return this.isEnabled(pluginClass) ? "enabled" : "disabled";
    }

    getFailure(pluginClass: PluginClass): string | undefined {
        return this.failures.get(pluginClass);
    }

    getPlugin<T extends Plugin>(pluginClass: PluginClass<T>): T | undefined {
        return this.plugins.get(pluginClass) as T | undefined;
    }

    getPluginClass(plugin: Plugin): PluginClass | undefined {
        return this.pluginClasses.get(plugin);
    }

    getDescriptor(pluginOrClass: Plugin | PluginClass): PluginDescriptor {
        const pluginClass = this.toClass(pluginOrClass);
        return pluginClass ? pluginClass.descriptor : { name: "" };
    }

    getConfigDescriptor(pluginOrClass: Plugin | PluginClass): ConfigGroupDescriptor | undefined {
        return this.toClass(pluginOrClass)?.config;
    }

    getPlugins(): ReadonlyArray<Plugin> {
        return [...this.plugins.values()];
    }

    getPluginClasses(): ReadonlyArray<PluginClass> {
        return [...this.plugins.keys()];
    }

    getEnabledPlugins(): ReadonlyArray<Plugin> {
        return this.getPluginClasses()
            .filter((pluginClass) => this.enabled.get(pluginClass))
            .map((pluginClass) => this.plugins.get(pluginClass) as Plugin);
    }

    keyOf(pluginOrClass: Plugin | PluginClass): string {
        const pluginClass = this.toClass(pluginOrClass);
        if (!pluginClass) return "";
        return pluginClass.descriptor.configKey ?? slug(pluginClass.descriptor.name);
    }

    private async startPlugin(pluginClass: PluginClass): Promise<void> {
        const plugin = this.plugins.get(pluginClass);
        if (!plugin || plugin.isStarted()) return;
        try {
            await plugin.start();
            this.eventBus.register(plugin);
            this.failures.delete(pluginClass);
        } catch (error) {
            this.failures.set(
                pluginClass,
                error instanceof Error ? error.message : String(error),
            );
            console.error(`[PluginManager] ${pluginClass.descriptor.name} failed to start`, error);
        }
        this.notify();
    }

    private async stopPlugin(pluginClass: PluginClass): Promise<void> {
        const plugin = this.plugins.get(pluginClass);
        if (!plugin || !plugin.isStarted()) return;
        this.eventBus.unregister(plugin);
        try {
            await plugin.stop();
        } catch (error) {
            console.error(`[PluginManager] ${pluginClass.descriptor.name} failed to stop`, error);
        }
    }

    private readEnabled(pluginClass: PluginClass): boolean {
        const stored = this.configManager.getConfiguration(ENABLED_GROUP, this.keyOf(pluginClass));
        if (stored === undefined) return pluginClass.descriptor.enabledByDefault ?? true;
        return stored === "true";
    }

    private toClass(pluginOrClass: Plugin | PluginClass): PluginClass | undefined {
        return typeof pluginOrClass === "function"
            ? pluginOrClass
            : this.pluginClasses.get(pluginOrClass);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.error("[PluginManager] listener failed", error);
            }
        }
    }
}
