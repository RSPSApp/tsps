import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
    ConfigOptionDeclaration,
    CORE_CONFIG_DECLARATIONS,
    WORLD_SETTING_DECLARATIONS,
    validateDeclaration,
} from "../game/definition/WorldSettingDeclarations";
import { mergeWorldConfig } from "../game/definition/WorldDefinition";
import { isFreeToPlayWorld } from "../game/definition/WorldPluginConfig";
import { WorldConfigLayers } from "../game/definition/WorldConfigStore";
import { PluginModule } from "./PluginTypes";
import { PluginManager, normalizePluginName, pluginNameFromFile, resolvePluginEnabled } from "./PluginManager";

export interface CatalogPlugin {
    name: string;
    file: string;
    /** First folder under the plugins directory. */
    area: string;
    description?: string;
    members: boolean;
    dependsOn: string[];
    defaultEnabled: boolean;
    /** world.json's switch for it (by name or file name), if it has one. */
    shippedSwitch?: boolean;
    /** world.local.json's `plugins` entry under exactly this name, if any. */
    localSwitch?: boolean;
    enabled: boolean;
    loaded: boolean;
    /** ZIP source has not been loaded by the runtime. */
    awaitingLoad?: boolean;
}

export interface CatalogOption {
    key: string;
    owner: string;
    decl: ConfigOptionDeclaration;
    shipped: unknown | undefined;
    local: unknown | undefined;
    ownerEnabled: boolean;
}

export interface WorldConfigCatalogData {
    plugins: CatalogPlugin[];
    options: CatalogOption[];
    world: CatalogOption[];
    membersWorld: boolean;
}

type JsonObject = Record<string, unknown>;

