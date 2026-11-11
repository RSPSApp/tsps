type JsonObject = Record<string, unknown>;
export type ScopedPluginSettings = Map<string, { plugin: string; setting: string }>;

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizePluginName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** World mode is known before plugin registration, so members-only content can be skipped. */
export function isFreeToPlayWorld(world: JsonObject): boolean {
    let enabled = false;
    for (const [name, entry] of Object.entries(isObject(world.plugins) ? world.plugins : {})) {
        if (normalizePluginName(name) !== "freetoplay") continue;
        const value = isObject(entry) ? entry.enabled : entry;
        if (typeof value === "boolean") enabled = value;
    }
    return enabled;
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
export function normalizeWorldPluginConfig(world: JsonObject, scopedSettings?: ScopedPluginSettings): JsonObject {
    if (!isObject(world.plugins) || !Object.values(world.plugins).some(isObject)) return migrateCrossFloorVisibility(world);

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
            const flatKey = pluginConfigKey(plugin, key);
            settings.push([flatKey, value]);
            scopedSettings?.set(flatKey, { plugin, setting: key });
        }
    }
    return migrateCrossFloorVisibility({
        ...world,
        plugins: Object.fromEntries(switches),
        pluginConfig: {
            ...(isObject(world.pluginConfig) ? world.pluginConfig : {}),
            ...Object.fromEntries(settings),
        },
    });
}

function isCrossFloorName(name: string): boolean {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "") === "crossfloor";
}

/** Convert visibility in each layer so a local legacy value can still override a shipped switch. */
function migrateCrossFloorVisibility(world: JsonObject): JsonObject {
    if (world.plugins !== undefined && !isObject(world.plugins)) return world;
    const plugins = isObject(world.plugins) ? world.plugins : {};
    const switches = Object.entries(plugins).filter(([name]) => isCrossFloorName(name));
    const config = isObject(world.pluginConfig) ? world.pluginConfig : {};
    const { ["CrossFloor:visibility"]: visibility, ...options } = config;
    if (visibility === undefined && (switches.length === 0 || (switches.length === 1 && switches[0][0] === "CrossFloor"))) return world;

    const enabled = switches.length ? switches[switches.length - 1][1] : visibility;
    const result = { ...world };
    if (visibility !== undefined) result.pluginConfig = options;
    if (switches.length || typeof enabled === "boolean") {
        result.plugins = {
            ...Object.fromEntries(Object.entries(plugins).filter(([name]) => !isCrossFloorName(name))),
            CrossFloor: enabled,
        };
    }
    return result;
}

/** The old disabledPlugins list defaulted every plugin on. CrossFloor was opt-in even on those worlds. */
export function preserveLegacyCrossFloorDefault(world: JsonObject): JsonObject {
    const disabled = world.disabledPlugins;
    if (!Array.isArray(disabled) || disabled.some(name => typeof name === "string" && isCrossFloorName(name))) return world;
    const configured = isObject(world.plugins) ? world.plugins.CrossFloor : undefined;
    const enabled = typeof configured === "boolean" ? configured
        : (process.env.CROSS_FLOOR_VISIBILITY ?? process.env.CROSS_FLOOR_VISIBILITY_AND_COMBAT) === "1";
    return enabled ? world : { ...world, disabledPlugins: [...disabled, "CrossFloor"] };
}
