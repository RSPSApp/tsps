type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

// The exported names of these plugins differ from their existing setting prefixes.
const LEGACY_NAMESPACES = new Map([
    ["characters", "characters"],
    ["leaguemode", "league"],
    ["quests", "quests"],
    ["randomevents", "random-events"],
]);

export function pluginConfigKey(plugin: string, setting: string): string {
    return `${LEGACY_NAMESPACES.get(plugin.toLowerCase()) ?? plugin}:${setting}`;
}

/** Normalize each file separately so either syntax in the local file can override the shipped one. */
export function normalizeWorldPluginConfig(world: JsonObject): JsonObject {
    if (!isObject(world.plugins) || !Object.values(world.plugins).some(isObject)) return world;

    const switches: [string, unknown][] = [];
    const settings: [string, unknown][] = [];
    for (const [plugin, entry] of Object.entries(world.plugins)) {
        if (!isObject(entry)) {
            switches.push([plugin, entry]);
            continue;
        }
        const { enabled, ...options } = entry;
        if (enabled !== undefined) {
            if (typeof enabled !== "boolean") throw new Error(`plugins.${plugin}.enabled must be true or false`);
            switches.push([plugin, enabled]);
        }
        for (const [key, value] of Object.entries(options)) {
            if (!/^[^:\s]+$/.test(key) || /[:\s]/.test(plugin)) throw new Error(`Invalid plugin setting plugins.${plugin}.${key}`);
            settings.push([pluginConfigKey(plugin, key), value]);
        }
    }
    return {
        ...world,
        plugins: Object.fromEntries(switches),
        pluginConfig: {
            ...(isObject(world.pluginConfig) ? world.pluginConfig : {}),
            ...Object.fromEntries(settings),
        },
    };
}