function plainObject(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

/**
 * What the world config page shows: every plugin file (switched on or off) with its declared
 * options. Modules are require()d for metadata only; register is never called.
 */
export class WorldConfigCatalog {
    private static cache: { key: string; data: WorldConfigCatalogData } | null = null;

    public static invalidate(): void {
        WorldConfigCatalog.cache = null;
    }

    public static build(pluginDirectory: string, layers: WorldConfigLayers): WorldConfigCatalogData {
        const key = [
            pluginDirectory,
            layers.localHash,
            crypto.createHash("sha256").update(JSON.stringify(layers.shipped)).digest("hex"),
        ].join("|");
        if (WorldConfigCatalog.cache?.key === key) {
            return WorldConfigCatalog.cache.data;
        }
        const data = WorldConfigCatalog.compute(pluginDirectory, layers);
        WorldConfigCatalog.cache = { key, data };
        return data;
    }

    private static compute(pluginDirectory: string, layers: WorldConfigLayers): WorldConfigCatalogData {
        const merged = mergeWorldConfig(layers.shipped, layers.local);
        let parsedSwitches: ReturnType<typeof PluginManager.parsePluginSwitches>;
        try {
            parsedSwitches = PluginManager.parsePluginSwitches(merged);
        } catch (err) {
            console.warn(`[world-config] ${(err as Error).message}; treating every plugin as on its own default`);
            parsedSwitches = { switches: new Map() };
        }
        const { switches, defaultEnabled } = parsedSwitches;
        const membersWorld = !isFreeToPlayWorld(merged);
        const shippedSwitches = new Map<string, boolean>();
        for (const [key, value] of Object.entries(plainObject(layers.shipped.plugins))) {
            if (typeof value === "boolean") shippedSwitches.set(normalizePluginName(key), value);
        }
        // A legacy disabledPlugins list in world.json overrides every "plugins" entry and default,
        // so no local entry is reported there and the page never asks to remove one.
        const localPlugins = Array.isArray(layers.shipped.disabledPlugins) ? {} : plainObject(layers.local.plugins);

        const found: { plugin: CatalogPlugin; module: PluginModule }[] = [];
        for (const file of PluginManager.discoverPluginFiles(pluginDirectory, PluginManager.MAX_PLUGIN_DEPTH)) {
            const relative = path.relative(pluginDirectory, file).split(path.sep);
            const fileName = pluginNameFromFile(file);
            const importedPackage = relative[0] === "imported";
            let awaitingLoad = false;
            let module: PluginModule;
            try {
                const cached = importedPackage ? require.cache[require.resolve(file)] : undefined;
                awaitingLoad = importedPackage && !cached?.loaded;
                if (awaitingLoad) {
                    // Only the server's startup loader may execute an imported ZIP's source.
                    const { description } = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "plugin.json"), "utf8"));
                    module = { name: fileName, description, register() {} };
                } else {
                    const imported = importedPackage ? cached?.exports : require(file);
                    module = (imported?.default ?? imported) as PluginModule;
                }
            } catch (err) {
                console.warn(`[world-config] could not read ${path.basename(file)}: ${(err as Error).message}`);
                continue;
            }
            if (!module || typeof module.register !== "function") continue;
            const name = typeof module.name === "string" && module.name.trim() ? module.name.trim() : fileName;
            found.push({
                module,
                plugin: {
                    name,
                    file: relative.join("/"),
                    area: relative[0],
                    description: typeof module.description === "string" ? module.description : undefined,
                    members: module.members === true,
                    dependsOn: PluginManager.normalizePluginDependencies(name, module.dependsOn, file),
                    defaultEnabled: module.enabled !== false,
                    shippedSwitch: shippedSwitches.get(normalizePluginName(name)) ?? shippedSwitches.get(normalizePluginName(fileName)),
                    localSwitch: Object.prototype.hasOwnProperty.call(localPlugins, name) && typeof localPlugins[name] === "boolean"
                        ? (localPlugins[name] as boolean)
                        : undefined,
                    enabled: resolvePluginEnabled(switches, defaultEnabled, name, fileName, module.enabled),
                    loaded: false,
                    ...(awaitingLoad ? { awaitingLoad: true } : {}),
                },
            });
        }

        // The loader rule: switched on, not a members plugin on a free-to-play world, and
        // every dependency itself loaded.
        const loadedNames = new Set<string>();
        let progress = true;
        while (progress) {
            progress = false;
            for (const { plugin } of found) {
                if (loadedNames.has(plugin.name)) continue;
                if (plugin.awaitingLoad || !plugin.enabled || (!membersWorld && plugin.members)) continue;
                if (!plugin.dependsOn.every((dependency) => loadedNames.has(dependency))) continue;
                loadedNames.add(plugin.name);
                progress = true;
            }
        }
        for (const { plugin } of found) plugin.loaded = loadedNames.has(plugin.name);

        const shippedConfig = plainObject(layers.shipped.pluginConfig);
        const localConfig = plainObject(layers.local.pluginConfig);
        const options: CatalogOption[] = [];
        for (const [key, decl] of Object.entries(CORE_CONFIG_DECLARATIONS)) {
            options.push({ key, owner: "core", decl, shipped: shippedConfig[key], local: localConfig[key], ownerEnabled: true });
        }
        // As the loader does: invalid declarations are left out, and a key belongs to the core
        // or the first loaded plugin declaring it (then the first unloaded one).
        const validConfig = (module: PluginModule): [string, ConfigOptionDeclaration][] => {
            const config: unknown = module.config;
            if (!config || typeof config !== "object" || Array.isArray(config)) return [];
            return Object.entries(config as Record<string, ConfigOptionDeclaration>)
                .filter(([key, decl]) => validateDeclaration(key, decl).length === 0);
        };
        const owners = new Map<string, string>(Object.keys(CORE_CONFIG_DECLARATIONS).map((key) => [key, "core"]));
        for (const { plugin, module } of found) {
            if (!plugin.loaded) continue;
            for (const [key] of validConfig(module)) if (!owners.has(key)) owners.set(key, plugin.name);
        }
        for (const { plugin, module } of found) {
            for (const [key, decl] of validConfig(module)) {
                if (!owners.has(key)) owners.set(key, plugin.name);
                if (owners.get(key) !== plugin.name) continue;
                options.push({
                    key,
                    owner: plugin.name,
                    decl,
                    shipped: shippedConfig[key],
                    local: localConfig[key],
                    ownerEnabled: plugin.loaded,
                });
            }
        }
        const world: CatalogOption[] = Object.entries(WORLD_SETTING_DECLARATIONS).map(([key, decl]) => ({
            key,
            owner: "world",
            decl,
            shipped: layers.shipped[key],
            local: layers.local[key],
            ownerEnabled: true,
        }));
        return { plugins: found.map((entry) => entry.plugin), options, world, membersWorld };
    }
}
