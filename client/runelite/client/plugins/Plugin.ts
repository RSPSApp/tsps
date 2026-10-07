import type { ClientPlugin } from "../../../game/plugins/ClientPluginManager";
import type { ConfigGroupDescriptor } from "../config/ConfigItem";
import { inject } from "./PluginInjector";
import { PluginManager } from "./PluginManager";

export interface PluginDescriptor {
    name: string;
    description?: string;
    tags?: string[];
    enabledByDefault?: boolean;
    hidden?: boolean;
    developerPlugin?: boolean;
    conflicts?: string[];
    loadWhenOutdated?: boolean;
    /**
     * Stable storage key (RuneLite stores `runelite.<classname-lowercase>`).
     * Defaults to a slug of `name`; minified class names are not stable, so
     * ported plugins set this explicitly.
     */
    configKey?: string;
}

export type PluginClass<T extends Plugin = Plugin> = (new () => T) & {
    descriptor: PluginDescriptor;
    /** Config group this plugin owns, for the generated settings panel. */
    config?: ConfigGroupDescriptor;
};

/**
 * RuneLite-shaped plugin base. Subclasses override `startUp`/`shutDown` and
 * declare `static descriptor`. A plugin may also implement any of our engine's
 * `ClientPlugin` hooks; enabled plugins are handed to `ClientPluginManager`.
 */
export abstract class Plugin {
    static descriptor: PluginDescriptor = { name: "" };
    static config?: ConfigGroupDescriptor;

    private started = false;
    private pluginEnabled: boolean;

    constructor() {
        this.pluginEnabled = (this.constructor as PluginClass).descriptor.enabledByDefault ?? true;
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        await this.startUp();
    }

    async stop(): Promise<void> {
        if (!this.started) return;
        this.started = false;
        await this.shutDown();
    }

    isStarted(): boolean {
        return this.started;
    }

    /** Hub enabled state (a stopped plugin can still be "enabled"). */
    isEnabled(): boolean {
        return this.pluginEnabled;
    }

    setEnabledState(enabled: boolean): void {
        this.pluginEnabled = enabled;
    }

    /** Routes a runtime enable/disable through the manager when one exists. */
    protected async setPluginEnabled(enabled: boolean): Promise<void> {
        try {
            await inject(PluginManager).setPluginEnabled(this, enabled);
        } catch {
            this.setEnabledState(enabled);
        }
    }

    getName(): string {
        return (this.constructor as PluginClass).descriptor.name;
    }

    resetConfiguration(): void {}

    protected async startUp(): Promise<void> {}

    protected async shutDown(): Promise<void> {}
}

// Merge the engine hook interface into Plugin so hooks can be called on the
// base type, while subclasses only declare the ones they implement.
export interface Plugin extends ClientPlugin {}
