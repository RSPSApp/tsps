import { ConfigChanged } from "../../api/events";
import type { EventBus } from "../eventbus/EventBus";
import {
    type ConfigGroupDescriptor,
    type ConfigItemDef,
    type ConfigOf,
    isConfigGroupDescriptor,
} from "./ConfigItem";
import { type ConfigStorage, defaultConfigStorage } from "./ConfigStorage";

export const CONFIG_PREFIX = "rl.config.";

function keyPath(group: string, key: string): string {
    return `${CONFIG_PREFIX}${group}.${key}`;
}

function itemKey(item: ConfigItemDef, property: string): string {
    return item.keyName ?? property;
}

export function serializeConfigValue(item: ConfigItemDef, value: unknown): string {
    if (value === undefined || value === null) return "";
    if (item.color) {
        const color = Math.max(0, Math.floor(Number(value)) | 0);
        const hasAlpha = item.alpha && (color & 0xff000000) !== 0;
        const hex = (color >>> 0).toString(16).padStart(8, "0");
        return hasAlpha ? `#${hex}` : `#${hex.slice(2)}`;
    }
    if (item.enum) {
        for (const [name, enumValue] of Object.entries(item.enum)) {
            if (enumValue === value) return name;
        }
        return String(value);
    }
    return String(value);
}

export function parseConfigValue(item: ConfigItemDef, raw: string | null | undefined): unknown {
    if (raw === null || raw === undefined || raw === "") return item.default;
    if (item.color) {
        if (raw.startsWith("#")) {
            const hex = raw.slice(1);
            return parseInt(hex, 16) >>> 0;
        }
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric >>> 0 : item.default;
    }
    if (item.enum) {
        if (Object.prototype.hasOwnProperty.call(item.enum, raw)) {
            return item.enum[raw];
        }
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? numeric : raw;
    }
    switch (typeof item.default) {
        case "boolean":
            return raw === "true";
        case "number": {
            const numeric = Number(raw);
            return Number.isFinite(numeric) ? numeric : item.default;
        }
        default:
            return raw;
    }
}

/**
 * RuneLite-shaped configuration: values live in localStorage one key per item
 * under `rl.config.<group>.<key>`, are serialised to strings, and changes post
 * `ConfigChanged`.
 */
export class ConfigManager {
    private readonly descriptors = new Map<string, ConfigGroupDescriptor>();
    private readonly accessors = new Map<ConfigGroupDescriptor, ConfigOf<ConfigGroupDescriptor>>();
    private readonly listeners = new Set<(event: ConfigChanged) => void>();
    private readonly storageEventHandler?: (event: StorageEvent) => void;

    constructor(
        private readonly events?: EventBus,
        private readonly storage: ConfigStorage = defaultConfigStorage(),
    ) {
        if (typeof window !== "undefined") {
            this.storageEventHandler = (event) => {
                if (!event.key || !event.key.startsWith(CONFIG_PREFIX)) return;
                const [group, ...rest] = event.key.slice(CONFIG_PREFIX.length).split(".");
                this.emit(new ConfigChanged(group, rest.join("."), event.oldValue ?? undefined, event.newValue ?? undefined));
            };
            window.addEventListener("storage", this.storageEventHandler);
        }
    }

    registerConfig(descriptor: ConfigGroupDescriptor): void {
        this.descriptors.set(descriptor.group, descriptor);
    }

    getConfigDescriptor(group: string): ConfigGroupDescriptor | undefined {
        return this.descriptors.get(group);
    }

    getConfigDescriptors(): ConfigGroupDescriptor[] {
        return [...this.descriptors.values()];
    }

    /** `getConfig(GroupDescriptor)` mirrors RuneLite's `getConfig(Class)`. */
    getConfig<D extends ConfigGroupDescriptor>(descriptor: D): ConfigOf<D> {
        this.registerConfig(descriptor);
        const cached = this.accessors.get(descriptor);
        if (cached) return cached as ConfigOf<D>;
        const accessor: Record<string, () => unknown> = {};
        for (const [property, item] of Object.entries(descriptor.items)) {
            accessor[property] = () =>
                parseConfigValue(item, this.getConfiguration(descriptor.group, itemKey(item, property)));
        }
        const config = accessor as ConfigOf<D>;
        this.accessors.set(descriptor, config as ConfigOf<ConfigGroupDescriptor>);
        return config;
    }

    getConfiguration(group: string, key: string): string | undefined {
        const raw = this.storage.getItem(keyPath(group, key));
        return raw === null ? undefined : raw;
    }

    setConfiguration(group: string, key: string, value: string | number | boolean): void {
        const previous = this.getConfiguration(group, key);
        if (previous === undefined && value === undefined) return;
        const serialized = String(value);
        if (previous === serialized) return;
        this.storage.setItem(keyPath(group, key), serialized);
        this.emit(new ConfigChanged(group, key, previous, serialized));
    }

    /** Writes a typed config value through the descriptor's serialisation. */
    setConfigValue(descriptor: ConfigGroupDescriptor, property: string, value: unknown): void {
        const item = descriptor.items[property];
        if (!item) return;
        this.setConfiguration(
            descriptor.group,
            item.keyName ?? property,
            serializeConfigValue(item, value),
        );
    }

    /**
     * RuneLite's `setDefaultConfiguration(config, override)`: with `override`, every item of the
     * group goes back to its default (the stored values are removed); without it, nothing
     * changes, as values never stored already read as their defaults.
     */
    setDefaultConfiguration(descriptor: ConfigGroupDescriptor, override: boolean): void {
        if (!override) return;
        for (const [property, item] of Object.entries(descriptor.items)) {
            this.unsetConfiguration(descriptor.group, itemKey(item, property));
        }
    }

    unsetConfiguration(group: string, key: string): void {
        const previous = this.getConfiguration(group, key);
        if (previous === undefined) return;
        this.storage.removeItem(keyPath(group, key));
        this.emit(new ConfigChanged(group, key, previous, undefined));
    }

    /** Legacy keys were JSON blobs; migration flags keep the shim one-shot. */
    isMigrated(name: string): boolean {
        return this.storage.getItem(`${CONFIG_PREFIX}migrated.${name}`) === "true";
    }

    markMigrated(name: string): void {
        this.storage.setItem(`${CONFIG_PREFIX}migrated.${name}`, "true");
    }

    /** Raw storage access for the legacy migration shim. */
    readStorageItem(key: string): string | null {
        return this.storage.getItem(key);
    }

    /** Used by the plugin manager for its own keys (group "runelite"). */
    addListener(listener: (event: ConfigChanged) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    destroy(): void {
        if (this.storageEventHandler && typeof window !== "undefined") {
            window.removeEventListener("storage", this.storageEventHandler);
        }
        this.listeners.clear();
    }

    private emit(event: ConfigChanged): void {
        for (const listener of this.listeners) listener(event);
        this.events?.post(event);
    }
}

export { isConfigGroupDescriptor };
