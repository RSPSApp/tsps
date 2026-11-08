import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { mergeWorldConfig, parseWorldDefinition } from "./WorldDefinition";
import { checkConfigValue } from "./WorldSettingDeclarations";
import type { WorldConfigCatalogData } from "../../plugins/WorldConfigCatalog";

type JsonObject = Record<string, unknown>;
type CatalogOptionLike = WorldConfigCatalogData["options"][number];

/** world.json and world.local.json as they are on disk, kept apart. */
export interface WorldConfigLayers {
    shipped: JsonObject;
    local: JsonObject;
    localExists: boolean;
    /** sha256 of world.local.json raw bytes; "" when the file is absent. */
    localHash: string;
    /** Set (and local left empty) when world.local.json does not parse: the page goes read-only. */
    localError?: string;
}

/** What the page asks to change. `null` means "back to shipped" (the key leaves world.local.json). */
export interface WorldConfigChanges {
    world?: Record<string, unknown>;
    plugins?: Record<string, boolean | null>;
    pluginConfig?: Record<string, unknown | null>;
}

export interface WorldConfigPlan {
    nextLocal: JsonObject;
    diff: { path: string; before: unknown; after: unknown }[];
    warnings: string[];
    errors: string[];
}

function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function sha256(raw: Buffer): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export class WorldConfigStore {
    /** Reads both layers from `dir` (default: data/definitions under the working directory). Never throws for a bad local file. */
    public static read(dir: string = path.resolve("data/definitions")): WorldConfigLayers {
        const shippedParsed = JSON.parse(fs.readFileSync(path.join(dir, "world.json"), "utf8"));
        if (!isObject(shippedParsed)) throw new Error("world.json must be an object");
        const localFile = path.join(dir, "world.local.json");
        if (!fs.existsSync(localFile)) {
            return { shipped: shippedParsed, local: {}, localExists: false, localHash: "" };
        }
        const raw = fs.readFileSync(localFile);
        const localHash = sha256(raw);
        try {
            const parsed = JSON.parse(raw.toString("utf8"));
            if (!isObject(parsed)) throw new Error("world.local.json must be an object");
            return { shipped: shippedParsed, local: parsed, localExists: true, localHash };
        } catch (err) {
            return {
                shipped: shippedParsed,
                local: {},
                localExists: true,
                localHash,
                localError: err instanceof Error ? err.message : String(err),
            };
        }
    }

    /** Applies `changes` to the local layer and checks the merged result. Never touches the disk. */
    public static plan(layers: WorldConfigLayers, changes: WorldConfigChanges, catalog: WorldConfigCatalogData): WorldConfigPlan {
        const nextLocal = structuredClone(layers.local) as JsonObject;
        const shippedPlugins = isObject(layers.shipped.plugins) ? layers.shipped.plugins : {};
        const shippedConfig = isObject(layers.shipped.pluginConfig) ? layers.shipped.pluginConfig : {};

        // Legacy disabledPlugins moves into the plugins section.
        if (Array.isArray(nextLocal.disabledPlugins)) {
            const plugins = isObject(nextLocal.plugins) ? { ...nextLocal.plugins } : {};
            for (const name of nextLocal.disabledPlugins) {
                if (typeof name === "string" && name.trim()) plugins[name] = false;
            }
            nextLocal.plugins = plugins;
            delete nextLocal.disabledPlugins;
        }

        for (const [key, value] of Object.entries(changes.world ?? {})) {
            if (value === null || deepEqual(value, layers.shipped[key])) delete nextLocal[key];
            else nextLocal[key] = value;
        }
        const applySection = (
            section: "plugins" | "pluginConfig",
            shipped: JsonObject,
            edits: Record<string, unknown> | undefined
        ) => {
            if (!edits) return;
            const target: JsonObject = isObject(nextLocal[section]) ? { ...(nextLocal[section] as JsonObject) } : {};
            for (const [key, value] of Object.entries(edits)) {
                if (value === null || deepEqual(value, shipped[key])) delete target[key];
                else target[key] = value;
            }
            if (Object.keys(target).length === 0) delete nextLocal[section];
            else nextLocal[section] = target;
        };
        applySection("plugins", shippedPlugins, changes.plugins);
        applySection("pluginConfig", shippedConfig, changes.pluginConfig);

        const diff: WorldConfigPlan["diff"] = [];
        const addDiff = (p: string, before: unknown, after: unknown) => {
            if (!deepEqual(before, after)) diff.push({ path: p, before, after });
        };
        for (const key of new Set([...Object.keys(layers.local), ...Object.keys(nextLocal)])) {
            if (key === "plugins" || key === "pluginConfig") {
                const before = isObject(layers.local[key]) ? (layers.local[key] as JsonObject) : {};
                const after = isObject(nextLocal[key]) ? (nextLocal[key] as JsonObject) : {};
                for (const sub of new Set([...Object.keys(before), ...Object.keys(after)])) {
                    addDiff(`${key}.${sub}`, before[sub], after[sub]);
                }
            } else {
                addDiff(key, layers.local[key], nextLocal[key]);
            }
        }

        const errors: string[] = [];
        const warnings: string[] = [];
        const merged = mergeWorldConfig(layers.shipped, nextLocal);
        try {
            parseWorldDefinition(merged);
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }
        // Required lazily: PluginManager pulls in most of the server.
        const { PluginManager, pluginNameFromFile, resolvePluginEnabled } = require("../../plugins/PluginManager");
        let switchState: { switches: Map<string, boolean>; defaultEnabled?: boolean } | undefined;
        try {
            switchState = PluginManager.parsePluginSwitches(merged);
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }

        for (const option of catalog.world) {
            const value = merged[option.key];
            if (value === undefined) continue;
            const check = checkConfigValue(option.decl, value);
            if (check.ok === false) errors.push(`${option.key}: ${check.error}`);
        }
        const declared = new Map<string, CatalogOptionLike>(catalog.options.map((o) => [o.key, o]));
        const mergedConfig = isObject(merged.pluginConfig) ? merged.pluginConfig : {};
        const localConfig = isObject(nextLocal.pluginConfig) ? nextLocal.pluginConfig : {};
        const membersWorld = merged.membersWorld !== false;
        for (const [key, value] of Object.entries(mergedConfig)) {
            const option = declared.get(key);
            if (!option) {
                if (key in localConfig) warnings.push(`pluginConfig "${key}" is not declared by any plugin; it is kept as written.`);
                continue;
            }
            const check = checkConfigValue(option.decl, value);
            if (check.ok === false) errors.push(`${key}: ${check.error}`);
            else if (!membersWorld && option.decl.members && key in localConfig) {
                warnings.push(`${key} is a members option but this is not a members world.`);
            }
        }

        if (switchState) {
            const { switches, defaultEnabled } = switchState;
            const enabled = new Map<string, boolean>();
            for (const p of catalog.plugins) {
                enabled.set(
                    p.name,
                    resolvePluginEnabled(switches, defaultEnabled, p.name, pluginNameFromFile(p.file), p.defaultEnabled ? undefined : false)
                );
            }
            const wasOff = new Set(catalog.plugins.filter((p) => !p.enabled).map((p) => p.name));
            const off = new Set(catalog.plugins.filter((p) => !enabled.get(p.name)).map((p) => p.name));
            // Cut off when anything it depends on, directly or transitively, is off.
            const cutOff = (p: { dependsOn: string[] }, seen = new Set<string>()): boolean => {
                for (const dep of p.dependsOn) {
                    if (off.has(dep)) return true;
                    const depPlugin = catalog.plugins.find((q) => q.name === dep);
                    if (depPlugin && !seen.has(dep)) {
                        seen.add(dep);
                        if (cutOff(depPlugin, seen)) return true;
                    }
                }
                return false;
            };
            const newlyOff = [...off].filter((n) => !wasOff.has(n));
            const affected = catalog.plugins.filter((p) => enabled.get(p.name) && cutOff(p));
            if (newlyOff.length > 0 && affected.length > 0) {
                warnings.push(
                    `Turning off ${newlyOff.join(", ")} also stops plugins that depend on it: ${affected.map((p) => p.name).join(", ")}.`
                );
            }
            if (!membersWorld) {
                const members = catalog.plugins.filter((p) => p.members && enabled.get(p.name));
                if (members.length > 0) {
                    warnings.push(
                        `Members plugins are switched on but this is not a members world, so they will not load: ${members.map((p) => p.name).join(", ")}.`
                    );
                }
            }
        }
        return { nextLocal, diff, warnings, errors };
    }

    /** Replaces world.local.json atomically. Refuses a stale hash or an unparseable current file. */
    public static write(dir: string, nextLocal: JsonObject, expectedHash: string): void {
        const file = path.join(dir, "world.local.json");
        const current = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
        const currentHash = current ? sha256(current) : "";
        if (currentHash !== expectedHash) {
            throw new Error("world.local.json changed since loaded; reload the page and try again");
        }
        if (current) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(current.toString("utf8"));
            } catch (err) {
                throw new Error(`world.local.json does not parse (${(err as Error).message}); fix it by hand first`);
            }
            if (!isObject(parsed)) throw new Error("world.local.json does not parse as an object; fix it by hand first");
        }
        const temp = path.join(dir, `.world.local.json.${process.pid}.${Date.now()}.tmp`);
        try {
            fs.writeFileSync(temp, JSON.stringify(nextLocal, null, 2) + "\n");
            fs.renameSync(temp, file);
        } catch (err) {
            fs.rmSync(temp, { force: true });
            throw err;
        }
    }
}
