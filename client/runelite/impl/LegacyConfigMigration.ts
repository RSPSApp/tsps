import type { ConfigGroupDescriptor } from "../client/config/ConfigItem";
import type { ConfigManager } from "../client/config/ConfigManager";
import { serializeConfigValue } from "../client/config/ConfigManager";

export interface LegacyConfigMigration {
    /** Migration name recorded under `rl.config.migrated.<name>`. */
    name: string;
    /** The old localStorage key holding a JSON blob, a boolean, or a raw string. */
    legacyKey: string;
    /** Config group to copy matching fields into. */
    config?: ConfigGroupDescriptor;
    /** Legacy fields that must not be copied into the new config. */
    ignore?: string[];
    /** Legacy field name -> config item property, when they differ. */
    fieldMap?: Record<string, string>;
    /** Plugin key (`runelite.<key>`) to receive a legacy `enabled` flag. */
    enabledKey?: string;
    /** Legacy field name that holds a raw (non-JSON) string, e.g. the old notes key. */
    rawStringAs?: string;
}

/** One-shot shim: old JSON/boolean/string blobs are copied into `rl.config.*` keys. */
export function runLegacyConfigMigrations(
    migrations: ReadonlyArray<LegacyConfigMigration>,
    configManager: ConfigManager,
): void {
    for (const migration of migrations) {
        if (configManager.isMigrated(migration.name)) continue;
        const blob = readBlob(configManager, migration);
        if (blob) {
            for (const [legacyField, value] of Object.entries(blob)) {
                if (legacyField === "enabled") {
                    if (typeof value === "boolean" && migration.enabledKey) {
                        if (
                            configManager.getConfiguration("runelite", migration.enabledKey) ===
                            undefined
                        ) {
                            configManager.setConfiguration(
                                "runelite",
                                migration.enabledKey,
                                String(value),
                            );
                        }
                    }
                    continue;
                }
                if (migration.ignore?.includes(legacyField) || !migration.config) continue;
                const property = migration.fieldMap?.[legacyField] ?? legacyField;
                const item = migration.config.items[property];
                if (!item) continue;
                const key = item.keyName ?? property;
                if (configManager.getConfiguration(migration.config.group, key) !== undefined) {
                    continue;
                }
                try {
                    configManager.setConfiguration(
                        migration.config.group,
                        key,
                        serializeConfigValue(item, value),
                    );
                } catch {
                    // A malformed legacy value must not block the rest of the migration.
                }
            }
        }
        configManager.markMigrated(migration.name);
    }
}

function readBlob(
    configManager: ConfigManager,
    migration: LegacyConfigMigration,
): Record<string, unknown> | undefined {
    const raw = configManager.readStorageItem(migration.legacyKey);
    if (raw === null) return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === "boolean") return { enabled: parsed };
        if (typeof parsed === "object" && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Fall through to the raw string form below.
    }
    return migration.rawStringAs ? { [migration.rawStringAs]: raw } : undefined;
}
